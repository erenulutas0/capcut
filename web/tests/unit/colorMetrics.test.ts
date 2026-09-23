import { describe, expect, it } from 'vitest';

import { compareRgb, deltaE2000, meanLuma, srgbToLab } from '../../scripts/lib/color-metrics.mjs';

/** Sharma, Wu, Dalal (2005) CIEDE2000 test data, a few rows. */
const SHARMA: [number[], number[], number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
];

function solid(r: number, g: number, b: number, pixels = 64): Uint8Array {
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) out.set([r, g, b], i * 3);
  return out;
}

describe('color metrics used by the HDR checks', () => {
  it('CIEDE2000 matches the published test data', () => {
    for (const [a, b, expected] of SHARMA) {
      expect(deltaE2000(a, b)).toBeCloseTo(expected, 3);
    }
  });

  it('sRGB white is L*=100 neutral, black is 0', () => {
    const white = srgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1]) + Math.abs(white[2])).toBeLessThan(0.1);
    expect(srgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });

  it('identical frames compare as zero difference', () => {
    const a = solid(120, 80, 40);
    const result = compareRgb(a, a);
    expect(result.meanDeltaE00).toBe(0);
    expect(result.cast).toBe(0);
    expect(result.chromaRatio).toBe(1);
    expect(result.saturationRatio).toBe(1);
    expect(result.hueError).toBe(0);
    expect(result.clipDelta).toBe(0);
  });

  it('a uniform green tint on grey shows up as a cast, not as a lightness change', () => {
    const result = compareRgb(solid(128, 128, 128), solid(118, 134, 118));
    expect(result.cast).toBeGreaterThan(5);
    expect(Math.abs(result.meanDeltaL)).toBeLessThan(3);
  });

  it('a desaturated copy has a saturation ratio below 1; a brighter copy keeps hue', () => {
    const vivid = solid(200, 40, 40);
    expect(compareRgb(vivid, solid(160, 90, 90)).saturationRatio).toBeLessThan(0.8);
    expect(compareRgb(vivid, solid(230, 46, 46)).hueError).toBeLessThan(2);
  });

  it('clipping raises clipDelta; luma of black is 0', () => {
    expect(compareRgb(solid(240, 240, 240), solid(255, 255, 255)).clipDelta).toBe(1);
    expect(meanLuma(solid(0, 0, 0))).toBe(0);
  });
});
