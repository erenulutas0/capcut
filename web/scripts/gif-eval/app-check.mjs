/**
 * GIF in the app itself (ADR-046 addenda): the screen's estimate against the
 * real file, the time to make it and the peak memory of the browser while
 * making it — for each clip, part length and size.
 *
 *   node scripts/gif-eval/app-check.mjs --clips=<local.json> [--url=http://127.0.0.1:3193] [--sizes=small,medium,large] [--seconds=4,10] [--channel=chrome] [--only=R2,S1] [--tag=x]
 *
 * Needs a running build of the app at --url (`npx next start -p 3193`). No
 * save dialog (the download link road), so the GIF arrives as a download.
 * Memory: private bytes of the whole browser process tree, sampled by the
 * operating system every 200 ms (`scripts/lib/process-memory.ps1`, Windows);
 * every GIF on a page of its own; "peak" = the highest sample while it is made, next to the
 * sample just before "GIF'i indir" (whole tree and the largest process, the renderer). Rows go to `.scratch/gif-eval/app-<tag>.jsonl`.
 * Recordings are named by their ids only; nothing derived from them is kept.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..');
const outDir = join(webRoot, '.scratch', 'gif-eval');
mkdirSync(join(outDir, 'app'), { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const url = args.url ?? 'http://127.0.0.1:3193';
const sizes = (args.sizes ?? 'small,medium,large').split(',');
const secondsList = (args.seconds ?? '4,10').split(',').map(Number);
const only = args.only ? new Set(args.only.split(',')) : null;
const results = join(outDir, `app-${args.tag ?? 'check'}.jsonl`);

const local = args.clips ? JSON.parse(readFileSync(args.clips, 'utf8')) : [];
const clips = [
  ...['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => ({ id, kind: 'yapay', path: join(outDir, 'media', `${id}.mp4`) })),
  ...local.map((c) => ({ kind: 'gercek', ...c })),
].filter((c) => !only || only.has(c.id));

function startSampler(rootPid) {
  const samples = [];
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(webRoot, 'scripts', 'lib', 'process-memory.ps1'), '-RootPid', String(rootPid), '-IntervalMs', '200'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const [at, total, largest] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(total)) samples.push({ at, total, largest });
    }
  });
  return { samples, stop: () => child.kill() };
}

const server = await chromium.launchServer(args.channel ? { channel: args.channel } : {});
const sampler = startSampler(server.process().pid);
const browser = await chromium.connect(server.wsEndpoint());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'tr-TR' });
// The download link road: no save dialog.
await context.addInitScript(() => {
  delete window.showSaveFilePicker;
});

const MB = 1e6;
const peakOf = (list, key) => Math.max(...list.map((s) => s[key]));
for (const clip of clips) {
  for (const seconds of secondsList) {
    for (const size of sizes) {
      // A page of its own for every GIF: the memory it shows is this GIF's, not what the one before left.
      const page = await context.newPage();
      try {
        await page.goto(`${url}/`);
        await page.getByTestId('task-gif').click();
        await page.getByTestId('video-input').setInputFiles(clip.path);
        await page.getByTestId('wizard').and(page.locator('[data-step="choose"]')).waitFor({ timeout: 120_000 });
        const est = page.getByTestId('gif-estimate');
        if (seconds >= 10) {
          await page.getByTestId('gif-range-end').focus();
          await page.keyboard.press('End');
        }
        const range = page.getByTestId('gif-range-window');
        const lengthUs = Number(await range.getAttribute('data-end-us')) - Number(await range.getAttribute('data-start-us'));
        if (seconds >= 10 && lengthUs < 9_900_000) {
          console.log(`${clip.id}: shorter than 10 s, skipped`);
          break;
        }
        const radio = page.getByTestId(`gif-size-${size}`);
        if ((await radio.count()) === 0) {
          console.log(`${clip.id} ${seconds}s ${size}: not offered`);
          continue;
        }
        const t0 = Date.now();
        await radio.check();
        await page.waitForFunction(
          (wanted) => {
            const e = document.querySelector('[data-testid="gif-estimate"]');
            const checked = document.querySelector('input[name="gif-size"]:checked');
            return e?.getAttribute('data-state') === 'ready' && checked?.getAttribute('value') === wanted;
          },
          size,
          { timeout: 180_000 },
        );
        // The estimate on screen is for the chosen size once it has been measured again for it.
        await page.waitForTimeout(600);
        await est.and(page.locator('[data-state="ready"]')).waitFor({ timeout: 180_000 });
        const estimateMs = Date.now() - t0;
        const estimated = Number(await est.getAttribute('data-bytes'));
        const width = Number(await est.getAttribute('data-width'));
        const height = Number(await est.getAttribute('data-height'));
        const frames = Number(await est.getAttribute('data-frames'));
        const before = sampler.samples.at(-1) ?? { total: NaN, largest: NaN };
        const started = Date.now();
        await page.getByTestId('wizard-download').click();
        await page.getByTestId('export-download').waitFor({ timeout: 600_000 });
        const makeMs = Date.now() - started;
        const during = sampler.samples.filter((s) => s.at >= started - 100);
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
        const file = join(outDir, 'app', `${clip.id}-${seconds}-${size}.gif`);
        await download.saveAs(file);
        const bytes = statSync(file).size;
        rmSync(file, { force: true });
        const row = {
          clip: clip.id, kind: clip.kind, seconds, size, width, height, frames, estimated, bytes, ratio: bytes / estimated, makeMs, estimateMs,
          memBeforeMB: before.total / MB, memPeakMB: peakOf(during, 'total') / MB, rendererBeforeMB: before.largest / MB, rendererPeakMB: peakOf(during, 'largest') / MB,
        };
        appendFileSync(results, `${JSON.stringify(row)}\n`);
        console.log(
          `${clip.id} ${seconds}s ${size} ${width}x${height} ${(bytes / MB).toFixed(2)} MB ×${row.ratio.toFixed(3)} make ${(makeMs / 1000).toFixed(1)} s est ${(estimateMs / 1000).toFixed(1)} s ` +
            `browser ${row.memBeforeMB.toFixed(0)} → ${row.memPeakMB.toFixed(0)} MB, renderer ${row.rendererBeforeMB.toFixed(0)} → ${row.rendererPeakMB.toFixed(0)} MB`,
        );
      } catch (error) {
        console.error(`${clip.id} ${seconds}s ${size}: ${String(error).slice(0, 300)}`);
      } finally {
        await page.close();
      }
    }
  }
}
sampler.stop();
await browser.close();
await server.close();
