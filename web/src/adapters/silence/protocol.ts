/**
 * Message contract between the page and the loudness worker (ADR-018).
 *
 * The user's `File` travels by structured clone and is read by the worker
 * through `BlobSource`: the audio is decoded locally, range by range, and
 * only the small loudness envelope (100 numbers per second) comes back.
 */

import type { Micros } from '@/domain/time';

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

export type SilenceWorkerRequest = {
  type: 'analyze';
  requestId: string;
  file: File;
  ranges: AnalysisRange[];
};

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
  | { type: 'failed'; requestId: string; reason: AnalysisFailure };
