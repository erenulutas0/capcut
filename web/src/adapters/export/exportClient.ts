'use client';

/**
 * UI-thread side of the encode worker.
 *
 * Owns exactly one worker, turns its messages into an async event stream, and
 * guarantees the worker is torn down when an attempt ends — including on
 * cancel, failure and page teardown.
 */

import type { ExportEvent } from '@/domain/exportEvents';
import {
  pageSideFailureDetail,
  sanitizeExportFailureDetail,
  type ExportFailureDetail,
  type FailurePhase,
  type FailureVia,
} from '@/domain/exportFailureDetail';
import type { HdrTransfer } from '@/domain/hdr';
import { TERMINAL_EXPORT_TYPES } from '@/domain/exportEvents';
import type { RenderPlan } from '@/domain/renderPlan';
import { EXPORT_PROFILE_WORKER_SUFFIX } from './exportProfile';
import type {
  CapabilityStageResult,
  EncoderProbeConfig,
  EnhanceAnalysis,
  EnhancePreviewResult,
  ExportOutputKind,
  ExportTestFault,
  TargetSizeExport,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

/** Stage C renders a tiny file, so this is generous but finite. */
const CAPABILITY_TIMEOUT_MS = 60_000;

/** Test hooks (see protocol): a finite, non-negative number, or nothing. */
function testHookBytes(name: '__clipStorageFreeBytes' | '__clipStorageReserveBytes'): number | null {
  const value = (globalThis as Record<string, unknown>)[name];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Test/measurement hook only (`window.__clipEnhanceEngine = 'cpu'`, ADR-037):
 * enhance with the reference renderer even where the GPU path works. The app
 * never sets it.
 */
function enhanceEngineHook(): 'cpu' | null {
  return (globalThis as { __clipEnhanceEngine?: unknown }).__clipEnhanceEngine === 'cpu' ? 'cpu' : null;
}

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/**
 * Test builds only (`window.__clipExportFault`): the next export breaks on
 * purpose (see `ExportTestFault`). Taken once: the export after it is an
 * ordinary one, so a test can press download again and see it work.
 */
function takeTestFault(): ExportTestFault | null {
  if (!TEST_HOOKS) return null;
  const holder = globalThis as { __clipExportFault?: unknown };
  const value = holder.__clipExportFault;
  if (typeof value !== 'object' || value === null) return null;
  delete holder.__clipExportFault;
  const fault = value as Partial<ExportTestFault>;
  if ((fault.kind !== 'encode' && fault.kind !== 'crash') || typeof fault.atFrame !== 'number') return null;
  return {
    kind: fault.kind,
    atFrame: fault.atFrame,
    ...(typeof fault.errorName === 'string' ? { errorName: fault.errorName } : {}),
    ...(typeof fault.message === 'string' ? { message: fault.message } : {}),
  };
}

function createWorker(): Worker {
  // Test hook (`window.__clipExportProfile`, ADR-028): the measurement scripts
  // ask the worker for stage timings; nothing in the app sets it.
  const profile = (globalThis as { __clipExportProfile?: unknown }).__clipExportProfile === true;
  return new Worker(new URL('./exportWorker.ts', import.meta.url), {
    type: 'module',
    name: profile ? `clip-export${EXPORT_PROFILE_WORKER_SUFFIX}` : 'clip-export',
  });
}

export class ExportWorkerClient {
  private worker: Worker | null = null;
  private counter = 0;
  /** Downloads this client has started (a failure's detail says whether it was the first). */
  private exportsStarted = 0;

  private ensureWorker(): Worker {
    if (!this.worker) this.worker = createWorker();
    return this.worker;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.counter}`;
  }

  /**
   * Stage B + C. Rejects rather than guessing if the worker cannot start.
   *
   * The timeout is not belt-and-braces: a browser whose worker module fails to
   * load without firing `error` would otherwise leave the dialog stuck on
   * "checking" forever, which reads as a hang rather than an honest refusal.
   */
  async checkCapability(
    config: EncoderProbeConfig,
    options: { withCaptionFont: boolean; hdrTransfer?: HdrTransfer | null; timeoutMs?: number } = {
      withCaptionFont: false,
    },
  ): Promise<CapabilityStageResult> {
    const worker = this.ensureWorker();
    const requestId = this.nextId('cap');
    const timeoutMs = options.timeoutMs ?? CAPABILITY_TIMEOUT_MS;

    return new Promise<CapabilityStageResult>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.type !== 'capability' || data.requestId !== requestId) return;
        cleanup();
        resolve(data.result);
      };
      const onError = () => {
        cleanup();
        reject(new Error('worker_unavailable'));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const timer = window.setTimeout(() => {
        cleanup();
        // A worker that never answers is treated as unavailable, not as a pass.
        this.dispose();
        reject(new Error('worker_unavailable'));
      }, timeoutMs);

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const request: WorkerRequest = {
        type: 'capability',
        requestId,
        config,
        captionFontOrigin: options.withCaptionFont ? window.location.origin : null,
        hdrTransfer: options.hdrTransfer ?? null,
      };
      worker.postMessage(request);
    });
  }

  /**
   * Runs one export attempt. The returned iterable always ends with exactly one
   * terminal event (`succeeded`, `failed` or `canceled`).
   */
  async *export(
    plan: RenderPlan,
    videoFile: File,
    audioFile: File | null,
    options: {
      memoryRouteLimitUs: number;
      destination?: FileSystemFileHandle | null;
      /** ADR-035: `audio` writes only the sound, as M4A. */
      output?: ExportOutputKind;
      /** ADR-035: the file must come out at or under a size. */
      targetSize?: TargetSizeExport | null;
      /**
       * ADR-037: measurements of this video the page already has (from the
       * wizard's before/after preview); the export then does not look at the
       * video a second time. Ignored unless they were made for this very plan.
       */
      enhanceAnalysis?: EnhanceAnalysis | null;
    },
  ): AsyncGenerator<ExportEvent, void, unknown> {
    const worker = this.ensureWorker();
    const requestId = this.nextId('exp');
    this.activeRequestId = requestId;

    const queue: ExportEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    /** Set when the worker itself broke: its `error` event, or a message of it that could not be read. */
    let crashed: Exclude<FailureVia, 'exception'> | null = null;

    // What the page itself knows about the attempt, for a failure's detail:
    // how far it had come, whether the page was ever hidden, which attempt it was.
    const attemptInSession = this.exportsStarted;
    this.exportsStarted += 1;
    let lastPhase: FailurePhase = 'waiting';
    let framesDone: number | null = null;
    let totalFrames: number | null = null;
    let heardFromWorker = false;
    let wasHidden = typeof document !== 'undefined' && document.hidden;
    const onVisibility = () => {
      if (document.hidden) wasHidden = true;
    };
    /** The worker's detail (checked again field by field) with the page's part filled in. */
    const withPageSide = (detail: ExportFailureDetail): ExportFailureDetail => ({
      ...detail,
      phase: lastPhase,
      framesDone: detail.framesDone ?? framesDone,
      totalFrames: detail.totalFrames ?? totalFrames,
      pageWasHidden: wasHidden,
      attemptInSession,
    });

    const push = (event: ExportEvent) => {
      queue.push(event);
      if (TERMINAL_EXPORT_TYPES.has(event.type)) finished = true;
      notify?.();
    };

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type !== 'event' || data.requestId !== requestId) return;
      heardFromWorker = true;
      const received = data.event;
      if (received.type === 'failed') {
        const detail = sanitizeExportFailureDetail(received.detail);
        const { detail: _dropped, ...rest } = received;
        push(detail ? { ...rest, detail: withPageSide(detail) } : rest);
        return;
      }
      if (received.type === 'encoding') {
        framesDone = received.framesDone;
        totalFrames = received.totalFrames;
      }
      if (
        received.type === 'preparing' ||
        received.type === 'analysing' ||
        received.type === 'encoding' ||
        received.type === 'finalizing' ||
        received.type === 'verifying'
      ) {
        lastPhase = received.type;
      }
      push(received);
    };
    // The event's own text (message, script address, line) is not read: it is the browser's free text.
    const onError = () => {
      crashed ??= 'worker_error_event';
      finished = true;
      notify?.();
    };
    const onMessageError = () => {
      crashed ??= 'worker_message_error';
      finished = true;
      notify?.();
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

    const request: WorkerRequest = {
      type: 'export',
      requestId,
      plan,
      videoFile,
      audioFile,
      origin: window.location.origin,
      memoryRouteLimitUs: options.memoryRouteLimitUs,
      // Same pattern as `__clipSilenceEnvelopes`: an e2e test sets it before
      // the page loads; nothing in the app does.
      forceMemoryRoute: (globalThis as { __clipForceMemoryRoute?: unknown }).__clipForceMemoryRoute === true,
      storageFreeBytes: testHookBytes('__clipStorageFreeBytes'),
      storageReserveBytes: testHookBytes('__clipStorageReserveBytes'),
      destination: options.destination ?? null,
      // Test hook only (`window.__clipExportMode = 'encode'`): force the full
      // encode, e.g. to measure it against the fast cut. The app never sets it.
      mode: (globalThis as { __clipExportMode?: unknown }).__clipExportMode === 'encode' ? 'encode' : 'auto',
      output: options.output ?? 'video',
      targetSize: options.targetSize ?? null,
      enhanceAnalysis: options.enhanceAnalysis ?? null,
      enhanceEngine: enhanceEngineHook(),
      testFault: takeTestFault(),
    };
    /** The request could not be handed over (it could not be copied to the worker): the error, to name it. */
    let unsent: { error: unknown } | null = null;
    try {
      worker.postMessage(request);
    } catch (error) {
      // Without this the download would sit at "waiting" for ever: nothing was sent, so nothing answers.
      unsent = { error };
      finished = true;
    }

    try {
      while (true) {
        if (queue.length === 0) {
          if (finished) break;
          await new Promise<void>((resolve) => {
            notify = () => {
              notify = null;
              resolve();
            };
          });
          continue;
        }
        const event = queue.shift();
        if (!event) continue;
        yield event;
        if (TERMINAL_EXPORT_TYPES.has(event.type)) return;
      }
      if (unsent) {
        yield {
          type: 'failed',
          attemptId: requestId,
          code: 'internal_error',
          detail: withPageSide(pageSideFailureDetail('request_not_sent', unsent.error)),
        };
      } else if (crashed) {
        // The worker broke under a running export. What it was doing is not
        // known any more and it may still be writing: it is stopped here, so
        // nothing goes on behind a download the page has called failed (the
        // next download starts a fresh one).
        if (this.worker === worker) this.dispose();
        else worker.terminate();
        yield {
          type: 'failed',
          attemptId: requestId,
          // "Could not be started" only when it never said a word; a worker
          // that was already working and then broke is an unexpected error.
          code: heardFromWorker ? 'internal_error' : 'worker_unavailable',
          detail: withPageSide(pageSideFailureDetail(crashed)),
        };
      }
    } finally {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (this.activeRequestId === requestId) this.activeRequestId = null;
    }
  }

  /**
   * ADR-037: one real frame of `plan` before and after "İyileştir", made by
   * the export's own code in the worker. Nothing is encoded. Resolves with
   * `{ ok: false, reason: 'canceled' }` when `cancel()` was called meanwhile.
   */
  enhancePreview(
    plan: RenderPlan,
    videoFile: File,
    frame: number,
    options: { analysis?: EnhanceAnalysis | null; onProgress?: (share: number) => void } = {},
  ): Promise<EnhancePreviewResult> {
    const worker = this.ensureWorker();
    const requestId = this.nextId('enh');
    this.activeRequestId = requestId;
    return new Promise<EnhancePreviewResult>((resolve) => {
      const done = (result: EnhancePreviewResult) => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (this.activeRequestId === requestId) this.activeRequestId = null;
        resolve(result);
      };
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.requestId !== requestId) return;
        if (data.type === 'enhancePreviewProgress') options.onProgress?.(data.progress);
        else if (data.type === 'enhancePreview') done(data.result);
      };
      const onError = () => done({ ok: false, reason: 'internal_error' });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const request: WorkerRequest = {
        type: 'enhancePreview',
        requestId,
        plan,
        videoFile,
        frame,
        enhanceAnalysis: options.analysis ?? null,
        enhanceEngine: enhanceEngineHook(),
      };
      worker.postMessage(request);
    });
  }

  private activeRequestId: string | null = null;

  cancel(): void {
    if (!this.worker || !this.activeRequestId) return;
    const request: WorkerRequest = { type: 'cancel', requestId: this.activeRequestId };
    this.worker.postMessage(request);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.activeRequestId = null;
  }
}
