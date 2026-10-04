/**
 * October 2026 driver: the English long-form / negatives / mixes set
 * (prepare-english.mjs) and the September set, through a speech pre-filter.
 * One results JSON per (browser, device, model, pre-filter[, threads]) in
 * web/spike-results/. The raw hypotheses, word times, speech spans and
 * per-window guard figures are stored; every number in the report is computed
 * from these files by summarize-en.mjs.
 *
 *   node run-en.mjs --models=small-fp16 --devices=webgpu --pre=silero,none --sets=neg,pause
 *   node run-en.mjs --models=base --devices=wasm --threads=4 --sets=long --clips=long-a
 *   node run-en.mjs --models=base --devices=wasm --no-isolation --suffix=-noiso   (no COOP/COEP: one WASM thread, as on GitHub Pages)
 *
 * --pre: none | silero | own | ownabs   (see engine.js and prepare-english.mjs)
 * --sets: neg, pause, mix, long (October) and short, tr (September's clips)
 *
 * Holds the machine-wide measure lock (E:\capcut_better\.claude\measure-lock)
 * while it runs, unless --no-lock.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';

import { MODELS, VAD_MODEL, dtypesFor, onnxFilesFor } from './models.mjs';
import { wordErrors } from './metrics.mjs';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const outDir = join(webRoot, 'spike-results');
const sampler = join(webRoot, 'scripts', 'lib', 'process-memory.ps1');
const PORT = Number(process.env.PORT ?? 3103);
const MIB = 1048576;
const LOCK = process.env.MEASURE_LOCK ?? 'E:\\capcut_better\\.claude\\measure-lock';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const list = (name, fallback) => argValue(name, fallback).split(',').filter(Boolean);
const browsers = list('browsers', 'chromium');
const devices = list('devices', 'webgpu');
const modelKeys = list('models', 'small-fp16');
const pres = list('pre', 'silero');
const sets = list('sets', 'neg,pause,mix,long,short');
const only = list('clips', '');
const threads = Number(argValue('threads', '0')) || null;
const headless = args.includes('--headless');
const probe = !args.includes('--no-probe');
const vadProbs = args.includes('--vad-probs');
// --keep-caches: leave Transformers.js as it is (decoder caches never released) to show what that costs.
const keepCaches = args.includes('--keep-caches');
// --guard=0.6,-1 → drop a window whose no-speech probability is above 0.6 while its mean log-probability is under -1.
// --guard=lp:-0.75 → drop a window whose mean log-probability is under -0.75 (no extra model call).
const guardArg = argValue('guard', '');
// --guard=lp:-0.75,cr:2.4 → the same, and also drop a window whose text zlib shrinks more than 2.4× (a repetition loop).
const guard = !guardArg
  ? null
  : guardArg.startsWith('lp:')
    ? { noSpeech: null, logprob: Number(guardArg.slice(3).split(',')[0]), compression: /cr:([\d.]+)/.test(guardArg) ? Number(/cr:([\d.]+)/.exec(guardArg)[1]) : null }
    : { noSpeech: Number(guardArg.split(',')[0]), logprob: Number(guardArg.split(',')[1]), compression: null };
// --per-span: every speech span is recognised on its own instead of being packed into 30 s windows.
const perSpan = args.includes('--per-span');
const vadParams = argValue('vad', '') ? JSON.parse(argValue('vad', '')) : null;
const wordTimestamps = !args.includes('--no-word-ts');
const tag = argValue('tag', '2026-10-03');
const suffix = argValue('suffix', '');
const timeoutMs = Number(argValue('timeout', String(45 * 60 * 1000)));

/** Both manifests as one clip list. */
function loadClips() {
  const out = [];
  const en = JSON.parse(readFileSync(join(speechDir, 'manifest-en.json'), 'utf8'));
  for (const c of en.clips) out.push(c);
  const september = JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8'));
  for (const c of september.clips) {
    if (c.kind === 'negative') continue; // the three September negatives are neg-01…03 of the October set
    out.push({
      id: c.id,
      set: c.lang === 'en' ? 'short' : 'tr',
      kind: 'speech',
      lang: c.lang,
      file: `clips/${c.file}`,
      durationS: c.durationS,
      reference: { raw: c.reference.raw },
      words: null,
      noise: c.noise ?? null,
      own: null,
    });
  }
  return out.filter((c) => sets.includes(c.set) && (only.length === 0 || only.includes(c.id)));
}

