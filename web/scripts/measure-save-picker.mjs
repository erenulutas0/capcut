/**
 * ADR-026 measurements of the real save dialog (File System Access API) in an
 * installed browser on Windows. The dialog is filled through UI Automation
 * (lib/fill-save-dialog.ps1: sets the file name field and invokes "Save"; no
 * keystrokes are sent anywhere). Everything stays on this machine.
 *
 *   A  new file: the whole video is downloaded into a new file. The folder is
 *      sampled every 50 ms while it encodes: which files exist (the picked
 *      file, a `.crswap` next to it), their sizes, and the peak bytes on disk
 *      compared to the final file.
 *   B  overwrite: the same, into a file that already exists (the dialog's
 *      "replace?" question is answered yes). Shows whether the old file and
 *      the new bytes are on disk at the same time.
 *   D  replace, then cancel: an existing file is picked ("replace" answered
 *      yes) and the download is stopped as soon as it shows. Records the
 *      file size right after the pick and what is left after the cancel.
 *   C  disk full at the reservation: on a bare https test page, a picked file
 *      is opened for writing and `truncate()` asks for more than the free
 *      space of the disk (2 TiB). Records what the browser throws and what is
 *      left behind. No real disk is filled.
 *
 * Usage (server running, e.g. `npx next start -p 3100`):
 *   SHOT_URL=http://127.0.0.1:3100 node scripts/measure-save-picker.mjs \
 *     [--browser=chrome|msedge] [--cases=A,B,C] [--video=tests/media/timeline/portrait-110s.mp4]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const channel = arg('browser', 'chrome');
const cases = new Set(arg('cases', 'A,B,C').split(','));
const videoArg = arg('video', 'tests/media/timeline/portrait-110s.mp4');
const video = isAbsolute(videoArg) ? videoArg : join(root, videoArg);
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
const outDir = join(root, 'test-results', 'save-picker', channel);
const fillScript = join(root, 'scripts', 'lib', 'fill-save-dialog.ps1');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const MiB = 1024 * 1024;
const mib = (bytes) => Number((bytes / MiB).toFixed(2));

/** Fills the dialog; resolves with the script's output lines. */
function fillDialog(browserPid, path, confirmReplace) {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fillScript, '-BrowserPid', String(browserPid), '-Path', path];
    if (confirmReplace) args.push('-ConfirmReplace');
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, lines: out.trim().split(/\r?\n/) }));
  });
}

/** Samples the folder every 50 ms until stopped. */
function sampleFolder(dir) {
  const perFile = new Map();
  let peakTotal = 0;
  let peakAt = null;
  const started = Date.now();
  const timer = setInterval(() => {
    let total = 0;
    const now = {};
    for (const name of readdirSync(dir)) {
      let size = 0;
      try {
        size = statSync(join(dir, name)).size;
      } catch {
        continue;
      }
      now[name] = size;
      total += size;
      const seen = perFile.get(name) ?? { firstMs: Date.now() - started, lastMs: 0, maxBytes: 0, firstBytes: size };
      seen.lastMs = Date.now() - started;
      seen.maxBytes = Math.max(seen.maxBytes, size);
      perFile.set(name, seen);
    }
    if (total > peakTotal) {
      peakTotal = total;
      peakAt = { ms: Date.now() - started, files: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, mib(v)])) };
    }
  }, 50);
  return {
    stop() {
      clearInterval(timer);
      return {
        peakMiB: mib(peakTotal),
        peakAt,
        files: Object.fromEntries(
          [...perFile].map(([name, s]) => [
            name,
            { firstMs: s.firstMs, lastMs: s.lastMs, firstMiB: mib(s.firstBytes), maxMiB: mib(s.maxBytes) },
          ]),
        ),
      };
    },
  };
}

// A browser server, so the browser's process id is known: the dialog is
// looked up only among that process tree's windows.
const server = await chromium.launchServer({ channel, headless: false });
const browserPid = server.process()?.pid;
const browser = await chromium.connect(server.wsEndpoint());
if (!browserPid) throw new Error('no browser process id');
const report = { browser: `${channel} ${browser.version()}`, video: videoArg, cases: {} };

