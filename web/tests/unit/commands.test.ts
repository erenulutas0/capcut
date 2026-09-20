import { describe, expect, it } from 'vitest';

import type { AssetV1 } from '@/domain/edl';
import { US_PER_SECOND } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import { validateProject } from '@/domain/validation';
import {
  addClip,
  createEmptyProject,
  currentFraming,
  moveClip,
  removeClip,
  removeMusic,
  setFraming,
  setMusicAsset,
  setVideoAsset,
  updateClipRange,
  updateMusic,
} from '@/application/commands';
import { canRedo, canUndo, commit, initHistory, redo, undo, HISTORY_LIMIT } from '@/application/history';

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 24 * US_PER_SECOND,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
};

const music: AssetV1 = {
  assetId: 'a_music_001',
  kind: 'audio',
  durationUs: 30 * US_PER_SECOND,
};

function withSource() {
  return setVideoAsset(createEmptyProject(), video);
}

function addRange(projectIn: ReturnType<typeof withSource>, fromS: number, toS: number) {
  const result = addClip(projectIn, {
    sourceInUs: fromS * US_PER_SECOND,
    sourceOutUs: toS * US_PER_SECOND,
  });
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.project;
}

describe('moment commands', () => {
  it('adds moments and computes the real total duration', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = addRange(project, 8, 14);
    expect(project.clips.map((clip) => clip.clipId)).toEqual(['c_001', 'c_002']);
    expect(totalOutputDurationUs(project)).toBe(10 * US_PER_SECOND);
    expect(validateProject(project).ok).toBe(true);
  });

  it('rejects reversed, out-of-source and too-short ranges', () => {
    const project = withSource();
    expect(addClip(project, { sourceInUs: 6e6, sourceOutUs: 2e6 })).toMatchObject({
      reason: 'range_reversed',
    });
    expect(addClip(project, { sourceInUs: 0, sourceOutUs: 30e6 })).toMatchObject({
      reason: 'range_out_of_source',
    });
    expect(addClip(project, { sourceInUs: 0, sourceOutUs: 50_000 })).toMatchObject({
      reason: 'clip_too_short',
    });
  });

  it('refuses to add a moment with no source', () => {
    expect(addClip(createEmptyProject(), { sourceInUs: 0, sourceOutUs: 1e6 })).toMatchObject({
      reason: 'no_source',
    });
  });

  it('allows the same source range twice', () => {
    let project = withSource();
    project = addRange(project, 2, 6);
    project = addRange(project, 2, 6);
    expect(project.clips).toHaveLength(2);
    expect(project.clips[0]?.sourceInUs).toBe(project.clips[1]?.sourceInUs);
    expect(project.clips[0]?.clipId).not.toBe(project.clips[1]?.clipId);
    expect(validateProject(project).ok).toBe(true);
  });

  it('reorders, removes and keeps revisions monotonic', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = addRange(project, 8, 14);
    project = addRange(project, 18, 22);
    const before = project.revision;

    project = moveClip(project, 'c_003', -1);
    expect(project.clips.map((clip) => clip.clipId)).toEqual(['c_001', 'c_003', 'c_002']);
    expect(project.revision).toBeGreaterThan(before);

    project = removeClip(project, 'c_001');
    expect(project.clips.map((clip) => clip.clipId)).toEqual(['c_003', 'c_002']);
  });

  it('ignores a move past the ends of the list', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    const revision = project.revision;
    expect(moveClip(project, 'c_001', -1).revision).toBe(revision);
    expect(moveClip(project, 'c_001', 1).revision).toBe(revision);
  });

  it('edits an existing range with the same rules', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    const ok = updateClipRange(project, 'c_001', {
      sourceInUs: 1 * US_PER_SECOND,
      sourceOutUs: 3 * US_PER_SECOND,
    });
    expect(ok.ok).toBe(true);
    expect(
      updateClipRange(project, 'c_001', { sourceInUs: 5e6, sourceOutUs: 1e6 }),
    ).toMatchObject({ reason: 'range_reversed' });
  });

  it('keeps the source file untouched when the video is replaced', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    const replaced = setVideoAsset(project, { ...video, assetId: 'a_video_002' });
    expect(replaced.clips).toHaveLength(0);
    expect(replaced.assets.filter((asset) => asset.kind === 'video')).toHaveLength(1);
    // The previous project object is untouched — commands never mutate.
    expect(project.clips).toHaveLength(1);
  });
});

