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

import { softClipToRgba8 } from '@/domain/hdr';

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

/**
 * Reads the float16 canvas back and returns the soft-clipped 8-bit picture,
 * or null when the browser does not hand out float pixels (no proof, no use).
 */
export function softClippedImage(context: OffscreenCanvasRenderingContext2D, width: number, height: number): ImageData | null {
  let floats: ArrayLike<number>;
  try {
    const image = context.getImageData(0, 0, width, height, {
      pixelFormat: 'rgba-float16',
    } as ImageDataSettings);
    floats = image.data as unknown as ArrayLike<number>;
  } catch {
    return null;
  }
  // An 8-bit readback would already be clipped: refuse rather than pretend.
  if (floats instanceof Uint8ClampedArray) return null;
  const out = new ImageData(width, height);
  softClipToRgba8(floats, out.data);
  return out;
}
