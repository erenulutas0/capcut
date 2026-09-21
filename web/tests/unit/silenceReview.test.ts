import { describe, expect, it } from 'vitest';

import { addClip, createEmptyProject, setVideoAsset } from '@/application/commands';
import { previewSilenceCuts, reviewSilences, suggestionId } from '@/application/silenceReview';
import type { AssetV1, Project } from '@/domain/edl';
import { DEFAULT_SILENCE_PARAMS, type LoudnessEnvelope } from '@/domain/silence';

const S = 1_000_000;
const FRAME = 10_000;
const SPEECH = -20;
const ROOM = -62;

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 600 * S,
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

/** Envelope for a moment: runs of [seconds, dB] from the moment's start. */
function envelope(startUs: number, runs: Array<[number, number]>): LoudnessEnvelope {
  const db: number[] = [];
  for (const [seconds, level] of runs) {
    for (let i = 0; i < Math.round((seconds * S) / FRAME); i += 1) db.push(level);
  }
  return { startUs, frameUs: FRAME, db };
}

describe('reviewSilences', () => {
  it('marks moments without an envelope as pending and explains the others', () => {
    const project = withMoments([
      [0, 6],
      [10, 16],
      [20, 20.5],
    ]);
    const envelopes = new Map<number, LoudnessEnvelope>([
      [0, envelope(0, [[2, SPEECH], [2, ROOM], [2, SPEECH]])],
      // Continuous music: loud and quiet within a few dB.
      [10 * S, envelope(10 * S, [[3, -20], [3, -24]])],
      [20 * S, envelope(20 * S, [[0.5, SPEECH]])],
    ]);
    const review = reviewSilences(
      project,
      (clip) => (clip.sourceInUs === 20 * S ? undefined : envelopes.get(clip.sourceInUs)),
      DEFAULT_SILENCE_PARAMS,
    );
    expect(review.clips.map((clip) => clip.status)).toEqual(['ok', 'low_contrast', 'pending']);
    expect(review.pending).toBe(1);
    expect(review.suggestions).toHaveLength(1);
    const only = review.suggestions[0];
    expect(only).toMatchObject({ startUs: 2.15 * S, endUs: 3.85 * S, clipId: review.clips[0]?.clipId });
    expect(only?.id).toBe(suggestionId(only!));
    expect(review.defaultIds.has(only!.id)).toBe(true);
    expect(review.leftOut).toBe(0);
  });

  it('clamps a trailing suggestion to the moment end', () => {
    // 3.005 s moment: the envelope has a partial last frame that runs past it.
    const project = withMoments([[0, 3.005]]);
    const env = envelope(0, [[2, SPEECH], [1.01, ROOM]]);
    const review = reviewSilences(project, () => env, DEFAULT_SILENCE_PARAMS);
    expect(review.suggestions[0]?.endUs).toBe(3.005 * S);
  });

  it('pre-checks only the longest cuts that fit the 20-moment limit', () => {
    // 19 moments; each of the first two has one inner pause. Only one split fits.
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < 19; i += 1) ranges.push([i * 10, i * 10 + 6]);
    const project = withMoments(ranges);
    const review = reviewSilences(
      project,
      (clip) => {
        if (clip.sourceInUs === 0) return envelope(0, [[2, SPEECH], [2, ROOM], [2, SPEECH]]);
        if (clip.sourceInUs === 10 * S) return envelope(10 * S, [[2, SPEECH], [1.5, ROOM], [2.5, SPEECH]]);
        return envelope(clip.sourceInUs, [[6, SPEECH]]);
      },
      DEFAULT_SILENCE_PARAMS,
    );
    expect(review.suggestions).toHaveLength(2);
    expect(review.leftOut).toBe(1);
    const longest = review.suggestions.find((item) => item.startUs === 2.15 * S);
    expect(longest && review.defaultIds.has(longest.id)).toBe(true);
  });
});

describe('previewSilenceCuts', () => {
  it('reports exactly what Apply will do', () => {
    const project = withMoments([[0, 6]]);
    const clipId = project.clips[0]!.clipId;
    const preview = previewSilenceCuts(project, [{ clipId, startUs: 2 * S, endUs: 3 * S }]);
    expect(preview).toEqual({
      kind: 'ok',
      outputBeforeUs: 6 * S,
      outputAfterUs: 5 * S,
      clipsBefore: 1,
      clipsAfter: 2,
      droppedPieces: 0,
    });
  });

  it('says when nothing is chosen and when the limit would be exceeded', () => {
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < 20; i += 1) ranges.push([i * 10, i * 10 + 6]);
    const project = withMoments(ranges);
    expect(previewSilenceCuts(project, [])).toEqual({ kind: 'none' });
    const clipId = project.clips[0]!.clipId;
    expect(previewSilenceCuts(project, [{ clipId, startUs: 2 * S, endUs: 3 * S }])).toEqual({
      kind: 'limit',
      clipsAfter: 21,
      maxClips: 20,
    });
  });
});
