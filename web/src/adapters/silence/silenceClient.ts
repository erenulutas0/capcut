'use client';

/**
 * Page side of the loudness worker, plus the session cache of envelopes.
 *
 * Envelopes are cached per (file fingerprint, source range) for the whole
 * session, so moving a parameter slider re-runs only the pure detector
 * (instant) and re-opening the dialog after an undo does not decode again.
 * The fingerprint is the same one a project binding uses (name, size,
 * last-modified), so a relinked copy of the same file reuses the cache.
 */

import type { LoudnessEnvelope } from '@/domain/silence';
import type { Micros } from '@/domain/time';
import type { AnalysisFailure, AnalysisRange, SilenceWorkerRequest, SilenceWorkerResponse } from './protocol';

export type { AnalysisFailure } from './protocol';

export type AnalysisOutcome =
  | { ok: true }
  | { ok: false; reason: AnalysisFailure | 'worker_unavailable' | 'canceled' };

/** ~100 numbers per second each; a few hundred ranges stay well under a few MB. */
const CACHE_LIMIT = 200;
const sessionCache = new Map<string, LoudnessEnvelope>();

export function fileFingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function envelopeKey(fingerprint: string, startUs: Micros, endUs: Micros): string {
  return `${fingerprint}|${startUs}|${endUs}`;
}

export function cachedEnvelope(key: string): LoudnessEnvelope | undefined {
  return sessionCache.get(key);
}

function remember(key: string, envelope: LoudnessEnvelope): void {
  sessionCache.delete(key);
  sessionCache.set(key, envelope);
  while (sessionCache.size > CACHE_LIMIT) {
    const oldest = sessionCache.keys().next().value;
    if (oldest === undefined) break;
    sessionCache.delete(oldest);
  }
  // Test instrumentation, inert in normal use: the parity test (and the
  // evaluation harness) define this array before the page loads to compare
  // the browser's envelope with ffmpeg's own measurement.
  const probe = (globalThis as { __clipSilenceEnvelopes?: unknown }).__clipSilenceEnvelopes;
  if (Array.isArray(probe)) {
    probe.push({ key, startUs: envelope.startUs, frameUs: envelope.frameUs, db: [...envelope.db] });
  }
}

function createWorker(): Worker {
  return new Worker(new URL('./silenceWorker.ts', import.meta.url), {
    type: 'module',
    name: 'clip-silence',
  });
}

export interface AnalysisProgress {
  framesDone: number;
  framesTotal: number;
}

export class SilenceAnalyzer {
  private worker: Worker | null = null;
  private counter = 0;
  private finishActive: ((outcome: AnalysisOutcome) => void) | null = null;

  /**
   * Measures every range that is not cached yet. Resolves once all of them
   * are in the cache, or with the reason nothing (more) could be measured.
   */
  analyze(
    file: File,
    ranges: readonly { startUs: Micros; endUs: Micros }[],
    onProgress: (progress: AnalysisProgress) => void,
  ): Promise<AnalysisOutcome> {
    this.cancel();
    const fingerprint = fileFingerprint(file);
    const missing = new Map<string, AnalysisRange>();
    for (const range of ranges) {
      const key = envelopeKey(fingerprint, range.startUs, range.endUs);
      if (!sessionCache.has(key) && range.endUs > range.startUs) {
        missing.set(key, { key, startUs: range.startUs, endUs: range.endUs });
      }
    }
    if (missing.size === 0) return Promise.resolve({ ok: true });

    let worker: Worker;
    try {
      worker = this.worker ?? createWorker();
      this.worker = worker;
    } catch {
      return Promise.resolve({ ok: false, reason: 'worker_unavailable' });
    }
    this.counter += 1;
    const requestId = `sil_${Date.now().toString(36)}_${this.counter}`;

    return new Promise<AnalysisOutcome>((resolve) => {
      const finish = (outcome: AnalysisOutcome) => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (this.finishActive === finish) this.finishActive = null;
        resolve(outcome);
      };
      const onMessage = (event: MessageEvent<SilenceWorkerResponse>) => {
        const data = event.data;
        if (data.requestId !== requestId) return;
        if (data.type === 'progress') {
          onProgress({ framesDone: data.framesDone, framesTotal: data.framesTotal });
        } else if (data.type === 'envelope') {
          remember(data.key, { startUs: data.startUs, frameUs: data.frameUs, db: Array.from(data.db) });
        } else if (data.type === 'done') {
          finish({ ok: true });
        } else {
          finish({ ok: false, reason: data.reason });
        }
      };
      const onError = () => {
        this.dispose();
        finish({ ok: false, reason: 'worker_unavailable' });
      };
      this.finishActive = finish;
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const request: SilenceWorkerRequest = { type: 'analyze', requestId, file, ranges: [...missing.values()] };
      worker.postMessage(request);
    });
  }

  /**
   * Stops a running analysis at once. The worker is terminated rather than
   * asked to stop: a decode in flight cannot be interrupted any other way.
   * Envelopes that already arrived stay cached.
   */
  cancel(): void {
    const finish = this.finishActive;
    if (!finish) return;
    this.dispose();
    finish({ ok: false, reason: 'canceled' });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
