/**
 * What does making a GIF cost in memory? (ADR-046, memory addendum of 21 October 2026.)
 *
 * Makes real GIFs in the app (`/yap/gif`, the user's own button) and, while
 * each one is made, reads
 *
 * - the GIF worker's own JavaScript memory over CDP (`Runtime.getHeapUsage`:
 *   V8 heap in use + `backingStorageSize`, the ArrayBuffer contents that live
 *   outside the heap — where the frames are) every 100 ms; a reading cannot be
 *   answered while the worker runs synchronous code, so a peak inside one long
 *   loop can be missed (the OS reading below cannot);
 * - the private bytes of the renderer that hosts the page and its workers,
 *   and of the GPU process (where the video decoder's frames may live), from
 *   the operating system every 200 ms (`scripts/lib/process-memory.ps1`).
 *
 * `performance.measureUserAgentSpecificMemory()` would be the web's own way,
 * but it exists only in a cross-origin-isolated page, and this app is not one.
 *
 * Each row also has the time from the press to the finished GIF, the moment
 * the screen turned from "Kareler hazırlanıyor" to "GIF yazılıyor", and the
 * SHA-256 of the GIF itself — so two builds can be shown to write the same
 * bytes (`--compare=<earlier .jsonl>`).
 *
 * Windows only (the OS sampler is PowerShell). A test-hook build must be
 * served (CLIP_TEST_HOOKS=1 npm run build; npx next start -p <port>); take the
 * measure lock first. Sources are synthetic (ffmpeg lavfi), generated into
 * `web/.scratch/gif-mem/` (gitignored); no recording of anyone is used.
 *
 *   node scripts/measure-gif-memory.mjs --url=http://127.0.0.1:3194 --label=before
 *   node scripts/measure-gif-memory.mjs --url=… --label=after --compare=.scratch/gif-mem/before.jsonl
 *   options: --sources=desen,gurultulu --sizes=small,medium,large --seconds=4,10 --repeat=1
 *            --budget=<MiB>  the frames budget instead of the device's (0: always two passes)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { connectToPage } from './lib/cdp-heap.mjs';
import { removeSavePicker } from './lib/kesit-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, '.scratch', 'gif-mem');
const sampler = join(root, 'scripts', 'lib', 'process-memory.ps1');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const baseURL = args.url ?? 'http://127.0.0.1:3194';
const label = args.label ?? 'current';
const sources = (args.sources ?? 'desen,gurultulu').split(',');
const sizes = (args.sizes ?? 'small,medium,large').split(',');
const secondsList = (args.seconds ?? '4,10').split(',').map(Number);
const repeat = Number(args.repeat ?? '1');
const MIB = 1048576;
const heldBudget = args.budget === undefined ? null : Number(args.budget) * MIB;
const debuggingPort = 9400 + Math.floor(Math.random() * 400);

if (typeof globalThis.WebSocket !== 'function') {
  const child = spawnSync(process.execPath, ['--experimental-websocket', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
if (process.platform !== 'win32') {
  console.error('Windows only (the OS sampler is PowerShell).');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

/** The ADR-046 synthetic sources: 1280 × 720, 30 fps, 12 s (a 10 s part fits; the default part is the first 4 s). */
const RECIPES = {
  desen: ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-vf', 'format=yuv420p'],
  gurultulu: ['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30', '-vf', 'noise=alls=20:allf=t,format=yuv420p'],
};
function source(name) {
  const file = join(outDir, `${name}.mp4`);
  if (!existsSync(file)) {
    const recipe = RECIPES[name];
    if (!recipe) throw new Error(`unknown source ${name}`);
    const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...recipe, '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-an', file]);
    if (made.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  }
  return file;
}

function startSampler(rootPid) {
  const samples = [];
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sampler, '-RootPid', String(rootPid), '-IntervalMs', '200'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      const at = Number(fields[0]);
      const byType = {};
      for (const part of (fields[4] ?? '').split(',')) {
        const cut = part.lastIndexOf(':');
        if (cut > 0) byType[part.slice(0, cut)] = Number(part.slice(cut + 1));
      }
      if (Number.isFinite(at)) samples.push({ at, renderer: byType['renderer-max'] ?? 0, gpu: byType['gpu-process'] ?? 0 });
    }
  });
  return { samples, stop: () => child.kill() };
}

