/**
 * EDL v4 — the canonical, portable editing recipe (doc 10).
 *
 * v2 = v1 + `captionTracks` (ADR-015). v3 = v2 + caption tracks written by
 * the on-device transcript (ADR-036): `origin: 'transcript'`, the spans that
 * could not be written (`unclear`), and a higher line limit. v4 = v3 + the
 * optional `enhance` setting ("İyileştir", ADR-037). Everything else is
 * unchanged, so v1, v2 and v3 recipes are read through `migrateProject`
 * (migration.ts) and never rejected.
 *
 * It carries asset *identities* and edit semantics only. Local URIs, blob URLs,
 * signed URLs, tokens, licences and user identity are deliberately absent:
 * mapping an assetId to a real file is the repository's job, not the recipe's.
 */

import type { Micros } from './time';

export const EDL_SCHEMA_VERSION = 4;

export type AssetKind = 'video' | 'audio';
export type AspectRatio = '9:16' | '16:9' | '1:1';
export type FitMode = 'cover' | 'contain';

export interface AssetV1 {
  assetId: string;
  kind: AssetKind;
  durationUs: Micros;
  displayWidth?: number;
  displayHeight?: number;
  hasAudio?: boolean;
}

/**
 * Normalised crop rectangle over the *orientation-corrected* source image.
 * Unlike time, these are fractions, not integers (doc 10).
 */
export interface ViewRectV1 {
  x: number;
  y: number;
  width: number;
  height: number;
  fit: FitMode;
}

export interface ClipV1 {
  clipId: string;
  assetId: string;
  /** Half-open source range: [sourceInUs, sourceOutUs). */
  sourceInUs: Micros;
  sourceOutUs: Micros;
  sourceGainDb: number;
  muted: boolean;
  view: ViewRectV1;
}

export interface MusicV1 {
  assetId: string;
  sourceInUs: Micros;
  sourceOutUs: Micros;
  /** Where the selection starts on the output timeline. */
  timelineStartUs: Micros;
  gainDb: number;
  muted: boolean;
  fadeInUs: Micros;
  fadeOutUs: Micros;
}

export interface CanvasV1 {
  aspect: AspectRatio;
  background: string;
}

export interface ExportSpecV1 {
  container: 'mp4';
  videoCodec: 'h264';
  audioCodec: 'aac';
  shortEdge: number;
  fpsNum: number;
  fpsDen: number;
  colorMode: 'sdr_rec709';
  audioSampleRate: number;
}

/** Caption look. Presets, not free styling: preview and export must match. */
export type CaptionPreset = 'box' | 'outline';
export type CaptionPosition = 'bottom' | 'middle' | 'top';
export type CaptionSize = 'small' | 'medium' | 'large';

export interface CaptionStyleV2 {
  preset: CaptionPreset;
  position: CaptionPosition;
  size: CaptionSize;
}

/** One displayed line (or two), on the track's time base. Half-open range. */
export interface CaptionCueV2 {
  cueId: string;
  startUs: Micros;
  endUs: Micros;
  /** Plain text, canonical form (see `normalizeCaptionText`); never markup. */
  text: string;
}

/**
 * A displayed caption track (ADR-009: never the transcript itself).
 *
 * `timeBase` says which clock the cue times are on (ADR-016):
 * - `output`: the finished video. What the user sees while typing; cues stay
 *   put when moments are reordered.
 * - `source`: the video file named by `assetId`. Cues travel with the
 *   picture: reorder, trim or repeat a moment and its captions follow, and a
 *   range used twice shows its captions twice.
 */
export type CaptionTimeBase = 'output' | 'source';

