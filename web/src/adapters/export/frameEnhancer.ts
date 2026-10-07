/**
 * The step of the export's frame loop that applies "İyileştir" (ADR-037).
 *
 * Two engines behind one call, both the same maths (`domain/enhance.ts`):
 *
 * - `webgl2`: the shaders of `enhanceGl.ts`. Used only after a test picture
 *   rendered through them came back equal (within rounding) to the reference
 *   renderer's — checked once per worker, the way the HDR path is (ADR-022):
 *   a GPU or driver that computes something else is not trusted.
 * - `cpu`: the reference renderer itself, in this thread. Slower (measured in
 *   ADR-037), never different. Taken where WebGL2 is missing, will not
 *   compile, or failed the check.
 *
 * The preview of the wizard and the export both go through `apply`, so the
 * "after" picture the user sees is made by the code that makes the file.
 */

import {
  NEUTRAL_PARAMS,
  lookIsNeutral,
  renderEnhanced,
  toneIsNeutral,
  type EnhanceParams,
  type EnhanceScratch,
  type PictureRect,
} from '@/domain/enhance';
import { GlEnhancer } from './enhanceGl';

export type EnhanceEngine = 'webgl2' | 'cpu';

/** The GPU context was lost (or errored) mid-export: the frame cannot be trusted. */
export class EnhanceFailed extends Error {
  constructor() {
    super('enhance_failed');
    this.name = 'EnhanceFailed';
  }
}

export interface FrameEnhancer {
  readonly engine: EnhanceEngine;
  /** Enhances the picture on the context's canvas, in place. Throws `EnhanceFailed`. */
  apply(context: OffscreenCanvasRenderingContext2D, params: EnhanceParams, rect: PictureRect): void;
  close(): void;
}

function nothingToDo(params: EnhanceParams): boolean {
  return toneIsNeutral(params) && lookIsNeutral(params);
}

class GlFrameEnhancer implements FrameEnhancer {
  readonly engine = 'webgl2' as const;
  constructor(private readonly gl: GlEnhancer) {}

  apply(context: OffscreenCanvasRenderingContext2D, params: EnhanceParams, rect: PictureRect): void {
    if (nothingToDo(params)) return;
    if (!this.gl.render(context.canvas, params, rect)) throw new EnhanceFailed();
    context.drawImage(this.gl.canvas, 0, 0);
  }

  close(): void {
    this.gl.close();
  }
}

class CpuFrameEnhancer implements FrameEnhancer {
  readonly engine = 'cpu' as const;
  private scratch: EnhanceScratch | null = null;

  apply(context: OffscreenCanvasRenderingContext2D, params: EnhanceParams, rect: PictureRect): void {
    if (nothingToDo(params)) return;
    const { width, height } = context.canvas;
    const x = Math.min(Math.max(0, Math.round(rect.x)), width - 1);
    const y = Math.min(Math.max(0, Math.round(rect.y)), height - 1);
    const w = Math.max(1, Math.min(width - x, Math.round(rect.width)));
    const h = Math.max(1, Math.min(height - y, Math.round(rect.height)));
    // Only the picture is read and written back: the bars stay as they are.
    const image = context.getImageData(x, y, w, h);
    const result = renderEnhanced(image.data, w, h, params, { x: 0, y: 0, width: w, height: h }, image.data, this.scratch);
    this.scratch = result.scratch;
    context.putImageData(image, x, y);
  }

  close(): void {
    this.scratch = null;
  }
}

/* ------------------------------------------------------------ run-time check */

const CHECK_WIDTH = 96;
const CHECK_HEIGHT = 64;
/** Largest difference of one channel of one pixel, and of the mean, in 8-bit levels. */
export const CHECK_MAX_DIFFERENCE = 2;
export const CHECK_MEAN_DIFFERENCE = 0.4;

