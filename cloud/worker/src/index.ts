/**
 * Cloud transcript proxy (ADR-039, draft — NOT deployed).
 *
 * The static site cannot hold the provider's key, so the browser talks to this
 * Worker and the Worker talks to the provider. Sound only: the browser sends
 * an audio file it made itself; the picture never reaches this code.
 *
 *   POST   /v1/jobs               start: the request body IS the audio (streamed through, never buffered);
 *                                 the browser may name the job itself (`x-job-id`, a random UUID), so it can
 *                                 delete a job whose start it cancelled or whose answer never arrived
 *   GET    /v1/jobs/:id           status (no text)
 *   GET    /v1/jobs/:id/result    the transcript, passed through, then deleted at the provider
 *   DELETE /v1/jobs/:id           delete at the provider now
 *   GET    /v1/quota              minutes left for this invite; whether the cloud route is on
 *   /admin/*                      founder only (ADMIN_TOKEN): invites, spend, kill switch
 *
 * Nothing here logs: no console output, no request bodies, no IP addresses.
 */
import { type Config, type Env, UPLOAD_SLACK_BYTES, readConfig } from './config';
import { Ledger } from './ledger';
import { UpstreamError, createTranscript, deleteTranscript, fetchResult, getTranscriptStatus, uploadAudio } from './provider';

export { Ledger };

