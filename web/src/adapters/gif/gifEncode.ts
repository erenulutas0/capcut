/**
 * "GIF yap" (ADR-046): frames in, GIF bytes out. Runs in the GIF worker and
 * in the unit tests (no browser API is used here).
 *
 * The encoder is `gifenc` 1.0.3 (MIT, 9 KB, no dependencies): its PnnQuant
 * quantizer picks the colours and its LZW writer the bytes. This file adds
 * what the app decides itself (ADR-046):
 * - ONE palette for the whole GIF, chosen from pixels of every frame — the
 *   colours do not flicker from frame to frame, and a pixel that did not
 *   change can be left transparent (`keepUnchanged`): it costs almost nothing;
 * - pure white and pure black are always in it when there is text, so the
 *   letters and their edge are exactly white and black;
 * - no dithering (`domain/gifPalette.ts` says why);
 * - every frame 8 hundredths of a second, loops for ever.
 */

import { GIFEncoder, quantize, type GifencColor } from 'gifenc';

import { GIF_FRAME_DELAY_CS } from '@/domain/gif';
import { indexFrame, keepUnchanged, nearestCache, type GifPalette, type NearestCache } from '@/domain/gifPalette';

/** The palette entry left for "unchanged, show what was there". */
export const TRANSPARENT_INDEX = 255;

/** How many pixels the quantizer looks at, taken evenly from every frame: about eight frames of a 480-pixel GIF. */
export const PALETTE_SAMPLE_PIXELS = 8 * 480 * 270;

const WHITE: GifencColor = [255, 255, 255];
const BLACK: GifencColor = [0, 0, 0];

/**
 * The one palette of a GIF, from its frames (RGBA, all the same size). With
 * `text`: 253 picked colours + white + black; without: 255. Entry 255 is
 * left for transparency in both cases.
 */
export function buildGifPalette(frames: readonly Uint8Array[], text: boolean): GifPalette {
  if (frames.length === 0) throw new RangeError('no frames');
  const framePixels = (frames[0] as Uint8Array).length / 4;
  const total = framePixels * frames.length;
  const step = Math.max(1, Math.ceil(total / PALETTE_SAMPLE_PIXELS));
  const sample = new Uint8Array(Math.ceil(total / step) * 4);
  let written = 0;
  // Pixel `p` of the whole run, every `step`-th: every frame gives its share, wherever it lies.
  for (let p = 0; p < total; p += step) {
    const frame = frames[Math.floor(p / framePixels)] as Uint8Array;
    const offset = (p % framePixels) * 4;
    sample[written] = frame[offset]!;
    sample[written + 1] = frame[offset + 1]!;
    sample[written + 2] = frame[offset + 2]!;
    sample[written + 3] = 255;
    written += 4;
  }
  // `quantize` reads the whole buffer as 32-bit pixels: hand it an exact one.
  const exact = written === sample.length ? sample : sample.slice(0, written);
  const picked = quantize(exact, text ? 253 : 255);
  const rows: GifencColor[] = picked.map((color) => [color[0], color[1], color[2]]);
  if (text) rows.push(WHITE, BLACK);
  const colors = new Uint8Array(256 * 3);
  rows.slice(0, TRANSPARENT_INDEX).forEach((color, index) => colors.set([color[0], color[1], color[2]], index * 3));
  return { colors, count: Math.min(rows.length, TRANSPARENT_INDEX) };
}

function paletteRows(palette: GifPalette): GifencColor[] {
  const rows: GifencColor[] = [];
  for (let i = 0; i < 256; i += 1) {
    rows.push(i < palette.count ? [palette.colors[i * 3]!, palette.colors[i * 3 + 1]!, palette.colors[i * 3 + 2]!] : [0, 0, 0]);
  }
  return rows;
}

/** Writes one GIF frame by frame. */
export class GifWriter {
  private readonly encoder = GIFEncoder({ initialCapacity: 1 << 20 });
  private readonly cache: NearestCache;
  private readonly indices: Uint8Array;
  private readonly shown: Uint8Array;
  private frames = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly palette: GifPalette,
  ) {
    this.cache = nearestCache(palette, TRANSPARENT_INDEX);
    this.indices = new Uint8Array(width * height);
    this.shown = new Uint8Array(width * height);
  }

  get frameCount(): number {
    return this.frames;
  }

  /** Adds one RGBA frame of the GIF's size. */
  add(rgba: Uint8Array | Uint8ClampedArray): void {
    const { width, height } = this;
    indexFrame(rgba, width * height, this.cache, this.indices);
    const first = this.frames === 0;
    if (first) this.shown.set(this.indices);
    else keepUnchanged(this.indices, this.shown, TRANSPARENT_INDEX);
    this.encoder.writeFrame(this.indices, width, height, {
      // The first frame carries the one (global) colour table and the "loop for ever" block.
      palette: first ? paletteRows(this.palette) : null,
      repeat: 0,
      delay: GIF_FRAME_DELAY_CS * 10,
      transparent: !first,
      transparentIndex: TRANSPARENT_INDEX,
      // "Do not dispose": the next frame is drawn over this one, so its transparent pixels show it.
      dispose: 1,
    });
    this.frames += 1;
  }

  /** Bytes written so far (the estimate measures frames this way). */
  get byteLength(): number {
    return this.encoder.bytesView().length;
  }

  finish(): Uint8Array {
    this.encoder.finish();
    return this.encoder.bytes();
  }
}
