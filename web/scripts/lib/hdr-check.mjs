/**
 * HDR -> SDR output check shared by the spike, the doc 22 matrix and the
 * real-media runner (docs/spikes/2026-09-23-hdr-tonemap.md, ADR-022).
 *
 * A tone-mapped picture cannot be compared with one "correct" image: standard
 * operators legitimately differ, mostly in how bright they map mid-tones. So
 * the output is measured against the NEAREST of several standard ffmpeg
 * operators, and the thresholds below separate the spread between those
 * operators from deliberately broken conversions (no tone mapping, no gamut
 * conversion, hard clip, linear light, colour casts, swapped chroma).
 */
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { compareRgb, meanLuma } from './color-metrics.mjs';
import { buildReference } from './media-measure.mjs';

/** zimg linearisation + ffmpeg tonemap, ending as bt709 limited-range yuv420p. */
export const TONEMAP = (npl, op) =>
  `zscale=t=linear:npl=${npl},format=gbrpf32le,zscale=p=bt709,tonemap=${op}:desat=0,` +
  'zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

/**
 * CPU-only standard operators (any ffmpeg built with zimg). The first one is
 * the primary reference named in the task: hable, npl=100, desat=0.
 */
export const LEGIT_OPERATORS = [
  { id: 'ref-hable', chain: TONEMAP(100, 'hable') },
  { id: 'hable-npl203', chain: TONEMAP(203, 'hable') },
  { id: 'mobius', chain: TONEMAP(100, 'mobius') },
  { id: 'reinhard', chain: TONEMAP(100, 'reinhard') },
  { id: 'mobius-npl203', chain: TONEMAP(203, 'mobius') },
];

/**
 * The two libplacebo operators of the calibration (BT.2390 and spline). They
 * need a Vulkan device, so they join the set only where ffmpeg can open one
 * (the development machine; not CI). Without them the reference set is
 * narrower than the one the thresholds were calibrated against, i.e. stricter.
 */
const PLACEBO = (op) =>
  'libplacebo=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:' +
  `tonemapping=${op}:apply_dolbyvision=0:format=yuv420p`;
export const PLACEBO_OPERATORS = [
  { id: 'placebo-bt2390', chain: PLACEBO('bt.2390'), vulkan: true },
  { id: 'placebo-spline', chain: PLACEBO('spline'), vulkan: true },
];

let vulkanChecked = null;
/** Whether this ffmpeg can run libplacebo on a Vulkan device here. */
export function vulkanAvailable() {
  if (vulkanChecked === null) {
    const result = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-v', 'error', '-init_hw_device', 'vulkan', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=0.1',
        '-vf', PLACEBO('spline'), '-frames:v', '1', '-f', 'null', '-'],
      { encoding: 'utf8' },
    );
    vulkanChecked = result.status === 0;
  }
  return vulkanChecked;
}

/**
 * Pass thresholds. Fixed on 2026-09-23 from the ffmpeg-only calibration
 * (leave-one-out spread of 7 legitimate operators against 10 broken
 * conversions, on sampled frames of both real HDR recordings), BEFORE any
 * browser output was measured. The spike doc has the table behind each number.
 */
export const THRESHOLDS = {
  ssimYMin: 0.9,
  meanDeltaE00Max: 8,
  castMax: 4.5,
  saturationRatioMin: 0.78,
  saturationRatioMax: 1.3,
  hueErrorMax: 9,
  clipDeltaMax: 0.045,
  meanLumaMin: 20,
};

export function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

/** Worst value across frames, per metric (ratios keep both ends). */
export function summarize(rows) {
  const worst = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.metrics)) {
      if (!Number.isFinite(value)) continue;
      const w = worst[key];
      if (key === 'ssimY' || key === 'meanLuma') worst[key] = w === undefined ? value : Math.min(w, value);
      else if (key === 'chromaRatio' || key === 'saturationRatio' || key === 'vividSaturationRatio') {
        worst[`${key}Min`] = Math.min(worst[`${key}Min`] ?? Infinity, value);
        worst[`${key}Max`] = Math.max(worst[`${key}Max`] ?? -Infinity, value);
      } else if (key === 'meanDeltaL' || key === 'meanDeltaA' || key === 'meanDeltaB') {
        worst[key] = w === undefined || Math.abs(value) > Math.abs(w) ? value : w;
      } else worst[key] = w === undefined ? value : Math.max(w, value);
    }
  }
  return Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, round(v)]));
}

/**
 * `skipSsim`: an exported file went through two lossy encodes (browser and
 * reference); its structure is checked by the whole-clip SSIM of the caller,
 * so the per-frame SSIM bound (calibrated on unencoded frames) is not applied.
 */
export function verdict(worst, { thresholds = THRESHOLDS, skipSsim = false } = {}) {
  const failures = [];
  const check = (ok, label) => {
    if (!ok) failures.push(label);
  };
  if (!skipSsim) check(worst.ssimY >= thresholds.ssimYMin, `ssimY ${worst.ssimY} < ${thresholds.ssimYMin}`);
  check(worst.meanDeltaE00 <= thresholds.meanDeltaE00Max, `ΔE00 ${worst.meanDeltaE00} > ${thresholds.meanDeltaE00Max}`);
  check(worst.cast <= thresholds.castMax, `renk kayması ${worst.cast} > ${thresholds.castMax}`);
  check(
    worst.saturationRatioMin >= thresholds.saturationRatioMin,
    `doygunluk ${worst.saturationRatioMin} < ${thresholds.saturationRatioMin}`,
  );
  check(
    worst.saturationRatioMax <= thresholds.saturationRatioMax,
    `doygunluk ${worst.saturationRatioMax} > ${thresholds.saturationRatioMax}`,
  );
  check(worst.hueError <= thresholds.hueErrorMax, `ton açısı ${worst.hueError}° > ${thresholds.hueErrorMax}°`);
  check(worst.clipDelta <= thresholds.clipDeltaMax, `kırpılan parlak ${worst.clipDelta} > ${thresholds.clipDeltaMax}`);
  check(worst.meanLuma >= thresholds.meanLumaMin, `ortalama parlaklık ${worst.meanLuma} < ${thresholds.meanLumaMin}`);
  return { pass: failures.length === 0, failures };
}

