/**
 * "İyileştir" (ADR-037): one-tap picture clean-up, on the device.
 *
 * Classic image processing, nothing learned and nothing guessed about what
 * the picture "should" contain: light and colour from the picture's own
 * histogram (with limits), a clamped sharpening, a light edge-preserving
 * noise filter. It can make a dull, soft, dark or grainy video look cleaner
 * and crisper; it cannot bring back detail that is not in the file.
 *
 * This module is the whole of the maths and is pure:
 *
 * - `measureFrame`       what a decoded frame looks like (percentiles, colour
 *                        balance, noise, sharpness);
 * - `planEnhancement`    the correction for every output frame, from frames
 *                        sampled over the whole download and smoothed over
 *                        time so it cannot flicker;
 * - `paramsAtFrame`      one frame's parameters;
 * - `renderEnhanced`     the reference renderer. The WebGL shader of the
 *                        export worker (`adapters/export/enhanceGl.ts`)
 *                        computes the same formulas and is checked against
 *                        this function at run time; where WebGL is missing
 *                        this function IS the renderer.
 *
 * No runtime imports: the measurement scripts load this file by itself
 * (`scripts/enhance-eval/lib.mjs`).
 */

/** How strongly to correct. `auto` is the default and the measured one. */
export type EnhanceStrength = 'light' | 'auto' | 'strong';

export const ENHANCE_STRENGTHS: readonly EnhanceStrength[] = ['light', 'auto', 'strong'];

export function isEnhanceStrength(value: unknown): value is EnhanceStrength {
  return value === 'light' || value === 'auto' || value === 'strong';
}

/** Bumped whenever the same recipe would give different pixels (part of the plan's fingerprint). */
export const ENHANCE_ENGINE_VERSION = 2;

/** The picture's place inside the output frame, in pixels (bars around it are left alone). */
export interface PictureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* --------------------------------------------------------------- transfers */

/** bt709 luminance weights, for linear light and (as luma) for gamma-coded values. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** sRGB decoding: code value 0..1 -> linear light 0..1. */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** sRGB encoding: linear light 0..1 -> code value 0..1. */
export function linearToSrgb(light: number): number {
  return light <= 0.0031308 ? light * 12.92 : 1.055 * Math.pow(light, 1 / 2.4) - 0.055;
}

/* ------------------------------------------------------------------ tuning */

/** The limits of one strength. Chosen from measurements (ADR-037), not taste. */
export interface StrengthTuning {
  /** Largest exposure gain in linear light. */
  maxGain: number;
  /** Share of the wanted gain that is applied (as an exponent: 0.5 = half the stops). */
  gainShare: number;
  /** Largest black level removed, in linear light, and the share of the measured excess that is removed. */
  maxBlack: number;
  blackShare: number;
  /** Smallest mid-tone exponent (below 1 brightens the mid-tones). */
  minGamma: number;
  /** Share of the measured colour cast that is removed (0..1). */
  whiteBalance: number;
  /** Largest colour cast correction per channel (0.1 = 10 %). */
  maxCast: number;
  /** Colour lift for dull pictures (0.1 = up to 10 % more saturation). */
  vibrance: number;
  /** Sharpening amount at full softness. */
  sharpen: number;
  /** Range of the noise filter, in multiples of the measured noise. */
  denoise: number;
}

export interface EnhanceTuning {
  /** The percentiles read from the luminance histogram. */
  lowPercentile: number;
  highPercentile: number;
  /** Where the low and high percentile should end up (code values 0..1). */
  lowTarget: number;
  highTarget: number;
  /** A gain never lifts the median above this (code value). */
  medianCeiling: number;
  /** A median below this (code value, after the gain) gets the mid-tones lifted towards it. */
  medianTarget: number;
  /**
   * "Does no harm": a bright end at or above `goodHigh` needs no gain, and the
   * gain is only fully applied once it is down at `darkHigh`; a dark end at or
   * below `goodLow` has no black level to remove, fully removed from
   * `liftedLow` on (code values). In between the correction fades in, so a
   * video near the border does not switch on and off. A dark end above
   * `brightLow` is a picture with nothing dark in it (a white wall, a page,
   * snow), not a lifted black: the correction fades out again and is gone at
   * `brightestLow`.
   */
  goodHigh: number;
  darkHigh: number;
  goodLow: number;
  liftedLow: number;
  brightLow: number;
  brightestLow: number;
  /**
   * A picture with this share on one flat luminance or more (`FrameStats.flat`)
   * is graphics, not a camera picture: its light is left alone, fading in from
   * half that share. The same for a picture whose mid-tones are this
   * saturated on average (a screen recording, a title, stage lighting):
   * fading in from `vividPicture`, left alone from `graphicSaturation` on.
   */
  graphicFlat: number;
  vividPicture: number;
  graphicSaturation: number;
  /**
   * Corrections smaller than these are not made at all ("does no harm"), and
   * from there they fade in (`fadeIn`). Never a
   * step — a correction that switched on at a threshold would treat two
   * videos that look the same differently (ADR-037, 8 Oct 2026).
   */
  deadGain: number;
  deadBlack: number;
  deadGamma: number;
  deadCast: number;
  deadVibrance: number;
  /** Pictures at least this saturated get no colour lift (mean saturation 0..1). */
  vividSaturation: number;
  /** Noise (8-bit levels) below which the noise filter stays off, and where it is fully on. */
  noiseFloor: number;
  noiseFull: number;
  /** The noise filter's range never exceeds this many 8-bit levels. */
  maxDenoiseSigma: number;
  /** Sharpness (see `measureFrame`) at or above which nothing is sharpened, and where sharpening is full. */
  sharpEnough: number;
  softest: number;
  /** Sharpening threshold: this many times the noise, plus a floor, in 8-bit levels. */
  thresholdPerNoise: number;
  thresholdFloor: number;
  /** Noise (8-bit levels, after the filter) at which sharpening is switched off entirely. */
  noSharpenNoise: number;
  /**
   * Smoothing between analysed frames (`planEnhancement`): the time constant
   * (seconds); how far it may move a frame from the correction it asks for
   * itself, in units of "just noticeable" (`toneGap`); and how alike two
   * frames' medians must be (code values) to be averaged.
   */
  smoothSeconds: number;
  smoothTone: number;
  smoothLuma: number;
  strengths: Record<EnhanceStrength, StrengthTuning>;
}

export const ENHANCE_TUNING: EnhanceTuning = {
  lowPercentile: 0.005,
  highPercentile: 0.995,
  lowTarget: 0.03,
  highTarget: 0.92,
  medianCeiling: 0.55,
  medianTarget: 0.4,
  goodHigh: 0.8,
  darkHigh: 0.7,
  goodLow: 0.12,
  liftedLow: 0.24,
  brightLow: 0.3,
  brightestLow: 0.42,
  graphicFlat: 0.4,
  vividPicture: 0.5,
  graphicSaturation: 0.65,
  deadGain: 0.1,
  deadBlack: 0.004,
  deadGamma: 0.04,
  deadCast: 0.02,
  deadVibrance: 0.05,
  vividSaturation: 0.35,
  noiseFloor: 1.5,
  noiseFull: 3.4,
  maxDenoiseSigma: 24,
  sharpEnough: 1.05,
  softest: 0.8,
  thresholdPerNoise: 2,
  thresholdFloor: 0,
  noSharpenNoise: 4.6,
  smoothSeconds: 2,
  smoothTone: 0.5,
  smoothLuma: 0.08,
  strengths: {
    light: { maxGain: 1.5, gainShare: 0.75, maxBlack: 0.03, blackShare: 0.4, minGamma: 1, whiteBalance: 0, maxCast: 0, vibrance: 0.06, sharpen: 0.7, denoise: 1.3 },
    auto: { maxGain: 3, gainShare: 1, maxBlack: 0.06, blackShare: 0.7, minGamma: 1, whiteBalance: 0.5, maxCast: 0.06, vibrance: 0.15, sharpen: 1.5, denoise: 2.1 },
    strong: { maxGain: 4, gainShare: 1, maxBlack: 0.1, blackShare: 1, minGamma: 0.8, whiteBalance: 0.8, maxCast: 0.15, vibrance: 0.3, sharpen: 2.5, denoise: 2.9 },
  },
};

