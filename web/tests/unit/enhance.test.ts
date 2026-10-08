import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_SPACING_SECONDS,
  ENHANCE_STRENGTHS,
  ENHANCE_TUNING,
  MAX_ANALYSIS_POINTS,
  NEUTRAL_PARAMS,
  REFINE_BUDGET,
  NEUTRAL_TONE,
  SHOULDER_KNEE,
  analysisFrames,
  isSoftwareRenderer,
  slowEnhanceNotice,
  slowEnhanceSeconds,
  applyTone,
  cameraShare,
  chooseLook,
  chooseTone,
  frameToRefine,
  isEnhanceStrength,
  linearToSrgb,
  lookIsNeutral,
  measureFrame,
  measuredCast,
  paramsAtFrame,
  planEnhancement,
  removeBlack,
  renderEnhanced,
  shoulderOf,
  srgbToLinear,
  summarize,
  toneAtFrame,
  toneDistance,
  toneIsNeutral,
  toneLift,
  typicalStats,
  type AnalysisPoint,
  type EnhanceParams,
  type FrameStats,
} from '@/domain/enhance';

/* ------------------------------------------------------------------ helpers */

/** Deterministic uniform numbers (mulberry32) and normal ones from them. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): () => number {
  return () => {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
}

type Painter = (x: number, y: number) => [number, number, number];

function picture(width: number, height: number, paint: Painter): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return data;
}

const W = 256;
const H = 192;

/** A soft, continuous-tone scene with a full range of grey: what a healthy camera picture measures like. */
const scene: Painter = (x, y) => {
  const v = 20 + 215 * (0.5 + 0.25 * Math.sin(x / 9) + 0.25 * Math.sin(y / 7 + x / 23));
  return [v, v, v];
};

function scaled(paint: Painter, k: number): Painter {
  return (x, y) => {
    const [r, g, b] = paint(x, y);
    return [r * k, g * k, b * k];
  };
}

function meanLuma(rgba: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    sum += 0.2126 * (rgba[at] ?? 0) + 0.7152 * (rgba[at + 1] ?? 0) + 0.0722 * (rgba[at + 2] ?? 0);
  }
  return sum / (rgba.length / 4);
}

/** Measurements of a healthy camera picture; tests change one thing at a time. */
function stats(patch: Partial<FrameStats> = {}): FrameStats {
  return {
    low: 0.03,
    median: 0.5,
    high: 0.93,
    clippedLow: 0,
    clippedHigh: 0,
    flat: 0.04,
    greyWorld: [1, 1, 1],
    whitePatch: [1, 1, 1],
    saturation: 0.3,
    noise: 0.4,
    sharpness: 1.25,
    ...patch,
  };
}

/* --------------------------------------------------------------- transfers */

describe('sRGB transfer', () => {
  it('decodes and encodes back to the same value over the whole range', () => {
    for (let code = 0; code <= 255; code += 1) {
      expect(linearToSrgb(srgbToLinear(code / 255)) * 255).toBeCloseTo(code, 6);
    }
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    // 18 % grey is code value ~118.
    expect(Math.round(linearToSrgb(0.18) * 255)).toBe(118);
  });

  it('knows the three strengths and nothing else', () => {
    expect(ENHANCE_STRENGTHS).toEqual(['light', 'auto', 'strong']);
    expect(isEnhanceStrength('auto')).toBe(true);
    expect(isEnhanceStrength('max')).toBe(false);
    expect(isEnhanceStrength(undefined)).toBe(false);
  });
});

/* ------------------------------------------------------------- measurement */

describe('measureFrame: light', () => {
  it('reads the histogram percentiles of a full-range picture', () => {
    const measured = measureFrame(picture(W, H, scene), W, H);
    expect(measured.low).toBeLessThan(0.15);
    expect(measured.high).toBeGreaterThan(0.85);
    expect(measured.median).toBeGreaterThan(0.35);
    expect(measured.median).toBeLessThan(0.65);
    expect(measured.low).toBeLessThanOrEqual(measured.median);
    expect(measured.median).toBeLessThanOrEqual(measured.high);
    expect(measured.clippedHigh).toBe(0);
    expect(measured.clippedLow).toBe(0);
  });

  it('a darker picture has a lower bright end and median; a flat one has all three together', () => {
    const normalStats = measureFrame(picture(W, H, scene), W, H);
    const dark = measureFrame(picture(W, H, scaled(scene, 0.4)), W, H);
    expect(dark.high).toBeLessThan(normalStats.high * 0.5);
    expect(dark.median).toBeLessThan(normalStats.median * 0.5);

    const grey = measureFrame(picture(W, H, () => [128, 128, 128]), W, H);
    expect(grey.low).toBeCloseTo(128 / 255, 2);
    expect(grey.median).toBeCloseTo(128 / 255, 2);
    expect(grey.high).toBeCloseTo(128 / 255, 2);
  });

  it('counts pixels at full black and at full scale', () => {
    const clipped = measureFrame(
      picture(W, H, (x) => (x < W / 4 ? [0, 0, 0] : x >= (3 * W) / 4 ? [255, 255, 255] : [120, 120, 120])),
      W,
      H,
    );
    expect(clipped.clippedLow).toBeCloseTo(0.25, 1);
    expect(clipped.clippedHigh).toBeCloseTo(0.25, 1);
  });

  it('measures only inside the picture rectangle: bars do not count', () => {
    const letterboxed = picture(W, H, (x, y) => (y < 40 || y >= H - 40 ? [0, 0, 0] : [150, 150, 150]));
    const whole = measureFrame(letterboxed, W, H);
    const inside = measureFrame(letterboxed, W, H, { x: 0, y: 40, width: W, height: H - 80 });
    expect(whole.low).toBe(0);
    expect(inside.low).toBeCloseTo(150 / 255, 2);
    expect(inside.clippedLow).toBe(0);
  });

  it('says how much of the picture sits on one flat luminance (graphics, not a camera)', () => {
    const camera = measureFrame(picture(W, H, scene), W, H);
    const screen = measureFrame(
      picture(W, H, (x, y) => (x > 40 && x < 90 && y > 30 && y < 60 ? [240, 240, 240] : [40, 30, 70])),
      W,
      H,
    );
    expect(camera.flat).toBeLessThan(0.15);
    expect(screen.flat).toBeGreaterThan(0.8);
    expect(cameraShare(camera)).toBe(1);
    expect(cameraShare(screen)).toBe(0);
  });
});