async function acquireLock(owner) {
  if (args.includes('--no-lock')) return () => undefined;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'owner.txt'), `${owner}\npid ${process.pid}\n${new Date().toISOString()}\n`);
      return () => rmSync(LOCK, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let who = '?';
      try {
        who = readFileSync(join(LOCK, 'owner.txt'), 'utf8').split('\n')[0];
      } catch {
        // owner file not written yet
      }
      console.log(`measure lock held by "${who}"; retrying in 60 s`);
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

function startSampler(rootPid) {
  const samples = [];
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sampler, '-RootPid', String(rootPid), '-IntervalMs', '400'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
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

/** Whole-GPU dedicated memory in use (all processes), once a second. */
function startGpuSampler() {
  const samples = [];
  let child;
  try {
    child = spawn('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits', '-lms', '1000'], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return { samples, stop: () => undefined };
  }
  child.on('error', () => undefined);
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const v = Number(line.trim());
      if (line.trim() && Number.isFinite(v)) samples.push({ at: Date.now(), mib: v });
    }
  });
  return { samples, stop: () => child.kill() };
}

/**
 * Whole-machine CPU busy share, every 2 s. Other agents share this computer;
 * a WebGPU run that shows the machine busy far beyond its own one or two
 * cores was not measured alone, and the report says so.
 */
function startCpuSampler() {
  const samples = [];
  const snapshot = () => cpus().reduce((acc, c) => ({ idle: acc.idle + c.times.idle, total: acc.total + c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle }), { idle: 0, total: 0 });
  let last = snapshot();
  const timer = setInterval(() => {
    const now = snapshot();
    const total = now.total - last.total;
    if (total > 0) samples.push({ at: Date.now(), busy: 1 - (now.idle - last.idle) / total });
    last = now;
  }, 2000);
  return { samples, stop: () => clearInterval(timer) };
}
const cpuBetween = (samples, from, to) => {
  const w = samples.filter((s) => s.at >= from && s.at <= to);
  return w.length ? { samples: w.length, meanBusy: Number((w.reduce((a, s) => a + s.busy, 0) / w.length).toFixed(3)), maxBusy: Number(Math.max(...w.map((s) => s.busy)).toFixed(3)) } : null;
};

function peakBetween(samples, from, to) {
  const inWindow = samples.filter((s) => s.at >= from && s.at <= to);
  if (inWindow.length === 0) return null;
  return {
    samples: inWindow.length,
    peakTotalMib: Math.round(Math.max(...inWindow.map((s) => s.total)) / MIB),
    peakLargestProcessMib: Math.round(Math.max(...inWindow.map((s) => s.largest)) / MIB),
  };
}
const gpuBetween = (samples, from, to) => {
  const w = samples.filter((s) => s.at >= from && s.at <= to);
  return w.length ? { samples: w.length, minMib: Math.min(...w.map((s) => s.mib)), peakMib: Math.max(...w.map((s) => s.mib)) } : null;
};

