/**
 * Message contract between the UI thread and the encode worker.
 *
 * `File` objects travel by structured clone, so the worker reads the user's
 * file directly from disk through `BlobSource` — the bytes are never copied
 * into a message, into app state, or anywhere off the machine.
 */

import type { AnalysisPoint, EnhanceParams, EnhanceSummary } from '@/domain/enhance';
import type { ExportEvent, ExportFailureCode } from '@/domain/exportEvents';
import type { ExportMode } from '@/domain/fastPath';
import type { HdrTransfer } from '@/domain/hdr';
import type { RenderPlan } from '@/domain/renderPlan';
import type { TargetSizeRequest } from '@/domain/targetSize';
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

/** What the export writes: the video (default), or only its sound as an M4A file (ADR-035). */
export type ExportOutputKind = 'video' | 'audio';

/**
 * A download that must come out at or under a size (ADR-035). `plan` in the
 * request stays the ordinary plan; the worker runs the same planner the page
 * showed its estimate from (`planTargetSize`), with the encoder it really has,
 * and encodes at the size and bitrates that decides.
 */
export interface TargetSizeExport extends TargetSizeRequest {
  /** The largest short edge worth encoding (`maxTargetShortEdge`). */
  maxShortEdge: number;
  /**
   * Measurement hook only (`window.__clipExportOptions.forced`): encode at
   * exactly this size and these bitrates, once, whatever the file's size.
   * The app never sets it.
   */
  forced?: {
    shortEdge: number;
    videoBitrate: number;
    audioBitrate: number;
    bitrateMode?: 'constant' | 'variable';
  };
}

/**
 * ADR-037: what the frames of a video looked like, measured once and usable
 * for every strength. `key` says what was measured (`analysisKey`): the
 * worker only uses points whose key matches the plan it is given.
 */
export interface EnhanceAnalysis {
  key: string;
  points: AnalysisPoint[];
}

/** ADR-037: one real frame of the video before and after "İyileştir". */
export type EnhancePreviewResult =
  | {
      ok: true;
      /** The frame as the export draws it, and the same frame enhanced; both at the export's size. */
      before: ImageBitmap;
      after: ImageBitmap;
      width: number;
      height: number;
      /** The output frame that is shown. */
      frame: number;
      /** The measurements, to hand back with the next request or with the export. */
      analysis: EnhanceAnalysis;
      /** What the plan changes over the whole video. */
      summary: EnhanceSummary;
      /** What was applied to this frame. */
      params: EnhanceParams;
      engine: 'webgl2' | 'cpu';
      /** Whether a graphics card does the work (see `FrameEnhancer.accelerated`). */
      accelerated: boolean;
    }
  | { ok: false; reason: EnhancePreviewFailure };

export type EnhancePreviewFailure =
  | 'no_video_track'
  | 'source_undecodable'
  | 'hdr_source_unsupported'
  | 'no_frame'
  | 'not_enhanced'
  | 'canceled'
  | 'internal_error';

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
       * ADR-026: the file the user picked in the save dialog. The worker
       * writes straight into it (no OPFS copy, no second "save" step). Null:
       * the OPFS or memory route, then "Bilgisayara kaydet".
       */
      destination: FileSystemFileHandle | null;
      /**
       * `auto` (default): keep the source's pictures where the plan allows it
       * and re-encode only around the cuts (ADR-027). `encode`: always the full
       * encode. The result's `method` says which one ran.
       */
      mode?: ExportMode;
      /** `audio`: only the sound, as M4A (AAC in MP4); no picture is decoded. Default `video`. */
      output?: ExportOutputKind;
      /** Set for a target-size download; ignored for `output: 'audio'`. */
      targetSize?: TargetSizeExport | null;
      /**
       * ADR-037: measurements already made for this plan (by the wizard's
       * preview), so the export need not look at the video a second time.
       * Used only when its key matches; absent or stale, the export measures.
       */
      enhanceAnalysis?: EnhanceAnalysis | null;
      /**
       * Test/measurement hook only (`window.__clipEnhanceEngine = 'cpu'`):
       * enhance with the reference renderer even where the GPU path works.
       */
      enhanceEngine?: 'cpu' | null;
    }
  | {
      /** ADR-037: one frame of `plan` (which must ask for enhancement) before and after. Nothing is encoded. */
      type: 'enhancePreview';
      requestId: string;
      plan: RenderPlan;
      videoFile: File;
      /** The output frame to show. */
      frame: number;
      enhanceAnalysis?: EnhanceAnalysis | null;
      enhanceEngine?: 'cpu' | null;
    }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'capability'; requestId: string; result: CapabilityStageResult }
  /** ADR-037: the share of the frames looked at so far, while a preview is being prepared. */
  | { type: 'enhancePreviewProgress'; requestId: string; progress: number }
  | { type: 'enhancePreview'; requestId: string; result: EnhancePreviewResult }
  | { type: 'event'; requestId: string; event: ExportEvent };