export interface CaptionTrackV2 {
  trackId: string;
  /**
   * Where the lines came from: typed in the editor, an SRT/VTT file, or the
   * on-device transcript (ADR-036; machine-made, and the UI says so).
   */
  origin: CaptionOrigin;
  timeBase: CaptionTimeBase;
  /** Required for `source` tracks, absent for `output` tracks. */
  assetId?: string;
  /** BCP 47 primary language, optionally with region: "tr", "en", "en-GB". */
  language: string;
  style: CaptionStyleV2;
  cues: CaptionCueV2[];
  /**
   * Transcript tracks only (ADR-036): source ranges where speech was heard
   * but could not be written. Shown as "(anlaşılamadı)" in the transcript
   * panel; never drawn on the video and never exported as subtitles.
   * Sorted, not overlapping each other, inside the video.
   */
  unclear?: CaptionUnclearV3[];
}

export type CaptionOrigin = 'manual' | 'imported' | 'transcript';

/** A half-open source range the transcript could not write. */
export interface CaptionUnclearV3 {
  startUs: Micros;
  endUs: Micros;
}

/**
 * "İyileştir" (ADR-037): the picture of every download is cleaned up on the
 * device — light, colour, sharpness, noise — at this strength. Absent: off.
 * What exactly is done is decided from the video itself at download time
 * (`domain/enhance.ts`); the recipe only says that it is wanted and how strongly.
 */
export type EnhanceStrengthV4 = 'light' | 'auto' | 'strong';

export interface EnhanceV4 {
  strength: EnhanceStrengthV4;
}

export const ENHANCE_STRENGTHS_V4: readonly EnhanceStrengthV4[] = ['light', 'auto', 'strong'];

/** The v3 recipe (ADR-036): the same shape, before `enhance` existed. */
export interface LegacyProjectV3 extends Omit<Project, 'schemaVersion' | 'enhance'> {
  schemaVersion: 3;
}

/** The v2 recipe (ADR-015/016): the same shape, before transcript tracks existed. */
export interface LegacyProjectV2 extends Omit<Project, 'schemaVersion' | 'enhance'> {
  schemaVersion: 2;
}

/** The v1 recipe as stored by older builds. Only migration.ts reads it. */
export interface LegacyProjectV1 extends Omit<Project, 'schemaVersion' | 'captionTracks' | 'enhance'> {
  schemaVersion: 1;
}

export interface Project {
  schemaVersion: typeof EDL_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  assets: AssetV1[];
  canvas: CanvasV1;
  clips: ClipV1[];
  music?: MusicV1;
  export: ExportSpecV1;
  captionTracks: CaptionTrackV2[];
  /** v4 (ADR-037). Absent: the picture is not enhanced. */
  enhance?: EnhanceV4;
}

export const PROJECT_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'projectId',
  'revision',
  'assets',
  'canvas',
  'clips',
  'music',
  'export',
  'captionTracks',
  'enhance',
] as const;

export const ASPECT_RATIOS: readonly AspectRatio[] = ['9:16', '16:9', '1:1'];

/** Output pixel sizes per doc 09 ("9:16 1080p → 1080×1920"). */
export function aspectRatioValue(aspect: AspectRatio): number {
  switch (aspect) {
    case '9:16':
      return 9 / 16;
    case '16:9':
      return 16 / 9;
    case '1:1':
      return 1;
  }
}

/** Encoder dimensions are normalised to even numbers (doc 09). */
export function outputPixelSize(
  aspect: AspectRatio,
  shortEdge: number,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  switch (aspect) {
    case '9:16':
      return { width: even(shortEdge), height: even((shortEdge * 16) / 9) };
    case '16:9':
      return { width: even((shortEdge * 16) / 9), height: even(shortEdge) };
    case '1:1':
      return { width: even(shortEdge), height: even(shortEdge) };
  }
}

export const DEFAULT_EXPORT_SPEC: ExportSpecV1 = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  shortEdge: 1080,
  fpsNum: 30,
  fpsDen: 1,
  colorMode: 'sdr_rec709',
  audioSampleRate: 48000,
};

export const FULL_FRAME_VIEW: ViewRectV1 = { x: 0, y: 0, width: 1, height: 1, fit: 'cover' };