describe('framing', () => {
  it('stores the derived view on every clip and round-trips the zoom', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = addRange(project, 8, 12);
    project = setFraming(project, { aspect: '9:16', fit: 'cover', zoom: 1.5 });

    expect(project.canvas.aspect).toBe('9:16');
    for (const clip of project.clips) {
      expect(clip.view.fit).toBe('cover');
      expect(clip.view.x + clip.view.width).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(currentFraming(project).zoom).toBeCloseTo(1.5, 5);
    expect(validateProject(project).ok).toBe(true);
  });

  it('switching to contain shows the whole frame', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = setFraming(project, { aspect: '9:16', fit: 'contain' });
    expect(project.clips[0]?.view).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('music', () => {
  it('attaches a music selection that matches the output length', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = addRange(project, 8, 14);
    project = setMusicAsset(project, music);

    expect(project.music?.sourceOutUs).toBe(10 * US_PER_SECOND);
    expect(project.music?.timelineStartUs).toBe(0);
    expect(validateProject(project).ok).toBe(true);
  });

  it('rejects fades longer than the selection and starts past the output', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = setMusicAsset(project, music);

    expect(updateMusic(project, { fadeInUs: 3e6, fadeOutUs: 3e6 })).toMatchObject({
      reason: 'fade_exceeds_selection',
    });
    expect(updateMusic(project, { timelineStartUs: 9e6 })).toMatchObject({
      reason: 'music_start_after_output',
    });
    expect(updateMusic(project, { sourceInUs: 0, sourceOutUs: 40e6 })).toMatchObject({
      reason: 'range_out_of_source',
    });
  });

  it('removing music drops the track and the audio asset', () => {
    let project = withSource();
    project = addRange(project, 0, 4);
    project = setMusicAsset(project, music);
    project = removeMusic(project);
    expect(project.music).toBeUndefined();
    expect(project.assets.some((asset) => asset.kind === 'audio')).toBe(false);
    expect(validateProject(project).ok).toBe(true);
  });
});

describe('undo / redo', () => {
  it('walks back and forward through domain edits', () => {
    let project = withSource();
    let history = initHistory(project);

    project = addRange(project, 0, 4);
    history = commit(history, project);
    project = addRange(project, 8, 14);
    history = commit(history, project);

    expect(totalOutputDurationUs(history.present)).toBe(10 * US_PER_SECOND);
    expect(canUndo(history)).toBe(true);

    history = undo(history);
    expect(history.present.clips).toHaveLength(1);
    history = undo(history);
    expect(history.present.clips).toHaveLength(0);
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    expect(history.present.clips).toHaveLength(1);
    expect(canRedo(history)).toBe(true);
  });

  it('a new edit clears the redo branch', () => {
    let project = withSource();
    let history = initHistory(project);
    project = addRange(project, 0, 4);
    history = commit(history, project);
    history = undo(history);
    expect(canRedo(history)).toBe(true);

    const other = addRange(history.present, 10, 14);
    history = commit(history, other);
    expect(canRedo(history)).toBe(false);
  });

  it('caps the history at 100 steps', () => {
    let project = addRange(withSource(), 0, 4);
    let history = initHistory(project);
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      project = setFraming(project, { zoom: 1 + (i % 4) * 0.25 });
      history = commit(history, project);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });

  it('stops adding moments at the policy clip limit', () => {
    let project = withSource();
    for (let i = 0; i < 20; i += 1) {
      project = addRange(project, i * 0.5, i * 0.5 + 0.5);
    }
    expect(project.clips).toHaveLength(20);
    expect(addClip(project, { sourceInUs: 0, sourceOutUs: 1e6 })).toMatchObject({
      reason: 'clip_limit_exceeded',
    });
  });
});
