/**
 * Message contract between the UI thread and the encode worker.
 *
 * `File` objects travel by structured clone, so the worker reads the user's
 * file directly from disk through `BlobSource` — the bytes are never copied
 * into a message, into app state, or anywhere off the machine.
 */

import type { ExportEvent, ExportFailureCode } from '@/domain/exportEvents';
import type { RenderPlan } from '@/domain/renderPlan';

export interface EncoderProbeConfig {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  sampleRate: number;
  channelCount: number;
  audioBitrate: number;
}

/** Stage B + Stage C of the capability gate in doc 11. */
export interface CapabilityStageResult {
  /** Stage B: the browser says the exact target configuration is supported. */
  videoConfigSupported: boolean;
  audioConfigSupported: boolean;
  /** Stage C: a tiny synthetic file was really encoded, muxed and re-opened. */
  selfTestPassed: boolean;
  selfTestDurationUs: number | null;
  selfTestHasAudio: boolean;
  failure: ExportFailureCode | null;
}

export type WorkerRequest =
  | { type: 'capability'; requestId: string; config: EncoderProbeConfig }
  | {
      type: 'export';
      requestId: string;
      plan: RenderPlan;
      videoFile: File;
      audioFile: File | null;
    }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'capability'; requestId: string; result: CapabilityStageResult }
  | { type: 'event'; requestId: string; event: ExportEvent };
