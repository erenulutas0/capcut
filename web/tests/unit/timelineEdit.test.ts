import { describe, expect, it } from 'vitest';

import {
  addClip,
  addWholeSource,
  createEmptyProject,
  removeClip,
  setVideoAsset,
  splitAtTimelinePlayhead,
  updateClipRange,
} from '@/application/commands';
import { commit, initHistory, undo } from '@/application/history';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY, maxTimelineDurationUs } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { formatLength, MIN_CLIP_DURATION_US, US_PER_SECOND } from '@/domain/time';
import { buildTimeline, totalOutputDurationUs } from '@/domain/timeline';
import {
  aspectForVideo,
  dragMinimumUs,
  dragTargetUs,
  floorAfterEdit,
  freezeScale,
  initialPlacement,
  MIN_DRAG_PIECE_US,
  outputStartOf,
  pieceAtOutput,
  pieceAtSource,
  playheadAfterRemoval,
  pointerToOutputUs,
  resolveEdgeTrim,
  splitAtPlayhead,
  timelineReferenceUs,
} from '@/domain/timelineEdit';
import { validateProject } from '@/domain/validation';

const S = US_PER_SECOND;
const MIN = 60 * S;
/** Doc 15 v4: 60 minutes of output, 120 minutes of input. */
const OUTPUT_LIMIT = WEB_LOCAL_POLICY.maxOutputDurationUs;
const INPUT_LIMIT = WEB_LOCAL_POLICY.maxTotalSourceDurationUs;

function withVideo(durationUs: number): Project {
  const video: AssetV1 = {
    assetId: 'a_video_001',
    kind: 'video',
    durationUs,
    displayWidth: 1080,
    displayHeight: 1920,
    hasAudio: true,
  };
  return setVideoAsset(createEmptyProject(), video);
}

function withRanges(ranges: Array<[number, number]>, durationUs = 110 * S): Project {
  let project = withVideo(durationUs);
  for (const [inUs, outUs] of ranges) {
    const result = addClip(project, { sourceInUs: inUs, sourceOutUs: outUs });
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    project = result.project;
  }
  return project;
}

function lengths(project: Project): number[] {
  return project.clips.map((clip) => clip.sourceOutUs - clip.sourceInUs);
}

