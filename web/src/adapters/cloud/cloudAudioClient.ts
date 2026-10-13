'use client';

/**
 * Page side of the cloud-audio worker: one worker per file, terminated when
 * it is done or cancelled (nothing of a cancelled run is kept).
 */

import { sanitizeExportFailureDetail, type ExportFailureDetail } from '@/domain/exportFailureDetail';
import { STALL_LIMITS_MS, gaveUpCode, takeWorkerFault, unsendable, unsentDetail, watchWorker } from '../workerWatch';
import type { CloudAudioFailure, CloudAudioRequest, CloudAudioResponse } from './cloudAudio.types';

export type { CloudAudioFailure } from './cloudAudio.types';

export interface SoundOnlyFile {
  blob: Blob;
  mime: 'audio/webm' | 'audio/mp4';
  codec: 'opus' | 'aac';
  /** Length of the sound in the file, in seconds (what the proxy is told). */
  durationS: number;
}

/** `detail`: where it broke and with what kind of error, for a failure nobody planned for (ADR-042); never the error's text. */
export type ExtractOutcome =
  | ({ ok: true } & SoundOnlyFile)
  | { ok: false; reason: CloudAudioFailure | 'worker_unavailable' | 'canceled'; detail?: ExportFailureDetail };

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/** Test builds only: a test may ask for one encoder ('aac': the fallback container) or for none (a browser without either). */
function testCodec(): 'opus' | 'aac' | 'none' | undefined {
  if (!TEST_HOOKS) return undefined;
  const hook = (globalThis as { __clipCloudTest?: { codec?: unknown } }).__clipCloudTest;
  return hook?.codec === 'aac' || hook?.codec === 'opus' || hook?.codec === 'none' ? hook.codec : undefined;
}

let counter = 0;

/** Makes the sound-only file of `file`. `signal` stops it at once. */
export function extractSound(file: File, onProgress: (doneS: number, totalS: number) => void, signal: AbortSignal): Promise<ExtractOutcome> {
  if (signal.aborted) return Promise.resolve({ ok: false, reason: 'canceled' });
  let worker: Worker;
  try {
    worker = new Worker(new URL('./cloudAudioWorker.ts', import.meta.url), { type: 'module', name: 'clip-cloud-audio' });
  } catch {
    return Promise.resolve({ ok: false, reason: 'worker_unavailable' });
  }
  counter += 1;
  const requestId = `ca_${Date.now().toString(36)}_${counter}`;
  return new Promise<ExtractOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ExtractOutcome) => {
      if (settled) return;
      settled = true;
      watch.stop();
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      resolve(outcome);
    };
    // The worker broke, its message could not be read, or it stood still: it is stopped and the
    // attempt ends as a failure that says so (nothing was sent yet). Before this, a silent worker
    // meant "preparing the sound…" for ever.
    const watch = watchWorker(worker, {
      limitMs: () => STALL_LIMITS_MS.cloudAudio,
      askWhere: () => {
        const where: CloudAudioRequest = { type: 'where', requestId };
        worker.postMessage(where);
      },
      onGiveUp: (via, detail) => {
        const heard = watch.hasHeard();
        finish({ ok: false, reason: gaveUpCode(via, heard), detail: watch.pageSide(detail, heard ? 'preparing' : 'waiting') });
      },
    });
    const onAbort = () => finish({ ok: false, reason: 'canceled' });
    signal.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<CloudAudioResponse>) => {
      const data = event.data;
      if (data.requestId !== requestId) return;
      if (data.type === 'where') {
        watch.answer(data.detail);
        return;
      }
      watch.heard();
      if (data.type === 'progress') onProgress(data.doneS, data.totalS);
      else if (data.type === 'done') finish({ ok: true, blob: new Blob([data.buffer], { type: data.mime }), mime: data.mime, codec: data.codec, durationS: data.durationS });
      else {
        const detail = sanitizeExportFailureDetail(data.detail);
        finish({ ok: false, reason: data.reason, ...(detail ? { detail: watch.pageSide(detail, 'preparing') } : {}) });
      }
    });
    const codec = testCodec();
    const fault = takeWorkerFault('cloud_audio');
    const request: CloudAudioRequest = {
      type: 'extract',
      requestId,
      file,
      ...(codec ? { testCodec: codec } : {}),
      ...(fault && fault.kind !== 'unsendable' ? { testFault: fault } : {}),
      ...(fault?.kind === 'unsendable' ? { unsendable: unsendable() } : {}),
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      // Nothing was sent, so nothing would ever answer.
      finish({ ok: false, reason: 'internal_error', detail: unsentDetail(error) });
    }
  });
}
