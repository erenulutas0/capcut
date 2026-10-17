/**
 * Page-side watch over one job of a background worker (ADR-042, addendum of
 * 13 Oct 2026): the loudness worker, the transcript worker (model download
 * and transcription), the cloud sound worker, the "İyileştir" preview and
 * the GIF worker (ADR-046).
 *
 * The export got this first (`exportClient.ts`). Without it these jobs had
 * three ways to wait for ever: a worker whose message could not be read
 * (`messageerror` was not listened to), a worker that stopped answering (no
 * error is raised when the browser's graphics or media process dies under
 * it), and a request that could not be handed over at all.
 *
 * What a watch does:
 * - the worker's `error` and `messageerror` events end the job;
 * - a job that says nothing for longer than its step allows — counted only
 *   while the page is visible (`StallClock`) — is asked where it stands, and
 *   ended one second later whether it answered or not;
 * - it never reads an event's text (message, script address, line): that is
 *   the browser's free text.
 *
 * It ends a job at most once and then lets go of the worker. Stopping the
 * worker is the caller's part.
 */

import {
  pageSideFailureDetail,
  sanitizeExportFailureDetail,
  type ExportFailureDetail,
  type FailurePhase,
  type FailureVia,
} from '@/domain/exportFailureDetail';
import { StallClock } from '@/domain/stallClock';

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/**
 * How long each kind of job may say nothing, while the page is visible,
 * before it counts as standing still. Each number follows from how often
 * that job really reports, with room for a slow device — a false alarm here
 * would throw away work the user is waiting for.
 */
export const STALL_LIMITS_MS = {
  /**
   * Loudness ("Boşlukları at", silence dialog): the worker posts progress
   * after every decoded chunk of sound, at most every 100 ms; opening the
   * file is a handful of small exact reads (ADR-040 caps the same kind of
   * reads at 4 s). A minute of nothing is not slowness. The export's own
   * number (ADR-042).
   */
  silence: 60_000,
  /**
   * Cloud sound file: progress after every encoded second of sound (at most
   * every 200 ms). Before the first one there is only the encoder check and
   * the opening of the file; after the last, an in-memory finalize.
   */
  cloudAudio: 60_000,
  /**
   * "İyileştir" preview: the look at the video reports its share at least
   * every 100 ms; the single frame after it is one seek and one decode of at
   * most a group of pictures.
   */
  enhancePreview: 60_000,
  /**
   * "GIF yap" (ADR-046): progress after every frame (at most every 100 ms) while the part is decoded
   * and while the GIF is written; before the first one only the opening of the file (the ADR-040 check
   * caps its reads at 4 s) and the font. One frame of a GIF is one decode and one small drawing.
   */
  gif: 60_000,
  /**
   * Model download: bytes are reported as they arrive (at most every
   * 100 ms), and the checksum pass reports as it reads. Two minutes without
   * one byte is a connection that has stopped, not a slow one; the stored
   * parts are kept, so trying again continues where it stood.
   */
  modelDownload: 120_000,
  /**
   * Transcription, starting the model: ONE message at the beginning and
   * nothing until the model runs. Reading hundreds of megabytes back from
   * the browser's store and compiling them (WebGPU shaders for the large
   * model) was never measured on a slow device, so the limit is far above
   * anything measured (seconds on the desktop of ADR-036).
   */
  transcribeLoading: 600_000,
  /** Transcription, pass 1 (searching for speech): progress every 100 ms of work; ten minutes of video took 13–24 s (ADR-036). */
  transcribeListening: 120_000,
  /**
   * Transcription, pass 2: one message per recogniser call, and a call
   * cannot report from inside. A call hears at most 30 s of sound; the
   * desktop of ADR-036 wrote at about twice real time (≈ 15 s a call). Ten
   * minutes is forty times that: a phone ten times slower is still far
   * inside it.
   */
  transcribeWriting: 600_000,
} as const;

/** How long the page waits for the worker to say where it stands before ending the job. */
export const WHERE_WAIT_MS = 1000;
/** How often the watch looks at the clock. */
const TICK_MS = 1000;

/**
 * Test builds only (`window.__clipWorkerStallMs`): one shorter limit for
 * every step, so a test need not wait ten minutes. Ignored in every other
 * build.
 */
export function stallLimit(limit: number | null): number | null {
  if (limit === null || !TEST_HOOKS) return limit;
  const value = (globalThis as { __clipWorkerStallMs?: unknown }).__clipWorkerStallMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : limit;
}

/** A fault a test asks one of the small workers for (test builds only; see `takeWorkerFault`). */
export interface WorkerTestFault {
  /**
   * `throw`: the job throws an error with `errorName` and `message`;
   * `crash`: the worker itself throws outside every handler (its `error`
   * event fires on the page); `stall`: the job stops for ever without an
   * error; `unsendable`: the request cannot be copied to the worker.
   */
  kind: 'throw' | 'crash' | 'stall' | 'unsendable';
  errorName?: string;
  message?: string;
}

export type WatchedWorker = 'silence' | 'model_download' | 'transcript' | 'cloud_audio' | 'enhance_preview' | 'gif';

