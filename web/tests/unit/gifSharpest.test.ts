import { describe, expect, it } from 'vitest';

import { createEmptyProject, setEnhance, setFraming, setMusicAsset, setSoundFix, setVideoAsset } from '@/application/commands';
import { gifVideoRecipe, taggedFileName } from '@/application/taskRecipes';
import type { AssetV1, Project } from '@/domain/edl';
import {
  GIF_PREDICT_FACTOR,
  predictGifBytes,
  GIF_AUTO_PICK_LIMIT_MS,
  GIF_AUTO_PICK_MAX_BYTES,
  GIF_HELD_FRAMES_MAX_BYTES,
  GIF_LARGE_FILE_BYTES,
  gifFramesBudget,
  gifFrameTimesUs,
  gifHoldsFrames,
  gifPickIsPredicted,
  gifSizeChoices,
  gifVideoExpectedSize,
  planGifSize,
  sharpestShareableGifSize,
  verifyPredictedGifSize,
} from '@/domain/gif';
import { DEFAULT_KESIT_SETTINGS, downloadRecipe } from '@/domain/kesit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { aspectForVideo } from '@/domain/timelineEdit';
import { validateProject } from '@/domain/validation';

/**
 * ADR-052: the GIF's first size is the sharpest one under 10 MB, found by measuring from the largest
 * size down; and "Video olarak (en net)" is the part, muted, through the ordinary MP4 download.
 */

const S = US_PER_SECOND;
const MB = 1_000_000;

