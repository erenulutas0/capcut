/**
 * Local web limits. The single source of truth is
 * `video-editor-blueprint/docs/15_PRICING_FREE_PRO.md` (policy id 2026-09-24.v6)
 * plus the web guard rails in doc 11. Plan names are deliberately NOT hardcoded
 * into the domain: this is one policy object the app passes in.
 *
 * A subscription does not lift a browser's memory or codec limit (doc 11).
 */

import { US_PER_SECOND, type Micros } from './time';

export interface ExportPolicy {
  policyId: string;
  maxOutputDurationUs: Micros;
  /**
   * Output limit when the browser cannot stream the file to disk (OPFS) and
   * the finished video has to be held in memory. ADR-013 measured that route
   * growing with output length (~1 GiB at 5 min 1080p), so it keeps the old
   * 5-minute cap (doc 15 v3, ADR-020).
   */
  maxMemoryRouteOutputDurationUs: Micros;
  maxTotalSourceDurationUs: Micros;
  maxTotalSourceBytes: number;
  maxVideoAssets: number;
  maxClips: number;
  maxMusicTracks: number;
  maxMusicDurationUs: Micros;
  maxMusicBytes: number;
  minGainDb: number;
  maxGainDb: number;
}

const MIB = 1_048_576;

export const WEB_LOCAL_POLICY: ExportPolicy = {
  // v6 (2026-09-24): the download is "at most 30 fps"; a fast-cut copy keeps the
  // source's own rate and bitrate (ADR-027). No limit below changed.
  policyId: '2026-09-24.v6/web-local',
  // Raised from 5 min by founder decision (doc 15 v3): on the disk (OPFS)
  // route export memory stays flat with output length (ADR-013, ADR-020).
  maxOutputDurationUs: 60 * 60 * US_PER_SECOND,
  maxMemoryRouteOutputDurationUs: 5 * 60 * US_PER_SECOND,
  // 20 min / 250 MiB -> 60 min / 2 GiB (doc 15 v2, ADR-013) -> 120 min
  // (doc 15 v4, ADR-021): export memory follows the OUTPUT, the source is
  // read from disk. 2 GiB -> 4 GiB (doc 15 v5, ADR-025): files past the 2 and
  // 4 GiB byte offsets measured in Chrome, Edge and Chromium. Video and music
  // together.
  maxTotalSourceDurationUs: 120 * 60 * US_PER_SECOND,
  maxTotalSourceBytes: 4096 * MIB,
  maxVideoAssets: 5,
  maxClips: 20,
  maxMusicTracks: 1,
  maxMusicDurationUs: 10 * 60 * US_PER_SECOND,
  maxMusicBytes: 100 * MIB,
  minGainDb: -60,
  maxGainDb: 0,
};

/**
 * How long the timeline (the recipe) may be (ADR-021). It is the INPUT limit:
 * a video that may be opened at all arrives whole, as one piece, even when it
 * is longer than the output limit. The output limit is an export gate — the
 * user splits and deletes down to it — not a rule of the recipe. There is no
 * separate number in doc 15 for this on purpose: tying it to the input limit
 * means an openable video can never be too long for the timeline.
 */
export function maxTimelineDurationUs(policy: Pick<ExportPolicy, 'maxTotalSourceDurationUs'>): Micros {
  return policy.maxTotalSourceDurationUs;
}

/** How far a result is over an output limit (ADR-021). */
export interface OutputOverrun {
  totalUs: Micros;
  limitUs: Micros;
  /** What must be removed, at least, before the result may be downloaded. */
  excessUs: Micros;
}

/**
 * The export gate's arithmetic: null when a result of `totalUs` fits
 * `limitUs` (the limit itself fits), otherwise by how much it does not.
 */
export function outputOverrun(totalUs: Micros, limitUs: Micros): OutputOverrun | null {
  if (!(totalUs > limitUs)) return null;
  return { totalUs, limitUs, excessUs: totalUs - limitUs };
}

/**
 * Doc 15 limits the project's video and music together ("toplam byte limitine
 * dahil"), so a file that fits on its own can still be one too many.
 */
export function exceedsTotalSourceBytes(
  policy: ExportPolicy,
  fileBytes: number,
  otherSourceBytes: number,
): boolean {
  return fileBytes + otherSourceBytes > policy.maxTotalSourceBytes;
}

/**
 * Why an export could not use a disk route, as the output sink saw it. `opfs`
 * and `file` (the file picked in the save dialog, ADR-026) are disk routes.
 * `no_disk_access`: no OPFS sync access in the worker (older browsers, some
 * private windows). `not_enough_space`: there is access, but the storage
 * estimate leaves no room for the file.
 */
export type OutputRouteAvailability = 'opfs' | 'file' | 'no_disk_access' | 'not_enough_space';

export type OutputRouteRefusal = 'output_too_long_for_memory' | 'output_storage_insufficient';

/**
 * Doc 15 v3/v4: 60 minutes only where the file goes to disk. Without that route a
 * short output still falls back to memory (the proven W1 route); a longer one
 * is refused before any frame is encoded, with the reason the user can act on.
 */
export function outputRouteRefusal(
  policy: Pick<ExportPolicy, 'maxMemoryRouteOutputDurationUs'>,
  availability: OutputRouteAvailability,
  outputDurationUs: Micros,
): OutputRouteRefusal | null {
  // `file`: the user's own file from the save dialog (ADR-026), a disk route too.
  if (availability === 'opfs' || availability === 'file') return null;
  if (outputDurationUs <= policy.maxMemoryRouteOutputDurationUs) return null;
  return availability === 'not_enough_space' ? 'output_storage_insufficient' : 'output_too_long_for_memory';
}

/**
 * A file size as the user sees it next to the limit. The values are binary
 * (1024-based), so the units are spelled as binary too: doc 15 asks that the
 * unit shown is the unit checked, and a "4.00 GB" file next to a "4 GiB
 * (about 4.29 GB)" limit would be neither.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(0)} KiB`;
  if (bytes < 1024 * MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  return `${(bytes / (1024 * MIB)).toFixed(2)} GiB`;
}
