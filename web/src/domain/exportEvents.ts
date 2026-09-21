/**
 * Export event contract (doc 10 "Motor portu", doc 09 phase 7-8).
 *
 * Rules encoded here rather than left to convention:
 * - `progress` is nullable and only carried by phases that can actually measure
 *   it. `finalizing` and `saving` have no percentage, so they do not pretend to.
 * - `succeeded` is emitted once, after the produced file has been re-opened and
 *   probed, and it carries real numbers read back from that file.
 * - failures carry an enum, never a raw path, stack or secret.
 */

import type { Micros } from './time';

export type ExportPhase =
  | 'preparing'
  | 'encoding'
  | 'finalizing'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type ExportFailureCode =
  | 'plan_invalid'
  | 'no_video_track'
  | 'source_undecodable'
  | 'hdr_source_unsupported'
  | 'audio_undecodable'
  | 'video_encoder_unsupported'
  | 'audio_encoder_unsupported'
  | 'no_frames_decoded'
  | 'source_frames_missing'
  | 'source_reorder_unfixable'
  | 'output_probe_failed'
  | 'output_duration_mismatch'
  | 'out_of_memory'
  | 'output_storage_full'
  | 'worker_unavailable'
  | 'internal_error';

/** What was actually measured in the file that was produced. */
export interface ExportProbe {
  durationUs: Micros;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

/**
 * Where the finished file lived while it was written. Reported, not hidden:
 * the memory route costs about twice the file size in RAM (ADR-013).
 */
export type ExportOutputRoute = 'opfs' | 'memory';

export interface ExportResult {
  attemptId: string;
  fingerprint: string;
  sizeBytes: number;
  route: ExportOutputRoute;
  /** Measured from the produced file, not copied from the plan. */
  probe: ExportProbe;
  /** Difference between the plan's frame grid and the produced file. */
  durationDeltaUs: Micros;
  /** Wall-clock milliseconds the encode took. */
  elapsedMs: number;
  /**
   * Output frames whose source frame the decoder never delivered; the previous
   * frame was held there. Shown to the user when above zero.
   */
  framesMissing: number;
}

/**
 * How many undelivered source frames an export may hold over and still call
 * itself a success: 2% of the output, at least one. A single held frame is
 * invisible; a third of the moment frozen or black is a broken file.
 */
export function missingFramesAllowed(totalFrames: number): number {
  return Math.max(1, Math.floor(totalFrames * 0.02));
}

export type ExportEvent =
  | { type: 'preparing'; attemptId: string }
  | {
      type: 'encoding';
      attemptId: string;
      /** 0..1, or null when the phase cannot be measured. */
      progress: number | null;
      framesDone: number;
      totalFrames: number;
    }
  | { type: 'finalizing'; attemptId: string }
  | { type: 'verifying'; attemptId: string }
  | {
      type: 'succeeded';
      attemptId: string;
      result: ExportResult;
      /**
       * `memory`: the bytes themselves, transferred (not copied) to the page.
       * `opfs`: a disk-backed File in the browser's private file system; the
       * page must remove `entryName` when it no longer offers the download.
       */
      output:
        | { kind: 'memory'; data: Uint8Array }
        | { kind: 'opfs'; file: File; entryName: string };
    }
  | { type: 'failed'; attemptId: string; code: ExportFailureCode }
  | { type: 'canceled'; attemptId: string };

export const TERMINAL_EXPORT_TYPES: ReadonlySet<ExportEvent['type']> = new Set([
  'succeeded',
  'failed',
  'canceled',
]);

/**
 * Tolerance for the produced duration (doc 22: "en çok bir çıktı karesi").
 * Muxers round the last sample's duration, so one frame is the budget.
 */
export function durationWithinTolerance(
  expectedUs: Micros,
  actualUs: Micros,
  fpsNum: number,
  fpsDen: number,
): boolean {
  const frameUs = (fpsDen * 1_000_000) / fpsNum;
  return Math.abs(actualUs - expectedUs) <= Math.ceil(frameUs) + 1;
}