function ffmpegBuffer(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], {
    encoding: 'buffer',
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) throw new Error(`ffmpeg: ${result.stderr.toString().slice(0, 300)}`);
  return result.stdout;
}

/**
 * Frame `index` of a video as packed rgb24. `bt709` forces the matrix for an
 * untagged file (the x264 references carry no colour tags; the app's output
 * is tagged bt709 and is read by its tags).
 */
export function frameRgb(file, index, width, height, { bt709 = false } = {}) {
  const matrix = bt709 ? ':in_color_matrix=bt709:in_range=tv' : '';
  return ffmpegBuffer([
    '-i', file,
    '-vf', `select=eq(n\\,${index}),scale=${width}:${height}:flags=bicubic${matrix}:out_range=pc,format=rgb24`,
    '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
}

/** Per-frame SSIM of the luma planes of two rgb24 buffers, through ffmpeg. */
function ssimYOfRgb(a, b, width, height, workDir) {
  const fileA = join(workDir, '.ssim-a.rgb');
  const fileB = join(workDir, '.ssim-b.rgb');
  writeFileSync(fileA, a);
  writeFileSync(fileB, b);
  const raw = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`];
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', ...raw, '-i', fileA, ...raw, '-i', fileB,
      '-lavfi', '[0]format=gray[a];[1]format=gray[b];[a][b]ssim', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  rmSync(fileA, { force: true });
  rmSync(fileB, { force: true });
  const match = `${result.stderr}`.match(/All:([0-9.]+)/);
  return match ? Number(match[1]) : NaN;
}

/**
 * Frames that are (almost) entirely black: 98% of pixels below luma 32. A
 * decoder that hands over empty HDR surfaces shows up here even when the
 * sampled frames happen to be fine.
 */
export function blackFrames(file) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', file, '-vf', 'blackframe=amount=98:threshold=32', '-an', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  return [...`${result.stderr}`.matchAll(/\[Parsed_blackframe[^\]]*\] frame:(\d+)/g)].map((m) => Number(m[1]));
}

/**
 * Checks an exported HDR -> SDR file: builds one reference of the same edit
 * per standard operator (`buildReference` with the tone-map chain in front of
 * the crop/scale filter), finds the operator closest to the output over
 * `samples` frames, and applies the thresholds against it.
 */
export function assessHdrExport({ output, source, reference, width, height, frames, workDir, id, samples = 6 }) {
  const indices = Array.from({ length: samples }, (_, i) =>
    Math.min(frames - 1, Math.round(((i + 0.5) * frames) / samples)),
  );
  const outFrames = indices.map((index) => frameRgb(output, index, width, height));
  const perOperator = [];
  const operatorSet = vulkanAvailable() ? [...LEGIT_OPERATORS, ...PLACEBO_OPERATORS] : LEGIT_OPERATORS;
  for (const operator of operatorSet) {
    const refPath = join(workDir, `${id}-hdrref-${operator.id}.mp4`);
    buildReference(
      source,
      { filter: `${operator.chain},${reference.filter}`, trims: reference.trims },
      width,
      height,
      refPath,
      operator.vulkan ? ['-init_hw_device', 'vulkan'] : [],
    );
    const refFrames = indices.map((index) => frameRgb(refPath, index, width, height, { bt709: true }));
    const mean =
      refFrames.reduce((sum, ref, i) => sum + compareRgb(ref, outFrames[i]).meanDeltaE00, 0) / indices.length;
    perOperator.push({ operator, refPath, refFrames, mean });
  }
  perOperator.sort((a, b) => a.mean - b.mean);
  const nearest = perOperator[0];
  const rows = indices.map((index, i) => ({
    index,
    metrics: {
      ssimY: ssimYOfRgb(nearest.refFrames[i], outFrames[i], width, height, workDir),
      ...compareRgb(nearest.refFrames[i], outFrames[i]),
      meanLuma: meanLuma(outFrames[i]),
    },
  }));
  const worst = summarize(rows);
  return {
    nearest: nearest.operator.id,
    nearestRefPath: nearest.refPath,
    refPaths: perOperator.map((p) => p.refPath),
    operatorSet: operatorSet.length > LEGIT_OPERATORS.length ? 'full (7, as calibrated)' : 'cpu-only (5, stricter)',
    operators: perOperator.map((p) => ({ id: p.operator.id, meanDeltaE00: round(p.mean) })),
    frames: rows.map((r) => ({
      index: r.index,
      ssimY: round(r.metrics.ssimY),
      meanDeltaE00: round(r.metrics.meanDeltaE00),
      cast: round(r.metrics.cast),
      saturationRatio: round(r.metrics.saturationRatio),
      hueError: round(r.metrics.hueError),
      clipDelta: round(r.metrics.clipDelta),
    })),
    worst,
    verdict: verdict(worst, { skipSsim: true }),
  };
}
