/**
 * Single-timeline editing rules (ADR-019).
 *
 * The editor has ONE playhead, on the output timeline. These pure functions
 * answer the questions the timeline asks — what goes on the timeline when a
 * video is opened, which piece is under the playhead, where the playhead goes
 * after a delete, how pixels map to time while a drag is in progress, and how
 * short a dragged edge may make a piece. Nothing here changes the recipe;
 * commands do.
 */

import type { AspectRatio, Project } from './edl';
import type { ExportPolicy } from './policy';
import { MIN_CLIP_DURATION_US, type Micros } from './time';
import { buildTimeline, totalOutputDurationUs, type TimelineEntry } from './timeline';
import {
  frameStepUs,
  resolveTrimTarget,
  splitPointAt,
  type SplitRejection,
  type TrimEdge,
} from './trim';

/**
 * The shortest piece an edge DRAG (or an arrow key on an edge) may leave.
 *
 * The user test ended with forgotten 0.2 s leftovers: a fit-to-width strip
 * hid how much a drag removed. The recipe still allows 0.1 s pieces (typed
 * ranges, splits); only the imprecise gesture is held at half a second. A
 * piece that is already shorter can only grow.
 */
export const MIN_DRAG_PIECE_US: Micros = 500_000;

// ---------------------------------------------------------------- import

export type InitialPlacement =
  /** The whole video fits the output limit: it becomes one piece. */
  | { kind: 'whole'; sourceInUs: Micros; sourceOutUs: Micros }
  /**
   * Longer than the output limit. Nothing is added silently; the user
   * chooses between the first `limitUs` or picking a range.
   */
  | { kind: 'too_long'; durationUs: Micros; limitUs: Micros }
  /** Shorter than the minimum piece: nothing can be added. */
  | { kind: 'too_short' };

/** What the timeline receives when a video with this duration is opened. */
export function initialPlacement(
  sourceDurationUs: Micros,
  policy: Pick<ExportPolicy, 'maxOutputDurationUs'>,
): InitialPlacement {
  if (!(sourceDurationUs >= MIN_CLIP_DURATION_US)) return { kind: 'too_short' };
  if (sourceDurationUs <= policy.maxOutputDurationUs) {
    return { kind: 'whole', sourceInUs: 0, sourceOutUs: sourceDurationUs };
  }
  return { kind: 'too_long', durationUs: sourceDurationUs, limitUs: policy.maxOutputDurationUs };
}

/**
 * How far from exactly square a video may be and still get the 1:1 frame:
 * 5%, so 1080×1080, 1080×1034 and 1034×1080 all count as square.
 */
export const SQUARE_TOLERANCE = 0.05;

/**
 * The frame a video suggests for itself when it is opened into an EMPTY
 * timeline: portrait → 9:16, landscape → 16:9, near-square → 1:1. Uses the
 * display size (rotation already applied). `null` when the size is unknown;
 * then the project's frame is left alone. A restored project never asks this:
 * its saved frame is the user's choice.
 */
export function aspectForVideo(displayWidth: number | undefined, displayHeight: number | undefined): AspectRatio | null {
  if (!displayWidth || !displayHeight || !(displayWidth > 0) || !(displayHeight > 0)) return null;
  if (!Number.isFinite(displayWidth) || !Number.isFinite(displayHeight)) return null;
  const ratio = displayWidth / displayHeight;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return '1:1';
  return ratio < 1 ? '9:16' : '16:9';
}

/** The range "İlk N dakikayı ekle" adds for a video longer than the output limit. */
export function leadingRange(
  sourceDurationUs: Micros,
  policy: Pick<ExportPolicy, 'maxOutputDurationUs'>,
): { sourceInUs: Micros; sourceOutUs: Micros } {
  return { sourceInUs: 0, sourceOutUs: Math.min(sourceDurationUs, policy.maxOutputDurationUs) };
}

// ------------------------------------------------------------ the playhead

