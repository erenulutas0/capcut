/**
 * How heavy is the "Yazı" panel with a very long transcript (ADR-036)?
 *
 * Drives the e2e build (`CLIP_TEST_HOOKS=1 npm run build`, `npx next start`)
 * with the scripted stand-in recogniser so that the panel gets `--lines`
 * lines (default 3000, the line limit) without transcribing two hours of
 * speech, then measures the panel in the EDITOR ("Kesitler | Yazı"), at
 * normal speed and with the processor slowed 4× (Chrome DevTools Protocol
 * `Emulation.setCPUThrottlingRate`):
 *
 *  - DOM elements inside the panel;
 *  - time to open the panel: click on the "Yazı" tab → rows on screen and
 *    two frames drawn (median of 5);
 *  - frame times while the list is scrolled top to bottom in 120 steps;
 *  - arrow-key navigation: key press → focus on the next line and a frame;
 *  - click on a line → the frame after the video has been sent there.
 *
 *   node scripts/transcript/panel-perf.mjs --base=http://127.0.0.1:3341 --tag=before
 * Output: transcript-results/panel-perf-<tag>.json
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const base = arg('base', 'http://127.0.0.1:3341').replace(/\/+$/, '');
const lineCount = Number(arg('lines', '3000'));
const tag = arg('tag', 'run');
const viewport = arg('viewport', '1440x900').split('x').map(Number);

// ---- a two-hour video that is all but empty (the stand-in hears nothing anyway)
const mediaDir = join(webDir, 'tests', 'media', 'transcript');
mkdirSync(mediaDir, { recursive: true });
const video = join(mediaDir, 'panel-118min.mp4');
if (!existsSync(video)) {
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=2', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=16000', '-t', '7080', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-g', '20', '-c:a', 'aac', '-b:a', '24k', '-ac', '1', '-movflags', '+faststart', video], { stdio: 'inherit' });
  if (made.status !== 0) throw new Error('ffmpeg could not make the long test video');
}

// ---- the test doubles (as tests/e2e/transcriptKit.ts): a tiny model list this script serves, and scripted segments
const S = 1_000_000;
const fileBytes = (length, seed) => {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
};
const groups = {
  runtime: { dir: 'runtime-test', files: [{ path: 'runtime.wasm', body: fileBytes(40_000, 1) }] },
  vad: { dir: 'vad-test', files: [{ path: 'onnx/model.onnx', body: fileBytes(20_000, 2) }] },
  base: { dir: 'base-test', files: [{ path: 'config.json', body: Buffer.from('{"test":true}') }] },
  turbo: { dir: 'turbo-test', files: [{ path: 'onnx/encoder.onnx', body: fileBytes(9_000, 4) }] },
};
const served = new Map();
const manifest = {
  storeVersion: 1,
  groups: Object.fromEntries(
    Object.entries(groups).map(([id, group]) => [
      id,
      {
        dir: group.dir,
        files: group.files.map((file) => {
          served.set(`${group.dir}/${file.path}`, file.body);
          return { path: file.path, bytes: file.body.length, sha256: createHash('sha256').update(file.body).digest('hex') };
        }),
      },
    ]),
  ),
};
const WORDS = ['the', 'meeting', 'starts', 'with', 'a', 'short', 'look', 'at', 'numbers', 'from', 'last', 'week', 'and', 'what', 'we', 'plan', 'next'];
const segments = [];
for (let k = 0; k < lineCount; k += 1) {
  const startUs = Math.round((2 + k * 2.3) * S);
  if (k % 40 === 17) {
    segments.push({ startUs, endUs: startUs + 2 * S, state: 'unclear', words: [] });
    continue;
  }
  // One line per segment, of varying length (one or two rows in a narrow panel).
  const count = 2 + (k % 4);
  const texts = [`Line`, `${k + 1},`, ...Array.from({ length: count }, (_, i) => WORDS[(k * 7 + i * 3) % WORDS.length])];
  texts[texts.length - 1] += '.';
  segments.push({
    startUs,
    endUs: startUs + 2 * S,
    state: 'ok',
    words: texts.map((text, i) => ({ text, startUs: startUs + Math.round((i * 1.8 * S) / texts.length), endUs: startUs + Math.round(((i + 1) * 1.8 * S) / texts.length) - 20_000 })),
  });
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] } });
await context.route('**/models/**', async (route) => {
  const url = new URL(route.request().url());
  const key = url.pathname.slice(url.pathname.indexOf('/models/') + '/models/'.length);
  const body = served.get(key);
  if (!body) return route.fulfill({ status: 404, body: 'not found' });
  const match = /bytes=(\d+)-(\d+)/.exec(route.request().headers().range ?? '');
  if (match) {
    const start = Number(match[1]);
    const end = Math.min(body.length - 1, Number(match[2]));
    return route.fulfill({ status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes' }, body: body.subarray(start, end + 1) });
  }
  return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' }, body });
});
const page = await context.newPage();
await page.addInitScript((hook) => {
  window.__clipTranscriptTest = hook;
}, { manifest, stub: { stepMs: 0, segments } });

await page.goto(`${base}/yap/yazi/`, { waitUntil: 'load' });
await page.setInputFiles('[data-testid="video-input"]', video);
await page.waitForSelector('[data-testid="transcribe-steps"][data-test-hooks="1"]', { timeout: 120_000 });
await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
if (await page.locator('[data-testid="model-download"]').count()) await page.locator('[data-testid="model-download"]').click();
await page.locator('[data-testid="transcribe-start"]').click({ timeout: 120_000 });
await page.waitForSelector('[data-testid="transcript-panel"]', { timeout: 600_000 });
const shownCount = await page.locator('[data-testid="transcript-count"]').innerText();
// Into the editor: the same panel, with the tick boxes of "Bunlardan kesit yap".
await page.locator('[data-testid="wizard-open-editor"]').click();
await page.waitForSelector('[data-testid="side-tab-yazi"]', { timeout: 120_000 });

const cdp = await context.newCDPSession(page);

async function measure(rate) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const out = { cpuThrottle: rate };

  // ---- time to open the panel (median of 5)
  const opens = [];
  for (let k = 0; k < 5; k += 1) {
    await page.locator('[data-testid="side-tab-kesit"]').click();
    await page.waitForSelector('[data-testid="transcript-panel"]', { state: 'detached' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    opens.push(
      await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector('[data-testid="side-tab-yazi"]').click();
        while (!document.querySelector('[data-testid="transcript-row"]')) await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }),
    );
  }
  opens.sort((a, b) => a - b);
  out.openMs = { median: opens[2], min: opens[0], max: opens[4] };

  // ---- size
  out.dom = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="transcript-panel"]');
    return { panelElements: panel.querySelectorAll('*').length, rowsInDom: panel.querySelectorAll('[data-testid="transcript-row"]').length, documentElements: document.querySelectorAll('*').length };
  });

  // ---- scrolling top to bottom in 120 steps
  out.scroll = await page.evaluate(async () => {
    const list = document.querySelector('[data-testid="transcript-list"]');
    const frames = [];
    let last = performance.now();
    list.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(r));
    last = performance.now();
    const steps = 120;
    for (let k = 1; k <= steps; k += 1) {
      list.scrollTop = ((list.scrollHeight - list.clientHeight) * k) / steps;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    const at = (p) => frames[Math.min(frames.length - 1, Math.floor((p / 100) * frames.length))];
    return { steps, medianMs: at(50), p95Ms: at(95), maxMs: frames[frames.length - 1], over50ms: frames.filter((f) => f > 50).length, scrollHeight: list.scrollHeight };
  });

  // ---- arrow keys: 30 lines down from the top
  await page.evaluate(() => {
    document.querySelector('[data-testid="transcript-list"]').scrollTop = 0;
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('[data-testid="transcript-line"]').first().focus();
  const keys = [];
  for (let k = 0; k < 30; k += 1) {
    const before = await page.evaluate(() => document.activeElement?.closest('[data-testid="transcript-row"]')?.getAttribute('data-index'));
    const t0 = Date.now();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction((was) => document.activeElement?.closest('[data-testid="transcript-row"]')?.getAttribute('data-index') !== was, before, { timeout: 30_000, polling: 'raf' });
    keys.push(Date.now() - t0);
  }
  keys.sort((a, b) => a - b);
  out.arrowKeyMs = { median: keys[15], max: keys[29] };
  out.focusAfterKeys = await page.evaluate(() => document.activeElement?.closest('[data-testid="transcript-row"]')?.getAttribute('data-index'));

  // ---- click a line → frame
  const clicks = [];
  for (let k = 0; k < 10; k += 1) {
    clicks.push(
      await page.evaluate(async (n) => {
        const lines = document.querySelectorAll('[data-testid="transcript-line"]');
        const target = lines[Math.min(lines.length - 1, 2 + n)];
        const t0 = performance.now();
        target.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }, k),
    );
  }
  clicks.sort((a, b) => a - b);
  out.clickMs = { median: clicks[5], max: clicks[9] };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return out;
}

const result = { tag, base, lines: lineCount, shownCount, viewport, browserVersion: browser.version(), createdAt: new Date().toISOString(), runs: [] };
for (const rate of [1, 4]) {
  const run = await measure(rate);
  result.runs.push(run);
  console.log(`panel-perf[${tag}] ×${rate}: open ${run.openMs.median.toFixed(0)} ms, panel elements ${run.dom.panelElements} (rows in DOM ${run.dom.rowsInDom}), scroll median ${run.scroll.medianMs.toFixed(1)} / p95 ${run.scroll.p95Ms.toFixed(1)} / max ${run.scroll.maxMs.toFixed(1)} ms, arrow key ${run.arrowKeyMs.median} ms, click ${run.clickMs.median.toFixed(0)} ms`);
}
const outDir = join(webDir, 'transcript-results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `panel-perf-${tag}.json`), `${JSON.stringify(result, null, 1)}\n`);
await browser.close();
