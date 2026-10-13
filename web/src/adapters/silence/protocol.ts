/**
 * Message contract between the page and the loudness worker (ADR-018).
 *
 * The user's `File` travels by structured clone and is read by the worker
 * through `BlobSource`: the audio is decoded locally, range by range, and
 * only the small loudness envelope (100 numbers per second) comes back.
 */

import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import type { Micros } from '@/domain/time';
import type { WorkerTestFault } from '../workerWatch';

export interface AnalysisRange {
  /** Caller's key for the range (the client uses the cache key). */
  key: string;
  startUs: Micros;
  endUs: Micros;
}

/**
 * Why no envelope could be measured. Never replaced by an empty result: an
 * empty envelope would read as "no silence found", which is a different,
 * false statement.
 */
export type AnalysisFailure = 'no_audio' | 'undecodable' | 'unreadable' | 'internal_error';

export type SilenceWorkerRequest =
  | {
      type: 'analyze';
      requestId: string;
      file: File;
      ranges: AnalysisRange[];
      /** Test builds only (`window.__clipWorkerFault`). Ignored in every other build. */
      testFault?: WorkerTestFault | null;
      /** Test builds only: something that cannot be copied to a worker, so the request cannot be sent. */
      unsendable?: unknown;
    }
  /** "Where are you?" — asked by the page when the analysis has stood still (ADR-042). */
  | { type: 'where'; requestId: string };

export type SilenceWorkerResponse =
  | { type: 'progress'; requestId: string; framesDone: number; framesTotal: number }
  | {
      type: 'envelope';
      requestId: string;
      key: string;
      startUs: Micros;
      frameUs: Micros;
      /** dBFS per frame; transferred, not copied. */
      db: Float32Array;
    }
  | { type: 'done'; requestId: string }
  /**
   * `detail`: only for a failure nobody planned for — where it broke and with
   * what kind of error (enums and counts, never the error's text; ADR-042).
   */
  | { type: 'failed'; requestId: string; reason: AnalysisFailure; detail?: ExportFailureDetail }
  /** The answer to `where`: the stage the analysis stands in. */
  | { type: 'where'; requestId: string; detail: ExportFailureDetail };