/** A small picture with everything the passes react to: ramps, colour, hard edges, grain. */
export function checkPicture(): ImageData {
  const image = new ImageData(CHECK_WIDTH, CHECK_HEIGHT);
  let seed = 12345;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < CHECK_HEIGHT; y += 1) {
    for (let x = 0; x < CHECK_WIDTH; x += 1) {
      const at = (y * CHECK_WIDTH + x) * 4;
      const ramp = x / (CHECK_WIDTH - 1);
      const band = Math.floor((y * 4) / CHECK_HEIGHT);
      let r = ramp * 200 + 20;
      let g = ramp * 200 + 20;
      let b = ramp * 200 + 20;
      if (band === 1) {
        // Colour patches, 12 pixels wide.
        const patch = Math.floor(x / 12) % 4;
        r = [200, 40, 60, 180][patch] ?? 0;
        g = [60, 170, 70, 160][patch] ?? 0;
        b = [50, 60, 190, 40][patch] ?? 0;
      } else if (band === 2) {
        // Hard edges every 6 pixels on a dim background.
        const high = Math.floor(x / 6) % 2 === 0;
        r = g = b = high ? 150 : 45;
      } else if (band === 3) {
        // Grain on a mid grey.
        const grain = (random() - 0.5) * 30;
        r = 110 + grain;
        g = 105 + grain * 0.8;
        b = 95 + grain * 1.1;
      }
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = 255;
    }
  }
  return image;
}

/** Two settings that between them switch every pass and every branch on. */
export const CHECK_PARAMS: readonly EnhanceParams[] = [
  {
    black: 0.02,
    gain: 1.7,
    gamma: 0.9,
    whiteBalance: [1.06, 0.99, 0.93],
    vibrance: 0.15,
    denoise: 6 / 255,
    sharpen: 1.2,
    sharpenThreshold: 0.5 / 255,
  },
  { ...NEUTRAL_PARAMS, gain: 1.25, sharpen: 2, vibrance: 0.3 },
];

/** The rectangle the check enhances: inset, so the untouched border is checked too. */
export const CHECK_RECT: PictureRect = { x: 5, y: 3, width: CHECK_WIDTH - 11, height: CHECK_HEIGHT - 7 };

export interface EnhanceCheckResult {
  ok: boolean;
  /** Largest and mean difference in 8-bit levels; null when nothing could be rendered. */
  maxDifference: number | null;
  meanDifference: number | null;
  halfFloat: boolean | null;
}

export function compareToReference(rendered: Uint8ClampedArray, picture: ImageData, params: EnhanceParams): {
  max: number;
  mean: number;
} {
  const { out } = renderEnhanced(picture.data, picture.width, picture.height, params, CHECK_RECT);
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let at = 0; at < out.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs((out[at + channel] ?? 0) - (rendered[at + channel] ?? 0));
      if (difference > max) max = difference;
      sum += difference;
      count += 1;
    }
  }
  return { max, mean: count > 0 ? sum / count : 0 };
}

/** Renders the test picture through the shaders and compares it with the reference renderer. */
export function checkGlEnhancer(): EnhanceCheckResult {
  const gl = GlEnhancer.create(CHECK_WIDTH, CHECK_HEIGHT);
  if (!gl) return { ok: false, maxDifference: null, meanDifference: null, halfFloat: null };
  try {
    const picture = checkPicture();
    let max = 0;
    let mean = 0;
    for (const params of CHECK_PARAMS) {
      if (!gl.render(picture, params, CHECK_RECT)) return { ok: false, maxDifference: null, meanDifference: null, halfFloat: gl.halfFloat };
      const rendered = gl.read();
      if (!rendered) return { ok: false, maxDifference: null, meanDifference: null, halfFloat: gl.halfFloat };
      const difference = compareToReference(rendered, picture, params);
      max = Math.max(max, difference.max);
      mean = Math.max(mean, difference.mean);
    }
    return {
      ok: max <= CHECK_MAX_DIFFERENCE && mean <= CHECK_MEAN_DIFFERENCE,
      maxDifference: max,
      meanDifference: mean,
      halfFloat: gl.halfFloat,
    };
  } catch {
    return { ok: false, maxDifference: null, meanDifference: null, halfFloat: null };
  } finally {
    gl.close();
  }
}

let glCheck: EnhanceCheckResult | null = null;

/** The check's answer for this worker (it cannot change while the worker lives). */
export function glEnhancerCheck(): EnhanceCheckResult {
  glCheck ??= checkGlEnhancer();
  return glCheck;
}

/**
 * The enhancer for one frame size: the GPU one where it passed the check,
 * the reference renderer otherwise. `forceCpu` is a measurement/test hook.
 */
export function createFrameEnhancer(width: number, height: number, forceCpu = false): FrameEnhancer {
  if (!forceCpu && glEnhancerCheck().ok) {
    const gl = GlEnhancer.create(width, height);
    if (gl) return new GlFrameEnhancer(gl);
  }
  return new CpuFrameEnhancer();
}