describe('import: the whole video becomes one piece', () => {
  it('places a 1:50 video whole', () => {
    expect(initialPlacement(110 * S)).toEqual({
      kind: 'whole',
      sourceInUs: 0,
      sourceOutUs: 110 * S,
    });
  });

  it('ADR-021: a video longer than the output limit still arrives whole', () => {
    expect(OUTPUT_LIMIT).toBe(60 * MIN);
    expect(INPUT_LIMIT).toBe(120 * MIN);
    for (const durationUs of [310 * S, OUTPUT_LIMIT, OUTPUT_LIMIT + 1, 90 * MIN, INPUT_LIMIT]) {
      expect(initialPlacement(durationUs)).toEqual({ kind: 'whole', sourceInUs: 0, sourceOutUs: durationUs });
    }
  });

  it('a 90-minute piece is a valid recipe that the export gate refuses', () => {
    const result = addWholeSource(withVideo(90 * MIN));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.clips).toHaveLength(1);
    expect(totalOutputDurationUs(result.project)).toBe(90 * MIN);
    // Loads, saves, undoes: the recipe allows it.
    expect(validateProject(result.project).ok).toBe(true);
    // Only the download refuses it.
    expect(compileRenderPlan(result.project, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'output_duration_exceeds_policy',
    });
  });

  it('the longest openable video (the input limit) fits the timeline exactly', () => {
    expect(maxTimelineDurationUs(WEB_LOCAL_POLICY)).toBe(INPUT_LIMIT);
    const result = addWholeSource(withVideo(INPUT_LIMIT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateProject(result.project).ok).toBe(true);
  });

  it('refuses a video shorter than the minimum piece, and nonsense durations', () => {
    expect(initialPlacement(MIN_CLIP_DURATION_US - 1).kind).toBe('too_short');
    expect(initialPlacement(Number.NaN).kind).toBe('too_short');
  });

  it('addWholeSource adds exactly one valid full-length piece', () => {
    const result = addWholeSource(withVideo(110 * S));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.clips).toHaveLength(1);
    expect(result.project.clips[0]).toMatchObject({ sourceInUs: 0, sourceOutUs: 110 * S });
    expect(totalOutputDurationUs(result.project)).toBe(110 * S);
    expect(validateProject(result.project).ok).toBe(true);
  });

  it('split and delete a 2-hour piece down to the limit: then the export plan is exactly 60 minutes', () => {
    const whole = addWholeSource(withVideo(INPUT_LIMIT));
    if (!whole.ok) throw new Error('expected a piece');
    // Cut at 40:00 and 1:40:00 on the output clock, then delete both ends.
    const first = splitAtTimelinePlayhead(whole.project, { mode: 'output', outputUs: 40 * MIN });
    if (!first.ok) throw new Error(first.reason);
    const second = splitAtTimelinePlayhead(first.project, { mode: 'output', outputUs: 100 * MIN });
    if (!second.ok) throw new Error(second.reason);
    const [head, middle, tail] = second.project.clips;
    if (!head || !middle || !tail) throw new Error('expected three pieces');
    const kept = removeClip(removeClip(second.project, head.clipId), tail.clipId);
    expect(kept.clips).toEqual([expect.objectContaining({ sourceInUs: 40 * MIN, sourceOutUs: 100 * MIN })]);
    const plan = compileRenderPlan(kept, WEB_LOCAL_POLICY);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.expectedDurationUs).toBe(OUTPUT_LIMIT);
    expect(plan.plan.totalFrames).toBe(108_000);
    // One microsecond more is refused, before any frame.
    const over = updateClipRange(kept, middle.clipId, { sourceInUs: 40 * MIN, sourceOutUs: 100 * MIN + 1 });
    if (!over.ok) throw new Error(over.reason);
    expect(compileRenderPlan(over.project, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'output_duration_exceeds_policy',
    });
  });

  it('the piece is its own undo step on top of the import', () => {
    const imported = withVideo(110 * S);
    const whole = addWholeSource(imported);
    if (!whole.ok) throw new Error('expected a piece');
    const history = commit(commit(initHistory(createEmptyProject()), imported), whole.project);
    const back = undo(history);
    expect(back.present.clips).toHaveLength(0);
    // The video stays in the recipe: the timeline is empty, not the project.
    expect(back.present.assets.some((asset) => asset.kind === 'video')).toBe(true);
  });
});

describe('the piece under the playhead', () => {
  const project = withRanges([
    [0, 10 * S],
    [20 * S, 30 * S],
    [20 * S, 30 * S],
  ]);

  it('maps output time to the piece shown there (half-open)', () => {
    expect(pieceAtOutput(project, 0)?.index).toBe(0);
    expect(pieceAtOutput(project, 10 * S - 1)?.index).toBe(0);
    expect(pieceAtOutput(project, 10 * S)?.index).toBe(1);
    expect(pieceAtOutput(project, 25 * S)?.index).toBe(2);
  });

  it('treats the end of the timeline as the last piece', () => {
    expect(pieceAtOutput(project, 30 * S)?.index).toBe(2);
    expect(pieceAtOutput(project, 999 * S)?.index).toBe(2);
    expect(pieceAtOutput(createEmptyProject(), 0)).toBeNull();
  });

  it('in the source preview, prefers the selected piece when it shows the frame', () => {
    const [, second, third] = project.clips;
    expect(pieceAtSource(project, 25 * S, third?.clipId ?? null)?.index).toBe(2);
    expect(pieceAtSource(project, 25 * S, null)?.index).toBe(1);
    expect(pieceAtSource(project, 25 * S, second?.clipId ?? null)?.index).toBe(1);
    expect(pieceAtSource(project, 15 * S, null)).toBeNull();
  });
});

