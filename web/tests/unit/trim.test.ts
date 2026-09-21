import { describe, expect, it } from 'vitest';

import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { formatSpokenTime, MIN_CLIP_DURATION_US, US_PER_SECOND } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import {
  frameStepUs,
  resolveTrimTarget,
  snapToFrameGrid,
  splitPointAt,
  trimBounds,
} from '@/domain/trim';
import { validateProject } from '@/domain/validation';
import {
  addClip,
  createEmptyProject,
  removeClip,
  setClipGain,
  setClipMuted,
  setVideoAsset,
  splitClip,
  updateClipRange,
} from '@/application/commands';
import { commit, initHistory, redo, undo } from '@/application/history';

const S = US_PER_SECOND;
const RATE = { fpsNum: 30, fpsDen: 1 };

function withRanges(ranges: Array<[number, number]>, durationUs = 24 * S): Project {
  const video: AssetV1 = {
    assetId: 'a_video_001',
    kind: 'video',
    durationUs,
    displayWidth: 1920,
    displayHeight: 1080,
    hasAudio: true,
  };
  let project = setVideoAsset(createEmptyProject(), video);
  for (const [inUs, outUs] of ranges) {
    const result = addClip(project, { sourceInUs: inUs, sourceOutUs: outUs });
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    project = result.project;
  }
  return project;
}

describe('output frame grid', () => {
  it('uses the export frame rate: one frame is 33 333 µs at 30 fps', () => {
    expect(frameStepUs(RATE)).toBe(33_333);
    expect(frameStepUs({ fpsNum: 25, fpsDen: 1 })).toBe(40_000);
  });

  it('rounds to the nearest frame, integer microseconds only', () => {
    expect(snapToFrameGrid(0, RATE)).toBe(0);
    expect(snapToFrameGrid(16_666, RATE)).toBe(0);
    expect(snapToFrameGrid(16_667, RATE)).toBe(33_333);
    expect(snapToFrameGrid(4_010_000, RATE)).toBe(4_000_000);
    expect(snapToFrameGrid(4_020_000, RATE)).toBe(4_033_333);
    // Whole seconds are grid points: 30 frames = exactly 1 s.
    expect(snapToFrameGrid(8 * S, RATE)).toBe(8 * S);
    expect(Number.isInteger(snapToFrameGrid(123_456_789, RATE))).toBe(true);
  });

  it('floor and ceil never cross the input', () => {
    for (const us of [1, 33_332, 33_333, 33_334, 66_666, 66_667, 4_010_000, 23_999_999]) {
      expect(snapToFrameGrid(us, RATE, 'floor')).toBeLessThanOrEqual(us);
      expect(snapToFrameGrid(us, RATE, 'ceil')).toBeGreaterThanOrEqual(us);
    }
    expect(snapToFrameGrid(66_667, RATE, 'floor')).toBe(66_667);
    expect(snapToFrameGrid(66_666, RATE, 'floor')).toBe(33_333);
    expect(snapToFrameGrid(33_334, RATE, 'ceil')).toBe(66_667);
  });
});

