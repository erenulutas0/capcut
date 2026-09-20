/**
 * EDL v1 — the canonical, portable editing recipe (doc 10).
 *
 * It carries asset *identities* and edit semantics only. Local URIs, blob URLs,
 * signed URLs, tokens, licences and user identity are deliberately absent:
 * mapping an assetId to a real file is the repository's job, not the recipe's.
 */

import type { Micros } from './time';

export const EDL_SCHEMA_VERSION = 1;

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

export interface ProjectV1 {
  schemaVersion: typeof EDL_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  assets: AssetV1[];
  canvas: CanvasV1;
  clips: ClipV1[];
  music?: MusicV1;
  export: ExportSpecV1;
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
