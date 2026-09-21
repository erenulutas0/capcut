/**
 * Drives the spike page in real browsers and writes one results JSON per
 * (browser, device, model) into web/spike-results/.
 *
 *   node run-asr.mjs                                  # everything
 *   node run-asr.mjs --browsers=chrome --devices=webgpu --models=tiny --clips=3
 *   node run-asr.mjs --headless   (WebGPU may then fall back to a software adapter; the run records what it got)
 *
 * Browsers: chromium (Playwright build), chrome, msedge (channels), firefox
 * (Playwright build). Devices: webgpu, wasm. Memory is sampled from the OS with
 * web/scripts/lib/process-memory.ps1 over the whole browser process tree.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';

import { MODELS, dtypesFor, onnxFilesFor } from './models.mjs';
import { aggregate, scoreClip } from './score.mjs';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const outDir = join(webRoot, 'spike-results');
const sampler = join(webRoot, 'scripts', 'lib', 'process-memory.ps1');
const PORT = 3103;
const MIB = 1048576;

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const browsers = argValue('browsers', 'chromium,chrome,msedge,firefox').split(',');
const devices = argValue('devices', 'webgpu,wasm').split(',');
const modelKeys = argValue('models', 'tiny,base,small').split(',');
const clipLimit = Number(argValue('clips', '0'));
const headless = args.includes('--headless');
const useWorker = !args.includes('--no-worker');
const wordTimestamps = !args.includes('--no-word-ts');
const tag = argValue('tag', new Date().toISOString().slice(0, 10));
const transcribeTimeoutMs = Number(argValue('timeout', '600000'));

const manifest = JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8'));
const modelManifest = JSON.parse(readFileSync(join(here, 'models', 'manifest.json'), 'utf8'));
const clips = clipLimit > 0 ? pickSubset(manifest.clips, clipLimit) : manifest.clips;
mkdirSync(outDir, { recursive: true });

/** A small subset still covers every kind and both languages. */
function pickSubset(all, n) {
  const out = [];
  const kinds = ['clean', 'noisy', 'negative'];
  for (const kind of kinds) {
    for (const lang of ['tr', 'en']) {
      const c = all.find((x) => x.kind === kind && x.lang === lang && !out.includes(x));
      if (c) out.push(c);
    }
  }
  for (const c of all) if (out.length < n && !out.includes(c)) out.push(c);
  return out.slice(0, Math.max(n, out.length));
}

function startSampler(rootPid) {
  const samples = [];
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sampler, '-RootPid', String(rootPid), '-IntervalMs', '400'],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const [at, total, largest, count] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(total)) samples.push({ at, total, largest, count });
    }
  });
  return { samples, stop: () => child.kill() };
}

function peakBetween(samples, from, to) {
  const inWindow = samples.filter((s) => s.at >= from && s.at <= to);
  if (inWindow.length === 0) return null;
  return {
    samples: inWindow.length,
    peakTotalMib: Math.round(Math.max(...inWindow.map((s) => s.total)) / MIB),
    peakLargestProcessMib: Math.round(Math.max(...inWindow.map((s) => s.largest)) / MIB),
  };
}

/** launchServer exposes the root process (for the OS memory sampler); connect() drives it. */
async function launch(name) {
  const type = name === 'firefox' ? firefox : chromium;
  const options =
    name === 'firefox'
      ? { headless, firefoxUserPrefs: { 'dom.webgpu.enabled': true, 'dom.webgpu.workers.enabled': true } }
      : {
          headless,
          ...(name === 'chromium' ? {} : { channel: name }),
          args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=WebGPU'],
        };
  const server = await type.launchServer(options);
  const browser = await type.connect(server.wsEndpoint());
  return { browser, server, pid: server.process().pid, version: browser.version() };
}

/** page.evaluate awaits promises; waitForFunction does not, so no polling is needed here. */
async function evalWithTimeout(page, fn, arg, timeoutMs) {
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)),
  ]);
}

