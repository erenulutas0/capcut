/**
 * What each task wizard does to the recipe (ADR-034). Pure: the wizards are
 * thin screens over the same recipe and the same export the editor uses, so
 * "Daha fazla ayar → editörde aç" continues from exactly what the wizard
 * would have downloaded.
 */

import type { EnhanceStrengthV4, MusicV1, Project } from '@/domain/edl';
import { fileBaseName } from '@/domain/kesit';
import { DEFAULT_SILENCE_PARAMS, SILENCE_PARAM_LIMITS, type SilenceParams } from '@/domain/silence';
import type { Micros } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import { primaryVideoAsset, setEnhance, setExportShortEdge, withWholeKesit } from './commands';

// ------------------------------------------------------------ file names

/**
 * "tatil_dikey.mp4": the video's own name and what was done to it. Like
 * `suggestedFileName`, never the original name itself, so saving next to the
 * original does not offer to overwrite it.
 */
export function taggedFileName(videoFileName: string, tag: string): string {
  return `${fileBaseName(videoFileName)}_${tag}.mp4`;
}

// ------------------------------------------------------------ Müzik ekle

/** Music behind the video's own sound ("fon"): the editor's default level. */
export const MUSIC_BEHIND_DB = -12;
/** Music alone (the video's sound is off): full level. */
export const MUSIC_ALONE_DB = 0;
/** The music fades out over this long where the video ends before the music does. */
export const MUSIC_FADE_OUT_US: Micros = 1_500_000;

/**
 * The whole video as one kesit, so the music has a length to be laid under
 * (`setMusicAsset` selects as much music as the output is long). A video too
 * short to be a kesit is left as it is.
 */
export function wholeVideoAsKesit(project: Project): Project {
  if (project.clips.length > 0) return project;
  const result = withWholeKesit(project);
  return result.ok ? result.project : project;
}

/** Whether the selected music is cut where the video ends (it is longer than the video). */
export function musicOutlastsVideo(project: Project): boolean {
  const music = project.music;
  if (!music) return false;
  const asset = project.assets.find((item) => item.assetId === music.assetId);
  return asset !== undefined && asset.durationUs > music.sourceOutUs - music.sourceInUs;
}

/** How long the music plays in the download. */
export function musicLengthUs(project: Project): Micros {
  const music = project.music;
  return music ? music.sourceOutUs - music.sourceInUs : 0;
}

/**
 * The wizard's sensible defaults for a music track just added: its level by
 * whether the video's own sound stays, and a short fade-out when the music is
 * cut at the end of the video (music that ends by itself needs none).
 */
export function withMusicDefaults(project: Project, videoSoundKept: boolean): Project {
  const music = project.music;
  if (!music) return project;
  const selectionUs = music.sourceOutUs - music.sourceInUs;
  const next: MusicV1 = {
    ...music,
    gainDb: videoSoundKept ? MUSIC_BEHIND_DB : MUSIC_ALONE_DB,
    fadeInUs: 0,
    fadeOutUs: musicOutlastsVideo(project) ? Math.min(MUSIC_FADE_OUT_US, Math.floor(selectionUs / 2)) : 0,
  };
  return { ...project, music: next };
}

/**
 * Opening a video in "Müzik ekle": the whole video becomes the one kesit,
 * and music picked for an earlier video is laid under the new one from its
 * start — as long as the new video, or as long as the music is — at the
 * video's own size, with the defaults again (the new kesit's own sound is on; a video without sound
 * gets the music alone).
 */
export function musicUnderWholeVideo(project: Project): Project {
  const whole = wholeVideoAsKesit(ownSizeRecipe(project));
  const music = whole.music;
  if (!music) return whole;
  const asset = whole.assets.find((item) => item.assetId === music.assetId);
  const outputUs = totalOutputDurationUs(whole);
  if (!asset || outputUs <= 0) return whole;
  const refit: MusicV1 = {
    ...music,
    sourceInUs: 0,
    sourceOutUs: Math.min(asset.durationUs, outputUs),
    timelineStartUs: 0,
  };
  const videoSoundKept = primaryVideoAsset(whole)?.hasAudio !== false && whole.clips[0]?.muted !== true;
  return withMusicDefaults({ ...whole, music: refit }, videoSoundKept);
}