/**
 * The piece the output playhead is on. The end of the timeline (half-open,
 * so no piece owns it) counts as the last piece: that is where the playhead
 * parks after playback, and the user is looking at the last piece's frame.
 */
export function pieceAtOutput(project: Pick<Project, 'clips'>, outputUs: Micros): TimelineEntry | null {
  const timeline = buildTimeline(project);
  if (timeline.length === 0) return null;
  const clamped = Math.max(0, outputUs);
  return (
    timeline.find((entry) => clamped >= entry.startUs && clamped < entry.endUs) ??
    timeline[timeline.length - 1] ??
    null
  );
}

/**
 * For the secondary source preview: the piece that shows this source time.
 * The selected piece wins when it contains it (the same range may be used
 * twice), otherwise the first one in output order.
 */
export function pieceAtSource(
  project: Pick<Project, 'clips'>,
  sourceUs: Micros,
  preferClipId: string | null,
): TimelineEntry | null {
  const timeline = buildTimeline(project);
  const contains = (entry: TimelineEntry) => sourceUs >= entry.sourceInUs && sourceUs < entry.sourceOutUs;
  const preferred = timeline.find((entry) => entry.clipId === preferClipId);
  if (preferred && contains(preferred)) return preferred;
  return timeline.find(contains) ?? null;
}

export type TimelineSplitRejection = SplitRejection | 'timeline_empty';

export type TimelineSplit =
  | { ok: true; clipId: string; index: number; sourceUs: Micros }
  | { ok: false; reason: TimelineSplitRejection };

/**
 * Where "Böl" cuts: the piece under the playhead, at the playhead. There is
 * no "select first" step and no "the playhead is not in the selected piece"
 * error; the only refusals are a cut too close to a piece edge (both halves
 * must keep the minimum length) and the piece-count limit.
 */
export function splitAtPlayhead(
  project: Project,
  playhead: { mode: 'output'; outputUs: Micros } | { mode: 'source'; sourceUs: Micros; preferClipId: string | null },
  policy: Pick<ExportPolicy, 'maxClips'>,
): TimelineSplit {
  if (project.clips.length === 0) return { ok: false, reason: 'timeline_empty' };
  if (playhead.mode === 'output') {
    const entry = pieceAtOutput(project, playhead.outputUs);
    if (!entry) return { ok: false, reason: 'timeline_empty' };
    const outputUs = Math.max(0, playhead.outputUs);
    // The end of the timeline is the last piece's out-point: too close.
    if (outputUs >= entry.endUs) return { ok: false, reason: 'split_too_close_to_edge' };
    // The piece is named explicitly, so another piece that reuses the same
    // source range can never be the one that gets cut.
    const sourceUs = entry.sourceInUs + (outputUs - entry.startUs);
    const point = splitPointAt(project, entry.clipId, { mode: 'source', sourceUs }, policy);
    return point.ok
      ? { ok: true, clipId: entry.clipId, index: entry.index, sourceUs: point.sourceUs }
      : { ok: false, reason: point.reason };
  }
  const entry = pieceAtSource(project, playhead.sourceUs, playhead.preferClipId);
  if (!entry) return { ok: false, reason: 'playhead_outside_clip' };
  const point = splitPointAt(project, entry.clipId, { mode: 'source', sourceUs: playhead.sourceUs }, policy);
  return point.ok
    ? { ok: true, clipId: entry.clipId, index: entry.index, sourceUs: point.sourceUs }
    : { ok: false, reason: point.reason };
}

/** Output time where a piece starts, or null when it is not on the timeline. */
export function outputStartOf(project: Pick<Project, 'clips'>, clipId: string): Micros | null {
  return buildTimeline(project).find((entry) => entry.clipId === clipId)?.startUs ?? null;
}

/**
 * After a piece is deleted the rest closes up. The playhead goes to where
 * the deleted piece began — now the start of the piece that followed it —
 * clamped to the new end, so the user sees the new cut.
 */
