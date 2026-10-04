'use client';

/**
 * Page side of the transcript worker (ADR-036): one worker, one job at a
 * time (a model download or a transcription). Cancel terminates the worker;
 * a decode or a model call in flight cannot be interrupted any other way.
 */

import type { TranscriptSegment } from '@/domain/transcript';
import { MODEL_MANIFEST, isModelManifest, type ModelManifest, type TranscriptModelId } from '@/domain/transcriptModels';
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

export type ModelDownloadOutcome =
  | { ok: true }
  | { ok: false; reason: DownloadFailure | 'worker_unavailable' | 'canceled' };

export type TranscribeOutcome =
  | { ok: true; segments: TranscriptSegment[]; stats: TranscribeStats }
  | { ok: false; reason: TranscribeFailure | 'worker_unavailable' | 'canceled' };

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

function createWorker(): Worker {
  return new Worker(new URL('./transcriptWorker.ts', import.meta.url), { type: 'module', name: 'clip-transcript' });
}

export class TranscriptClient {
  private worker: Worker | null = null;
  private counter = 0;
  private stopActive: (() => void) | null = null;

  private run<T>(
    build: (requestId: string) => TranscriptWorkerRequest,
    onMessage: (data: TranscriptWorkerResponse, finish: (value: T) => void) => void,
    unavailable: T,
    canceled: T,
  ): Promise<T> {
    this.cancel();
    let worker: Worker;
    try {
      worker = createWorker();
      this.worker = worker;
    } catch {
      return Promise.resolve(unavailable);
    }
    this.counter += 1;
    const requestId = `tr_${Date.now().toString(36)}_${this.counter}`;
    return new Promise<T>((resolve) => {
      let settled = false;
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        this.stopActive = null;
        // One job per worker: the model's memory goes back with it.
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        resolve(value);
      };
      worker.addEventListener('message', (event: MessageEvent<TranscriptWorkerResponse>) => {
        if (event.data.requestId === requestId) onMessage(event.data, finish);
      });
      worker.addEventListener('error', () => finish(unavailable));
      this.stopActive = () => finish(canceled);
      worker.postMessage(build(requestId));
    });
  }

  /** Fetches and checks the files `model` still lacks. Stored parts survive a cancel. */
  download(model: TranscriptModelId, onProgress: (progress: DownloadProgress) => void): Promise<ModelDownloadOutcome> {
    const test = transcriptTestOptions();
    return this.run<ModelDownloadOutcome>(
      (requestId) => ({ type: 'download', requestId, model, ...(test ? { test } : {}) }),
      (data, finish) => {
        if (data.type === 'download-progress') {
          onProgress({ bytesDone: data.bytesDone, bytesTotal: data.bytesTotal, phase: data.phase });
        } else if (data.type === 'download-done') {
          finish({ ok: true });
        } else if (data.type === 'download-failed') {
          finish({ ok: false, reason: data.reason });
        }
      },
      { ok: false, reason: 'worker_unavailable' },
      { ok: false, reason: 'canceled' },
    );
  }

  /** Turns the video's sound into timed text, on this device. Nothing is kept from a cancelled run. */
  transcribe(
    file: File,
    model: TranscriptModelId,
    onProgress: (progress: TranscribeProgress) => void,
  ): Promise<TranscribeOutcome> {
    const test = transcriptTestOptions();
    const segments: TranscriptSegment[] = [];
    return this.run<TranscribeOutcome>(
      (requestId) => ({ type: 'transcribe', requestId, model, file, ...(test ? { test } : {}) }),
      (data, finish) => {
        if (data.type === 'progress') {
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
          finish({ ok: false, reason: data.reason });
        }
      },
      { ok: false, reason: 'worker_unavailable' },
      { ok: false, reason: 'canceled' },
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

/** WebGPU with half-precision shaders — the only place the large model is offered. */
export async function supportsLargeModel(): Promise<boolean> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter?.features.has('shader-f16'));
  } catch {
    return false;
  }
}