// ------------------------------------------------------------ the video's own size

/**
 * The download's size for the wizards that keep the video's own frame
 * ("Boşlukları at", "Müzik ekle", "Her yerde açılsın"): 720p stays 720p (and
 * anything smaller becomes 720p), anything larger is Full HD — the two sizes
 * the editor offers. A 720p video is then not blown up to 1080p for nothing,
 * and where nothing else changes its pictures can be kept as they are
 * (the fast cut, ADR-027).
 */
export function shortEdgeForSource(displayWidth: number | undefined, displayHeight: number | undefined): 720 | 1080 {
  const shortEdge = Math.min(displayWidth ?? 0, displayHeight ?? 0);
  return shortEdge > 0 && shortEdge <= 720 ? 720 : 1080;
}

export function ownSizeRecipe(project: Project): Project {
  const asset = primaryVideoAsset(project);
  return setExportShortEdge(project, shortEdgeForSource(asset?.displayWidth, asset?.displayHeight));
}

// ------------------------------------------------------------ İyileştir

/** The strength "İyileştir" starts with: the measured one (ADR-037). */
export const DEFAULT_ENHANCE_STRENGTH: EnhanceStrengthV4 = 'auto';

/**
 * Opening a video in "İyileştir": the video at its own size, with the
 * enhancement switched on. The same field the editor's setting writes, so
 * "Daha fazla ayar → editörde aç" continues with it on.
 */
export function enhanceRecipe(project: Project, strength: EnhanceStrengthV4 = DEFAULT_ENHANCE_STRENGTH): Project {
  return setEnhance(ownSizeRecipe(project), strength);
}

/** Where in the video the before/after frame is taken, as shares of its length; "Başka bir kare" steps through them. */
export const ENHANCE_PREVIEW_SHARES: readonly number[] = [0.3, 0.6, 0.85, 0.1];

/** The output frame the before/after preview shows for the `shot`-th press of "Başka bir kare". */
export function enhancePreviewFrame(totalFrames: number, shot: number): number {
  const share = ENHANCE_PREVIEW_SHARES[((shot % ENHANCE_PREVIEW_SHARES.length) + ENHANCE_PREVIEW_SHARES.length) % ENHANCE_PREVIEW_SHARES.length] ?? 0.3;
  return Math.min(Math.max(0, totalFrames - 1), Math.max(0, Math.round((totalFrames - 1) * share)));
}

// ------------------------------------------------------------ Her yerde açılsın

/**
 * Whether the picked file is already what the task produces: H.264 picture,
 * AAC sound (or none), standard colours, in an MP4. Said before the download,
 * so nobody waits for a conversion that changes nothing.
 */
export function alreadyPlaysEverywhere(
  source: { sourceVideoCodec: string | null; sourceAudioCodec: string | null; isHdr: boolean } | null,
  fileName: string,
): boolean {
  if (!source) return false;
  const mp4 = /\.(mp4|m4v)$/i.test(fileName);
  const audioOk = source.sourceAudioCodec === null || source.sourceAudioCodec === 'aac';
  return mp4 && source.sourceVideoCodec === 'avc' && audioOk && !source.isHdr;
}

// ------------------------------------------------------------ Boşlukları at

/** The wizard's one choice: only the long gaps (the default), or short pauses too. */
export type GapChoice = 'long' | 'short';

/** Pauses from this length on count as a gap in the "short pauses too" choice. */
export const SHORT_GAP_US: Micros = 400_000;

export function silenceParamsFor(choice: GapChoice): SilenceParams {
  if (choice === 'long') return DEFAULT_SILENCE_PARAMS;
  return {
    ...DEFAULT_SILENCE_PARAMS,
    minSilenceUs: Math.max(SILENCE_PARAM_LIMITS.minSilenceUs.min, SHORT_GAP_US),
  };
}

/** Before → after, for "Videon kısalacak". */
export function lengthsAfterCut(before: Project, after: Project): { beforeUs: Micros; afterUs: Micros } {
  return { beforeUs: totalOutputDurationUs(before), afterUs: totalOutputDurationUs(after) };
}
