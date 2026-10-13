import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { originOf, passOrigin, stageOf, tagStage, withOrigin } from '@/adapters/export/failureStage';
import { recordError, recordFailure, sessionSnapshot } from '@/adapters/diagnostics';
import {
  STALL_LIMITS_MS,
  WHERE_WAIT_MS,
  gaveUpCode,
  stallLimit,
  takeWorkerFault,
  unsentDetail,
  watchWorker,
  type GaveUpVia,
} from '@/adapters/workerWatch';
import { buildDiagnostics, sanitizeSessionError, type DiagnosticsInput } from '@/domain/diagnostics';
import {
  EXPORT_STAGES,
  FAILURE_PHASES,
  caughtFailureDetail,
  failureDetailLine,
  sanitizeExportFailureDetail,
  stalledFailureDetail,
  type ExportFailureDetail,
} from '@/domain/exportFailureDetail';
import { StallClock } from '@/domain/stallClock';

/**
 * The small workers (loudness, transcript, model download, cloud sound, the
 * "İyileştir" preview) under the rules the export got in ADR-042: a failure
 * nobody planned for says where and what kind, never in the error's own
 * words; a worker that breaks, cannot be read or stands still ends the job.
 */

/** What an error could say about a user's video. None of it may ever be kept. */
const PRIVATE = ['aile-tatili-antalya-2025.mp4', 'C:\\Users\\ayse\\Videos', 'Doğum günün kutlu olsun', 'blob:https://lilocut.example/1f2e'];

function holds(json: string, secret: string): boolean {
  return json.includes(secret) || json.includes(JSON.stringify(secret).slice(1, -1));
}

/** An error whose every readable part is the secret. */
function poisonedError(secret: string): Error {
  const error = new Error(`${secret} could not be processed: ${secret}`);
  error.name = secret;
  error.stack = `${secret}\n    at ${secret}:1:1`;
  Object.assign(error, { fileName: secret, filename: secret, path: secret, url: secret, code: secret, cause: new Error(secret), reason: secret });
  return error;
}

describe('StallClock', () => {
  it('counts silence only while the page is visible', () => {
    const clock = new StallClock(0, false);
    expect(clock.silentFor(59_000)).toBe(59_000);
    expect(clock.stalled(59_000, 60_000)).toBe(false);
    expect(clock.stalled(60_001, 60_000)).toBe(true);
    // Hidden: nothing counts, however long.
    clock.visibility(true, 61_000);
    expect(clock.silentFor(10_000_000)).toBe(0);
    expect(clock.stalled(10_000_000, 60_000)).toBe(false);
    // Shown again: the count starts from that moment, not from the last message.
    clock.visibility(false, 10_000_000);
    expect(clock.stalled(10_050_000, 60_000)).toBe(false);
    expect(clock.stalled(10_060_001, 60_000)).toBe(true);
    expect(clock.wasHidden).toBe(true);
  });

  it('starts again at every sign of life, and a step without a limit is never "standing still"', () => {
    const clock = new StallClock(0, false);
    clock.heard(50_000);
    expect(clock.stalled(100_000, 60_000)).toBe(false);
    expect(clock.stalled(110_001, 60_000)).toBe(true);
    expect(clock.stalled(1e12, null)).toBe(false);
    expect(clock.wasHidden).toBe(false);
    expect(new StallClock(0, true).wasHidden).toBe(true);
  });
});

describe('the limits', () => {
  it('are never under a minute, and the steps that cannot report from inside get ten', () => {
    for (const value of Object.values(STALL_LIMITS_MS)) expect(value).toBeGreaterThanOrEqual(60_000);
    expect(STALL_LIMITS_MS.transcribeLoading).toBe(600_000);
    expect(STALL_LIMITS_MS.transcribeWriting).toBe(600_000);
    expect(STALL_LIMITS_MS.modelDownload).toBe(120_000);
  });

  it('cannot be shortened in an ordinary build: the test hooks are read only in a test build', () => {
    const holder = globalThis as Record<string, unknown>;
    holder.__clipWorkerStallMs = 5;
    holder.__clipWorkerFault = { worker: 'silence', kind: 'stall' };
    try {
      expect(stallLimit(60_000)).toBe(60_000);
      expect(stallLimit(null)).toBeNull();
      expect(takeWorkerFault('silence')).toBeNull();
      // Not taken either: nothing in an ordinary build touches it.
      expect(holder.__clipWorkerFault).toBeDefined();
    } finally {
      delete holder.__clipWorkerStallMs;
      delete holder.__clipWorkerFault;
    }
  });
});

