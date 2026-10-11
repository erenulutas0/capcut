/**
 * The size of a download's frame (ADR-041): the picture is never enlarged.
 *
 * `export.shortEdge` in the recipe is a CEILING — "en çok 1080p", "en çok
 * 720p" — not the size itself. The frame is the largest one, up to that
 * ceiling, in which no source pixel covers more than one output pixel:
 *
 * - a 1280 × 720 video in its own 16:9 frame is 1280 × 720 (not 1920 × 1080),
 *   a 640 × 360 one is 640 × 360 (not 1280 × 720);
 * - a 4K video with the 1080p ceiling is 1920 × 1080, as before;
 * - a crop is its own pixels: "Dikey yap → Doldur" on a 1280 × 720 video keeps
 *   a 406 × 720 slice, so the frame is 406 × 720, not 1080 × 1920; zoomed in
 *   twice, a 1080p video is 960 × 540;
 * - "Sığdır" (contain) adds bars, it does not add picture: the frame is as
 *   wide as the picture needs to stay 1:1 (640 × 360 in a 9:16 frame gives
 *   640 × 1138, the picture in it still 640 × 360). The bars are the only
 *   pixels the source did not have.
 *
 * With kesitler from videos of different sizes the frame follows the LARGEST
 * picture (the others are enlarged to it: one file has one size).
 *
 * Two floors, the only places a picture is enlarged at all:
 * - `MIN_OUTPUT_SHORT_EDGE`: below 144 px on the short side hardware H.264
 *   encoders and some players refuse the frame; such a picture is brought up
 *   to 144 px.
 * - `MIN_CAPTION_SHORT_EDGE`: subtitles burned into the picture are drawn
 *   with real letters (the size is a share of the short side, never under
 *   10 px). Under 360 px the letters no longer hold their shape and a line
 *   that fits every larger frame may not fit; a video with burned-in
 *   subtitles is therefore at least 360 px on its short side.
 * Neither floor lifts a frame above the ceiling the user chose.
 *
 * Pure: the render plan (`compileRenderPlan`) is the only caller that decides
 * a size; everything else reads the plan.
 */

import { outputPixelSize, type AspectRatio, type FitMode } from './edl';

/** The smallest frame worth encoding, on its short side (ADR-041). */
export const MIN_OUTPUT_SHORT_EDGE = 144;
/** …and with subtitles burned into the picture. */
export const MIN_CAPTION_SHORT_EDGE = 360;

/** What the size depends on in a kesit: the source pixels it shows and how they sit in the frame. */
export interface SizedSegment {
  crop: { width: number; height: number };
  fit: FitMode;
}

/** How much a segment's source pixels are scaled to sit in a frame of this size (1: not at all). */
export function segmentScale(frame: { width: number; height: number }, segment: SizedSegment): number | null {
  const { width, height } = segment.crop;
  if (!(width > 0) || !(height > 0)) return null;
  const scaleX = frame.width / width;
  const scaleY = frame.height / height;
  return segment.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
}

/**
 * The short edge the frame would have if the source pixels it shows were
 * not scaled at all: a 1080p landscape recording cropped to 9:16 has only 608
 * real pixels across, whatever the download's quality says. The largest value
 * over the kesitler, or null for a plan without segments.
 */
export function nativeShortEdge(plan: { width: number; height: number; segments: readonly SizedSegment[] }): number | null {
  let best: number | null = null;
  for (const segment of plan.segments) {
    const scale = segmentScale(plan, segment);
    if (scale === null) continue;
    const edge = Math.min(plan.width, plan.height) / scale;
    best = best === null ? edge : Math.max(best, edge);
  }
  return best === null ? null : Math.round(best);
}

/**
 * The least any kesit is scaled in this frame: at or under 1 means the
 * largest picture is not enlarged (smaller ones from other videos may be).
 */
function leastScale(frame: { width: number; height: number }, segments: readonly SizedSegment[]): number | null {
  let least: number | null = null;
  for (const segment of segments) {
    const scale = segmentScale(frame, segment);
    if (scale !== null) least = least === null ? scale : Math.min(least, scale);
  }
  return least;
}

export interface OutputSize {
  /** The frame's short edge, as `outputPixelSize` takes it. */
  shortEdge: number;
  width: number;
  height: number;
  /**
   * Why the frame is this size: `ceiling` — the user's limit (the source is
   * that large or larger); `source` — the picture's own pixels; `floor` — a
   * picture smaller than the smallest frame was enlarged to it.
   */
  rule: 'ceiling' | 'source' | 'floor';
}

/**
 * The frame of a download: the recipe's ceiling, lowered to the picture's
 * own pixels, held above the floor. `captions`: subtitles are burned in.
 */
export function outputSizeFor(
  aspect: AspectRatio,
  ceilingShortEdge: number,
  segments: readonly SizedSegment[],
  options: { captions?: boolean } = {},
): OutputSize {
  const at = (shortEdge: number, rule: OutputSize['rule']): OutputSize => ({ shortEdge, ...outputPixelSize(aspect, shortEdge), rule });
  const ceiling = at(ceilingShortEdge, 'ceiling');
  const native = nativeShortEdge({ ...ceiling, segments });
  if (native === null || native >= ceilingShortEdge) return ceiling;

  const floor = Math.min(ceilingShortEdge, options.captions ? MIN_CAPTION_SHORT_EDGE : MIN_OUTPUT_SHORT_EDGE);
  if (native <= floor) return at(floor, native === floor ? 'source' : 'floor');

  // Even dimensions can round a frame one pixel past the picture: step down until nothing is enlarged.
  let edge = native;
  let size = at(edge, 'source');
  while (edge > floor && (leastScale(size, segments) ?? 0) > 1 + 1e-9) {
    edge -= 1;
    size = at(edge, 'source');
  }
  return size;
}
