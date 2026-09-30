/**
 * Runs the kesit flow on a REAL Android phone's Chrome over adb + CDP and
 * verifies every saved file on this computer with ffprobe.
 *
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node scripts/android/phone-run.mjs [--url=https://erenulutas0.github.io/capcut/editor/] [--only=A,B]
 *     [--media=<dir holding real/ and android/>] [--profile]
 *
 * A local build instead of the live site (e.g. to try a fix on the phone):
 *   npm run build && npx next start -p 3100
 *   adb reverse tcp:3100 tcp:3100
 *   node scripts/android/phone-run.mjs --url=http://localhost:3100/editor/
 * `localhost` is a secure context on the phone too, so WebCodecs and OPFS
 * work; remove the mapping afterwards with `adb reverse --remove tcp:3100`.
 *
 * `--desktop=chrome|msedge|chromium` runs the same cases in a desktop browser
 * launched here instead of the phone, for a side-by-side comparison.
 *
 * `--profile` switches on the export stage clock (ADR-028) and records the
 * worker's console and its phase events (never the file bytes) in the row.
 *
 * The phone's own browser is only driven in one new tab: the script never
 * closes the browser, never touches other tabs, and at the end deletes the
 * files it saved and the site's storage it created. The OS save dialog cannot
 * be driven over CDP, so a stand-in picker (same as the matrix) hands out an
 * OPFS file; the app's code path is the real one. Videos are sent as bytes
 * (Playwright's limit is 50 MB per file), never read from the phone.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { installSavePicker, lastPickedName, readPickedFile, setQuality } from '../lib/kesit-flow.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const url = arg('url', 'https://erenulutas0.github.io/capcut/editor/');
const only = arg('only', '')
  .split(',')
  .filter(Boolean);
const web = resolve(import.meta.dirname, '..', '..');
// The media are gitignored; a worktree can point at the main checkout's copy.
const media = resolve(arg('media', join(web, 'tests', 'media')));
const real = join(media, 'real');
const android = join(media, 'android');
const profile = process.argv.includes('--profile');
const desktop = arg('desktop', '');
const outDir = join(web, 'matrix-results', desktop ? `android-compare-${desktop}` : 'android');
mkdirSync(outDir, { recursive: true });

/** id, file, kesitler (seconds), options, what we expect. */
const CASES = [
  { id: 'A', file: join(real, 'add1.mp4'), kesits: [[2, 10]], expect: 'fast cut (1080x1920 30 fps H.264)' },
  { id: 'B', file: join(real, 'web-samsung-s21-h264-60fps-rot90.mp4'), kesits: [[0.5, 4]], expect: 'encode: 60 fps' },
  { id: 'C', file: join(real, 'web-samsung-hevc-slowmo-sef-rot90.mp4'), kesits: [[1, 8]], expect: 'encode: HEVC source' },
  { id: 'D', file: join(real, 'web-iphone12pro-hevc-hlg-dv-rot90.mov'), kesits: [[2, 10]], expect: 'encode: HDR HLG → SDR' },
  { id: 'E', file: join(android, 'portrait-3min-1080x1920.mp4'), kesits: [], expect: 'whole 3 min, fast path' },
  { id: 'F', file: join(android, 'portrait-3min-1080x1920.mp4'), kesits: [], mode: 'encode', expect: 'whole 3 min, forced full encode' },
  { id: 'G', file: join(android, 'portrait-3min-1080x1920.mp4'), kesits: [[10, 40], [100, 130]], expect: 'two kesitler joined' },
  // ADR-032: the Samsung recordings over more ranges (whole file, short, joined).
  { id: 'H', file: join(real, 'web-samsung-s21-h264-60fps-rot90.mp4'), kesits: [], expect: 'encode: 60 fps, whole file' },
  { id: 'I', file: join(real, 'web-samsung-s21-h264-60fps-rot90.mp4'), kesits: [[1.2, 2.9]], expect: 'encode: 60 fps, 1.7 s' },
  { id: 'J', file: join(real, 'web-samsung-s21-h264-60fps-rot90.mp4'), kesits: [[0.2, 1.5], [2, 4.3]], expect: 'encode: 60 fps, two kesitler' },
  { id: 'K', file: join(real, 'web-samsung-hevc-slowmo-sef-rot90.mp4'), kesits: [], expect: 'encode: HEVC slow motion, whole file' },
  { id: 'L', file: join(real, 'web-samsung-hevc-slowmo-sef-rot90.mp4'), kesits: [[2.5, 5.1]], expect: 'encode: HEVC slow motion, 2.6 s' },
  { id: 'M', file: join(real, 'web-samsung-hevc-slowmo-sef-rot90.mp4'), kesits: [[0, 3], [8, 11.5]], expect: 'encode: HEVC slow motion, two kesitler' },
];

