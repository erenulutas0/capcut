/**
 * Rules of the video strip under the preview (ADR-026; ADR-019 for the drag
 * rules that stayed).
 *
 * The strip shows the WHOLE source video on its own clock: the kesitler as
 * coloured regions, the pending Başlangıç/Bitiş range, and the one playhead.
 * These pure functions answer the questions the strip asks — how far it may
 * zoom, which time is under a pointer, where to scroll so the playhead stays
 * in view, and where a dragged edge may go. Nothing here changes the recipe;
 * commands do.
 */

import type { AspectRatio, Project } from './edl';
import type { ExportPolicy } from './policy';
import { MIN_CLIP_DURATION_US, type Micros } from './time';
import { frameStepUs, resolveTrimTarget, snapToFrameGrid, type FrameRate, type TrimEdge } from './trim';

/**
 * The shortest kesit an edge DRAG (or an arrow key on an edge) may leave.
 *
 * The first user test ended with forgotten 0.2 s leftovers (ADR-019). The
 * recipe still allows 0.1 s kesitler (typed times); only the imprecise
 * gesture is held at half a second. A kesit already shorter can only grow.
 */
export const MIN_DRAG_PIECE_US: Micros = 500_000;

/**
 * How far from exactly square a video may be and still get the 1:1 frame:
 * 5%, so 1080×1080, 1080×1034 and 1034×1080 all count as square.
 */
export const SQUARE_TOLERANCE = 0.05;

/**
 * The frame a video suggests for itself when it is opened: portrait → 9:16,
 * landscape → 16:9, near-square → 1:1. Uses the display size (rotation
 * already applied). `null` when the size is unknown; then the project's frame
 * is left alone. A restored project never asks this: its saved frame is the
 * user's choice.
 */
export function aspectForVideo(displayWidth: number | undefined, displayHeight: number | undefined): AspectRatio | null {
  if (!displayWidth || !displayHeight || !(displayWidth > 0) || !(displayHeight > 0)) return null;
  if (!Number.isFinite(displayWidth) || !Number.isFinite(displayHeight)) return null;
  const ratio = displayWidth / displayHeight;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return '1:1';
  return ratio < 1 ? '9:16' : '16:9';
}

// ------------------------------------------------------------------- zoom

/**
 * The shortest stretch of video the strip shows across its width when fully
 * zoomed in: 10 seconds. A 2-hour video is ~5 s per pixel at 1440 px when it
 * fits the width; fully zoomed in the same pixel is ~7 ms, finer than a frame.
 */
export const MIN_VISIBLE_SPAN_US: Micros = 10_000_000;

/** One zoom button press or pinch notch multiplies the zoom by this. */
export const ZOOM_STEP = 2;

/** The largest zoom for a video this long: 1 (fits the width) for short videos. */
export function maxStripZoom(durationUs: Micros): number {
  if (!(durationUs > 0)) return 1;
  return Math.max(1, durationUs / MIN_VISIBLE_SPAN_US);
}

export function clampStripZoom(zoom: number, durationUs: Micros): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(1, Math.min(maxStripZoom(durationUs), zoom));
}

/** The strip's scroll state: zoom (1 = whole video fits) and the scroll offset in px. */
export interface StripView {
  zoom: number;
  scrollPx: number;
}

/** Keeps the scroll inside the zoomed content. */
export function clampScroll(scrollPx: number, zoom: number, viewportPx: number): number {
  const maxScroll = Math.max(0, viewportPx * zoom - viewportPx);
  return Math.max(0, Math.min(maxScroll, Number.isFinite(scrollPx) ? scrollPx : 0));
}

/**
 * Zooms by `factor` keeping the time under `anchorPx` (a position inside the
 * visible strip) where it is: the pointer for Ctrl/⌘+wheel and pinch, the
 * playhead for the buttons.
 */
export function zoomAround(
  view: StripView,
  factor: number,
  anchorPx: number,
  viewportPx: number,
  durationUs: Micros,
): StripView {
  const zoom = clampStripZoom(view.zoom * factor, durationUs);
  if (!(viewportPx > 0)) return { zoom, scrollPx: 0 };
  const contentBefore = viewportPx * view.zoom;
  const fraction = (view.scrollPx + anchorPx) / contentBefore;
  const scrollPx = fraction * viewportPx * zoom - anchorPx;
  return { zoom, scrollPx: clampScroll(scrollPx, zoom, viewportPx) };
}

/** Pixel position of a time in the zoomed content. */
export function usToContentPx(us: Micros, durationUs: Micros, zoom: number, viewportPx: number): number {
  if (!(durationUs > 0)) return 0;
  return (us / durationUs) * viewportPx * zoom;
}

/**
 * The scroll that keeps the playhead in view. Nothing moves while it is
 * inside the visible part (with a margin); when it leaves, the strip pages so
 * the playhead sits a margin in from the edge it was heading to.
 */
