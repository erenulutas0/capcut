/**
 * Runs "Yazıya dök" in the APP (not the spike harness) on the measurement
 * clips and writes what the shipped code path produced (ADR-036).
 *
 * It drives the real wizard at `/yap/yazi/` of a running build exactly as a
 * person does — pick the video, "Modeli indir" when the model is not in the
 * browser yet, "Yazıya dök" — and reads back:
 *  - the raw speech spans and word times of the run (the page's inert
 *    measurement hook `__clipTranscriptRuns`, filled by the transcript
 *    client when a script defines it before the page loads);
 *  - the lines the panel really shows (the DOM), which is what "invented
 *    text" is judged on;
 *  - every request the page made and every CSP violation;
 *  - the browser process tree's private memory, sampled every 400 ms
 *    (Windows; scripts/lib/process-memory.ps1).
 *
 *   node scripts/transcript/run-app.mjs --base=http://127.0.0.1:3321 --browser=chromium \
 *        --model=base --sets=neg,negh,negv --tag=chromium-base-neg
 *
 * Options: --clips=a,b  --sets=…  --browser=chromium|chrome|msedge|firefox
 *          --model=base|turbo  --path=/yap/yazi/  --headed  --offline-after-model
 * Output: transcript-results/app-<tag>.json (gitignored). A finished clip is
 * never run again for the same tag.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { chromium, firefox } from '@playwright/test';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const base = arg('base', 'http://127.0.0.1:3321').replace(/\/+$/, '');
const browserName = arg('browser', 'chromium');
const model = arg('model', 'base');
const wizardPath = arg('path', '/yap/yazi/');
const tag = arg('tag', `${browserName}-${model}`);
const mediaDir = join(webDir, 'tests', 'media', 'transcript');
const manifest = JSON.parse(readFileSync(join(mediaDir, 'manifest.json'), 'utf8'));
const wantedSets = arg('sets', '').split(',').filter(Boolean);
const wantedClips = arg('clips', '').split(',').filter(Boolean);
const clips = manifest.clips.filter((clip) => wantedClips.includes(clip.id) || wantedSets.includes(clip.set));
if (clips.length === 0) {
  console.error('run-app: no clips selected (--clips= / --sets=)');
  process.exit(1);
}

const outDir = join(webDir, 'transcript-results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `app-${tag}.json`);
const result = existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, 'utf8'))
  : { tag, base, browser: browserName, model, startedAt: new Date().toISOString(), machine: null, rows: [] };
const save = () => writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);

const launchOptions = {
  headless: !flag('headed'),
  ...(browserName === 'chrome' || browserName === 'msedge' ? { channel: browserName } : {}),
  args: browserName === 'firefox' ? [] : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'],
};
const engine = browserName === 'firefox' ? firefox : chromium;
// A browser server, so the process id is known to the memory sampler. The context is a fresh one:
// the model is downloaded through the app's own button at the start of every run of this script.
const server = await engine.launchServer(launchOptions);
const browser = await engine.connect(server.wsEndpoint());
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
result.browserVersion = browser.version();
result.machine = { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemGiB: Math.round(os.totalmem() / 2 ** 30) };

function browserPid() {
  return server.process().pid ?? null;
}

function startMemorySampler(pid) {
  if (!pid || process.platform !== 'win32') return null;
  const samples = [];
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(webDir, 'scripts', 'lib', 'process-memory.ps1'), '-RootPid', String(pid), '-IntervalMs', '400'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const [ms, total, largest] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(total)) samples.push({ ms, total, largest });
    }
  });
  return { samples, stop: () => child.kill() };
}

const cpuTimes = () => os.cpus().reduce((acc, cpu) => ({ idle: acc.idle + cpu.times.idle, total: acc.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });

const page = await context.newPage();
await page.addInitScript(() => {
  window.__clipTranscriptRuns = [];
  window.__clipCsp = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__clipCsp.push(`${event.effectiveDirective} blocked=${event.blockedURI}`);
  });
});
const origin = new URL(base).origin;
const outside = [];
const modelRequests = [];
context.on('request', (request) => {
  const url = request.url();
  if (url.startsWith('blob:') || url.startsWith('data:')) return;
  if (!url.startsWith(origin)) outside.push(url);
  else if (url.includes('/models/')) modelRequests.push(url.slice(origin.length));
});
const consoleCsp = [];
const watchConsole = (source) => source.on('console', (message) => {
  if (/Content Security Policy/i.test(message.text())) consoleCsp.push(message.text().slice(0, 300));
});
watchConsole(page);
page.on('worker', watchConsole);

let modelDownload = null;

for (const clip of clips) {
  if (result.rows.some((row) => row.id === clip.id && !row.error)) {
    console.log(`run-app: ${clip.id} already measured`);
    continue;
  }
  const row = { id: clip.id, set: clip.set, durationS: clip.durationS };
  const started = Date.now();
  try {
    await page.goto(`${base}${wizardPath}`, { waitUntil: 'load' });
    await page.setInputFiles('[data-testid="video-input"]', join(mediaDir, clip.file));
    await page.waitForSelector('[data-testid="transcribe-steps"][data-model-ready]', { timeout: 120_000 });
    if (model === 'turbo') {
      await page.locator('[data-testid="option-model-turbo"]').check({ timeout: 15_000 });
    }
    await page.waitForFunction(
      () => document.querySelector('[data-testid="model-download"]') !== null || document.querySelector('[data-testid="transcribe-start"]') !== null,
      null,
      { timeout: 60_000 },
    );
    if (await page.locator('[data-testid="model-download"]').count()) {
      const label = (await page.locator('[data-testid="model-download"]').innerText()).trim();
      const t0 = Date.now();
      await page.locator('[data-testid="model-download"]').click();
      await page.waitForSelector('[data-testid="transcribe-start"], [data-testid="model-failed"]', { timeout: 1_800_000 });
      const failed = await page.locator('[data-testid="model-failed"]').count();
      modelDownload = { label, ms: Date.now() - t0, failed: failed ? await page.locator('[data-testid="model-failed"]').getAttribute('data-reason') : null };
      if (failed) throw new Error(`model download failed: ${modelDownload.failed}`);
      result.modelDownload = modelDownload;
    }
    if (flag('offline-after-model')) await context.setOffline(true);

    const sampler = startMemorySampler(browserPid());
    for (let waited = 0; sampler && sampler.samples.length === 0 && waited < 8000; waited += 200) await new Promise((r) => setTimeout(r, 200));
    const baseline = sampler?.samples.at(-1)?.total ?? null;
    const cpu0 = cpuTimes();
    const t0 = Date.now();
    await page.locator('[data-testid="transcribe-start"]').click();
    const timeout = Math.max(600_000, clip.durationS * 1000 * 3);
    await page.waitForFunction(
      () => window.__clipTranscriptRuns.length > 0 || document.querySelector('[data-testid="transcribe-failed"]') !== null,
      null,
      { timeout, polling: 500 },
    );
    const wallMs = Date.now() - t0;
    const cpu1 = cpuTimes();
    sampler?.stop();
    const failed = await page.locator('[data-testid="transcribe-failed"]').count();
    // A run that heard nothing still ran: its figures are kept ("nothing_heard" is the UI's word for an empty result).
    const run = await page.evaluate(() => window.__clipTranscriptRuns[0] ?? null);
    if (run) {
      row.stats = run.stats;
      row.segments = run.segments;
    }
    if (failed) {
      row.failed = await page.locator('[data-testid="transcribe-failed"]').getAttribute('data-reason');
      row.lines = [];
    } else {
      // What the user is actually shown: the panel's rows.
      await page.waitForSelector('[data-testid="transcript-panel"]', { timeout: 30_000 });
      row.lines = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="transcript-row"]')).map((element) => ({
          kind: element.getAttribute('data-kind'),
          time: element.querySelector('.transcript-time')?.textContent ?? '',
          text: element.querySelector('.transcript-text')?.textContent ?? '',
        })),
      );
      row.machineNote = await page.locator('[data-testid="transcript-machine-note"]').count();
    }
    row.wallMs = wallMs;
    row.rtf = wallMs / 1000 / clip.durationS;
    row.cpuBusy = 1 - (cpu1.idle - cpu0.idle) / Math.max(1, cpu1.total - cpu0.total);
    if (sampler) {
      row.memory = {
        baselineBytes: baseline,
        peakBytes: sampler.samples.reduce((max, sample) => Math.max(max, sample.total), 0),
        peakLargestProcessBytes: sampler.samples.reduce((max, sample) => Math.max(max, sample.largest), 0),
        samples: sampler.samples.length,
      };
    }
    row.csp = [...(await page.evaluate(() => window.__clipCsp)), ...consoleCsp.splice(0)];
    row.outsideRequests = outside.splice(0);
    row.modelRequests = modelRequests.splice(0).length;
    if (flag('offline-after-model')) await context.setOffline(false);
  } catch (error) {
    row.error = `${error?.message ?? error}`.slice(0, 400);
    await context.setOffline(false).catch(() => undefined);
  }
  row.totalMs = Date.now() - started;
  result.rows = result.rows.filter((existing) => existing.id !== clip.id);
  result.rows.push(row);
  save();
  const shown = (row.lines ?? []).filter((line) => line.kind === 'cue').map((line) => line.text).join(' ');
  console.log(`run-app: ${clip.id} ${row.error ? `ERROR ${row.error}` : row.failed ? `failed:${row.failed}` : `rtf ${row.rtf.toFixed(3)} spans ${row.stats.spans} unclear ${row.stats.unclearSpans} lines ${row.lines.length} "${shown.slice(0, 70)}"`}`);
}

result.finishedAt = new Date().toISOString();
save();
await context.close();
await browser.close();
await server.close();
console.log(`run-app: ${outFile}`);
