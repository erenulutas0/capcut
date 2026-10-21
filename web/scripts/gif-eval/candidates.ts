/**
 * GIF quality evaluation (ADR-046, addendum of 19 October): the candidate
 * encoders, written with the app's own pieces (`gifenc`, the palette
 * lookup) so that what is measured is what the app would write.
 *
 * Bundled by `evaluate.mjs` with esbuild and run in Node; never imported by
 * the app. Every candidate takes the frames the app would draw (RGBA, all
 * the same size) and returns the GIF's bytes and the time the encoding took
 * (palette + mapping + LZW; decoding is the same for every candidate and is
 * not counted).
 */

import { GIFEncoder, quantize, type GifencColor } from 'gifenc';

import { nearestCache, nearestIndex, type GifPalette, type NearestCache } from '@/domain/gifPalette';

export const TRANSPARENT = 255;

export type Dither =
  | { kind: 'none' }
  /** Floyd–Steinberg, serpentine; `strength` scales the error passed on (1 = classic). */
  | { kind: 'fs'; strength: number }
  /** Ordered: a fixed threshold per pixel position; `spread` is the offset range in levels (0–255). */
  | { kind: 'ordered'; map: 'bayer' | 'blue' | 'r2'; spread: number };

export interface Candidate {
  id: string;
  palette: 'global' | 'perFrame';
  /** Global palette: how many pixels the quantizer sees (spread evenly over every frame). */
  samplePixels?: number;
  /** Global palette: Lloyd (k-means) steps after PnnQuant, on a histogram of the sample. */
  refine?: number;
  /** gifenc's quantizer histogram. */
  format?: 'rgb565' | 'rgb444';
  dither: Dither;
  /**
   * 0: a pixel is left transparent only when it would be drawn in the very same colour (today).
   * > 0: also when the colour on screen is at most this much (levels, weighted RMS) further from
   * the wanted colour than the best new one.
   */
  tolerance: number;
  /** Frame delays in hundredths, repeated: [8] = 12,5 fps; [7, 7, 6] = 15 fps. */
  delaysCs: number[];
  /** Round 2: write each later frame as the rectangle around its changed pixels only (lossless). */
  crop?: boolean;
}

// ------------------------------------------------------------------ palette

const KEY_BITS = 6;
const KEY_SHIFT = 8 - KEY_BITS;
const HALF = 1 << (KEY_SHIFT - 1);

function lookup(cache: NearestCache, r: number, g: number, b: number): number {
  const kr = r >> KEY_SHIFT;
  const kg = g >> KEY_SHIFT;
  const kb = b >> KEY_SHIFT;
  const key = (kr << (KEY_BITS * 2)) | (kg << KEY_BITS) | kb;
  let index = cache.cells[key]!;
  if (index < 0) {
    index = nearestIndex(cache.palette, (kr << KEY_SHIFT) + HALF, (kg << KEY_SHIFT) + HALF, (kb << KEY_SHIFT) + HALF, cache.skip);
    cache.cells[key] = index;
  }
  return index;
}

/** Pixels of every frame, evenly spaced, as one RGBA buffer. */
export function samplePixels(frames: readonly Uint8Array[], budget: number): Uint8Array {
  const framePixels = frames[0]!.length / 4;
  const total = framePixels * frames.length;
  const step = Math.max(1, Math.ceil(total / budget));
  const sample = new Uint8Array(Math.ceil(total / step) * 4);
  let written = 0;
  for (let p = 0; p < total; p += step) {
    const frame = frames[Math.floor(p / framePixels)]!;
    const offset = (p % framePixels) * 4;
    sample[written] = frame[offset]!;
    sample[written + 1] = frame[offset + 1]!;
    sample[written + 2] = frame[offset + 2]!;
    sample[written + 3] = 255;
    written += 4;
  }
  return written === sample.length ? sample : sample.slice(0, written);
}

/**
 * Lloyd steps on a 6-bit histogram of the sample, with the lookup's own
 * weighted distance: every occupied cell goes to its nearest entry, every
 * entry moves to the weighted mean of its cells.
 */