/** A stand-in for a Worker: only the events and `postMessage` the watch uses. */
class FakeWorker extends EventTarget {
  posted: unknown[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
}

describe('watchWorker', () => {
  let now = 0;
  let hidden = false;
  const clock = { now: () => now, hidden: () => hidden };
  /** Time passes a second at a time, as the watch looks at the clock. */
  const tick = (ms: number) => {
    for (let left = ms; left > 0; left -= 1000) {
      const step = Math.min(1000, left);
      now += step;
      vi.advanceTimersByTime(step);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    hidden = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(limit: number | null = 60_000) {
    const worker = new FakeWorker();
    const ends: { via: GaveUpVia; detail: ExportFailureDetail }[] = [];
    const watch = watchWorker(
      worker as unknown as Worker,
      {
        limitMs: () => limit,
        askWhere: () => worker.postMessage({ type: 'where' }),
        onGiveUp: (via, detail) => ends.push({ via, detail }),
      },
      clock,
    );
    return { worker, watch, ends };
  }

  it('a worker that crashes ends the job at once, and nothing of the event is read', () => {
    const { worker, ends } = start();
    const event = new Event('error');
    // What a browser puts on an ErrorEvent: free text with the script's address in it.
    Object.assign(event, { message: `Uncaught Error: ${PRIVATE[0]}`, filename: PRIVATE[3], error: poisonedError(PRIVATE[1] as string) });
    worker.dispatchEvent(event);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ via: 'worker_error_event', detail: { errorName: 'WorkerError', stage: 'worker_crash', via: 'worker_error_event' } });
    for (const secret of PRIVATE) expect(holds(JSON.stringify(ends[0]), secret)).toBe(false);
    // Once: a second event of the same broken worker is not a second ending.
    worker.dispatchEvent(new Event('error'));
    worker.dispatchEvent(new Event('messageerror'));
    tick(600_000);
    expect(ends).toHaveLength(1);
  });

  it('a message that cannot be read ends the job (before: it waited for ever)', () => {
    const { worker, ends } = start();
    worker.dispatchEvent(new Event('messageerror'));
    expect(ends).toEqual([expect.objectContaining({ via: 'worker_message_error', detail: expect.objectContaining({ errorName: 'DataCloneError', stage: 'worker_crash' }) })]);
  });

  it('a job that says nothing for longer than its limit is asked where it stands and ended a second later', () => {
    const { worker, watch, ends } = start(60_000);
    tick(59_000);
    watch.heard();
    tick(59_000);
    expect(ends).toHaveLength(0);
    expect(worker.posted).toHaveLength(0);
    tick(2_000);
    // Asked, not yet ended.
    expect(worker.posted).toEqual([{ type: 'where' }]);
    expect(ends).toHaveLength(0);
    // It still answers: its own word for where it stands — checked field by field, so nothing else comes through.
    watch.answer({ ...stalledFailureDetail('audio_decode'), errorName: PRIVATE[0], extra: PRIVATE[1], message: PRIVATE[2] });
    tick(WHERE_WAIT_MS);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ via: 'stalled', detail: { stage: 'audio_decode', via: 'stalled' } });
    for (const secret of PRIVATE) expect(holds(JSON.stringify(ends[0]), secret)).toBe(false);
    // Asked once only.
    tick(120_000);
    expect(worker.posted).toHaveLength(1);
    expect(ends).toHaveLength(1);
  });

  it('a job that does not answer "where" is ended all the same, without inventing where it stood', () => {
    const { ends } = start(60_000);
    tick(62_000 + WHERE_WAIT_MS);
    expect(ends).toEqual([{ via: 'stalled', detail: expect.objectContaining({ errorName: 'Stalled', stage: 'unknown', via: 'stalled' }) }]);
  });