/* -------------------------------------------------------------------- speed */

/**
 * Whether a WebGL renderer name (`WEBGL_debug_renderer_info`) is a software
 * rasteriser: WebGL works there and gives the right picture, but on the
 * processor — measured about as slow as the reference renderer. Null (the
 * browser does not tell) counts as hardware: no warning without evidence.
 */
export function isSoftwareRenderer(name: string | null): boolean {
  if (!name) return false;
  return /swiftshader|llvmpipe|softpipe|software|basic render|warp\b/i.test(name);
}

/**
 * Seconds per 1080p frame where no graphics card does the work. Measured
 * (ADR-037, 7 Oct 2026, one computer): 0.22–0.24 s on software WebGL with all
 * three passes, 0.28–0.34 s on the reference renderer; 0.09–0.10 s without
 * the noise filter. One middle value, for an honest "about".
 */
export const SLOW_SECONDS_PER_1080P_FRAME = 0.25;

/** About how long enhancing takes without a graphics card, in seconds: by frames and picture size. */
export function slowEnhanceSeconds(frames: number, width: number, height: number): number {
  return Math.max(0, frames) * SLOW_SECONDS_PER_1080P_FRAME * ((width * height) / (1920 * 1080));
}

/**
 * What to tell someone whose device has no graphics card, before the
 * download: under two minutes only that it is slow (with the measured
 * example), from two minutes on about how many minutes, from two hours on
 * about how many hours.
 */
export function slowEnhanceNotice(seconds: number): { kind: 'general' } | { kind: 'minutes' | 'hours'; n: number } {
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 120) return { kind: 'hours', n: Math.round(minutes / 60) };
  if (minutes >= 2) return { kind: 'minutes', n: minutes };
  return { kind: 'general' };
}

/* ------------------------------------------------------------ measurement */

/** What one decoded frame looks like. Everything is measured inside the picture, not the bars. */
export interface FrameStats {
  /** Luminance (sRGB-coded, 0..1) below which the darkest / half / all but the brightest share of the picture lies. */
  low: number;
  median: number;
  high: number;
  /** Share of sampled pixels at full black / with a channel at full scale. */
  clippedLow: number;
  clippedHigh: number;
  /**
   * The largest share of the picture that sits on one luminance (within three
   * of the 256 steps), full black and full white aside. Camera pictures stay
   * low; a screen recording or a title card with one flat background is high.
   */
  flat: number;
  /**
   * Mean linear RGB of the mid-tones and of the brightest unclipped pixels,
   * each divided by its own luminance: [1, 1, 1] is neutral. Null when there
   * were too few such pixels to say.
   */
  greyWorld: [number, number, number] | null;
  whitePatch: [number, number, number] | null;
  /** Mean saturation of the mid-tones, (max − min) / max of the coded channels. */
  saturation: number;
  /** Noise as a standard deviation in 8-bit levels, from the flattest blocks. */
  noise: number;
  /**
   * Edge sharpness independent of content: about 1 where edges are one pixel
   * wide, about 0.7 where they spread over four pixels or more. Null when the
   * frame has no edges to judge by.
   */
  sharpness: number | null;
}

const TONAL_SAMPLES = 120_000;
const DETAIL_TILE = 192;
const DETAIL_GRID = 3;
const NOISE_BLOCK = 8;
/** The share of blocks (flattest first) whose noise is read, and the factor that undoes picking the lowest. */
const NOISE_PERCENTILE = 0.2;
const NOISE_BIAS = 1.18;
/**
 * Mean squared gradient (8-bit levels²) a tile of a full-contrast picture
 * needs before its sharpness is judged; for a dark or flat picture the bar is
 * lower in proportion (its edges are as much smaller as its whole range is).
 */
const MIN_STRUCTURE = 6;
const FULL_CONTRAST = 0.9;

const DECODE_8 = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = srgbToLinear(i / 255);
  return table;
})();

function percentileOf(histogram: Uint32Array, total: number, share: number): number {
  const wanted = share * total;
  let seen = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    seen += histogram[bin] ?? 0;
    if (seen >= wanted) return bin / (histogram.length - 1);
  }
  return 1;
}

function sortedPercentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

export function wholeRect(width: number, height: number): PictureRect {
  return { x: 0, y: 0, width, height };
}

function clampRect(rect: PictureRect, width: number, height: number): PictureRect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(height - y, Math.round(rect.height))),
  };
}

/**
 * Measures one frame (8-bit RGBA, sRGB-coded, as the export's canvas holds
 * it). `tuning` only supplies the two percentiles.
 */
export function measureFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect: PictureRect = wholeRect(width, height),
  tuning: EnhanceTuning = ENHANCE_TUNING,
): FrameStats {
  const area = clampRect(rect, width, height);
  const tonal = measureTone(rgba, width, area, tuning);
  const detail = measureDetail(rgba, width, area, tonal.high - tonal.low);
  return { ...tonal, ...detail };
}

