/**
 * Why did the plan do that? (ADR-037)
 *
 *   node scripts/enhance-eval/explain-plan.mjs --file=path.mp4 [--strength=auto] [--from=120] [--to=180] [--set=smoothTone:2]
 *
 * Decodes the video as flicker.mjs does (320 px wide), analyses it as the
 * worker does (frames half a second apart plus the closer looks) and prints,
 * for every analysed frame in the range: what was measured, the correction
 * that frame would get by itself and the one the plan gives it. Then the mean
 * luma of source and result over the range.
 */
import { join } from 'node:path';

import { decodeFrames, ffprobeVideo, loadEnhance, meanLuma, parseArgs, round, webRoot } from './lib.mjs';
import { tuningWith } from './tuning.mjs';

const args = parseArgs();
const file = args.file ? String(args.file) : join(webRoot, 'tests', 'media', 'enhance', 'e2e-v2', 'degisen-isik.mp4');
const strength = String(args.strength ?? 'auto');
const from = Number(args.from ?? 0);
const enhance = await loadEnhance();
const tuning = tuningWith(enhance.ENHANCE_TUNING, args.set);
const info = ffprobeVideo(file);
const width = 320;
const height = Math.round((320 * info.height) / info.width / 2) * 2;
const fps = 30;
const frames = decodeFrames(file, { at: 0, frames: Math.round(info.duration * fps), width, height, fps });
const to = Number(args.to ?? frames.length);

const points = enhance
  .analysisFrames([{ startFrame: 0, endFrame: frames.length }], fps)
  .map((frame) => ({ frame, stats: enhance.measureFrame(frames[frame], width, height) }));
let looked = 0;
for (;;) {
  points.sort((a, b) => a.frame - b.frame);
  const frame = enhance.frameToRefine(points, new Set(), tuning);
  if (frame === null || looked >= enhance.REFINE_BUDGET) break;
  points.push({ frame, stats: enhance.measureFrame(frames[frame], width, height) });
  looked += 1;
}
const plan = enhance.planEnhancement(points, strength, fps, tuning);
const show = (tone) => `black ${round(tone.black, 4)} gain ${round(tone.gain, 3)} gamma ${round(tone.gamma, 3)}`;
console.log(`${file}\n${frames.length} frames; analysed ${points.length} (${looked} closer looks); strength ${strength}`);
console.log(`look: ${JSON.stringify(plan.look, (key, value) => (typeof value === 'number' ? round(value, 4) : value))}`);
for (const [index, point] of points.entries()) {
  if (point.frame < from || point.frame > to) continue;
  const { stats } = point;
  console.log(
    `frame ${String(point.frame).padStart(3)} | low ${round(stats.low, 3)} median ${round(stats.median, 3)} high ${round(stats.high, 4)} flat ${round(stats.flat, 3)} sat ${round(stats.saturation, 3)}` +
      ` | alone: ${show(enhance.chooseTone(stats, strength, tuning))} | plan: ${show(plan.tones[index].tone)}`,
  );
}
const out = new Uint8ClampedArray(width * height * 4);
let scratch = null;
let source = 0;
let result = 0;
let lightOnly = 0;
const neutralLook = { ...enhance.NEUTRAL_LOOK };
for (let frame = from; frame < Math.min(to, frames.length); frame += 1) {
  source += meanLuma(frames[frame], width, height);
  let rendered = enhance.renderEnhanced(frames[frame], width, height, enhance.paramsAtFrame(plan, frame), undefined, out, scratch);
  scratch = rendered.scratch;
  result += meanLuma(out, width, height);
  rendered = enhance.renderEnhanced(frames[frame], width, height, { ...enhance.toneAtFrame(plan, frame), ...neutralLook }, undefined, out, scratch);
  scratch = rendered.scratch;
  lightOnly += meanLuma(out, width, height);
}
const count = Math.min(to, frames.length) - from;
console.log(
  `mean luma over frames ${from}..${to}: source ${round(source / count, 2)}, result ${round(result / count, 2)} (change ${round((result - source) / count, 2)}); light alone: change ${round((lightOnly - source) / count, 2)}`,
);
