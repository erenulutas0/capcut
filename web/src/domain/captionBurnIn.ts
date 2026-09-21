/**
 * Frame-level caption decisions for the export worker (ADR-015).
 *
 * Pure: the worker supplies the font measurement, this module decides which
 * cue a frame shows and lays every cue out exactly once. Keeping it here lets
 * the rules be unit-tested without a browser, and keeps the worker loop a
 * plain lookup per frame.
 */

import { layoutCaption, type CaptionFrame, type CaptionLayout, type MeasureText } from './captionLayout';
import type { RenderCaption, RenderCaptionPlan } from './renderPlan';

/**
 * Index of the cue covering `frame`, or -1. Cues are sorted and do not overlap
 * (the render plan guarantees it), and ranges are half-open: a cue's
 * `endFrame` already belongs to whatever comes next.
 *
 * Binary search rather than a moving cursor: the worker visits frames in
 * order, but a lookup that cannot go stale is worth the log(n) at 500 cues.
 */
export function cueIndexAtFrame(cues: readonly RenderCaption[], frame: number): number {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (!cue) return -1;
    if (frame < cue.startFrame) high = mid - 1;
    else if (frame >= cue.endFrame) low = mid + 1;
    else return mid;
  }
  return -1;
}

export type CaptionPreflight =
  | { ok: true; layouts: CaptionLayout[] }
  | {
      ok: false;
      reason: 'caption_does_not_fit';
      /** Which cue, so the user can be told what to shorten. */
      cueId: string;
      cueIndex: number;
    };

/**
 * Lays out every cue once, before a single frame is encoded.
 *
 * The layout depends only on text, style and frame size, all fixed for an
 * export, so this array is also the per-cue cache the frame loop draws from:
 * a five-minute export does not re-wrap text 9000 times. A cue that would need
 * a third line fails the whole export up front instead of halfway through,
 * and is never shrunk to fit (ADR-015).
 */
export function preflightCaptions(
  captions: RenderCaptionPlan,
  frame: CaptionFrame,
  measure: MeasureText,
): CaptionPreflight {
  const layouts: CaptionLayout[] = [];
  for (const [cueIndex, cue] of captions.cues.entries()) {
    const result = layoutCaption(cue.text, captions.style, frame, measure);
    if (!result.ok) return { ok: false, reason: result.reason, cueId: cue.cueId, cueIndex };
    layouts.push(result.layout);
  }
  return { ok: true, layouts };
}