  it('time spent hidden never counts: no false alarm for a tab left in the background', () => {
    const { watch, ends } = start(60_000);
    tick(30_000);
    hidden = true;
    tick(3_600_000);
    expect(ends).toHaveLength(0);
    hidden = false;
    // Back on screen: a full limit from now, not from an hour ago.
    tick(59_000);
    expect(ends).toHaveLength(0);
    tick(4_000 + WHERE_WAIT_MS);
    expect(ends).toHaveLength(1);
    expect(watch.pageSide(ends[0]!.detail, 'analysing')).toMatchObject({ phase: 'analysing', pageWasHidden: true });
  });

  it('a step without a limit is not watched, and a stopped watch lets go of the worker', () => {
    const quiet = start(null);
    tick(10_000_000);
    expect(quiet.ends).toHaveLength(0);

    const { worker, watch, ends } = start(60_000);
    watch.stop();
    worker.dispatchEvent(new Event('error'));
    tick(10_000_000);
    expect(ends).toHaveLength(0);
    watch.stop();
  });

  it('"could not be started" only when the worker never said a word', () => {
    expect(gaveUpCode('worker_error_event', false)).toBe('worker_unavailable');
    expect(gaveUpCode('worker_error_event', true)).toBe('internal_error');
    expect(gaveUpCode('worker_message_error', true)).toBe('internal_error');
    // Standing still is never "could not be started".
    expect(gaveUpCode('stalled', false)).toBe('internal_error');
    const { watch } = start();
    expect(watch.hasHeard()).toBe(false);
    watch.heard();
    expect(watch.hasHeard()).toBe(true);
    watch.stop();
  });

  it('a request that could not be handed over: the error\'s name if it is a known one, never its text', () => {
    const named = unsentDetail(new DOMException(`${PRIVATE[0]} could not be cloned`, 'DataCloneError'));
    expect(named).toMatchObject({ errorName: 'DataCloneError', via: 'request_not_sent', stage: 'unknown' });
    for (const secret of PRIVATE) {
      const json = JSON.stringify(unsentDetail(poisonedError(secret)));
      expect(holds(json, secret), secret).toBe(false);
    }
    expect(sanitizeExportFailureDetail(named)).toEqual(named);
  });
});

describe('what a small worker says about an error it caught', () => {
  it('is the name (if known), its own stage and a known sentence\'s label — nothing of the error itself', () => {
    expect(caughtFailureDetail(new DOMException('Decoding error.', 'EncodingError'), 'audio_decode')).toMatchObject({
      errorName: 'EncodingError',
      stage: 'audio_decode',
      via: 'exception',
      hint: 'decoding_error',
      framesDone: null,
      videoEncoder: null,
      route: null,
    });
    for (const secret of PRIVATE) {
      for (const stage of EXPORT_STAGES) {
        const detail = caughtFailureDetail(poisonedError(secret), stage);
        expect(holds(JSON.stringify(detail), secret), `${stage} / ${secret}`).toBe(false);
        expect(detail.errorName).toBe('Other');
        // And it is exactly what the page's own check lets through.
        expect(sanitizeExportFailureDetail(detail)).toEqual(detail);
      }
      // Something that is not an error object at all.
      expect(holds(JSON.stringify(caughtFailureDetail(secret, 'recognise')), secret)).toBe(false);
      expect(holds(JSON.stringify(caughtFailureDetail({ message: secret, name: secret }, 'recognise')), secret)).toBe(false);
    }
  });

  it('has a word of its own for every step of the other workers', () => {
    for (const stage of ['model_download', 'model_check', 'model_load', 'speech_detect', 'recognise', 'loudness'] as const) {
      expect(EXPORT_STAGES).toContain(stage);
      expect(stalledFailureDetail(stage)).toMatchObject({ errorName: 'Stalled', via: 'stalled', stage });
    }
    for (const phase of ['downloading', 'checking', 'loading', 'listening', 'writing'] as const) expect(FAILURE_PHASES).toContain(phase);
    for (const phase of FAILURE_PHASES) expect(phase).toMatch(/^[a-z]{3,16}$/);
  });

  it('the line for "Ayrıntılar" names the last step when there is no frame count', () => {
    const detail = { ...caughtFailureDetail(new TypeError('x'), 'recognise'), phase: 'writing' as const };
    expect(failureDetailLine(detail, 'kare')).toBe('TypeError · recognise · writing');
    expect(failureDetailLine({ ...stalledFailureDetail('model_load'), phase: 'loading', pageWasHidden: true }, 'kare')).toBe('Stalled · model_load · stalled · loading · hidden');
    // An export's line is as it was: the frame count, not the step.
    expect(failureDetailLine({ ...detail, phase: 'encoding', framesDone: 3, totalFrames: 9 }, 'kare')).toBe('TypeError · recognise · kare 3/9');
    expect(failureDetailLine({ ...detail, phase: 'waiting' }, 'kare')).toBe('TypeError · recognise');
  });
});