describe('measureFrame: colour', () => {
  it('finds no cast in a neutral picture and the right one in a tinted picture', () => {
    const neutral = measureFrame(picture(W, H, scene), W, H);
    expect(neutral.greyWorld?.[0]).toBeCloseTo(1, 2);
    expect(neutral.greyWorld?.[2]).toBeCloseTo(1, 2);
    expect(measuredCast(neutral, 0.3)).toEqual([0, 0, 0]);

    // Warm: red up, blue down, in linear light.
    const warm = measureFrame(
      picture(W, H, (x, y) => {
        const [v] = scene(x, y);
        const light = srgbToLinear(v / 255);
        return [linearToSrgb(Math.min(1, light * 1.2)) * 255, v, linearToSrgb(light * 0.8) * 255];
      }),
      W,
      H,
    );
    const cast = measuredCast(warm, 0.5);
    expect(cast[0]).toBeGreaterThan(0.1);
    expect(cast[2]).toBeLessThan(-0.1);
    expect(warm.saturation).toBeGreaterThan(neutral.saturation);
  });

  it('counts a cast only where the mid-tones and the bright end agree, and clamps it', () => {
    // A lawn: green mid-tones, neutral highlights. Not a cast.
    expect(measuredCast(stats({ greyWorld: [0.8, 1.1, 0.7], whitePatch: [1, 1, 1] }), 0.3)).toEqual([0, 0, 0]);
    // Opposite signs: not a cast either.
    expect(measuredCast(stats({ greyWorld: [1.2, 1, 0.8], whitePatch: [0.9, 1, 1.1] }), 0.3)).toEqual([0, 0, 0]);
    // Agreement: the smaller of the two, never above the clamp.
    const agreed = measuredCast(stats({ greyWorld: [1.3, 0.98, 0.7], whitePatch: [1.1, 0.99, 0.6] }), 0.15);
    expect(agreed[0]).toBeCloseTo(0.1, 6);
    expect(agreed[2]).toBeCloseTo(-0.15, 6);
    // Nothing to judge by.
    expect(measuredCast(stats({ greyWorld: null }), 0.3)).toEqual([0, 0, 0]);
  });
});

describe('measureFrame: noise and sharpness', () => {
  it('estimates white noise within a fifth of its true size, and none on a clean picture', () => {
    for (const sigma of [4, 8, 14]) {
      const gauss = normal(rng(100 + sigma));
      const noisy = picture(W * 2, H * 2, (x, y) => {
        const base = 70 + 0.2 * x + 0.1 * y;
        return [base + sigma * gauss(), base + sigma * gauss(), base + sigma * gauss()];
      });
      // Independent noise on three channels: the luma noise is sqrt(sum of squared weights) of it.
      const lumaSigma = sigma * Math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2);
      const measured = measureFrame(noisy, W * 2, H * 2).noise;
      expect(measured / lumaSigma, `sigma ${sigma}`).toBeGreaterThan(0.8);
      expect(measured / lumaSigma, `sigma ${sigma}`).toBeLessThan(1.2);
    }
    expect(measureFrame(picture(W * 2, H * 2, (x, y) => [70 + 0.2 * x + 0.1 * y, 70 + 0.2 * x, 90]), W * 2, H * 2).noise).toBeLessThan(0.6);
  });

  it('rates one-pixel edges as sharp, wide edges as soft, and a picture without edges as unknown', () => {
    const edges = (softness: number): Painter => (x, y) => {
      // Vertical and horizontal bars; `softness` is the width of each edge in pixels.
      const ramp = (t: number) => Math.min(1, Math.max(0, 0.5 + t / Math.max(1e-6, softness)));
      const a = ramp(((x % 32) - 16) * (Math.floor(x / 32) % 2 === 0 ? 1 : -1));
      const b = ramp(((y % 24) - 12) * (Math.floor(y / 24) % 2 === 0 ? 1 : -1));
      const v = 60 + 130 * (0.5 * a + 0.5 * b);
      return [v, v, v];
    };
    const sharp = measureFrame(picture(W * 2, H * 2, edges(0.01)), W * 2, H * 2).sharpness;
    const soft = measureFrame(picture(W * 2, H * 2, edges(8)), W * 2, H * 2).sharpness;
    expect(sharp).not.toBeNull();
    expect(soft).not.toBeNull();
    expect(sharp as number).toBeGreaterThan(0.95);
    expect(soft as number).toBeLessThan(0.8);
    expect(measureFrame(picture(W * 2, H * 2, () => [128, 128, 128]), W * 2, H * 2).sharpness).toBeNull();
  });
});

/* -------------------------------------------------------------- tone curve */