describe('trim targets', () => {
  it('snaps a dragged edge to the grid', () => {
    const project = withRanges([[4 * S, 8 * S]]);
    expect(resolveTrimTarget(project, 'c_001', 'in', 3_010_000, WEB_LOCAL_POLICY)).toBe(3 * S);
    expect(resolveTrimTarget(project, 'c_001', 'out', 9_990_000, WEB_LOCAL_POLICY)).toBe(10 * S);
  });

  it('clamps the in-point to the source start', () => {
    const project = withRanges([[1 * S, 8 * S]]);
    expect(resolveTrimTarget(project, 'c_001', 'in', -5 * S, WEB_LOCAL_POLICY)).toBe(0);
    expect(resolveTrimTarget(project, 'c_001', 'in', Number.NEGATIVE_INFINITY, WEB_LOCAL_POLICY)).toBe(0);
  });

  it('clamps the out-point to the real source end, even off the grid', () => {
    // 10.01 s is not a multiple of 1/30 s; the end of the media is still a
    // legal edge.
    const project = withRanges([[2 * S, 6 * S]], 10_010_000);
    expect(resolveTrimTarget(project, 'c_001', 'out', 50 * S, WEB_LOCAL_POLICY)).toBe(10_010_000);
    expect(resolveTrimTarget(project, 'c_001', 'out', Number.POSITIVE_INFINITY, WEB_LOCAL_POLICY)).toBe(
      10_010_000,
    );
    // Just below the end, the grid still applies.
    expect(resolveTrimTarget(project, 'c_001', 'out', 9_990_000, WEB_LOCAL_POLICY)).toBe(10 * S);
  });

  it('keeps the minimum length on a grid point inside the limit', () => {
    const project = withRanges([[4 * S, 8 * S]]);
    const inMax = resolveTrimTarget(project, 'c_001', 'in', 20 * S, WEB_LOCAL_POLICY);
    expect(inMax).toBe(7_900_000); // 8 s − 0.1 s is exactly frame 237
    const outMin = resolveTrimTarget(project, 'c_001', 'out', 0, WEB_LOCAL_POLICY);
    expect(outMin).toBe(4_100_000);

    // Off-grid edges: the limit is met by the grid point inside it.
    const offGrid = withRanges([[4_010_000, 8_010_000]]);
    const inLimit = resolveTrimTarget(offGrid, 'c_001', 'in', 20 * S, WEB_LOCAL_POLICY);
    expect(inLimit).toBe(7_900_000);
    expect(8_010_000 - (inLimit ?? 0)).toBeGreaterThanOrEqual(MIN_CLIP_DURATION_US);
    const outLimit = resolveTrimTarget(offGrid, 'c_001', 'out', 0, WEB_LOCAL_POLICY);
    expect(outLimit).toBe(4_133_333);
    expect((outLimit ?? 0) - 4_010_000).toBeGreaterThanOrEqual(MIN_CLIP_DURATION_US);
  });

  it('falls back to the exact limit when no grid point fits', () => {
    // A 0.1 s moment that ends at an off-grid source end: its out-point cannot
    // move at all (shorter breaks the minimum, longer leaves the source), and
    // there is no grid point in that one-value range.
    const project = withRanges([[23_910_000, 24_010_000]], 24_010_000);
    const out = resolveTrimTarget(project, 'c_001', 'out', 0, WEB_LOCAL_POLICY);
    // ceil(24.01 s) = 24.0333 s would leave the source; the exact limit wins.
    expect(out).toBe(24_010_000);
  });

  it('never lets an edge grow past the output duration policy', () => {
    const policy = { maxOutputDurationUs: 10 * S };
    const project = withRanges([
      [0, 4 * S],
      [10 * S, 14 * S],
    ]);
    // 4 s used elsewhere, so this moment may be at most 6 s long.
    expect(trimBounds(project, 'c_002', 'out', policy)?.maxUs).toBe(16 * S);
    expect(resolveTrimTarget(project, 'c_002', 'out', 22 * S, policy)).toBe(16 * S);
    expect(resolveTrimTarget(project, 'c_002', 'in', 0, policy)).toBe(8 * S);
  });

  it('ignores other moments: reused and overlapping ranges are legal', () => {
    const project = withRanges([
      [4 * S, 8 * S],
      [6 * S, 12 * S],
    ]);
    expect(resolveTrimTarget(project, 'c_001', 'out', 11 * S, WEB_LOCAL_POLICY)).toBe(11 * S);
    expect(resolveTrimTarget(project, 'c_002', 'in', 2 * S, WEB_LOCAL_POLICY)).toBe(2 * S);
  });

  it('returns null for an unknown clip', () => {
    const project = withRanges([[0, 4 * S]]);
    expect(resolveTrimTarget(project, 'c_999', 'in', S, WEB_LOCAL_POLICY)).toBeNull();
    expect(trimBounds(project, 'c_999', 'out', WEB_LOCAL_POLICY)).toBeNull();
  });

  it('a committed trim is one undo step that round-trips', () => {
    const project = withRanges([[4 * S, 8 * S]]);
    const target = resolveTrimTarget(project, 'c_001', 'in', 2_990_000, WEB_LOCAL_POLICY);
    expect(target).toBe(3 * S);
    const result = updateClipRange(project, 'c_001', { sourceInUs: target ?? 0, sourceOutUs: 8 * S });
    if (!result.ok) throw new Error(result.reason);

    let history = commit(initHistory(project), result.project);
    expect(history.past).toHaveLength(1);
    expect(history.present.clips[0]?.sourceInUs).toBe(3 * S);
    history = undo(history);
    expect(history.present.clips[0]?.sourceInUs).toBe(4 * S);
    history = redo(history);
    expect(history.present.clips[0]?.sourceInUs).toBe(3 * S);
    expect(validateProject(history.present).ok).toBe(true);
  });
});