function measureTone(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  area: PictureRect,
  tuning: EnhanceTuning,
): Omit<FrameStats, 'noise' | 'sharpness'> {
  const step = Math.max(1, Math.floor(Math.sqrt((area.width * area.height) / TONAL_SAMPLES)));
  const histogram = new Uint32Array(256);
  const bins: number[] = [];
  const offsets: number[] = [];
  let total = 0;
  let clippedLow = 0;
  let clippedHigh = 0;
  for (let y = area.y + (step >> 1); y < area.y + area.height; y += step) {
    for (let x = area.x + (step >> 1); x < area.x + area.width; x += step) {
      const offset = (y * width + x) * 4;
      const r = rgba[offset] ?? 0;
      const g = rgba[offset + 1] ?? 0;
      const b = rgba[offset + 2] ?? 0;
      const light = LUMA_R * (DECODE_8[r] ?? 0) + LUMA_G * (DECODE_8[g] ?? 0) + LUMA_B * (DECODE_8[b] ?? 0);
      const bin = Math.min(255, Math.max(0, Math.round(linearToSrgb(light) * 255)));
      histogram[bin] = (histogram[bin] ?? 0) + 1;
      bins.push(bin);
      offsets.push(offset);
      total += 1;
      if (r <= 1 && g <= 1 && b <= 1) clippedLow += 1;
      if (r >= 254 || g >= 254 || b >= 254) clippedHigh += 1;
    }
  }
  if (total === 0) {
    return { low: 0, median: 0, high: 0, clippedLow: 0, clippedHigh: 0, flat: 0, greyWorld: null, whitePatch: null, saturation: 0 };
  }

  const brightBin = Math.round(percentileOf(histogram, total, 0.95) * 255);
  const mid = [0, 0, 0];
  const bright = [0, 0, 0];
  let midCount = 0;
  let brightCount = 0;
  let saturation = 0;
  for (let index = 0; index < total; index += 1) {
    const bin = bins[index] ?? 0;
    const offset = offsets[index] ?? 0;
    const r = rgba[offset] ?? 0;
    const g = rgba[offset + 1] ?? 0;
    const b = rgba[offset + 2] ?? 0;
    const top = Math.max(r, g, b);
    if (top >= 250) continue;
    if (bin >= 38 && bin <= 217) {
      mid[0] = (mid[0] ?? 0) + (DECODE_8[r] ?? 0);
      mid[1] = (mid[1] ?? 0) + (DECODE_8[g] ?? 0);
      mid[2] = (mid[2] ?? 0) + (DECODE_8[b] ?? 0);
      midCount += 1;
      saturation += top > 0 ? (top - Math.min(r, g, b)) / top : 0;
    }
    if (bin >= brightBin && bin >= 64) {
      bright[0] = (bright[0] ?? 0) + (DECODE_8[r] ?? 0);
      bright[1] = (bright[1] ?? 0) + (DECODE_8[g] ?? 0);
      bright[2] = (bright[2] ?? 0) + (DECODE_8[b] ?? 0);
      brightCount += 1;
    }
  }
  const balance = (sum: number[], count: number): [number, number, number] | null => {
    if (count < total * 0.01) return null;
    const [r = 0, g = 0, b = 0] = sum;
    const light = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    return light > 0 ? [r / light, g / light, b / light] : null;
  };

  let flat = 0;
  for (let bin = 3; bin + 2 <= 252; bin += 1) {
    flat = Math.max(flat, (histogram[bin] ?? 0) + (histogram[bin + 1] ?? 0) + (histogram[bin + 2] ?? 0));
  }

  return {
    low: percentileOf(histogram, total, tuning.lowPercentile),
    median: percentileOf(histogram, total, 0.5),
    high: percentileOf(histogram, total, tuning.highPercentile),
    clippedLow: clippedLow / total,
    clippedHigh: clippedHigh / total,
    flat: flat / total,
    greyWorld: balance(mid, midCount),
    whitePatch: balance(bright, brightCount),
    saturation: midCount > 0 ? saturation / midCount : 0,
  };
}

/** Noise and sharpness from full-resolution tiles spread over the picture. */
function measureDetail(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  area: PictureRect,
  /** The picture's range, bright end minus dark end, in code values 0..1. */
  contrast: number,
): Pick<FrameStats, 'noise' | 'sharpness'> {
  const tileWidth = Math.min(DETAIL_TILE, area.width & ~1);
  const tileHeight = Math.min(DETAIL_TILE, area.height & ~1);
  if (tileWidth < 16 || tileHeight < 16) return { noise: 0, sharpness: null };

  const columns = Math.min(DETAIL_GRID, Math.max(1, Math.floor(area.width / tileWidth)));
  const rows = Math.min(DETAIL_GRID, Math.max(1, Math.floor(area.height / tileHeight)));
  const luma = new Float32Array(tileWidth * tileHeight);
  const halfWidth = tileWidth >> 1;
  const halfHeight = tileHeight >> 1;
  const half = new Float32Array(halfWidth * halfHeight);
  const blockNoise: number[] = [];
  const tiles: { fine: number; coarse: number }[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = area.x + Math.round(((column + 0.5) * area.width) / columns - tileWidth / 2);
      const top = area.y + Math.round(((row + 0.5) * area.height) / rows - tileHeight / 2);
      for (let y = 0; y < tileHeight; y += 1) {
        let offset = ((top + y) * width + left) * 4;
        const line = y * tileWidth;
        for (let x = 0; x < tileWidth; x += 1) {
          luma[line + x] =
            LUMA_R * (rgba[offset] ?? 0) + LUMA_G * (rgba[offset + 1] ?? 0) + LUMA_B * (rgba[offset + 2] ?? 0);
          offset += 4;
        }
      }

      // Noise: Immerkaer's operator per small block; the flattest blocks tell the noise.
      for (let by = 0; by + NOISE_BLOCK <= tileHeight; by += NOISE_BLOCK) {
        for (let bx = 0; bx + NOISE_BLOCK <= tileWidth; bx += NOISE_BLOCK) {
          let sum = 0;
          let mean = 0;
          for (let y = by + 1; y < by + NOISE_BLOCK - 1; y += 1) {
            const line = y * tileWidth;
            for (let x = bx + 1; x < bx + NOISE_BLOCK - 1; x += 1) {
              const at = line + x;
              const centre = luma[at] ?? 0;
              mean += centre;
              sum += Math.abs(
                4 * centre -
                  2 * ((luma[at - 1] ?? 0) + (luma[at + 1] ?? 0) + (luma[at - tileWidth] ?? 0) + (luma[at + tileWidth] ?? 0)) +
                  (luma[at - tileWidth - 1] ?? 0) +
                  (luma[at - tileWidth + 1] ?? 0) +
                  (luma[at + tileWidth - 1] ?? 0) +
                  (luma[at + tileWidth + 1] ?? 0),
              );
            }
          }
          const count = (NOISE_BLOCK - 2) * (NOISE_BLOCK - 2);
          mean /= count;
          // Clipped black and white have no noise left to measure.
          if (mean < 16 || mean > 240) continue;
          blockNoise.push((Math.sqrt(Math.PI / 2) * sum) / (6 * count));
        }
      }

      // Sharpness: gradient energy at full and at half resolution.
      for (let y = 0; y < halfHeight; y += 1) {
        for (let x = 0; x < halfWidth; x += 1) {
          const at = 2 * y * tileWidth + 2 * x;
          half[y * halfWidth + x] =
            ((luma[at] ?? 0) + (luma[at + 1] ?? 0) + (luma[at + tileWidth] ?? 0) + (luma[at + tileWidth + 1] ?? 0)) / 4;
        }
      }
      tiles.push({
        fine: gradientEnergy(luma, tileWidth, tileHeight),
        coarse: gradientEnergy(half, halfWidth, halfHeight),
      });
    }
  }

  const noise = blockNoise.length >= 8 ? sortedPercentile(blockNoise, NOISE_PERCENTILE) * NOISE_BIAS : 0;
  const variance = noise * noise;
  const share = Math.min(1, Math.max(0.1, contrast / FULL_CONTRAST));
  const structure = MIN_STRUCTURE * share * share;
  const scores: number[] = [];
  for (const tile of tiles) {
    // White noise adds its variance to the full-resolution energy and a quarter of it at half resolution.
    const coarse = tile.coarse - variance / 4;
    if (coarse < structure) continue;
    const ratio = Math.max(0, tile.fine - variance) / coarse;
    scores.push(Math.min(2, Math.sqrt(2 * ratio)));
  }
  return { noise, sharpness: scores.length > 0 ? sortedPercentile(scores, 0.75) : null };
}

/** Mean squared central-difference gradient. */
function gradientEnergy(values: Float32Array, width: number, height: number): number {
  let sum = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const line = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const at = line + x;
      const gx = ((values[at + 1] ?? 0) - (values[at - 1] ?? 0)) / 2;
      const gy = ((values[at + width] ?? 0) - (values[at - width] ?? 0)) / 2;
      sum += gx * gx + gy * gy;
    }
  }
  return sum / Math.max(1, (width - 2) * (height - 2));
}

/* -------------------------------------------------------------- parameters */

/** Light: what is done to the luminance of a frame. Changes over time, smoothly. */
export interface ToneParams {
  /** Black level removed from every channel, linear light. 0 = none. */
  black: number;
  /** Exposure gain in linear light. 1 = none. */
  gain: number;
  /** Mid-tone exponent. 1 = none, below 1 brightens. */
  gamma: number;
}