const AUDIO_TYPES: Record<string, (head: Uint8Array) => boolean> = {
  'audio/ogg': (h) => ascii(h, 0, 'OggS'),
  'audio/opus': (h) => ascii(h, 0, 'OggS'),
  'audio/webm': (h) => h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3,
  'audio/mp4': (h) => ascii(h, 4, 'ftyp'),
  'audio/x-m4a': (h) => ascii(h, 4, 'ftyp'),
  'audio/flac': (h) => ascii(h, 0, 'fLaC'),
  'audio/wav': (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'WAVE'),
  'audio/x-wav': (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'WAVE'),
  'audio/mpeg': (h) => ascii(h, 0, 'ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0),
};
const ALLOWED_HEADERS = 'authorization, content-type, x-audio-duration-s, x-job-id, x-language, x-speaker-labels';
const LANGUAGE = /^(auto|[a-z]{2,3}(_[a-z]{2})?)$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Below this the admin token is treated as unset: no admin API, and (the same rule) no money path either. */
const ADMIN_TOKEN_MIN_LENGTH = 24;
const adminTokenOf = (env: Env): string | null => (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= ADMIN_TOKEN_MIN_LENGTH ? env.ADMIN_TOKEN : null);

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two secrets without leaking where they differ (both are hashed first, so lengths are equal). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)), crypto.subtle.digest('SHA-256', new TextEncoder().encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

function corsHeaders(origin: string | null, config: Config): Record<string, string> {
  if (!origin || !config.allowedOrigins.includes(origin)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

const bearer = (request: Request): string | null => {
  const value = request.headers.get('authorization') ?? '';
  return value.startsWith('Bearer ') && value.length > 7 ? value.slice(7).trim() : null;
};

const ledgerOf = (env: Env) => env.LEDGER.get(env.LEDGER.idFromName('ledger'));

/** A fresh invite code: 20 characters, 100 bits, no look-alike letters. */
function newInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789ab'; // 32 symbols
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const text = [...bytes].map((byte) => alphabet[byte & 31]).join('');
  return `${text.slice(0, 5)}-${text.slice(5, 10)}-${text.slice(10, 15)}-${text.slice(15)}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = readConfig(env);
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/admin/')) return await admin(request, url, env, config);
      if (url.pathname.startsWith('/v1/')) return await api(request, url, env, ctx, config);
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      // Never the provider's text, never a stack: only which step failed.
      const cors = url.pathname.startsWith('/v1/') ? corsHeaders(request.headers.get('origin'), config) : {};
      if (error instanceof UpstreamError) return json({ error: 'provider_error', step: error.step }, 502, cors);
      return json({ error: 'internal_error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------- browser API
async function api(request: Request, url: URL, env: Env, ctx: ExecutionContext, config: Config): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin, config);
  const allowed = origin !== null && config.allowedOrigins.includes(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
  // CORS is a browser rule, not authentication (any other client can send any Origin): the invite code is the gate.
  if (!allowed) return json({ error: 'origin_not_allowed' }, 403, cors);

  const key = env.ASSEMBLYAI_API_KEY;
  const adminToken = adminTokenOf(env);
  // The same rule as the admin API: a missing or short admin token means "not set up" — nothing is spent then.
  const configured = Boolean(key) && adminToken !== null;
  const invite = bearer(request);
  if (!invite) return json({ error: 'invite_required' }, 401, cors);
  const inviteHash = await sha256Hex(invite);
  const ledger = ledgerOf(env);
  // The address is kept only as a salted hash, for the hourly attempt counter (the salt is a secret, so the
  // stored value cannot be turned back into an address by listing them; the raw address is never stored).
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipHash = (await sha256Hex(`ip:${adminToken ?? ''}:${ip}`)).slice(0, 32);
  const refusal = (reservation: { status: number; code: string; retryAfterS?: number }) =>
    json({ error: reservation.code }, reservation.status, { ...cors, ...(reservation.retryAfterS ? { 'retry-after': String(reservation.retryAfterS) } : {}) });

  if (url.pathname === '/v1/quota' && request.method === 'GET') {
    const quota = await ledger.quota(inviteHash, ipHash);
    if (!quota.ok) return refusal(quota);
    return json({ on: quota.on && configured, remainingMinutes: Math.floor((quota.on && configured ? quota.remainingS : 0) / 60), maxJobMinutes: Math.floor(quota.maxJobS / 60) }, 200, cors);
  }

  if (url.pathname === '/v1/jobs' && request.method === 'POST') {
    // The cheap refusals first: nothing below costs a Durable Object request or a byte of upload.
    if (!configured || !config.enabled || config.capMicro <= 0) return json({ error: 'cloud_off' }, 503, cors);
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const sniff = AUDIO_TYPES[type];
    if (!sniff) return json({ error: 'not_audio' }, 415, cors);
    const length = Number(request.headers.get('content-length'));
    if (!Number.isInteger(length) || length <= 0 || !request.body) return json({ error: 'length_required' }, 411, cors);
    const declaredS = Number(request.headers.get('x-audio-duration-s'));
    if (!Number.isFinite(declaredS) || declaredS <= 0) return json({ error: 'duration_required' }, 400, cors);
    if (declaredS > config.maxJobSeconds) return json({ error: 'too_long', maxJobMinutes: config.maxJobSeconds / 60 }, 413, cors);
    // More bytes than the declared length can hold at the highest accepted bitrate: not what the site sends.
    if (length > config.maxUploadBytes || length > Math.ceil(declaredS) * config.maxBytesPerSecond + UPLOAD_SLACK_BYTES) return json({ error: 'too_large' }, 413, cors);
    const language = (request.headers.get('x-language') ?? 'auto').toLowerCase();
    if (!LANGUAGE.test(language)) return json({ error: 'bad_language' }, 400, cors);
    const speakerLabels = config.speakerLabels && request.headers.get('x-speaker-labels') !== '0';
    // The browser's own name for the job (optional): with it, a cancelled upload or a lost answer can still be deleted.
    const wantedId = request.headers.get('x-job-id');
    if (wantedId !== null && !JOB_ID.test(wantedId)) return json({ error: 'bad_job_id' }, 400, cors);

    const reservation = await ledger.reserve({ inviteHash, ipHash, declaredS, bytes: length, ...(wantedId ? { jobId: wantedId } : {}) });
    if (!reservation.ok) return refusal(reservation);

    let transcriptId: string | null = null;
    try {
      // Look at the first bytes only, then let the rest flow straight through to the provider.
      const reader = request.body.getReader();
      const first = await reader.read();
      if (first.done || !first.value || !sniff(first.value)) {
        await reader.cancel();
        await ledger.release(reservation.jobId);
        return json({ error: 'not_audio' }, 415, cors);
      }
      const { readable, writable } = new FixedLengthStream(length);
      const pump = (async () => {
        const writer = writable.getWriter();
        await writer.write(first.value);
        writer.releaseLock();
        reader.releaseLock();
        await (request.body as ReadableStream<Uint8Array>).pipeTo(writable);
      })();
      pump.catch(() => {}); // a broken upload surfaces through uploadAudio below
      const uploadUrl = await uploadAudio(config.providerBase, key as string, readable);
      await pump;
      // Deleted by the browser while the sound was still arriving (DELETE /v1/jobs/:id): nothing is started for it.
      if (!(await ledger.isReserved(reservation.jobId))) return json({ error: 'job_canceled' }, 409, cors);
      transcriptId = await createTranscript(config.providerBase, key as string, {
        audioUrl: uploadUrl,
        speechModels: config.speechModels,
        language,
        speakerLabels,
        audioEndAtMs: (reservation.reservedS + 1) * 1000,
      });
      if (!(await ledger.attachTranscript(reservation.jobId, transcriptId))) {
        // Deleted in the last moment, after the provider accepted it: remove it there now. The id is kept on
        // the (failed) job until that worked, so the clean-up alarm finishes what this call could not.
        await ledger.rememberOrphan(reservation.jobId, transcriptId);
        const orphan = transcriptId;
        transcriptId = null;
        await deleteTranscript(config.providerBase, key as string, orphan);
        await ledger.markDeleted(reservation.jobId);
        return json({ error: 'job_canceled' }, 409, cors);
      }
    } catch (error) {
      await ledger.release(reservation.jobId);
      if (transcriptId) ctx.waitUntil(deleteTranscript(config.providerBase, key as string, transcriptId).catch(() => {}));
      if (error instanceof UpstreamError) throw error;
      return json({ error: 'upload_failed' }, 400, cors);
    }
    return json({ jobId: reservation.jobId, status: 'queued', reservedMinutes: Number((reservation.reservedS / 60).toFixed(2)) }, 202, cors);
  }

  const match = /^\/v1\/jobs\/([^/]+)(\/result)?$/.exec(url.pathname);
  if (match && JOB_ID.test(match[1])) {
    const jobId = match[1];
    let job = await ledger.getJob(jobId, inviteHash);
    if (!job) return json({ error: 'job_not_found' }, 404, cors);
    if (!key) return json({ error: 'cloud_off' }, 503, cors);

    // Bring a running job up to date with the provider (this is where the real length is charged).
    const refresh = async (): Promise<'queued' | 'processing' | 'done'> => {
      if (job?.state !== 'running' || !job.transcript_id) return 'done';
      const status = await getTranscriptStatus(config.providerBase, key, job.transcript_id);
      if (status.status === 'completed') job = await ledger.settle(jobId, { status: 'completed', actualS: status.audioDurationS });
      else if (status.status === 'error') job = await ledger.settle(jobId, { status: 'error' });
      else return status.status;
      return 'done';
    };

    if (request.method === 'GET' && !match[2]) {
      if (job.state === 'reserved') return json({ status: 'uploading' }, 200, cors);
      const live = await refresh();
      if (live !== 'done' || !job) return json({ status: live }, 200, cors);
      if (job.state === 'failed') return json({ status: 'error' }, 200, cors);
      return json({ status: 'completed', minutes: Number(((job.actual_s ?? 0) / 60).toFixed(2)), resultAvailable: job.provider_deleted === 0 && job.transcript_id !== null }, 200, cors);
    }

    if (request.method === 'GET' && match[2]) {
      const live = await refresh();
      if (live !== 'done' || !job) return json({ error: 'not_ready', status: live }, 409, cors);
      if (job.state !== 'completed') return json({ error: 'no_result' }, 409, cors);
      if (!job.transcript_id || job.provider_deleted) return json({ error: 'result_gone' }, 410, cors);
      const transcriptId = job.transcript_id;
      const upstream = await fetchResult(config.providerBase, key, transcriptId);
      // Pass the bytes through untouched; once the browser has all of them, delete at the provider.
      const { readable, writable } = new IdentityTransformStream();
      ctx.waitUntil(
        (upstream.body as ReadableStream<Uint8Array>)
          .pipeTo(writable)
          .then(async () => {
            await deleteTranscript(config.providerBase, key, transcriptId);
            await ledger.markDeleted(jobId);
          })
          .catch(() => {}), // the browser went away: the clean-up alarm deletes it later
      );
      return new Response(readable, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } });
    }

    if (request.method === 'DELETE' && !match[2]) {
      if (job.state === 'running') {
        // Cancelled while the provider is still working: it may bill what it processed, so the reservation counts as spent.
        // The delete must not depend on the status call: when the provider's status cannot be read, it is deleted all the same.
        let live: 'queued' | 'processing' | 'done' = 'processing';
        try {
          live = await refresh();
        } catch {
          // counted as still working
        }
        if (live !== 'done') job = await ledger.settle(jobId, { status: 'completed', actualS: null });
      } else if (job.state === 'reserved') {
        await ledger.release(jobId);
      }
      if (job?.transcript_id && !job.provider_deleted) {
        await deleteTranscript(config.providerBase, key, job.transcript_id);
        await ledger.markDeleted(jobId);
      }
      return json({ deleted: true }, 200, cors);
    }
  }
  return json({ error: 'not_found' }, 404, cors);
}

// ---------------------------------------------------------------------------- founder API (curl, no CORS)
async function admin(request: Request, url: URL, env: Env, config: Config): Promise<Response> {
  const token = bearer(request);
  const adminToken = adminTokenOf(env);
  // Without a long admin token there is no admin API at all.
  if (!adminToken || !token || !(await sameSecret(token, adminToken))) return json({ error: 'not_found' }, 404);
  const ledger = ledgerOf(env);

  if (url.pathname === '/admin/spend' && request.method === 'GET') return json(await ledger.spend(), 200);

  if (url.pathname === '/admin/invites' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { label?: unknown; minutes?: unknown };
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 40) : '';
    if (!label) return json({ error: 'label_required' }, 400);
    const minutes = body.minutes === undefined ? config.inviteSecondsDefault / 60 : Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 100000) return json({ error: 'bad_minutes' }, 400);
    const code = newInviteCode();
    const hash = await sha256Hex(code);
    await ledger.createInvite(hash, label, Math.round(minutes * 60));
    // The code is shown once, here; only its hash is stored.
    return json({ code, id: hash.slice(0, 12), label, minutes }, 201);
  }

  const revoke = /^\/admin\/invites\/([0-9a-f]{8,64})$/.exec(url.pathname);
  if (revoke && request.method === 'DELETE') return json({ revoked: await ledger.revokeInvite(revoke[1]) }, 200);

  if (url.pathname === '/admin/kill' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { on?: unknown };
    if (typeof body.on !== 'boolean') return json({ error: 'on_required' }, 400);
    await ledger.setKill(body.on);
    return json({ killSwitch: body.on }, 200);
  }
  return json({ error: 'not_found' }, 404);
}
