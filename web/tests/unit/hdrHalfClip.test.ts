import { describe, expect, it } from 'vitest';

import {
  halfToFloat,
  softClipHalfToRgba8,
  softClipToRgba8,
  srgbEncode8ByTable,
  srgbEncode8Reference,
} from '@/domain/hdr';

/** Float path (the one ADR-022 verified) over the same half values. */
function reference(bits: Uint16Array): Uint8ClampedArray {
  const target = new Uint8ClampedArray(bits.length);
  softClipToRgba8(Array.from(bits, halfToFloat), target);
  return target;
}

function fast(bits: Uint16Array): Uint8ClampedArray {
  const target = new Uint8ClampedArray(bits.length);
  softClipHalfToRgba8(bits, target);
  return target;
}

/** A small deterministic generator, so a failure is reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

describe('halfToFloat', () => {
  it('decodes normal, subnormal and special half values exactly', () => {
    expect(halfToFloat(0x0000)).toBe(0);
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3555)).toBeCloseTo(0.33325195, 8);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x03ff)).toBe(1023 * 2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0xfc00)).toBe(-Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
  });

  it('matches float32 rounding of the decoded value (every half fits a float32)', () => {
    for (let bits = 0; bits < 65536; bits += 1) {
      const v = halfToFloat(bits);
      if (Number.isNaN(v)) continue;
      expect(Math.fround(v)).toBe(v);
    }
  });
});

describe('softClipHalfToRgba8 (ADR-028)', () => {
  it('equals the float loop for every half value in each channel', () => {
    // Each of the 65536 patterns once as red, green and blue, next to a
    // neutral under-knee and an over-knee partner (both paths of the loop).
    for (const partner of [0x3800 /* 0.5 */, 0x3c66 /* 1.1 */]) {
      for (let channel = 0; channel < 3; channel += 1) {
        const bits = new Uint16Array(65536 * 4);
        for (let v = 0; v < 65536; v += 1) {
          bits[v * 4] = partner;
          bits[v * 4 + 1] = partner;
          bits[v * 4 + 2] = partner;
          bits[v * 4 + channel] = v;
          bits[v * 4 + 3] = 0x3c00;
        }
        const got = fast(bits);
        const want = reference(bits);
        let differing = 0;
        for (let i = 0; i < got.length; i += 1) if (got[i] !== want[i]) differing += 1;
        expect(differing).toBe(0);
      }
    }
  }, 60_000);

  it('equals the float loop on random pixels, including negatives, NaN and infinities', () => {
    const next = lcg(20260923);
    const bits = new Uint16Array(4 * 200_000);
    for (let i = 0; i < bits.length; i += 1) {
      // Mostly the displayable range [0, 2) with some of every other value.
      const r = next();
      bits[i] = r % 4 === 0 ? r >>> 16 : (r >>> 16) % 0x4000;
    }
    const got = fast(bits);
    const want = reference(bits);
    let differing = 0;
    for (let i = 0; i < got.length; i += 1) if (got[i] !== want[i]) differing += 1;
    expect(differing).toBe(0);
  }, 60_000);

  it('writes an opaque alpha whatever the source alpha', () => {
    const target = fast(new Uint16Array([0x3800, 0x3800, 0x3800, 0x0000]));
    expect([...target]).toEqual([128, 128, 128, 255]);
  });

  it('keeps the float loop for a source shorter than the target', () => {
    const target = new Uint8ClampedArray(8);
    softClipHalfToRgba8(new Uint16Array([0x3800, 0x3400, 0x3a00, 0x3c00]), target);
    const expected = new Uint8ClampedArray(8);
    softClipToRgba8([0.5, 0.25, 0.75, 1], expected);
    expect(target).toEqual(expected);
  });
});

/** The next double above/below `x` (x finite, positive). */
function nextDouble(x: number, direction: 1 | -1): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(direction));
  return view.getFloat64(0);
}

describe('8-bit sRGB encode by threshold table (ADR-028)', () => {
  it('equals the pow formula on both sides of every step, many doubles deep', () => {
    // Find each step of the reference by bisection, then compare the table
    // over 2000 consecutive doubles on each side of it.
    const mismatches: number[] = [];
    for (let k = 1; k < 256; k += 1) {
      let lo = 0;
      let hi = 1;
      for (;;) {
        const mid = lo + (hi - lo) / 2;
        if (mid <= lo || mid >= hi) break;
        if (srgbEncode8Reference(mid) >= k) hi = mid;
        else lo = mid;
      }
      let up = hi;
      let down = lo;
      for (let step = 0; step < 2000; step += 1) {
        if (srgbEncode8ByTable(up) !== srgbEncode8Reference(up)) mismatches.push(up);
        if (srgbEncode8ByTable(down) !== srgbEncode8Reference(down)) mismatches.push(down);
        up = nextDouble(up, 1);
        down = down > 0 ? nextDouble(down, -1) : down;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('equals the pow formula on a million random values, out-of-range and special values', () => {
    const next = lcg(7);
    const mismatches: number[] = [];
    for (let i = 0; i < 1_000_000; i += 1) {
      const x = (next() / 2 ** 32) * 1.2 - 0.1;
      if (srgbEncode8ByTable(x) !== srgbEncode8Reference(x)) mismatches.push(x);
    }
    expect(mismatches).toEqual([]);
    const nanRef = new Uint8ClampedArray([srgbEncode8Reference(NaN)]);
    expect(srgbEncode8ByTable(NaN)).toBe(nanRef[0]);
    for (const x of [-Infinity, -1, -0, 0, 1e-300, 0.0031308, 0.5, 1, 1.5, Infinity]) {
      expect(srgbEncode8ByTable(x)).toBe(srgbEncode8Reference(x));
    }
  });
});
