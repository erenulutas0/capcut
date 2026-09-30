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

// ------------------------------------------------------------ byte sizes

/**
 * Sizes as people read them (ADR-030): decimal units, "KB", "MB", "GB"
 * (1 GB = 1 000 000 000 bytes), with the language's decimal mark. The checks
 * stay in bytes and the limits stay the same numbers of bytes (doc 15 v5:
 * 4 GiB = 4 294 967 296 bytes; music 100 MiB = 104 857 600 bytes).
 *
 * Doc 15's units rule — the unit shown is the unit checked — is kept by what
 * the text stands for. Every size is shown on a grid (whole B and KB, 0.1 MB,
 * 0.01 GB) and the text stands for exactly `shownBytes(...)` bytes:
 *
 * - a LIMIT is rounded DOWN ("4,29 GB" for 4 GiB, "104,8 MB" for 100 MiB): no
 *   file the text allows is refused;
 * - a size next to a limit (`formatBytesAgainstLimit`) is rounded to the
 *   nearest step when it fits, but never above the shown limit, and rounded
 *   UP when it does not, so it always reads above the shown limit.
 *
 * So "shown size ≤ shown limit" holds exactly when the byte check passes
 * (tests/unit/byteUnits.test.ts walks the boundary bytes).
 */
export type ByteRounding = 'nearest' | 'up' | 'down';

interface ByteUnit {
  symbol: string;
  /** Bytes in one unit. */
  size: number;
  /** Bytes in one step of the shown grid. */
  step: number;
  decimals: number;
}

const BYTE_UNITS: readonly ByteUnit[] = [
  { symbol: 'B', size: 1, step: 1, decimals: 0 },
  { symbol: 'KB', size: 1_000, step: 1_000, decimals: 0 },
  { symbol: 'MB', size: 1_000_000, step: 100_000, decimals: 1 },
  { symbol: 'GB', size: 1_000_000_000, step: 10_000_000, decimals: 2 },
];

interface ShownSize {
  unit: ByteUnit;
  steps: number;
}

function roundSteps(value: number, round: ByteRounding): number {
  // The divisions are of integers; a tiny tolerance keeps an exact step
  // (4.29e9 / 1e7 = 429) from rounding up on a float artefact.
  if (round === 'up') return Math.ceil(value - 1e-9);
  if (round === 'down') return Math.floor(value + 1e-9);
  return Math.round(value);
}

function shownSize(bytes: number, round: ByteRounding): ShownSize {
  let index = BYTE_UNITS.length - 1;
  while (index > 0 && bytes < (BYTE_UNITS[index] as ByteUnit).size) index -= 1;
  for (;;) {
    const unit = BYTE_UNITS[index] as ByteUnit;
    const steps = roundSteps(bytes / unit.step, round);
    const next = BYTE_UNITS[index + 1];
    // 999 960 bytes rounds to "1000 KB": say "1 MB" instead.
    if (next && steps * unit.step >= next.size) {
      index += 1;
      continue;
    }
    return { unit, steps };
  }
}

function sizeText(shown: ShownSize, decimalMark: string): string {
  const value = (shown.steps * shown.unit.step) / shown.unit.size;
  // Trailing zeros say nothing: "2 MB", "2,5 GB", "4,29 GB".
  const exact = value.toFixed(shown.unit.decimals);
  const fixed = exact.includes('.') ? exact.replace(/\.?0+$/, '') : exact;
  return `${fixed.replace('.', decimalMark)} ${shown.unit.symbol}`;
}

/** The number of bytes a formatted size stands for (for the boundary tests). */
export function shownBytes(bytes: number, round: ByteRounding = 'nearest'): number {
  const shown = shownSize(bytes, round);
  return shown.steps * shown.unit.step;
}

/**
 * A size in decimal units: "512 B", "20 KB", "79,2 MB", "2,41 GB". `round`:
 * a need is rounded up and a free space down, so a message never makes a
 * shortfall look smaller than it is (ADR-023).
 */
export function formatBytes(bytes: number, decimalMark: string, round: ByteRounding = 'nearest'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return sizeText(shownSize(Math.round(bytes), round), decimalMark);
}

/** A limit, rounded down: "4,29 GB" for 4 GiB, "104,8 MB" for 100 MiB, "2 MB" for 2 MiB. */
export function formatByteLimit(limitBytes: number, decimalMark: string): string {
  return formatBytes(limitBytes, decimalMark, 'down');
}

/**
 * A file's size next to the limit it is checked against: reads at or under
 * the shown limit exactly when `bytes <= limitBytes`.
 */
export function formatBytesAgainstLimit(bytes: number, limitBytes: number, decimalMark: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const whole = Math.round(bytes);
  if (whole > limitBytes) return sizeText(shownSize(whole, 'up'), decimalMark);
  const near = shownSize(whole, 'nearest');
  if (near.steps * near.unit.step <= shownBytes(limitBytes, 'down')) return sizeText(near, decimalMark);
  return sizeText(shownSize(limitBytes, 'down'), decimalMark);
}
