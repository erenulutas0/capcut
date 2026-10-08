/**
 * "İyileştir" (ADR-037, 8 Oct 2026): a small change in what was measured
 * gives a small change in what is done.
 *
 * The finding these tests exist for: two test videos generated from the same
 * recipe (same scene, different grain) were treated visibly differently — a
 * well-exposed stretch was left alone in one (+3 levels) and lifted in the
 * other (+6). Two causes, both tested here without any video file:
 *
 * - dead bands were steps ("a gain below 10 % is not made"), so a gain of
 *   1.09 or 1.11 — the same to any measurement — meant nothing or +10 %;
 * - the smoothing over time averaged a frame's correction with every
 *   neighbour that looked alike, without limit, so a well-exposed stretch
 *   inherited a share of the gain of the brightening stretch before it —
 *   about a tenth, exactly where that step was.
 */
import { describe, expect, it } from 'vitest';

import {
  ENHANCE_STRENGTHS,
  ENHANCE_TUNING,
  REFINE_BUDGET,
  analysisFrames,
  chooseLook,
  chooseTone,
  fadeIn,
  frameToRefine,
  planEnhancement,
  toneAtFrame,
  toneGap,
  toneIsNeutral,
  toneLift,
  type AnalysisPoint,
  type FrameStats,
} from '@/domain/enhance';

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
    saturation: 0.25,
    noise: 0.5,
    sharpness: 1.2,
    ...patch,
  };
}

/** A small deterministic generator (mulberry32): the same "grain" on every run. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HALF_LEVEL = 1 / 510;

describe('fadeIn: a dead band without a step', () => {
  it('is nothing inside the band, continuous at its edge, never steeper than 2, and the value itself far above', () => {
    const dead = 0.1;
    expect(fadeIn(0, dead)).toBe(0);
    expect(fadeIn(dead, dead)).toBe(0);
    expect(fadeIn(dead * 0.999, dead)).toBe(0);
    expect(fadeIn(dead * 1.0001, dead)).toBeLessThan(dead * 0.001);
    let previous = 0;
    for (let value = 0; value <= 1; value += 0.0005) {
      const now = fadeIn(value, dead);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now - previous).toBeLessThanOrEqual(2 * 0.0005 + 1e-12);
      expect(now).toBeLessThanOrEqual(value);
      previous = now;
    }
    expect(fadeIn(2 * dead, dead)).toBeCloseTo(2 * dead - dead / Math.E, 12);
    expect(fadeIn(1, dead)).toBeGreaterThan(0.9999);
    // No band: the value itself.
    expect(fadeIn(0.3, 0)).toBe(0.3);
  });
});

describe('chooseTone: half an 8-bit level in a measurement never switches a correction on or off', () => {
  it('over every camera-like histogram and every strength, the correction moves by less than half a just-noticeable step', () => {
    let worst = 0;
    for (const strength of ENHANCE_STRENGTHS) {
      for (let low = 0; low <= 0.3; low += 0.01) {
        // A camera picture has tones between its darkest and its middle, and between its middle and its brightest.
        for (let median = low + 0.1; median <= 0.85; median += 0.02) {
          for (let high = median + 0.1; high <= 1; high += 0.01) {
            const here = stats({ low, median, high });
            const tone = chooseTone(here, strength);
            for (const key of ['low', 'median', 'high'] as const) {
              const moved = chooseTone({ ...here, [key]: here[key] + HALF_LEVEL }, strength);
              worst = Math.max(worst, toneGap(tone, moved));
            }
          }
        }
      }
    }
    // With the old steps this was 0.84 (a gain of 1.10 appearing at once) and 1 (a gamma of 0.96).
    expect(worst).toBeLessThan(0.5);
  });

  it('a gain just past its dead band is a fraction of a per cent, not ten per cent', () => {
    // The bright end a little short of where a gain starts to be wanted: walk it down level by level.
    let previous = 1;
    let largestStep = 0;
    for (let high = 0.8; high >= 0.6; high -= 1 / 255) {
      const { gain } = chooseTone(stats({ median: 0.3, high }), 'auto');
      expect(gain).toBeGreaterThanOrEqual(previous - 1e-12);
      largestStep = Math.max(largestStep, gain / previous);
      previous = gain;
    }
    expect(previous).toBeGreaterThan(1.3);
    // One level of the bright end never changes the gain by more than 6 %.
    expect(largestStep).toBeLessThan(1.06);
  });
});

describe('chooseLook: colour, grain and sharpening fade in', () => {
  it('a tiny change in saturation, noise, sharpness or cast gives a tiny change in what is done', () => {
    const worst = { whiteBalance: 0, vibrance: 0, denoise: 0, sharpen: 0 };
    for (const strength of ENHANCE_STRENGTHS) {
      for (let saturation = 0; saturation <= 0.7; saturation += 0.02) {
        for (let noise = 0; noise <= 8; noise += 0.2) {
          for (let sharpness = 0.6; sharpness <= 1.3; sharpness += 0.05) {
            for (const cast of [0, 0.03, 0.06, 0.1, 0.2]) {
              const tinted = (extra: number): Pick<FrameStats, 'greyWorld' | 'whitePatch'> => ({
                greyWorld: [1 + cast + extra, 1, 1 - cast],
                whitePatch: [1 + cast + extra, 1, 1 - cast],
              });
              const here = stats({ saturation, noise, sharpness, ...tinted(0) });
              const look = chooseLook(here, strength);
              const variants: FrameStats[] = [
                { ...here, saturation: saturation + 0.002 },
                { ...here, noise: noise + 0.02 },
                { ...here, sharpness: sharpness + 0.004 },
                { ...here, ...tinted(0.002) },
              ];
              for (const variant of variants) {
                const moved = chooseLook(variant, strength);
                worst.whiteBalance = Math.max(worst.whiteBalance, ...look.whiteBalance.map((gain, i) => Math.abs(gain - (moved.whiteBalance[i] ?? 1))));
                worst.vibrance = Math.max(worst.vibrance, Math.abs(look.vibrance - moved.vibrance));
                worst.denoise = Math.max(worst.denoise, Math.abs(look.denoise - moved.denoise) * 255);
                worst.sharpen = Math.max(worst.sharpen, Math.abs(look.sharpen - moved.sharpen));
              }
            }
          }
        }
      }
    }
    // With the old steps: white balance 0.02, colour lift 0.05, the noise filter 0.5 levels and sharpening 0.05 at once.
    expect(worst.whiteBalance).toBeLessThan(0.005);
    expect(worst.vibrance).toBeLessThan(0.005);
    expect(worst.denoise).toBeLessThan(0.25);
    expect(worst.sharpen).toBeLessThan(0.1);
  });
});

/**
 * The video of the finding, as statistics: the exposure rises slowly for four
 * seconds, is right for two, drops suddenly for two and returns. `grain`
 * moves every measurement of every frame by up to a level, as a different
 * noise pattern does. Analysed as the export worker analyses a video: frames
 * half a second apart, then the closer looks (`frameToRefine`).
 */
