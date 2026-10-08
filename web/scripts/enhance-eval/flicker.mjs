/**
 * Frame-to-frame brightness stability of "İyileştir" (ADR-037).
 *
 *   node scripts/enhance-eval/flicker.mjs [--file=path.mp4] [--strength=auto] [--tag=name]
 *
 * Default file: the e2e fixture whose exposure rises slowly for four seconds,
 * holds, drops suddenly at 6 s and returns at 8 s
 * (tests/media/enhance/e2e-v2/degisen-isik.mp4, made by tests/e2e/enhance-media.ts;
 * run the e2e spec or `enhanceFixture('changing')` once to create it).
 *
 * Every frame is decoded (320 × 180) and enhanced by the app's reference
 * renderer in four ways, and the mean luma of every frame is recorded:
 *
 *   source        the video as it is
 *   each frame    every frame corrected from its own histogram alone (what the plan exists to avoid)
 *   blended       analysed frames half a second apart, blended in between, no closer look at changes
 *   plan          what the app does: the same, plus the closer look (`frameToRefine`) and the smoothing
 *
 * Reported: the largest frame-to-frame change, the flicker (mean absolute
 * change of the frame-to-frame change, away from the source's own sudden
 * changes), and how far the brightness overshoots just before a sudden drop.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeFrames, ffprobeVideo, loadEnhance, meanLuma, parseArgs, resultsDir, round, webRoot } from './lib.mjs';
import { tuningWith } from './tuning.mjs';

const args = parseArgs();
const file = args.file ? String(args.file) : join(webRoot, 'tests', 'media', 'enhance', 'e2e-v2', 'degisen-isik.mp4');
const strength = String(args.strength ?? 'auto');
const TAG = args.tag ?? 'default';
if (!existsSync(file)) {
  console.error(`missing ${file}: run the e2e spec once (it generates the fixture)`);
  process.exit(1);
}
const enhance = await loadEnhance();
const tuning = tuningWith(enhance.ENHANCE_TUNING, args.set);
const info = ffprobeVideo(file);
const width = 320;
const height = Math.round((320 * info.height) / info.width / 2) * 2;
const fps = 30;
const total = Math.round(info.duration * fps);
const frames = decodeFrames(file, { at: 0, frames: total, width, height, fps });
console.log(`${frames.length} frames, ${width}x${height}`);

const statsAt = new Map();
const measure = (frame) => {
  if (!statsAt.has(frame)) statsAt.set(frame, enhance.measureFrame(frames[frame], width, height));
  return statsAt.get(frame);
};

// The analysed frames, as the worker picks them; then the closer look.
const base = enhance.analysisFrames([{ startFrame: 0, endFrame: frames.length }], fps).map((frame) => ({ frame, stats: measure(frame) }));
const refined = [...base];
let looked = 0;
for (;;) {
  refined.sort((a, b) => a.frame - b.frame);
  const frame = enhance.frameToRefine(refined, new Set(), tuning);
  if (frame === null || looked >= enhance.REFINE_BUDGET) break;
  refined.push({ frame, stats: measure(frame) });
  looked += 1;
}

const plan = enhance.planEnhancement(refined, strength, fps, tuning);
const blended = enhance.planEnhancement(base, strength, fps, tuning);

const series = { source: [], eachFrame: [], blended: [], plan: [] };
let scratch = null;
const out = new Uint8ClampedArray(width * height * 4);
const render = (frame, params) => {
  const result = enhance.renderEnhanced(frames[frame], width, height, params, undefined, out, scratch);
  scratch = result.scratch;
  return meanLuma(out, width, height);
};
for (let frame = 0; frame < frames.length; frame += 1) {
  series.source.push(meanLuma(frames[frame], width, height));
  const own = enhance.planEnhancement([{ frame, stats: measure(frame) }], strength, fps, tuning);
  series.eachFrame.push(render(frame, enhance.paramsAtFrame(own, frame)));
  series.blended.push(render(frame, enhance.paramsAtFrame(blended, frame)));
  series.plan.push(render(frame, enhance.paramsAtFrame(plan, frame)));
}

const steps = (values) => values.slice(1).map((value, index) => value - values[index]);
// The source's own sudden changes: where its brightness moves by more than 10 levels in one frame.
const sourceSteps = steps(series.source);
const sudden = sourceSteps.map((value, index) => (Math.abs(value) > 10 ? index + 1 : -1)).filter((index) => index >= 0);
const calm = (frame) => sudden.every((at) => Math.abs(frame - at) > fps);
const flicker = (values) => {
  const first = steps(values);
  let sum = 0;
  let count = 0;
  for (let i = 1; i < first.length; i += 1) {
    if (!calm(i) || !calm(i + 1)) continue;
    sum += Math.abs(first[i] - first[i - 1]);
    count += 1;
  }
  return sum / Math.max(1, count);
};
const largest = (values) => Math.max(...steps(values).map(Math.abs));
/** Around each sudden change: how far the brightness leaves the levels it had half a second before and after it. */
const overshoot = (values) => {
  let worst = 0;
  for (const at of sudden) {
    const before = values[Math.max(0, at - fps)];
    const after = values[Math.min(values.length - 1, at + fps)];
    const low = Math.min(before, after);
    const high = Math.max(before, after);
    for (let frame = Math.max(0, at - fps / 2); frame <= Math.min(values.length - 1, at + fps / 2); frame += 1) {
      worst = Math.max(worst, values[frame] - high, low - values[frame]);
    }
  }
  return worst;
};

console.log(`sudden changes of the source at frames ${sudden.join(', ') || '—'}; analysed ${base.length} frames + ${looked} closer looks`);
console.log('\n| how | largest frame-to-frame change (levels) | flicker (levels) | overshoot around a sudden change (levels) | mean luma, dark stretches | mean luma, bright stretch |');
console.log('|---|---|---|---|---|---|');
const mean = (values, from, to) => values.slice(from, to).reduce((sum, value) => sum + value, 0) / (to - from);
const rows = {};
for (const [name, label] of [['source', 'source'], ['eachFrame', 'each frame by itself'], ['blended', 'blended, no closer look'], ['plan', 'the plan (app)']]) {
  const values = series[name];
  rows[name] = {
    largest: largest(values),
    flicker: flicker(values),
    overshoot: overshoot(values),
    dark: sudden.length >= 2 ? mean(values, sudden[0] + 5, sudden[1] - 5) : NaN,
    bright: sudden.length >= 1 ? mean(values, Math.max(0, sudden[0] - 45), sudden[0] - 15) : NaN,
  };
  const r = rows[name];
  console.log(`| ${label} | ${round(r.largest, 1)} | ${round(r.flicker, 3)} | ${round(r.overshoot, 1)} | ${round(r.dark, 1)} | ${round(r.bright, 1)} |`);
}

mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `flicker-${TAG}.json`),
  `${JSON.stringify({ file: file.replace(webRoot, ''), strength, frames: frames.length, analysed: base.length, looked, sudden, rows, series, tones: plan.tones }, null, 1)}\n`,
);
