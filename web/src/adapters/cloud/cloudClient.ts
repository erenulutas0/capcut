/**
 * The browser's side of the transcript proxy (ADR-039; the proxy is
 * cloud/worker, its contract cloud/contract/cases.mjs).
 *
 * Five calls, all to ONE origin — the one this build was given — and to
 * nowhere else. The invite code travels in the `Authorization` header only,
 * never in an address. No cookies, no credentials mode; the proxy answers `no-store`.
 * Raw error texts are never passed on: every failure is one of
 * `CloudFailure`, and the UI has a sentence for each.
 */

import { failureFromAnswer, parseQuota, type CloudFailure, type CloudQuota } from '@/domain/cloudTranscript';

export type CloudOutcome<T> = ({ ok: true } & T) | { ok: false; reason: CloudFailure | 'canceled' };

export type CloudJobStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'error';

interface Call {
  origin: string;
  invite: string;
  signal?: AbortSignal;
}

const headersFor = (invite: string): Record<string, string> => ({ authorization: `Bearer ${invite}` });

async function answerOf(response: Response): Promise<{ status: number; body: unknown }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: judged by the status alone.
  }
  return { status: response.status, body };
}

const errorCode = (body: unknown): unknown => (typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined);

/** A GET or DELETE: the answer, or why there is none. */
async function call(method: 'GET' | 'DELETE', path: string, { origin, invite, signal }: Call, keepalive = false): Promise<CloudOutcome<{ status: number; body: unknown }>> {
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      headers: headersFor(invite),
      signal,
      keepalive,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { ok: false, reason: signal?.aborted ? 'canceled' : 'unreachable' };
  }
  return { ok: true, ...(await answerOf(response)) };
}

/** Minutes left for this invite, and whether the route is on. */
export async function fetchQuota(options: Call): Promise<CloudOutcome<{ quota: CloudQuota }>> {
  const answer = await call('GET', '/v1/quota', options);
  if (!answer.ok) return answer;
  if (answer.status !== 200) return { ok: false, reason: failureFromAnswer(answer.status, errorCode(answer.body)) };
  const quota = parseQuota(answer.body);
  return quota ? { ok: true, quota } : { ok: false, reason: 'internal_error' };
}

export interface UploadProgress {
  /** Bytes the browser has handed to the network, of the sound file's size. */
  sentBytes: number;
  totalBytes: number;
}

/**
 * Sends the sound-only file and starts the job. `jobId` is this browser's
 * own random name for it, so a start that was cancelled — or whose answer
 * never arrived — can still be deleted (`deleteJob`).
 *
 * XMLHttpRequest, not fetch: it is the one way a browser reports how many
 * bytes of an upload have really left.
 */
export type StartOutcome =
  | { ok: true; reservedMinutes: number | null }
  /**
   * `refused`: the proxy answered "no" at its door (invite, minutes, switch, limits) — it passed nothing on, and
   * no job exists. Otherwise something may have been passed on before it ended: the caller asks for a delete.
   */
  | { ok: false; reason: CloudFailure | 'canceled'; refused: boolean };

export function startJob(
  options: Call & { jobId: string; audio: Blob; mime: string; durationS: number; onProgress: (progress: UploadProgress) => void },
): Promise<StartOutcome> {
  const { origin, invite, signal, jobId, audio, mime, durationS, onProgress } = options;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, reason: 'canceled', refused: true });
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const done = (outcome: StartOutcome) => {
      signal?.removeEventListener('abort', abort);
      resolve(outcome);
    };
    request.open('POST', `${origin}/v1/jobs`);
    request.responseType = 'text';
    request.setRequestHeader('authorization', `Bearer ${invite}`);
    request.setRequestHeader('content-type', mime);
    // Whole seconds, rounded up: the proxy reserves by this, and a file longer than declared suspends the invite.
    request.setRequestHeader('x-audio-duration-s', String(Math.max(1, Math.ceil(durationS))));
    request.setRequestHeader('x-job-id', jobId);
    request.upload.onprogress = (event) => {
      onProgress({ sentBytes: Math.min(audio.size, event.loaded), totalBytes: audio.size });
    };
    request.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // Judged by the status alone.
      }
      if (request.status === 202) {
        const reserved = typeof body === 'object' && body !== null ? (body as { reservedMinutes?: unknown }).reservedMinutes : null;
        done({ ok: true, reservedMinutes: typeof reserved === 'number' && Number.isFinite(reserved) ? reserved : null });
      } else if (request.status === 409 && errorCode(body) === 'job_canceled') {
        done({ ok: false, reason: 'canceled', refused: false });
      } else {
        // 502: the provider refused or failed after the proxy had begun passing the sound on.
        const reason = failureFromAnswer(request.status, errorCode(body));
        done({ ok: false, reason, refused: request.status !== 502 && request.status !== 500 && reason !== 'upload_interrupted' });
      }
    };
    // No answer at all: the connection was lost on the way. How much had arrived cannot be known from here.
    request.onerror = () => done({ ok: false, reason: 'upload_interrupted', refused: false });
    request.ontimeout = () => done({ ok: false, reason: 'upload_interrupted', refused: false });
    request.onabort = () => done({ ok: false, reason: 'canceled', refused: false });
    signal?.addEventListener('abort', abort, { once: true });
    onProgress({ sentBytes: 0, totalBytes: audio.size });
    request.send(audio);
  });
}

export async function fetchStatus(options: Call & { jobId: string }): Promise<CloudOutcome<{ status: CloudJobStatus }>> {
  const answer = await call('GET', `/v1/jobs/${options.jobId}`, options);
  if (!answer.ok) return answer;
  if (answer.status !== 200) return { ok: false, reason: failureFromAnswer(answer.status, errorCode(answer.body)) };
  const status = typeof answer.body === 'object' && answer.body !== null ? (answer.body as { status?: unknown }).status : null;
  if (status === 'uploading' || status === 'queued' || status === 'processing' || status === 'completed' || status === 'error') return { ok: true, status };
  return { ok: false, reason: 'internal_error' };
}

/** The finished transcript as the provider wrote it (parsed by `parseCloudResult`). */
export async function fetchResult(options: Call & { jobId: string }): Promise<CloudOutcome<{ body: unknown }>> {
  const answer = await call('GET', `/v1/jobs/${options.jobId}/result`, options);
  if (!answer.ok) return answer;
  if (answer.status === 200) return { ok: true, body: answer.body };
  // The job ended without a result (the provider failed it), or it was already taken and deleted.
  if (answer.status === 409 || answer.status === 410) return { ok: false, reason: 'provider_error' };
  return { ok: false, reason: failureFromAnswer(answer.status, errorCode(answer.body)) };
}

/**
 * "Delete it at the provider now" — after the result arrived, after a
 * failure, on cancel, when the tab is closed (`keepalive`). Safe to repeat;
 * a job the proxy never heard of is not an error.
 */
export async function deleteJob(options: Call & { jobId: string; keepalive?: boolean }): Promise<boolean> {
  const answer = await call('DELETE', `/v1/jobs/${options.jobId}`, options, options.keepalive === true);
  return answer.ok && (answer.status === 200 || answer.status === 404);
}
