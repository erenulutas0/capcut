import { describe, expect, it } from 'vitest';

import {
  addClip,
  addCaptionCue,
  applySilenceCuts,
  convertCaptionTimeBase,
  createEmptyProject,
  selectWithinClipLimit,
  setVideoAsset,
} from '@/application/commands';
import { outputCues } from '@/domain/captions';
import type { AssetV1, Project } from '@/domain/edl';
import {
  DEFAULT_SILENCE_PARAMS,
  FLOOR_DB,
  findSilences,
  levelStats,
  piecesAfterRemoval,
  type LoudnessEnvelope,
} from '@/domain/silence';
import { totalOutputDurationUs } from '@/domain/timeline';
import { validateProject } from '@/domain/validation';

const S = 1_000_000;
const FRAME = 10_000;

/** Builds an envelope from [seconds, dB] runs at 10 ms frames. */
function envelope(runs: Array<[number, number]>, startUs = 0): LoudnessEnvelope {
  const db: number[] = [];
  for (const [seconds, level] of runs) {
    const frames = Math.round((seconds * S) / FRAME);
    for (let i = 0; i < frames; i += 1) db.push(level);
  }
  return { startUs, frameUs: FRAME, db };
}

const SPEECH = -20;
const ROOM = -62;

describe('levelStats', () => {
  it('puts the threshold between room tone and speech, away from both', () => {
    const stats = levelStats(envelope([[3, SPEECH], [1, ROOM]]).db);
    expect(stats.floorDb).toBe(ROOM);
    expect(stats.loudDb).toBe(SPEECH);
    expect(stats.thresholdDb).toBeGreaterThanOrEqual(ROOM + 6);
    expect(stats.thresholdDb).toBeLessThanOrEqual(SPEECH - 12);
  });

  it('is not dragged down by digital-silence gaps', () => {
    // Speech with room-tone pauses, plus a digital-silence gap.
    const stats = levelStats(envelope([[3, SPEECH], [0.8, ROOM], [3, SPEECH], [1, FLOOR_DB]]).db);
    expect(stats.thresholdDb).toBeGreaterThan(ROOM);
  });
});

describe('findSilences', () => {
  it('suggests a long pause, keeps a margin next to speech, and leaves short pauses', () => {
    const result = findSilences(
      envelope([[2, SPEECH], [0.4, ROOM], [2, SPEECH], [1.5, ROOM], [2, SPEECH]]),
      DEFAULT_SILENCE_PARAMS,
    );
    if (!result.ok) throw new Error(result.reason);
    // Only the 1.5 s pause (4.4–5.9 s), shrunk by 150 ms on both sides.
    expect(result.suggestions).toEqual([{ startUs: 4_550_000, endUs: 5_750_000 }]);
  });

  it('needs no margin at the edges of the moment', () => {
    const result = findSilences(envelope([[1, ROOM], [2, SPEECH], [1, ROOM]], 10 * S), DEFAULT_SILENCE_PARAMS);
    if (!result.ok) throw new Error(result.reason);
    expect(result.suggestions).toEqual([
      { startUs: 10_000_000, endUs: 10_850_000 },
      { startUs: 13_150_000, endUs: 14_000_000 },
    ]);
  });

  it('ignores a click inside a pause but not a short word', () => {
    const click = findSilences(
      envelope([[2, SPEECH], [0.6, ROOM], [0.03, SPEECH], [0.6, ROOM], [2, SPEECH]]),
      DEFAULT_SILENCE_PARAMS,
    );
    if (!click.ok) throw new Error(click.reason);
    expect(click.suggestions).toHaveLength(1);

    const word = findSilences(
      envelope([[2, SPEECH], [0.6, ROOM], [0.2, SPEECH], [0.6, ROOM], [2, SPEECH]]),
      DEFAULT_SILENCE_PARAMS,
    );
    if (!word.ok) throw new Error(word.reason);
    expect(word.suggestions).toHaveLength(0);
  });

  it('never suggests quiet speech as silence', () => {
    // A soft passage 15 dB under normal speech is still speech.
    const result = findSilences(
      envelope([[2, SPEECH], [2, SPEECH - 15], [1.2, ROOM], [2, SPEECH]]),
      DEFAULT_SILENCE_PARAMS,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.suggestions).toEqual([{ startUs: 4_150_000, endUs: 5_050_000 }]);
  });

  it('finds nothing under continuous music, and says why', () => {
    const music = findSilences(envelope([[2, -24], [1.5, -30], [2, -22]]), DEFAULT_SILENCE_PARAMS);
    expect(music).toMatchObject({ ok: false, reason: 'low_contrast' });
  });

  it('respects the parameters', () => {
    const env = envelope([[2, SPEECH], [0.9, ROOM], [2, SPEECH]]);
    const strict = findSilences(env, { ...DEFAULT_SILENCE_PARAMS, minSilenceUs: 1_000_000 });
    expect(strict.ok && strict.suggestions).toEqual([]);
    // 0.9 s minus 2 x 300 ms leaves 300 ms: still worth a cut.
    const wide = findSilences(env, { ...DEFAULT_SILENCE_PARAMS, keepUs: 300_000 });
    expect(wide.ok && wide.suggestions).toEqual([{ startUs: 2_300_000, endUs: 2_600_000 }]);
    // 400 ms margins leave 100 ms: below the smallest cut, so nothing.
    const wider = findSilences(env, { ...DEFAULT_SILENCE_PARAMS, keepUs: 400_000 });
    expect(wider.ok && wider.suggestions).toEqual([]);
    const tight = findSilences(env, { ...DEFAULT_SILENCE_PARAMS, keepUs: 50_000 });
    expect(tight.ok && tight.suggestions).toEqual([{ startUs: 2_050_000, endUs: 2_850_000 }]);
  });

  it('refuses a range too short to judge', () => {
    expect(findSilences(envelope([[0.3, SPEECH]]), DEFAULT_SILENCE_PARAMS)).toMatchObject({
      ok: false,
      reason: 'too_short',
    });
  });
});

