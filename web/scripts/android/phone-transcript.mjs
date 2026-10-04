/**
 * "Yazıya dök" on a REAL Android phone's Chrome over adb + CDP (ADR-036):
 * does Whisper `base` on WebAssembly load and run there, how long does it
 * take, how much memory does the tab take, does the tab survive?
 *
 *   npm run build && npx next start -p 3321          (models in public/models)
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node scripts/android/phone-transcript.mjs [--url=http://localhost:3321/yap/yazi/] [--clips=en-01,neg-06,long-fleurs]
 *
 * The same etiquette as phone-run.mjs: only ONE tab, opened here through the
 * own-tabs proxy (cdp-own-tabs.mjs) — the phone owner's tabs are never
 * listed, read or closed; the browser is never closed, no setting is
 * changed, nothing is installed, no file of the phone is read. The build is
 * served from this computer (`adb reverse`); the videos are sent as bytes.
 * At the end the script deletes everything it created on the phone — the
 * downloaded model cache (109 MB) included — closes its tab and removes the
 * adb mappings.
 *
 * Memory: `dumpsys meminfo` of the browser's processes (total PSS), sampled
 * every 2 s while a clip runs; it is the whole browser, the owner's tabs
 * included, so the figures are "before → peak".
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { ownTabsEndpoint } from './cdp-own-tabs.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const url = arg('url', 'http://localhost:3321/yap/yazi/');
const web = resolve(import.meta.dirname, '..', '..');
const mediaDir = join(web, 'tests', 'media', 'transcript');
const manifest = JSON.parse(readFileSync(join(mediaDir, 'manifest.json'), 'utf8'));
const wanted = arg('clips', 'en-01,neg-06,pause-01,long-fleurs').split(',');
const clips = wanted.map((id) => manifest.clips.find((clip) => clip.id === id)).filter(Boolean);
const outDir = join(web, 'transcript-results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'phone-transcript.json');
const port = /^http:\/\/localhost:(\d+)/.exec(url)?.[1] ?? null;

const adb = (...argv) => spawnSync('adb', argv, { encoding: 'utf8' });
function ensurePorts() {
  adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');
  if (port) adb('reverse', `tcp:${port}`, `tcp:${port}`);
}
function removePorts() {
  adb('forward', '--remove', 'tcp:9222');
  if (port) adb('reverse', '--remove', `tcp:${port}`);
}

const state = (adb('get-state').stdout ?? '').trim();
if (state !== 'device') {
  console.log(`phone-transcript: no authorised phone (adb get-state: "${state || adb('get-state').stderr.trim()}") — NOT RUN`);
  process.exit(2);
}
ensurePorts();
const version = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.json()).catch(() => null);
if (!version) {
  removePorts();
  console.log('phone-transcript: the phone\'s Chrome is not reachable over DevTools (is it open, with USB debugging?) — NOT RUN');
  process.exit(2);
}
const packageName = version['Android-Package'];

/** Total PSS (kB) of the browser's processes: the app as the phone's memory manager sees it. */
function browserPssKb() {
  const out = adb('shell', 'dumpsys', 'meminfo', packageName).stdout ?? '';
  const total = /TOTAL PSS:\s+(\d+)/.exec(out) ?? /TOTAL\s+(\d+)/.exec(out);
  return total ? Number(total[1]) : null;
}

/** Android freezes a browser that is not on screen; wait (never bring it to the front ourselves). */
async function waitInFront() {
  for (let waited = 0; waited < 30 * 60; waited += 30) {
    const top = adb('shell', 'dumpsys', 'activity', 'activities').stdout ?? '';
    const line = top.split('\n').find((l) => l.includes('topResumedActivity')) ?? '';
    if (!packageName || line.includes(packageName)) return true;
    if (waited % 300 === 0) console.error(`${packageName} is not on screen; waiting`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return false;
}

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
  await page.evaluate(({ name }) => {
    const file = new File(window.__phoneParts, name, { type: 'video/mp4' });
    window.__phoneParts = [];
    const input = document.querySelector('[data-testid="video-input"]');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name: basename(file) });
}

async function clearSiteData(page) {
  return page
    .evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      for (const registration of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) await registration.unregister().catch(() => undefined);
      // The app's offline copy AND the model cache (clip-models-*: 109 MB).
      const names = (await globalThis.caches?.keys?.()) ?? [];
      for (const key of names) await caches.delete(key).catch(() => undefined);
      const left = (await globalThis.caches?.keys?.()) ?? [];
      const estimate = await navigator.storage.estimate?.();
      return { deletedCaches: names, cachesLeft: left, usageAfterBytes: estimate?.usage ?? null };
    })
    .catch((error) => ({ error: String(error.message).split('\n')[0] }));
}

const result = {
  startedAt: new Date().toISOString(),
  url,
  phone: {
    model: (adb('shell', 'getprop', 'ro.product.model').stdout ?? '').trim(),
    android: (adb('shell', 'getprop', 'ro.build.version.release').stdout ?? '').trim(),
    browser: version.Browser,
    package: packageName,
  },
  rows: [],
};
const save = () => writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);