function modelBytes(key, device) {
  const entry = modelManifest.models[key];
  const dtypes = dtypesFor(key, device);
  if (!entry || !dtypes) return null;
  const weights = onnxFilesFor(dtypes).reduce((sum, f) => sum + (entry.files[f]?.bytes ?? 0), 0);
  const configs = Object.entries(entry.files)
    .filter(([f]) => !f.startsWith('onnx/'))
    .reduce((sum, [, v]) => sum + v.bytes, 0);
  return { weightsBytes: weights, configBytes: configs, totalBytes: weights + configs };
}

const server = await startServer(PORT);
console.log(`server on :${PORT}; ${clips.length} clips; browsers=${browsers.join(',')} devices=${devices.join(',')} models=${modelKeys.join(',')}`);

for (const browserName of browsers) {
  let launched;
  try {
    launched = await launch(browserName);
  } catch (error) {
    console.log(`\n${browserName}: could not launch (${error.message.split('\n')[0]})`);
    writeFileSync(join(outDir, `asr-${tag}-${browserName}-launch-failed.json`), JSON.stringify({ browser: browserName, error: error.message }, null, 2));
    continue;
  }
  const { browser, server: browserServer, version, pid } = launched;
  console.log(`\n${browserName} ${version} (pid ${pid})`);
  const sampling = pid ? startSampler(pid) : null;

  for (const device of devices) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') pageErrors.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) pageErrors.push(`[http ${r.status()}] ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}`);
    });
    await page.goto(`http://127.0.0.1:${PORT}/index.html?worker=${useWorker ? 1 : 0}`);
    const env = await page.evaluate(async () => ({
      userAgent: navigator.userAgent,
      crossOriginIsolated: window.asr.crossOriginIsolated,
      hardwareConcurrency: window.asr.hardwareConcurrency,
      useWorker: window.asr.useWorker,
      gpu: await window.asr.gpuInfo(),
    }));
    if (device === 'webgpu' && !env.gpu.available) {
      console.log(`  ${device}: skipped (${env.gpu.reason})`);
      writeFileSync(
        join(outDir, `asr-${tag}-${browserName}-${device}-skipped.json`),
        JSON.stringify({ browser: browserName, version, device, skipped: env.gpu.reason, env }, null, 2),
      );
      await context.close();
      continue;
    }
    console.log(`  ${device}: gpu=${env.gpu.available ? `${env.gpu.vendor}/${env.gpu.architecture}/${env.gpu.description ?? ''}` : 'n/a'} isolated=${env.crossOriginIsolated} threads=${env.hardwareConcurrency}`);

    for (const key of modelKeys) {
      const model = MODELS[key];
      const dtype = dtypesFor(key, device);
      if (!dtype) {
        console.log(`    ${key}: no ${device} configuration`);
        continue;
      }
      const loadArgs = { model: model.id, revision: model.revision, device, dtype };
      const result = {
        tag,
        browser: browserName,
        version,
        device,
        model: key,
        modelId: model.id,
        revision: model.revision,
        dtype,
        files: onnxFilesFor(dtype),
        size: modelBytes(key, device),
        useWorker,
        wordTimestamps,
        env,
        startedAt: new Date().toISOString(),
        load: {},
        clips: [],
        errors: [],
      };
      const fileName = `asr-${tag}-${browserName}-${device}-${key}.json`;
      const save = () => writeFileSync(join(outDir, fileName), JSON.stringify(result, null, 2));
      const t0 = Date.now();
      try {
        // Cold: Cache API emptied and a fresh worker. Idle for a moment first so
        // the sampler has a baseline for this browser with no model loaded.
        await page.evaluate(async () => {
          await window.asr.dispose().catch(() => undefined);
          await window.asr.clearCache();
          window.asr.restart();
        });
        await page.waitForTimeout(2000);
        result.memoryBaseline = peakBetween(sampling?.samples ?? [], t0, Date.now());
        const coldStart = Date.now();
        const cold = await evalWithTimeout(page, (a) => window.asr.load(a), loadArgs, transcribeTimeoutMs);
        result.load.cold = { ms: Math.round(cold.loadMs), files: cold.files, memory: peakBetween(sampling?.samples ?? [], coldStart, Date.now()) };
        // Warm: same context (Cache API populated), fresh worker so nothing is reused in memory.
        await page.evaluate(async () => {
          await window.asr.dispose();
          window.asr.restart();
        });
        const warmStart = Date.now();
        const warm = await evalWithTimeout(page, (a) => window.asr.load(a), loadArgs, transcribeTimeoutMs);
        result.load.warm = { ms: Math.round(warm.loadMs), memory: peakBetween(sampling?.samples ?? [], warmStart, Date.now()) };
        console.log(`    ${key}: cold ${(cold.loadMs / 1000).toFixed(1)} s, warm ${(warm.loadMs / 1000).toFixed(1)} s`);
        save();

        const runStart = Date.now();
        for (const clip of clips) {
          const url = `http://127.0.0.1:${PORT}/speech/clips/${clip.file}`;
          const clipArgs = { url, language: clip.lang, wordTimestamps };
          try {
            let r;
            try {
              r = await evalWithTimeout(page, (a) => window.asr.transcribe(a), clipArgs, transcribeTimeoutMs);
            } catch (error) {
              if (!wordTimestamps || !/alignment|attention|timestamp/i.test(error.message)) throw error;
              // Word timestamps unsupported for this export: record it, fall back to segment timestamps.
              result.errors.push({ clip: clip.id, stage: 'word-timestamps', error: error.message.split('\n')[0] });
              r = await evalWithTimeout(page, (a) => window.asr.transcribe(a), { ...clipArgs, wordTimestamps: false }, transcribeTimeoutMs);
            }
            const row = scoreClip(clip, r);
            result.clips.push(row);
            const shown = row.wer !== undefined ? `WER ${(row.wer * 100).toFixed(0)}%` : row.hallucinated ? 'HALLUCINATED' : 'empty';
            console.log(`      ${clip.id.padEnd(9)} ${r.rtf.toFixed(2)}x ${shown}: ${r.text.slice(0, 70)}`);
          } catch (error) {
            result.clips.push({ id: clip.id, lang: clip.lang, kind: clip.kind, error: error.message.split('\n')[0] });
            result.errors.push({ clip: clip.id, stage: 'transcribe', error: error.message });
            console.log(`      ${clip.id}: ERROR ${error.message.split('\n')[0]}`);
            // A hung engine poisons everything after it; restart and reload.
            await page.evaluate(() => window.asr.restart());
            await evalWithTimeout(page, (a) => window.asr.load(a), loadArgs, transcribeTimeoutMs).catch(() => undefined);
          }
          save();
        }
        result.memory = peakBetween(sampling?.samples ?? [], runStart, Date.now());
        result.summary = aggregate(result.clips);
        await page.evaluate(() => window.asr.dispose()).catch(() => undefined);
      } catch (error) {
        result.errors.push({ stage: 'model', error: error.message });
        console.log(`    ${key}: FAILED ${error.message.split('\n')[0]}`);
      }
      result.pageErrors = pageErrors.splice(0, pageErrors.length).slice(0, 50);
      result.notFound = [...new Set(server.notFound.splice(0, server.notFound.length))];
      result.elapsedMs = Date.now() - t0;
      result.finishedAt = new Date().toISOString();
      save();
      if (result.summary) {
        const s = result.summary;
        console.log(
          `    ${key} ${device}: WER tr ${pct(s['clean-tr']?.wer)} en ${pct(s['clean-en']?.wer)} noisy ${pct(s.noisy?.wer)} | RTF ${s.all?.rtf} | neg halluc ${s.negatives.hallucinated}/${s.negatives.clips} | peak ${result.memory?.peakTotalMib ?? '?'} MiB`,
        );
      }
    }
    await context.close();
  }
  sampling?.stop();
  await browser.close();
  await browserServer.close();
}

server.closeAllConnections();
server.close();
console.log('\ndone');
process.exit(0);

function pct(v) {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}
