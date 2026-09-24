/**
 * The kesit list (ADR-026).
 *
 * A kesit is a range of the source video the user marked and wants to keep.
 * The recipe already describes that: `clips` is an ordered list of half-open
 * source ranges (EDL v2, doc 10), so a kesit IS a clip and the list order is
 * the order of the joined download. Nothing here changes the schema.
 *
 * What is new is that one recipe now yields several downloads:
 *
 * - one kesit on its own (the card's download button);
 * - all kesitler joined in list order ("Hepsini birleştirip indir"), which is
 *   the recipe itself;
 * - the whole video, when there is no kesit yet ("Videoyu indir").
 *
 * The functions below derive the recipe for each download. They are pure and
 * never touch the stored recipe; the render plan compiler turns what they
 * return into frames exactly as before, so every frame-accuracy guarantee of
 * `compileRenderPlan` holds for each download.
 */

import { primaryCaptionTrack } from './captions';
import type { CaptionTrackV2, ClipV1, FitMode, Project } from './edl';
import { MIN_CLIP_DURATION_US, US_PER_SECOND, type Micros } from './time';
import { buildTimeline } from './timeline';
import { computeSourceView } from './transform';

/** Which button asked for a download. */
export type DownloadTarget = { kind: 'kesit'; clipId: string } | { kind: 'all' };

/** What the top-right button does for the current list. */
export type TopDownload =
  /** No kesit yet: the whole video. */
  | { kind: 'whole' }
  /** Exactly one kesit: the same as that card's download button. */
  | { kind: 'single'; clipId: string }
  /** Two or more: all of them joined, in list order. */
  | { kind: 'merged'; count: number };

export function topDownload(project: Pick<Project, 'clips'>): TopDownload {
  const [first] = project.clips;
  if (!first) return { kind: 'whole' };
  if (project.clips.length === 1) return { kind: 'single', clipId: first.clipId };
  return { kind: 'merged', count: project.clips.length };
}

/**
 * Settings a new kesit starts with (framing and video sound). They are the
 * same for every kesit (Ayarlar applies to every download), so they are read
 * from the first kesit; with no kesit yet the editor holds them.
 */
export interface KesitSettings {
  fit: FitMode;
  /** 1 = the frame filled exactly, as `computeSourceView` defines it. */
  zoom: number;
  sourceGainDb: number;
  muted: boolean;
}

export const DEFAULT_KESIT_SETTINGS: KesitSettings = { fit: 'cover', zoom: 1, sourceGainDb: 0, muted: false };

/**
 * A clip over `[sourceInUs, sourceOutUs)` of the project's video with the
 * given settings. The view is computed for the project's frame, exactly as
 * `setFraming` would.
 */
export function clipWithSettings(
  project: Project,
  clipId: string,
  range: { sourceInUs: Micros; sourceOutUs: Micros },
  settings: KesitSettings,
): ClipV1 | null {
  const asset = project.assets.find((item) => item.kind === 'video');
  if (!asset) return null;
  return {
    clipId,
    assetId: asset.assetId,
    sourceInUs: range.sourceInUs,
    sourceOutUs: range.sourceOutUs,
    sourceGainDb: settings.sourceGainDb,
    muted: settings.muted,
    view: computeSourceView(
      asset.displayWidth ?? 0,
      asset.displayHeight ?? 0,
      project.canvas.aspect,
      settings.fit,
      settings.zoom,
    ),
  };
}

/** Output-anchored lines moved onto one kesit's own clock (see `kesitRecipe`). */
function captionsForKesit(project: Project, clipId: string): CaptionTrackV2[] {
  const track = primaryCaptionTrack(project);
  if (!track || track.timeBase !== 'output') return project.captionTracks;
  const entry = buildTimeline(project).find((item) => item.clipId === clipId);
  if (!entry) return [];
  const cues = track.cues
    .map((cue) => ({
      ...cue,
      startUs: Math.max(cue.startUs, entry.startUs) - entry.startUs,
      endUs: Math.min(cue.endUs, entry.endUs) - entry.startUs,
    }))
    .filter((cue) => cue.endUs > cue.startUs);
  return [{ ...track, cues }];
}

/**
 * The recipe for downloading one kesit on its own.
 *
 * - Source-anchored captions (ADR-016) belong to the picture, so they follow
 *   the kesit with no change.
 * - Output-anchored captions (older projects) are timed on the joined
 *   download. The kesit's download is exactly its part of the joined video:
 *   the lines that fall inside the kesit's slot are moved to start at 0 and
 *   cut at its end. So a line shows in the kesit download precisely when it
 *   would show at that moment of the joined download.
 * - Music (`timelineStartUs`) is on the output clock of each download, so it
 *   starts at the same offset from the start of every downloaded video.
 */
export function kesitRecipe(project: Project, clipId: string): Project | null {
  const clip = project.clips.find((item) => item.clipId === clipId);
  if (!clip) return null;
  return { ...project, clips: [clip], captionTracks: captionsForKesit(project, clipId) };
}

/**
 * The recipe for downloading the whole video when there is no kesit: one
 * clip over the whole file, with the settings the editor holds. Output-
 * anchored lines keep their times: with the whole video as the only range,
 * output time and video time are the same clock.
 */