if (!(await waitInFront())) {
  removePorts();
  console.log('phone-transcript: the browser was not in front for 30 minutes — NOT RUN');
  process.exit(2);
}
const browser = await chromium.connectOverCDP(await ownTabsEndpoint('http://127.0.0.1:9222'), { timeout: 180_000 });
const context = browser.contexts()[0];
const page = await context.newPage();
await page.addInitScript(() => {
  window.__clipTranscriptRuns = [];
});
let crashed = false;
page.on('crash', () => {
  crashed = true;
});

try {
  for (const clip of clips) {
    const row = { id: clip.id, durationS: clip.durationS };
    try {
      ensurePorts();
      await waitInFront();
      await page.goto(url, { waitUntil: 'load' });
      row.env = await page.evaluate(async () => ({
        crossOriginIsolated: self.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null,
        webgpu: 'gpu' in navigator,
        storageQuotaBytes: (await navigator.storage.estimate?.())?.quota ?? null,
      }));
      await sendFile(page, join(mediaDir, clip.file));
      await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 120_000 });
      row.largeModelOffered = (await page.locator('[data-testid="option-model-turbo"]').count()) > 0;
      if (await page.locator('[data-testid="model-download"]').count()) {
        row.downloadLabel = (await page.locator('[data-testid="model-download"]').innerText()).trim();
        const t0 = Date.now();
        await page.locator('[data-testid="model-download"]').click();
        await page.waitForSelector('[data-testid="transcribe-start"], [data-testid="model-failed"]', { timeout: 1_800_000 });
        row.modelDownloadS = Number(((Date.now() - t0) / 1000).toFixed(1));
        if (await page.locator('[data-testid="model-failed"]').count()) {
          throw new Error(`model download failed: ${await page.locator('[data-testid="model-failed"]').getAttribute('data-reason')}`);
        }
      }
      const before = browserPssKb();
      let peak = before ?? 0;
      const sampler = setInterval(() => {
        const now = browserPssKb();
        if (now && now > peak) peak = now;
      }, 2000);
      const t0 = Date.now();
      await page.locator('[data-testid="transcribe-start"]').click();
      try {
        await page.waitForFunction(
          () => window.__clipTranscriptRuns.length > 0 || document.querySelector('[data-testid="transcribe-failed"]') !== null,
          null,
          { timeout: Math.max(900_000, clip.durationS * 1000 * 6), polling: 1000 },
        );
      } finally {
        clearInterval(sampler);
      }
      row.wallS = Number(((Date.now() - t0) / 1000).toFixed(1));
      row.rtf = Number((row.wallS / clip.durationS).toFixed(3));
      row.memory = { beforePssMiB: before ? Math.round(before / 1024) : null, peakPssMiB: peak ? Math.round(peak / 1024) : null };
      // The run is over; the page now shows either the transcript or why there is none.
      await page.waitForSelector('[data-testid="transcript-panel"], [data-testid="transcribe-failed"]', { timeout: 120_000 });
      const run = await page.evaluate(() => window.__clipTranscriptRuns[0] ?? null);
      row.stats = run?.stats ?? null;
      if (await page.locator('[data-testid="transcribe-failed"]').count()) {
        row.failed = await page.locator('[data-testid="transcribe-failed"]').getAttribute('data-reason');
        row.lines = [];
      } else {
        await page.waitForSelector('[data-testid="transcript-panel"]', { timeout: 60_000 });
        row.lines = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-testid="transcript-row"]')).map((element) => ({
            kind: element.getAttribute('data-kind'),
            text: element.querySelector('.transcript-text')?.textContent ?? '',
          })),
        );
      }
      row.segments = run?.segments ?? null;
      row.tabSurvived = !crashed;
    } catch (error) {
      row.error = String(error?.message ?? error).split('\n')[0].slice(0, 300);
      row.tabSurvived = !crashed;
    }
    result.rows.push(row);
    save();
    const shown = (row.lines ?? []).filter((line) => line.kind === 'cue').map((line) => line.text).join(' ');
    console.log(`phone: ${clip.id} ${row.error ? `ERROR ${row.error}` : row.failed ? `failed:${row.failed}` : `wall ${row.wallS} s rtf ${row.rtf} peak ${row.memory.peakPssMiB} MiB "${shown.slice(0, 80)}"`}`);
    if (crashed) break;
  }
} finally {
  // Leave nothing behind: site data (model cache included), our tab, the adb mappings.
  ensurePorts();
  if (!crashed) {
    await page.goto(url, { waitUntil: 'load' }).catch(() => undefined);
    result.cleanup = await clearSiteData(page);
    await page.close().catch(() => undefined);
  } else {
    // The tab is gone; clean the origin from a fresh one.
    const fresh = await context.newPage().catch(() => null);
    if (fresh) {
      await fresh.goto(url, { waitUntil: 'load' }).catch(() => undefined);
      result.cleanup = await clearSiteData(fresh);
      await fresh.close().catch(() => undefined);
    }
  }
  result.finishedAt = new Date().toISOString();
  save();
  removePorts();
  console.log(`phone-transcript: cleanup ${JSON.stringify(result.cleanup)}; adb mappings removed`);
}
// Only disconnect: never close the phone's own browser.
process.exit(0);
