/**
 * The diagnostics file a user may download from "Sorun bildir" and send to
 * support themselves (doc 28 "Destek formu", doc 24: "Kullanıcıdan hata kodu
 * paylaşması istenir; videosunu otomatik almak şart değildir").
 *
 * This builder is an allow-list. It receives rich inputs — the whole project,
 * a navigator snapshot — and copies out only the fields named below, each as
 * a number, a boolean, an enum or a checked code. The project's title, file
 * names, caption text and ids are never read, so no future field added to
 * the EDL can leak into the file without someone changing this function.
 *
 * Nothing here sends anything. The file exists only when the user presses
 * the download button, and the dialog shows its full content first.
 */

import type { Project } from './edl';
import { sanitizeExportLogEntry, type ExportLogEntry } from './exportLog';
import { totalOutputDurationUs } from './timeline';

export const DIAGNOSTICS_KIND = 'clip-diagnostics';
export const DIAGNOSTICS_VERSION = 1;

/** Where an error code was seen. A fixed list, not free text. */
export type ErrorArea =
  | 'export'
  | 'capability'
  | 'plan'
  | 'media'
  | 'storage'
  | 'silence'
  | 'edit'
  | 'uncaught';

const AREAS: ReadonlySet<string> = new Set([
  'export',
  'capability',
  'plan',
  'media',
  'storage',
  'silence',
  'edit',
  'uncaught',
]);

export interface SessionError {
  at: string;
  area: ErrorArea;
  code: string;
}

/** Error codes are snake_case enums. A file name or a sentence never matches. */
export const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** Codec identifiers as the media library reports them ("avc", "aac", "hevc"). */
const CODEC_PATTERN = /^[a-z0-9][a-z0-9.-]{0,31}$/i;
const FONT_STATUSES: ReadonlySet<string> = new Set(['loaded', 'api_missing', 'load_failed']);

/** Stage results of the last capability gate that ran in this session. */
export interface CapabilitySummary {
  at: string;
  environmentPassed: boolean;
  videoConfigSupported: boolean | null;
  audioConfigSupported: boolean | null;
  selfTestPassed: boolean | null;
  captionFont: string | null;
  sourceVideoDecodable: boolean | null;
  sourceAudioDecodable: boolean | null;
  sourceVideoCodec: string | null;
  sourceAudioCodec: string | null;
  sourceIsHdr: boolean | null;
  blockers: string[];
}

export interface BrowserSnapshot {
  userAgent: string;
  platform: string;
  language: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
}

export interface ScreenSnapshot {
  width: number;
  height: number;
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface FeatureSnapshot {
  secureContext: boolean;
  crossOriginIsolated: boolean;
  worker: boolean;
  offscreenCanvas: boolean;
  videoEncoder: boolean;
  audioEncoder: boolean;
  videoDecoder: boolean;
  audioDecoder: boolean;
  opfs: boolean;
  webGpu: boolean;
  indexedDb: boolean;
}

export interface DiagnosticsInput {
  now: Date;
  app: { version: string; commit: string };
  browser: BrowserSnapshot;
  screen: ScreenSnapshot;
  features: FeatureSnapshot;
  storage: { quotaBytes: number; usageBytes: number } | null;
  capability: CapabilitySummary | null;
  /** The open project. Only counts are read from it (see `projectShape`). */
  project: Project | null;
  exportLog: readonly unknown[];
  sessionErrors: readonly unknown[];
}

export interface DiagnosticsReport {
  kind: typeof DIAGNOSTICS_KIND;
  version: typeof DIAGNOSTICS_VERSION;
  createdAt: string;
  app: { version: string; commit: string };
  browser: BrowserSnapshot;
  screen: ScreenSnapshot;
  features: FeatureSnapshot;
  storage: { quotaMb: number; usageMb: number } | null;
  capabilityGate: CapabilitySummary | null;
  project: {
    clipCount: number;
    captionLineCount: number;
    hasMusic: boolean;
    aspect: string;
    shortEdge: number;
    outputDurationMs: number;
  } | null;
  exportLog: ExportLogEntry[];
  sessionErrors: SessionError[];
}

function bool(value: unknown): boolean {
  return value === true;
}

function nullableBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Browser-provided strings are bounded so a strange UA cannot bloat the file. */
function bounded(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function codec(value: unknown): string | null {
  return typeof value === 'string' && CODEC_PATTERN.test(value) ? value : null;
}

const ASPECTS: ReadonlySet<string> = new Set(['9:16', '16:9', '1:1']);

/** Structure only: how many moments and lines, never what they say. */
export function projectShape(project: Project): NonNullable<DiagnosticsReport['project']> {
  const captionLineCount = project.captionTracks.reduce((sum, track) => sum + track.cues.length, 0);
  return {
    clipCount: project.clips.length,
    captionLineCount,
    hasMusic: project.music !== undefined,
    aspect: ASPECTS.has(project.canvas.aspect) ? project.canvas.aspect : 'unknown',
    shortEdge: count(project.export.shortEdge) ?? 0,
    outputDurationMs: Math.round(totalOutputDurationUs(project) / 1000),
  };
}

export function sanitizeSessionError(raw: unknown): SessionError | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.area !== 'string' || !AREAS.has(row.area)) return null;
  if (typeof row.code !== 'string' || !ERROR_CODE_PATTERN.test(row.code)) return null;
  if (typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at))) return null;
  return { at: new Date(row.at).toISOString(), area: row.area as ErrorArea, code: row.code };
}

