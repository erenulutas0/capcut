'use client';

/**
 * Page side of the GIF worker (ADR-046), watched like every other worker
 * (ADR-042): an `error` or unreadable message ends the job, a job that says
 * nothing for a minute while the page is visible is asked where it stands
 * and then ended — never a spinner that turns for ever. Cancel terminates the
 * worker: a decode in flight cannot be stopped any other way.
 *
 * Two lanes, each with a worker of its own, so the size estimate (asked again
 * whenever the part, the size or the text changes) never waits behind, or
 * stops, the GIF being made.
 */

import { sanitizeExportFailureDetail, type ExportFailureDetail } from '@/domain/exportFailureDetail';
import { STALL_LIMITS_MS, gaveUpCode, takeWorkerFault, unsendable, unsentDetail, watchWorker } from '../workerWatch';
import type { GifSizeId } from '@/domain/gif';
import type { GifFailure, GifJob, GifSample, GifWorkerRequest, GifWorkerResponse } from './protocol';

export type { GifFailure, GifJob, GifSample } from './protocol';

export type GifRunFailure = {
  ok: false;
  reason: GifFailure | 'worker_unavailable' | 'canceled';
  /** Where it broke and with what kind of error, for a failure nobody planned for (ADR-042). */
  detail?: ExportFailureDetail;
};

/** One size's measurement (ADR-052: an estimate measures several sizes, each answered as soon as it is known). */
export interface GifSizeEstimate {
  size: GifSizeId;
  width: number;
  height: number;
  frames: number;
  sample: GifSample;
}

/** Every size asked for was measured (each was already handed to `onSize`). */
export type GifEstimateOutcome = { ok: true; sizes: GifSizeEstimate[] } | GifRunFailure;

export type GifMakeOutcome =
  | {
      ok: true;
      bytes: Uint8Array;
      width: number;
      height: number;
      frames: number;
      framesMissing: number;
      elapsedMs: number;
    }
  | GifRunFailure;

export interface GifProgress {
  step: 'frames' | 'encoding';
  done: number;
  total: number;
  /** 2: the part is decoded a second time while the GIF is written (a GIF too large to hold its frames). */
  passes: 1 | 2;
}

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/**
 * Test builds only (`window.__clipGifHeldFramesBytes`): the frames budget of the next GIFs made
 * (0: always two passes; Infinity: always one), so a test can make the same GIF both ways.
 */
function testHeldFramesBytes(): number | null {
  if (!TEST_HOOKS) return null;
  const value = (globalThis as { __clipGifHeldFramesBytes?: unknown }).__clipGifHeldFramesBytes;
  return typeof value === 'number' && value >= 0 ? value : null;
}

function createWorker(): Worker {
  return new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module', name: 'clip-gif' });
}

class Lane {
  private worker: Worker | null = null;
  private counter = 0;
  private finishActive: ((outcome: GifRunFailure) => void) | null = null;

  constructor(private readonly name: string) {}