describe('split point from the playhead', () => {
  const project = withRanges([
    [0, 4 * S],
    [8 * S, 14 * S],
    [8 * S, 14 * S],
  ]);

  it('source mode: the playhead is a source time inside the moment', () => {
    expect(splitPointAt(project, 'c_002', { mode: 'source', sourceUs: 10 * S })).toEqual({
      ok: true,
      sourceUs: 10 * S,
    });
    expect(splitPointAt(project, 'c_002', { mode: 'source', sourceUs: 3 * S })).toEqual({
      ok: false,
      reason: 'playhead_outside_clip',
    });
  });

  it('treats the edges half-open and enforces the minimum length', () => {
    const at = (sourceUs: number) =>
      splitPointAt(project, 'c_002', { mode: 'source', sourceUs });
    expect(at(8 * S)).toEqual({ ok: false, reason: 'split_too_close_to_edge' });
    expect(at(14 * S)).toEqual({ ok: false, reason: 'playhead_outside_clip' });
    expect(at(8 * S + MIN_CLIP_DURATION_US - 1)).toEqual({
      ok: false,
      reason: 'split_too_close_to_edge',
    });
    expect(at(14 * S - MIN_CLIP_DURATION_US + 1)).toEqual({
      ok: false,
      reason: 'split_too_close_to_edge',
    });
    // Exactly the minimum on both sides is allowed.
    expect(at(8 * S + MIN_CLIP_DURATION_US)).toEqual({
      ok: true,
      sourceUs: 8 * S + MIN_CLIP_DURATION_US,
    });
    expect(at(14 * S - MIN_CLIP_DURATION_US)).toEqual({
      ok: true,
      sourceUs: 14 * S - MIN_CLIP_DURATION_US,
    });
  });

  it('output mode maps output time through the timeline', () => {
    // Output 5 s is 1 s into the second moment → source 9 s.
    expect(splitPointAt(project, 'c_002', { mode: 'output', outputUs: 5 * S })).toEqual({
      ok: true,
      sourceUs: 9 * S,
    });
    // Output 12 s is 2 s into the third moment → source 10 s.
    expect(splitPointAt(project, 'c_003', { mode: 'output', outputUs: 12 * S })).toEqual({
      ok: true,
      sourceUs: 10 * S,
    });
  });

  it('output mode does not confuse two occurrences of the same source range', () => {
    // Output 5 s shows source 9 s through moment 2. Moment 3 covers source 9 s
    // too, but the user is not looking at moment 3.
    expect(splitPointAt(project, 'c_003', { mode: 'output', outputUs: 5 * S })).toEqual({
      ok: false,
      reason: 'playhead_outside_clip',
    });
    // The same source time in source mode WOULD be inside moment 3.
    expect(splitPointAt(project, 'c_003', { mode: 'source', sourceUs: 9 * S }).ok).toBe(true);
  });

  it('output mode rejects the end of the output and moment boundaries', () => {
    expect(splitPointAt(project, 'c_003', { mode: 'output', outputUs: 16 * S })).toEqual({
      ok: false,
      reason: 'playhead_outside_clip',
    });
    // Output 4 s is the first frame of moment 2: its in-point.
    expect(splitPointAt(project, 'c_002', { mode: 'output', outputUs: 4 * S })).toEqual({
      ok: false,
      reason: 'split_too_close_to_edge',
    });
    expect(splitPointAt(project, 'c_001', { mode: 'output', outputUs: 4 * S })).toEqual({
      ok: false,
      reason: 'playhead_outside_clip',
    });
  });

  it('needs a selected, existing moment', () => {
    expect(splitPointAt(project, null, { mode: 'source', sourceUs: S })).toEqual({
      ok: false,
      reason: 'no_selection',
    });
    expect(splitPointAt(project, 'c_404', { mode: 'source', sourceUs: S })).toEqual({
      ok: false,
      reason: 'no_selection',
    });
  });

  it('respects the clip-count limit when a policy is given', () => {
    const full = { maxClips: 3 };
    expect(splitPointAt(project, 'c_002', { mode: 'source', sourceUs: 10 * S }, full)).toEqual({
      ok: false,
      reason: 'clip_limit_exceeded',
    });
  });
});