function changingExposure(seed: number, grain = 1 / 255): AnalysisPoint[] {
  const exposureAt = (second: number): number =>
    second < 4 ? 0.45 + (0.55 * second) / 4 : second < 6 ? 1 : second < 8 ? 0.5 : 1;
  const measure = (frame: number): AnalysisPoint => {
    const random = rng(seed * 1009 + frame);
    const jitter = () => (random() * 2 - 1) * grain;
    const exposure = exposureAt(frame / 30);
    return {
      frame,
      stats: stats({
        low: Math.max(0, 0.09 * exposure + jitter()),
        median: 0.51 * exposure + jitter(),
        high: Math.min(1, 0.92 * exposure + jitter()),
      }),
    };
  };
  const points = analysisFrames([{ startFrame: 0, endFrame: 300 }], 30).map(measure);
  for (let looked = 0; looked < REFINE_BUDGET; looked += 1) {
    points.sort((a, b) => a.frame - b.frame);
    const frame = frameToRefine(points);
    if (frame === null) break;
    points.push(measure(frame));
  }
  return points.sort((a, b) => a.frame - b.frame);
}

describe('planEnhancement: the same video with different grain gets the same treatment', () => {
  it('the well-exposed stretch is left exactly alone whatever the grain, at every strength', () => {
    for (const strength of ENHANCE_STRENGTHS) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const timeline = planEnhancement(changingExposure(seed), strength, 30);
        for (let frame = 125; frame <= 178; frame += 1) {
          const tone = toneAtFrame(timeline, frame);
          expect(toneIsNeutral(tone), `${strength}, seed ${seed}, frame ${frame}: ${JSON.stringify(tone)}`).toBe(true);
        }
        // ... while the dark stretches are lifted.
        if (strength !== 'light') {
          expect(toneLift(toneAtFrame(timeline, 0))).toBeGreaterThan(1.5);
          expect(toneLift(toneAtFrame(timeline, 210))).toBeGreaterThan(1.5);
        }
      }
    }
  });

  it('and no frame of it is treated noticeably differently from one grain to the next', () => {
    for (const strength of ENHANCE_STRENGTHS) {
      const reference = planEnhancement(changingExposure(1), strength, 30);
      let worst = 0;
      let where = '';
      for (let seed = 2; seed <= 40; seed += 1) {
        const timeline = planEnhancement(changingExposure(seed), strength, 30);
        for (let frame = 0; frame < 300; frame += 1) {
          const gap = toneGap(toneAtFrame(reference, frame), toneAtFrame(timeline, frame));
          if (gap > worst) {
            worst = gap;
            where = `${strength}, seed ${seed}, frame ${frame}: ${JSON.stringify(toneAtFrame(reference, frame))} / ${JSON.stringify(toneAtFrame(timeline, frame))}`;
          }
        }
      }
      // Below one just-noticeable step everywhere (with the old plan: a step of 10 % of gain on the well-exposed stretch).
      expect(worst, where).toBeLessThan(1);
    }
  });

  it('twice the grain, twice the difference at most: the plan has no cliff nearby', () => {
    const gapAt = (grain: number): number => {
      let worst = 0;
      const reference = planEnhancement(changingExposure(1, 0), 'auto', 30);
      for (let seed = 1; seed <= 20; seed += 1) {
        const timeline = planEnhancement(changingExposure(seed, grain), 'auto', 30);
        for (let frame = 0; frame < 300; frame += 3) {
          worst = Math.max(worst, toneGap(toneAtFrame(reference, frame), toneAtFrame(timeline, frame)));
        }
      }
      return worst;
    };
    const small = gapAt(0.5 / 255);
    const large = gapAt(1 / 255);
    expect(small).toBeLessThan(0.5);
    expect(large).toBeLessThan(Math.max(2.5 * small, 0.25));
  });

  it('uses the tuning it is given (the dead bands are part of it)', () => {
    // Without dead bands the smallest wanted gain is applied; with them it is not.
    const nearly = stats({ median: 0.45, high: 0.79 });
    const without = { ...ENHANCE_TUNING, deadGain: 0 };
    expect(chooseTone(nearly, 'auto').gain).toBe(1);
    expect(chooseTone(nearly, 'auto', without).gain).toBeGreaterThan(1);
  });
});
