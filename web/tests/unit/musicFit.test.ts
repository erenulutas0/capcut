import { describe, expect, it } from 'vitest';

import {
  addClip,
  applySilenceCuts,
  createEmptyProject,
  moveClipTo,
  removeClip,
  removeMusic,
  setMusicAsset,
  setVideoAsset,
  setVideoMuted,
  updateClipRange,
  updateMusic,
} from '@/application/commands';
import { commit, initHistory, undo } from '@/application/history';
import type { AssetV1, MusicV1, Project } from '@/domain/edl';
import { DEFAULT_KESIT_SETTINGS, downloadRecipe } from '@/domain/kesit';
import {
  downloadDurationUs,
  fitMusic,
  fittedMusicEndUs,
  healLegacyMusic,
  isLegacyMusicStub,
  isMusicFitted,
} from '@/domain/musicFit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { parseRecord, createRecord } from '@/domain/projectRecord';
import { compileRenderPlan } from '@/domain/renderPlan';
import { MIN_CLIP_DURATION_US, US_PER_SECOND } from '@/domain/time';
import { validateProject } from '@/domain/validation';

/**
 * Music covers the download it is saved with (`domain/musicFit.ts`). Found by
 * the opening-screen work: music added with no kesit was 0.1 s long, and
 * "Videoyu indir" saved the whole video with a tenth of a second of it
 * (the saved file is measured in tests/e2e/music-length.spec.ts).
 */

const S = US_PER_SECOND;

const video = (durationS = 20): AssetV1 => ({
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: durationS * S,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
});
const music = (durationS: number): AssetV1 => ({ assetId: 'a_music_001', kind: 'audio', durationUs: durationS * S });

const opened = (durationS = 20): Project => setVideoAsset(createEmptyProject(), video(durationS));