describe('the real error behind a plain-word one', () => {
  class Refusal extends Error {}

  it('stays beside it, is never copied into it, and leads back through a second wrapper', () => {
    const real = tagStage(new DOMException(`could not read ${PRIVATE[0]}`, 'NotReadableError'), 'audio_decode');
    const plain = withOrigin(new Refusal('undecodable'), real);
    expect(originOf(plain)).toBe(real);
    expect(plain.message).toBe('undecodable');
    expect(Object.keys(plain)).toEqual([]);
    expect(JSON.stringify(plain)).not.toContain('tatili');
    // The engine wraps the feed's error once more: still the same real one.
    const outer = passOrigin(new Refusal('undecodable'), plain);
    expect(originOf(outer)).toBe(real);
    expect(stageOf(originOf(outer))).toBe('audio_decode');
    expect(withOrigin(new Refusal('x'), plain) && originOf(withOrigin(new Refusal('x'), plain))).toBe(real);
  });

  it('a refusal of our own (no sound track) stands for nothing but itself', () => {
    const own = new Refusal('no_audio');
    expect(originOf(own)).toBeUndefined();
    expect(originOf(passOrigin(new Refusal('no_audio'), own))).toBeUndefined();
    expect(originOf('text')).toBeUndefined();
    expect(originOf(null)).toBeUndefined();
  });
});