describe('Böl: split the piece under the playhead', () => {
  it('needs no selection: cuts the piece the output playhead is on', () => {
    const project = withRanges([[0, 110 * S]]);
    const result = splitAtTimelinePlayhead(project, { mode: 'output', outputUs: 26 * S });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(lengths(result.project)).toEqual([26 * S, 84 * S]);
    expect(result.index).toBe(0);
    expect(result.clipId).toBe(project.clips[0]?.clipId);
    expect(result.newClipId).toBe(result.project.clips[1]?.clipId);
    // The output is unchanged frame for frame.
    expect(totalOutputDurationUs(result.project)).toBe(110 * S);
  });

  it('cuts the right occurrence when a source range is used twice', () => {
    const project = withRanges([
      [0, 4 * S],
      [8 * S, 14 * S],
      [8 * S, 14 * S],
    ]);
    // Output 12 s is inside the THIRD piece (10–16 s), at source 10 s.
    const result = splitAtTimelinePlayhead(project, { mode: 'output', outputUs: 12 * S });
    expect(result.ok && result.index).toBe(2);
    if (!result.ok) return;
    expect(result.project.clips.map((clip) => [clip.sourceInUs, clip.sourceOutUs])).toEqual([
      [0, 4 * S],
      [8 * S, 14 * S],
      [8 * S, 10 * S],
      [10 * S, 14 * S],
    ]);
  });

  it('refuses within 0.1 s of a piece edge, and at the end of the timeline', () => {
    const project = withRanges([
      [0, 10 * S],
      [20 * S, 30 * S],
    ]);
    for (const outputUs of [0, MIN_CLIP_DURATION_US - 1, 10 * S - 1, 10 * S, 10 * S + 50_000, 20 * S]) {
      expect(splitAtPlayhead(project, { mode: 'output', outputUs }, WEB_LOCAL_POLICY)).toEqual({
        ok: false,
        reason: 'split_too_close_to_edge',
      });
    }
    // Exactly 0.1 s from an edge is allowed: both halves keep the minimum.
    expect(splitAtPlayhead(project, { mode: 'output', outputUs: MIN_CLIP_DURATION_US }, WEB_LOCAL_POLICY).ok).toBe(true);
  });

  it('refuses at the piece limit and on an empty timeline', () => {
    const full = withRanges(Array.from({ length: 20 }, (_, i): [number, number] => [i * S, i * S + S]));
    expect(splitAtPlayhead(full, { mode: 'output', outputUs: S / 2 }, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'clip_limit_exceeded',
    });
    expect(splitAtPlayhead(withVideo(10 * S), { mode: 'output', outputUs: 0 }, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'timeline_empty',
    });
  });

  it('in the source preview, cuts the piece that shows the source frame', () => {
    const project = withRanges([
      [0, 10 * S],
      [20 * S, 30 * S],
    ]);
    const result = splitAtTimelinePlayhead(project, { mode: 'source', sourceUs: 25 * S, preferClipId: null });
    expect(result.ok && result.index).toBe(1);
    expect(splitAtPlayhead(project, { mode: 'source', sourceUs: 15 * S, preferClipId: null }, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'playhead_outside_clip',
    });
  });
});

describe('Sil: delete and close up', () => {
  const project = withRanges([
    [0, 26 * S],
    [26 * S, 60 * S],
    [60 * S, 110 * S],
  ]);

  it('the rest closes up; output shrinks by the deleted length', () => {
    const middle = project.clips[1]?.clipId ?? '';
    const after = removeClip(project, middle);
    expect(lengths(after)).toEqual([26 * S, 50 * S]);
    expect(buildTimeline(after).map((entry) => entry.startUs)).toEqual([0, 26 * S]);
  });

  it('the playhead goes to where the deleted piece started, clamped to the new end', () => {
    const [first, middle, last] = project.clips;
    expect(playheadAfterRemoval(project, middle?.clipId ?? '')).toBe(26 * S);
    expect(playheadAfterRemoval(project, first?.clipId ?? '')).toBe(0);
    // Deleting the last piece: the old start (60 s) is the new end.
    expect(playheadAfterRemoval(project, last?.clipId ?? '')).toBe(60 * S);
    expect(outputStartOf(project, last?.clipId ?? '')).toBe(60 * S);
    expect(outputStartOf(project, 'nope')).toBeNull();
  });
});

