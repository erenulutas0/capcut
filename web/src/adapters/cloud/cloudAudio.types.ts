/** Message contract between the page and the cloud-audio worker (ADR-039). */

import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import type { WorkerTestFault } from '../workerWatch';

export type CloudAudioFailure =
  /** The video has no sound track (or an empty one). */
  | 'no_audio'
  | 'undecodable'
  | 'unreadable'
  /** This browser has neither an Opus nor an AAC encoder. */
  | 'encoder_unavailable'
  | 'internal_error';

export type CloudAudioRequest =
  | {
      type: 'extract';
      requestId: string;
      file: File;
      /** Test builds only (`CLIP_TEST_HOOKS=1`): use this encoder or fail. Ignored in every other build. */
      testCodec?: 'opus' | 'aac' | 'none';
      /** Test builds only (`window.__clipWorkerFault`). Ignored in every other build. */
      testFault?: WorkerTestFault | null;
      /** Test builds only: something that cannot be copied to a worker, so the request cannot be sent. */
      unsendable?: unknown;
    }
  /** "Where are you?" — asked by the page when the work has stood still (ADR-042). */
  | { type: 'where'; requestId: string };

export type CloudAudioResponse =
  /** Seconds of the video's sound encoded so far, of its length. */
  | { type: 'progress'; requestId: string; doneS: number; totalS: number }
  | { type: 'done'; requestId: string; buffer: ArrayBuffer; mime: 'audio/webm' | 'audio/mp4'; codec: 'opus' | 'aac'; durationS: number }
  /** `detail`: only for a failure nobody planned for — enums and counts, never the error's text (ADR-042). */
  | { type: 'failed'; requestId: string; reason: CloudAudioFailure; detail?: ExportFailureDetail }
  /** The answer to `where`: the stage the work stands in. */
  | { type: 'where'; requestId: string; detail: ExportFailureDetail };
