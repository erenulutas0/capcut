/**
 * "Sesini al" (ADR-035): the sound of a download as a file of its own.
 *
 * WebCodecs has no MP3 encoder, so the file is M4A — AAC in an MP4 container
 * with no video track, MIME `audio/mp4` — written by the same aligned AAC
 * path as the video download (ADR-032). Pure helpers only; the worker does
 * the work.
 */

import type { Project } from './edl';
import { nominalOutputBytes } from './outputStorage';
import type { RenderPlan } from './renderPlan';

export const AUDIO_FILE_EXTENSION = '.m4a';
export const AUDIO_FILE_MIME = 'audio/mp4';

/** The sound-only name for a suggested video name: `tatil_3-kesit.mp4` -> `tatil_3-kesit.m4a`. */
export function audioFileName(videoFileName: string): string {
  const dot = videoFileName.lastIndexOf('.');
  const base = dot > 0 ? videoFileName.slice(0, dot) : videoFileName;
  return `${base}${AUDIO_FILE_EXTENSION}`;
}

/**
 * The recipe a sound-only download is compiled from: the same kesitler, on
 * the audio sample grid instead of the 30 fps frame grid.
 *
 * The video download's length is a whole number of frames (a 6.75 s kesit is
 * 203 frames, 6.7667 s), which is right for a picture and wrong for a sound
 * file. With the sample rate as the "frame rate" the plan's grid is one
 * sample: a kesit of 6.75 s gives 324 000 samples, exactly.
 */
export function audioOnlyRecipe(recipe: Project): Project {
  return { ...recipe, export: { ...recipe.export, fpsNum: recipe.export.audioSampleRate, fpsDen: 1 } };
}

/** The size a sound-only file aims at: the AAC bitrate over the output's length (the container adds ~1%). */
export function audioOnlyBytes(plan: Pick<RenderPlan, 'audioBitrate' | 'expectedDurationUs'>): number {
  return Math.ceil(
    nominalOutputBytes({ videoBitrate: 0, audioBitrate: plan.audioBitrate, durationUs: plan.expectedDurationUs }),
  );
}
