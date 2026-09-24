/**
 * Message contract between the UI thread and the encode worker.
 *
 * `File` objects travel by structured clone, so the worker reads the user's
 * file directly from disk through `BlobSource` — the bytes are never copied
 * into a message, into app state, or anywhere off the machine.
 */

import type { ExportEvent, ExportFailureCode } from '@/domain/exportEvents';
import type { ExportMode } from '@/domain/fastPath';
import type { HdrTransfer } from '@/domain/hdr';
import type { RenderPlan } from '@/domain/renderPlan';
import type { HdrToneMapStatus } from './hdrProbe';

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
  /**
   * Whether this browser's own HDR -> SDR conversion, drawn through the same
   * call the export uses, came back correct (ADR-022). `null` when the source
   * is not HDR and nothing was tried.
   */
  hdrToneMap: HdrToneMapStatus | null;
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
      /** The source's HDR transfer, when it has one: the tone-mapping check to run. */
      hdrTransfer: HdrTransfer | null;
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
      /** Doc 15 v3: the longest output the memory (non-OPFS) route may produce. */
      memoryRouteLimitUs: number;
      /**
       * Test hook only (`window.__clipForceMemoryRoute`): behave like a browser
       * without OPFS sync access, so the memory-route limit is testable.
       */
      forceMemoryRoute: boolean;
      /**
       * Test hook only (`window.__clipStorageFreeBytes`): the free space the
       * storage estimate should report. Chromium's quota override (CDP) does
       * not reach the estimate in Playwright's browser, so a test cannot
       * shrink the real quota. `null` in the app.
       */
      storageFreeBytes: number | null;
      /**
       * Test hook only (`window.__clipStorageReserveBytes`): claim this much
       * up front instead of the estimate, so a test with a small quota (CDP
       * override) can see the disk run out mid-file. `null` in the app.
       */
      storageReserveBytes: number | null;
      /**
       * `auto` (default): keep the source's pictures where the plan allows it
       * and re-encode only around the cuts (ADR-027). `encode`: always the full
       * encode. The result's `method` says which one ran.
       */
      mode?: ExportMode;
    }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'capability'; requestId: string; result: CapabilityStageResult }
  | { type: 'event'; requestId: string; event: ExportEvent };