describe('tone curve', () => {
  it('is the identity when nothing is asked', () => {
    for (let i = 0; i <= 100; i += 1) {
      const light = i / 100;
      expect(applyTone(light, NEUTRAL_TONE, shoulderOf(NEUTRAL_TONE))).toBeCloseTo(light, 12);
      expect(removeBlack(light, 0)).toBe(light);
    }
    expect(toneIsNeutral(NEUTRAL_TONE)).toBe(true);
    expect(toneLift(NEUTRAL_TONE)).toBeCloseTo(1, 12);
  });

  it('never blows highlights: whatever the gain, the result rises steadily and stops at white', () => {
    for (const gain of [1.2, 2, 3, 4]) {
      for (const gamma of [1, 0.8]) {
        const tone = { black: 0, gain, gamma };
        const shoulder = shoulderOf(tone);
        let previous = -1;
        for (let i = 0; i <= 1000; i += 1) {
          const out = applyTone(i / 1000, tone, shoulder);
          expect(out).toBeLessThanOrEqual(1);
          // Strictly rising: two different inputs never land on the same output (nothing is flattened).
          expect(out).toBeGreaterThan(previous);
          previous = out;
        }
        // Only white itself reaches white.
        expect(applyTone(1, tone, shoulder)).toBeCloseTo(1, 9);
        expect(applyTone(0.98, tone, shoulder)).toBeLessThan(0.9999);
      }
    }
  });

  it('is a plain gain below the knee and has no step at the knee', () => {
    const tone = { black: 0, gain: 2, gamma: 1 };
    const shoulder = shoulderOf(tone);
    expect(applyTone(0.1, tone, shoulder)).toBeCloseTo(0.2, 12);
    const at = SHOULDER_KNEE / 2;
    expect(applyTone(at + 1e-7, tone, shoulder) - applyTone(at - 1e-7, tone, shoulder)).toBeLessThan(1e-6);
    expect(toneLift(tone)).toBeCloseTo(2, 6);
  });

  it('never crushes blacks: the black level is removed softly and the order of tones is kept', () => {
    const black = 0.05;
    let previous = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const out = removeBlack(i / 1000, black);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeGreaterThan(previous);
      previous = out;
    }
    expect(removeBlack(1, black)).toBeCloseTo(1, 12);
    // Well above the black level it is the plain subtraction (rescaled to keep white white).
    expect(removeBlack(0.5, black)).toBeCloseTo((0.5 - black) / (1 - black), 2);
    // Below it, tones are still there: not all zero.
    expect(removeBlack(0.02, black)).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------- choosing: light */

describe('chooseTone', () => {
  it('does no harm: a healthy picture is not touched, at any strength', () => {
    for (const strength of ENHANCE_STRENGTHS) {
      expect(chooseTone(stats(), strength), strength).toEqual(NEUTRAL_TONE);
    }
    // Nearly healthy pictures neither: the bright end at 80 % and above needs no gain,
    // a dark end at 10 % and below has no black level to remove.
    expect(chooseTone(stats({ high: ENHANCE_TUNING.goodHigh, low: ENHANCE_TUNING.goodLow }), 'strong').gain).toBe(1);
    expect(chooseTone(stats({ high: ENHANCE_TUNING.goodHigh, low: ENHANCE_TUNING.goodLow }), 'strong').black).toBe(0);
  });

  it('brightens an underexposed picture, more the stronger the setting, never past the limits', () => {
    const dark = stats({ low: 0.02, median: 0.2, high: 0.4 });
    const light = chooseTone(dark, 'light');
    const auto = chooseTone(dark, 'auto');
    const strong = chooseTone(dark, 'strong');
    expect(light.gain).toBeGreaterThan(1.1);
    expect(auto.gain).toBeGreaterThan(light.gain);
    expect(strong.gain).toBeGreaterThanOrEqual(auto.gain);
    for (const strength of ENHANCE_STRENGTHS) {
      const limits = ENHANCE_TUNING.strengths[strength];
      const tone = chooseTone(stats({ low: 0, median: 0.05, high: 0.1 }), strength);
      expect(tone.gain).toBeLessThanOrEqual(limits.maxGain + 1e-9);
      expect(tone.gamma).toBeGreaterThanOrEqual(limits.minGamma - 1e-9);
      expect(tone.gamma).toBeLessThanOrEqual(1);
    }
  });

  it('never darkens: the gain is at least 1 whatever the histogram', () => {
    for (const high of [0.2, 0.5, 0.8, 0.95, 1]) {
      for (const median of [0.1, 0.4, 0.7, 0.95]) {
        for (const strength of ENHANCE_STRENGTHS) {
          expect(chooseTone(stats({ high, median: Math.min(median, high) }), strength).gain).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('the gain brings the bright end to its target and no further', () => {
    const dark = stats({ low: 0.02, median: 0.25, high: 0.5 });
    const tone = chooseTone(dark, 'strong');
    const after = tone.gain * srgbToLinear(dark.high);
    expect(linearToSrgb(after)).toBeLessThanOrEqual(ENHANCE_TUNING.highTarget + 1e-6);
  });

  it('a picture whose brightest part is grey but whose median is bright is not "dark" (a desk, fog)', () => {
    // The bright end alone would ask for a gain of about 1.9; the median says the picture is bright enough.
    expect(chooseTone(stats({ high: 0.68, median: 0.6 }), 'auto').gain).toBe(1);
    // With a dark median the same bright end does get its gain.
    expect(chooseTone(stats({ high: 0.68, median: 0.3 }), 'auto').gain).toBeGreaterThan(1.5);
  });

  it('removes a lifted black level only in part, and never more than the darkest tone itself', () => {
    const hazy = stats({ low: 0.25, median: 0.5, high: 0.85 });
    const auto = chooseTone(hazy, 'auto');
    const strong = chooseTone(hazy, 'strong');
    expect(auto.black).toBeGreaterThan(0.01);
    expect(strong.black).toBeGreaterThanOrEqual(auto.black);
    for (const strength of ENHANCE_STRENGTHS) {
      const tone = chooseTone(hazy, strength);
      expect(tone.black).toBeLessThanOrEqual(srgbToLinear(hazy.low));
      expect(tone.black).toBeLessThanOrEqual(ENHANCE_TUNING.strengths[strength].maxBlack);
    }
  });

  it('a picture with nothing dark in it (a page, snow) keeps its light: no black level is removed', () => {
    expect(chooseTone(stats({ low: 0.55, median: 0.8, high: 0.97 }), 'strong').black).toBe(0);
  });

  it('graphics are left alone: a flat background or very saturated colours switch the light correction off', () => {
    const darkScreen = stats({ low: 0.2, median: 0.25, high: 0.6, flat: 0.6 });
    const vivid = stats({ low: 0.2, median: 0.25, high: 0.6, saturation: 0.75 });
    for (const strength of ENHANCE_STRENGTHS) {
      expect(chooseTone(darkScreen, strength)).toEqual(NEUTRAL_TONE);
      expect(chooseTone(vivid, strength)).toEqual(NEUTRAL_TONE);
    }
    // The same histogram from a camera is corrected.
    expect(toneIsNeutral(chooseTone(stats({ low: 0.2, median: 0.25, high: 0.6 }), 'auto'))).toBe(false);
  });

  it('small corrections are dropped (dead bands), so nothing flickers around "almost fine"', () => {
    const slightlyDark = stats({ high: 0.79, median: 0.5 });
    expect(chooseTone(slightlyDark, 'auto').gain).toBe(1);
  });

  it('only "Güçlü" lifts dark mid-tones; "Otomatik" and "Hafif" leave a dark-but-full-range picture alone', () => {
    const lowKey = stats({ low: 0.01, median: 0.15, high: 0.97 });
    expect(chooseTone(lowKey, 'light')).toEqual(NEUTRAL_TONE);
    expect(chooseTone(lowKey, 'auto')).toEqual(NEUTRAL_TONE);
    const strong = chooseTone(lowKey, 'strong');
    expect(strong.gain).toBe(1);
    expect(strong.gamma).toBeLessThan(1);
  });
});

/* -------------------------------------------------- choosing: colour, detail */

describe('chooseLook', () => {
  it('does no harm: a healthy, sharp, clean picture gets nothing', () => {
    for (const strength of ENHANCE_STRENGTHS) {
      const look = chooseLook(stats({ saturation: 0.4 }), strength);
      expect(lookIsNeutral(look), strength).toBe(true);
      expect(look.whiteBalance).toEqual([1, 1, 1]);
    }
  });

  it('white balance: gentle, clamped, and it keeps the luminance of grey', () => {
    const cast = stats({ greyWorld: [1.3, 1, 0.7], whitePatch: [1.3, 1, 0.7] });
    // "Hafif" leaves the colour balance alone.
    expect(chooseLook(cast, 'light').whiteBalance).toEqual([1, 1, 1]);
    for (const strength of ['auto', 'strong'] as const) {
      const limits = ENHANCE_TUNING.strengths[strength];
      const [r, g, b] = chooseLook(cast, strength).whiteBalance;
      // Red is turned down, blue up.
      expect(r).toBeLessThan(1);
      expect(b).toBeGreaterThan(1);
      // Never more than the clamp times the share.
      const most = limits.maxCast * limits.whiteBalance;
      expect(1 / r - 1).toBeLessThanOrEqual(most + 0.02);
      expect(1 - 1 / b).toBeLessThanOrEqual(most + 0.02);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 9);
    }
    // "Otomatik" changes no channel by more than about 4 %.
    const auto = chooseLook(cast, 'auto').whiteBalance;
    for (const gain of auto) expect(Math.abs(gain - 1)).toBeLessThan(0.045);
  });

  it('a cast too small to see is not corrected', () => {
    const tiny = stats({ greyWorld: [1.02, 1, 0.98], whitePatch: [1.02, 1, 0.98] });
    expect(chooseLook(tiny, 'auto').whiteBalance).toEqual([1, 1, 1]);
  });

  it('colour lift: only for dull pictures, small, and none for vivid ones', () => {
    expect(chooseLook(stats({ saturation: 0.05 }), 'auto').vibrance).toBeGreaterThan(0.1);
    expect(chooseLook(stats({ saturation: 0.05 }), 'auto').vibrance).toBeLessThanOrEqual(ENHANCE_TUNING.strengths.auto.vibrance);
    expect(chooseLook(stats({ saturation: ENHANCE_TUNING.vividSaturation }), 'strong').vibrance).toBe(0);
    expect(chooseLook(stats({ saturation: 0.05 }), 'strong').vibrance).toBeGreaterThan(
      chooseLook(stats({ saturation: 0.05 }), 'auto').vibrance,
    );
  });

  it('noise filter: off below the floor, its range follows the noise and is capped', () => {
    expect(chooseLook(stats({ noise: ENHANCE_TUNING.noiseFloor }), 'strong').denoise).toBe(0);
    const some = chooseLook(stats({ noise: 6 }), 'auto').denoise * 255;
    const more = chooseLook(stats({ noise: 10 }), 'auto').denoise * 255;
    expect(some).toBeCloseTo(6 * ENHANCE_TUNING.strengths.auto.denoise, 6);
    expect(more).toBeGreaterThan(some);
    expect(chooseLook(stats({ noise: 40 }), 'strong').denoise * 255).toBeLessThanOrEqual(ENHANCE_TUNING.maxDenoiseSigma);
  });

  it('sharpening: by how soft the picture is; none when it is sharp, unknown or noisy', () => {
    expect(chooseLook(stats({ sharpness: ENHANCE_TUNING.sharpEnough }), 'strong').sharpen).toBe(0);
    expect(chooseLook(stats({ sharpness: null }), 'strong').sharpen).toBe(0);
    const soft = chooseLook(stats({ sharpness: ENHANCE_TUNING.softest, noise: 0 }), 'auto');
    expect(soft.sharpen).toBeCloseTo(ENHANCE_TUNING.strengths.auto.sharpen, 6);
    const halfSoft = chooseLook(stats({ sharpness: (ENHANCE_TUNING.softest + ENHANCE_TUNING.sharpEnough) / 2, noise: 0 }), 'auto');
    expect(halfSoft.sharpen).toBeGreaterThan(0);
    expect(halfSoft.sharpen).toBeLessThan(soft.sharpen);
    // Noise is not sharpened: what the filter leaves of it switches the sharpening off.
    expect(chooseLook(stats({ sharpness: ENHANCE_TUNING.softest, noise: 14 }), 'strong').sharpen).toBe(0);
    // And what is sharpened starts above the noise.
    const grainy = chooseLook(stats({ sharpness: ENHANCE_TUNING.softest, noise: 1.2 }), 'auto');
    expect(grainy.sharpenThreshold).toBeGreaterThan(soft.sharpenThreshold);
    expect(grainy.sharpen).toBeLessThan(soft.sharpen);
  });

  it('graphics: no white balance and no colour lift either', () => {
    const screen = stats({ flat: 0.7, saturation: 0.1, greyWorld: [0.8, 0.9, 1.6], whitePatch: [0.8, 0.9, 1.6] });
    const look = chooseLook(screen, 'strong');
    expect(look.whiteBalance).toEqual([1, 1, 1]);
    expect(look.vibrance).toBe(0);
  });
});

/* ---------------------------------------------- "does no harm" on real stats */

describe('"does no harm" guard', () => {
  /**
   * The typical measurements of the good real recordings of the test folder
   * (R10, R12, R15 of ADR-037: phone footage, well exposed and sharp).
   */
  const goodPhoneVideos: FrameStats[] = [
    stats({ flat: 0.044, low: 0.024, median: 0.565, high: 0.898, saturation: 0.263, noise: 0.15, sharpness: 1.255, greyWorld: [0.72, 1.07, 1.13], whitePatch: [0.76, 1.06, 1.16] }),
    stats({ flat: 0.038, low: 0.047, median: 0.576, high: 0.969, saturation: 0.34, noise: 0.2, sharpness: 1.38, greyWorld: [0.72, 1.04, 1.5], whitePatch: [0.87, 1.03, 1.21] }),
    stats({ flat: 0.039, low: 0.039, median: 0.443, high: 0.804, saturation: 0.257, noise: 0.47, sharpness: 1.246, greyWorld: [0.86, 1.02, 1.34], whitePatch: [0.79, 1.03, 1.42] }),
  ];

  it('a good video keeps its light, its sharpness and its grain; "Otomatik" moves no colour channel by more than 5 %', () => {
    for (const typical of goodPhoneVideos) {
      const points: AnalysisPoint[] = [0, 30, 60, 90].map((frame) => ({ frame, stats: typical }));
      for (const strength of ['light', 'auto'] as const) {
        const timeline = planEnhancement(points, strength, 30);
        for (const { tone } of timeline.tones) expect(tone, strength).toEqual(NEUTRAL_TONE);
        expect(timeline.look.sharpen).toBe(0);
        expect(timeline.look.denoise).toBe(0);
        for (const gain of timeline.look.whiteBalance) expect(Math.abs(gain - 1)).toBeLessThan(0.05);
        expect(timeline.look.vibrance).toBeLessThan(0.06);
        expect(summarize(timeline).light).toBe('none');
      }
    }
  });

  it('a video with nothing to fix comes out bit for bit as it went in', () => {
    const timeline = planEnhancement([{ frame: 0, stats: stats({ saturation: 0.4 }) }], 'auto', 30);
    expect(summarize(timeline).nothing).toBe(true);
    const src = picture(96, 64, scene);
    const { out } = renderEnhanced(src, 96, 64, paramsAtFrame(timeline, 0));
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  it('a screen recording with a dark, colourful background is not "fixed"', () => {
    const screen = stats({ flat: 0.26, low: 0.255, median: 0.325, high: 1, saturation: 0.74, noise: 0, sharpness: 1.1, greyWorld: [0.92, 0.51, 6.55], whitePatch: [0.97, 0.75, 3.38] });
    for (const strength of ENHANCE_STRENGTHS) {
      expect(summarize(planEnhancement([{ frame: 0, stats: screen }], strength, 30)).nothing, strength).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------- timeline */

describe('analysisFrames', () => {
  it('takes the first and last frame of every moment and frames in between, half a second apart at the closest', () => {
    const frames = analysisFrames([{ startFrame: 0, endFrame: 90 }], 30);
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(89);
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
    expect(new Set(frames).size).toBe(frames.length);
    for (let i = 1; i < frames.length - 1; i += 1) {
      expect((frames[i] ?? 0) - (frames[i - 1] ?? 0)).toBeGreaterThanOrEqual(30 * ANALYSIS_SPACING_SECONDS - 1);
    }
  });

  it('stays within the budget however long the video is', () => {
    const hour = analysisFrames([{ startFrame: 0, endFrame: 108_000 }], 30);
    expect(hour.length).toBeLessThanOrEqual(MAX_ANALYSIS_POINTS + 1);
    expect(hour.length).toBeGreaterThan(MAX_ANALYSIS_POINTS / 2);
    expect(hour[0]).toBe(0);
    expect(hour[hour.length - 1]).toBe(107_999);
  });

  it('pins both sides of every cut between moments, and handles a one-frame moment', () => {
    const frames = analysisFrames(
      [
        { startFrame: 0, endFrame: 45 },
        { startFrame: 45, endFrame: 46 },
        { startFrame: 46, endFrame: 200 },
      ],
      30,
    );
    for (const frame of [0, 44, 45, 46, 199]) expect(frames).toContain(frame);
    expect(new Set(frames).size).toBe(frames.length);
    expect(analysisFrames([], 30)).toEqual([]);
    expect(analysisFrames([{ startFrame: 10, endFrame: 10 }], 30)).toEqual([]);
  });
});

describe('frameToRefine: looking closer where the light changes', () => {
  const dark = stats({ low: 0.02, median: 0.2, high: 0.45 });
  const bright = stats();

  /** Analyses the frames `frameToRefine` asks for until it asks for none, as the worker does. */
  function refine(points: AnalysisPoint[], statsAt: (frame: number) => FrameStats): { points: AnalysisPoint[]; looked: number } {
    const sorted = [...points].sort((a, b) => a.frame - b.frame);
    let looked = 0;
    for (;;) {
      const frame = frameToRefine(sorted);
      if (frame === null || looked >= REFINE_BUDGET) return { points: sorted, looked };
      sorted.push({ frame, stats: statsAt(frame) });
      sorted.sort((a, b) => a.frame - b.frame);
      looked += 1;
    }
  }

  it('asks for nothing when neighbouring analysed frames would be corrected alike', () => {
    const steady = Array.from({ length: 10 }, (_, i) => ({ frame: i * 15, stats: dark }));
    expect(frameToRefine(steady)).toBeNull();
    expect(toneDistance(dark, dark)).toBe(0);
    expect(toneDistance(dark, bright)).toBeGreaterThan(1);
    // Two healthy pictures that differ in everything but their need for correction: nothing to look for.
    expect(toneDistance(stats({ median: 0.4 }), stats({ median: 0.6, saturation: 0.1 }))).toBe(0);
  });

  it('narrows a sudden change down to the two frames it happens between, in a handful of looks', () => {
    // The light goes on at frame 173; frames were analysed every 15.
    const statsAt = (frame: number) => (frame < 173 ? dark : bright);
    const base = Array.from({ length: 21 }, (_, i) => ({ frame: i * 15, stats: statsAt(i * 15) }));
    expect(frameToRefine(base)).toBe(172);
    const { points, looked } = refine(base, statsAt);
    expect(looked).toBeLessThanOrEqual(4);
    const frames = points.map((point) => point.frame);
    expect(frames).toContain(172);
    expect(frames).toContain(173);

    // The correction then switches exactly there: no brightening of the bright side before, no dark frame after.
    const timeline = planEnhancement(points, 'auto', 30);
    const gain = chooseTone(dark, 'auto').gain;
    for (let frame = 150; frame <= 172; frame += 1) expect(toneAtFrame(timeline, frame).gain).toBeCloseTo(gain, 2);
    for (let frame = 173; frame <= 200; frame += 1) expect(toneAtFrame(timeline, frame).gain).toBe(1);
  });

  it('without the closer look the correction would be blended across the change (what the look prevents)', () => {
    const statsAt = (frame: number) => (frame < 173 ? dark : bright);
    const base = Array.from({ length: 21 }, (_, i) => ({ frame: i * 15, stats: statsAt(i * 15) }));
    const blended = planEnhancement(base, 'auto', 30);
    // Frame 176 is already bright, yet half-way between the two analysed frames it would still be gained up.
    expect(toneAtFrame(blended, 176).gain).toBeGreaterThan(1.2);
  });

  it('gives a quick but gradual change as many analysed frames as it takes to follow it', () => {
    // The exposure doubles and doubles again over two seconds.
    const statsAt = (frame: number): FrameStats => {
      const share = Math.min(1, Math.max(0, (frame - 60) / 60));
      return stats({ low: 0.02, median: 0.2 + 0.3 * share, high: 0.4 + 0.53 * share });
    };
    const base = Array.from({ length: 13 }, (_, i) => ({ frame: i * 15, stats: statsAt(i * 15) }));
    const { points, looked } = refine(base, statsAt);
    expect(looked).toBeGreaterThan(2);
    expect(looked).toBeLessThan(REFINE_BUDGET);
    // Afterwards no two neighbours differ noticeably, so blending between them is invisible.
    for (let i = 1; i < points.length; i += 1) {
      const left = points[i - 1];
      const right = points[i];
      if (!left || !right || right.frame - left.frame < 2) continue;
      expect(toneDistance(left.stats, right.stats)).toBeLessThanOrEqual(1);
    }
    // And the gain comes down steadily over the change.
    const timeline = planEnhancement(points, 'auto', 30);
    let previous = Number.POSITIVE_INFINITY;
    for (let frame = 55; frame <= 125; frame += 1) {
      const gain = toneAtFrame(timeline, frame).gain;
      expect(gain).toBeLessThanOrEqual(previous + 1e-9);
      previous = gain;
    }
  });

  it('skips a middle frame that could not be decoded instead of asking for it for ever', () => {
    const points = [
      { frame: 0, stats: dark },
      { frame: 30, stats: bright },
    ];
    expect(frameToRefine(points)).toBe(15);
    expect(frameToRefine(points, new Set([15]))).toBeNull();
    // Frames next to each other have nothing in between.
    expect(frameToRefine([{ frame: 10, stats: dark }, { frame: 11, stats: bright }])).toBeNull();
  });
});

describe('a device without a graphics card is told so', () => {
  it('knows the software rasterisers by name', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(true);
    expect(isSoftwareRenderer('Google SwiftShader')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti (0x00002482) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareRenderer('Adreno (TM) 740')).toBe(false);
    expect(isSoftwareRenderer('Apple M2')).toBe(false);
    // The browser does not say: no warning without evidence.
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });

  it('estimates from the measured cost per frame: five minutes of 1080p is more than half an hour', () => {
    // Measured (ADR-037): 9001 frames of 1080p took 2162 s on software WebGL.
    const estimate = slowEnhanceSeconds(9001, 1920, 1080);
    expect(estimate).toBeGreaterThan(30 * 60);
    expect(estimate).toBeLessThan(45 * 60);
    expect(Math.abs(estimate - 2162) / 2162).toBeLessThan(0.1);
    // Fewer pixels, less time, in proportion; nothing for nothing.
    expect(slowEnhanceSeconds(9001, 1280, 720)).toBeCloseTo(estimate * (1280 * 720) / (1920 * 1080), 6);
    expect(slowEnhanceSeconds(0, 1920, 1080)).toBe(0);
  });

  it('says how long only when it is long enough to matter, in minutes and then in hours', () => {
    expect(slowEnhanceNotice(0)).toEqual({ kind: 'general' });
    expect(slowEnhanceNotice(60)).toEqual({ kind: 'general' });
    expect(slowEnhanceNotice(61)).toEqual({ kind: 'minutes', n: 2 });
    expect(slowEnhanceNotice(slowEnhanceSeconds(9001, 1920, 1080))).toEqual({ kind: 'minutes', n: 38 });
    expect(slowEnhanceNotice(119 * 60)).toEqual({ kind: 'minutes', n: 119 });
    expect(slowEnhanceNotice(120 * 60)).toEqual({ kind: 'hours', n: 2 });
    // An hour of 1080p at 30 frames a second.
    expect(slowEnhanceNotice(slowEnhanceSeconds(108_000, 1920, 1080))).toEqual({ kind: 'hours', n: 8 });
  });
});

describe('planEnhancement: no flicker', () => {
  const dark = stats({ low: 0.02, median: 0.2, high: 0.45 });

  it('a steady video gets one steady correction', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ frame: i * 15, stats: dark }));
    const timeline = planEnhancement(points, 'auto', 30);
    const gains = new Set(timeline.tones.map(({ tone }) => tone.gain.toFixed(9)));
    expect(gains.size).toBe(1);
    for (let frame = 0; frame < 300; frame += 7) {
      expect(toneAtFrame(timeline, frame).gain).toBeCloseTo(timeline.tones[0]?.tone.gain ?? 0, 9);
    }
  });

  it('one odd frame among like frames does not make the brightness jump', () => {
    const points: AnalysisPoint[] = Array.from({ length: 21 }, (_, i) => ({ frame: i * 15, stats: dark }));
    // One analysed frame with a much brighter top (a glint), the same scene otherwise.
    points[10] = { frame: 150, stats: { ...dark, high: 0.9 } };
    const alone = chooseTone(points[10].stats, 'auto').gain;
    const usual = chooseTone(dark, 'auto').gain;
    expect(alone).toBeLessThan(usual * 0.5);
    const timeline = planEnhancement(points, 'auto', 30);
    const at = toneAtFrame(timeline, 150).gain;
    // Pulled most of the way back to its neighbours'.
    expect(at).toBeGreaterThan(usual * 0.8);
    // And from one output frame to the next the gain never moves by more than 1 %.
    for (let frame = 1; frame < 300; frame += 1) {
      const step = toneAtFrame(timeline, frame).gain / toneAtFrame(timeline, frame - 1).gain;
      expect(Math.abs(Math.log(step))).toBeLessThan(0.01);
    }
  });

  it('a slow change of exposure is followed smoothly', () => {
    const points = Array.from({ length: 41 }, (_, i) => {
      const share = i / 40;
      return { frame: i * 15, stats: stats({ low: 0.02, median: 0.2 + 0.3 * share, high: 0.45 + 0.48 * share }) };
    });
    const timeline = planEnhancement(points, 'auto', 30);
    expect(toneAtFrame(timeline, 0).gain).toBeGreaterThan(2);
    expect(toneAtFrame(timeline, 600).gain).toBe(1);
    let previous = toneAtFrame(timeline, 0).gain;
    for (let frame = 1; frame <= 600; frame += 1) {
      const gain = toneAtFrame(timeline, frame).gain;
      // Only ever down, never by more than 1 % a frame.
      expect(gain).toBeLessThanOrEqual(previous + 1e-9);
      expect(previous / gain).toBeLessThan(1.01);
      previous = gain;
    }
  });

  it('two different scenes each keep their own correction (they are not averaged into each other)', () => {
    const bright = stats();
    const points = [
      ...Array.from({ length: 10 }, (_, i) => ({ frame: i * 15, stats: dark })),
      ...Array.from({ length: 10 }, (_, i) => ({ frame: 150 + i * 15, stats: bright })),
    ];
    const timeline = planEnhancement(points, 'auto', 30);
    expect(toneAtFrame(timeline, 60).gain).toBeCloseTo(chooseTone(dark, 'auto').gain, 2);
    expect(toneAtFrame(timeline, 240).gain).toBe(1);
    // The change happens between the two analysed frames around the cut, nowhere else.
    expect(toneAtFrame(timeline, 135).gain).toBeCloseTo(chooseTone(dark, 'auto').gain, 2);
    expect(toneAtFrame(timeline, 150).gain).toBe(1);
  });

  it('colour and detail are decided once for the whole video', () => {
    const points = Array.from({ length: 9 }, (_, i) => ({
      frame: i * 30,
      stats: stats({ sharpness: i === 4 ? 0.7 : 1.3, noise: i === 2 ? 9 : 0.3, saturation: 0.1 + 0.02 * i }),
    }));
    const timeline = planEnhancement(points, 'auto', 30);
    // The middle value decides: one soft or noisy frame switches nothing on.
    expect(timeline.look.sharpen).toBe(0);
    expect(timeline.look.denoise).toBe(0);
    expect(paramsAtFrame(timeline, 0).vibrance).toBe(paramsAtFrame(timeline, 240).vibrance);
    expect(typicalStats(points.map((point) => point.stats))?.saturation).toBeCloseTo(0.18, 9);
  });

  it('before the first and after the last analysed frame the nearest one holds; with none, nothing is done', () => {
    const timeline = planEnhancement([{ frame: 30, stats: dark }, { frame: 60, stats: dark }], 'auto', 30);
    expect(toneAtFrame(timeline, 0)).toEqual(toneAtFrame(timeline, 30));
    expect(toneAtFrame(timeline, 900)).toEqual(toneAtFrame(timeline, 60));
    const empty = planEnhancement([], 'strong', 30);
    expect(paramsAtFrame(empty, 10)).toEqual(NEUTRAL_PARAMS);
    expect(summarize(empty).nothing).toBe(true);
    expect(typicalStats([])).toBeNull();
  });
});

describe('summarize', () => {
  it('says what the plan changes, in the words the screens use', () => {
    const dark = stats({ low: 0.02, median: 0.2, high: 0.45, sharpness: 0.75, noise: 12, saturation: 0.1 });
    const summary = summarize(planEnhancement([{ frame: 0, stats: dark }], 'auto', 30));
    expect(summary).toEqual({ light: 'much', colour: true, sharpen: false, denoise: true, nothing: false });
    const slightly = summarize(planEnhancement([{ frame: 0, stats: stats({ median: 0.4, high: 0.77 }) }], 'auto', 30));
    expect(slightly.light).toBe('some');
    const soft = summarize(planEnhancement([{ frame: 0, stats: stats({ sharpness: 0.78, saturation: 0.4 }) }], 'auto', 30));
    expect(soft).toEqual({ light: 'none', colour: false, sharpen: true, denoise: false, nothing: false });
  });
});

/* ------------------------------------------------------- reference renderer */

describe('renderEnhanced', () => {
  const src = picture(96, 64, (x, y) => {
    const [v] = scene(x * 2, y * 2);
    return [v * 0.9, v, v * 0.8];
  });

  it('changes nothing when nothing is asked, and leaves everything outside the rectangle alone', () => {
    expect(Array.from(renderEnhanced(src, 96, 64, NEUTRAL_PARAMS).out)).toEqual(Array.from(src));

    const rect = { x: 10, y: 8, width: 60, height: 40 };
    const params: EnhanceParams = { ...NEUTRAL_PARAMS, gain: 2, sharpen: 1.5, denoise: 8 / 255, vibrance: 0.2 };
    const { out } = renderEnhanced(src, 96, 64, params, rect);
    let changedInside = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const at = (y * 96 + x) * 4;
        const inside = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
        const same = out[at] === src[at] && out[at + 1] === src[at + 1] && out[at + 2] === src[at + 2];
        if (!inside) expect(same, `${x},${y}`).toBe(true);
        else if (!same) changedInside += 1;
        expect(out[at + 3]).toBe(255);
      }
    }
    expect(changedInside).toBeGreaterThan(rect.width * rect.height * 0.5);
  });

  it('writes in place exactly what it writes into a new buffer', () => {
    const params: EnhanceParams = { ...NEUTRAL_PARAMS, black: 0.02, gain: 1.6, gamma: 0.9, whiteBalance: [1.05, 0.99, 0.95], vibrance: 0.15, denoise: 6 / 255, sharpen: 1.2, sharpenThreshold: 1 / 255 };
    const fresh = renderEnhanced(src, 96, 64, params).out;
    const copy = src.slice();
    const again = renderEnhanced(copy, 96, 64, params, undefined, copy);
    expect(Array.from(copy)).toEqual(Array.from(fresh));
    // The scratch buffers are reused for the next frame of the same size.
    const third = renderEnhanced(src, 96, 64, params, undefined, new Uint8ClampedArray(src.length), again.scratch);
    expect(third.scratch).toBe(again.scratch);
    expect(Array.from(third.out)).toEqual(Array.from(fresh));
  });

  it('a gain brightens by the gain (in linear light) and keeps the hue', () => {
    const dark = picture(64, 48, () => [60, 80, 40]);
    const { out } = renderEnhanced(dark, 64, 48, { ...NEUTRAL_PARAMS, gain: 2 });
    const expected = [60, 80, 40].map((code) => Math.round(linearToSrgb(2 * srgbToLinear(code / 255)) * 255));
    expect([out[0], out[1], out[2]]).toEqual(expected);
  });

  it('a strong gain on a bright, coloured pixel pales it towards white instead of clipping a channel', () => {
    const bright = picture(64, 48, () => [250, 180, 60]);
    const { out } = renderEnhanced(bright, 64, 48, { ...NEUTRAL_PARAMS, gain: 3 });
    const [r = 0, g = 0, b = 0] = [out[0], out[1], out[2]];
    // The order of the channels (the hue) is kept, and the weakest channel is lifted: paler, not clipped flat.
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(60);
    // A gradient under the same gain still has distinct steps at its bright end.
    const ramp = picture(256, 4, (x) => [x, x, x]);
    const toned = renderEnhanced(ramp, 256, 4, { ...NEUTRAL_PARAMS, gain: 3 }).out;
    let distinct = 0;
    for (let x = 201; x < 256; x += 1) if ((toned[x * 4] ?? 0) > (toned[(x - 1) * 4] ?? 0)) distinct += 1;
    // Without the shoulder every one of these 55 steps would be the same full white.
    expect(distinct).toBeGreaterThanOrEqual(8);
    expect(toned[255 * 4]).toBe(255);
    expect(toned[200 * 4]).toBeLessThan(250);
  });

  it('white balance moves a tinted grey towards neutral without changing its luminance much', () => {
    const tinted = picture(64, 48, () => [150, 128, 105]);
    const look = chooseLook(stats({ greyWorld: [1.3, 0.98, 0.7], whitePatch: [1.3, 0.98, 0.7] }), 'strong');
    const { out } = renderEnhanced(tinted, 64, 48, { ...NEUTRAL_PARAMS, whiteBalance: look.whiteBalance });
    expect((out[0] ?? 0) - (out[2] ?? 0)).toBeLessThan(150 - 105);
    expect(Math.abs(meanLuma(out) - meanLuma(tinted))).toBeLessThan(2);
  });

  it('the colour lift adds saturation to dull colours and leaves grey grey', () => {
    const dull = picture(64, 48, () => [140, 128, 118]);
    const { out } = renderEnhanced(dull, 64, 48, { ...NEUTRAL_PARAMS, vibrance: 0.3 });
    expect((out[0] ?? 0) - (out[2] ?? 0)).toBeGreaterThan(140 - 118);
    const grey = picture(64, 48, () => [128, 128, 128]);
    expect(Array.from(renderEnhanced(grey, 64, 48, { ...NEUTRAL_PARAMS, vibrance: 0.3 }).out)).toEqual(Array.from(grey));
  });

  it('sharpening steepens an edge and never leaves the range the pixel\'s neighbours hold: no halo', () => {
    // A soft vertical edge from 60 to 180: an S-shaped rise over about eight pixels, as a blur leaves it.
    const edge = picture(64, 16, (x) => {
      const v = 60 + 120 / (1 + Math.exp(-(x - 31.5) / 1.6));
      return [v, v, v];
    });
    const { out } = renderEnhanced(edge, 64, 16, { ...NEUTRAL_PARAMS, sharpen: 2.5 });
    const row = (data: Uint8ClampedArray | Uint8Array) => Array.from({ length: 64 }, (_, x) => data[(8 * 64 + x) * 4] ?? 0);
    const before = row(edge);
    const after = row(out);
    // Nothing above the bright side or below the dark side: no pixel leaves the range the picture had.
    expect(Math.max(...after)).toBeLessThanOrEqual(Math.max(...before));
    expect(Math.min(...after)).toBeGreaterThanOrEqual(Math.min(...before));
    // Still rising from left to right.
    for (let x = 1; x < 64; x += 1) expect(after[x] ?? 0).toBeGreaterThanOrEqual(after[x - 1] ?? 0);
    // And the edge is steeper: the largest step between neighbours grew.
    const steepest = (values: number[]) => Math.max(...values.slice(1).map((value, i) => value - (values[i] ?? 0)));
    expect(steepest(after)).toBeGreaterThan(steepest(before));
    // Flat areas are untouched.
    expect(after[5]).toBe(before[5]);
    expect(after[60]).toBe(before[60]);
  });

  it('detail below the threshold is not sharpened (noise is not amplified)', () => {
    const gauss = normal(rng(5));
    const grain = picture(96, 64, () => {
      const v = 120 + 2 * gauss();
      return [v, v, v];
    });
    const { out } = renderEnhanced(grain, 96, 64, { ...NEUTRAL_PARAMS, sharpen: 2.5, sharpenThreshold: 8 / 255 });
    expect(Array.from(out)).toEqual(Array.from(grain));
  });

  it('the noise filter calms a flat noisy area and keeps a strong edge where it is', () => {
    const gauss = normal(rng(9));
    const noisy = picture(96, 64, (x) => {
      const v = (x < 48 ? 70 : 170) + 6 * gauss();
      return [v, v, v];
    });
    const { out } = renderEnhanced(noisy, 96, 64, { ...NEUTRAL_PARAMS, denoise: 12 / 255 });
    const spread = (data: Uint8ClampedArray | Uint8Array, x0: number, x1: number) => {
      const values: number[] = [];
      for (let y = 4; y < 60; y += 1) for (let x = x0; x < x1; x += 1) values.push(data[(y * 96 + x) * 4] ?? 0);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { mean, sd: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) };
    };
    expect(spread(out, 4, 40).sd).toBeLessThan(spread(noisy, 4, 40).sd * 0.5);
    // The two sides keep their levels, and the edge is still one pixel wide.
    expect(spread(out, 4, 40).mean).toBeCloseTo(70, 0);
    expect(spread(out, 56, 92).mean).toBeCloseTo(170, 0);
    expect((out[(32 * 96 + 48) * 4] ?? 0) - (out[(32 * 96 + 47) * 4] ?? 0)).toBeGreaterThan(70);
  });

  it('filters do not read across the rectangle\'s edge: black bars do not bleed into the picture', () => {
    const boxed = picture(96, 64, (x, y) => (y < 16 || y >= 48 ? [0, 0, 0] : [150, 150, 150]));
    const rect = { x: 0, y: 16, width: 96, height: 32 };
    const { out } = renderEnhanced(boxed, 96, 64, { ...NEUTRAL_PARAMS, denoise: 200 / 255, sharpen: 2 }, rect);
    // The first and last row of the picture are still the picture's own grey.
    expect(out[(16 * 96 + 40) * 4]).toBe(150);
    expect(out[(47 * 96 + 40) * 4]).toBe(150);
    expect(out[(15 * 96 + 40) * 4]).toBe(0);
  });
});
