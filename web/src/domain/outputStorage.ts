/**
 * How much free space the disk (OPFS) route asks for before it encodes.
 *
 * A technical safety parameter, not a quota (ADR-023). The numbers come from
 * measurement:
 *
 * - mediabunny writes the file once: `mdat` is streamed, its size patched in
 *   place, `moov` appended. There is no second copy and no rewrite at the
 *   end. The disk route claims this estimate up front (outputSink), so the
 *   OPFS peak is the estimate itself, trimmed to the real file at the end.
 * - The real file stays within the nominal size (bitrates × duration) times
 *   `ENCODER_OVERSHOOT` on long outputs. Short, detailed real clips overshoot
 *   more in relative terms, but they are small; `FIXED_HEADROOM_BYTES`
 *   covers them plus the `moov` index.
 *
 * Saving the file ("Bilgisayara kaydet") streams it from OPFS to the
 * Downloads folder: another copy of the same size on ordinary disk, outside
 * the browser's quota. The page cannot see that folder, so it is not checked
 * here; the file stays offered until the dialog closes if that save fails.
 */

import { WEB_LOCAL_POLICY, formatBytes } from './policy';
import { US_PER_SECOND, type Micros } from './time';

const MIB = 1_048_576;

/**
 * Real/nominal size ratio of long outputs measured 0.98-1.00 (88 s to 60 min,
 * hardware and software encoders, ADR-023); 10% on top for content that was
 * not measured. A file that still outgrows it keeps writing, it only fails if
 * the disk is really full.
 *
 * Kept at 1.1 after ADR-045 (14 Oct 2026). The variable mode it was measured
 * with wrote up to 1.29 of the asked video bitrate on the desktop's hardware
 * encoder and 1.06–1.51 on a phone (1.97 on a 3.5 s clip, which the fixed
 * headroom covers); the hardware encoder now runs in constant mode, measured
 * at 0.95–1.00 on the desktop and 0.999–1.003 on the phone. So the estimate
 * now holds where it did not always before; it is not lowered, because the
 * software encoder (still variable) and unmeasured hardware encoders keep
 * their own spread.
 */
export const ENCODER_OVERSHOOT = 1.1;

/**
 * Short clips overshoot more in relative terms (up to 1.5x on a 1.8 s clip)
 * but by under 1 MiB; this also covers the `moov` index (ADR-023).
 */
export const FIXED_HEADROOM_BYTES = 32 * MIB;

export interface OutputSizeInput {
  videoBitrate: number;
  audioBitrate: number;
  durationUs: Micros;
}

/** Bits the encoders are asked for, as bytes: the size the file aims at. */
export function nominalOutputBytes({ videoBitrate, audioBitrate, durationUs }: OutputSizeInput): number {
  return ((videoBitrate + audioBitrate) * (durationUs / US_PER_SECOND)) / 8;
}

/** Upper estimate of the finished file. */
export function estimateOutputBytes(input: OutputSizeInput): number {
  return Math.ceil(nominalOutputBytes(input) * ENCODER_OVERSHOOT + FIXED_HEADROOM_BYTES);
}

/**
 * Free space the browser must report before the disk route is used. The file
 * is written once, so the estimate itself is the requirement; the old rule
 * (twice a looser estimate) asked ~6 GiB for a 2.4 GiB file.
 */
export function requiredFreeBytes(input: OutputSizeInput): number {
  return estimateOutputBytes(input);
}

export function hasRoomForOutput(freeBytes: number, requiredBytes: number): boolean {
  return Number.isFinite(freeBytes) && freeBytes >= requiredBytes;
}

/**
 * Storage numbers in the messages, in decimal units ("2,58 GB", "41,9 MB";
 * ADR-030, `formatBytes`). The check is made in bytes. A need is rounded up
 * and a reported free space down, so the message never makes a shortfall
 * look smaller than it is.
 */
export function formatStorageBytes(bytes: number, round: 'up' | 'down', decimalMark: string): string {
  return formatBytes(bytes, decimalMark, round);
}

/* ------------------------------------------------------- the largest file */

/** FAT32's largest file: 4 GiB minus one byte (most USB sticks and SD cards). */
export const FAT32_MAX_FILE_BYTES = 4 * 1024 * MIB - 1;

/**
 * No download is larger than this (founder, 17 Oct 2026): one byte under
 * 4 GiB. Two reasons, the same number today:
 *
 * - LiloCut opens files up to `maxTotalSourceBytes` (4 GiB, doc 15): what it
 *   writes must open again in LiloCut;
 * - FAT32 cannot hold a file of 4 GiB or more.
 *
 * Measured before (long-export soak, 15 Oct 2026): a 60-minute 1080p full
 * re-encode on the software encoder (ADR-024's 3×) wrote 4958 MiB.
 */
export const OUTPUT_FILE_LIMIT_BYTES = Math.min(WEB_LOCAL_POLICY.maxTotalSourceBytes, FAT32_MAX_FILE_BYTES);