/** Colour and detail: the same for the whole download. */
export interface LookParams {
  /** Linear gains per channel; they leave the luminance of grey unchanged. */
  whiteBalance: [number, number, number];
  /** Colour lift for the less saturated colours. 0 = none. */
  vibrance: number;
  /** Range of the noise filter as a standard deviation in code values (0..1). 0 = off. */
  denoise: number;
  /** Sharpening amount. 0 = off. */
  sharpen: number;
  /** Detail smaller than this (code values 0..1) is not sharpened. */
  sharpenThreshold: number;
}

export interface EnhanceParams extends ToneParams, LookParams {}

export const NEUTRAL_TONE: ToneParams = { black: 0, gain: 1, gamma: 1 };
export const NEUTRAL_LOOK: LookParams = {
  whiteBalance: [1, 1, 1],
  vibrance: 0,
  denoise: 0,
  sharpen: 0,
  sharpenThreshold: 0,
};
export const NEUTRAL_PARAMS: EnhanceParams = { ...NEUTRAL_TONE, ...NEUTRAL_LOOK };

export function toneIsNeutral(tone: ToneParams): boolean {
  return tone.black === 0 && tone.gain === 1 && tone.gamma === 1;
}

/** The light-and-colour stage has nothing to do: no tone, no white balance, no colour lift. */
export function toneStageIsNeutral(params: EnhanceParams): boolean {
  const [r, g, b] = params.whiteBalance;
  return toneIsNeutral(params) && r === 1 && g === 1 && b === 1 && params.vibrance === 0;
}

export function lookIsNeutral(look: LookParams): boolean {
  const [r, g, b] = look.whiteBalance;
  return r === 1 && g === 1 && b === 1 && look.vibrance === 0 && look.denoise === 0 && look.sharpen === 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * A dead band without a step: nothing up to `dead`; above it the value
 * itself less a remainder that dies away (a third of `dead` is still missing
 * at twice `dead`, a twentieth at four times). Continuous and never steeper
 * than 2, so a slightly different measurement gives a slightly different
 * correction — a plain "below this, nothing" switches a tenth more light on
 * or off for a difference nobody can see.
 */
export function fadeIn(value: number, dead: number): number {
  if (dead <= 0) return Math.max(0, value);
  if (value <= dead) return 0;
  return value - dead * Math.exp(-(value - dead) / dead);
}

/** Where the shoulder of the tone curve starts, in linear light: below it a gain is a plain gain. */
export const SHOULDER_KNEE = 0.5;

/**
 * How much the picture looks like something a camera filmed, 0..1. Light
 * and colour are judged from histograms, which only means something for a
 * camera picture: a screen recording's dark background is not an
 * underexposure and its purple is not a colour cast. Sharpening and the noise
 * filter do not depend on this.
 */
export function cameraShare(stats: FrameStats, tuning: EnhanceTuning = ENHANCE_TUNING): number {
  return Math.min(
    clamp(2 - (2 * stats.flat) / tuning.graphicFlat, 0, 1),
    clamp((tuning.graphicSaturation - stats.saturation) / (tuning.graphicSaturation - tuning.vividPicture), 0, 1),
  );
}

/**
 * The light correction for one frame's histogram.
 *
 * - Black: the darkest percentile is brought down to where a healthy picture
 *   has it, never by more than the strength's limit.
 * - Gain: the brightest percentile is brought up to `highTarget`, never by
 *   more than the limit, and a picture is never darkened.
 * - Mid-tones: if the median is still dark after that, it is lifted towards
 *   `medianTarget`, within the limit.
 *
 * Corrections inside the dead bands are dropped and just above them they
 * fade in (`settleTone`), so a picture that is already fine is not touched
 * ("does no harm") and nothing switches on at a threshold.
 */
export function chooseTone(
  stats: FrameStats,
  strength: EnhanceStrength,
  tuning: EnhanceTuning = ENHANCE_TUNING,
): ToneParams {
  return settleTone(wantedTone(stats, strength, tuning), tuning);
}

/** The correction the histogram asks for, before the dead bands (what the plan averages over time). */
function wantedTone(stats: FrameStats, strength: EnhanceStrength, tuning: EnhanceTuning): ToneParams {
  const limits = tuning.strengths[strength];
  const lowLight = srgbToLinear(stats.low);
  const highLight = srgbToLinear(stats.high);
  const medianLight = srgbToLinear(stats.median);

  // Flat graphics (a screen recording, a title card): the levels are someone's design, not an exposure.
  const camera = cameraShare(stats, tuning);

  // Black: only where the dark end is clearly lifted, only a share of the
  // excess, and never more than the darkest percentile itself, so nothing
  // above it is crushed.
  const lifted =
    clamp((stats.low - tuning.goodLow) / (tuning.liftedLow - tuning.goodLow), 0, 1) *
    clamp((tuning.brightestLow - stats.low) / (tuning.brightestLow - tuning.brightLow), 0, 1);
  let black =
    clamp((lowLight - srgbToLinear(tuning.lowTarget)) * limits.blackShare, 0, limits.maxBlack) * lifted * camera;
  black = Math.min(black, lowLight);
  // The gain below is worked out for the black level that will really be removed.
  const removed = fadeIn(black, tuning.deadBlack);

  // Gain: what brings the bright end up to its target, but never past what
  // would make the median brighter than a normal picture's. A picture whose
  // brightest part is grey (a desk, fog) is not dark for that reason alone.
  const after = (light: number): number => Math.max(0, light - removed) / (1 - removed);
  const top = after(highLight);
  const middle = after(medianLight);
  const byHigh = top > 0 ? srgbToLinear(tuning.highTarget) / top : 1;
  const byMedian = middle > 0 ? srgbToLinear(tuning.medianCeiling) / middle : 1;
  // ... and only where the bright end is clearly short of white.
  const dark = clamp((tuning.goodHigh - stats.high) / (tuning.goodHigh - tuning.darkHigh), 0, 1);
  const gain = Math.pow(clamp(Math.min(byHigh, byMedian), 1, limits.maxGain), limits.gainShare * dark * camera);

  // Mid-tones: a median still dark after the gain (a bright window, a dark room) is lifted, within the limit.
  const median = Math.min(1, settledGain(gain, tuning) * middle);
  const target = srgbToLinear(tuning.medianTarget);
  let gamma = 1;
  if (median > 0 && median < target && camera > 0) {
    gamma = 1 + (clamp(Math.log(target) / Math.log(median), limits.minGamma, 1) - 1) * camera;
  }
  return { black, gain, gamma };
}

function settledGain(gain: number, tuning: EnhanceTuning): number {
  return Math.exp(fadeIn(Math.log(Math.max(1, gain)), Math.log(1 + tuning.deadGain)));
}

/** The dead bands of the light correction: nothing inside them, fading in above (`fadeIn`). */
function settleTone(tone: ToneParams, tuning: EnhanceTuning): ToneParams {
  return {
    black: fadeIn(tone.black, tuning.deadBlack),
    gain: settledGain(tone.gain, tuning),
    gamma: 1 - fadeIn(1 - tone.gamma, tuning.deadGamma),
  };
}

/**
 * How differently two light corrections look, in units of "just
 * noticeable": below 1 one can be blended into the other without anyone
 * seeing it.
 */
export function toneGap(first: ToneParams, second: ToneParams): number {
  return Math.max(
    Math.abs(Math.log(first.gain / second.gain)) / TONE_STEP.logGain,
    Math.abs(first.black - second.black) / TONE_STEP.black,
    Math.abs(first.gamma - second.gamma) / TONE_STEP.gamma,
  );
}

/** One just noticeable step of each part of the light correction. */
const TONE_STEP = { logGain: Math.log(1.12), black: 0.008, gamma: 0.04 } as const;

/** The middle value of each measurement over the analysed frames. */
export function typicalStats(frames: readonly FrameStats[]): FrameStats | null {
  if (frames.length === 0) return null;
  const middle = (values: number[]): number => sortedPercentile(values, 0.5);
  const channel = (pick: (stats: FrameStats) => [number, number, number] | null): [number, number, number] | null => {
    const known = frames.map(pick).filter((value): value is [number, number, number] => value !== null);
    if (known.length < frames.length / 2) return null;
    return [middle(known.map((v) => v[0])), middle(known.map((v) => v[1])), middle(known.map((v) => v[2]))];
  };
  const sharp = frames.map((stats) => stats.sharpness).filter((value): value is number => value !== null);
  return {
    low: middle(frames.map((stats) => stats.low)),
    median: middle(frames.map((stats) => stats.median)),
    high: middle(frames.map((stats) => stats.high)),
    clippedLow: middle(frames.map((stats) => stats.clippedLow)),
    clippedHigh: middle(frames.map((stats) => stats.clippedHigh)),
    flat: middle(frames.map((stats) => stats.flat)),
    greyWorld: channel((stats) => stats.greyWorld),
    whitePatch: channel((stats) => stats.whitePatch),
    saturation: middle(frames.map((stats) => stats.saturation)),
    noise: middle(frames.map((stats) => stats.noise)),
    sharpness: sharp.length >= frames.length / 2 ? middle(sharp) : null,
  };
}

/**
 * The colour cast to remove, per channel (0.1 = that channel is 10 % too
 * strong). Only what the mid-tones AND the brightest parts agree on counts:
 * a lawn makes the mid-tones green but leaves the highlights neutral, a real
 * cast tints both. Clamped to `maxCast`.
 */
export function measuredCast(stats: FrameStats, maxCast: number): [number, number, number] {
  const { greyWorld, whitePatch } = stats;
  if (!greyWorld || !whitePatch) return [0, 0, 0];
  const cast: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const mid = (greyWorld[channel] ?? 1) - 1;
    const bright = (whitePatch[channel] ?? 1) - 1;
    if (mid * bright <= 0) continue;
    const size = Math.min(Math.abs(mid), Math.abs(bright), maxCast);
    cast[channel] = Math.sign(mid) * size;
  }
  return cast;
}

