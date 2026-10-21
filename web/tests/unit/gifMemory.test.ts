import { quantize, type GifencColor } from 'gifenc';
import { describe, expect, it } from 'vitest';

import { GifPaletteSampler, GifWriter, PALETTE_SAMPLE_PIXELS, TRANSPARENT_INDEX, buildGifPalette } from '@/adapters/gif/gifEncode';
import { gifPercent } from '@/components/gif/useGif';
import { GIF_HELD_FRAMES_MAX_BYTES, GIF_HELD_FRAMES_MAX_BYTES_LARGE_MEMORY, gifFramesBudget, gifFramesBytes, gifHoldsFrames } from '@/domain/gif';
import type { GifPalette } from '@/domain/gifPalette';

/**
 * ADR-046 memory addendum (21 Oct 2026): the GIF worker gathers the palette's
 * sample one frame at a time and, for a GIF whose frames would not fit in the
 * memory budget, decodes the part a second time and writes each frame as it
 * comes instead of holding them all. Neither may change a single byte of the
 * GIF. These tests hold the frames themselves (the old way) and compare.
 */

/** `buildGifPalette` exactly as it was before 21 Oct 2026 (commit a7ed854), the reference. */
function paletteBefore(frames: readonly Uint8Array[], text: boolean): GifPalette {
  const framePixels = (frames[0] as Uint8Array).length / 4;
  const total = framePixels * frames.length;
  const step = Math.max(1, Math.ceil(total / PALETTE_SAMPLE_PIXELS));
  const sample = new Uint8Array(Math.ceil(total / step) * 4);
  let written = 0;
  for (let p = 0; p < total; p += step) {
    const frame = frames[Math.floor(p / framePixels)] as Uint8Array;
    const offset = (p % framePixels) * 4;
    sample[written] = frame[offset]!;
    sample[written + 1] = frame[offset + 1]!;
    sample[written + 2] = frame[offset + 2]!;
    sample[written + 3] = 255;
    written += 4;
  }
  const exact = written === sample.length ? sample : sample.slice(0, written);
  const picked = quantize(exact, text ? 253 : 255);
  const rows: GifencColor[] = picked.map((color) => [color[0], color[1], color[2]]);
  if (text) rows.push([255, 255, 255], [0, 0, 0]);
  const colors = new Uint8Array(256 * 3);
  rows.slice(0, TRANSPARENT_INDEX).forEach((color, index) => colors.set([color[0], color[1], color[2]], index * 3));
  return { colors, count: Math.min(rows.length, TRANSPARENT_INDEX) };
}

/**
 * Frames whose colour depends on the pixel's place in the whole run (so another choice of sampled
 * pixels gives another histogram, and another palette) and that move (so some pixels stay, most do
 * not). Few distinct colours (16 levels a channel), so the quantizer is quick; random grain on a
 * part of the pixels, from a fixed seed.
 */
function frames(width: number, height: number, count: number, seed = 7): Uint8Array[] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out: Uint8Array[] = [];
  for (let f = 0; f < count; f += 1) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const grain = random() < 0.2 ? 3 : 0;
        rgba[i] = (((x + f * 3) >> 3) % 16) * 16 + grain;
        rgba[i + 1] = (((x * 7 + y * 13 + f) % 31) >> 1) * 16;
        rgba[i + 2] = (((y >> 2) + f * 5) % 16) * 16;
        rgba[i + 3] = 255;
      }
    }
    out.push(rgba);
  }
  return out;
}

function sampled(list: readonly Uint8Array[], width: number, height: number, text: boolean): GifPalette {
  const sampler = new GifPaletteSampler(width * height, list.length);
  for (const frame of list) sampler.add(frame);
  return sampler.palette(text);
}

describe('GIF yap, memory: the palette from one frame at a time', () => {
  // Sample steps 1, 2 (odd frame size: frames start at alternating offsets), 6 and 13 (frame size not a multiple of them).
  const cases = [
    { width: 64, height: 36, count: 50 },
    { width: 321, height: 181, count: 30 },
    { width: 500, height: 281, count: 40 },
    { width: 320, height: 180, count: 220 },
  ];
  for (const { width, height, count } of cases) {
    it(`${width} × ${height} × ${count} frames: the very same palette as from all frames held`, { timeout: 60_000 }, () => {
      const list = frames(width, height, count);
      for (const text of [false, true]) {
        const before = paletteBefore(list, text);
        expect(sampled(list, width, height, text)).toEqual(before);
        expect(buildGifPalette(list, text)).toEqual(before);
      }
    });
  }

  it('refuses frames it did not plan for, and an empty run', () => {
    const sampler = new GifPaletteSampler(4, 1);
    sampler.add(new Uint8Array(16));
    expect(() => sampler.add(new Uint8Array(16))).toThrow(RangeError);
    expect(() => new GifPaletteSampler(0, 3)).toThrow(RangeError);
    expect(() => new GifPaletteSampler(4, 0)).toThrow(RangeError);
  });
});

