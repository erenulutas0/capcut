/**
 * The single framing recipe shared by preview and (later) export.
 *
 * doc 09: "son `cover` hesabı preview ve export'ta aynı derleyiciden gelir."
 * The preview must never invent its own prettier geometry — it consumes
 * `placeView()` below, and a renderer will consume `cropPixels()` from the same
 * `ViewRectV1`. Only the destination differs.
 */

import { aspectRatioValue, type AspectRatio, type FitMode, type ViewRectV1 } from './edl';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Derives the normalised source region for a target aspect.
 *
 * `cover` selects a region with exactly the canvas aspect (edges get cropped).
 * `contain` keeps the whole frame and lets the canvas letterbox it.
 * `zoom` (>= 1) shrinks the selected region around its centre.
 */
export function computeSourceView(
  sourceWidth: number,
  sourceHeight: number,
  aspect: AspectRatio,
  fit: FitMode,
  zoom = 1,
): ViewRectV1 {
  const safeZoom = clamp(Number.isFinite(zoom) ? zoom : 1, MIN_ZOOM, MAX_ZOOM);

  let width = 1;
  let height = 1;

  if (fit === 'cover' && sourceWidth > 0 && sourceHeight > 0) {
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = aspectRatioValue(aspect);
    if (sourceAspect > canvasAspect) {
      width = canvasAspect / sourceAspect;
      height = 1;
    } else {
      width = 1;
      height = sourceAspect / canvasAspect;
    }
  }

  width = clamp(width / safeZoom, 1e-4, 1);
  height = clamp(height / safeZoom, 1e-4, 1);

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
    fit,
  };
}

/** Recovers the zoom factor a view rect represents, for round-tripping the UI. */
export function viewZoom(
  view: ViewRectV1,
  sourceWidth: number,
  sourceHeight: number,
  aspect: AspectRatio,
): number {
  const base = computeSourceView(sourceWidth, sourceHeight, aspect, view.fit, 1);
  if (base.width <= 0 || view.width <= 0) return 1;
  return clamp(base.width / view.width, MIN_ZOOM, MAX_ZOOM);
}

export interface PreviewPlacement {
  /** CSS size of the media element inside the frame, in px. */
  width: number;
  height: number;
  /** CSS offset of the media element relative to the frame's top-left, in px. */
  left: number;
  top: number;
}

/**
 * Positions the full source image inside a frame so that exactly `view` is
 * centred in it. Used by the DOM preview; the export renderer uses the same
 * `view` with `cropPixels()`.
 */
export function placeView(
  view: ViewRectV1,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): PreviewPlacement {
  if (sourceWidth <= 0 || sourceHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: 0, height: 0, left: 0, top: 0 };
  }

  const regionWidth = view.width * sourceWidth;
  const regionHeight = view.height * sourceHeight;
  const scaleX = frameWidth / regionWidth;
  const scaleY = frameHeight / regionHeight;
  const scale = view.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const displayedWidth = sourceWidth * scale;
  const displayedHeight = sourceHeight * scale;

  return {
    width: displayedWidth,
    height: displayedHeight,
    left: (frameWidth - regionWidth * scale) / 2 - view.x * sourceWidth * scale,
    top: (frameHeight - regionHeight * scale) / 2 - view.y * sourceHeight * scale,
  };
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The integer source-pixel rectangle an encoder would read. Even dimensions,
 * per doc 09 ("Encoder boyutları çift sayıya normalize edilir").
 */
export function cropPixels(
  view: ViewRectV1,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const width = even(view.width * sourceWidth);
  const height = even(view.height * sourceHeight);
  return {
    x: Math.max(0, Math.round(view.x * sourceWidth)),
    y: Math.max(0, Math.round(view.y * sourceHeight)),
    width: Math.min(even(sourceWidth), width),
    height: Math.min(even(sourceHeight), height),
  };
}