async function launch(name) {
  const type = name === 'firefox' ? firefox : chromium;
  const options =
    name === 'firefox'
      ? { headless, firefoxUserPrefs: { 'dom.webgpu.enabled': true, 'dom.webgpu.workers.enabled': true } }
      : { headless, ...(name === 'chromium' ? {} : { channel: name }), args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=WebGPU'] };
  const server = await type.launchServer(options);
  const browser = await type.connect(server.wsEndpoint());
  return { browser, server, pid: server.process().pid, version: browser.version() };
}

async function evalWithTimeout(page, fn, arg, ms) {
  return Promise.race([page.evaluate(fn, arg), new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);
}

function modelBytes(key, device) {
  const manifest = JSON.parse(readFileSync(join(here, 'models', 'manifest.json'), 'utf8'));
  const entry = manifest.models[key];
  const dtypes = dtypesFor(key, device);
  if (!entry || !dtypes) return null;
  const weights = onnxFilesFor(dtypes).reduce((sum, f) => sum + (entry.files[f]?.bytes ?? 0), 0);
  const configs = Object.entries(entry.files).filter(([f]) => !f.startsWith('onnx/')).reduce((sum, [, v]) => sum + v.bytes, 0);
  return { weightsBytes: weights, configBytes: configs, totalBytes: weights + configs };
}

const clips = loadClips();
if (clips.length === 0) throw new Error('no clips selected');
mkdirSync(outDir, { recursive: true });
// Runs are queued back to back by the matrix scripts: wait a minute before asking for the lock,
// so whoever else is waiting for it (they poll every 60 s) gets a turn between two of our runs.
if (!args.includes('--no-lock') && !args.includes('--no-yield')) await new Promise((r) => setTimeout(r, 65_000));
const release = await acquireLock(`asr spike run-en ${modelKeys.join(',')} ${devices.join(',')}`);
const cleanup = () => {
  release();
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

// How busy the machine is before this run starts anything: other agents share it and do not all take the lock.
const idleProbe = startCpuSampler();
await new Promise((r) => setTimeout(r, 6500));
idleProbe.stop();
const cpuBefore = cpuBetween(idleProbe.samples, 0, Date.now());
console.log(`machine CPU busy before the run: mean ${cpuBefore?.meanBusy}, max ${cpuBefore?.maxBusy}`);
const isolate = !args.includes('--no-isolation');
const server = await startServer(PORT, { isolate });
const audioTotal = clips.reduce((s, c) => s + c.durationS, 0);
console.log(`server on :${PORT}; ${clips.length} clips (${(audioTotal / 60).toFixed(1)} min); browsers=${browsers} devices=${devices} models=${modelKeys} pre=${pres} threads=${threads ?? 'default'}`);

try {
  for (const browserName of browsers) {
    let launched;
    try {
      launched = await launch(browserName);
    } catch (error) {
      console.log(`${browserName}: could not launch (${error.message.split('\n')[0]})`);
      continue;
    }
    const { browser, server: browserServer, version, pid } = launched;
    console.log(`\n${browserName} ${version} (pid ${pid})`);
    const sampling = startSampler(pid);
    const gpuSampling = startGpuSampler();
    const cpuSampling = startCpuSampler();

    for (const device of devices) {
      for (const key of modelKeys) {
        const model = MODELS[key];
        const dtype = dtypesFor(key, device);
        if (!dtype) {
          console.log(`  ${key}: no ${device} configuration`);
          continue;
        }
        // A fresh context per model: nothing of the previous model's memory or cache is left.
        const context = await browser.newContext();
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        page.on('console', (m) => {
          if (m.type() === 'error') pageErrors.push(`[console.error] ${m.text().slice(0, 300)}`);
        });
        await page.goto(`http://127.0.0.1:${PORT}/index.html?worker=1`);
        const env = await page.evaluate(async () => ({
          userAgent: navigator.userAgent,
          crossOriginIsolated: window.asr.crossOriginIsolated,
          hardwareConcurrency: window.asr.hardwareConcurrency,
          gpu: await window.asr.gpuInfo(),
        }));
        if (device === 'webgpu' && !env.gpu.available) {
          console.log(`  ${device}: skipped (${env.gpu.reason})`);
          await context.close();
          continue;
        }
        const loadArgs = { model: model.id, revision: model.revision, device, dtype, threads, keepCaches };
        const base = {
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
          threads,
          suffix,
          isolate,
          cpuBefore,
          keepCaches,
          perSpan,
          guard,
          vadParams,
          probe,
          wordTimestamps,
          env,
        };
        const t0 = Date.now();
        let load;
        try {
          await page.evaluate(async () => {
            await window.asr.clearCache();
            window.asr.restart();
          });
          // Idle until the OS sampler has seen this browser with no model in it (it can take a few seconds to start).
          for (let waited = 0; waited < 20_000 && sampling.samples.filter((x) => x.at >= t0).length < 3; waited += 500) await page.waitForTimeout(500);
          const baseline = { memory: peakBetween(sampling.samples, t0, Date.now()), gpu: gpuBetween(gpuSampling.samples, t0, Date.now()) };
          const coldStart = Date.now();
          const cold = await evalWithTimeout(page, (a) => window.asr.load(a), loadArgs, timeoutMs);
          const coldMem = peakBetween(sampling.samples, coldStart, Date.now());
          await page.evaluate(async () => {
            await window.asr.dispose();
            window.asr.restart();
          });
          const warm = await evalWithTimeout(page, (a) => window.asr.load(a), loadArgs, timeoutMs);
          const vad = await page.evaluate((a) => window.asr.loadVad(a), { model: VAD_MODEL.id, revision: VAD_MODEL.revision });
          load = { baseline, cold: { ms: Math.round(cold.loadMs), files: cold.files, memory: coldMem }, warm: { ms: Math.round(warm.loadMs) }, vadMs: Math.round(vad.loadMs), type: warm.type };
          console.log(`  ${key}/${device}: cold ${(cold.loadMs / 1000).toFixed(1)} s, warm ${(warm.loadMs / 1000).toFixed(1)} s, vad ${Math.round(vad.loadMs)} ms`);
        } catch (error) {
          console.log(`  ${key}/${device}: LOAD FAILED ${error.message.split('\n')[0]}`);
          writeFileSync(join(outDir, `asr-${tag}-${browserName}-${device}-${key}${threads ? `-t${threads}` : ''}${suffix}-load-failed.json`), JSON.stringify({ ...base, error: error.message, pageErrors }, null, 2));
          await context.close();
          continue;
        }

        for (const pre of pres) {
          const result = { ...base, pre, load, startedAt: new Date().toISOString(), clips: [], errors: [] };
          const fileName = `asr-${tag}-${browserName}-${device}-${key}-${pre}${threads ? `-t${threads}` : ''}${suffix}.json`;
          // A finished result is never silently replaced (it happened once: a Turkish run took an English run's name).
          if (existsSync(join(outDir, fileName)) && !args.includes('--overwrite')) {
            let finished = false;
            try {
              finished = JSON.parse(readFileSync(join(outDir, fileName), 'utf8')).complete === true;
            } catch {
              finished = false;
            }
            if (finished) {
              console.log(`    ${fileName} already holds a finished run; skipped (give it a --suffix, or --overwrite)`);
              continue;
            }
          }
          const save = () => writeFileSync(join(outDir, fileName), JSON.stringify(result));
          const runStart = Date.now();
          let wordTs = wordTimestamps;
          for (const clip of clips) {
            const ownSpans = pre === 'own' ? clip.own?.spans : pre === 'ownabs' ? clip.own?.spansAbs : null;
            if ((pre === 'own' || pre === 'ownabs') && !ownSpans) continue;
            const clipArgs = {
              url: `http://127.0.0.1:${PORT}/speech/${clip.file}`,
              language: clip.lang,
              wordTimestamps: wordTs,
              pre: pre === 'own' || pre === 'ownabs' ? 'given' : pre,
              spans: ownSpans,
              probe,
              returnProbs: vadProbs,
              guard,
              vadParams,
              perSpan,
            };
            try {
              let r;
              try {
                r = await evalWithTimeout(page, (a) => window.asr.transcribe(a), clipArgs, timeoutMs);
              } catch (error) {
                if (!wordTs || !/alignment|attention|timestamp/i.test(error.message)) throw error;
                // This export cannot give word times: say so once, carry on with segment times.
                result.errors.push({ clip: clip.id, stage: 'word-timestamps', error: error.message.split('\n')[0] });
                result.wordTimestamps = false;
                wordTs = false;
                r = await evalWithTimeout(page, (a) => window.asr.transcribe(a), { ...clipArgs, wordTimestamps: false }, timeoutMs);
              }
              const row = { id: clip.id, set: clip.set, lang: clip.lang, kind: clip.kind, audioS: r.audioS, ms: Math.round(r.ms), rtf: Number(r.rtf.toFixed(4)), vadMs: Math.round(r.vadMs), probeMs: Math.round(r.probeMs), hyp: r.text, chunks: r.chunks, windows: r.windows, spans: r.spans, longForm: r.longForm ?? null, ...(r.vadProbs ? { vadProbs: r.vadProbs } : {}) };
              result.clips.push(row);
              let shown;
              if (clip.kind === 'negative') shown = r.text.trim() ? `INVENTED "${r.text.slice(0, 60)}"` : 'empty';
              else {
                const w = wordErrors(clip.reference.raw, r.text, clip.lang);
                shown = `WER ${((w.errors / w.refWords) * 100).toFixed(1)}%`;
              }
              console.log(`      ${pre.padEnd(6)} ${clip.id.padEnd(13)} ${r.rtf.toFixed(3)}x ${shown}`);
            } catch (error) {
              result.clips.push({ id: clip.id, set: clip.set, lang: clip.lang, kind: clip.kind, error: error.message.split('\n')[0] });
              result.errors.push({ clip: clip.id, stage: 'transcribe', error: error.message });
              console.log(`      ${pre} ${clip.id}: ERROR ${error.message.split('\n')[0]}`);
              await page.evaluate(() => window.asr.restart());
              await evalWithTimeout(page, (a) => window.asr.load(a), loadArgs, timeoutMs).catch(() => undefined);
              await page.evaluate((a) => window.asr.loadVad(a), { model: VAD_MODEL.id, revision: VAD_MODEL.revision }).catch(() => undefined);
            }
            save();
          }
          result.memory = peakBetween(sampling.samples, runStart, Date.now());
          result.gpu = gpuBetween(gpuSampling.samples, runStart, Date.now());
          result.cpu = cpuBetween(cpuSampling.samples, runStart, Date.now());
          result.pageErrors = pageErrors.splice(0, pageErrors.length).slice(0, 50);
          result.finishedAt = new Date().toISOString();
          result.complete = true;
          save();
          const done = result.clips.filter((c) => !c.error);
          const audio = done.reduce((s, c) => s + c.audioS, 0);
          const ms = done.reduce((s, c) => s + c.ms, 0);
          console.log(`    ${key}/${device}/${pre}: ${done.length} clips, RTF ${(ms / 1000 / audio).toFixed(3)}, peak ${result.memory?.peakTotalMib ?? '?'} MiB (baseline ${load.baseline.memory?.peakTotalMib ?? '?'}), GPU ${result.gpu?.peakMib ?? '?'} MiB (baseline ${load.baseline.gpu?.peakMib ?? '?'}), machine CPU busy mean ${result.cpu?.meanBusy ?? '?'}`);
        }
        await page.evaluate(() => window.asr.dispose()).catch(() => undefined);
        await context.close();
      }
    }
    sampling.stop();
    gpuSampling.stop();
    cpuSampling.stop();
    await browser.close();
    await browserServer.close();
  }
} finally {
  cleanup();
  server.closeAllConnections();
  server.close();
}
console.log('\ndone');
process.exit(0);
