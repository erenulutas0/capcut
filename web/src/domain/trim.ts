/**
 * Edge trimming and split-point maths.
 *
 * Pure functions over `Project`: the timeline drag handles, their keyboard
 * steps and the split action all ask these for a legal value instead of
 * computing one in a component. Nothing here changes the recipe; commands do.
 */

import type { Project } from './edl';
import type { ExportPolicy } from './policy';
import { frameAtUs, frameToUs } from './renderPlan';
import { MIN_CLIP_DURATION_US, type Micros } from './time';
import { mapOutputToSource, totalOutputDurationUs } from './timeline';

export type TrimEdge = 'in' | 'out';

export interface FrameRate {
  fpsNum: number;
  fpsDen: number;
}

/** Duration of one output frame, rounded like every other grid value. */
export function frameStepUs(rate: FrameRate): Micros {
  return frameToUs(1, rate.fpsNum, rate.fpsDen);
}

/**
 * Snaps a time onto the output frame grid (1/30 s for the W0 export spec).
 *
 * The grid is anchored at source 0: when both edges of every moment sit on it,
 * every moment lasts a whole number of output frames, so the output
 * boundaries land on the grid as well. `floor`/`ceil` never cross `us`.
 */
export function snapToFrameGrid(
  us: Micros,
  rate: FrameRate,
  direction: 'nearest' | 'floor' | 'ceil' = 'nearest',
): Micros {
  const { fpsNum, fpsDen } = rate;
  let frame = frameAtUs(us, fpsNum, fpsDen);
  if (direction === 'floor') {
    while (frame > 0 && frameToUs(frame, fpsNum, fpsDen) > us) frame -= 1;
  } else if (direction === 'ceil') {
    while (frameToUs(frame, fpsNum, fpsDen) < us) frame += 1;
  }
  return Math.max(0, frameToUs(frame, fpsNum, fpsDen));
}

export interface TrimBounds {
  /** Closed legal range for the edge, before grid snapping. */
  minUs: Micros;
  maxUs: Micros;
  /** The edge's current value. */
  valueUs: Micros;
}

/**
 * Where one edge of a moment may go. Only per-clip rules apply: other moments
 * may reuse or overlap the same source range (doc 10). The output-duration
 * policy is the one project-wide rule, and it caps how far an edge may grow.
 */
export function trimBounds(
  project: Project,
  clipId: string,
  edge: TrimEdge,
  policy: Pick<ExportPolicy, 'maxOutputDurationUs'>,
  /** Shortest length the edge may leave; the recipe minimum by default. */
  minLengthUs: Micros = MIN_CLIP_DURATION_US,
): TrimBounds | null {
  const clip = project.clips.find((item) => item.clipId === clipId);
  if (!clip) return null;
  const asset = project.assets.find((item) => item.assetId === clip.assetId);
  if (!asset) return null;

  const ownUs = clip.sourceOutUs - clip.sourceInUs;
  const maxLengthUs = Math.max(ownUs, policy.maxOutputDurationUs - (totalOutputDurationUs(project) - ownUs));
  const minimumUs = Math.max(MIN_CLIP_DURATION_US, Math.min(minLengthUs, ownUs));

  if (edge === 'in') {
    return {
      minUs: Math.max(0, clip.sourceOutUs - maxLengthUs),
      maxUs: clip.sourceOutUs - minimumUs,
      valueUs: clip.sourceInUs,
    };
  }
  return {
    minUs: clip.sourceInUs + minimumUs,
    maxUs: Math.min(asset.durationUs, clip.sourceInUs + maxLengthUs),
    valueUs: clip.sourceOutUs,
  };
}

/**
 * Turns a raw wished-for edge time (pointer position, keyboard step) into the
 * value that will actually be stored: snapped to the output frame grid and
 * clamped into the legal range.
 *
 * The source start (0) and the source end are real edges of the media, so an
 * edge may sit exactly on them even when the end is not on the grid. A limit
 * that comes from a rule (minimum length, output cap) is met by the nearest
 * grid point inside it; only if no grid point fits does the exact limit win.
 */
