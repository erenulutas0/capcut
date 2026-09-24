import { describe, expect, it } from 'vitest';

import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { formatSpokenTime, MIN_CLIP_DURATION_US, US_PER_SECOND } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import { frameStepUs, resolveTrimTarget, snapToFrameGrid, trimBounds } from '@/domain/trim';
import { validateProject } from '@/domain/validation';
import {
  addClip,
  createEmptyProject,
  setVideoAsset,
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

  it('never lets an edge grow past the timeline limit (the input limit, ADR-021)', () => {
    const policy = { maxTotalSourceDurationUs: 10 * S };
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
