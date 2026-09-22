import { describe, expect, it } from 'vitest';

import {
  addClip,
  addLeadingSource,
  addWholeSource,
  createEmptyProject,
  removeClip,
  setVideoAsset,
  splitAtTimelinePlayhead,
  updateClipRange,
} from '@/application/commands';
import { commit, initHistory, undo } from '@/application/history';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { formatLength, MIN_CLIP_DURATION_US, US_PER_SECOND } from '@/domain/time';
import { buildTimeline, totalOutputDurationUs } from '@/domain/timeline';
import {
  dragMinimumUs,
  dragTargetUs,
  floorAfterEdit,
  freezeScale,
  initialPlacement,
  leadingRange,
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
const FIVE_MIN = 5 * 60 * S;

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
    expect(initialPlacement(110 * S, WEB_LOCAL_POLICY)).toEqual({
      kind: 'whole',
      sourceInUs: 0,
      sourceOutUs: 110 * S,
    });
  });

  it('places a video of exactly the output limit whole', () => {
    expect(initialPlacement(FIVE_MIN, WEB_LOCAL_POLICY).kind).toBe('whole');
  });

  it('does not truncate a longer video: the user has to choose', () => {
    expect(initialPlacement(FIVE_MIN + 1, WEB_LOCAL_POLICY)).toEqual({
      kind: 'too_long',
      durationUs: FIVE_MIN + 1,
      limitUs: FIVE_MIN,
    });
    expect(initialPlacement(62 * 60 * S, WEB_LOCAL_POLICY).kind).toBe('too_long');
  });

  it('refuses a video shorter than the minimum piece, and nonsense durations', () => {
    expect(initialPlacement(MIN_CLIP_DURATION_US - 1, WEB_LOCAL_POLICY).kind).toBe('too_short');
    expect(initialPlacement(Number.NaN, WEB_LOCAL_POLICY).kind).toBe('too_short');
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

  it('addWholeSource refuses a video longer than the output limit instead of cutting it', () => {
    const result = addWholeSource(withVideo(12 * 60 * S));
    expect(result).toEqual({ ok: false, reason: 'source_longer_than_output' });
  });

  it('"İlk 5 dakikayı ekle" adds the leading five minutes, valid for export', () => {
    expect(leadingRange(12 * 60 * S, WEB_LOCAL_POLICY)).toEqual({ sourceInUs: 0, sourceOutUs: FIVE_MIN });
    const result = addLeadingSource(withVideo(12 * 60 * S));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.clips[0]).toMatchObject({ sourceInUs: 0, sourceOutUs: FIVE_MIN });
    expect(validateProject(result.project).ok).toBe(true);
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

  it('extending past the output limit stops at the limit', () => {
    const long = withRanges([[0, 4 * 60 * S]], 10 * 60 * S);
    const id = long.clips[0]?.clipId ?? '';
    const target = resolveEdgeTrim(long, id, 'out', 9 * 60 * S, WEB_LOCAL_POLICY);
    expect(target?.valueUs).toBe(FIVE_MIN);
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
