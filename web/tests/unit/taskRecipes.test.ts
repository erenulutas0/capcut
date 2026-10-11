import { describe, expect, it } from 'vitest';

import {
  createEmptyProject,
  setExportShortEdge,
  setFraming,
  setMusicAsset,
  setVideoAsset,
  withWholeKesit,
} from '@/application/commands';
import {
  MUSIC_ALONE_DB,
  MUSIC_BEHIND_DB,
  MUSIC_FADE_OUT_US,
  SHORT_GAP_US,
  alreadyPlaysEverywhere,
  lengthsAfterCut,
  musicLengthUs,
  musicOutlastsVideo,
  musicUnderVideo,
  ownSizeRecipe,
  silenceParamsFor,
  soundlessRecipe,
  taggedFileName,
  withMusicDefaults,
} from '@/application/taskRecipes';
import type { AssetV1, Project } from '@/domain/edl';
import { DEFAULT_KESIT_SETTINGS, downloadRecipe } from '@/domain/kesit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { DEFAULT_SILENCE_PARAMS, SILENCE_PARAM_LIMITS } from '@/domain/silence';
import { US_PER_SECOND } from '@/domain/time';
import { validateProject } from '@/domain/validation';

const S = US_PER_SECOND;

function video(patch: Partial<AssetV1> = {}): AssetV1 {
  return { assetId: 'a_video_001', kind: 'video', durationUs: 20 * S, displayWidth: 1920, displayHeight: 1080, hasAudio: true, ...patch };
}

function music(durationS: number): AssetV1 {
  return { assetId: 'a_music_001', kind: 'audio', durationUs: durationS * S };
}

const opened = (asset = video()): Project => setVideoAsset(createEmptyProject(), asset);

/** The whole video as one kesit (the wizards that cut or frame work on one). */
function wholeVideoAsKesit(project: Project): Project {
  if (project.clips.length > 0) return project;
  const result = withWholeKesit(project);
  return result.ok ? result.project : project;
}

/**
 * Every recipe a wizard hands to the export must be one the compiler accepts.
 * A recipe with no kesit is downloaded as the whole video (`downloadRecipe`),
 * with the sound setting the wizard holds.
 */
function expectExportable(project: Project, settings = DEFAULT_KESIT_SETTINGS) {
  const recipe = downloadRecipe(project, { kind: 'all' }, settings);
  expect(recipe).not.toBeNull();
  if (!recipe) return;
  expect(validateProject(recipe)).toMatchObject({ ok: true, issues: [] });
  expect(compileRenderPlan(recipe, WEB_LOCAL_POLICY).ok).toBe(true);
}

describe('taggedFileName', () => {
  it('names the result after the video and what was done, never as the original', () => {
    expect(taggedFileName('tatil.mp4', 'dikey')).toBe('tatil_dikey.mp4');
    expect(taggedFileName('IMG 0042.MOV', 'uyumlu')).toBe('IMG-0042_uyumlu.mp4');
    expect(taggedFileName('düğün videosu (1).mp4', 'bosluksuz')).toBe('düğün-videosu-1_bosluksuz.mp4');
    expect(taggedFileName('....', 'muzikli')).toBe('video_muzikli.mp4');
    expect(taggedFileName('tatil_dikey.mp4', 'dikey')).not.toBe('tatil_dikey.mp4');
  });
});

describe('the video’s own size', () => {
  it('a wizard starts from “the video’s own size, up to Full HD”, whatever limit the editor was left at', () => {
    const fresh = opened(video({ displayWidth: 1280, displayHeight: 720 }));
    // The default already says so: nothing changes, not even the revision.
    expect(ownSizeRecipe(fresh)).toBe(fresh);
    const limited = setExportShortEdge(fresh, 720);
    const recipe = ownSizeRecipe(limited);
    expect(recipe.export.shortEdge).toBe(1080);
    expect({ ...recipe, export: limited.export, revision: limited.revision }).toEqual(limited);
  });

  it('the download is the picture’s own pixels: 720p stays 720p, 360p stays 360p, 4K is Full HD (ADR-041)', () => {
    const sizeOf = (displayWidth: number, displayHeight: number) => {
      const compiled = compileRenderPlan(wholeVideoAsKesit(ownSizeRecipe(opened(video({ displayWidth, displayHeight })))), WEB_LOCAL_POLICY);
      if (!compiled.ok) throw new Error(compiled.reason);
      return [compiled.plan.width, compiled.plan.height];
    };
    expect(sizeOf(1280, 720)).toEqual([1280, 720]);
    expect(sizeOf(640, 360)).toEqual([640, 360]);
    expect(sizeOf(854, 480)).toEqual([854, 480]);
    expect(sizeOf(1920, 1080)).toEqual([1920, 1080]);
    expect(sizeOf(3840, 2160)).toEqual([1920, 1080]);
  });
});

