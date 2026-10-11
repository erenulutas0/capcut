'use client';

/**
 * Page side of the cloud-audio worker: one worker per file, terminated when
 * it is done or cancelled (nothing of a cancelled run is kept).
 */

import type { CloudAudioFailure, CloudAudioRequest, CloudAudioResponse } from './cloudAudio.types';

export type { CloudAudioFailure } from './cloudAudio.types';

export interface SoundOnlyFile {
  blob: Blob;
  mime: 'audio/webm' | 'audio/mp4';
  codec: 'opus' | 'aac';
  /** Length of the sound in the file, in seconds (what the proxy is told). */
  durationS: number;
}

export type ExtractOutcome = ({ ok: true } & SoundOnlyFile) | { ok: false; reason: CloudAudioFailure | 'worker_unavailable' | 'canceled' };

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
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      resolve(outcome);
    };
    const onAbort = () => finish({ ok: false, reason: 'canceled' });
    signal.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<CloudAudioResponse>) => {
      const data = event.data;
      if (data.requestId !== requestId) return;
      if (data.type === 'progress') onProgress(data.doneS, data.totalS);
      else if (data.type === 'done') finish({ ok: true, blob: new Blob([data.buffer], { type: data.mime }), mime: data.mime, codec: data.codec, durationS: data.durationS });
      else finish({ ok: false, reason: data.reason });
    });
    worker.addEventListener('error', () => finish({ ok: false, reason: 'worker_unavailable' }));
    const codec = testCodec();
    const request: CloudAudioRequest = { type: 'extract', requestId, file, ...(codec ? { testCodec: codec } : {}) };
    worker.postMessage(request);
  });
}