/**
 * The highest video bitrate whose upper size estimate (`estimateOutputBytes`:
 * ADR-023's measured allowance, × 1.1 + 32 MiB) stays at or under
 * `OUTPUT_FILE_LIMIT_BYTES` for this length and sound. Infinite for an empty
 * output; never negative.
 *
 * So the planned (nominal) file stays under (4 GiB − 1 − 32 MiB) / 1.1 ≈
 * 3.61 GiB: 60 minutes with 128 kbit/s sound leave 8.48 Mbit/s of video.
 */
export function maxVideoBitrateForFileLimit(
  input: { audioBitrate: number; durationUs: Micros },
  limitBytes: number = OUTPUT_FILE_LIMIT_BYTES,
): number {
  const seconds = input.durationUs / US_PER_SECOND;
  if (!(seconds > 0)) return Number.POSITIVE_INFINITY;
  const nominalBytes = (limitBytes - FIXED_HEADROOM_BYTES) / ENCODER_OVERSHOOT;
  // One bit/s under the exact solution, so the estimate's ceil() cannot round it over.
  return Math.max(0, Math.floor((nominalBytes * 8) / seconds - input.audioBitrate) - 1);
}

/**
 * A full re-encode's video bitrate, held so that the file stays under the
 * limit above. Applied LAST — after the source's 2× ceiling (ADR-024's 10 Oct
 * addendum, ADR-041) and the software encoder's 3× (ADR-024) — so only long,
 * high-rate outputs are touched: 1080p30 on a hardware encoder (5.6 Mbit/s)
 * never is; on the software encoder (16.8 Mbit/s) it bites past ~30 minutes.
 */
export function fileLimitedVideoBitrate(
  videoBitrate: number,
  input: { audioBitrate: number; durationUs: Micros },
  limitBytes: number = OUTPUT_FILE_LIMIT_BYTES,
): number {
  return Math.min(videoBitrate, maxVideoBitrateForFileLimit(input, limitBytes));
}

/** Whether a file of this many bytes may be the download (`OUTPUT_FILE_LIMIT_BYTES`). */
export function withinFileLimit(bytes: number, limitBytes: number = OUTPUT_FILE_LIMIT_BYTES): boolean {
  return Number.isFinite(bytes) && bytes <= limitBytes;
}

/* --------------------------------------------- what fits on a full disk */

/**
 * The longest output, in whole seconds, whose disk requirement
 * (`requiredFreeBytes`, the rule the download itself uses) fits in
 * `roomBytes`. The rates are the download's own BEFORE the file-limit hold:
 * a shorter output may keep more of its bitrate, and is computed with it.
 * 0 when not even a second fits.
 */
export function longestOutputThatFits(
  roomBytes: number,
  rates: { videoBitrate: number; audioBitrate: number },
  maxDurationUs: Micros,
  limitBytes: number = OUTPUT_FILE_LIMIT_BYTES,
): Micros {
  if (!(roomBytes > 0) || !Number.isFinite(roomBytes)) return 0;
  const need = (seconds: number) => {
    const durationUs = seconds * US_PER_SECOND;
    const videoBitrate = fileLimitedVideoBitrate(
      rates.videoBitrate,
      { audioBitrate: rates.audioBitrate, durationUs },
      limitBytes,
    );
    return requiredFreeBytes({ videoBitrate, audioBitrate: rates.audioBitrate, durationUs });
  };
  // The requirement only grows with the length (the hold keeps it at its ceiling).
  let lo = 0;
  let hi = Math.floor(maxDurationUs / US_PER_SECOND);
  if (need(hi) <= roomBytes) return hi * US_PER_SECOND;
  if (need(1) > roomBytes) return 0;
  lo = 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (need(mid) <= roomBytes) lo = mid;
    else hi = mid;
  }
  return lo * US_PER_SECOND;
}

/**
 * The length to suggest after a "not enough space" refusal, or null when
 * there is no honest number.
 *
 * - `fitUs`: what the disk's free space holds (`longestOutputThatFits`), null
 *   when the room is unknown;
 * - `memoryRouteUs`: the memory route's limit where the download falls back
 *   to it (the browser's private disk, doc 15 v3): an output that short works
 *   whatever the disk holds. Null on the save-dialog route, which never falls
 *   back;
 * - `outputUs`: the refused output. A suggestion is always shorter.
 *
 * Said in whole minutes from one minute on and in whole seconds under it
 * (rounded down here), so the number shown is the number that fits.
 */
export function storageFitSuggestion(input: {
  fitUs: Micros | null;
  memoryRouteUs: Micros | null;
  outputUs: Micros;
}): Micros | null {
  const candidates = [input.fitUs, input.memoryRouteUs].filter(
    (value): value is Micros => value !== null && Number.isFinite(value) && value > 0,
  );
  if (candidates.length === 0) return null;
  const best = Math.min(Math.max(...candidates), input.outputUs - 1);
  const minute = 60 * US_PER_SECOND;
  const shown =
    best >= minute ? Math.floor(best / minute) * minute : Math.floor(best / US_PER_SECOND) * US_PER_SECOND;
  return shown >= US_PER_SECOND ? shown : null;
}