export function refinePalette(sample: Uint8Array, palette: GifPalette, steps: number): GifPalette {
  if (steps <= 0) return palette;
  const cells = 1 << (KEY_BITS * 3);
  const count = new Uint32Array(cells);
  const sumR = new Float64Array(cells);
  const sumG = new Float64Array(cells);
  const sumB = new Float64Array(cells);
  for (let i = 0; i < sample.length; i += 4) {
    const r = sample[i]!;
    const g = sample[i + 1]!;
    const b = sample[i + 2]!;
    const key = ((r >> KEY_SHIFT) << (KEY_BITS * 2)) | ((g >> KEY_SHIFT) << KEY_BITS) | (b >> KEY_SHIFT);
    count[key]! += 1;
    sumR[key]! += r;
    sumG[key]! += g;
    sumB[key]! += b;
  }
  const occupied: number[] = [];
  for (let key = 0; key < cells; key += 1) if (count[key]! > 0) occupied.push(key);
  const colors = palette.colors.slice();
  const n = palette.count;
  for (let step = 0; step < steps; step += 1) {
    const accR = new Float64Array(n);
    const accG = new Float64Array(n);
    const accB = new Float64Array(n);
    const accN = new Float64Array(n);
    const current: GifPalette = { colors, count: n };
    for (const key of occupied) {
      const c = count[key]!;
      const r = sumR[key]! / c;
      const g = sumG[key]! / c;
      const b = sumB[key]! / c;
      const index = nearestIndex(current, r, g, b);
      accR[index]! += sumR[key]!;
      accG[index]! += sumG[key]!;
      accB[index]! += sumB[key]!;
      accN[index]! += c;
    }
    for (let i = 0; i < n; i += 1) {
      if (accN[i]! === 0) continue;
      colors[i * 3] = Math.round(accR[i]! / accN[i]!);
      colors[i * 3 + 1] = Math.round(accG[i]! / accN[i]!);
      colors[i * 3 + 2] = Math.round(accB[i]! / accN[i]!);
    }
  }
  return { colors, count: n };
}

function paletteFrom(rows: GifencColor[]): GifPalette {
  const colors = new Uint8Array(256 * 3);
  const used = rows.slice(0, TRANSPARENT);
  used.forEach((color, index) => colors.set([color[0], color[1], color[2]], index * 3));
  return { colors, count: used.length };
}

function rowsOf(palette: GifPalette): GifencColor[] {
  const rows: GifencColor[] = [];
  for (let i = 0; i < 256; i += 1) {
    rows.push(i < palette.count ? [palette.colors[i * 3]!, palette.colors[i * 3 + 1]!, palette.colors[i * 3 + 2]!] : [0, 0, 0]);
  }
  return rows;
}

// ------------------------------------------------------------------ threshold maps

/** The classic 8 × 8 Bayer matrix: M(2n) = 4 M(n) + M(2) tile by tile. */
const BAYER8: number[] = (() => {
  const base = [0, 2, 3, 1];
  let m = [0];
  let n = 1;
  while (n < 8) {
    const next = new Array<number>(4 * n * n).fill(0);
    for (let y = 0; y < 2 * n; y += 1) {
      for (let x = 0; x < 2 * n; x += 1) {
        next[y * 2 * n + x] = 4 * m[(y % n) * n + (x % n)]! + base[Math.floor(y / n) * 2 + Math.floor(x / n)]!;
      }
    }
    m = next;
    n *= 2;
  }
  return m.map((v) => (v + 0.5) / 64);
})();

/** Deterministic PRNG (mulberry32). */
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

/** A 64 × 64 blue-noise threshold map (void-and-cluster, Ulichney 1993; Gaussian σ 1,5 on a torus). */
export function blueNoise64(): Float32Array {
  const N = 64;
  const size = N * N;
  const sigma = 1.5;
  const kernel = new Float32Array(size);
  for (let dy = 0; dy < N; dy += 1) {
    for (let dx = 0; dx < N; dx += 1) {
      const ddx = Math.min(dx, N - dx);
      const ddy = Math.min(dy, N - dy);
      kernel[dy * N + dx] = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * sigma * sigma));
    }
  }
  const energy = new Float32Array(size);
  const pattern = new Uint8Array(size);
  const update = (p: number, sign: number) => {
    const px = p % N;
    const py = (p - px) / N;
    for (let y = 0; y < N; y += 1) {
      const ky = ((y - py + N) % N) * N;
      for (let x = 0; x < N; x += 1) energy[y * N + x]! += sign * kernel[ky + ((x - px + N) % N)]!;
    }
  };
  const tightest = () => {
    let best = -1;
    let value = -Infinity;
    for (let p = 0; p < size; p += 1) if (pattern[p] && energy[p]! > value) [best, value] = [p, energy[p]!];
    return best;
  };
  const largestVoid = () => {
    let best = -1;
    let value = Infinity;
    for (let p = 0; p < size; p += 1) if (!pattern[p] && energy[p]! < value) [best, value] = [p, energy[p]!];
    return best;
  };
  const random = rng(46);
  const initial = Math.round(size * 0.1);
  for (let placed = 0; placed < initial; ) {
    const p = Math.floor(random() * size);
    if (pattern[p]) continue;
    pattern[p] = 1;
    update(p, 1);
    placed += 1;
  }
  for (let guard = 0; guard < size; guard += 1) {
    const cluster = tightest();
    pattern[cluster] = 0;
    update(cluster, -1);
    const hole = largestVoid();
    if (hole === cluster) {
      pattern[cluster] = 1;
      update(cluster, 1);
      break;
    }
    pattern[hole] = 1;
    update(hole, 1);
  }
  const rank = new Float32Array(size);
  const start = pattern.slice();
  const startEnergy = energy.slice();
  // Phase 1: remove the tightest clusters of the starting pattern, ranks counting down.
  let ones = initial;
  while (ones > 0) {
    const cluster = tightest();
    pattern[cluster] = 0;
    update(cluster, -1);
    ones -= 1;
    rank[cluster] = ones;
  }
  pattern.set(start);
  energy.set(startEnergy);
  // Phase 2 and 3: fill the largest voids, ranks counting up.
  ones = initial;
  while (ones < size) {
    const hole = largestVoid();
    pattern[hole] = 1;
    update(hole, 1);
    rank[hole] = ones;
    ones += 1;
  }
  const map = new Float32Array(size);
  for (let p = 0; p < size; p += 1) map[p] = (rank[p]! + 0.5) / size;
  return map;
}