export function resolveTrimTarget(
  project: Project,
  clipId: string,
  edge: TrimEdge,
  rawUs: Micros,
  policy: Pick<ExportPolicy, 'maxOutputDurationUs'>,
  minLengthUs: Micros = MIN_CLIP_DURATION_US,
): Micros | null {
  const bounds = trimBounds(project, clipId, edge, policy, minLengthUs);
  if (!bounds) return null;
  const clip = project.clips.find((item) => item.clipId === clipId);
  const asset = project.assets.find((item) => item.assetId === clip?.assetId);
  const sourceEndUs = asset?.durationUs ?? Number.MAX_SAFE_INTEGER;
  const rate: FrameRate = project.export;

  const { minUs, maxUs } = bounds;
  let low = minUs === 0 ? 0 : snapToFrameGrid(minUs, rate, 'ceil');
  if (low > maxUs) low = minUs;
  let high = maxUs === sourceEndUs ? maxUs : snapToFrameGrid(maxUs, rate, 'floor');
  if (high < minUs) high = maxUs;

  const wished = Number.isFinite(rawUs)
    ? snapToFrameGrid(Math.max(0, Math.round(rawUs)), rate)
    : rawUs > 0
      ? high
      : low;
  return Math.min(high, Math.max(low, wished));
}

/**
 * Where the preview's playhead is, on the clock the current preview mode
 * actually shows. Source mode shows the file; result mode shows the output
 * timeline, where the same source second may appear more than once.
 */
export type Playhead =
  | { mode: 'source'; sourceUs: Micros }
  | { mode: 'output'; outputUs: Micros };

export type SplitRejection =
  | 'no_selection'
  | 'playhead_outside_clip'
  | 'split_too_close_to_edge'
  | 'clip_limit_exceeded';

export type SplitPoint = { ok: true; sourceUs: Micros } | { ok: false; reason: SplitRejection };

/**
 * The source time at which the playhead would cut the given moment.
 *
 * - Source mode: the playhead IS a source time, so it cuts the moment when it
 *   lies inside that moment's source range.
 * - Result mode: the playhead is an output time. It is mapped through the
 *   timeline and must land in THIS moment's output slot. A different moment
 *   that reuses the same source range does not count — the user is looking at
 *   that other occurrence, not this one.
 *
 * Both halves must keep the minimum clip length. With a policy, the clip-count
 * limit is checked as well, so the UI can disable the action up front.
 */
export function splitPointAt(
  project: Project,
  clipId: string | null,
  playhead: Playhead,
  policy?: Pick<ExportPolicy, 'maxClips'>,
): SplitPoint {
  const clip = clipId ? project.clips.find((item) => item.clipId === clipId) : undefined;
  if (!clip) return { ok: false, reason: 'no_selection' };

  let sourceUs: Micros;
  if (playhead.mode === 'source') {
    sourceUs = playhead.sourceUs;
  } else {
    const position = mapOutputToSource(project, playhead.outputUs);
    if (!position || position.entry.clipId !== clip.clipId) {
      return { ok: false, reason: 'playhead_outside_clip' };
    }
    sourceUs = position.sourceUs;
  }

  // Half-open: the in-point belongs to the moment, the out-point does not.
  if (sourceUs < clip.sourceInUs || sourceUs >= clip.sourceOutUs) {
    return { ok: false, reason: 'playhead_outside_clip' };
  }
  if (
    sourceUs - clip.sourceInUs < MIN_CLIP_DURATION_US ||
    clip.sourceOutUs - sourceUs < MIN_CLIP_DURATION_US
  ) {
    return { ok: false, reason: 'split_too_close_to_edge' };
  }
  // A split adds a moment, so it is bound by the clip-count limit too.
  if (policy && project.clips.length >= policy.maxClips) {
    return { ok: false, reason: 'clip_limit_exceeded' };
  }
  return { ok: true, sourceUs };
}