describe('Müzik ekle', () => {
  it('the recipe keeps no kesit: the download is the whole video, as in the editor', () => {
    const recipe = musicUnderVideo(opened());
    expect(recipe.clips).toHaveLength(0);
    expect(downloadRecipe(recipe, { kind: 'all' }, DEFAULT_KESIT_SETTINGS)?.clips[0]).toMatchObject({
      sourceInUs: 0,
      sourceOutUs: 20 * S,
      muted: false,
    });
  });

  it('music longer than the video: as long as the video, quietly behind it, fading out at the end', () => {
    const base = setMusicAsset(opened(), music(60));
    expect(base.clips).toHaveLength(0);
    expect(musicOutlastsVideo(base)).toBe(true);
    expect(musicLengthUs(base)).toBe(20 * S);
    const behind = withMusicDefaults(base, true);
    expect(behind.music).toMatchObject({
      sourceInUs: 0,
      sourceOutUs: 20 * S,
      timelineStartUs: 0,
      gainDb: MUSIC_BEHIND_DB,
      fadeInUs: 0,
      fadeOutUs: MUSIC_FADE_OUT_US,
      muted: false,
    });
    expectExportable(behind);
    // The video's sound off (the wizard's setting, applied to the whole video): the music alone, at full level.
    const alone = withMusicDefaults(base, false);
    expect(alone.music?.gainDb).toBe(MUSIC_ALONE_DB);
    const muted = { ...DEFAULT_KESIT_SETTINGS, muted: true };
    expect(downloadRecipe(alone, { kind: 'all' }, muted)?.clips[0]?.muted).toBe(true);
    expectExportable(alone, muted);
  });

  it('music shorter than the video ends by itself: no fade, and its real length is said', () => {
    const base = withMusicDefaults(setMusicAsset(opened(), music(8)), true);
    expect(musicOutlastsVideo(base)).toBe(false);
    expect(musicLengthUs(base)).toBe(8 * S);
    expect(base.music?.fadeOutUs).toBe(0);
    expectExportable(base);
  });

  it('the fade never takes more than half of a very short piece of music', () => {
    const short = opened(video({ durationUs: 2 * S }));
    const base = withMusicDefaults(setMusicAsset(short, music(30)), true);
    expect(base.music?.fadeOutUs).toBe(1 * S);
    expectExportable(base);
  });

  it('without music the defaults change nothing', () => {
    const base = opened();
    expect(withMusicDefaults(base, true)).toBe(base);
    expect(musicOutlastsVideo(base)).toBe(false);
    expect(musicLengthUs(base)).toBe(0);
  });

  it('opening another video keeps the picked music and lays it under the new one', () => {
    // Music picked for a 20 s video with the video's sound off…
    const first = withMusicDefaults(setMusicAsset(opened(), music(60)), false);
    expect(first.music?.sourceOutUs).toBe(20 * S);
    // …then a 45 s 720p video is opened instead.
    const next = musicUnderVideo(
      setVideoAsset(first, video({ assetId: 'a_video_002', durationUs: 45 * S, displayWidth: 1280, displayHeight: 720 })),
    );
    expect(next.clips).toHaveLength(0);
    expect(next.export.shortEdge).toBe(1080);
    // A newly opened video's own sound is on, so the music is behind it again.
    expect(next.music).toMatchObject({ sourceInUs: 0, sourceOutUs: 45 * S, gainDb: MUSIC_BEHIND_DB, fadeOutUs: MUSIC_FADE_OUT_US });
    expectExportable(next);
  });

  it('a shorter video after a longer one: the music is cut back to it', () => {
    const first = withMusicDefaults(setMusicAsset(opened(video({ durationUs: 45 * S })), music(60)), true);
    expect(first.music?.sourceOutUs).toBe(45 * S);
    const next = musicUnderVideo(setVideoAsset(first, video({ assetId: 'a_video_002', durationUs: 6 * S })));
    expect(next.music).toMatchObject({ sourceInUs: 0, sourceOutUs: 6 * S, fadeOutUs: MUSIC_FADE_OUT_US });
    expectExportable(next);
  });

  it('a video with no sound of its own gets the music alone', () => {
    const silent = setMusicAsset(opened(video({ hasAudio: false })), music(60));
    const next = musicUnderVideo(silent);
    expect(next.music?.gainDb).toBe(MUSIC_ALONE_DB);
    expect(next.music?.sourceOutUs).toBe(20 * S);
    expectExportable(next);
  });

  it('with no music yet, opening the video changes nothing but the size limit (back to Full HD)', () => {
    const small = opened(video({ displayWidth: 1280, displayHeight: 720 }));
    expect(musicUnderVideo(small)).toBe(small);
    const next = musicUnderVideo(setExportShortEdge(small, 720));
    expect(next.music).toBeUndefined();
    expect(next.clips).toHaveLength(0);
    expect(next.export.shortEdge).toBe(1080);
  });
});