describe('GIF yap: the sharpest size that stays shareable', () => {
  const four = gifSizeChoices(1920, 1080); // small, medium, large, xlarge

  it('measures from the largest size down, one at a time, and never guesses', () => {
    expect(four).toEqual(['small', 'medium', 'large', 'xlarge']);
    expect(sharpestShareableGifSize(four, {})).toEqual({ kind: 'measure', size: 'xlarge' });
    expect(sharpestShareableGifSize(four, { xlarge: 11.5 * MB })).toEqual({ kind: 'measure', size: 'large' });
    expect(sharpestShareableGifSize(four, { xlarge: 28 * MB, large: 13.7 * MB })).toEqual({ kind: 'measure', size: 'medium' });
    // A smaller size measured before (the user looked at it) does not stand in for a larger one not yet measured.
    expect(sharpestShareableGifSize(four, { small: 1 * MB, medium: 3 * MB })).toEqual({ kind: 'measure', size: 'xlarge' });
  });

  it('the largest estimated at 9 MB or less is the one (the file then stays under 10 MB, ±10 %); exactly 9 MB fits, one byte more does not', () => {
    expect(GIF_AUTO_PICK_MAX_BYTES).toBe(9_000_000);
    expect(GIF_LARGE_FILE_BYTES).toBe(10_000_000);
    expect(sharpestShareableGifSize(four, { xlarge: 8.9 * MB })).toEqual({ kind: 'chosen', size: 'xlarge', why: 'fits' });
    expect(sharpestShareableGifSize(four, { xlarge: GIF_AUTO_PICK_MAX_BYTES })).toEqual({ kind: 'chosen', size: 'xlarge', why: 'fits' });
    expect(sharpestShareableGifSize(four, { xlarge: GIF_AUTO_PICK_MAX_BYTES + 1, large: 5 * MB })).toEqual({ kind: 'chosen', size: 'large', why: 'fits' });
    // 9,5 MB: under the warning's 10 MB, but too near it to promise "under 10 MB": not chosen for the user.
    expect(sharpestShareableGifSize(four, { xlarge: 9.5 * MB })).toEqual({ kind: 'measure', size: 'large' });
    expect(sharpestShareableGifSize(four, { xlarge: 28 * MB, large: 13.7 * MB, medium: 7.8 * MB })).toEqual({ kind: 'chosen', size: 'medium', why: 'fits' });
  });

  it('none fits: the smallest (the 10 MB warning then says so); a measurement that failed: the smallest too', () => {
    expect(sharpestShareableGifSize(four, { xlarge: 40 * MB, large: 30 * MB, medium: 20 * MB, small: 11 * MB })).toEqual({ kind: 'chosen', size: 'small', why: 'none_fit' });
    expect(sharpestShareableGifSize(four, { xlarge: 'failed' })).toEqual({ kind: 'chosen', size: 'small', why: 'unknown' });
    expect(sharpestShareableGifSize(four, { xlarge: 20 * MB, large: 'failed' })).toEqual({ kind: 'chosen', size: 'small', why: 'unknown' });
  });

  it('out of time: the largest size measured to fit, else the smallest — nothing still unmeasured', () => {
    expect(sharpestShareableGifSize(four, {}, { timedOut: true })).toEqual({ kind: 'chosen', size: 'small', why: 'timeout_smallest' });
    expect(sharpestShareableGifSize(four, { xlarge: 20 * MB }, { timedOut: true })).toEqual({ kind: 'chosen', size: 'small', why: 'timeout_smallest' });
    // Sizes measured earlier (the user looked at them) count.
    expect(sharpestShareableGifSize(four, { xlarge: 20 * MB, medium: 4 * MB, small: 1 * MB }, { timedOut: true })).toEqual({ kind: 'chosen', size: 'medium', why: 'timeout_fits' });
    expect(sharpestShareableGifSize(four, { large: 'failed', small: 1 * MB }, { timedOut: true })).toEqual({ kind: 'chosen', size: 'small', why: 'timeout_fits' });
    expect(GIF_AUTO_PICK_LIMIT_MS).toBe(8_000);
  });

  it('out of time: a size not measured is predicted from a larger one measured over the limit (pixels × 1,15), and chosen if that fits', () => {
    const pixels = { small: 320 * 180, medium: 480 * 270, large: 640 * 360, xlarge: 960 * 540 };
    // 1,3 until 24 Oct 2026 (ADR-052 addendum 4): on the S23 it lost "Büyük" (predicted 10,4 MB, measured 8,55 on the desktop).
    expect(GIF_PREDICT_FACTOR).toBe(1.15);
    // The S23's case: only Çok büyük measured (17,96 MB): Büyük 17,96 × 0,444 × 1,15 = 9,18 MB (just over), Orta 5,16 MB.
    expect(predictGifBytes('large', ['xlarge'], { xlarge: 17_963_081 }, pixels)).toBeCloseTo(9_179_000, -4);
    // 20 MB: Büyük 20 × 0,444 × 1,15 = 10,2 MB, Orta 20 × 0,25 × 1,15 = 5,75 MB → Orta.
    expect(predictGifBytes('medium', ['large', 'xlarge'], { xlarge: 20 * MB }, pixels)).toBeCloseTo(5.75 * MB, -3);
    expect(sharpestShareableGifSize(four, { xlarge: 20 * MB }, { timedOut: true, pixels })).toEqual({ kind: 'chosen', size: 'medium', why: 'timeout_predicted' });
    // 17 MB: Büyük 17 × 0,444 × 1,15 = 8,69 MB → Büyük (with 1,3: 9,82 → Orta).
    expect(sharpestShareableGifSize(four, { xlarge: 17 * MB }, { timedOut: true, pixels })).toEqual({ kind: 'chosen', size: 'large', why: 'timeout_predicted' });
    expect(sharpestShareableGifSize(four, { xlarge: 17 * MB }, { timedOut: true, pixels, predictFactor: 1.3 })).toEqual({ kind: 'chosen', size: 'medium', why: 'timeout_predicted' });
    // The nearest larger size measured is the one predicted from (Büyük 12 MB → Orta 12 × 0,5625 × 1,15 = 7,76 MB).
    expect(predictGifBytes('medium', ['large', 'xlarge'], { xlarge: 40 * MB, large: 12 * MB }, pixels)).toBeCloseTo(7.7625 * MB, -3);
    expect(sharpestShareableGifSize(four, { xlarge: 40 * MB, large: 12 * MB }, { timedOut: true, pixels })).toEqual({ kind: 'chosen', size: 'medium', why: 'timeout_predicted' });
    // A measured fit larger than any prediction wins; nothing measured larger: nothing predicted.
    expect(sharpestShareableGifSize(four, { xlarge: 40 * MB, large: 8 * MB }, { timedOut: true, pixels })).toEqual({ kind: 'chosen', size: 'large', why: 'timeout_fits' });
    expect(predictGifBytes('xlarge', [], {}, pixels)).toBeNull();
    // Without pixel counts nothing is predicted.
    expect(sharpestShareableGifSize(four, { xlarge: 28 * MB }, { timedOut: true })).toEqual({ kind: 'chosen', size: 'small', why: 'timeout_smallest' });
  });

  it('a size chosen from a prediction is checked by its own estimate: over 9 MB → one size down, said so; a larger size that fits later changes nothing', () => {
    const predicted = { kind: 'chosen', size: 'large', why: 'timeout_predicted' } as const;
    expect(gifPickIsPredicted(predicted)).toBe(true);
    expect(gifPickIsPredicted({ kind: 'chosen', size: 'large', why: 'fits' })).toBe(false);
    expect(gifPickIsPredicted({ kind: 'measure', size: 'large' })).toBe(false);
    // Not known yet, or known to fit: the same object (nothing to change).
    expect(verifyPredictedGifSize(four, predicted, { xlarge: 18 * MB })).toBe(predicted);
    expect(verifyPredictedGifSize(four, predicted, { xlarge: 18 * MB, large: 8.55 * MB })).toBe(predicted);
    expect(verifyPredictedGifSize(four, predicted, { xlarge: 18 * MB, large: GIF_AUTO_PICK_MAX_BYTES })).toBe(predicted);
    // Measured over 9 MB: the next smaller size, which is then checked the same way.
    const down = verifyPredictedGifSize(four, predicted, { xlarge: 18 * MB, large: 9.4 * MB });
    expect(down).toEqual({ kind: 'chosen', size: 'medium', why: 'timeout_stepped_down' });
    expect(gifPickIsPredicted(down)).toBe(true);
    expect(verifyPredictedGifSize(four, down, { large: 9.4 * MB, medium: 5.3 * MB })).toBe(down);
    expect(verifyPredictedGifSize(four, down, { large: 9.4 * MB, medium: 9.2 * MB, small: 4 * MB })).toEqual({ kind: 'chosen', size: 'small', why: 'timeout_stepped_down' });
    // Never below the smallest: it stays whatever it weighs (the 10 MB warning says so).
    const smallest = { kind: 'chosen', size: 'small', why: 'timeout_predicted' } as const;
    expect(verifyPredictedGifSize(four, smallest, { small: 12 * MB })).toBe(smallest);
    // A failed measurement keeps the choice (the screen says the estimate failed).
    expect(verifyPredictedGifSize(four, predicted, { large: 'failed' })).toBe(predicted);
    // No surprise switching: a larger size measured to fit afterwards does not move a predicted choice up.
    const medium = { kind: 'chosen', size: 'medium', why: 'timeout_predicted' } as const;
    expect(verifyPredictedGifSize(four, medium, { xlarge: 18 * MB, large: 8.5 * MB, medium: 5 * MB })).toBe(medium);
    // A measured choice is never touched.
    const fits = { kind: 'chosen', size: 'large', why: 'timeout_fits' } as const;
    expect(verifyPredictedGifSize(four, fits, { large: 9.5 * MB })).toBe(fits);
  });

  it('only the sizes this video has (never larger than the video, ADR-041)', () => {
    const three = gifSizeChoices(640, 360); // its "Büyük" is its own size
    expect(three).toEqual(['small', 'medium', 'large']);
    expect(sharpestShareableGifSize(three, {})).toEqual({ kind: 'measure', size: 'large' });
    expect(sharpestShareableGifSize(['small'], { small: 0.4 * MB })).toEqual({ kind: 'chosen', size: 'small', why: 'fits' });
  });

  it('"Çok büyük" chosen for a phone that says less than 8 GB, or nothing, is still made in two passes, holding no frame', () => {
    const size = planGifSize(1920, 1080, 'xlarge'); // 960 × 540
    const fourSeconds = gifFrameTimesUs({ startUs: 0, endUs: 4 * S }).length; // 50 frames, 104 MB of frames
    for (const said of [undefined, 2, 4]) {
      expect(gifFramesBudget(said)).toBe(GIF_HELD_FRAMES_MAX_BYTES);
      expect(gifHoldsFrames(size, fourSeconds, gifFramesBudget(said))).toBe(false);
    }
    // Even its shortest part (half a second, 6 frames, 12 MB) stays within 32 MiB.
    expect(gifHoldsFrames(size, 6, gifFramesBudget(4))).toBe(true);
    // "Büyük" 4 s on such a phone: two passes as well (46 MB of frames).
    expect(gifHoldsFrames(planGifSize(1920, 1080, 'large'), fourSeconds, gifFramesBudget(4))).toBe(false);
  });
});