describe('splitClip', () => {
  it('cuts one moment in two, keeping settings, order and total length', () => {
    let project = withRanges([
      [0, 4 * S],
      [8 * S, 14 * S],
    ]);
    project = setClipGain(project, 'c_002', -9);
    project = setClipMuted(project, 'c_002', true);
    const before = totalOutputDurationUs(project);

    const result = splitClip(project, 'c_002', 10 * S);
    if (!result.ok) throw new Error(result.reason);
    const { clips } = result.project;

    expect(result.newClipId).toBe('c_003');
    expect(clips.map((clip) => [clip.clipId, clip.sourceInUs, clip.sourceOutUs])).toEqual([
      ['c_001', 0, 4 * S],
      ['c_002', 8 * S, 10 * S],
      ['c_003', 10 * S, 14 * S],
    ]);
    for (const half of clips.slice(1)) {
      expect(half.sourceGainDb).toBe(-9);
      expect(half.muted).toBe(true);
      expect(half.assetId).toBe('a_video_001');
    }
    // The halves do not share a view object: editing one must not edit both.
    expect(clips[1]?.view).toEqual(clips[2]?.view);
    expect(clips[1]?.view).not.toBe(clips[2]?.view);

    expect(totalOutputDurationUs(result.project)).toBe(before);
    expect(result.project.revision).toBe(project.revision + 1);
    expect(validateProject(result.project).ok).toBe(true);
  });

  it('generates the next id from the highest existing one, like addClip', () => {
    let project = withRanges([
      [0, 4 * S],
      [8 * S, 14 * S],
      [16 * S, 20 * S],
    ]);
    project = removeClip(project, 'c_002');
    const result = splitClip(project, 'c_001', 2 * S);
    if (!result.ok) throw new Error(result.reason);
    expect(result.newClipId).toBe('c_004');
    expect(result.project.clips.map((clip) => clip.clipId)).toEqual(['c_001', 'c_004', 'c_003']);
  });

  it('rejects invalid split points without touching the recipe', () => {
    const project = withRanges([[8 * S, 14 * S]]);
    expect(splitClip(project, 'c_001', 8 * S)).toEqual({
      ok: false,
      reason: 'split_too_close_to_edge',
    });
    expect(splitClip(project, 'c_001', 14 * S)).toEqual({
      ok: false,
      reason: 'playhead_outside_clip',
    });
    expect(splitClip(project, 'c_001', 13_950_000)).toEqual({
      ok: false,
      reason: 'split_too_close_to_edge',
    });
    expect(splitClip(project, 'nope', 10 * S)).toEqual({ ok: false, reason: 'no_selection' });
  });

  it('stops at the clip-count limit', () => {
    const ranges: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [i * S, i * S + S]);
    const project = withRanges(ranges);
    expect(splitClip(project, 'c_001', S / 2)).toEqual({
      ok: false,
      reason: 'clip_limit_exceeded',
    });
  });

  it('is one undo step that round-trips', () => {
    const project = withRanges([[8 * S, 14 * S]]);
    const result = splitClip(project, 'c_001', 11 * S);
    if (!result.ok) throw new Error(result.reason);

    let history = commit(initHistory(project), result.project);
    expect(history.past).toHaveLength(1);
    expect(history.present.clips).toHaveLength(2);
    history = undo(history);
    expect(history.present).toBe(project);
    expect(history.present.clips).toHaveLength(1);
    history = redo(history);
    expect(history.present.clips.map((clip) => clip.sourceOutUs)).toEqual([11 * S, 14 * S]);
  });
});

describe('spoken time', () => {
  const tr = { minute: 'dakika', second: 'saniye', decimalMark: ',' };

  it('reads like a sentence, keeping milliseconds', () => {
    expect(formatSpokenTime(8 * S, tr)).toBe('8 saniye');
    expect(formatSpokenTime(4_033_333, tr)).toBe('4,033 saniye');
    expect(formatSpokenTime(4_500_000, tr)).toBe('4,5 saniye');
    expect(formatSpokenTime(64_500_000, tr)).toBe('1 dakika 4,5 saniye');
    expect(formatSpokenTime(120 * S, tr)).toBe('2 dakika');
    expect(formatSpokenTime(0, tr)).toBe('0 saniye');
    expect(formatSpokenTime(-5, tr)).toBe('0 saniye');
  });
});