export function playheadAfterRemoval(before: Pick<Project, 'clips'>, clipId: string): Micros {
  const start = outputStartOf(before, clipId) ?? 0;
  const removed = buildTimeline(before).find((entry) => entry.clipId === clipId);
  const totalAfter = totalOutputDurationUs(before) - (removed?.durationUs ?? 0);
  return Math.max(0, Math.min(start, totalAfter));
}

// ------------------------------------------------------------------ scale

/**
 * The output length the strip's width stands for.
 *
 * Edits never rescale the timeline by themselves: after a trim or a delete
 * the strip keeps the length it had (`floorUs`), so the removed part shows as
 * empty track instead of the remaining piece silently growing back to full
 * width ("başa dönüyor"). It only grows when the output does, and the user
 * shrinks it on purpose with "Sığdır".
 */
export function timelineReferenceUs(totalUs: Micros, floorUs: Micros): Micros {
  return Math.max(1, totalUs, floorUs);
}

/** The floor to keep after an edit that changed the output from `totalBeforeUs`. */
export function floorAfterEdit(floorUs: Micros, totalBeforeUs: Micros): Micros {
  return Math.max(floorUs, totalBeforeUs);
}

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

/** Output time under a pointer x, clamped to [0, maxUs]. */
export function pointerToOutputUs(scale: FrozenScale, clientX: number, maxUs: Micros): Micros {
  const us = Math.round((clientX - scale.originPx) * scale.usPerPx);
  return Math.max(0, Math.min(maxUs, us));
}

/** Where an edge wishes to go after the pointer moved `deltaPx` since the press. */
export function dragTargetUs(scale: FrozenScale, startUs: Micros, deltaPx: number): number {
  return startUs + deltaPx * scale.usPerPx;
}

// ------------------------------------------------------ edge trim (drag)

export interface EdgeTrimTarget {
  valueUs: Micros;
  /** True when the wish would have left less than the drag minimum. */
  heldAtMinimum: boolean;
  /** Length the piece would have with this value. */
  lengthUs: Micros;
}

/** The shortest length a drag may leave this piece: MIN_DRAG_PIECE_US, or its own length if shorter. */
export function dragMinimumUs(ownLengthUs: Micros): Micros {
  return Math.max(MIN_CLIP_DURATION_US, Math.min(MIN_DRAG_PIECE_US, ownLengthUs));
}

/**
 * The edge value a drag or arrow key actually stores: frame-snapped and
 * clamped like `resolveTrimTarget`, and never leaving the piece shorter than
 * the drag minimum. When the wish goes past that minimum the edge stops there
 * and `heldAtMinimum` tells the UI to say so.
 */
export function resolveEdgeTrim(
  project: Project,
  clipId: string,
  edge: TrimEdge,
  rawUs: number,
  policy: Pick<ExportPolicy, 'maxOutputDurationUs'>,
): EdgeTrimTarget | null {
  const clip = project.clips.find((item) => item.clipId === clipId);
  if (!clip) return null;
  const ownUs = clip.sourceOutUs - clip.sourceInUs;
  const minimumUs = dragMinimumUs(ownUs);
  const value = resolveTrimTarget(project, clipId, edge, rawUs, policy, minimumUs);
  if (value === null) return null;
  const lengthUs = edge === 'in' ? clip.sourceOutUs - value : value - clip.sourceInUs;
  const wishedLengthUs = Number.isFinite(rawUs)
    ? edge === 'in'
      ? clip.sourceOutUs - rawUs
      : rawUs - clip.sourceInUs
    : rawUs > 0 === (edge === 'out')
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;
  // Half a frame of slack: the snapped minimum may sit a hair above the wish.
  const heldAtMinimum =
    wishedLengthUs < minimumUs && lengthUs - minimumUs < frameStepUs(project.export);
  return { valueUs: value, heldAtMinimum, lengthUs };
}
