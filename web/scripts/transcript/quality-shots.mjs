/**
 * Screenshots of what changed in "Yazıya dök" on 7 Oct 2026 (ADR-036):
 * the recommended model, the "how much was written" sentence, the long
 * transcript with its search box — at 360, 390 and 1440 px.
 *
 * These states cannot be photographed with the real model on a test machine
 * (the large model needs a graphics card; a 600-line transcript needs a
 * 25-minute talk), so this script drives the E2E BUILD with the test doubles
 * of tests/e2e/transcriptKit.ts: a tiny model list it serves itself and the
 * scripted stand-in recogniser. The INTERFACE in the pictures is the real
 * one; the sizes on the buttons (KB) and the lines' text are the doubles'.
 * The pictures of the real model on real speech are 80–87 (home-shots.mjs).
 *
 *   CLIP_TEST_HOOKS=1 npm run build && npx next start -p 3341
 *   node scripts/transcript/quality-shots.mjs --base=http://127.0.0.1:3341
 * Output: docs/ux/2026-10-03-home/shots/88…8b-yazi-*-{360,390,1440}.png
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(webDir, '..', 'docs', 'ux', '2026-10-03-home', 'shots');
const base = (process.argv.find((a) => a.startsWith('--base=')) ?? '--base=http://127.0.0.1:3341').slice(7).replace(/\/+$/, '');
const sample = join(webDir, 'tests', 'media', 'sample-24s.mp4');
mkdirSync(outDir, { recursive: true });

const mediaDir = join(webDir, 'tests', 'media', 'transcript');
mkdirSync(mediaDir, { recursive: true });
const longVideo = join(mediaDir, 'e2e-long-25min.mp4');
if (!existsSync(longVideo)) {
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=2', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=16000', '-t', '1500', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-g', '20', '-c:a', 'aac', '-b:a', '24k', '-ac', '1', '-movflags', '+faststart', longVideo], { stdio: 'inherit' });
  if (made.status !== 0) throw new Error('ffmpeg could not make the long test video');
}

// ---- the test doubles (the same shapes as tests/e2e/transcriptKit.ts)
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
  base: { dir: 'base-test', files: [{ path: 'config.json', body: Buffer.from('{"test":true}') }, { path: 'onnx/encoder.onnx', body: fileBytes(300_000, 3) }] },
  turbo: { dir: 'turbo-test', files: [{ path: 'onnx/encoder.onnx', body: fileBytes(900_000, 4) }] },
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
const sentence = (text, fromS) => text.split(' ').map((item, index) => ({ text: item, startUs: Math.round((fromS + index * 0.35) * S), endUs: Math.round((fromS + (index + 1) * 0.35 - 0.03) * S) }));
/** A talk of which a good part could not be written (the small model on a noisy conversation). */
const HALF = {
  stepMs: 30,
  segments: [
    { startUs: 1 * S, endUs: 4 * S, state: 'ok', words: sentence('So this is where we start.', 1.1) },
    { startUs: 4.6 * S, endUs: 7.4 * S, state: 'unclear', words: [] },
    { startUs: 8 * S, endUs: 11 * S, state: 'ok', words: sentence('The budget is the next point.', 8.1) },
    { startUs: 11.6 * S, endUs: 14.8 * S, state: 'unclear', words: [] },
    { startUs: 15.4 * S, endUs: 18 * S, state: 'ok', words: sentence('Any questions so far?', 15.5) },
    { startUs: 18.5 * S, endUs: 21 * S, state: 'unclear', words: [] },
  ],
};
const WORDS = ['the', 'meeting', 'starts', 'with', 'a', 'short', 'look', 'at', 'numbers', 'from', 'last', 'week', 'and', 'what', 'we', 'plan', 'next'];
const LONG = { stepMs: 0, segments: [] };
for (let k = 0; k < 600; k += 1) {
  const startUs = Math.round((2 + k * 2.3) * S);
  if (k % 40 === 17) {
    LONG.segments.push({ startUs, endUs: startUs + 2 * S, state: 'unclear', words: [] });
    continue;
  }
  const texts = ['Line', `${k + 1},`, ...Array.from({ length: 2 + (k % 4) }, (_, i) => WORDS[(k * 7 + i * 3) % WORDS.length])];
  texts[texts.length - 1] += '.';
  LONG.segments.push({ startUs, endUs: startUs + 2 * S, state: 'ok', words: texts.map((text, i) => ({ text, startUs: startUs + Math.round((i * 1.8 * S) / texts.length), endUs: startUs + Math.round(((i + 1) * 1.8 * S) / texts.length) - 20_000 })) });
}

const SIZES = [
  { name: '360', width: 360, height: 780 },
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function session(size, stub, largeModel) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  await context.route('**/models/**', async (route) => {
    const url = new URL(route.request().url());
    const body = served.get(url.pathname.slice(url.pathname.indexOf('/models/') + '/models/'.length));
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
  }, { manifest, stub, largeModel });
  const shot = async (name) => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(outDir, `${name}-${size.name}.png`) });
    console.log(`quality-shots: ${name}-${size.name}.png`);
  };
  return { context, page, shot };
}

for (const size of SIZES) {
  // ---- 88: the model choice where the large model can run; 89: the result of a run that left half unwritten
  {
    const { context, page, shot } = await session(size, HALF, true);
    await page.goto(`${base}/yap/yazi/`, { waitUntil: 'load' });
    await page.setInputFiles('[data-testid="video-input"]', sample);
    await page.getByTestId('model-download').waitFor({ timeout: 60_000 });
    if ((await page.getByTestId('transcribe-steps').getAttribute('data-test-hooks')) !== '1') throw new Error('quality-shots needs the e2e build (CLIP_TEST_HOOKS=1 npm run build)');
    await page.getByTestId('transcribe-quality').scrollIntoViewIfNeeded();
    await shot('88-yazi-model-onerilen');
    await page.getByTestId('option-model-base').check();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await page.getByTestId('yazi-coverage').waitFor({ timeout: 60_000 });
    await page.getByTestId('yazi-coverage').scrollIntoViewIfNeeded();
    await shot('89-yazi-ne-kadari-yazildi');
    await context.close();
  }
  // ---- 8a: a 600-line transcript with the search on a line far down; 8b: the same in the editor, a range ticked
  {
    const { context, page, shot } = await session(size, LONG, false);
    await page.goto(`${base}/yap/yazi/`, { waitUntil: 'load' });
    await page.setInputFiles('[data-testid="video-input"]', longVideo);
    await page.getByTestId('model-download').click({ timeout: 120_000 });
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await page.getByTestId('transcript-panel').waitFor({ timeout: 120_000 });
    await page.getByTestId('transcript-search-input').fill('Line 437,');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="transcript-row"][data-found]').waitFor();
    await page.getByTestId('transcript-search').scrollIntoViewIfNeeded();
    await shot('8a-yazi-uzun-arama');
    await page.getByTestId('wizard-open-editor').click();
    await page.getByTestId('side-tab-yazi').click({ timeout: 60_000 });
    await page.getByTestId('transcript-search-input').fill('numbers');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const found = page.locator('[data-testid="transcript-row"][data-found]');
    await found.waitFor();
    await found.getByTestId('transcript-check').click();
    await shot('8b-yazi-editor-uzun');
    await context.close();
  }
}
await browser.close();