let blue: Float32Array | null = null;

function threshold(map: 'bayer' | 'blue' | 'r2', x: number, y: number): number {
  if (map === 'bayer') return BAYER8[(y & 7) * 8 + (x & 7)]!;
  if (map === 'blue') {
    blue ??= blueNoise64();
    return blue[(y & 63) * 64 + (x & 63)]!;
  }
  const v = x * 0.7548776662466927 + y * 0.5698402909980532;
  return v - Math.floor(v);
}

// ------------------------------------------------------------------ mapping

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function weighted(colors: Uint8Array, index: number, r: number, g: number, b: number): number {
  const dr = colors[index * 3]! - r;
  const dg = colors[index * 3 + 1]! - g;
  const db = colors[index * 3 + 2]! - b;
  return Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9);
}

/**
 * One frame onto the palette: dithering and the transparency decision in one
 * pass. `shown` (indices on screen, updated in place) is null for the first
 * frame. Returns how many pixels changed.
 */
export function mapFrame(
  rgba: Uint8Array,
  width: number,
  height: number,
  cache: NearestCache,
  out: Uint8Array,
  shown: Uint8Array | null,
  dither: Dither,
  tolerance: number,
): number {
  const colors = cache.palette.colors;
  let changed = 0;
  const decide = (p: number, r: number, g: number, b: number): number => {
    const index = lookup(cache, r, g, b);
    if (!shown) {
      out[p] = index;
      return index;
    }
    const on = shown[p]!;
    if (on === index) {
      out[p] = TRANSPARENT;
      return on;
    }
    if (tolerance > 0 && weighted(colors, on, r, g, b) <= weighted(colors, index, r, g, b) + tolerance) {
      out[p] = TRANSPARENT;
      return on;
    }
    out[p] = index;
    shown[p] = index;
    changed += 1;
    return index;
  };
  if (dither.kind === 'fs') {
    const s = dither.strength;
    let cur = new Float32Array((width + 2) * 3);
    let next = new Float32Array((width + 2) * 3);
    for (let y = 0; y < height; y += 1) {
      const ltr = (y & 1) === 0;
      const dir = ltr ? 3 : -3;
      next.fill(0);
      for (let i = 0; i < width; i += 1) {
        const x = ltr ? i : width - 1 - i;
        const p = y * width + x;
        const o = p * 4;
        const e = (x + 1) * 3;
        const r = clamp255(rgba[o]! + cur[e]!);
        const g = clamp255(rgba[o + 1]! + cur[e + 1]!);
        const b = clamp255(rgba[o + 2]! + cur[e + 2]!);
        const pick = decide(p, r, g, b);
        const er = (r - colors[pick * 3]!) * s;
        const eg = (g - colors[pick * 3 + 1]!) * s;
        const eb = (b - colors[pick * 3 + 2]!) * s;
        cur[e + dir]! += (er * 7) / 16;
        cur[e + dir + 1]! += (eg * 7) / 16;
        cur[e + dir + 2]! += (eb * 7) / 16;
        next[e - dir]! += (er * 3) / 16;
        next[e - dir + 1]! += (eg * 3) / 16;
        next[e - dir + 2]! += (eb * 3) / 16;
        next[e]! += (er * 5) / 16;
        next[e + 1]! += (eg * 5) / 16;
        next[e + 2]! += (eb * 5) / 16;
        next[e + dir]! += er / 16;
        next[e + dir + 1]! += eg / 16;
        next[e + dir + 2]! += eb / 16;
      }
      [cur, next] = [next, cur];
    }
    return changed;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const o = p * 4;
      if (dither.kind === 'ordered') {
        const offset = (threshold(dither.map, x, y) - 0.5) * dither.spread;
        decide(p, clamp255(rgba[o]! + offset), clamp255(rgba[o + 1]! + offset), clamp255(rgba[o + 2]! + offset));
      } else {
        decide(p, rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
      }
    }
  }
  return changed;
}