describe('scale: frozen during a drag, kept after an edit', () => {
  it('keeps the width after a trim or delete until "Sığdır"', () => {
    // 110 s on the timeline, then trimmed to 80 s: the strip still stands for 110 s.
    const floor = floorAfterEdit(0, 110 * S);
    expect(timelineReferenceUs(80 * S, floor)).toBe(110 * S);
    // Growing the output past the floor grows the strip.
    expect(timelineReferenceUs(130 * S, floor)).toBe(130 * S);
    // "Sığdır" resets the floor.
    expect(timelineReferenceUs(80 * S, 0)).toBe(80 * S);
    // Never zero: an empty strip must not divide by zero.
    expect(timelineReferenceUs(0, 0)).toBe(1);
    expect(floorAfterEdit(120 * S, 80 * S)).toBe(120 * S);
  });

  it('maps pointer x to output time with the scale frozen at pointer-down', () => {
    const scale = freezeScale(100, 1000, 110 * S);
    expect(scale.usPerPx).toBe(110_000);
    expect(pointerToOutputUs(scale, 100, 110 * S - 1)).toBe(0);
    expect(pointerToOutputUs(scale, 600, 110 * S - 1)).toBe(55 * S);
    expect(pointerToOutputUs(scale, 50, 110 * S - 1)).toBe(0);
    expect(pointerToOutputUs(scale, 5000, 110 * S - 1)).toBe(110 * S - 1);
    // A 100 px drag is 11 s, whatever the layout does meanwhile.
    expect(dragTargetUs(scale, 14 * S, -100)).toBe(3 * S);
    // A zero-width track (not laid out) still yields a finite scale.
    expect(Number.isFinite(freezeScale(0, 0, 10 * S).usPerPx)).toBe(true);
  });
});

describe('edge drag: never an accidental sub-second leftover', () => {
  const project = withRanges([[0, 14 * S]]);
  const clipId = project.clips[0]?.clipId ?? '';

  it('a normal drag trims to the frame grid and reports the new length', () => {
    const target = resolveEdgeTrim(project, clipId, 'out', 10 * S + 10_000, WEB_LOCAL_POLICY);
    expect(target).toEqual({ valueUs: 10 * S, heldAtMinimum: false, lengthUs: 10 * S });
  });

  it('holds the piece at 0.5 s and says so, instead of leaving 0.2 s', () => {
    const out = resolveEdgeTrim(project, clipId, 'out', 200_000, WEB_LOCAL_POLICY);
    expect(out?.heldAtMinimum).toBe(true);
    expect(out?.lengthUs).toBeGreaterThanOrEqual(MIN_DRAG_PIECE_US);
    expect(out?.lengthUs).toBeLessThan(MIN_DRAG_PIECE_US + 40_000);
    const start = resolveEdgeTrim(project, clipId, 'in', 13.9 * S, WEB_LOCAL_POLICY);
    expect(start?.heldAtMinimum).toBe(true);
    expect((start?.lengthUs ?? 0) >= MIN_DRAG_PIECE_US).toBe(true);
    // End key on the start edge: as short as a drag may go.
    const end = resolveEdgeTrim(project, clipId, 'in', Number.POSITIVE_INFINITY, WEB_LOCAL_POLICY);
    expect(end?.heldAtMinimum).toBe(true);
  });

  it('a piece already shorter than 0.5 s can only grow', () => {
    const tiny = withRanges([[10 * S, 10 * S + 200_000]]);
    const id = tiny.clips[0]?.clipId ?? '';
    expect(dragMinimumUs(200_000)).toBe(200_000);
    const shrink = resolveEdgeTrim(tiny, id, 'out', 10 * S + 100_000, WEB_LOCAL_POLICY);
    expect(shrink?.valueUs).toBe(10 * S + 200_000);
    expect(shrink?.heldAtMinimum).toBe(true);
    const grow = resolveEdgeTrim(tiny, id, 'out', 11 * S, WEB_LOCAL_POLICY);
    expect(grow).toEqual({ valueUs: 11 * S, heldAtMinimum: false, lengthUs: S });
  });

  it('the recipe itself still accepts 0.1 s pieces (typed ranges, splits)', () => {
    const result = updateClipRange(project, clipId, { sourceInUs: 0, sourceOutUs: MIN_CLIP_DURATION_US });
    expect(result.ok).toBe(true);
    expect(dragMinimumUs(10 * S)).toBe(MIN_DRAG_PIECE_US);
  });

  it('ADR-021: extending past the OUTPUT limit is allowed (the export gate asks to cut)', () => {
    // Two pieces of a 55-minute video: 50 + 4 minutes. The second one may
    // grow to 20 minutes: 70 minutes of timeline, over the download limit.
    const long = withRanges([[0, 50 * MIN], [0, 4 * MIN]], 55 * MIN);
    const id = long.clips[1]?.clipId ?? '';
    const target = resolveEdgeTrim(long, id, 'out', 20 * MIN, WEB_LOCAL_POLICY);
    expect(target?.valueUs).toBe(20 * MIN);
    expect(target?.heldAtMinimum).toBe(false);
  });

  it('extending past the timeline limit (the input limit) stops at that limit', () => {
    // 100 + 4 minutes of a 110-minute video: the second piece can only grow
    // to 20 minutes before the timeline reaches 120.
    const long = withRanges([[0, 100 * MIN], [0, 4 * MIN]], 110 * MIN);
    const id = long.clips[1]?.clipId ?? '';
    const target = resolveEdgeTrim(long, id, 'out', 60 * MIN, WEB_LOCAL_POLICY);
    expect(target?.valueUs).toBe(20 * MIN);
    expect(target?.heldAtMinimum).toBe(false);
  });
});