describe('Sesi kapat', () => {
  const muted = { ...DEFAULT_KESIT_SETTINGS, muted: true };

  it('the whole video at its own size, with nothing left that makes a sound', () => {
    const small = opened(video({ displayWidth: 1280, displayHeight: 720 }));
    const recipe = soundlessRecipe(small);
    expect(recipe.clips).toHaveLength(0);
    expect(recipe.music).toBeUndefined();
    expect(recipe.export.shortEdge).toBe(1080);
    // Music picked somewhere else does not come along.
    const withMusic = soundlessRecipe(setMusicAsset(small, music(30)));
    expect(withMusic.music).toBeUndefined();
    expect(withMusic.assets.map((asset) => asset.kind)).toEqual(['video']);
    expectExportable(withMusic, muted);
  });

  it('with the sound switched off the download asks for no sound at all: the file gets no audio track', () => {
    const download = downloadRecipe(soundlessRecipe(opened()), { kind: 'all' }, muted);
    if (!download) throw new Error('nothing to download');
    expect(download.clips).toHaveLength(1);
    expect(download.clips[0]).toMatchObject({ sourceInUs: 0, sourceOutUs: 20 * S, muted: true });
    const plan = compileRenderPlan(download, WEB_LOCAL_POLICY);
    if (!plan.ok) throw new Error('recipe refused');
    // Neither the video's own sound nor music: the export worker writes a video-only MP4.
    expect(plan.plan.audio.wantsSourceAudio).toBe(false);
    expect(plan.plan.audio.music).toBeNull();
    // With the sound left on, the same recipe would keep it — the wizard waits for the switch.
    const loud = downloadRecipe(soundlessRecipe(opened()), { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
    const loudPlan = loud ? compileRenderPlan(loud, WEB_LOCAL_POLICY) : null;
    expect(loudPlan?.ok && loudPlan.plan.audio.wantsSourceAudio).toBe(true);
  });
});

describe('Her yerde açılsın', () => {
  const avc = { sourceVideoCodec: 'avc', sourceAudioCodec: 'aac', isHdr: false };

  it('says "already fine" only for H.264 + AAC (or no sound), standard colours, in an MP4', () => {
    expect(alreadyPlaysEverywhere(avc, 'tatil.mp4')).toBe(true);
    expect(alreadyPlaysEverywhere(avc, 'TATIL.MP4')).toBe(true);
    expect(alreadyPlaysEverywhere({ ...avc, sourceAudioCodec: null }, 'sessiz.m4v')).toBe(true);
  });

  it('never for HEVC, HDR, another container, other sound, or before the file was looked at', () => {
    expect(alreadyPlaysEverywhere({ ...avc, sourceVideoCodec: 'hevc' }, 'iphone.mp4')).toBe(false);
    expect(alreadyPlaysEverywhere({ ...avc, isHdr: true }, 'hdr.mp4')).toBe(false);
    expect(alreadyPlaysEverywhere(avc, 'iphone.mov')).toBe(false);
    expect(alreadyPlaysEverywhere({ ...avc, sourceVideoCodec: 'vp9' }, 'kayit.webm')).toBe(false);
    expect(alreadyPlaysEverywhere({ ...avc, sourceAudioCodec: 'opus' }, 'tatil.mp4')).toBe(false);
    expect(alreadyPlaysEverywhere({ ...avc, sourceVideoCodec: null }, 'tatil.mp4')).toBe(false);
    expect(alreadyPlaysEverywhere(null, 'tatil.mp4')).toBe(false);
  });

  it('the whole video in its own frame is a recipe the export accepts', () => {
    // No kesit: the download is the whole video (`wholeVideoRecipe`), sized by the source.
    const recipe = wholeVideoAsKesit(ownSizeRecipe(opened(video({ displayWidth: 1280, displayHeight: 720 }))));
    const plan = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect([plan.plan.width, plan.plan.height]).toEqual([1280, 720]);
  });
});

describe('Dikey yap', () => {
  /** The 9:16 frame of a landscape video of this size, filled or fitted. */
  const vertical = (displayWidth: number, displayHeight: number, fit: 'cover' | 'contain') => {
    const recipe = setFraming(wholeVideoAsKesit(opened(video({ displayWidth, displayHeight }))), { aspect: '9:16', fit, zoom: 1 });
    expect(recipe.clips[0]?.view.fit).toBe(fit);
    const plan = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
    if (!plan.ok) throw new Error(plan.reason);
    return [plan.plan.width, plan.plan.height];
  };

  it('“Doldur” keeps the slice it cuts out at its own pixels: no 1080 × 1920 out of a 608-pixel slice (ADR-041)', () => {
    // Until 11 Oct 2026 every one of these was 1080 × 1920: the slice enlarged 1.8, 2.7 and 5.3 times.
    expect(vertical(1920, 1080, 'cover')).toEqual([608, 1080]);
    expect(vertical(1280, 720, 'cover')).toEqual([406, 720]);
    expect(vertical(640, 360, 'cover')).toEqual([202, 360]);
    // A 4K video has more than enough: the ceiling, as before.
    expect(vertical(3840, 2160, 'cover')).toEqual([1080, 1920]);
  });

  it('“Sığdır” adds bars, not picture: the frame is as wide as the picture, up to Full HD', () => {
    // 1920 across does not fit under the ceiling: 1080 × 1920, the picture made smaller in it, as before.
    expect(vertical(1920, 1080, 'contain')).toEqual([1080, 1920]);
    // 1280 and 640 across: the picture stays 1:1 and the frame is that wide.
    expect(vertical(1280, 720, 'contain')).toEqual([1080, 1920]);
    expect(vertical(640, 360, 'contain')).toEqual([640, 1138]);
  });
});

describe('Boşlukları at', () => {
  it('the default is the editor’s own; "short pauses too" only lowers the shortest gap, within its limits', () => {
    expect(silenceParamsFor('long')).toBe(DEFAULT_SILENCE_PARAMS);
    const short = silenceParamsFor('short');
    expect(short).toEqual({ ...DEFAULT_SILENCE_PARAMS, minSilenceUs: SHORT_GAP_US });
    expect(short.minSilenceUs).toBeLessThan(DEFAULT_SILENCE_PARAMS.minSilenceUs);
    expect(short.minSilenceUs).toBeGreaterThanOrEqual(SILENCE_PARAM_LIMITS.minSilenceUs.min);
    // Speech is protected the same way in both: the margin and the threshold do not move.
    expect(short.keepUs).toBe(DEFAULT_SILENCE_PARAMS.keepUs);
    expect(short.sensitivityDb).toBe(DEFAULT_SILENCE_PARAMS.sensitivityDb);
  });

  it('says the lengths before and after from the recipes themselves', () => {
    const before = wholeVideoAsKesit(opened());
    const first = before.clips[0];
    if (!first) throw new Error('no kesit');
    const after: Project = {
      ...before,
      clips: [
        { ...first, sourceOutUs: 5 * S },
        { ...first, clipId: 'c_002', sourceInUs: 8 * S },
      ],
    };
    expect(lengthsAfterCut(before, after)).toEqual({ beforeUs: 20 * S, afterUs: 17 * S });
  });
});
