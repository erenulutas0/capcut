/**
 * The HDR -> SDR drawing path of the export (ADR-022).
 *
 * The browser converts an HDR frame (PQ/HLG, bt2020) to SDR when it is drawn
 * into a 2D canvas. Into an ordinary 8-bit canvas that conversion cuts bright
 * saturated colours at full scale (16% of the PQ ColorChecker frame in the
 * spike). A float16 canvas receives the same conversion with the overshoot
 * intact, and `softClipToRgba8` rolls it off instead. Both the runtime check
 * (hdrProbe.ts) and the frame loop draw through here, so what was checked is
 * what is exported.
 */

import { softClipHalfToRgba8, softClipToRgba8 } from '@/domain/hdr';

/** A float16 2D canvas, or null when this browser has none (then HDR is refused). */
export function createHdrContext(width: number, height: number): OffscreenCanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'function') return null;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', {
      alpha: false,
      colorType: 'float16',
    } as CanvasRenderingContext2DSettings) as OffscreenCanvasRenderingContext2D | null;
    if (!context) return null;
    const attributes = (context as unknown as { getContextAttributes?: () => { colorType?: string } })
      .getContextAttributes?.();
    return attributes?.colorType === 'float16' ? context : null;
  } catch {
    return null;
  }
}

/** Where the HDR steps of one frame are timed, when a profile was asked for. */
interface LapClock {
  lap(stage: 'hdrRead' | 'hdrClip'): void;
}

/**
 * The float read-back of an HDR frame: the raw bits of a `Float16Array` (the
 * fast, table-driven clip) or, from a browser that returns another float
 * array, its values (the float loop).
 */
export type HdrReadback = { kind: 'half'; bits: Uint16Array } | { kind: 'float'; values: ArrayLike<number> };

/**
 * Reads the float16 canvas back, or null when the browser does not hand out
 * float pixels: an 8-bit read-back would already be clipped, so there is no
 * proof and no use (refused, never pretended).
 */
export function readHdrPixels(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): HdrReadback | null {
  let floats: ArrayLike<number>;
  try {
    const image = context.getImageData(0, 0, width, height, {
      pixelFormat: 'rgba-float16',
    } as ImageDataSettings);
    floats = image.data as unknown as ArrayLike<number>;
  } catch {
    return null;
  }
  if (floats instanceof Uint8ClampedArray) return null;
  const bits = halfFloatBits(floats);
  return bits ? { kind: 'half', bits } : { kind: 'float', values: floats };
}

/** The soft clip of a read-back into 8-bit RGBA, in this thread. */
export function clipHdrPixels(pixels: HdrReadback, target: Uint8ClampedArray): void {
  if (pixels.kind === 'half') softClipHalfToRgba8(pixels.bits, target);
  else softClipToRgba8(pixels.values, target);
}

/**
 * Reads the float16 canvas back and returns the soft-clipped 8-bit picture,
 * or null when the browser does not hand out float pixels (no proof, no use).
 * The runtime check (hdrProbe) calls exactly this; the export runs the same
 * two steps, the clip possibly on a helper thread (`hdrClip.ts`).
 *
 * `reuse`: an ImageData of the same size from the previous frame, written
 * over instead of allocating 8 MB per 1080p frame (ADR-028). A float16
 * read-back is clipped from its raw half-float bits (`softClipHalfToRgba8`,
 * byte-identical to the float loop, unit tested over every half value).
 */
export function softClippedImage(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  reuse: ImageData | null = null,
  clock: LapClock | null = null,
): ImageData | null {
  const pixels = readHdrPixels(context, width, height);
  if (!pixels) return null;
  clock?.lap('hdrRead');
  const out = reuse && reuse.width === width && reuse.height === height ? reuse : new ImageData(width, height);
  clipHdrPixels(pixels, out.data);
  clock?.lap('hdrClip');
  return out;
}

/** The raw 16-bit patterns of a `Float16Array`, or null for any other array. */
function halfFloatBits(values: ArrayLike<number>): Uint16Array | null {
  const Half = (globalThis as { Float16Array?: new (...args: never[]) => ArrayBufferView }).Float16Array;
  if (typeof Half !== 'function' || !(values instanceof Half)) return null;
  const view = values as unknown as ArrayBufferView & { length: number };
  return new Uint16Array(view.buffer, view.byteOffset, view.length);
}
