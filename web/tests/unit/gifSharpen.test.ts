import { describe, expect, it } from 'vitest';

import { GIF_SHARPEN_AMOUNT, GifSharpener } from '@/adapters/gif/gifSharpen';
import { sharpen as evaluationSharpen } from '../../scripts/gif-eval/resample';

/**
 * ADR-046 addendum 3 (24 Oct 2026): every GIF frame is sharpened (0,25) after
 * the browser's downscale. The app's kernel works in place with three rows of
 * sums; the evaluation that measured `high+s0.25` (addendum 2) used
 * `scripts/gif-eval/resample.ts`'s `sharpen`, which makes a new buffer. They
 * must give the same bytes — what was measured is what ships.
 */

/** A frame of `w` × `h` from a seeded generator (alpha 255 unless `alpha` says otherwise). */
function frame(w: number, h: number, seed: number, alpha?: (i: number) => number): Uint8ClampedArray {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    // Mostly smooth with sharp jumps and the extremes, so clamping and every rounding case come up.
    const pick = next();
    const base = pick < 0.1 ? 0 : pick < 0.2 ? 255 : Math.floor(next() * 256);
    out[i * 4] = base;
    out[i * 4 + 1] = Math.floor(next() * 256);
    out[i * 4 + 2] = 255 - base;
    out[i * 4 + 3] = alpha ? alpha(i) : 255;
  }
  return out;
}

/** A frame of one colour with some pixels set, RGB the same value in all three channels. */
function grey(w: number, h: number, fill: number, set: Record<string, number> = {}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = set[`${x},${y}`] ?? fill;
      out.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return out;
}

const at = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => rgba[(y * w + x) * 4];