function capabilityCopy(summary: CapabilitySummary): CapabilitySummary {
  return {
    at: Number.isNaN(Date.parse(summary.at)) ? '' : new Date(summary.at).toISOString(),
    environmentPassed: bool(summary.environmentPassed),
    videoConfigSupported: nullableBool(summary.videoConfigSupported),
    audioConfigSupported: nullableBool(summary.audioConfigSupported),
    selfTestPassed: nullableBool(summary.selfTestPassed),
    captionFont:
      typeof summary.captionFont === 'string' && FONT_STATUSES.has(summary.captionFont) ? summary.captionFont : null,
    sourceVideoDecodable: nullableBool(summary.sourceVideoDecodable),
    sourceAudioDecodable: nullableBool(summary.sourceAudioDecodable),
    sourceVideoCodec: codec(summary.sourceVideoCodec),
    sourceAudioCodec: codec(summary.sourceAudioCodec),
    sourceIsHdr: nullableBool(summary.sourceIsHdr),
    blockers: Array.isArray(summary.blockers)
      ? summary.blockers.filter((code): code is string => typeof code === 'string' && ERROR_CODE_PATTERN.test(code))
      : [],
  };
}

const MB = 1024 * 1024;

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const { browser, screen, features } = input;
  return {
    kind: DIAGNOSTICS_KIND,
    version: DIAGNOSTICS_VERSION,
    createdAt: input.now.toISOString(),
    app: { version: bounded(input.app.version, 40), commit: bounded(input.app.commit, 40) },
    browser: {
      userAgent: bounded(browser.userAgent),
      platform: bounded(browser.platform, 60),
      language: bounded(browser.language, 35),
      hardwareConcurrency: count(browser.hardwareConcurrency),
      deviceMemoryGb: count(browser.deviceMemoryGb),
    },
    screen: {
      width: count(screen.width) ?? 0,
      height: count(screen.height) ?? 0,
      devicePixelRatio: count(screen.devicePixelRatio) ?? 0,
      viewportWidth: count(screen.viewportWidth) ?? 0,
      viewportHeight: count(screen.viewportHeight) ?? 0,
    },
    features: {
      secureContext: bool(features.secureContext),
      crossOriginIsolated: bool(features.crossOriginIsolated),
      worker: bool(features.worker),
      offscreenCanvas: bool(features.offscreenCanvas),
      videoEncoder: bool(features.videoEncoder),
      audioEncoder: bool(features.audioEncoder),
      videoDecoder: bool(features.videoDecoder),
      audioDecoder: bool(features.audioDecoder),
      opfs: bool(features.opfs),
      webGpu: bool(features.webGpu),
      indexedDb: bool(features.indexedDb),
    },
    // Rounded to whole MB: enough to explain "disk full", not a byte-exact
    // measure of what the user keeps in this browser.
    storage: input.storage
      ? {
          quotaMb: Math.round((count(input.storage.quotaBytes) ?? 0) / MB),
          usageMb: Math.round((count(input.storage.usageBytes) ?? 0) / MB),
        }
      : null,
    capabilityGate: input.capability ? capabilityCopy(input.capability) : null,
    project: input.project ? projectShape(input.project) : null,
    exportLog: input.exportLog
      .map(sanitizeExportLogEntry)
      .filter((entry): entry is ExportLogEntry => entry !== null),
    sessionErrors: input.sessionErrors
      .map(sanitizeSessionError)
      .filter((entry): entry is SessionError => entry !== null),
  };
}

/** A file name with the date only: never the project title or a source name. */
export function diagnosticsFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `clip-tani-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
