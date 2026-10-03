/**
 * The spike page on the founder's phone (Chrome on Android over adb + CDP).
 *
 *   set NODE_PATH=<this folder>\node_modules      (cdp-own-tabs needs playwright-core)
 *   node run-phone.mjs --models=base,moonshine-base --devices=webgpu,wasm --clips=en-02,neg-01,neg-08,pause-01
 *
 * Etiquette (web/scripts/android/phone-run.mjs header): one tab that this
 * script opens through the own-tabs proxy and nothing else — the phone's
 * other tabs are never listed or touched, the browser is never closed, no
 * setting is changed. The page and the model files are served from this
 * computer through `adb reverse`; at the end the site data created on the
 * phone (Cache Storage with the model files) is deleted, the tab is closed
 * and both adb mappings are removed. Holds the machine-wide measure lock.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { ownTabsEndpoint } from '../../scripts/android/cdp-own-tabs.mjs';
import { MODELS, VAD_MODEL, dtypesFor, onnxFilesFor } from './models.mjs';
import { wordErrors } from './metrics.mjs';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const outDir = join(webRoot, 'spike-results');
const PORT = 3103;
const CDP = 9222;
const LOCK = process.env.MEASURE_LOCK ?? 'E:\\capcut_better\\.claude\\measure-lock';
const SERIAL = process.env.ANDROID_SERIAL ?? 'RFCW20W2WFX';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const list = (name, fallback) => argValue(name, fallback).split(',').filter(Boolean);
const modelKeys = list('models', 'base');
const devices = list('devices', 'webgpu,wasm');
const only = list('clips', 'en-02,neg-01,neg-08,pause-01');
const tag = argValue('tag', '2026-10-03');
const timeoutMs = Number(argValue('timeout', String(20 * 60 * 1000)));

const adb = (...a) => spawnSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8' });

function loadClips() {
  const en = JSON.parse(readFileSync(join(speechDir, 'manifest-en.json'), 'utf8')).clips;
  const september = JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8')).clips.map((c) => ({ ...c, file: `clips/${c.file}`, kind: c.kind === 'negative' ? 'negative' : 'speech' }));
  const all = new Map([...september, ...en].map((c) => [c.id, c]));
  return only.map((id) => all.get(id)).filter(Boolean);
}

async function acquireLock(owner) {
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'owner.txt'), `${owner}\npid ${process.pid}\n${new Date().toISOString()}\n`);
      return () => rmSync(LOCK, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log('measure lock held; retrying in 60 s');
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

const withTimeout = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: timed out after ${ms} ms`)), ms))]);

const state = adb('get-state');
if (state.stdout.trim() !== 'device') {
  console.log(`phone not reachable (${(state.stdout + state.stderr).trim()}); skipped`);
  process.exit(2);
}
const clips = loadClips();
const release = await acquireLock(`asr spike run-phone ${modelKeys.join(',')}`);
const server = await startServer(PORT);
adb('forward', `tcp:${CDP}`, 'localabstract:chrome_devtools_remote');
adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);

const out = { tag, startedAt: new Date().toISOString(), device: { model: adb('shell', 'getprop', 'ro.product.model').stdout.trim(), android: adb('shell', 'getprop', 'ro.build.version.release').stdout.trim() }, runs: [] };
const save = () => writeFileSync(join(outDir, `asr-${tag}-phone.json`), JSON.stringify(out, null, 1));
let browser;
let page;
try {
  const endpoint = await ownTabsEndpoint(`http://127.0.0.1:${CDP}`);
  browser = await chromium.connectOverCDP(endpoint, { timeout: 120_000 });
  out.browserVersion = browser.version();
  const context = browser.contexts()[0];
  page = await context.newPage();
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
  });
  const open = async () => {
    await page.goto(`http://localhost:${PORT}/index.html?worker=1`, { timeout: 60_000 });
    await page.waitForFunction(() => window.asr, null, { timeout: 30_000 });
  };
  await open();
  out.env = await page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    crossOriginIsolated: window.asr.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
    gpu: await window.asr.gpuInfo(),
  }));
  console.log(JSON.stringify(out.env));
  save();
  const memory = () =>
    page
      .evaluate(async () => {
        if (!performance.measureUserAgentSpecificMemory) return null;
        const m = await performance.measureUserAgentSpecificMemory();
        return Math.round(m.bytes / 1048576);
      })
      .catch(() => null);

  for (const device of devices) {
    for (const key of modelKeys) {
      const model = MODELS[key];
      const dtype = dtypesFor(key, device);
      if (!dtype) continue;
      if (device === 'webgpu' && !out.env.gpu.available) {
        out.runs.push({ model: key, device, skipped: out.env.gpu.reason });
        continue;
      }
      const run = { model: key, device, dtype, files: onnxFilesFor(dtype), clips: [] };
      out.runs.push(run);
      const loadArgs = { model: model.id, revision: model.revision, device, dtype };
      try {
        if (crashed) {
          crashed = false;
          await open();
        }
        await page.evaluate(async () => {
          await window.asr.clearCache();
          window.asr.restart();
        });
        // Cold here includes pulling the files over USB (adb reverse), not a network download.
        const cold = await withTimeout(page.evaluate((a) => window.asr.load(a), loadArgs), timeoutMs, 'cold load');
        await page.evaluate(async () => {
          await window.asr.dispose();
          window.asr.restart();
        });
        const warm = await withTimeout(page.evaluate((a) => window.asr.load(a), loadArgs), timeoutMs, 'warm load');
        await page.evaluate((a) => window.asr.loadVad(a), { model: VAD_MODEL.id, revision: VAD_MODEL.revision });
        run.load = { coldMs: Math.round(cold.loadMs), warmMs: Math.round(warm.loadMs), bytes: cold.files.reduce((s, f) => s + f.bytes, 0) };
        run.memoryAfterLoadMib = await memory();
        console.log(`${key}/${device}: cold ${(cold.loadMs / 1000).toFixed(1)} s (over USB), warm ${(warm.loadMs / 1000).toFixed(1)} s, page memory ${run.memoryAfterLoadMib} MiB`);
        for (const clip of clips) {
          const r = await withTimeout(page.evaluate((a) => window.asr.transcribe(a), { url: `http://localhost:${PORT}/speech/${clip.file}`, language: clip.lang, wordTimestamps: true, pre: 'silero', probe: false }), timeoutMs, clip.id);
          const row = { id: clip.id, kind: clip.kind, audioS: r.audioS, ms: Math.round(r.ms), rtf: Number(r.rtf.toFixed(3)), vadMs: Math.round(r.vadMs), hyp: r.text, chunks: r.chunks.length, spans: r.spans };
          if (clip.kind !== 'negative') {
            const w = wordErrors(clip.reference.raw, r.text, clip.lang);
            row.wer = Number((w.errors / w.refWords).toFixed(4));
          }
          run.clips.push(row);
          console.log(`   ${clip.id.padEnd(10)} ${r.rtf.toFixed(3)}x ${clip.kind === 'negative' ? (r.text.trim() ? `INVENTED "${r.text}"` : 'empty') : `WER ${(row.wer * 100).toFixed(1)}%`}`);
          save();
        }
        run.memoryAfterRunMib = await memory();
        await page.evaluate(() => window.asr.dispose()).catch(() => undefined);
      } catch (error) {
        run.error = error.message.split('\n')[0];
        run.tabCrashed = crashed;
        console.log(`${key}/${device}: FAILED ${run.error}${crashed ? ' (tab crashed)' : ''}`);
        if (!crashed) await page.evaluate(() => window.asr.restart()).catch(() => undefined);
      }
      save();
    }
  }
} catch (error) {
  out.error = error.message;
  console.log(`phone run failed: ${error.message.split('\n')[0]}`);
} finally {
  // Leave nothing behind: the model files in Cache Storage, the tab, the adb mappings.
  try {
    if (browser) {
      // A crashed tab cannot clean up after itself: a fresh one on the same origin does it.
      const dead = !page || page.isClosed() || (await page.evaluate(() => 1).catch(() => 0)) !== 1;
      if (dead) {
        await page?.close().catch(() => undefined);
        page = await browser.contexts()[0].newPage();
        await page.goto(`http://localhost:${PORT}/index.html?worker=1`, { timeout: 60_000 });
      }
      out.cleanup = await page
        .evaluate(async () => {
          const names = await caches.keys();
          for (const n of names) await caches.delete(n);
          const estimate = await navigator.storage.estimate();
          return { cachesDeleted: names, usageAfterBytes: estimate.usage ?? null };
        })
        .catch((e) => ({ error: e.message }));
      await page.close().catch(() => undefined);
    }
  } finally {
    adb('reverse', '--remove', `tcp:${PORT}`);
    adb('forward', '--remove', `tcp:${CDP}`);
    out.finishedAt = new Date().toISOString();
    save();
    release();
    server.closeAllConnections();
    server.close();
  }
}
console.log(`cleanup: ${JSON.stringify(out.cleanup)}`);
process.exit(0);