/** The dead bands of the noise filter's range (8-bit levels) and of the sharpening amount (see `fadeIn`). */
const MIN_DENOISE_SIGMA = 0.5;
const MIN_SHARPEN = 0.05;

/** Colour and detail for the whole download, from the typical frame. */
export function chooseLook(
  stats: FrameStats,
  strength: EnhanceStrength,
  tuning: EnhanceTuning = ENHANCE_TUNING,
): LookParams {
  const limits = tuning.strengths[strength];
  const camera = cameraShare(stats, tuning);

  // White balance: gains that undo the agreed cast, scaled so grey keeps its luminance.
  // What is removed is the measured cast times the strength's share; a removal too small to see is not made.
  const wanted = measuredCast(stats, limits.maxCast).map((value) => value * camera * limits.whiteBalance);
  const largest = Math.max(Math.abs(wanted[0] ?? 0), Math.abs(wanted[1] ?? 0), Math.abs(wanted[2] ?? 0));
  // ... and just above that it fades in (`fadeIn`), all three channels together.
  const share = largest > 0 ? fadeIn(largest, tuning.deadCast) / largest : 0;
  const cast = wanted.map((value) => value * share) as [number, number, number];
  let whiteBalance: [number, number, number] = [1, 1, 1];
  if (share > 0) {
    const gains = cast.map((value) => 1 / (1 + value)) as [number, number, number];
    const light = LUMA_R * gains[0] + LUMA_G * gains[1] + LUMA_B * gains[2];
    whiteBalance = [gains[0] / light, gains[1] / light, gains[2] / light];
  }

  // Colour lift: only for dull pictures, fading out as the picture is more saturated already.
  const dull = clamp(1 - stats.saturation / tuning.vividSaturation, 0, 1) * camera;
  const vibrance = fadeIn(limits.vibrance * dull, tuning.deadVibrance);

  // Noise filter: off below the floor; its range follows the measured noise.
  const noisy = clamp((stats.noise - tuning.noiseFloor) / (tuning.noiseFull - tuning.noiseFloor), 0, 1);
  const sigma = fadeIn(
    noisy > 0 ? Math.min(tuning.maxDenoiseSigma, limits.denoise * stats.noise) * noisy : 0,
    MIN_DENOISE_SIGMA,
  );
  const denoise = sigma / 255;

  // Sharpening: by how soft the edges are; less on a noisy picture (what the filter leaves is still
  // noise: about 0.6 of it once the filter is fully on).
  const left = stats.noise * (1 - 0.4 * clamp(sigma / (2 * MIN_DENOISE_SIGMA), 0, 1));
  const softness =
    stats.sharpness === null
      ? 0
      : clamp((tuning.sharpEnough - stats.sharpness) / (tuning.sharpEnough - tuning.softest), 0, 1);
  const calm = clamp(1 - left / tuning.noSharpenNoise, 0, 1);
  const sharpen = fadeIn(limits.sharpen * softness * calm, MIN_SHARPEN);
  const sharpenThreshold = sharpen > 0 ? (tuning.thresholdFloor + tuning.thresholdPerNoise * left) / 255 : 0;

  return { whiteBalance, vibrance, denoise, sharpen, sharpenThreshold };
}

/* ---------------------------------------------------------------- timeline */

/** One analysed frame of the download. */
export interface AnalysisPoint {
  /** Output frame index. */
  frame: number;
  stats: FrameStats;
}

export interface EnhanceTimeline {
  strength: EnhanceStrength;
  look: LookParams;
  /** Sorted by frame; the light correction between two points is interpolated. */
  tones: { frame: number; tone: ToneParams }[];
  /** The typical frame the look was chosen from; null when nothing could be analysed. */
  typical: FrameStats | null;
}

/** At most this many frames are analysed, however long the download is. */
export const MAX_ANALYSIS_POINTS = 240;
/** The closest two analysed frames are, in seconds. */
export const ANALYSIS_SPACING_SECONDS = 0.5;

/**
 * Which output frames to analyse: the first and last frame of every moment
 * (so a cut between two moments is a clean switch), and frames in between at
 * least `ANALYSIS_SPACING_SECONDS` apart, at most `maxPoints` in all.
 */
export function analysisFrames(
  segments: readonly { startFrame: number; endFrame: number }[],
  fps: number,
  maxPoints = MAX_ANALYSIS_POINTS,
): number[] {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.endFrame - segment.startFrame), 0);
  if (total <= 0) return [];
  const budget = Math.max(segments.length * 2, maxPoints);
  const step = Math.max(1, Math.round(fps * ANALYSIS_SPACING_SECONDS), Math.ceil(total / budget));
  const frames: number[] = [];
  for (const segment of segments) {
    const length = segment.endFrame - segment.startFrame;
    if (length <= 0) continue;
    const last = segment.endFrame - 1;
    const inner = Math.max(1, Math.round(length / step));
    for (let index = 0; index < inner; index += 1) {
      frames.push(segment.startFrame + Math.round((index * (length - 1)) / inner));
    }
    if (frames[frames.length - 1] !== last) frames.push(last);
  }
  return frames;
}

/** At most this many more frames are looked at to find where the light changes (see `frameToRefine`). */
export const REFINE_BUDGET = 96;