function video(patch: Partial<AssetV1> = {}): AssetV1 {
  return { assetId: 'a_video_001', kind: 'video', durationUs: 20 * S, displayWidth: 1920, displayHeight: 1080, hasAudio: true, ...patch };
}

/** As the editor state opens a video: its frame takes the video's shape (`importVideo`). */
function opened(asset = video()): Project {
  const project = setVideoAsset(createEmptyProject(), asset);
  const aspect = aspectForVideo(asset.displayWidth, asset.displayHeight);
  return aspect ? setFraming(project, { aspect }) : project;
}

describe('GIF yap → "Video olarak (en net)": the recipe', () => {
  it('the chosen part only, no sound, at the video’s own size up to Full HD — a recipe the export accepts', () => {
    const recipe = gifVideoRecipe(opened(), { startUs: 6 * S, endUs: 10 * S }, DEFAULT_KESIT_SETTINGS);
    expect(recipe).not.toBeNull();
    if (!recipe) return;
    expect(validateProject(recipe).ok).toBe(true);
    expect(recipe.clips).toHaveLength(1);
    expect(recipe.clips[0]).toMatchObject({ sourceInUs: 6 * S, sourceOutUs: 10 * S, muted: true });
    const download = downloadRecipe(recipe, { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
    expect(download).toBe(recipe);
    const plan = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan).toMatchObject({ width: 1920, height: 1080, expectedDurationUs: 4 * S, captions: null, enhance: null, soundFix: null });
    // No sound wanted and no music: the export writes no audio track.
    expect(plan.plan.audio.wantsSourceAudio).toBe(false);
    expect(plan.plan.audio.music).toBeNull();
  });

  it('never enlarged (ADR-041): a 640 × 360 video stays 640 × 360; a 4K one is Full HD; vertical stays vertical', () => {
    const sizes = [
      [video({ displayWidth: 640, displayHeight: 360 }), 640, 360],
      [video({ displayWidth: 3840, displayHeight: 2160 }), 1920, 1080],
      [video({ displayWidth: 1080, displayHeight: 1920 }), 1080, 1920],
    ] as const;
    for (const [asset, width, height] of sizes) {
      const recipe = gifVideoRecipe(opened(asset), { startUs: 0, endUs: 2 * S }, DEFAULT_KESIT_SETTINGS);
      const plan = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
      expect(plan?.ok && { width: plan.plan.width, height: plan.plan.height }).toEqual({ width, height });
    }
  });

  it('nothing of an earlier session comes in: music, enhancement, sound fix, subtitles', () => {
    let project = setMusicAsset(opened(), { assetId: 'a_music_001', kind: 'audio', durationUs: 30 * S });
    project = setSoundFix(setEnhance(project, 'strong'), true);
    project = {
      ...project,
      captionTracks: [
        { trackId: 't_1', language: 'tr', timeBase: 'source', assetId: 'a_video_001', origin: 'manual', style: { preset: 'box', position: 'bottom', size: 'medium' }, cues: [{ cueId: 'q_1', startUs: 0, endUs: S, text: 'merhaba' }] },
      ] as Project['captionTracks'],
    };
    const recipe = gifVideoRecipe(project, { startUs: 0, endUs: 3 * S }, { ...DEFAULT_KESIT_SETTINGS, muted: false });
    expect(recipe).not.toBeNull();
    if (!recipe) return;
    expect(recipe.music).toBeUndefined();
    expect(recipe.enhance).toBeUndefined();
    expect(recipe.soundFix).toBeUndefined();
    expect(recipe.captionTracks).toEqual([]);
    expect(recipe.clips[0]?.muted).toBe(true);
    const plan = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
    expect(plan.ok && plan.plan.audio.wantsSourceAudio).toBe(false);
  });

  it('what the video will weigh, said next to the GIF (ADR-052 addendum 4): the plan’s bitrate held to the source’s, over the part', () => {
    const recipe = gifVideoRecipe(opened(), { startUs: 0, endUs: 10 * S }, DEFAULT_KESIT_SETTINGS);
    const plan = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
    if (!plan?.ok) throw new Error('no plan');
    // 1080p30 at 0,09 bit a pixel ≈ 5,6 Mbit/s: 10 s ≈ 7,0 MB — what the S23 measured (7 042 795 / 7 006 161 B).
    const ten = gifVideoExpectedSize(plan.plan.videoBitrate, 15_000_000, 10 * S, true);
    expect(ten.bytes).toBe(Math.round((plan.plan.videoBitrate * 10) / 8));
    expect(ten.bytes / 7_042_795).toBeGreaterThan(0.98);
    expect(ten.bytes / 7_042_795).toBeLessThan(1.01);
    expect(ten.upTo).toBe(false);
    // A source of 2 Mbit/s: held to twice that (4 Mbit/s); with text it is encoded — "yaklaşık".
    const low = gifVideoExpectedSize(plan.plan.videoBitrate, 2_000_000, 4 * S, true);
    expect(low).toEqual({ bytes: 2_000_000, upTo: false });
    // Without text the source's own pictures may be kept (smaller than encoding them): "en çok".
    expect(gifVideoExpectedSize(plan.plan.videoBitrate, 2_000_000, 4 * S, false)).toEqual({ bytes: 2_000_000, upTo: true });
    // A source above the plan: encoded at the plan's bitrate either way; the source's size unknown: the plan's.
    expect(gifVideoExpectedSize(plan.plan.videoBitrate, 15_000_000, 4 * S, false).upTo).toBe(false);
    expect(gifVideoExpectedSize(plan.plan.videoBitrate, null, 4 * S, false)).toEqual({ bytes: Math.round((plan.plan.videoBitrate * 4) / 8), upTo: false });
  });

  it('the file is an .mp4 named after the video, never the original name', () => {
    expect(taggedFileName('tatil.mov', 'gif')).toBe('tatil_gif.mp4');
  });
});