function probe(file) {
  const out = spawnSync(
    'ffprobe',
    ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_packets:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const json = JSON.parse(out.stdout || '{}');
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  return {
    durationS: Number(json.format?.duration ?? NaN),
    video: video ? `${video.codec_name} ${video.width}x${video.height} ${video.avg_frame_rate} (${video.nb_read_packets} frames)` : null,
    audio: audio ? audio.codec_name : null,
  };
}

/** Mono 48 kHz PCM of `seconds` from `startS`, as a player decodes it (edit lists applied). */
function pcm48(file, startS, seconds) {
  const out = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(startS), '-t', String(seconds), '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const bytes = out.stdout ?? Buffer.alloc(0);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
}

/**
 * ADR-032: where the export's sound sits against its picture. A 0.25 s window
 * of the source (0.2 s into the first kesit) is looked for in the export's
 * first 1.5 s; positive = the sound is late. null for a silent source.
 */
function audioSync(source, startS, output) {
  const ref = pcm48(source, startS, 1.5);
  const out = pcm48(output, 0, 1.5);
  const from = 9600;
  const length = 12000;
  const window = ref.subarray(from, from + length);
  let energy = 0;
  for (const v of window) energy += v * v;
  if (window.length < length || Math.sqrt(energy / length) < 1e-4) return null;
  let best = { lagFrames: 0, correlation: -1 };
  for (let lag = -4096; lag <= 4096; lag += 1) {
    let dot = 0;
    let outEnergy = 0;
    for (let i = 0; i < length; i += 1) {
      const v = out[from + lag + i] ?? 0;
      dot += window[i] * v;
      outEnergy += v * v;
    }
    const correlation = outEnergy > 0 ? dot / Math.sqrt(energy * outEnergy) : 0;
    if (correlation > best.correlation) best = { lagFrames: lag, correlation };
  }
  return { lagMs: Number(((best.lagFrames / 48000) * 1000).toFixed(2)), correlation: Number(best.correlation.toFixed(4)) };
}

/**
 * Sends a local video into the page in 4 MiB pieces and builds a File there.
 * One big protocol message (setInputFiles with a buffer) stalls over adb for
 * files above ~30 MB. The File lives in memory, not on disk like a picked one.
 */
async function sendFile(page, file) {
  const bytes = readFileSync(file);
  const chunk = 4 * 1024 * 1024;
  await page.evaluate(() => {
    window.__phoneParts = [];
  });
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    await page.evaluate((base64) => {
      const text = atob(base64);
      const part = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) part[i] = text.charCodeAt(i);
      window.__phoneParts.push(part);
    }, bytes.subarray(offset, offset + chunk).toString('base64'));
  }
  await page.evaluate(
    ({ name }) => {
      window.__phoneFile = new File(window.__phoneParts, name, { type: 'video/mp4' });
      window.__phoneParts = [];
    },
    { name: basename(file) },
  );
}

/**
 * The adb server can be restarted under us (another tool on this computer
 * did, mid-run), which drops every forward. They are set again before each
 * case; `adb` must be on PATH.
 */
function ensurePorts() {
  if (desktop) return;
  spawnSync('adb', ['forward', 'tcp:9222', 'localabstract:chrome_devtools_remote']);
  const local = /^http:\/\/localhost:(\d+)/.exec(url);
  if (local) spawnSync('adb', ['reverse', `tcp:${local[1]}`, `tcp:${local[1]}`]);
}