/**
 * How differently two analysed frames would be corrected, in units of "just
 * noticeable": below 1 the two corrections can be blended into each other
 * without anyone seeing it. Judged at the strongest setting, so one look at
 * the video serves all three.
 */
export function toneDistance(a: FrameStats, b: FrameStats, tuning: EnhanceTuning = ENHANCE_TUNING): number {
  return toneGap(chooseTone(a, 'strong', tuning), chooseTone(b, 'strong', tuning));
}

/**
 * The next frame worth looking at, or null when the analysed frames are
 * enough.
 *
 * Between two analysed frames the correction is blended from one to the
 * other. Where the two would be corrected alike that is invisible. Where
 * they would not — the light was switched off, the video cuts to another
 * scene, the exposure swings — a blend over half a second would brighten the
 * bright side before the change and leave the dark side dark after it. So
 * the frame in the middle of the most different pair is looked at too, again
 * and again: a sudden change ends up between two neighbouring frames (the
 * correction switches exactly there), a quick but gradual one gets as many
 * analysed frames as it needs to be followed.
 *
 * `points` must be sorted by frame. `skip`: middles that were asked for and
 * could not be decoded.
 */
export function frameToRefine(
  points: readonly AnalysisPoint[],
  skip: ReadonlySet<number> = new Set(),
  tuning: EnhanceTuning = ENHANCE_TUNING,
): number | null {
  let best: number | null = null;
  let most = 1;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (!left || !right || right.frame - left.frame < 2) continue;
    const middle = left.frame + Math.floor((right.frame - left.frame) / 2);
    if (skip.has(middle)) continue;
    const distance = toneDistance(left.stats, right.stats, tuning);
    if (distance > most) {
      most = distance;
      best = middle;
    }
  }
  return best;
}

/**
 * The plan for the whole download.
 *
 * Colour and detail are decided once, from the typical analysed frame: they
 * cannot change from frame to frame. Light follows the video (a dark room
 * and a sunny street in one video each get their own correction) but each
 * analysed frame's correction is first calmed (see the three steps in the
 * code): a single odd frame takes its neighbours' correction, the rest is
 * averaged with the frames around it that look alike — but only within half
 * a just noticeable step of what the frame asks for itself. Until 8 Oct 2026
 * that average had no such limit: a well-exposed stretch inherited about a
 * tenth of gain from the brightening stretch before it, which was exactly
 * the size of the (then abrupt) dead band — so it was lifted or left alone
 * depending on the grain. Between analysed frames the correction is
 * interpolated. Where the light really changes at once, the analysis has
 * put two analysed frames next to each other (`frameToRefine`), and the
 * correction switches between those two.
 *
 * The dead bands are applied after the averaging, once, and they fade in
 * (`settleTone`). A whole kind of correction that would be too small to see
 * anywhere in the video is not made at all (`dropInvisible`), so what the
 * summary says is exactly what is done.
 */
export function planEnhancement(
  points: readonly AnalysisPoint[],
  strength: EnhanceStrength,
  fps: number,
  tuning: EnhanceTuning = ENHANCE_TUNING,
): EnhanceTimeline {
  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  const typical = typicalStats(sorted.map((point) => point.stats));
  if (!typical) return { strength, look: { ...NEUTRAL_LOOK }, tones: [], typical: null };

  const raw = sorted.map((point) => wantedTone(point.stats, strength, tuning));
  const reach = tuning.smoothSeconds * fps;
  // Each analysed frame stands for the stretch of video around it. Where the light changes the
  // analysis looks closer (`frameToRefine`), so there the frames are dense: counted one by one they
  // would outvote the rest of the video, and how many there are depends on the grain.
  const spans = sorted.map((point, index) => {
    const before = sorted[index - 1];
    const after = sorted[index + 1];
    const left = before ? (point.frame - before.frame) / 2 : 0;
    const right = after ? (after.frame - point.frame) / 2 : 0;
    return Math.max(0.5, left + right);
  });
  // 1. One odd frame (a glint, something dark passing) is replaced by what the frames on either
  //    side of it ask for: the middle of three. A change that lasts, slow or sudden, passes as it is.
  const middleOf = (a: number, b: number, c: number): number => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  const steady = raw.map((own, index) => {
    const before = raw[index - 1];
    const after = raw[index + 1];
    if (!before || !after) return own;
    return {
      black: middleOf(before.black, own.black, after.black),
      gain: middleOf(before.gain, own.gain, after.gain),
      gamma: middleOf(before.gamma, own.gamma, after.gamma),
    };
  });
  // 2. The average with the neighbours in time that look alike takes the remaining unrest out ...
  const tones = sorted.map((point, index) => {
    const own = steady[index] ?? NEUTRAL_TONE;
    let weightSum = 0;
    let black = 0;
    let logGain = 0;
    let gamma = 0;
    for (let other = 0; other < sorted.length; other += 1) {
      const neighbour = sorted[other];
      const tone = steady[other];
      if (!neighbour || !tone) continue;
      const time = (neighbour.frame - point.frame) / reach;
      if (Math.abs(time) > 3) continue;
      const look = (neighbour.stats.median - point.stats.median) / tuning.smoothLuma;
      const weight = (spans[other] ?? 1) * Math.exp(-0.5 * (time * time + look * look));
      weightSum += weight;
      black += weight * tone.black;
      logGain += weight * Math.log(tone.gain);
      gamma += weight * tone.gamma;
    }
    if (weightSum <= 0) return { frame: point.frame, tone: settleTone(own, tuning) };
    // 3. ... but never moves a frame further from what it asks for itself than `smoothTone` of a
    //    just noticeable step: unrest is smaller than that, and what is larger is not unrest. A
    //    well-exposed stretch beside a brightening one therefore keeps its own "nothing".
    const within = (value: number, wish: number, step: number): number =>
      clamp(value, wish - tuning.smoothTone * step, wish + tuning.smoothTone * step);
    const smoothed: ToneParams = {
      black: within(black / weightSum, own.black, TONE_STEP.black),
      gain: Math.exp(within(logGain / weightSum, Math.log(own.gain), TONE_STEP.logGain)),
      gamma: within(gamma / weightSum, own.gamma, TONE_STEP.gamma),
    };
    return { frame: point.frame, tone: settleTone(smoothed, tuning) };
  });

  return dropInvisible({ strength, look: chooseLook(typical, strength, tuning), tones, typical });
}

/** Below these a correction cannot be seen: about one 8-bit level in the mid-tones. */
const VISIBLE_LIFT = 0.02;
const VISIBLE_BLACK = 0.002;
const VISIBLE_CAST = 0.005;
const VISIBLE_VIBRANCE = 0.02;

function lightIsVisible(tones: readonly { tone: ToneParams }[]): boolean {
  return tones.some(({ tone }) => Math.abs(toneLift(tone) - 1) >= VISIBLE_LIFT || tone.black >= VISIBLE_BLACK);
}

function colourIsVisible(look: LookParams): boolean {
  return look.whiteBalance.some((gain) => Math.abs(gain - 1) >= VISIBLE_CAST) || look.vibrance >= VISIBLE_VIBRANCE;
}

/**
 * A kind of correction that nowhere in the video reaches what can be seen is
 * taken out of the plan. The dead bands fade in, so just above them a
 * correction is a fraction of a level; doing that — re-touching every pixel
 * and reporting "light corrected" — for nothing visible would be dishonest.
 */
