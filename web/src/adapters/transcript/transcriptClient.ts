'use client';

/**
 * Page side of the transcript worker (ADR-036): one worker, one job at a
 * time (a model download or a transcription). Cancel terminates the worker;
 * a decode or a model call in flight cannot be interrupted any other way.
 */

import { classifyDevice, type DeviceClass, type UserAgentHints } from '@/domain/deviceClass';
import { sanitizeExportFailureDetail, type ExportFailureDetail, type FailurePhase } from '@/domain/exportFailureDetail';
import type { TranscriptSegment } from '@/domain/transcript';
import { MODEL_MANIFEST, isModelManifest, type ModelManifest, type TranscriptModelId } from '@/domain/transcriptModels';
import type { EngineProbe } from '@/domain/transcriptSettings';
import { STALL_LIMITS_MS, gaveUpCode, takeWorkerFault, unsendable, unsentDetail, watchWorker, type GaveUpVia, type WatchedWorker } from '../workerWatch';
import type { DownloadFailure, DownloadProgress } from './modelStore';
import type {
  TranscribeFailure,
  TranscribeProgress,
  TranscribeStats,
  TranscriptTestOptions,
  TranscriptWorkerRequest,
  TranscriptWorkerResponse,
} from './protocol';

export type { DownloadFailure, DownloadProgress } from './modelStore';
export type { TranscribeFailure, TranscribeProgress, TranscribeStats } from './protocol';

/**
 * `stalled`: nothing arrived for longer than a download may be silent (the
 * stored parts are kept). `internal_error`: the worker broke while working.
 * `detail`: where and with what kind of error, for a failure nobody planned
 * for (ADR-042) — enums and counts, never the error's text.
 */
export type ModelDownloadOutcome =
  | { ok: true }
  | { ok: false; reason: DownloadFailure | 'worker_unavailable' | 'internal_error' | 'stalled' | 'canceled'; detail?: ExportFailureDetail };

export type TranscribeOutcome =
  | { ok: true; segments: TranscriptSegment[]; stats: TranscribeStats }
  | { ok: false; reason: TranscribeFailure | 'worker_unavailable' | 'canceled'; detail?: ExportFailureDetail };

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/**
 * Test builds only: what an e2e test put on the page before it loaded (a tiny
 * model list it serves itself, a scripted stand-in recogniser). In an
 * ordinary build this is always undefined and the code behind it is removed.
 */
export function transcriptTestOptions(): TranscriptTestOptions | undefined {
  if (!TEST_HOOKS) return undefined;
  const hook = (globalThis as { __clipTranscriptTest?: TranscriptTestOptions }).__clipTranscriptTest;
  return hook && typeof hook === 'object' ? hook : undefined;
}

/** The model list in force: the pinned one, except under a test's own list. */
export function activeManifest(): ModelManifest {
  const test = transcriptTestOptions();
  return test?.manifest && isModelManifest(test.manifest) ? test.manifest : MODEL_MANIFEST;
}

/**
 * Measurement instrumentation, inert in normal use: a measuring script that
 * has defined the `__clipTranscriptRuns` array before the page loads may
 * also define `__clipTranscriptProbe` to run the recogniser with an older
 * named set of settings (the "before" column of a before/after table) or to
 * get back what the guard saw. Without the runs array this is never read:
 * the app itself always runs the shipped settings.
 */
function measuringProbe(): EngineProbe | undefined {
  const scope = globalThis as { __clipTranscriptRuns?: unknown; __clipTranscriptProbe?: unknown };
  if (!Array.isArray(scope.__clipTranscriptRuns)) return undefined;
  const probe = scope.__clipTranscriptProbe;
  return typeof probe === 'object' && probe !== null ? (probe as EngineProbe) : undefined;
}

function createWorker(): Worker {
  return new Worker(new URL('./transcriptWorker.ts', import.meta.url), { type: 'module', name: 'clip-transcript' });
}

export class TranscriptClient {
  private worker: Worker | null = null;
  private counter = 0;
  private stopActive: (() => void) | null = null;