export function scrollToShow(
  us: Micros,
  durationUs: Micros,
  view: StripView,
  viewportPx: number,
  marginPx = 24,
): number {
  if (view.zoom <= 1 || !(viewportPx > 0)) return 0;
  const x = usToContentPx(us, durationUs, view.zoom, viewportPx);
  const margin = Math.min(marginPx, viewportPx / 4);
  if (x < view.scrollPx + margin) return clampScroll(x - margin, view.zoom, viewportPx);
  if (x > view.scrollPx + viewportPx - margin) {
    return clampScroll(x - viewportPx + margin, view.zoom, viewportPx);
  }
  return view.scrollPx;
}

// ------------------------------------------------------ pointer and drags

/**
 * A drag's scale, frozen when the pointer goes down. Nothing that happens
 * during the drag (a re-render, a label changing width) feeds back into the
 * value under the pointer.
 */
export interface FrozenScale {
  usPerPx: number;
  originPx: number;
}

export function freezeScale(trackLeftPx: number, trackWidthPx: number, referenceUs: Micros): FrozenScale {
  const width = trackWidthPx > 0 ? trackWidthPx : 1;
  return { usPerPx: referenceUs / width, originPx: trackLeftPx };
}

/** Video time under a pointer x, clamped to [0, maxUs]. */
export function pointerToUs(scale: FrozenScale, clientX: number, maxUs: Micros): Micros {
  const us = Math.round((clientX - scale.originPx) * scale.usPerPx);
  return Math.max(0, Math.min(maxUs, us));
}

export interface EdgeTrimTarget {
  valueUs: Micros;
  /** True when the wish would have left less than the drag minimum. */
  heldAtMinimum: boolean;
  /** Length the kesit would have with this value. */
  lengthUs: Micros;
}

/** The shortest length a drag may leave this kesit: MIN_DRAG_PIECE_US, or its own length if shorter. */
export function dragMinimumUs(ownLengthUs: Micros): Micros {
  return Math.max(MIN_CLIP_DURATION_US, Math.min(MIN_DRAG_PIECE_US, ownLengthUs));
}

function wishedLength(edge: TrimEdge, rawUs: number, inUs: Micros, outUs: Micros): number {
  if (Number.isFinite(rawUs)) return edge === 'in' ? outUs - rawUs : rawUs - inUs;
  return rawUs > 0 === (edge === 'out') ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

/**
 * The edge value a drag or arrow key actually stores for a kesit: frame-
 * snapped and clamped like `resolveTrimTarget`, and never leaving the kesit
 * shorter than the drag minimum. When the wish goes past that minimum the
 * edge stops there and `heldAtMinimum` tells the UI to say so.
 */
export function resolveEdgeTrim(
  project: Project,
  clipId: string,
  edge: TrimEdge,
  rawUs: number,
  policy: Pick<ExportPolicy, 'maxTotalSourceDurationUs'>,
): EdgeTrimTarget | null {
  const clip = project.clips.find((item) => item.clipId === clipId);
  if (!clip) return null;
  const ownUs = clip.sourceOutUs - clip.sourceInUs;
  const minimumUs = dragMinimumUs(ownUs);
  const value = resolveTrimTarget(project, clipId, edge, rawUs, policy, minimumUs);
  if (value === null) return null;
  const lengthUs = edge === 'in' ? clip.sourceOutUs - value : value - clip.sourceInUs;
  // Half a frame of slack: the snapped minimum may sit a hair above the wish.
  const heldAtMinimum =
    wishedLength(edge, rawUs, clip.sourceInUs, clip.sourceOutUs) < minimumUs &&
    lengthUs - minimumUs < frameStepUs(project.export);
  return { valueUs: value, heldAtMinimum, lengthUs };
}

/**
 * The same for an edge of the range being marked (before "Kesit ekle"):
 * inside the video, on the frame grid, and at least the drag minimum long.
 * `range` is the pending range with its unmarked edges already filled in.
 */
export function resolvePendingEdge(
  range: { sourceInUs: Micros; sourceOutUs: Micros },
  edge: TrimEdge,
  rawUs: number,
  durationUs: Micros,
  rate: FrameRate,
): EdgeTrimTarget {
  const minimumUs = dragMinimumUs(range.sourceOutUs - range.sourceInUs);
  const low = edge === 'in' ? 0 : range.sourceInUs + minimumUs;
  const high = edge === 'in' ? range.sourceOutUs - minimumUs : durationUs;
  // The video's own start and end are real edges; rule limits go to the
  // nearest grid point inside them.
  const lowSnapped = low === 0 ? 0 : Math.min(high, snapToFrameGrid(low, rate, 'ceil'));
  const highSnapped = high === durationUs ? high : Math.max(lowSnapped, snapToFrameGrid(high, rate, 'floor'));
  const wished = Number.isFinite(rawUs)
    ? snapToFrameGrid(Math.max(0, Math.round(rawUs)), rate)
    : rawUs > 0
      ? highSnapped
      : lowSnapped;
  const valueUs = Math.min(highSnapped, Math.max(lowSnapped, wished));
  const lengthUs = edge === 'in' ? range.sourceOutUs - valueUs : valueUs - range.sourceInUs;
  const heldAtMinimum =
    wishedLength(edge, rawUs, range.sourceInUs, range.sourceOutUs) < minimumUs &&
    lengthUs - minimumUs < frameStepUs(rate);
  return { valueUs, heldAtMinimum, lengthUs };
}