  run(
    type: 'make' | 'estimate',
    job: GifJob & { sizes?: GifSizeId[] },
    onMessage: (data: Exclude<GifWorkerResponse, { type: 'where' | 'failed' }>) => GifEstimateOutcome | GifMakeOutcome | null,
  ): Promise<GifEstimateOutcome | GifMakeOutcome> {
    this.cancel();
    let worker: Worker;
    try {
      worker = this.worker ?? createWorker();
      this.worker = worker;
    } catch {
      return Promise.resolve({ ok: false, reason: 'worker_unavailable' });
    }
    this.counter += 1;
    const requestId = `${this.name}_${Date.now().toString(36)}_${this.counter}`;

    return new Promise((resolve) => {
      let settled = false;
      let heardProgress = false;
      const finish = (outcome: GifEstimateOutcome | GifMakeOutcome) => {
        if (settled) return;
        settled = true;
        watch.stop();
        worker.removeEventListener('message', listener);
        if (this.finishActive === finish) this.finishActive = null;
        resolve(outcome);
      };
      const watch = watchWorker(worker, {
        limitMs: () => STALL_LIMITS_MS.gif,
        askWhere: () => {
          const where: GifWorkerRequest = { type: 'where', requestId };
          worker.postMessage(where);
        },
        onGiveUp: (via, detail) => {
          const heard = watch.hasHeard();
          this.dispose(worker);
          finish({ ok: false, reason: gaveUpCode(via, heard), detail: watch.pageSide(detail, heardProgress ? 'encoding' : 'waiting') });
        },
      });
      const listener = (event: MessageEvent<GifWorkerResponse>) => {
        const data = event.data;
        if (data.requestId !== requestId) return;
        if (data.type === 'where') {
          watch.answer(data.detail);
          return;
        }
        watch.heard();
        if (data.type === 'failed') {
          const detail = sanitizeExportFailureDetail(data.detail);
          finish({ ok: false, reason: data.reason, ...(detail ? { detail: watch.pageSide(detail, 'encoding') } : {}) });
          return;
        }
        if (data.type === 'progress') heardProgress = true;
        const outcome = onMessage(data);
        if (outcome) finish(outcome);
      };
      this.finishActive = finish;
      worker.addEventListener('message', listener);
      // A test's fault is for the GIF being made, never for the estimate that runs on its own beforehand.
      const fault = type === 'make' ? takeWorkerFault('gif') : null;
      const budget = testHeldFramesBytes();
      const request: GifWorkerRequest = {
        type,
        requestId,
        ...job,
        ...(fault && fault.kind !== 'unsendable' ? { testFault: fault } : {}),
        ...(fault?.kind === 'unsendable' ? { unsendable: unsendable() } : {}),
        ...(budget !== null ? { testHeldFramesBytes: budget } : {}),
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        // Nothing was sent, so nothing would ever answer.
        finish({ ok: false, reason: 'internal_error', detail: unsentDetail(error) });
      }
    });
  }

  /** Stops a running job at once; it ends as `canceled`. */
  cancel(): void {
    const finish = this.finishActive;
    if (!finish) return;
    this.dispose();
    finish({ ok: false, reason: 'canceled' });
  }

  dispose(only?: Worker): void {
    if (only && this.worker !== only) {
      only.terminate();
      return;
    }
    this.worker?.terminate();
    this.worker = null;
  }
}

export class GifMaker {
  private readonly estimates = new Lane('gif_est');
  private readonly makes = new Lane('gif');

  /**
   * What a GIF of `job` would weigh at each of `sizes` (ADR-052; default: `job.size`), from a few frames
   * encoded its way, decoded once for all of them. Each size goes to `onSize` as soon as it is known, so a
   * search that runs out of time still has the sizes measured so far. A newer call ends an older one.
   */
  estimate(job: GifJob, sizes: GifSizeId[] = [job.size], onSize?: (estimate: GifSizeEstimate) => void): Promise<GifEstimateOutcome> {
    const done: GifSizeEstimate[] = [];
    return this.estimates.run('estimate', { ...job, sizes }, (data) => {
      if (data.type === 'estimated') {
        const one = { size: data.size, width: data.width, height: data.height, frames: data.frames, sample: data.sample };
        done.push(one);
        onSize?.(one);
        return null;
      }
      return data.type === 'estimateDone' ? { ok: true, sizes: done } : null;
    }) as Promise<GifEstimateOutcome>;
  }

  make(job: GifJob, onProgress: (progress: GifProgress) => void): Promise<GifMakeOutcome> {
    return this.makes.run('make', job, (data) => {
      if (data.type === 'progress') {
        onProgress({ step: data.step, done: data.done, total: data.total, passes: data.passes ?? 1 });
        return null;
      }
      if (data.type === 'made') {
        return {
          ok: true,
          bytes: new Uint8Array(data.bytes),
          width: data.width,
          height: data.height,
          frames: data.frames,
          framesMissing: data.framesMissing,
          elapsedMs: data.elapsedMs,
        };
      }
      return null;
    }) as Promise<GifMakeOutcome>;
  }

  cancelEstimate(): void {
    this.estimates.cancel();
  }

  cancel(): void {
    this.makes.cancel();
  }

  dispose(): void {
    this.estimates.cancel();
    this.makes.cancel();
    this.estimates.dispose();
    this.makes.dispose();
  }
}