async function downloadInto(caseName, fileName, existingMiB, cancel = false) {
  const dir = join(outDir, caseName);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, fileName);
  if (existingMiB) writeFileSync(target, Buffer.alloc(existingMiB * MiB, 7));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('video-input').setInputFiles(video);
  await page.getByTestId('preview-video').waitFor({ timeout: 60_000 });
  // The capability check runs in the background once the video is open.
  await page.waitForTimeout(4000);

  const sampler = sampleFolder(dir);
  const t0 = Date.now();
  await page.getByTestId('download-all').click();
  const dialog = await fillDialog(browserPid, target, Boolean(existingMiB));
  console.log(`${caseName} dialog: ${dialog.code} ${dialog.lines.join(' | ')}`);
  let sizeAtPick = null;
  if (cancel) {
    // Stop as soon as the encode shows; what is left under the chosen name?
    await page.getByTestId('download-running').waitFor({ timeout: 60_000 });
    sizeAtPick = existsSync(target) ? mib(statSync(target).size) : null;
    await page.getByTestId('export-cancel').click();
  }
  const outcome = await Promise.race([
    ...(cancel ? [page.getByTestId('export-canceled').waitFor({ timeout: 60_000 }).then(() => 'canceled')] : []),
    page.getByTestId('download-saved').waitFor({ timeout: 15 * 60_000 }).then(() => 'saved'),
    page.getByTestId('export-failed').waitFor({ timeout: 15 * 60_000 }).then(() => 'failed'),
  ]).catch((error) => `timeout: ${error.message}`);
  const ms = Date.now() - t0;
  await page.waitForTimeout(1000);
  const folder = sampler.stop();
  const shown =
    outcome === 'saved'
      ? await page.getByTestId('download-saved').textContent()
      : await page.getByTestId('export-failed').textContent().catch(() => null);
  const sizeText = await page.getByTestId('measured-size').textContent().catch(() => null);
  const finalBytes = existsSync(target) ? statSync(target).size : null;
  await context.close();
  return {
    dialog: dialog.lines,
    outcome,
    shown: shown?.replace(/\s+/g, ' ').trim(),
    ms,
    appMeasuredSize: sizeText?.trim() ?? null,
    existingMiB: existingMiB ?? 0,
    sizeAtPick,
    finalMiB: finalBytes === null ? null : mib(finalBytes),
    folder,
    leftAfter: readdirSync(dir),
  };
}

if (cases.has('A')) {
  report.cases.A = await downloadInto('A-new', 'yeni-dosya.mp4', 0);
  console.log(`A: ${JSON.stringify(report.cases.A)}`);
}
if (cases.has('B')) {
  report.cases.B = await downloadInto('B-overwrite', 'var-olan.mp4', 200);
  console.log(`B: ${JSON.stringify(report.cases.B)}`);
}

if (cases.has('D')) {
  report.cases.D = await downloadInto('D-replace-cancel', 'var-olan.mp4', 200, true);
  console.log(`D: ${JSON.stringify(report.cases.D)}`);
}

if (cases.has('C')) {
  const dir = join(outDir, 'C-reserve');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'ayirma.bin');
  const freeBefore = await freeBytes(dir);
  // A control size that fits, one just past the free space, and one far past.
  const sizes = [10 * MiB, freeBefore + 16 * 1024 ** 3, 2 * 1024 ** 4];
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = 'https://save-picker.measure.invalid/';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><button id="go">go</button><script>
        const sizes = ${JSON.stringify(sizes)};
        const describe = (error) => ({ name: error.name, message: error.message });
        document.getElementById('go').onclick = async () => {
          const out = { attempts: [] };
          try {
            const handle = await window.showSaveFilePicker({ suggestedName: 'ayirma.bin' });
            out.pickedSize = (await handle.getFile()).size;
            for (const bytes of sizes) {
              const attempt = { bytes };
              const writable = await handle.createWritable({ keepExistingData: false });
              const t = performance.now();
              try {
                await writable.truncate(bytes);
                attempt.truncate = 'ok';
              } catch (error) {
                attempt.truncate = describe(error);
              }
              attempt.truncateMs = Math.round(performance.now() - t);
              try {
                await writable.write(new Uint8Array(1024));
                attempt.writeAfter = 'ok';
              } catch (error) {
                attempt.writeAfter = describe(error);
              }
              try {
                await writable.abort();
                attempt.abort = 'ok';
              } catch (error) {
                attempt.abort = describe(error);
              }
              attempt.sizeAfterAbort = (await handle.getFile()).size;
              out.attempts.push(attempt);
            }
          } catch (error) {
            out.error = describe(error);
          }
          window.__result = out;
        };
      </script>`,
    }),
  );
  await page.goto(url);
  await page.click('#go');
  const dialog = await fillDialog(browserPid, target, false);
  console.log(`C dialog: ${dialog.code} ${dialog.lines.join(' | ')}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 120_000 });
  const result = await page.evaluate(() => window.__result);
  report.cases.C = {
    dialog: dialog.lines,
    freeGiBBefore: Number((freeBefore / 1024 ** 3).toFixed(1)),
    result,
    leftAfter: readdirSync(dir).map((name) => ({ name, bytes: statSync(join(dir, name)).size })),
  };
  console.log(`C: ${JSON.stringify(report.cases.C)}`);
  await context.close();
}

await browser.close();
await server.close();
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`report: ${join(outDir, 'report.json')}`);

/** Free bytes on the drive of `path` (Windows). */
function freeBytes(path) {
  const drive = path.slice(0, 1);
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-PSDrive ${drive}).Free`], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(Number(out.trim()) || 0));
  });
}
