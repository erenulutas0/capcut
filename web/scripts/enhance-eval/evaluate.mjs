/**
 * Quality of "İyileştir" against a clean reference (ADR-037).
 *
 *   node scripts/enhance-eval/evaluate.mjs [--tag=name] [--only=under-1,soft-1] [--strengths=auto]
 *        [--set=lowTarget:0.03,strengths.auto.sharpen:0.8]   (tuning overrides, for the parameter sweeps)
 *        [--features=tone,wb,vibrance,denoise,sharpen]       (only these parts; the rest switched off)
 *
 * For every frame of the set built by build-set.mjs and every degradation:
 * the app's own `measureFrame` -> `planEnhancement` -> `renderEnhanced`
 * (the reference renderer the WebGL shader is checked against), then PSNR and
 * SSIM of the degraded and of the enhanced frame against the clean one, and
 * two no-reference numbers (Laplacian variance = sharpness, the app's own
 * noise estimate). Prints a table per strength and writes the full result to
 * enhance-results/quality-<tag>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tuningWith } from './tuning.mjs';
import { laplacianVariance, loadEnhance, mean, parseArgs, psnr, resultsDir, round, setDir, ssim } from './lib.mjs';

const args = parseArgs();
const TAG = args.tag ?? 'default';
const enhance = await loadEnhance();
const manifest = JSON.parse(readFileSync(join(setDir, 'manifest.json'), 'utf8'));

const tuning = tuningWith(enhance.ENHANCE_TUNING, args.set);
const strengths = args.strengths ? String(args.strengths).split(',') : enhance.ENHANCE_STRENGTHS;
const only = args.only ? new Set(String(args.only).split(',')) : null;
/** `--features=tone,sharpen`: everything else is switched off, to measure one part by itself. */
const features = args.features ? new Set(String(args.features).split(',')) : null;

function onlyFeatures(params) {
  if (!features) return params;
  const neutral = enhance.NEUTRAL_PARAMS;
  return {
    ...params,
    ...(features.has('tone') ? {} : { black: neutral.black, gain: neutral.gain, gamma: neutral.gamma }),
    ...(features.has('wb') ? {} : { whiteBalance: [1, 1, 1] }),
    ...(features.has('vibrance') ? {} : { vibrance: 0 }),
    ...(features.has('denoise') ? {} : { denoise: 0 }),
    ...(features.has('sharpen') ? {} : { sharpen: 0, sharpenThreshold: 0 }),
  };
}

const load = (name, variant, size) => {
  const buffer = readFileSync(join(setDir, 'frames', `${name}.${variant}.rgba`));
  if (buffer.length !== size) throw new Error(`${name}.${variant}: unexpected size`);
  return new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength);
};

const rows = [];
for (const frame of manifest.frames) {
  const { width, height } = frame;
  const clean = load(frame.name, 'clean', width * height * 4);
  for (const variant of frame.variants) {
    if (only && !only.has(variant)) continue;
    const degraded = load(frame.name, variant, width * height * 4);
    const stats = enhance.measureFrame(degraded, width, height, undefined, tuning);
    const before = {
      psnr: psnr(degraded, clean),
      ssim: ssim(degraded, clean, width, height),
      sharpness: laplacianVariance(degraded, width, height),
      noise: stats.noise,
    };
    for (const strength of strengths) {
      const timeline = enhance.planEnhancement([{ frame: 0, stats }], strength, 30, tuning);
      const params = onlyFeatures(enhance.paramsAtFrame(timeline, 0));
      const { out } = enhance.renderEnhanced(degraded, width, height, params);
      const outStats = enhance.measureFrame(out, width, height, undefined, tuning);
      rows.push({
        frame: frame.name,
        variant,
        strength,
        params,
        stats,
        before,
        after: {
          psnr: psnr(out, clean),
          ssim: ssim(out, clean, width, height),
          sharpness: laplacianVariance(out, width, height),
          noise: outStats.noise,
        },
        // How far the enhanced frame is from its own input (the "does no harm" measure on clean input).
        changed: { psnr: psnr(out, degraded), ssim: ssim(out, degraded, width, height) },
      });
    }
    process.stderr.write('.');
  }
}
process.stderr.write('\n');