function dropInvisible(timeline: EnhanceTimeline): EnhanceTimeline {
  const tones = lightIsVisible(timeline.tones)
    ? timeline.tones
    : timeline.tones.map(({ frame }) => ({ frame, tone: { ...NEUTRAL_TONE } }));
  const look = colourIsVisible(timeline.look)
    ? timeline.look
    : { ...timeline.look, whiteBalance: [1, 1, 1] as [number, number, number], vibrance: 0 };
  return { ...timeline, tones, look };
}

/** The light correction at an output frame: interpolated between the analysed frames around it. */
export function toneAtFrame(timeline: EnhanceTimeline, frame: number): ToneParams {
  const { tones } = timeline;
  const first = tones[0];
  if (!first) return NEUTRAL_TONE;
  if (frame <= first.frame) return first.tone;
  let low = 0;
  let high = tones.length - 1;
  const last = tones[high];
  if (!last || frame >= last.frame) return last ? last.tone : first.tone;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((tones[mid]?.frame ?? 0) <= frame) low = mid;
    else high = mid;
  }
  const a = tones[low];
  const b = tones[high];
  if (!a || !b) return first.tone;
  const span = b.frame - a.frame;
  const share = span > 0 ? (frame - a.frame) / span : 0;
  return {
    black: a.tone.black + (b.tone.black - a.tone.black) * share,
    gain: a.tone.gain * Math.pow(b.tone.gain / a.tone.gain, share),
    gamma: a.tone.gamma + (b.tone.gamma - a.tone.gamma) * share,
  };
}

export function paramsAtFrame(timeline: EnhanceTimeline, frame: number): EnhanceParams {
  return { ...toneAtFrame(timeline, frame), ...timeline.look };
}

/** What the plan does, in the few words the screens need. */
export interface EnhanceSummary {
  /** The largest brightening anywhere in the video: none, a little, a lot. */
  light: 'none' | 'some' | 'much';
  colour: boolean;
  sharpen: boolean;
  denoise: boolean;
  /** Nothing at all is changed: the video already looks fine to this method. */
  nothing: boolean;
}

/** How much brighter a mid-grey gets under a light correction (1 = unchanged). */
export function toneLift(tone: ToneParams): number {
  const grey = 0.18;
  return applyTone(grey, tone, shoulderOf(tone)) / grey;
}

export function summarize(timeline: EnhanceTimeline): EnhanceSummary {
  let lift = 1;
  let toned = false;
  for (const { tone } of timeline.tones) {
    if (!toneIsNeutral(tone)) toned = true;
    lift = Math.max(lift, toneLift(tone));
  }
  const [r, g, b] = timeline.look.whiteBalance;
  const colour = r !== 1 || g !== 1 || b !== 1 || timeline.look.vibrance > 0;
  const sharpen = timeline.look.sharpen > 0;
  const denoise = timeline.look.denoise > 0;
  const light: EnhanceSummary['light'] = !toned ? 'none' : lift >= 1.5 ? 'much' : 'some';
  return { light, colour, sharpen, denoise, nothing: !toned && !colour && !sharpen && !denoise };
}

/* ----------------------------------------------------------------- formulas */

/**
 * How far above the knee the brightest input lands after gain and gamma,
 * in units of the knee-to-white distance (1 = exactly white, the shoulder is
 * then a straight line).
 */
export function shoulderOf(tone: ToneParams): number {
  const peak = Math.pow(tone.gain, tone.gamma);
  return Math.max(1, (peak - SHOULDER_KNEE) / (1 - SHOULDER_KNEE));
}

/** Soft black level: light well above `black` loses `black`, light below it goes smoothly to (almost) zero. */
export function removeBlack(light: number, black: number): number {
  if (black <= 0) return Math.max(0, light);
  const softness = 0.5 * black;
  const toe = (value: number): number => 0.5 * (value - black + Math.sqrt((value - black) * (value - black) + softness * softness));
  return toe(light) / toe(1);
}

/**
 * The tone curve on linear luminance (after the black level): gain, mid-tone
 * exponent, then a shoulder that brings whatever the gain pushed past white
 * back under it without a hard clip. With gain 1 and gamma 1 it is the identity.
 */
export function applyTone(light: number, tone: ToneParams, shoulder: number): number {
  let value = Math.max(0, light) * tone.gain;
  if (tone.gamma !== 1) value = Math.pow(value, tone.gamma);
  if (value > SHOULDER_KNEE && shoulder > 1) {
    const over = (value - SHOULDER_KNEE) / (1 - SHOULDER_KNEE);
    value = SHOULDER_KNEE + ((1 - SHOULDER_KNEE) * over) / (1 + (1 - 1 / shoulder) * over);
  }
  return Math.min(1, value);
}

/** The noise filter's taps: offsets and spatial weights (a 5×5 Gaussian, sigma 1.5). */
export const DENOISE_TAPS: readonly { dx: number; dy: number; weight: number }[] = (() => {
  const taps: { dx: number; dy: number; weight: number }[] = [];
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      taps.push({ dx, dy, weight: Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)) });
    }
  }
  return taps;
})();

/* ------------------------------------------------------- reference renderer */

const DECODE_STEPS = 4095;
const DECODE_TABLE = (() => {
  const table = new Float32Array(DECODE_STEPS + 2);
  for (let i = 0; i <= DECODE_STEPS + 1; i += 1) table[i] = srgbToLinear(Math.min(1, i / DECODE_STEPS));
  return table;
})();
/** Indexed by the square root of the light, so the dark end is as finely resolved as the bright end. */
const ENCODE_TABLE = (() => {
  const table = new Float32Array(DECODE_STEPS + 2);
  for (let i = 0; i <= DECODE_STEPS + 1; i += 1) {
    const root = Math.min(1, i / DECODE_STEPS);
    table[i] = linearToSrgb(root * root);
  }
  return table;
})();

function decodeFast(code: number): number {
  const at = (code <= 0 ? 0 : code >= 1 ? 1 : code) * DECODE_STEPS;
  const index = at | 0;
  const low = DECODE_TABLE[index] as number;
  return low + ((DECODE_TABLE[index + 1] as number) - low) * (at - index);
}

function encodeFast(light: number): number {
  const at = Math.sqrt(light <= 0 ? 0 : light >= 1 ? 1 : light) * DECODE_STEPS;
  const index = at | 0;
  const low = ENCODE_TABLE[index] as number;
  return low + ((ENCODE_TABLE[index + 1] as number) - low) * (at - index);
}

/** Buffers the reference renderer keeps between frames of the same size. */
export interface EnhanceScratch {
  width: number;
  height: number;
  a: Float32Array;
  b: Float32Array;
}

function scratchFor(width: number, height: number, reuse: EnhanceScratch | null): EnhanceScratch {
  if (reuse && reuse.width === width && reuse.height === height) return reuse;
  return { width, height, a: new Float32Array(width * height * 3), b: new Float32Array(width * height * 3) };
}

/**
 * The reference renderer: `src` (8-bit RGBA, sRGB-coded) -> `out`, the same
 * size. Pixels outside `rect` are copied unchanged; filters never read across
 * the rectangle's edge.
 *
 * Order: noise filter (on the coded values) -> black level, white balance,
 * tone, colour lift (in linear light) -> sharpening (on the coded values,
 * limited to the local range so no halo can form).
 */