/**
 * Test builds only (`window.__clipWorkerFault = { worker, kind, … }`): the
 * next job of that worker breaks on purpose. Taken once, so the job after it
 * is an ordinary one and a test can see "try again" work.
 */
export function takeWorkerFault(worker: WatchedWorker): WorkerTestFault | null {
  if (!TEST_HOOKS) return null;
  const holder = globalThis as { __clipWorkerFault?: unknown };
  const value = holder.__clipWorkerFault;
  if (typeof value !== 'object' || value === null) return null;
  const fault = value as { worker?: unknown; kind?: unknown; errorName?: unknown; message?: unknown };
  if (fault.worker !== worker) return null;
  if (fault.kind !== 'throw' && fault.kind !== 'crash' && fault.kind !== 'stall' && fault.kind !== 'unsendable') return null;
  delete holder.__clipWorkerFault;
  return {
    kind: fault.kind,
    ...(typeof fault.errorName === 'string' ? { errorName: fault.errorName } : {}),
    ...(typeof fault.message === 'string' ? { message: fault.message } : {}),
  };
}

/** Something a request can carry that no worker can receive (a function is not cloneable): for the `unsendable` fault. */
export function unsendable(): unknown {
  return () => undefined;
}

/** Why the page ended a job itself. */
export type GaveUpVia = Exclude<FailureVia, 'exception' | 'request_not_sent'>;

export interface WorkerWatch {
  /** A message of this job arrived. */
  heard(): void;
  /** Whether the worker has said anything for this job yet. */
  hasHeard(): boolean;
  /** The worker's answer to "where are you?" (checked field by field here). */
  answer(detail: unknown): void;
  /** The page-side part of a failure's detail: the last step, whether the page was ever hidden. */
  pageSide(detail: ExportFailureDetail, phase: FailurePhase | null): ExportFailureDetail;
  /** Lets go of the worker. Safe to call more than once. */
  stop(): void;
}

export interface WorkerWatchOptions {
  /** How long the job may be silent in the step it is in now; null: this step is not watched. */
  limitMs: () => number | null;
  /** Asks the worker where it stands (a `where` message). May throw; may be absent. */
  askWhere?: () => void;
  /**
   * The page gave up on the job. `detail` is the worker's own answer when it
   * still gave one, else what the page knows. Called at most once.
   */
  onGiveUp: (via: GaveUpVia, detail: ExportFailureDetail) => void;
}

interface Clock {
  now(): number;
  hidden(): boolean;
}

const browserClock: Clock = {
  now: () => performance.now(),
  hidden: () => typeof document !== 'undefined' && document.hidden,
};

export function watchWorker(worker: Worker, options: WorkerWatchOptions, clock: Clock = browserClock): WorkerWatch {
  const stall = new StallClock(clock.now(), clock.hidden());
  let heardAny = false;
  let ended = false;
  let whereDetail: ExportFailureDetail | null = null;
  let whereTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (ended) return;
    ended = true;
    clearInterval(ticker);
    if (whereTimer !== null) clearTimeout(whereTimer);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
  const giveUp = (via: GaveUpVia) => {
    if (ended) return;
    const detail = via === 'stalled' ? (whereDetail ?? pageSideFailureDetail('stalled')) : pageSideFailureDetail(via);
    stop();
    options.onGiveUp(via, detail);
  };
  // The events' own text is not read.
  const onError = () => giveUp('worker_error_event');
  const onMessageError = () => giveUp('worker_message_error');
  let seenHidden = clock.hidden();
  const onVisibility = () => {
    const hidden = clock.hidden();
    if (hidden === seenHidden) return;
    seenHidden = hidden;
    stall.visibility(hidden, clock.now());
  };

  const ticker = setInterval(() => {
    if (ended || whereTimer !== null) return;
    // Also looked at here, not only on the event: a change the event did not announce must not count as silence.
    onVisibility();
    if (!stall.stalled(clock.now(), stallLimit(options.limitMs()))) return;
    // Its message loop may still run: ask, then end the job either way.
    try {
      options.askWhere?.();
    } catch {
      // No answer then.
    }
    whereTimer = setTimeout(() => giveUp('stalled'), WHERE_WAIT_MS);
  }, TICK_MS);

  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onMessageError);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return {
    heard: () => {
      heardAny = true;
      stall.heard(clock.now());
    },
    hasHeard: () => heardAny,
    answer: (detail) => {
      whereDetail = sanitizeExportFailureDetail(detail);
    },
    pageSide: (detail, phase) => ({ ...detail, phase: detail.phase ?? phase, pageWasHidden: stall.wasHidden }),
    stop,
  };
}

/**
 * The code of a job the page ended itself: "could not be started" only when
 * the worker never said a word; a worker that was working and then broke or
 * stood still is an unexpected error (as for a download, ADR-042).
 */
export function gaveUpCode(via: GaveUpVia, heard: boolean): 'internal_error' | 'worker_unavailable' {
  return via !== 'stalled' && !heard ? 'worker_unavailable' : 'internal_error';
}

/** The detail of a request that could not be handed to the worker: the error's name if it is a known one, never its text. */
export function unsentDetail(error: unknown): ExportFailureDetail {
  return { ...pageSideFailureDetail('request_not_sent', error), pageWasHidden: browserClock.hidden() };
}
