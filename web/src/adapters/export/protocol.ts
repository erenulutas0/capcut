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
  /**
   * Whether the caption typeface really loaded inside the worker, the place
   * that draws it. `null` when the plan has no captions and nothing was tried.
   * `api_missing`: the worker has no FontFace / `self.fonts` at all.
   */
  captionFont: CaptionFontStatus | null;
  failure: ExportFailureCode | null;
}

export type CaptionFontStatus = 'loaded' | 'api_missing' | 'load_failed';

export type WorkerRequest =
  | {
      type: 'capability';
      requestId: string;
      config: EncoderProbeConfig;
      /** Page origin to load the caption font from; null when the plan has no captions. */
      captionFontOrigin: string | null;
    }
  | {
      type: 'export';
      requestId: string;
      plan: RenderPlan;
      videoFile: File;
      audioFile: File | null;
      /**
       * The page origin (`location.origin`), passed explicitly: the caption font
       * is fetched by absolute URL so it does not depend on how the bundler
       * happened to load the worker script (module URL, blob URL, CDN).
       */
      origin: string;
    }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'capability'; requestId: string; result: CapabilityStageResult }
  | { type: 'event'; requestId: string; event: ExportEvent };
