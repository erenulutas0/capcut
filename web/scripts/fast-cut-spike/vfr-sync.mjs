/**
 * Audio/video sync of a fast-cut download over its whole length (ADR-027),
 * for a variable-frame-rate recording, through the app:
 *
 *   1. open the file in the editor, keep one moment covering (almost) all of
 *      it with a cut off the keyframes, export in the file's own frame;
 *   2. video: every copied output frame is matched to its source frame by
 *      framemd5; its output time minus its source time must be the same cut
 *      offset for all of them (the source's own VFR timing is kept);
 *   3. audio: every 10 s, one second of output audio is cross-correlated with
 *      the source audio at the same offset; the lag must be ~0.
 * Both streams are then where they were in the source relative to each other.
 *
 * Needs a server (`SHOT_URL`, default :3100). Local only; the output is deleted.
 *
 *   node scripts/fast-cut-spike/vfr-sync.mjs --file=E:/.../R10.mov --browser=chrome --from=0.4 --to=340.6 --aspect=16-9 --quality=1080
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { fastCutIdentity } from '../lib/fast-cut-check.mjs';
import { emptyTimeline } from '../lib/range-flow.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'fastcut-spike-results');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
const args = process.argv.slice(2);
const arg = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const file = resolve(arg('file', ''));
const channel = arg('browser', '');
const from = Number(arg('from', '0.4'));
const to = Number(arg('to', '60'));
const aspect = arg('aspect', '16-9');
const quality = arg('quality', '1080');
const label = arg('label', `vfr-sync-${channel || 'chromium'}`);
mkdirSync(outDir, { recursive: true });

function pcm(path, startS, seconds) {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', startS.toFixed(6), '-t', String(seconds), '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
  );
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
}

/** Lag (samples) of `b` against `a` with the highest normalised correlation, within ±maxLag. */
function bestLag(a, b, maxLag) {
  let best = { lag: 0, score: -Infinity };
  const n = Math.min(a.length, b.length) - 2 * maxLag;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = maxLag; i < maxLag + n; i += 1) {
      const x = a[i];
      const y = b[i + lag];
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    const score = dot / Math.sqrt(na * nb || 1);
    if (score > best.score) best = { lag, score };
  }
  return best;
}

const browser = await chromium.launch(channel ? { channel } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${baseURL}/editor`);
await page.getByTestId('video-input').setInputFiles(file);
await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
await page.getByTestId('strip-clip').first().waitFor({ timeout: 60_000 });
await emptyTimeline(page);
await page.getByTestId('range-start').fill(from.toFixed(3));
await page.getByTestId('range-end').fill(to.toFixed(3));
await page.getByTestId('add-moment').click();
await page.getByTestId(`aspect-${aspect}`).click();
await page.getByTestId('open-export').click();
await page.getByTestId('export-quality').selectOption(quality);
await page.getByTestId('export-ready').waitFor({ timeout: 120_000 });
const started = Date.now();
await page.getByTestId('export-create').click();
await page.getByTestId('export-succeeded').waitFor({ timeout: 30 * 60_000 });
const elapsedMs = Date.now() - started;
const method = page.getByTestId('measured-method');
const result = {
  label,
  from,
  to,
  elapsedMs,
  method: await method.getAttribute('data-method'),
  fallbackReason: (await method.getAttribute('data-fallback')) || null,
  framesEncoded: Number(await method.getAttribute('data-frames-encoded')),
  methodText: (await method.textContent())?.trim(),
};
const download = page.waitForEvent('download');
await page.getByTestId('export-download').click();
const output = join(outDir, `${label}.mp4`);
await (await download).saveAs(output);
await context.close();
await browser.close();

// Video: copied frames at a constant offset from their source frames.
const identity = fastCutIdentity({ outputFile: output, sourceFile: file, moments: [[from, to]] });
result.video = {
  frames: identity.frames,
  identical: identity.identical,
  differing: identity.differing,
  offsetSpreadMs: identity.offsetSpreadMs,
  seamSsimMin: identity.ssimMin,
};

// Audio: lag of output against source at the cut offset, every 10 s.
const lags = [];
for (let t = 1; t + 1.2 < to - from; t += 10) {
  const out = pcm(output, t, 1.1);
  const src = pcm(file, from + t, 1.1);
  const { lag, score } = bestLag(out, src, 960);
  lags.push({ t, lagMs: Number(((lag / 48000) * 1000).toFixed(3)), score: Number(score.toFixed(3)) });
}
const measured = lags.filter((l) => l.score > 0.5);
result.audio = {
  windows: lags.length,
  correlated: measured.length,
  worstLagMs: measured.reduce((m, l) => Math.max(m, Math.abs(l.lagMs)), 0),
  lags,
};
result.errors = errors;
result.ok =
  (result.method === 'smart' || result.method === 'copy') &&
  identity.identical === identity.frames - identity.differing &&
  identity.differing <= result.framesEncoded &&
  identity.offsetSpreadMs !== null &&
  identity.offsetSpreadMs <= 1.7 &&
  measured.length >= lags.length * 0.8 &&
  result.audio.worstLagMs <= 1024 / 48 &&
  errors.length === 0;
rmSync(output, { force: true });
writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
console.log(
  `${label}: ${result.ok ? 'OK' : 'FAIL'} ${result.method} (${result.framesEncoded} kodlanan) ${(elapsedMs / 1000).toFixed(1)} s; ` +
    `video ${identity.identical}/${identity.frames} bit-aynı, kayma yayılımı ${identity.offsetSpreadMs} ms, dikiş SSIM ${identity.ssimMin?.toFixed(4)}; ` +
    `ses ${measured.length}/${lags.length} pencere, en kötü gecikme ${result.audio.worstLagMs} ms`,
);
