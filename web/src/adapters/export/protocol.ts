/**
 * Message contract between the UI thread and the encode worker.
 *
 * `File` objects travel by structured clone, so the worker reads the user's
 * file directly from disk through `BlobSource` — the bytes are never copied
 * into a message, into app state, or anywhere off the machine.
 */

import type { AnalysisPoint, EnhanceParams, EnhanceSummary } from '@/domain/enhance';
import type { ExportEvent, ExportFailureCode } from '@/domain/exportEvents';
import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import type { WorkerTestFault } from '../workerWatch';
import type { ExportMode, FastCutFallbackReason } from '@/domain/fastPath';
import type { SoundFixSettings } from '@/domain/soundFix';
import type { GifTexts } from '@/domain/gif';
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
  /**
   * False when the download has no sound at all ("Sesi kapat": every part
   * muted, no music). The audio encoder is then neither required nor used, so
   * a browser without one (Firefox has no AAC encoder, 13 Oct 2026) is not
   * refused for something the file does not contain. Absent means required.
   */
  audioRequired?: boolean;
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
  /** What the check was asked (see `EncoderProbeConfig.audioRequired`); absent means required. */
  audioRequired?: boolean;
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
  /** The ordinary download's own short edge (`planShortEdge`, ADR-041): the planner's first rung. */
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

/**
 * Test builds only (`CLIP_TEST_HOOKS=1`, never the published site): break one
 * export on purpose, so a test can prove what a failure reports — and that the
 * error's own text goes nowhere.
 *
 * - `encode`: handing frame `atFrame` to the encoder throws a DOMException
 *   named `errorName` with `message` as its text;
 * - `crash`: at frame `atFrame` an error is thrown outside every handler, so
 *   the worker's `error` event fires on the page;
 * - `stall`: at frame `atFrame` the export waits for something that never
 *   comes — no error, no progress (what a dead graphics process looks like).
 */
export interface ExportTestFault {
  kind: 'encode' | 'crash' | 'stall';
  atFrame: number;
  errorName?: string;
  message?: string;
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
  /**
   * `detail`: only for a failure nobody planned for (`internal_error`) — where it broke and with
   * what kind of error; enums and counts, never the error's text (ADR-042).
   */
  | { ok: false; reason: EnhancePreviewFailure; detail?: ExportFailureDetail };

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
       * ADR-049 ("Sesi düzelt"): the sound of the download goes through the
       * loudness chain with these measured gains (`domain/soundFix.ts`). Used
       * only when made for the worker's own chain version (`usableSettings`).
       */
      soundFix?: SoundFixSettings | null;
      /**
       * Test/measurement hook only (`window.__clipEnhanceEngine = 'cpu'`):
       * enhance with the reference renderer even where the GPU path works.
       */
      enhanceEngine?: 'cpu' | null;
      /**
       * Measurement hook only (`window.__clipBitrateMode`, ADR-045): the rate
       * control an ordinary download asks for instead of the app's own choice
       * (`ORDINARY_BITRATE_MODE`), so the two can be compared on the same edit.
       * Ignored for a target-size download. The app never sets it.
       */
      bitrateMode?: 'constant' | 'variable' | null;
      /**
       * Test builds only (`window.__clipRefuseConstantBitrate = true`, ADR-045):
       * the worker answers its own "can this encoder do `constant`?" with no,
       * as a browser without constant rate control would. Ignored in every
       * other build.
       */
      refuseConstantBitrate?: boolean;
      /**
       * Measurement hook only (`window.__clipOutputLimitBytes`, 17 Oct 2026): a
       * SMALLER largest-download size than `OUTPUT_FILE_LIMIT_BYTES` (4 GiB − 1
       * byte), so that a short output is held, and stopped, the way a long one
       * is. It can only lower the limit. The app never sets it.
       */
      outputLimitBytes?: number | null;
      /** Test builds only (`window.__clipExportFault`): see `ExportTestFault`. Ignored in every other build. */
      testFault?: ExportTestFault | null;
      /**
       * ADR-052 ("GIF yap" → "Video olarak (en net)"): the top and bottom text of the GIF, drawn on every
       * frame exactly the GIF's way (`layoutGifText` at the output's size, the caption typeface). The
       * pictures are then always encoded (no fast cut). Absent or empty: no text.
       */
      overlayText?: GifTexts | null;
      /**
       * ADR-052: the "GIF yap" card's video — always encoded, at the plan's own bitrate on every encoder
       * (not the software encoder's 3×). Ignored with a target size and for sound only.
       */
      planBitrateOnly?: boolean;
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
      /** Test builds only (`window.__clipWorkerFault`, see `workerWatch.ts`). Ignored in every other build. */
      testFault?: WorkerTestFault | null;
      /** Test builds only: something that cannot be copied to a worker, so the request cannot be sent. */
      unsendable?: unknown;
    }
  | {
      /**
       * ADR-049: would a download of `plan` keep the source's pictures (the fast cut's copy, ADR-027)?
       * The same checks the export makes before an output exists; nothing is decoded, encoded or written.
       * So a screen says "görüntüye dokunulmaz" only where it is true.
       */
      type: 'copyCheck';
      requestId: string;
      plan: RenderPlan;
      videoFile: File;
    }
  | { type: 'cancel'; requestId: string }
  /**
   * "Where are you?" — asked by the page when an export has stood still (it
   * is about to stop the worker): the worker answers with what it knows.
   */
  | { type: 'where'; requestId: string };

export type WorkerResponse =
  | { type: 'capability'; requestId: string; result: CapabilityStageResult }
  /** ADR-037: the share of the frames looked at so far, while a preview is being prepared. */
  | { type: 'enhancePreviewProgress'; requestId: string; progress: number }
  | { type: 'enhancePreview'; requestId: string; result: EnhancePreviewResult }
  | { type: 'event'; requestId: string; event: ExportEvent }
  /** ADR-049: `copy` when the pictures would be copied; else why not (null: the check itself failed). */
  | { type: 'copyCheck'; requestId: string; copy: boolean; reason: FastCutFallbackReason | null }
  /** The answer to `where`: stage, frame count and codecs of the running export (no error: nothing was thrown). */
  | { type: 'where'; requestId: string; detail: ExportFailureDetail };