describe('the session\'s failures, as the "Sorun bildir" file holds them', () => {
  const full: ExportFailureDetail = {
    ...caughtFailureDetail(new DOMException('Decoding error.', 'EncodingError'), 'audio_decode'),
    phase: 'listening',
    pageWasHidden: false,
  };

  function diagnosticsWith(sessionErrors: unknown[]): string {
    const input: DiagnosticsInput = {
      now: new Date('2026-10-13T10:00:00Z'),
      app: { version: '0.1.0', commit: 'abc1234' },
      browser: { userAgent: 'UA', platform: 'Win32', language: 'tr-TR', hardwareConcurrency: 8, deviceMemoryGb: 8 },
      screen: { width: 1920, height: 1080, devicePixelRatio: 1, viewportWidth: 1440, viewportHeight: 900 },
      features: {
        secureContext: true,
        crossOriginIsolated: false,
        worker: true,
        offscreenCanvas: true,
        videoEncoder: true,
        audioEncoder: true,
        videoDecoder: true,
        audioDecoder: true,
        opfs: true,
        webGpu: false,
        indexedDb: true,
      },
      storage: null,
      capability: null,
      project: null,
      exportLog: [],
      sessionErrors,
    };
    return JSON.stringify(buildDiagnostics(input));
  }

  it('keeps the detail of each of the other workers, and only the known fields', () => {
    for (const area of ['silence', 'transcript', 'model_download', 'cloud_audio', 'enhance_preview']) {
      const row = sanitizeSessionError({ at: '2026-10-13T10:00:00Z', area, code: 'internal_error', detail: full });
      expect(row).toEqual({ at: '2026-10-13T10:00:00.000Z', area, code: 'internal_error', detail: full });
    }
    // A code without a detail has no `detail` key at all (the file's older rows are unchanged).
    expect(Object.keys(sanitizeSessionError({ at: '2026-10-13T10:00:00Z', area: 'silence', code: 'no_audio' }) ?? {})).toEqual(['at', 'area', 'code']);
    expect(sanitizeSessionError({ at: '2026-10-13T10:00:00Z', area: PRIVATE[0], code: 'internal_error' })).toBeNull();
  });

  it('lets nothing private through, whichever field of whichever worker\'s failure it is put into', () => {
    const fields = Object.keys(full) as (keyof ExportFailureDetail)[];
    for (const area of ['silence', 'transcript', 'model_download', 'cloud_audio', 'enhance_preview']) {
      for (const secret of PRIVATE) {
        for (const field of fields) {
          const poisoned = { ...full, [field]: secret, message: secret, stack: secret, fileName: secret, cause: { message: secret } };
          const json = diagnosticsWith([{ at: '2026-10-13T10:00:00Z', area, code: 'internal_error', detail: poisoned, message: secret, file: secret }]);
          expect(holds(json, secret), `${area} / ${field} / ${secret}`).toBe(false);
          // The row itself survives: the failure is still reported.
          expect(json).toContain(`"area":"${area}","code":"internal_error"`);
        }
        for (const codecField of ['videoEncoder', 'videoDecoder', 'audioEncoder'] as const) {
          const poisoned = { ...full, [codecField]: { codec: secret, hardwareAcceleration: secret, extra: secret } };
          expect(holds(diagnosticsWith([{ at: '2026-10-13T10:00:00Z', area, code: 'internal_error', detail: poisoned }]), secret)).toBe(false);
        }
        // A code or an area that is a sentence or a path drops the row.
        expect(holds(diagnosticsWith([{ at: '2026-10-13T10:00:00Z', area, code: secret, detail: full }]), secret)).toBe(false);
      }
    }
  });

  it('the page\'s own record (app state) is checked on the way in, too', () => {
    const before = sessionSnapshot().errors.length;
    for (const secret of PRIVATE) {
      const poisoned = Object.fromEntries(Object.keys(full).map((field) => [field, secret])) as unknown as ExportFailureDetail;
      recordFailure('transcript', 'internal_error', { ...poisoned, message: secret } as ExportFailureDetail);
      recordFailure('cloud_audio', secret, full);
      recordFailure('silence', 'undecodable', poisonedErrorAsDetail(secret));
    }
    const kept = sessionSnapshot().errors.slice(before);
    const json = JSON.stringify(kept);
    for (const secret of PRIVATE) expect(holds(json, secret), secret).toBe(false);
    // The codes are there; the rows whose code was a secret are not.
    expect(kept.map((row) => row.area)).not.toContain('cloud_audio');
    expect(kept.some((row) => row.area === 'transcript' && row.code === 'internal_error' && row.detail?.errorName === 'Other')).toBe(true);

    function poisonedErrorAsDetail(secret: string): ExportFailureDetail {
      return poisonedError(secret) as unknown as ExportFailureDetail;
    }
  });

  it('every failure is a row of its own (two in a row can differ in where they broke); a bare repeat of the code is not', () => {
    const before = sessionSnapshot().errors.length;
    recordFailure('enhance_preview', 'internal_error', full);
    // The same failure seen again by a render (the older path): not a new event.
    recordError('enhance_preview', 'internal_error');
    recordFailure('enhance_preview', 'internal_error', { ...full, stage: 'worker_crash', via: 'worker_error_event' });
    const kept = sessionSnapshot().errors.slice(before);
    expect(kept.map((row) => row.detail?.stage)).toEqual(['audio_decode', 'worker_crash']);
    // A snapshot is a copy: changing it changes nothing here.
    kept[1]!.code = 'changed';
    expect(sessionSnapshot().errors.at(-1)?.code).toBe('internal_error');
    // No more than the last 30 are kept.
    for (let i = 0; i < 40; i += 1) recordFailure('silence', 'internal_error', full);
    expect(sessionSnapshot().errors).toHaveLength(30);
  });
});
