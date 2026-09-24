'use client';

/**
 * UI-thread side of the encode worker.
 *
 * Owns exactly one worker, turns its messages into an async event stream, and
 * guarantees the worker is torn down when an attempt ends — including on
 * cancel, failure and page teardown.
 */

import type { ExportEvent } from '@/domain/exportEvents';
import type { HdrTransfer } from '@/domain/hdr';
import { TERMINAL_EXPORT_TYPES } from '@/domain/exportEvents';
import type { RenderPlan } from '@/domain/renderPlan';
import type { CapabilityStageResult, EncoderProbeConfig, WorkerRequest, WorkerResponse } from './protocol';

/** Stage C renders a tiny file, so this is generous but finite. */
const CAPABILITY_TIMEOUT_MS = 60_000;

/** Test hooks (see protocol): a finite, non-negative number, or nothing. */
function testHookBytes(name: '__clipStorageFreeBytes' | '__clipStorageReserveBytes'): number | null {
  const value = (globalThis as Record<string, unknown>)[name];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function createWorker(): Worker {
  return new Worker(new URL('./exportWorker.ts', import.meta.url), {
    type: 'module',
    name: 'clip-export',
  });
}

export class ExportWorkerClient {
  private worker: Worker | null = null;
  private counter = 0;

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
    options: { memoryRouteLimitUs: number },
  ): AsyncGenerator<ExportEvent, void, unknown> {
    const worker = this.ensureWorker();
    const requestId = this.nextId('exp');
    this.activeRequestId = requestId;

    const queue: ExportEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let failure: Error | null = null;

    const push = (event: ExportEvent) => {
      queue.push(event);
      if (TERMINAL_EXPORT_TYPES.has(event.type)) finished = true;
      notify?.();
    };

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type !== 'event' || data.requestId !== requestId) return;
      push(data.event);
    };
    const onError = () => {
      failure = new Error('worker_unavailable');
      finished = true;
      notify?.();
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

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
      // Test hook only (`window.__clipExportMode = 'encode'`): force the full
      // encode, e.g. to measure it against the fast cut. The app never sets it.
      mode: (globalThis as { __clipExportMode?: unknown }).__clipExportMode === 'encode' ? 'encode' : 'auto',
    };
    worker.postMessage(request);

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
      if (failure) {
        yield { type: 'failed', attemptId: requestId, code: 'worker_unavailable' };
      }
    } finally {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (this.activeRequestId === requestId) this.activeRequestId = null;
    }
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
