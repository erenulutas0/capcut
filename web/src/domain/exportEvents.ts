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

import type { EnhanceStrength, EnhanceSummary } from './enhance';
import type { ExportMethod, FastCutFallbackReason } from './fastPath';
import type { TargetSizeOutcome } from './targetSize';
import type { Micros } from './time';

export type ExportPhase =
  | 'preparing'
  | 'analysing'
  | 'encoding'
  | 'finalizing'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type ExportFailureCode =
  | 'plan_invalid'
  | 'no_video_track'
  /** ADR-035, audio-only: the video has no sound to save (no audio track, or every kesit muted) and there is no music. */
  | 'no_audio_track'
  /** ADR-035: the target size cannot be met at any acceptable quality; `targetSize` says the smallest that can. */
  | 'target_size_too_small'
  | 'source_undecodable'
  | 'hdr_source_unsupported'
  | 'audio_undecodable'
  | 'video_encoder_unsupported'
  | 'audio_encoder_unsupported'
  /** ADR-032: the AAC encoder's delay could not be measured, or its audio stopped short of the end. */
  | 'audio_encoder_misaligned'
  | 'no_frames_decoded'
  | 'source_frames_missing'
  | 'source_reorder_unfixable'
  | 'caption_font_unavailable'
  | 'caption_does_not_fit'
  | 'output_probe_failed'
  | 'output_duration_mismatch'
  | 'out_of_memory'
  | 'output_storage_full'
  /** Refused up front: the file cannot go to disk and is longer than memory allows (doc 15 v3). */
  | 'output_too_long_for_memory'
  /** Refused up front: disk access exists but the browser could not give the file its space (ADR-023). */
  | 'output_storage_insufficient'
  /** Refused up front: the file picked in the save dialog could not be opened for writing (ADR-026). */
  | 'output_file_unavailable'
  | 'worker_unavailable'
  /** ADR-037: the graphics context that enhances the frames was lost mid-export; no partial file is kept. */
  | 'enhance_failed'
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
export type ExportOutputRoute = 'opfs' | 'memory' | 'file';

export type { ExportMethod } from './fastPath';

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
  /**
   * How the video was produced (ADR-027): `copy` — the source's pictures
   * unchanged; `smart` — unchanged except the frames next to the cuts, which
   * were re-encoded; `encode` — every frame decoded, drawn and encoded.
   */
  method: ExportMethod;
  /** With `encode`: why the fast cut was not used; null when it was never asked for. */
  fallbackReason: FastCutFallbackReason | null;
  /** Output frames copied from the source unchanged. */
  framesCopied: number;
  /** Output frames that went through the encoder. */
  framesEncoded: number;
  /** ADR-035: `audio` for a sound-only M4A (then `probe` has no picture: width and height 0). */
  output?: 'video' | 'audio';
  /** ADR-035: set for a target-size download — what was planned and what the file really is. */
  targetSize?: TargetSizeOutcome;
  /** ADR-037: set when the picture was enhanced — what was really done to it. */
  enhance?: EnhanceOutcome;
}

/** What "İyileştir" did in one download (ADR-037). */
export interface EnhanceOutcome {
  strength: EnhanceStrength;
  /** `webgl2`: on the GPU; `cpu`: the reference renderer (slower, same picture). */
  engine: 'webgl2' | 'cpu';
  /** Whether a graphics card did the work; false on `cpu` and on software WebGL (correct, but slow). */
  accelerated: boolean;
  /** What the plan changed: light, colour, sharpness, noise — or nothing. */
  summary: EnhanceSummary;
  /** Frames of the video that were looked at to decide. */
  analysedFrames: number;
  /** Output frames the enhancement was applied to. */
  enhancedFrames: number;
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
  /** ADR-037: frames of the video are being looked at before the first one is encoded; a real share, 0..1. */
  | { type: 'analysing'; attemptId: string; progress: number }
  | {
      type: 'encoding';
      attemptId: string;
      /** 0..1, or null when the phase cannot be measured. */
      progress: number | null;
      framesDone: number;
      totalFrames: number;
      /**
       * ADR-035: above 1 when a target-size download is being encoded again
       * because the previous file came out over the target.
       */
      pass?: number;
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
       * `file`: already saved where the user chose (ADR-026); nothing to offer.
       */
      output:
        | { kind: 'memory'; data: Uint8Array }
        | { kind: 'opfs'; file: File; entryName: string }
        | { kind: 'file'; fileName: string };
    }
  | {
      type: 'failed';
      attemptId: string;
      code: ExportFailureCode;
      /**
       * The caption line behind `caption_does_not_fit`, so the user is told
       * which one to shorten. An id from the recipe, never the text itself.
       */
      cueId?: string;
      /**
       * With `output_storage_insufficient`: what the export needed and what
       * the browser's storage estimate offered, so the user is told both.
       */
      storage?: StorageShortfall;
      /** With `target_size_too_small`: the target, and what would work instead. */
      targetSize?: TargetSizeShortfall;
    }
  | { type: 'canceled'; attemptId: string };

/** Why a target size was refused, in numbers the user can act on (ADR-035). */
export interface TargetSizeShortfall {
  targetBytes: number;
  /** The smallest file this download can be at the lowest acceptable quality. */
  minBytes: number;
  /** The longest output that would fit the target (0: none). */
  maxDurationUs: Micros;
}

/** Bytes the disk route asked for, and the free space the browser reported. */
export interface StorageShortfall {
  requiredBytes: number;
  /** `navigator.storage.estimate()`: quota minus usage. */
  freeBytes: number;
  /**
   * `estimate`: the browser's own estimate was too small. `reservation`: the
   * estimate looked fine, but claiming the space on disk failed; the
   * estimate does not see the real disk (ADR-023). `file_reservation`: the
   * disk of the file picked in the save dialog refused the space (ADR-026);
   * no browser estimate is involved, `freeBytes` is 0.
   */
  reason: 'estimate' | 'reservation' | 'file_reservation';
}

export const TERMINAL_EXPORT_TYPES: ReadonlySet<ExportEvent['type']> = new Set([
  'succeeded',
  'failed',
  'canceled',
]);

/**
 * Tolerance for the produced duration (doc 22: "en çok bir çıktı karesi").
 * Muxers round the last sample's duration, so one frame is the budget.
 */
/**
 * Tolerance for a sound-only file (ADR-035): the AAC track is cut to the
 * exact sample (ADR-032), so one AAC frame (1024 samples) is already a fault.
 */
export function audioDurationWithinTolerance(expectedUs: Micros, actualUs: Micros, sampleRate: number): boolean {
  return Math.abs(actualUs - expectedUs) <= Math.ceil((1024 * 1_000_000) / sampleRate);
}

export function durationWithinTolerance(
  expectedUs: Micros,
  actualUs: Micros,
  fpsNum: number,
  fpsDen: number,
): boolean {
  const frameUs = (fpsDen * 1_000_000) / fpsNum;
  return Math.abs(actualUs - expectedUs) <= Math.ceil(frameUs) + 1;
}