describe('GIF yap, memory: written frame by frame, byte for byte the same GIF', () => {
  it('held frames (the old way) and frames written as they come give identical files, with and without text', { timeout: 60_000 }, () => {
    const width = 200;
    const height = 113;
    const count = 60;
    for (const text of [false, true]) {
      // The old way: every frame in memory, the palette, then the writer.
      const held = frames(width, height, count, 11);
      const oldWriter = new GifWriter(width, height, paletteBefore(held, text));
      for (const frame of held) oldWriter.add(frame);
      const before = oldWriter.finish();

      // The two-pass way: pass 1 only samples (each frame dropped at once), pass 2 decodes "again" and writes.
      let sampler: GifPaletteSampler | null = new GifPaletteSampler(width * height, count);
      for (const frame of frames(width, height, count, 11)) sampler.add(frame);
      const palette = sampler.palette(text);
      sampler = null;
      const writer = new GifWriter(width, height, palette);
      for (const frame of frames(width, height, count, 11)) writer.add(frame);
      const after = writer.finish();

      expect(after.length).toBe(before.length);
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
    }
  });
});

describe('GIF yap, memory: the bar with two passes', () => {
  const running = (step: 'frames' | 'encoding', done: number, passes?: 1 | 2) =>
    gifPercent({ phase: 'running', step, done, total: 100, fileName: null, ...(passes ? { passes } : {}) });
  it('one pass: decoding is most of the bar; two passes: each pass half of it', () => {
    expect(running('frames', 100)).toBe(85);
    expect(running('frames', 100, 1)).toBe(85);
    expect(running('encoding', 50)).toBe(93);
    expect(running('frames', 100, 2)).toBe(50);
    expect(running('encoding', 50, 2)).toBe(75);
    expect(running('encoding', 100, 2)).toBe(100);
  });
});

describe('GIF yap, memory: which GIFs are made in one pass', () => {
  it('the frames of a GIF in memory, as RGBA', () => {
    expect(gifFramesBytes({ width: 640, height: 360 }, 125)).toBe(115_200_000);
    expect(gifFramesBytes({ width: 320, height: 180 }, 50)).toBe(11_520_000);
  });

  it('frames are held only within the budget; a larger GIF is decoded twice instead', () => {
    expect(gifHoldsFrames({ width: 1, height: 1 }, 1)).toBe(true);
    const pixels = GIF_HELD_FRAMES_MAX_BYTES / 4;
    expect(gifHoldsFrames({ width: pixels, height: 1 }, 1)).toBe(true);
    expect(gifHoldsFrames({ width: pixels + 1, height: 1 }, 1)).toBe(false);
    // Büyük, 10 s (115 MB of frames): not held within the (low-memory) budget.
    expect(gifHoldsFrames({ width: 640, height: 360 }, 125)).toBe(false);
    expect(gifHoldsFrames({ width: 360, height: 640 }, 125)).toBe(false);
    // A test build may move the budget (0: always two passes).
    expect(gifHoldsFrames({ width: 1, height: 1 }, 1, 0)).toBe(false);
    expect(gifHoldsFrames({ width: 640, height: 360 }, 125, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('the budget: 32 MiB unless the device says it has 8 GB (then every GIF, 10 s of Büyük too, in one pass)', () => {
    for (const said of [undefined, null, '8', Number.NaN, 0.5, 2, 4]) expect(gifFramesBudget(said)).toBe(GIF_HELD_FRAMES_MAX_BYTES);
    expect(gifFramesBudget(8)).toBe(GIF_HELD_FRAMES_MAX_BYTES_LARGE_MEMORY);
    const small = gifFramesBudget(4);
    const large = gifFramesBudget(8);
    // Low or unknown memory: all of "Küçük", 4 s of "Orta" (the default), not 10 s of "Orta" or "Büyük".
    expect(gifHoldsFrames({ width: 320, height: 180 }, 125, small)).toBe(true);
    expect(gifHoldsFrames({ width: 480, height: 270 }, 50, small)).toBe(true);
    expect(gifHoldsFrames({ width: 480, height: 270 }, 125, small)).toBe(false);
    expect(gifHoldsFrames({ width: 640, height: 360 }, 37, small)).toBe(false);
    expect(gifHoldsFrames({ width: 640, height: 360 }, 36, small)).toBe(true);
    // 8 GB: the largest GIF there is (640 × 640 cannot happen: the long edge is 640) in one pass.
    expect(gifHoldsFrames({ width: 640, height: 360 }, 125, large)).toBe(true);
  });
});
