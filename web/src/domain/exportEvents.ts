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
  | 'audio_undecodable'
  | 'video_encoder_unsupported'
  | 'audio_encoder_unsupported'
  | 'no_frames_decoded'
  | 'output_probe_failed'
  | 'output_duration_mismatch'
  | 'out_of_memory'
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

export interface ExportResult {
  attemptId: string;
  fingerprint: string;
  sizeBytes: number;
  /** Measured from the produced file, not copied from the plan. */
  probe: ExportProbe;
  /** Difference between the plan's frame grid and the produced file. */
  durationDeltaUs: Micros;
  /** Wall-clock milliseconds the encode took. */
  elapsedMs: number;
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
  | { type: 'succeeded'; attemptId: string; result: ExportResult; data: Uint8Array }
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