export function renderEnhanced(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  params: EnhanceParams,
  rect: PictureRect = wholeRect(width, height),
  out: Uint8ClampedArray | Uint8Array = new Uint8ClampedArray(src.length),
  reuse: EnhanceScratch | null = null,
): { out: Uint8ClampedArray | Uint8Array; scratch: EnhanceScratch } {
  const area = clampRect(rect, width, height);
  const w = area.width;
  const h = area.height;
  const scratch = scratchFor(w, h, reuse);
  const { a, b } = scratch;
  if (out !== src) out.set(src);

  // Stage 0: the picture as floats (coded values 0..1), noise-filtered when asked.
  for (let y = 0; y < h; y += 1) {
    let from = ((area.y + y) * width + area.x) * 4;
    let to = y * w * 3;
    for (let x = 0; x < w; x += 1) {
      a[to] = (src[from] as number) / 255;
      a[to + 1] = (src[from + 1] as number) / 255;
      a[to + 2] = (src[from + 2] as number) / 255;
      from += 4;
      to += 3;
    }
  }
  let picture = a;
  let spare = b;
  if (params.denoise > 0) {
    denoiseInto(picture, spare, w, h, params.denoise);
    [picture, spare] = [spare, picture];
  }

  // Stage 1: light and colour, pixel by pixel.
  toneInto(picture, spare, w * h, params);
  [picture, spare] = [spare, picture];

  // Stage 2: sharpening, then back to 8 bits.
  if (params.sharpen > 0) {
    sharpenInto(picture, spare, w, h, params.sharpen, params.sharpenThreshold);
    [picture, spare] = [spare, picture];
  }
  for (let y = 0; y < h; y += 1) {
    let from = y * w * 3;
    let to = ((area.y + y) * width + area.x) * 4;
    for (let x = 0; x < w; x += 1) {
      out[to] = quantize(picture[from] as number);
      out[to + 1] = quantize(picture[from + 1] as number);
      out[to + 2] = quantize(picture[from + 2] as number);
      from += 3;
      to += 4;
    }
  }
  return { out, scratch };
}

function quantize(value: number): number {
  const scaled = value * 255 + 0.5;
  return scaled <= 0 ? 0 : scaled >= 255 ? 255 : scaled | 0;
}

function denoiseInto(src: Float32Array, dst: Float32Array, w: number, h: number, sigma: number): void {
  const falloff = 1 / (2 * sigma * sigma);
  const taps = DENOISE_TAPS;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = (y * w + x) * 3;
      const r = src[at] as number;
      const g = src[at + 1] as number;
      const b = src[at + 2] as number;
      const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumW = 0;
      for (let index = 0; index < taps.length; index += 1) {
        const tap = taps[index] as { dx: number; dy: number; weight: number };
        const tx = x + tap.dx;
        const ty = y + tap.dy;
        const cx = tx < 0 ? 0 : tx >= w ? w - 1 : tx;
        const cy = ty < 0 ? 0 : ty >= h ? h - 1 : ty;
        const other = (cy * w + cx) * 3;
        const or = src[other] as number;
        const og = src[other + 1] as number;
        const ob = src[other + 2] as number;
        const difference = LUMA_R * or + LUMA_G * og + LUMA_B * ob - luma;
        const weight = tap.weight * Math.exp(-difference * difference * falloff);
        sumR += weight * or;
        sumG += weight * og;
        sumB += weight * ob;
        sumW += weight;
      }
      dst[at] = sumR / sumW;
      dst[at + 1] = sumG / sumW;
      dst[at + 2] = sumB / sumW;
    }
  }
}

function toneInto(src: Float32Array, dst: Float32Array, pixels: number, params: EnhanceParams): void {
  const [wbR, wbG, wbB] = params.whiteBalance;
  const { black, vibrance } = params;
  const shoulder = shoulderOf(params);
  const softness = 0.5 * black;
  const softSquared = softness * softness;
  const toeAtWhite = black > 0 ? 0.5 * (1 - black + Math.sqrt((1 - black) * (1 - black) + softSquared)) : 1;
  const tonal = !toneIsNeutral(params);
  const balanced = wbR !== 1 || wbG !== 1 || wbB !== 1;
  if (!tonal && !balanced && vibrance === 0) {
    dst.set(src.subarray(0, pixels * 3));
    return;
  }
  for (let index = 0; index < pixels; index += 1) {
    const at = index * 3;
    let r = decodeFast(src[at] as number);
    let g = decodeFast(src[at + 1] as number);
    let b = decodeFast(src[at + 2] as number);
    if (black > 0) {
      r = (0.5 * (r - black + Math.sqrt((r - black) * (r - black) + softSquared))) / toeAtWhite;
      g = (0.5 * (g - black + Math.sqrt((g - black) * (g - black) + softSquared))) / toeAtWhite;
      b = (0.5 * (b - black + Math.sqrt((b - black) * (b - black) + softSquared))) / toeAtWhite;
    }
    r *= wbR;
    g *= wbG;
    b *= wbB;
    const light = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    const toned = tonal ? applyTone(light, params, shoulder) : Math.min(1, light);
    if (light > 1e-6) {
      const ratio = toned / light;
      r *= ratio;
      g *= ratio;
      b *= ratio;
    } else {
      r = toned;
      g = toned;
      b = toned;
    }
    if (vibrance > 0) {
      const top = r > g ? (r > b ? r : b) : g > b ? g : b;
      const bottom = r < g ? (r < b ? r : b) : g < b ? g : b;
      const saturation = top > 1e-6 ? (top - bottom) / top : 0;
      const lift = 1 + vibrance * (1 - saturation);
      r = toned + (r - toned) * lift;
      g = toned + (g - toned) * lift;
      b = toned + (b - toned) * lift;
    }
    // Back inside the gamut towards the pixel's own luminance: a bright colour pales, it does not clip.
    const top = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (top > 1) {
      const scale = top - toned > 1e-6 ? (1 - toned) / (top - toned) : 0;
      r = toned + (r - toned) * scale;
      g = toned + (g - toned) * scale;
      b = toned + (b - toned) * scale;
    }
    const bottom = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (bottom < 0) {
      const scale = toned - bottom > 1e-6 ? toned / (toned - bottom) : 0;
      r = toned + (r - toned) * scale;
      g = toned + (g - toned) * scale;
      b = toned + (b - toned) * scale;
    }
    dst[at] = encodeFast(r);
    dst[at + 1] = encodeFast(g);
    dst[at + 2] = encodeFast(b);
  }
}

function sharpenInto(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  amount: number,
  threshold: number,
): void {
  const lumaAt = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    const at = (cy * w + cx) * 3;
    return LUMA_R * (src[at] as number) + LUMA_G * (src[at + 1] as number) + LUMA_B * (src[at + 2] as number);
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const centre = lumaAt(x, y);
      const north = lumaAt(x, y - 1);
      const south = lumaAt(x, y + 1);
      const west = lumaAt(x - 1, y);
      const east = lumaAt(x + 1, y);
      const corners = lumaAt(x - 1, y - 1) + lumaAt(x + 1, y - 1) + lumaAt(x - 1, y + 1) + lumaAt(x + 1, y + 1);
      const blurred = (4 * centre + 2 * (north + south + west + east) + corners) / 16;
      const detail = centre - blurred;
      const size = Math.abs(detail) - threshold;
      let delta = 0;
      if (size > 0) {
        const wanted = centre + amount * (detail > 0 ? size : -size);
        // Never outside what the pixel's four neighbours already hold: an edge gets steeper, no halo can form.
        const lowest = Math.min(centre, north, south, west, east);
        const highest = Math.max(centre, north, south, west, east);
        delta = (wanted < lowest ? lowest : wanted > highest ? highest : wanted) - centre;
      }
      const at = (y * w + x) * 3;
      dst[at] = (src[at] as number) + delta;
      dst[at + 1] = (src[at + 1] as number) + delta;
      dst[at + 2] = (src[at + 2] as number) + delta;
    }
  }
}
