/**
 * "GIF yap" (ADR-046): turning RGBA frames into palette indices.
 *
 * Pure arithmetic, no browser and no library: the palette itself is chosen by
 * the encoder's quantizer (gifenc's PnnQuant, `adapters/gif/gifEncode.ts`);
 * this file maps every pixel onto it and marks the pixels that did not change
 * since the previous frame as transparent.
 *
 * No dithering, measured in ADR-046 ("Palet ve titreşim"): with one palette
 * of 255 colours chosen from frames across the whole part, a smooth gradient
 * showed no visible bands at GIF sizes, while the ordered (Bayer) pattern was
 * visible as a grid on flat and soft areas and made the file 5–29 % larger,
 * and error diffusion (Floyd–Steinberg) made it 16–69 % larger and 3–10 times
 * slower (its noise moves from frame to frame, so almost no pixel stays the
 * same and the unchanged-pixel saving is lost).
 */

/** A palette as packed RGB triplets: entry `i` is `colors[3i], colors[3i+1], colors[3i+2]`. */
export interface GifPalette {
  colors: Uint8Array;
  /** Number of entries (1 to 256). */
  count: number;
}

/** Cache key bits per channel: 6 → 262 144 cells (512 KB), each holding its nearest palette entry. */
const KEY_BITS = 6;
const KEY_SHIFT = 8 - KEY_BITS;
const CACHE_CELLS = 1 << (KEY_BITS * 3);

/** A lookup from a colour cell to its nearest palette entry, filled as colours are met. One per palette. */
export interface NearestCache {
  readonly palette: GifPalette;
  /** −1: not looked up yet. */
  readonly cells: Int16Array;
  /** A palette entry that is never chosen (the transparent one), or −1. */
  readonly skip: number;
}

export function nearestCache(palette: GifPalette, skip = -1): NearestCache {
  if (palette.count < 1 || palette.count > 256 || palette.colors.length < palette.count * 3) {
    throw new RangeError('palette must have 1 to 256 entries');
  }
  return { palette, cells: new Int16Array(CACHE_CELLS).fill(-1), skip };
}

/**
 * The palette entry nearest to a colour, by a weighted RGB distance (green
 * counts most, as the eye sees it). `skip`: an entry never chosen.
 */
export function nearestIndex(palette: GifPalette, r: number, g: number, b: number, skip = -1): number {
  const { colors, count } = palette;
  let best = skip === 0 ? 1 : 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    if (i === skip) continue;
    const dr = colors[i * 3]! - r;
    const dg = colors[i * 3 + 1]! - g;
    const db = colors[i * 3 + 2]! - b;
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
      if (distance === 0) break;
    }
  }
  return best;
}

/** Maps one RGBA frame onto the palette: one index per pixel into `out`. */
export function indexFrame(rgba: Uint8Array | Uint8ClampedArray, pixels: number, cache: NearestCache, out: Uint8Array): void {
  const { cells, palette, skip } = cache;
  // A cell's representative colour is its centre, so the lookup is not biased downwards.
  const half = 1 << (KEY_SHIFT - 1);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const r = rgba[offset]! >> KEY_SHIFT;
    const g = rgba[offset + 1]! >> KEY_SHIFT;
    const b = rgba[offset + 2]! >> KEY_SHIFT;
    const key = (r << (KEY_BITS * 2)) | (g << KEY_BITS) | b;
    let index = cells[key]!;
    if (index < 0) {
      index = nearestIndex(palette, (r << KEY_SHIFT) + half, (g << KEY_SHIFT) + half, (b << KEY_SHIFT) + half, skip);
      cells[key] = index;
    }
    out[pixel] = index;
  }
}

/**
 * Pixels whose index is the same as in the frame on screen before it become
 * `transparentIndex`: the previous picture shows through (disposal "keep"),
 * so the frame looks exactly the same and the encoder writes long runs of one
 * value. Nothing is approximated: a pixel is transparent only when it would
 * have been drawn in the very same palette colour. `shown` is the picture on
 * screen, as indices; it is updated in place. Returns how many pixels changed.
 */
export function keepUnchanged(indices: Uint8Array, shown: Uint8Array, transparentIndex: number): number {
  let changed = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i]!;
    if (index === shown[i]) {
      indices[i] = transparentIndex;
    } else {
      shown[i] = index;
      changed += 1;
    }
  }
  return changed;
}