function withKesit(project: Project, fromS: number, toS: number): Project {
  const result = addClip(project, { sourceInUs: fromS * S, sourceOutUs: toS * S });
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

/** What "İndir" encodes, compiled: where the music really plays in the output. */
function plannedMusic(project: Project) {
  const recipe = downloadRecipe(project, { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
  if (!recipe) throw new Error('nothing to download');
  expect(validateProject(recipe)).toMatchObject({ ok: true, issues: [] });
  const plan = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
  if (!plan.ok) throw new Error('recipe refused');
  return plan.plan.audio.music;
}

describe('the length of the download', () => {
  it('is the whole video while there is no kesit, the joined kesitler after', () => {
    expect(downloadDurationUs(createEmptyProject())).toBe(0);
    expect(downloadDurationUs(opened(20))).toBe(20 * S);
    expect(downloadDurationUs(withKesit(opened(20), 2, 5))).toBe(3 * S);
    expect(downloadDurationUs(withKesit(withKesit(opened(20), 2, 5), 6, 10))).toBe(7 * S);
    // A video too short to be downloaded at all.
    expect(downloadDurationUs(setVideoAsset(createEmptyProject(), { ...video(), durationUs: MIN_CLIP_DURATION_US - 1 }))).toBe(0);
  });

  it('fitted music ends with the download, or with the file, and is never shorter than the recipe allows', () => {
    const start = { sourceInUs: 0, timelineStartUs: 0 };
    expect(fittedMusicEndUs(start, 60 * S, 20 * S)).toBe(20 * S);
    expect(fittedMusicEndUs(start, 8 * S, 20 * S)).toBe(8 * S);
    expect(fittedMusicEndUs(start, 60 * S, 0)).toBe(MIN_CLIP_DURATION_US);
    // The song from 0:30, coming in 5 s into the video: 15 s of it are heard.
    expect(fittedMusicEndUs({ sourceInUs: 30 * S, timelineStartUs: 5 * S }, 60 * S, 20 * S)).toBe(45 * S);
  });
});

describe('adding music', () => {
  it('with no kesit selects the whole video’s length — not 0.1 s (the bug)', () => {
    const project = setMusicAsset(opened(20), music(60));
    expect(project.clips).toHaveLength(0);
    expect(project.music).toMatchObject({ sourceInUs: 0, sourceOutUs: 20 * S, timelineStartUs: 0 });
    // In the compiled download the music runs for the whole 20 s.
    expect(plannedMusic(project)).toMatchObject({ sourceInUs: 0, sourceOutUs: 20 * S, timelineStartUs: 0 });
  });

  it('shorter music ends by itself; it is never looped or stretched', () => {
    expect(setMusicAsset(opened(20), music(8)).music?.sourceOutUs).toBe(8 * S);
  });

  it('with kesitler selects their joined length (as before)', () => {
    const project = setMusicAsset(withKesit(withKesit(opened(20), 2, 5), 6, 10), music(60));
    expect(project.music?.sourceOutUs).toBe(7 * S);
  });

  it('before any video there is nothing to cover yet; opening the video lays the music under it', () => {
    const alone = setMusicAsset(createEmptyProject(), music(60));
    expect(alone.music?.sourceOutUs).toBe(MIN_CLIP_DURATION_US);
    const withVideo = setVideoAsset(alone, video(20));
    expect(withVideo.music?.sourceOutUs).toBe(20 * S);
  });
});

describe('the music follows the download when kesitler change', () => {
  const base = () => setMusicAsset(opened(20), music(60));

  it('the first kesit, a second one, a removed one, a trimmed one', () => {
    let project = withKesit(base(), 2, 5);
    expect(project.music?.sourceOutUs).toBe(3 * S);
    project = withKesit(project, 6, 10);
    expect(project.music?.sourceOutUs).toBe(7 * S);
    const second = project.clips[1]?.clipId as string;
    const trimmed = updateClipRange(project, second, { sourceInUs: 6 * S, sourceOutUs: 12 * S });
    if (!trimmed.ok) throw new Error(trimmed.reason);
    expect(trimmed.project.music?.sourceOutUs).toBe(9 * S);
    const removed = removeClip(trimmed.project, project.clips[0]?.clipId as string);
    expect(removed.music?.sourceOutUs).toBe(6 * S);
    // The last kesit removed: the download is the whole video again.
    const none = removeClip(removed, second);
    expect(none.clips).toHaveLength(0);
    expect(none.music?.sourceOutUs).toBe(20 * S);
    expect(plannedMusic(none)?.sourceOutUs).toBe(20 * S);
  });

  it('silence cuts shorten the music with the video', () => {
    const project = setMusicAsset(withKesit(opened(20), 0, 10), music(60));
    const clipId = project.clips[0]?.clipId as string;
    const cut = applySilenceCuts(project, [{ clipId, startUs: 4 * S, endUs: 6 * S }], WEB_LOCAL_POLICY);
    if (!cut.ok) throw new Error(cut.reason);
    expect(downloadDurationUs(cut.project)).toBe(8 * S);
    expect(cut.project.music?.sourceOutUs).toBe(8 * S);
  });

  it('a change that keeps the length keeps the very same music object', () => {
    const project = withKesit(withKesit(base(), 2, 5), 6, 10);
    expect(moveClipTo(project, project.clips[0]?.clipId as string, 1).music).toBe(project.music);
    expect(setVideoMuted(project, true).music).toBe(project.music);
  });

  it('music longer than the limit of its own file stops at the file’s end and comes back when the video is short again', () => {
    let project = setMusicAsset(withKesit(opened(120), 0, 5), music(30));
    expect(project.music?.sourceOutUs).toBe(5 * S);
    project = withKesit(project, 10, 110);
    // 105 s of video, 30 s of music: all of the music, no more.
    expect(project.music?.sourceOutUs).toBe(30 * S);
    project = removeClip(project, project.clips[1]?.clipId as string);
    expect(project.music?.sourceOutUs).toBe(5 * S);
  });

  it('fades that no longer fit the shorter music are shortened; the recipe stays valid', () => {
    const long = setMusicAsset(withKesit(withKesit(opened(20), 0, 2), 5, 15), music(60));
    const faded = updateMusic(long, { fadeInUs: 4 * S, fadeOutUs: 6 * S });
    if (!faded.ok) throw new Error(faded.reason);
    const short = removeClip(faded.project, faded.project.clips[1]?.clipId as string);
    expect(short.music).toMatchObject({ sourceOutUs: 2 * S, fadeOutUs: 1 * S, fadeInUs: 1 * S });
    expect(validateProject(short)).toMatchObject({ ok: true, issues: [] });
  });

  it('one undo step takes the kesit and the music’s new end back together', () => {
    const start = base();
    let history = initHistory(start);
    history = commit(history, withKesit(history.present, 2, 5));
    history = commit(history, withKesit(history.present, 6, 10));
    expect(history.past).toHaveLength(2);
    expect(history.present.music?.sourceOutUs).toBe(7 * S);
    history = undo(history);
    expect(history.present.clips).toHaveLength(1);
    expect(history.present.music?.sourceOutUs).toBe(3 * S);
    history = undo(history);
    expect(history.present).toBe(start);
    expect(history.present.music?.sourceOutUs).toBe(20 * S);
  });
});

describe('a range the user set by hand', () => {
  it('is left alone by kesit changes', () => {
    const project = setMusicAsset(withKesit(opened(20), 0, 6), music(60));
    const own = updateMusic(project, { sourceOutUs: 2 * S });
    if (!own.ok) throw new Error(own.reason);
    expect(isMusicFitted(own.project)).toBe(false);
    const more = withKesit(own.project, 7, 10);
    expect(more.music).toBe(own.project.music);
    const less = removeClip(more, more.clips[0]?.clipId as string);
    expect(less.music).toBe(own.project.music);
  });

  it('set back to the end of the download, it follows again', () => {
    const project = setMusicAsset(withKesit(opened(20), 0, 6), music(60));
    const own = updateMusic(project, { sourceOutUs: 2 * S });
    if (!own.ok) throw new Error(own.reason);
    const back = updateMusic(own.project, { sourceOutUs: 6 * S });
    if (!back.ok) throw new Error(back.reason);
    expect(isMusicFitted(back.project)).toBe(true);
    expect(withKesit(back.project, 7, 10).music?.sourceOutUs).toBe(9 * S);
  });

  it('moving only the start of fitted music moves its end along', () => {
    const project = setMusicAsset(opened(20), music(60));
    // "Begin the song at 0:30": 20 s of it from there (used to be refused as a reversed range).
    const from30 = updateMusic(project, { sourceInUs: 30 * S });
    if (!from30.ok) throw new Error(from30.reason);
    expect(from30.project.music).toMatchObject({ sourceInUs: 30 * S, sourceOutUs: 50 * S });
    // "Let it come in after 5 s": 15 s are left to cover.
    const later = updateMusic(from30.project, { timelineStartUs: 5 * S });
    if (!later.ok) throw new Error(later.reason);
    expect(later.project.music).toMatchObject({ sourceInUs: 30 * S, sourceOutUs: 45 * S, timelineStartUs: 5 * S });
    expect(isMusicFitted(later.project)).toBe(true);
    // A start past the end of the file is still refused.
    expect(updateMusic(project, { sourceInUs: 60 * S })).toEqual({ ok: false, reason: 'range_reversed' });
  });

  it('level, mute and fades do not change the range', () => {
    const project = setMusicAsset(opened(20), music(60));
    const quieter = updateMusic(project, { gainDb: -20, fadeOutUs: 2 * S });
    if (!quieter.ok) throw new Error(quieter.reason);
    expect(quieter.project.music).toMatchObject({ sourceInUs: 0, sourceOutUs: 20 * S, gainDb: -20, fadeOutUs: 2 * S });
  });

  it('removing the music and changing kesitler afterwards is nothing special', () => {
    const project = removeMusic(setMusicAsset(opened(20), music(60)));
    expect(withKesit(project, 1, 2).music).toBeUndefined();
  });
});

describe('projects stored before the fix', () => {
  /** What the old rule stored when music was added with no kesit. */
  function legacy(): Project {
    const project = setMusicAsset(opened(20), music(60));
    const stub: MusicV1 = { ...(project.music as MusicV1), sourceOutUs: MIN_CLIP_DURATION_US };
    return { ...project, music: stub };
  }

  it('the 0.1 s stub is recognised, and only it', () => {
    expect(isLegacyMusicStub(legacy())).toBe(true);
    expect(isLegacyMusicStub(setMusicAsset(opened(20), music(60)))).toBe(false);
    // With a kesit, 0.1 s of music is somebody's (odd) choice.
    const withClip = withKesit(opened(20), 0, 5);
    const chosen = updateMusic(setMusicAsset(withClip, music(60)), { sourceOutUs: MIN_CLIP_DURATION_US });
    if (!chosen.ok) throw new Error(chosen.reason);
    expect(isLegacyMusicStub(chosen.project)).toBe(false);
  });

  it('opening one repairs the music: under the whole video, the rest of the recipe untouched', () => {
    const old = legacy();
    const healed = healLegacyMusic(old);
    expect(healed.music).toMatchObject({ sourceInUs: 0, sourceOutUs: 20 * S, timelineStartUs: 0, gainDb: -12 });
    expect(healed.revision).toBe(old.revision + 1);
    expect({ ...healed, music: old.music, revision: old.revision }).toEqual(old);
    expect(plannedMusic(healed)?.sourceOutUs).toBe(20 * S);
  });

  it('a record stored by the old build still loads (same schema, nothing migrated) and keeps its music', () => {
    // One kesit of 10 s with the music the old rule gave it (10 s), then a second kesit the old
    // rule did not follow: the music stayed at 10 s. That is a range like any other now.
    const old = withKesit(setMusicAsset(withKesit(opened(20), 0, 10), music(60)), 12, 18);
    const stored: Project = { ...old, music: { ...(old.music as MusicV1), sourceOutUs: 10 * S } };
    const parsed = parseRecord(JSON.parse(JSON.stringify(createRecord('p_local_001', 'tatil', stored, []))));
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.record.edl).toEqual(stored);
    expect(healLegacyMusic(parsed.record.edl)).toBe(parsed.record.edl);
    expect(isMusicFitted(parsed.record.edl)).toBe(false);
    // Left alone by the next kesit change, too: nothing is guessed about an old project.
    expect(removeClip(parsed.record.edl, parsed.record.edl.clips[1]?.clipId as string).music?.sourceOutUs).toBe(10 * S);
  });

  it('every other recipe comes back as the same object', () => {
    for (const project of [
      createEmptyProject(),
      opened(20),
      setMusicAsset(opened(20), music(60)),
      setMusicAsset(withKesit(opened(20), 0, 5), music(60)),
    ]) {
      expect(healLegacyMusic(project)).toBe(project);
    }
  });

  it('a stub that was not opened through the repair still heals with the first kesit', () => {
    const next = withKesit(legacy(), 2, 5);
    expect(next.music?.sourceOutUs).toBe(3 * S);
  });

  it('fitMusic leaves music that is already fitted as the same object', () => {
    const project = setMusicAsset(opened(20), music(60));
    expect(fitMusic(project)).toBe(project.music);
  });
});
