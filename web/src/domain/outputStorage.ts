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

import { US_PER_SECOND, type Micros } from './time';

const MIB = 1_048_576;
const GIB = 1_073_741_824;

/**
 * Real/nominal size ratio of long outputs measured 0.98-1.00 (88 s to 60 min,
 * hardware and software encoders, ADR-023); 10% on top for content that was
 * not measured. A file that still outgrows it keeps writing, it only fails if
 * the disk is really full.
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
 * Binary units, spelled as such: the check is made in bytes and the message
 * must not round a GiB into a "GB" (ADR-013). A need is rounded up and a
 * reported free space down, so the message never makes a shortfall look
 * smaller than it is.
 */
export function formatStorageBytes(bytes: number, round: 'up' | 'down'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const step = round === 'up' ? Math.ceil : Math.floor;
  if (bytes >= GIB) return `${(step((bytes / GIB) * 100) / 100).toFixed(2)} GiB`;
  return `${step(bytes / MIB)} MiB`;
}
