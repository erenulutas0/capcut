/**
 * Message contract between the page and the GIF worker (ADR-046).
 *
 * The user's `File` travels by structured clone and is read by the worker
 * through `BlobSource`; only the finished GIF's bytes (transferred, not
 * copied) and small numbers come back. Nothing leaves the device.
 */

import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import type { GifRange, GifSizeId, GifTexts } from '@/domain/gif';
import type { WorkerTestFault } from '../workerWatch';

/**
 * Why no GIF was made, as codes the download card already has words for
 * (`export.fail.<code>`), except `text_font_unavailable` (`gif.fail.font`).
 */
export type GifFailure =
  | 'no_video_track'
  | 'source_undecodable'
  | 'source_incomplete'
  | 'hdr_source_unsupported'
  | 'no_frames_decoded'
  | 'source_frames_missing'
  | 'text_font_unavailable'
  | 'out_of_memory'
  | 'internal_error';

export interface GifJob {
  file: File;
  range: GifRange;
  size: GifSizeId;
  texts: GifTexts;
  /** The page's origin, for the bundled font's address. */
  origin: string;
}

export type GifWorkerRequest =
  | ({
      type: 'make';
      requestId: string;
      testFault?: WorkerTestFault | null;
      unsendable?: unknown;
      /** Test builds only: the frames budget instead of `GIF_HELD_FRAMES_MAX_BYTES` (0: always two passes). */
      testHeldFramesBytes?: number;
    } & GifJob)
  | ({
      type: 'estimate';
      requestId: string;
      /**
       * ADR-052: the sizes to measure, from one decode where their frames fit the budget together (absent: `size`
       * alone). Each is answered with its own `estimated`, largest first, then `estimateDone`.
       */
      sizes?: GifSizeId[];
      testFault?: WorkerTestFault | null;
      unsendable?: unknown;
      /** Test builds only: the frames budget the sizes are grouped by. */
      testHeldFramesBytes?: number;
    } & GifJob)
  /** "Where are you?" — asked by the page when the job has stood still (ADR-042). */
  | { type: 'where'; requestId: string };

/** What a few frames encoded the GIF's way weigh (`domain/gif.ts` `estimateGifBytes`). */
export interface GifSample {
  firstFrameBytes: number;
  laterFrameBytes: number;
}

export type GifWorkerResponse =
  /**
   * `step`: decoding the part (`frames`) or writing the GIF (`encoding`); `done` of `total` in that step.
   * `passes`: 2 when the part is decoded once more while the GIF is written (its frames were not held).
   */
  | { type: 'progress'; requestId: string; step: 'frames' | 'encoding'; done: number; total: number; passes?: 1 | 2 }
  | { type: 'estimated'; requestId: string; size: GifSizeId; width: number; height: number; frames: number; sample: GifSample }
  /** Every size asked for was answered. */
  | { type: 'estimateDone'; requestId: string }
  | {
      type: 'made';
      requestId: string;
      /** The GIF file; transferred. */
      bytes: ArrayBuffer;
      width: number;
      height: number;
      frames: number;
      /** Frames whose moment the decoder did not deliver (the one before was held); counted, never hidden. */
      framesMissing: number;
      elapsedMs: number;
    }
  | { type: 'failed'; requestId: string; reason: GifFailure; detail?: ExportFailureDetail }
  /** The answer to `where`: the stage the job stands in. */
  | { type: 'where'; requestId: string; detail: ExportFailureDetail };