const variants = [...new Set(rows.map((row) => row.variant))];
if (args.brief) {
  // One line per strength: degradation ΔPSNR/ΔSSIM, for the sweeps.
  for (const strength of strengths) {
    const parts = variants.map((variant) => {
      const set = rows.filter((row) => row.variant === variant && row.strength === strength);
      if (variant === 'clean') {
        // A clean frame has no "before" error: say how many frames were touched and how far the worst moved.
        const touched = set.filter((row) => Number.isFinite(row.after.psnr));
        const worst = touched.length ? Math.min(...touched.map((row) => row.after.psnr)) : Infinity;
        return `clean ${touched.length}/${set.length} touched, worst ${round(worst, 1)} dB, SSIM ${round(mean(set.map((row) => row.after.ssim)), 4)}`;
      }
      const dp = mean(set.map((row) => row.after.psnr - row.before.psnr));
      const ds = mean(set.map((row) => row.after.ssim - row.before.ssim));
      return `${variant} ${round(dp)}/${round(ds, 4)}`;
    });
    console.log(`${TAG} ${strength}: ${parts.join(' | ')}`);
  }
}
const summary = [];
for (const strength of args.brief ? [] : strengths) {
  console.log(`\n### ${strength}\n`);
  console.log('| degradation | PSNR before | PSNR after | Δ dB | SSIM before | SSIM after | Δ | frames worse (SSIM / PSNR) | sharpness × | noise before → after |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const variant of variants) {
    const set = rows.filter((row) => row.variant === variant && row.strength === strength);
    if (set.length === 0) continue;
    const item = {
      strength,
      variant,
      frames: set.length,
      psnrBefore: mean(set.map((row) => row.before.psnr)),
      psnrAfter: mean(set.map((row) => row.after.psnr)),
      ssimBefore: mean(set.map((row) => row.before.ssim)),
      ssimAfter: mean(set.map((row) => row.after.ssim)),
      worse: set.filter((row) => row.after.ssim < row.before.ssim - 0.0005).length,
      worsePsnr: set.filter((row) => row.after.psnr < row.before.psnr - 0.05).length,
      sharpnessRatio: mean(set.map((row) => row.after.sharpness / Math.max(1e-6, row.before.sharpness))),
      noiseBefore: mean(set.map((row) => row.before.noise)),
      noiseAfter: mean(set.map((row) => row.after.noise)),
      minChangedSsim: Math.min(...set.map((row) => row.changed.ssim)),
    };
    if (variant === 'clean') {
      // A clean frame equals its reference: PSNR is defined only for the frames that were changed.
      const touched = set.filter((row) => Number.isFinite(row.after.psnr));
      item.touched = touched.length;
      item.psnrAfter = touched.length ? mean(touched.map((row) => row.after.psnr)) : Infinity;
      item.psnrWorst = touched.length ? Math.min(...touched.map((row) => row.after.psnr)) : Infinity;
      summary.push(item);
      console.log(
        `| clean (${touched.length} of ${set.length} frames changed) | ∞ | ${touched.length ? `${round(item.psnrAfter)} (worst ${round(item.psnrWorst)})` : '∞'} | — | 1 | ${round(item.ssimAfter, 4)} | ${round(item.ssimAfter - item.ssimBefore, 4)} | ${item.worse}/${item.frames} / ${touched.length}/${item.frames} | ${round(item.sharpnessRatio)} | ${round(item.noiseBefore)} → ${round(item.noiseAfter)} |`,
      );
      continue;
    }
    summary.push(item);
    console.log(
      `| ${variant} | ${round(item.psnrBefore)} | ${round(item.psnrAfter)} | ${round(item.psnrAfter - item.psnrBefore)} | ${round(item.ssimBefore, 4)} | ${round(item.ssimAfter, 4)} | ${round(item.ssimAfter - item.ssimBefore, 4)} | ${item.worse}/${item.frames} / ${item.worsePsnr}/${item.frames} | ${round(item.sharpnessRatio)} | ${round(item.noiseBefore)} → ${round(item.noiseAfter)} |`,
    );
  }
  const all = summary.filter((item) => item.strength === strength && item.variant !== 'clean');
  console.log(
    `\nover the ${all.length} degradations: mean ΔPSNR ${round(mean(all.map((i) => i.psnrAfter - i.psnrBefore)))} dB, mean ΔSSIM ${round(mean(all.map((i) => i.ssimAfter - i.ssimBefore)), 4)}`,
  );
}

mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, `quality-${String(TAG).replace(/[^\w.-]+/g, '_')}.json`), `${JSON.stringify({ tag: TAG, tuning, summary, rows }, null, 1)}\n`);