describe('piecesAfterRemoval', () => {
  it('splits, trims and drops', () => {
    expect(piecesAfterRemoval(0, 10, [{ startUs: 3, endUs: 4 }])).toEqual([
      { startUs: 0, endUs: 3 },
      { startUs: 4, endUs: 10 },
    ]);
    expect(piecesAfterRemoval(0, 10, [{ startUs: 0, endUs: 2 }])).toEqual([{ startUs: 2, endUs: 10 }]);
    expect(piecesAfterRemoval(0, 10, [{ startUs: -5, endUs: 50 }])).toEqual([]);
  });
});

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 60 * S,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
};

function withMoments(ranges: Array<[number, number]>): Project {
  let project = setVideoAsset(createEmptyProject(), video);
  for (const [from, to] of ranges) {
    const result = addClip(project, { sourceInUs: from * S, sourceOutUs: to * S });
    if (!result.ok) throw new Error(result.reason);
    project = result.project;
  }
  return project;
}

describe('applySilenceCuts', () => {
  it('splits a moment around each cut, keeps settings and ids, one undo step', () => {
    const project = withMoments([[0, 10], [20, 30]]);
    const result = applySilenceCuts(project, [
      { clipId: 'c_001', startUs: 3 * S, endUs: 4 * S },
      { clipId: 'c_001', startUs: 9 * S, endUs: 10 * S },
      { clipId: 'c_002', startUs: 25 * S, endUs: 26.5 * S },
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.project.clips.map((clip) => [clip.clipId, clip.sourceInUs / S, clip.sourceOutUs / S])).toEqual([
      ['c_001', 0, 3],
      ['c_003', 4, 9],
      ['c_002', 20, 25],
      ['c_004', 26.5, 30],
    ]);
    expect(result.project.revision).toBe(project.revision + 1);
    expect(result.report).toEqual({ removedUs: 3.5 * S, clipsBefore: 2, clipsAfter: 4, droppedPieces: 0 });
    expect(totalOutputDurationUs(result.project)).toBe(16.5 * S);
    expect(validateProject(result.project).ok).toBe(true);
  });

  it('refuses to exceed the moment limit instead of relaxing it', () => {
    const project = withMoments([[0, 60]]);
    const cuts = Array.from({ length: 20 }, (_, i) => ({
      clipId: 'c_001',
      startUs: (i * 3 + 1) * S,
      endUs: (i * 3 + 2) * S,
    }));
    expect(applySilenceCuts(project, cuts)).toEqual({ ok: false, reason: 'clip_limit_exceeded', clipsAfter: 21 });

    const { selected, leftOut } = selectWithinClipLimit(project, cuts);
    expect(selected).toHaveLength(19);
    expect(leftOut).toBe(1);
    expect(applySilenceCuts(project, selected).ok).toBe(true);
  });

  it('prefers long cuts and still takes an edge cut that adds no moment', () => {
    const project = withMoments([[0, 30]]);
    const cuts = [
      ...Array.from({ length: 19 }, (_, i) => ({ clipId: 'c_001', startUs: (i + 1) * S, endUs: (i + 1.5) * S })),
      { clipId: 'c_001', startUs: 25 * S, endUs: 27 * S },
      { clipId: 'c_001', startUs: 29.8 * S, endUs: 30 * S },
    ];
    const { selected, leftOut } = selectWithinClipLimit(project, cuts);
    expect(selected.some((cut) => cut.startUs === 25 * S)).toBe(true);
    expect(selected.some((cut) => cut.startUs === 29.8 * S)).toBe(true);
    expect(leftOut).toBe(1);
  });

  it('source-anchored captions follow the cut picture', () => {
    let project = withMoments([[0, 10]]);
    const added = addCaptionCue(project, { startUs: 6 * S, endUs: 8 * S, text: 'sonra' });
    if (!added.ok) throw new Error(added.reason);
    const converted = convertCaptionTimeBase(added.project, 'source');
    if (!converted.ok) throw new Error(converted.reason);
    project = converted.project;
    const cut = applySilenceCuts(project, [{ clipId: 'c_001', startUs: 2 * S, endUs: 4 * S }]);
    if (!cut.ok) throw new Error(cut.reason);
    // The line was at output 6–8 s; two seconds before it were removed.
    expect(outputCues(cut.project).map((cue) => [cue.startUs / S, cue.endUs / S])).toEqual([[4, 6]]);
  });

  it('reports nothing to do', () => {
    expect(applySilenceCuts(withMoments([[0, 10]]), [])).toEqual({ ok: false, reason: 'nothing_to_remove' });
  });
});