function findBrowserPid(userDataDir) {
  const needle = userDataDir.replace(/'/g, "''");
  const script =
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and ` +
    `$_.CommandLine -notlike '*--type=*' } | Select-Object -First 1 -ExpandProperty ProcessId`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const pid = Number((result.stdout || '').trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

const earlier = args.compare
  ? new Map(
      readFileSync(args.compare, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((row) => [`${row.source}/${row.size}/${row.seconds}`, row]),
    )
  : null;

const profileDir = mkdtempSync(join(tmpdir(), 'clip-gif-mem-'));
const context = await chromium.launchPersistentContext(profileDir, {
  args: [`--remote-debugging-port=${debuggingPort}`],
  viewport: { width: 1440, height: 900 },
  locale: 'tr-TR',
  acceptDownloads: true,
});
const browserPid = findBrowserPid(profileDir);
if (!browserPid) throw new Error('browser process not found');
const outFile = join(outDir, `${label}.jsonl`);
const mib = (bytes) => Number((bytes / MIB).toFixed(1));

try {
  for (let r = 0; r < repeat; r += 1) {
    for (const name of sources) {
      const file = source(name);
      for (const seconds of secondsList) {
        for (const size of sizes) {
          const page = await context.newPage();
          await removeSavePicker(page);
          await page.goto(`${baseURL}/yap/gif/`);
          const cdp = await connectToPage(debuggingPort, '/yap/gif');
          await page.getByTestId('video-input').setInputFiles(file);
          const estimate = page.getByTestId('gif-estimate');
          await estimate.and(page.locator('[data-state="ready"]')).waitFor({ timeout: 120_000 });
          if (seconds === 10) {
            await page.getByTestId('gif-range-end').focus();
            await page.keyboard.press('End');
          }
          await page.getByTestId(`gif-size-${size}`).check();
          await page.waitForFunction(
            (s) => {
              const e = document.querySelector('[data-testid="gif-estimate"]');
              return e?.getAttribute('data-state') === 'ready' && e.textContent?.startsWith(`${s},0 sn`);
            },
            seconds,
            { timeout: 120_000 },
          );
          const width = await estimate.getAttribute('data-width');
          const height = await estimate.getAttribute('data-height');
          // Let the estimate's worker go quiet and memory settle.
          await page.waitForTimeout(2500);
          await page.evaluate((held) => {
            const w = window;
            // `--budget=<MiB>`: the frames budget of the GIF made (test builds only; 0 = always two passes).
            if (held !== null) w.__clipGifHeldFramesBytes = held;
            w.__gifEncodingAt = null;
            w.__gifPasses = null;
            new MutationObserver(() => {
              if (w.__gifEncodingAt === null && /GIF yazılıyor/.test(document.body.textContent ?? "")) w.__gifEncodingAt = performance.now();
              const card = document.querySelector("[data-testid=\"download-running\"]");
              if (card && Number(card.getAttribute("data-total")) > 0) w.__gifPasses = Number(card.getAttribute("data-passes"));
            }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
          }, heldBudget);

          const sampling = startSampler(browserPid);
          const until = Date.now() + 20_000;
          while (sampling.samples.length < 4 && Date.now() < until) await page.waitForTimeout(100);
          const base = sampling.samples.slice(-3);
          const baseRenderer = Math.max(...base.map((s) => s.renderer));
          const baseGpu = Math.max(...base.map((s) => s.gpu));

          // Every worker of the page now: the make lane's worker is the one that appears after the press.
          const before = new Set(cdp.workerSessions.keys());
          const workerPeaks = new Map();
          let running = true;
          const poll = (async () => {
            while (running) {
              for (const [session, title] of cdp.workerSessions) {
                if (!String(title).startsWith('clip-gif')) continue;
                try {
                  const usage = await cdp.heapUsage(session, false);
                  const total = (usage.usedSize ?? 0) + (usage.backingStorageSize ?? 0);
                  const peak = workerPeaks.get(session) ?? { total: 0, used: 0, backing: 0, fresh: !before.has(session) };
                  if (total > peak.total) Object.assign(peak, { total, used: usage.usedSize ?? 0, backing: usage.backingStorageSize ?? 0 });
                  workerPeaks.set(session, peak);
                } catch {
                  // The worker went away (terminated after the job): its last peak stays.
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          })();

          const t0 = await page.evaluate(() => performance.now());
          await page.getByTestId('wizard-download').click();
          const link = page.getByTestId('export-download');
          await link.waitFor({ timeout: 300_000 });
          const t1 = await page.evaluate(() => performance.now());
          const encodingAt = await page.evaluate(() => window.__gifEncodingAt);
          const passes = await page.evaluate(() => window.__gifPasses);
          await page.waitForTimeout(600);
          running = false;
          await poll;
          sampling.stop();
          const during = sampling.samples.filter((s) => s.at >= Date.now() - (t1 - t0) - 1500);
          const peakRenderer = Math.max(...during.map((s) => s.renderer));
          const peakGpu = Math.max(...during.map((s) => s.gpu));

          const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
          const saved = join(outDir, `${label}-${name}-${size}-${seconds}.gif`);
          await download.saveAs(saved);
          const bytes = readFileSync(saved);
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          rmSync(saved);
          // The worker that made the GIF: the one started by the press (the make lane's own worker); the
          // estimate's worker was there before it.
          const peaks = [...workerPeaks.values()];
          const worker = peaks.find((p) => p.fresh) ?? null;
          const estimateWorker = peaks.find((p) => !p.fresh) ?? null;
          const row = {
            label,
            source: name,
            size,
            seconds,
            width: Number(width),
            height: Number(height),
            bytes: bytes.length,
            sha256,
            passes,
            ms: Math.round(t1 - t0),
            framesMs: encodingAt ? Math.round(encodingAt - t0) : null,
            workerPeakMib: worker ? mib(worker.total) : null,
            workerBackingMib: worker ? mib(worker.backing) : null,
            estimateWorkerPeakMib: estimateWorker ? mib(estimateWorker.total) : null,
            rendererBaseMib: mib(baseRenderer),
            rendererPeakDeltaMib: mib(peakRenderer - baseRenderer),
            gpuPeakDeltaMib: mib(peakGpu - baseGpu),
          };
          const same = earlier?.get(`${name}/${size}/${seconds}`);
          if (same) row.sameBytesAs = same.sha256 === sha256 ? same.label : `DIFFERENT from ${same.label}`;
          appendFileSync(outFile, `${JSON.stringify(row)}\n`);
          console.log(
            `${name} ${size} ${seconds}s ${width}×${height} (${row.passes} pass): ${(bytes.length / 1e6).toFixed(2)} MB, ${row.ms} ms (frames ${row.framesMs} ms), ` +
              `worker ${row.workerPeakMib} MiB (buffers ${row.workerBackingMib}; estimate worker ${row.estimateWorkerPeakMib}), renderer +${row.rendererPeakDeltaMib} MiB, gpu +${row.gpuPeakDeltaMib} MiB` +
              (row.sameBytesAs ? ` · bytes: ${row.sameBytesAs}` : ''),
          );
          cdp.close();
          await page.close();
        }
      }
    }
  }
} finally {
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
}