  /**
   * One job in a worker of its own. It always ends: with the worker's answer,
   * with a cancel (the worker is stopped at once), or — when the worker
   * breaks, cannot be read, cannot be given the request, or says nothing for
   * longer than its step allows (`limitMs`, counted only while the page is
   * visible) — with `gaveUp`.
   */
  private run<T>(
    kind: WatchedWorker,
    build: (requestId: string) => TranscriptWorkerRequest,
    onMessage: (data: TranscriptWorkerResponse, finish: (value: T) => void, side: (detail: unknown) => ExportFailureDetail | undefined) => void,
    ends: {
      canceled: T;
      /** The worker could not be created at all. */
      unavailable: T;
      gaveUp: (via: GaveUpVia | 'request_not_sent', heard: boolean, detail: ExportFailureDetail) => T;
    },
    watching: { limitMs: () => number | null; phase: () => FailurePhase },
  ): Promise<T> {
    this.cancel();
    let worker: Worker;
    try {
      worker = createWorker();
      this.worker = worker;
    } catch {
      return Promise.resolve(ends.unavailable);
    }
    this.counter += 1;
    const requestId = `tr_${Date.now().toString(36)}_${this.counter}`;
    return new Promise<T>((resolve) => {
      let settled = false;
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        watch.stop();
        this.stopActive = null;
        // One job per worker: the model's memory goes back with it.
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        resolve(value);
      };
      const watch = watchWorker(worker, {
        limitMs: watching.limitMs,
        askWhere: () => {
          const where: TranscriptWorkerRequest = { type: 'where', requestId };
          worker.postMessage(where);
        },
        onGiveUp: (via, detail) => {
          const heard = watch.hasHeard();
          finish(ends.gaveUp(via, heard, watch.pageSide(detail, heard ? watching.phase() : 'waiting')));
        },
      });
      const side = (raw: unknown): ExportFailureDetail | undefined => {
        const detail = sanitizeExportFailureDetail(raw);
        return detail ? watch.pageSide(detail, watching.phase()) : undefined;
      };
      worker.addEventListener('message', (event: MessageEvent<TranscriptWorkerResponse>) => {
        const data = event.data;
        if (data.requestId !== requestId) return;
        if (data.type === 'where') {
          watch.answer(data.detail);
          return;
        }
        watch.heard();
        onMessage(data, finish, side);
      });
      this.stopActive = () => finish(ends.canceled);
      try {
        const fault = takeWorkerFault(kind);
        const request = build(requestId);
        if (fault && request.type !== 'where') {
          if (fault.kind === 'unsendable') request.unsendable = unsendable();
          else request.testFault = fault;
        }
        worker.postMessage(request);
      } catch (error) {
        // Nothing was sent, so nothing would ever answer.
        finish(ends.gaveUp('request_not_sent', false, unsentDetail(error)));
      }
    });
  }

  /** Fetches and checks the files `model` still lacks. Stored parts survive a cancel. */
  download(model: TranscriptModelId, onProgress: (progress: DownloadProgress) => void): Promise<ModelDownloadOutcome> {
    const test = transcriptTestOptions();
    let phase: FailurePhase = 'downloading';
    return this.run<ModelDownloadOutcome>(
      'model_download',
      (requestId) => ({ type: 'download', requestId, model, ...(test ? { test } : {}) }),
      (data, finish, side) => {
        if (data.type === 'download-progress') {
          phase = data.phase;
          onProgress({ bytesDone: data.bytesDone, bytesTotal: data.bytesTotal, phase: data.phase });
        } else if (data.type === 'download-done') {
          finish({ ok: true });
        } else if (data.type === 'download-failed') {
          const detail = side(data.detail);
          finish({ ok: false, reason: data.reason, ...(detail ? { detail } : {}) });
        }
      },
      {
        canceled: { ok: false, reason: 'canceled' },
        unavailable: { ok: false, reason: 'worker_unavailable' },
        gaveUp: (via, heard, detail) => ({
          ok: false,
          reason: via === 'stalled' ? 'stalled' : via === 'request_not_sent' ? 'internal_error' : gaveUpCode(via, heard),
          detail,
        }),
      },
      { limitMs: () => STALL_LIMITS_MS.modelDownload, phase: () => phase },
    );
  }

  /** Turns the video's sound into timed text, on this device. Nothing is kept from a cancelled run. */
  transcribe(
    file: File,
    model: TranscriptModelId,
    onProgress: (progress: TranscribeProgress) => void,
  ): Promise<TranscribeOutcome> {
    const test = transcriptTestOptions();
    const probe = measuringProbe();
    const segments: TranscriptSegment[] = [];
    /** The step the worker last reported: it decides how long a silence is still normal. */
    let step: 'opening' | 'loading' | 'listening' | 'writing' = 'opening';
    return this.run<TranscribeOutcome>(
      'transcript',
      (requestId) => ({ type: 'transcribe', requestId, model, file, ...(test ? { test } : {}), ...(probe ? { probe } : {}) }),
      (data, finish, side) => {
        if (data.type === 'progress') {
          step = data.progress.phase;
          onProgress(data.progress);
        } else if (data.type === 'segment') {
          segments.push(data.segment);
        } else if (data.type === 'done') {
          // Measurement instrumentation, inert in normal use (the pattern of
          // `__clipSilenceEnvelopes`): a measuring script defines this array
          // before the page loads to read the raw word times of a run.
          const probe = (globalThis as { __clipTranscriptRuns?: unknown }).__clipTranscriptRuns;
          if (Array.isArray(probe)) probe.push({ fileName: file.name, segments, stats: data.stats });
          finish({ ok: true, segments, stats: data.stats });
        } else if (data.type === 'failed') {
          const detail = side(data.detail);
          finish({ ok: false, reason: data.reason, ...(detail ? { detail } : {}) });
        }
      },
      {
        canceled: { ok: false, reason: 'canceled' },
        unavailable: { ok: false, reason: 'worker_unavailable' },
        gaveUp: (via, heard, detail) => ({
          ok: false,
          reason: via === 'stalled' || via === 'request_not_sent' ? 'internal_error' : gaveUpCode(via, heard),
          detail,
        }),
      },
      {
        // Before the first message the worker only opens the file's sound: the listening limit.
        limitMs: () =>
          step === 'loading'
            ? STALL_LIMITS_MS.transcribeLoading
            : step === 'writing'
              ? STALL_LIMITS_MS.transcribeWriting
              : STALL_LIMITS_MS.transcribeListening,
        phase: () => (step === 'opening' ? 'preparing' : step),
      },
    );
  }

  /** Stops the running job at once. */
  cancel(): void {
    this.stopActive?.();
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}

/**
 * Phone or computer, Chromium or not (`domain/deviceClass.ts`): decides only
 * whether the large model is the recommendation here. Read from `navigator`,
 * kept nowhere.
 */
export function currentDevice(): DeviceClass {
  try {
    const nav = navigator as Navigator & { userAgentData?: UserAgentHints['data'] };
    return classifyDevice({ userAgent: nav.userAgent, data: nav.userAgentData ?? null });
  } catch {
    return classifyDevice({ userAgent: '' });
  }
}

/** WebGPU with half-precision shaders — the only place the large model is offered. */
export async function supportsLargeModel(): Promise<boolean> {
  const forced = transcriptTestOptions()?.largeModel;
  if (typeof forced === 'boolean') return forced;
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter?.features.has('shader-f16'));
  } catch {
    return false;
  }
}
