/**
 * How much of the music is selected by itself.
 *
 * The recipe stores the music's range explicitly (`sourceInUs`…`sourceOutUs`,
 * doc 10) — there is no "follow the video" flag in the schema, and none is
 * added. The rule lives here instead:
 *
 * - **Fitted** music ends where the download ends, or where the music file
 *   ends if that comes first. "The download" is what the top button saves:
 *   the joined kesitler, or the WHOLE video while there is no kesit
 *   (`wholeVideoRecipe`). Music is fitted when it is added.
 * - While the music is fitted it **stays** fitted: a command that changes the
 *   kesitler (or the video) moves the music's end with the download, in the
 *   same undo step (`commands.ts`, `bump`).
 * - A range the user set by hand is not fitted any more (its end is somewhere
 *   else), and nothing touches it — until they set it back to the end of the
 *   download, which is the same as asking for "the whole thing" again.
 *
 * Before this rule the selection was `max(0.1 s, joined kesitler)` at the
 * moment the music was added and never changed: with no kesit that is 0.1 s,
 * and "Videoyu indir" saved the whole video with a tenth of a second of music
 * (measured in the saved file: tests/e2e/music-length.spec.ts). Projects
 * stored in that state are recognised (`isLegacyMusicStub`) and treated as
 * fitted, so they are repaired when they are opened.
 *
 * Doc 15: the music file itself is at most 10 minutes and 100 MiB (checked
 * when it is opened). The selection never leaves the file, so under a longer
 * video the music ends at its own end; it is never looped.
 */

import type { AssetV1, MusicV1, Project } from './edl';
import { MIN_CLIP_DURATION_US, type Micros } from './time';
import { totalOutputDurationUs } from './timeline';

type Recipe = Pick<Project, 'assets' | 'clips' | 'music'>;

function musicAsset(project: Recipe): AssetV1 | undefined {
  const music = project.music;
  return music ? project.assets.find((asset) => asset.assetId === music.assetId && asset.kind === 'audio') : undefined;
}

/**
 * The length of what the top button downloads: the joined kesitler, or the
 * whole video while there is none (0 with no video, or one too short to be
 * downloaded at all).
 */
export function downloadDurationUs(project: Pick<Project, 'assets' | 'clips'>): Micros {
  if (project.clips.length > 0) return totalOutputDurationUs(project);
  const video = project.assets.find((asset) => asset.kind === 'video');
  return video && video.durationUs >= MIN_CLIP_DURATION_US ? video.durationUs : 0;
}

/**
 * Where fitted music ends in its file: at the end of the download (counted
 * from where the music starts on it), at most at the end of the file, and
 * never less than the shortest range the recipe allows.
 */
export function fittedMusicEndUs(
  music: Pick<MusicV1, 'sourceInUs' | 'timelineStartUs'>,
  musicDurationUs: Micros,
  downloadUs: Micros,
): Micros {
  const wanted = music.sourceInUs + Math.max(MIN_CLIP_DURATION_US, downloadUs - music.timelineStartUs);
  return Math.min(musicDurationUs, wanted);
}

/**
 * What the old rule left behind when music was added with no kesit: 0.1 s
 * from the start of the file. Nobody chooses a tenth of a second of music;
 * it is read as "not chosen yet".
 */
export function isLegacyMusicStub(project: Recipe): boolean {
  const music = project.music;
  const asset = musicAsset(project);
  if (!music || !asset || project.clips.length > 0) return false;
  return (
    music.sourceInUs === 0 &&
    music.timelineStartUs === 0 &&
    music.sourceOutUs === Math.min(asset.durationUs, MIN_CLIP_DURATION_US)
  );
}

/** Whether the music's end is where the fit puts it (so it should keep following the download). */
export function isMusicFitted(project: Recipe): boolean {
  const music = project.music;
  const asset = musicAsset(project);
  if (!music || !asset) return false;
  if (isLegacyMusicStub(project)) return true;
  return music.sourceOutUs === fittedMusicEndUs(music, asset.durationUs, downloadDurationUs(project));
}

/**
 * The music with its end at the end of the download. Fades that no longer
 * fit the selection are shortened (the recipe forbids fades longer than the
 * selection): the fade-out first to at most half, then the fade-in to the rest.
 */
export function fitMusic(project: Recipe): MusicV1 | undefined {
  const music = project.music;
  const asset = musicAsset(project);
  if (!music || !asset) return music;
  const sourceOutUs = fittedMusicEndUs(music, asset.durationUs, downloadDurationUs(project));
  if (sourceOutUs === music.sourceOutUs) return music;
  const selectionUs = sourceOutUs - music.sourceInUs;
  if (selectionUs <= 0) return music;
  let { fadeInUs, fadeOutUs } = music;
  if (fadeInUs + fadeOutUs > selectionUs) {
    fadeOutUs = Math.min(fadeOutUs, Math.floor(selectionUs / 2));
    fadeInUs = Math.min(fadeInUs, selectionUs - fadeOutUs);
  }
  return { ...music, sourceOutUs, fadeInUs, fadeOutUs };
}

/**
 * The music of `after`, a recipe a command just made out of `before`:
 * music that was fitted to `before`'s download is fitted to `after`'s; any
 * other music is returned as it is.
 */
export function musicFollowing(before: Recipe, after: Recipe): MusicV1 | undefined {
  if (!after.music || !isMusicFitted({ ...before, music: after.music })) return after.music;
  return fitMusic(after);
}

/**
 * Opening a stored project or a backup: a recipe saved with the old 0.1 s
 * stub gets the music the user asked for — under the whole download. Every
 * other recipe comes back untouched (the same object).
 */
export function healLegacyMusic<T extends Project>(project: T): T {
  if (!isLegacyMusicStub(project)) return project;
  const music = fitMusic(project);
  if (!music || music === project.music) return project;
  return { ...project, music, revision: project.revision + 1 };
}