/**
 * Android freezes a browser that is not on screen: a case started while the
 * phone shows another app (or the home screen) hangs until its timeouts. The
 * script waits (30 minutes at most) until the browser is in front again; it
 * never brings it there itself.
 */
async function waitForBrowserInFront() {
  if (desktop) return;
  const version = await fetch('http://127.0.0.1:9222/json/version')
    .then((response) => response.json())
    .catch(() => null);
  const packageName = version?.['Android-Package'];
  if (!packageName) return;
  for (let waited = 0; ; waited += 30) {
    const top = spawnSync('adb', ['shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' }).stdout ?? '';
    const line = top.split('\n').find((l) => l.includes('topResumedActivity')) ?? '';
    if (line.includes(packageName)) return;
    if (waited >= 30 * 60) throw new Error(`${packageName} not in front for 30 minutes`);
    if (waited % 300 === 0) console.error(`${packageName} is not on screen; waiting`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

/** Connects to the phone's Chrome, waiting (up to 10 minutes) while it is unreachable. */
async function connectPhone() {
  for (let attempt = 1; ; attempt += 1) {
    ensurePorts();
    try {
      return await chromium.connectOverCDP('http://127.0.0.1:9222');
    } catch (error) {
      if (attempt >= 20) throw error;
      console.error(`phone unreachable (${String(error.message).split('\n')[0]}), retrying in 30 s`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
}

let browser = desktop
  ? await chromium.launch({ channel: desktop === 'chromium' ? undefined : desktop })
  : await connectPhone();
let context = desktop ? await browser.newContext() : browser.contexts()[0];
const results = [];

async function clearSiteData(page) {
  await page
    .evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      // ADR-031: the site's service worker and its precache.
      for (const registration of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) {
        await registration.unregister().catch(() => undefined);
      }
      for (const key of (await globalThis.caches?.keys?.()) ?? []) await caches.delete(key).catch(() => undefined);
    })
    .catch(() => undefined);
}

/** After a lost connection: reconnect, and close (and clean) the tab the case had opened. */
async function recoverOrphan(targetId) {
  browser = await connectPhone();
  context = browser.contexts()[0];
  for (const page of context.pages()) {
    const session = await context.newCDPSession(page).catch(() => null);
    if (!session) continue;
    const info = await session.send('Target.getTargetInfo').catch(() => null);
    await session.detach().catch(() => undefined);
    if (info?.targetInfo.targetId !== targetId) continue;
    await clearSiteData(page);
    await page.close().catch(() => undefined);
    return true;
  }
  return false;
}

for (const testCase of CASES) {
  if (only.length > 0 && !only.includes(testCase.id)) continue;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    ensurePorts();
    await waitForBrowserInFront();
    if (!desktop && !browser.isConnected()) {
      browser = await connectPhone();
      context = browser.contexts()[0];
    }
    const { row, targetId } = await runCase(testCase);
    if (!desktop && !browser.isConnected() && String(row.outcome).startsWith('error')) {
      // The phone's connection went away mid-case, not the app: clean up and retry once.
      row.recovered = await recoverOrphan(targetId);
      console.error(`case ${testCase.id}: connection lost (${row.outcome}); orphan tab closed: ${row.recovered}`);
      if (attempt < 2) continue;
    }
    results.push(row);
    console.log(JSON.stringify(row));
    break;
  }
}

async function runCase(testCase) {
  const page = await context.newPage();
  let targetId = null;
  if (!desktop) {
    const session = await context.newCDPSession(page);
    targetId = (await session.send('Target.getTargetInfo')).targetInfo.targetId;
    await session.detach();
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
  });
  await installSavePicker(page);
  const workerLog = [];
  if (profile) {
    await page.addInitScript(() => {
      window.__clipExportProfile = true;
      // Phase events of the export worker, without any file bytes.
      window.__workerEvents = [];
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', (message) => {
            const data = message.data;
            if (data?.type !== 'event' || data.event?.type === 'encoding') return;
            window.__workerEvents.push(
              JSON.parse(
                JSON.stringify(data.event, (_key, value) =>
                  value instanceof Blob || ArrayBuffer.isView(value) ? '[bytes]' : value,
                ),
              ),
            );
          });
        }
      };
    });
    page.on('worker', (worker) => worker.on('console', (message) => workerLog.push(message.text())));
  }
  if (testCase.mode === 'encode') {
    await page.addInitScript(() => {
      window.__clipExportMode = 'encode';
    });
  }
  const row = { id: testCase.id, source: basename(testCase.file), kesits: testCase.kesits, expect: testCase.expect };
  try {
    await page.goto(url, { waitUntil: 'load' });
    // ADR-031: a service worker left from an earlier visit could serve an
    // older build. It is removed and the page loaded again from the network.
    const hadWorker = await page.evaluate(async () => {
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      for (const registration of registrations) await registration.unregister();
      for (const key of (await globalThis.caches?.keys?.()) ?? []) await caches.delete(key);
      return registrations.length > 0;
    });
    if (hadWorker) await page.reload({ waitUntil: 'load' });
    await page.getByTestId('download-all').waitFor({ timeout: 60_000 });
    // Which build ran: the first app chunk's hashed name, and whether a worker served it.
    row.build = await page.evaluate(() => ({
      chunk: [...document.scripts].map((s) => s.src).find((src) => src.includes('/_next/static/chunks/'))?.split('/').pop() ?? null,
      fromServiceWorker: Boolean(navigator.serviceWorker?.controller),
    }));
    const sentAt = Date.now();
    await sendFile(page, testCase.file);
    row.transferS = Number(((Date.now() - sentAt) / 1000).toFixed(1));
    const openedAt = Date.now();
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="video-input"]');
      const transfer = new DataTransfer();
      transfer.items.add(window.__phoneFile);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
    row.openMs = Date.now() - openedAt;
    for (const [a, b] of testCase.kesits) {
      await page.getByTestId('range-start').fill(a.toFixed(3));
      await page.getByTestId('range-end').fill(b.toFixed(3));
      // Typing opened the phone's keyboard over the buttons; close it first.
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(400);
      await page.getByTestId('add-moment').click();
    }
    await setQuality(page, 1080);

    const startedAt = Date.now();
    await page.getByTestId('download-all').click();
    const outcome = await Promise.race([
      page.getByTestId('download-saved').first().waitFor({ timeout: 20 * 60_000 }).then(() => 'saved'),
      page.getByTestId('export-failed').first().waitFor({ timeout: 20 * 60_000 }).then(() => 'failed'),
      page.getByTestId('export-blocked').first().waitFor({ timeout: 20 * 60_000 }).then(() => 'blocked'),
    ]).catch((e) => `timeout: ${e.message.split('\n')[0]}`);
    row.outcome = outcome;
    row.elapsedS = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    if (outcome === 'saved') {
      const method = page.getByTestId('export-method').first();
      row.method = await method.getAttribute('data-method');
      row.fallback = (await method.getAttribute('data-fallback')) || null;
      row.methodText = (await method.textContent())?.trim();
      const name = await lastPickedName(page);
      const local = join(outDir, `${testCase.id}-${name.replace(/^picked-\d+-/, '')}`);
      row.sizeBytes = await readPickedFile(page, name, local);
      row.probe = probe(local);
      if (row.probe.audio) row.audioSync = audioSync(testCase.file, testCase.kesits[0]?.[0] ?? 0, local);
    } else {
      row.message = ((await page.locator('[data-testid="export-failed"], [data-testid="export-blocked"]').first().textContent().catch(() => '')) ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    }
  } catch (error) {
    row.outcome = `error: ${String(error.message ?? error).split('\n')[0]}`;
  }
  row.crashed = crashed;
  row.pageErrors = errors;
  if (profile) {
    row.workerEvents = await page.evaluate(() => window.__workerEvents ?? []).catch(() => []);
    row.workerLog = workerLog;
  }
  // Clean up what this run left on the phone: saved files and site data.
  await clearSiteData(page);
  await page.close().catch(() => undefined);
  return { row, targetId };
}

writeFileSync(join(outDir, `phone-run-${Date.now()}.json`), JSON.stringify({ url, desktop: desktop || null, at: new Date().toISOString(), results }, null, 2));
if (desktop) await browser.close();
// Only disconnect: never close the phone's own browser.
process.exit(0);