// ------------------------------------------------------------------ encoding

export interface Encoded {
  bytes: Uint8Array;
  ms: number;
  /** Mean share of pixels redrawn per later frame. */
  changedShare: number;
}

/**
 * Round 2 (ADR-046 addendum 2), "kare farkı kırpma": a later frame written as only the rectangle around
 * its changed (non-transparent) pixels. gifenc always writes the image at (0, 0); the four bytes of
 * the image descriptor's left / top are patched right after it is written (the graphic control
 * extension before it is 8 bytes: 21 F9 04 packed delay×2 index 00).
 */
function writeCropped(encoder: ReturnType<typeof GIFEncoder>, out: Uint8Array, width: number, height: number, delay: number): void {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (out[row + x] !== TRANSPARENT) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = 0;
    y1 = 0;
  }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const sub = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y += 1) sub.set(out.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + cw), y * cw);
  const at = encoder.bytesView().length;
  encoder.writeFrame(sub, cw, ch, { palette: null, repeat: 0, delay, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
  const view = encoder.bytesView();
  if (view[at] !== 0x21 || view[at + 8] !== 0x2c) throw new Error('unexpected GIF frame layout');
  view[at + 9] = x0 & 0xff;
  view[at + 10] = x0 >> 8;
  view[at + 11] = y0 & 0xff;
  view[at + 12] = y0 >> 8;
}

export function encodeCandidate(frames: readonly Uint8Array[], width: number, height: number, c: Candidate): Encoded {
  const started = performance.now();
  const encoder = GIFEncoder({ initialCapacity: 1 << 20 });
  const pixels = width * height;
  const out = new Uint8Array(pixels);
  const shown = new Uint8Array(pixels);
  let changedSum = 0;
  if (c.palette === 'global') {
    const sample = samplePixels(frames, c.samplePixels ?? 8 * 480 * 270);
    let palette = paletteFrom(quantize(sample, 255, { format: c.format ?? 'rgb565' }));
    palette = refinePalette(sample, palette, c.refine ?? 0);
    const cache = nearestCache(palette, TRANSPARENT);
    frames.forEach((frame, i) => {
      const first = i === 0;
      const changed = mapFrame(frame, width, height, cache, out, first ? null : shown, c.dither, c.tolerance);
      if (first) shown.set(out);
      else changedSum += changed / pixels;
      if (!first && c.crop) {
        writeCropped(encoder, out, width, height, c.delaysCs[i % c.delaysCs.length]! * 10);
        return;
      }
      encoder.writeFrame(out, width, height, {
        palette: first ? rowsOf(palette) : null,
        repeat: 0,
        delay: c.delaysCs[i % c.delaysCs.length]! * 10,
        transparent: !first,
        transparentIndex: TRANSPARENT,
        dispose: 1,
      });
    });
  } else {
    // A palette per frame: indices of two frames are not comparable, so "unchanged" compares colours.
    const shownRgb = new Uint8Array(pixels * 3);
    frames.forEach((frame, i) => {
      const first = i === 0;
      const palette = paletteFrom(quantize(frame, 255, { format: c.format ?? 'rgb565' }));
      const cache = nearestCache(palette, TRANSPARENT);
      // Map with the frame's own palette, then compare each pixel's colour with the one on screen.
      mapFrame(frame, width, height, cache, out, null, c.dither, 0);
      let changed = 0;
      for (let p = 0; p < pixels; p += 1) {
        const index = out[p]!;
        const r = palette.colors[index * 3]!;
        const g = palette.colors[index * 3 + 1]!;
        const b = palette.colors[index * 3 + 2]!;
        if (!first && shownRgb[p * 3] === r && shownRgb[p * 3 + 1] === g && shownRgb[p * 3 + 2] === b) {
          out[p] = TRANSPARENT;
        } else {
          shownRgb[p * 3] = r;
          shownRgb[p * 3 + 1] = g;
          shownRgb[p * 3 + 2] = b;
          changed += 1;
        }
      }
      if (!first) changedSum += changed / pixels;
      encoder.writeFrame(out, width, height, {
        palette: rowsOf(palette),
        repeat: 0,
        delay: c.delaysCs[i % c.delaysCs.length]! * 10,
        transparent: !first,
        transparentIndex: TRANSPARENT,
        dispose: 1,
      });
    });
  }
  encoder.finish();
  const bytes = encoder.bytes();
  return { bytes, ms: performance.now() - started, changedShare: frames.length > 1 ? changedSum / (frames.length - 1) : 1 };
}