describe('GifSharpener (ADR-046 addendum 3)', () => {
  it('is 0,25 — the measured `high+s0.25`', () => {
    expect(GIF_SHARPEN_AMOUNT).toBe(0.25);
    expect(new GifSharpener(4, 4).amount).toBe(0.25);
  });

  it('gives byte for byte what the evaluation’s sharpen gave, at every geometry (one row, one column, odd sizes, the GIF sizes)', () => {
    const sizes: [number, number][] = [
      [1, 1], [1, 2], [2, 1], [1, 7], [7, 1], [2, 2], [3, 3], [4, 3], [13, 9], [31, 17],
      [320, 180], [180, 320], [480, 270], [640, 360], [960, 540],
    ];
    let seed = 7;
    for (const [w, h] of sizes) {
      for (const amount of [GIF_SHARPEN_AMOUNT, 0.5]) {
        const input = frame(w, h, (seed += 101));
        const expected = evaluationSharpen(input, w, h, amount);
        const inPlace = input.slice();
        new GifSharpener(w, h, amount).apply(inPlace);
        expect(Buffer.from(inPlace).equals(Buffer.from(expected)), `${w}×${h} amount ${amount}`).toBe(true);
      }
    }
  });

  it('works out a spot exactly: centre 4, sides 2, corners 1 of 16; the halo; a flat picture is left as it is', () => {
    // 3 × 3 of 100 with 200 in the middle: blur there (4·200 + 8·100 + 4·100) / 16 = 125 → 200 + (200 − 125) / 4 = 218,75.
    const spot = grey(3, 3, 100, { '1,1': 200 });
    new GifSharpener(3, 3).apply(spot);
    expect(at(spot, 3, 1, 1)).toBe(219);
    // Beside it: blur 112,5 → 96,875; diagonal: blur 106,25 → 98,4375.
    expect([at(spot, 3, 1, 0), at(spot, 3, 0, 1), at(spot, 3, 2, 1), at(spot, 3, 1, 2)]).toEqual([97, 97, 97, 97]);
    expect([at(spot, 3, 0, 0), at(spot, 3, 2, 0), at(spot, 3, 0, 2), at(spot, 3, 2, 2)]).toEqual([98, 98, 98, 98]);
    const flat = grey(9, 5, 77);
    const before = flat.slice();
    new GifSharpener(9, 5).apply(flat);
    expect(Buffer.from(flat).equals(Buffer.from(before))).toBe(true);
  });

  it('rounds halves to even, as a Uint8ClampedArray does (and as the evaluation did)', () => {
    // Centre 3, sides 0, corners 1: blur 16 / 16 = 1 → 3 + (3 − 1) / 4 = 3,5 → 4.
    const up = grey(3, 3, 0, { '1,1': 3, '0,0': 1, '2,0': 1, '0,2': 1, '2,2': 1 });
    new GifSharpener(3, 3).apply(up);
    expect(at(up, 3, 1, 1)).toBe(4);
    // Centre 3, sides 8, corners 1: blur 80 / 16 = 5 → 3 − 2 / 4 = 2,5 → 2.
    const down = grey(3, 3, 8, { '1,1': 3, '0,0': 1, '2,0': 1, '0,2': 1, '2,2': 1 });
    new GifSharpener(3, 3).apply(down);
    expect(at(down, 3, 1, 1)).toBe(2);
  });

  it('clamps at black and white', () => {
    const dark = grey(3, 3, 255, { '1,1': 0 });
    new GifSharpener(3, 3).apply(dark);
    expect(at(dark, 3, 1, 1)).toBe(0);
    expect(at(dark, 3, 1, 0)).toBe(255);
    const light = grey(3, 3, 0, { '1,1': 255 });
    new GifSharpener(3, 3).apply(light);
    expect(at(light, 3, 1, 1)).toBe(255);
    expect(at(light, 3, 1, 0)).toBe(0);
  });

  it('at the frame’s edges the pixel beyond is the edge pixel: a border along the edge is not darkened or lightened', () => {
    // Left half 0, right half 200: the outermost columns have only their own kind around them (and the row
    // above the first / below the last is the row itself), so they stay; the two columns at the step get the halo.
    const set: Record<string, number> = {};
    for (let y = 0; y < 4; y += 1) for (let x = 3; x < 6; x += 1) set[`${x},${y}`] = 200;
    const step = grey(6, 4, 0, set);
    new GifSharpener(6, 4).apply(step);
    for (let y = 0; y < 4; y += 1) {
      expect(at(step, 6, 0, y)).toBe(0);
      expect(at(step, 6, 5, y)).toBe(200);
      expect(at(step, 6, 2, y)).toBe(0); // 0 − (50 / 4) → clamped
      expect(at(step, 6, 3, y)).toBe(212); // blur 150 → 200 + 50 / 4 = 212,5 → halves to even
      expect([at(step, 6, 1, y), at(step, 6, 4, y)]).toEqual([0, 200]);
    }
  });

  it('never reads alpha and leaves 255 there: the colours are those of the same frame made opaque', () => {
    const w = 37;
    const h = 11;
    const seeThrough = frame(w, h, 99, (i) => (i * 37) % 256);
    const opaque = seeThrough.slice();
    for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
    new GifSharpener(w, h).apply(seeThrough);
    new GifSharpener(w, h).apply(opaque);
    expect(Buffer.from(seeThrough).equals(Buffer.from(opaque))).toBe(true);
    for (let i = 3; i < seeThrough.length; i += 4) expect(seeThrough[i]).toBe(255);
  });

  it('one sharpener for many frames: each is what a new one would make (the two passes of a GIF draw the same bytes)', () => {
    const w = 64;
    const h = 23;
    const shared = new GifSharpener(w, h);
    for (let seed = 1; seed <= 5; seed += 1) {
      const a = frame(w, h, seed * 7919);
      const b = a.slice();
      shared.apply(a);
      new GifSharpener(w, h).apply(b);
      expect(Buffer.from(a).equals(Buffer.from(b)), `frame ${seed}`).toBe(true);
    }
  });

  it('refuses a frame of another size, an empty size, and a strength its one-key table cannot hold', () => {
    expect(() => new GifSharpener(4, 4).apply(new Uint8ClampedArray(4 * 5 * 4))).toThrow(RangeError);
    expect(() => new GifSharpener(0, 4)).toThrow(RangeError);
    // 0,3: 16 × 1,3 / 0,3 is not a whole number; 0 would not sharpen at all.
    expect(() => new GifSharpener(4, 4, 0.3)).toThrow(RangeError);
    expect(() => new GifSharpener(4, 4, 0)).toThrow(RangeError);
    expect(() => new GifSharpener(4, 4, 1)).not.toThrow();
  });
});