export function wholeVideoRecipe(project: Project, settings: KesitSettings): Project | null {
  const asset = project.assets.find((item) => item.kind === 'video');
  if (!asset || asset.durationUs < MIN_CLIP_DURATION_US) return null;
  const clip = clipWithSettings(project, 'c_whole', { sourceInUs: 0, sourceOutUs: asset.durationUs }, settings);
  if (!clip) return null;
  return { ...project, clips: [clip] };
}

/** The recipe one download encodes. The "all" button with no kesit is the whole video. */
export function downloadRecipe(
  project: Project,
  target: DownloadTarget,
  settings: KesitSettings,
): Project | null {
  if (target.kind === 'kesit') return kesitRecipe(project, target.clipId);
  if (project.clips.length === 0) return wholeVideoRecipe(project, settings);
  return project;
}

/** What a download is, for its gate sentence and its file name. */
export type DownloadKind = 'kesit' | 'merged' | 'whole';

export function downloadKind(project: Pick<Project, 'clips'>, target: DownloadTarget): DownloadKind {
  if (target.kind === 'kesit' || project.clips.length === 1) return 'kesit';
  return project.clips.length === 0 ? 'whole' : 'merged';
}

/** A stable key per download button, for its progress and result. */
export function targetKey(target: DownloadTarget): string {
  return target.kind === 'kesit' ? `kesit:${target.clipId}` : 'all';
}

// ------------------------------------------------------------------ labels

/**
 * A position in the video as a clock to whole seconds, rounded DOWN: a kesit
 * starting at 12.9 s starts in second 12. `00:12`, `12:30`, `1:02:03`.
 */
export function formatPosition(us: Micros): string {
  const total = Math.floor(Math.max(0, us) / US_PER_SECOND + 1e-9);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${String(minutes).padStart(2, '0')}:${seconds}`;
}

/**
 * A kesit's length as a clock: `0:07`, `1:28`, `1:02:03`. Rounded to the
 * nearest second, but never shown as `0:00` for a real kesit.
 */
export function formatKesitLength(us: Micros): string {
  const total = Math.max(us > 0 ? 1 : 0, Math.round(Math.max(0, us) / US_PER_SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** The file-name part of the video's name: no extension, only safe characters. */
export function fileBaseName(name: string): string {
  const withoutExtension = name.replace(/\.[^./\\]+$/, '');
  const cleaned = withoutExtension
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return (cleaned || 'video').slice(0, 60);
}

/**
 * The name the save dialog suggests (ADR-026), e.g. `tatil_00-12-01-40.mp4`
 * for one kesit, `tatil_3-kesit.mp4` for three joined, `tatil_tamami.mp4`
 * for the whole video. Always ASCII separators, never the original name
 * itself, so saving next to the original never offers to overwrite it.
 */
export function suggestedFileName(
  videoFileName: string,
  download:
    | { kind: 'kesit'; sourceInUs: Micros; sourceOutUs: Micros }
    | { kind: 'merged'; count: number }
    | { kind: 'whole' },
): string {
  const base = fileBaseName(videoFileName);
  if (download.kind === 'whole') return `${base}_tamami.mp4`;
  if (download.kind === 'merged') return `${base}_${download.count}-kesit.mp4`;
  const part = (us: Micros) => formatPosition(us).replace(/:/g, '-');
  return `${base}_${part(download.sourceInUs)}-${part(download.sourceOutUs)}.mp4`;
}

// ---------------------------------------------------------- pending range

/**
 * The range the user is marking with Başlangıç (I) and Bitiş (O) before
 * "Kesit ekle". An unmarked edge means the start or the end of the video, so
 * pressing only I and then "Kesit ekle" keeps everything from I to the end.
 */
export interface PendingRange {
  inUs: Micros | null;
  outUs: Micros | null;
}

export const EMPTY_PENDING: PendingRange = { inUs: null, outUs: null };

/** The range "Kesit ekle" would add, with unmarked edges filled in. */
export function resolvePending(pending: PendingRange, durationUs: Micros): { sourceInUs: Micros; sourceOutUs: Micros } {
  return { sourceInUs: pending.inUs ?? 0, sourceOutUs: pending.outUs ?? durationUs };
}

/**
 * Marks one edge at the playhead. Marking a start after the marked end (or
 * an end before the marked start) drops the other mark instead of producing a
 * reversed range: the latest mark is what the user means.
 */
export function markPending(pending: PendingRange, edge: 'in' | 'out', atUs: Micros): PendingRange {
  const us = Math.max(0, Math.round(atUs));
  if (edge === 'in') {
    return { inUs: us, outUs: pending.outUs !== null && pending.outUs <= us ? null : pending.outUs };
  }
  return { inUs: pending.inUs !== null && pending.inUs >= us ? null : pending.inUs, outUs: us };
}

// ---------------------------------------------------------------- reorder

/** Where a kesit would land when moved to `toIndex` (clamped into the list). */
export function clampIndex(length: number, toIndex: number): number {
  return Math.max(0, Math.min(length - 1, Math.round(toIndex)));
}