describe('confirmation lengths', () => {
  const tr = { minute: 'dk', second: 'sn', decimalMark: ',' };
  it('reads to a tenth of a second', () => {
    expect(formatLength(14 * S, tr)).toBe('14,0 sn');
    expect(formatLength(10 * S, tr)).toBe('10,0 sn');
    expect(formatLength(250_000, tr)).toBe('0,3 sn');
    expect(formatLength(110 * S, tr)).toBe('1 dk 50,0 sn');
    expect(formatLength(59.96 * S, tr)).toBe('1 dk 0,0 sn');
    expect(formatLength(3.5 * S, { minute: 'min', second: 's', decimalMark: '.' })).toBe('3.5 s');
  });
});

describe('the frame follows the opened video', () => {
  it('portrait → 9:16, landscape → 16:9', () => {
    expect(aspectForVideo(1080, 1920)).toBe('9:16');
    expect(aspectForVideo(360, 640)).toBe('9:16');
    expect(aspectForVideo(480, 724)).toBe('9:16');
    expect(aspectForVideo(1920, 1080)).toBe('16:9');
    expect(aspectForVideo(640, 360)).toBe('16:9');
    // 4:3 and 3:4 are clearly not square.
    expect(aspectForVideo(1440, 1080)).toBe('16:9');
    expect(aspectForVideo(1080, 1440)).toBe('9:16');
  });

  it('near-square (within 5%) → 1:1', () => {
    expect(aspectForVideo(1080, 1080)).toBe('1:1');
    expect(aspectForVideo(1080, 1034)).toBe('1:1');
    expect(aspectForVideo(1034, 1080)).toBe('1:1');
    expect(aspectForVideo(1130, 1080)).toBe('1:1');
    // Just outside the tolerance.
    expect(aspectForVideo(1140, 1080)).toBe('16:9');
    expect(aspectForVideo(1020, 1080)).toBe('9:16');
  });

  it('an unknown size leaves the frame alone', () => {
    expect(aspectForVideo(undefined, 1080)).toBeNull();
    expect(aspectForVideo(1080, 0)).toBeNull();
    expect(aspectForVideo(Number.NaN, 1080)).toBeNull();
    expect(aspectForVideo(Number.POSITIVE_INFINITY, 1080)).toBeNull();
    expect(aspectForVideo(-1080, 1920)).toBeNull();
  });
});
