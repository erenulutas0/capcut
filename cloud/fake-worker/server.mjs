/**
 * A LOCAL FAKE of the transcript proxy (ADR-039) for the web app's tests.
 *
 * It is a plain Node HTTP server on 127.0.0.1 that answers the browser the
 * way the real Worker (cloud/worker/src/index.ts + ledger.ts) does: the same
 * paths, checks in the same order, the same status codes and bodies. The
 * provider behind it is faked in the same process and writes whatever words
 * the test scripted. It hears nothing; it says nothing about how well speech
 * is written.
 *
 * It cannot drift from the Worker unnoticed: cloud/contract/cases.mjs runs
 * against both (cloud/worker/test/contract.test.ts and
 * cloud/fake-worker/test/contract.test.mjs).
 *
 * No dependencies and no network: it never opens a connection to anything.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const AUDIO_TYPES = {
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
const UPLOAD_SLACK_BYTES = 64 * 1024;
const HARD_MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const OVERRUN_TOLERANCE = { seconds: 3, share: 0.02 };

function ascii(bytes, at, text) {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}
const costMicro = (seconds, priceMicroPerHour) => Math.ceil((Math.ceil(seconds) * priceMicroPerHour) / 3600);
const minutes2 = (seconds) => Number((seconds / 60).toFixed(2));

/** The words the faked provider writes unless a test scripts its own. */
export const DEFAULT_WORDS = [
  { text: 'Merhaba', start: 100, end: 500, confidence: 0.99, speaker: 'A' },
  { text: 'dünya.', start: 550, end: 900, confidence: 0.98, speaker: 'B' },
];

const freshProvider = () => ({
  // The same switches as the Worker tests' provider (cloud/worker/test/mock-upstream.mjs) …
  pollsUntilDone: 1,
  failUpload: 0,
  failCreate: 0,
  transcriptError: null,
  audioDurationS: null,
  // … and what only the web tests need:
  /** The words of the result (provider shape: milliseconds, `speaker`). */
  words: DEFAULT_WORDS,
  languageCode: null,
  /** A status poll fails at the provider with this HTTP status (the proxy answers 502, step "status"). */
  failStatus: 0,
  /** The result fetch fails at the provider with this HTTP status (502, step "result"). */
  failResult: 0,
  /** The start does not answer until `releaseUpload()` (or the browser gives up): a slow upload. */
  holdUpload: false,
  /** The connection is cut after this many bytes of the upload arrived (a network that drops). */
  dropUploadAfterBytes: 0,
});

/**
 * Starts the fake on 127.0.0.1:`port`. `allowedOrigins`: the site origins it
 * answers (CORS), like the Worker's ALLOWED_ORIGINS.
 */
export async function startFakeWorker({
  port,
  allowedOrigins,
  monthlyCapUsd = 1,
  priceUsdPerHour = 0.23,
  rateLimitPerHour = 30,
  maxJobMinutes = 120,
  maxBytesPerSecond = 8000,
} = {}) {
  const capMicro = Math.round(monthlyCapUsd * 1e6);
  const priceMicroPerHour = Math.round(priceUsdPerHour * 1e6);
  const maxJobSeconds = Math.round(maxJobMinutes * 60);
  const maxUploadBytes = Math.min(HARD_MAX_UPLOAD_BYTES, maxJobSeconds * maxBytesPerSecond + UPLOAD_SLACK_BYTES);

  let state;
  const reset = () => {
    for (const waiting of state?.held ?? []) waiting();
    state = {
      invites: new Map(), // sha256(code) → { quotaS, usedS, revoked }
      jobs: new Map(), // id → job
      spentMicro: 0,
      rate: new Map(), // address → attempts this hour
      killed: false,
      provider: freshProvider(),
      uploadsAtProvider: new Map(), // upload url → bytes
      transcripts: new Map(), // id → { params, polls, deleted }
      counter: 0,
      requests: [],
      uploads: [],
      abortedUploads: 0,
      held: [],
    };
  };
  reset();

  const hashOf = (code) => createHash('sha256').update(code).digest('hex');
  const on = () => capMicro > 0 && !state.killed;
  const reservedOf = (filter) => [...state.jobs.values()].filter((job) => (job.state === 'reserved' || job.state === 'running') && filter(job));
  const monthReserved = () => reservedOf(() => true).reduce((sum, job) => sum + job.reservedMicro, 0);
  const inviteReserved = (hash) => reservedOf((job) => job.inviteHash === hash).reduce((sum, job) => sum + job.reservedS, 0);

  function reserve({ inviteHash, address, declaredS, bytes, jobId: wanted }) {
    const attempts = (state.rate.get(address) ?? 0) + 1;
    state.rate.set(address, attempts);
    if (attempts > rateLimitPerHour) return { ok: false, status: 429, code: 'rate_limited', retryAfterS: 1800 };
    if (!on()) return { ok: false, status: 503, code: 'cloud_off' };
    const invite = state.invites.get(inviteHash);
    if (!invite || invite.revoked) return { ok: false, status: 401, code: 'invite_invalid' };
    if (reservedOf((job) => job.inviteHash === inviteHash).length > 0) return { ok: false, status: 409, code: 'job_in_progress' };
    const reservedS = Math.ceil(declaredS);
    if (reservedS > maxJobSeconds) return { ok: false, status: 413, code: 'too_long' };
    if (invite.usedS + inviteReserved(inviteHash) + reservedS > invite.quotaS) return { ok: false, status: 402, code: 'invite_minutes_used_up' };
    const cost = costMicro(reservedS, priceMicroPerHour);
    if (state.spentMicro + monthReserved() + cost > capMicro) return { ok: false, status: 503, code: 'monthly_cap_reached' };
    const jobId = wanted ?? randomUUID();
    if (wanted && state.jobs.has(jobId)) return { ok: false, status: 409, code: 'job_id_taken' };
    state.jobs.set(jobId, { id: jobId, inviteHash, state: 'reserved', transcriptId: null, declaredS: reservedS, reservedS, actualS: null, reservedMicro: cost, bytes, providerDeleted: false });
    return { ok: true, jobId, reservedS };
  }
  const release = (jobId) => {
    const job = state.jobs.get(jobId);
    if (job && (job.state === 'reserved' || job.state === 'running')) job.state = 'failed';
  };
  function settle(job, outcome) {
    if (job.state !== 'running') return;
    if (outcome.status === 'error') {
      job.state = 'failed';
      return;
    }
    const actualS = outcome.actualS === null ? job.reservedS : Math.ceil(outcome.actualS);
    job.state = 'completed';
    job.actualS = actualS;
    state.spentMicro += costMicro(actualS, priceMicroPerHour);
    const invite = state.invites.get(job.inviteHash);
    if (invite) {
      invite.usedS += actualS;
      if (actualS > job.declaredS * (1 + OVERRUN_TOLERANCE.share) + OVERRUN_TOLERANCE.seconds) invite.revoked = true;
    }
  }
  const markDeleted = (job) => {
    job.providerDeleted = true;
    job.transcriptId = null;
  };

  // ---------------------------------------------------------------- the faked provider
  class UpstreamError extends Error {
    constructor(step) {
      super(step);
      this.step = step;
    }
  }
  function providerStatus(transcriptId) {
    const transcript = state.transcripts.get(transcriptId);
    if (!transcript || transcript.deleted || state.provider.failStatus) throw new UpstreamError('status');
    transcript.polls += 1;
    if (transcript.polls <= state.provider.pollsUntilDone) return { status: transcript.polls === 1 ? 'queued' : 'processing', audioDurationS: null };
    if (state.provider.transcriptError) return { status: 'error', audioDurationS: null };
    return { status: 'completed', audioDurationS: state.provider.audioDurationS ?? Math.round(transcript.params.audio_end_at / 1000) - 1 };
  }
  function providerResult(transcriptId) {
    const transcript = state.transcripts.get(transcriptId);
    if (!transcript || transcript.deleted || state.provider.failResult) throw new UpstreamError('result');
    const words = state.provider.words;
    return {
      id: transcriptId,
      status: 'completed',
      text: words.map((word) => word.text).join(' '),
      words,
      utterances: null,
      language_code: state.provider.languageCode ?? transcript.params.language_code ?? 'tr',
      audio_duration: state.provider.audioDurationS ?? Math.round(transcript.params.audio_end_at / 1000) - 1,
    };
  }
  function providerDelete(transcriptId) {
    const transcript = state.transcripts.get(transcriptId);
    if (!transcript) return;
    transcript.deleted = true;
    state.uploadsAtProvider.delete(transcript.params.audio_url);
  }

  // ---------------------------------------------------------------- the proxy
  const allowed = (origin) => typeof origin === 'string' && allowedOrigins.includes(origin);
  const corsHeaders = (origin) =>
    allowed(origin)
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
          'access-control-allow-headers': ALLOWED_HEADERS,
          'access-control-max-age': '600',
          vary: 'Origin',
        }
      : { vary: 'Origin' };

  function send(response, status, body, headers = {}) {
    if (response.writableEnded || response.destroyed) return;
    const text = body === null ? '' : JSON.stringify(body);
    response.writeHead(status, {
      ...(body === null ? {} : { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }),
      ...headers,
    });
    response.end(text);
  }

  async function handle(request, response) {
    const url = new URL(request.url, 'http://fake.local');
    const origin = request.headers.origin ?? null;
    const cors = corsHeaders(origin);
    const entry = {
      method: request.method,
      path: url.pathname,
      query: url.search,
      origin,
      /** Whether an invite code came in the header (the code itself is not kept in this log). */
      hasInvite: typeof request.headers.authorization === 'string',
      contentType: request.headers['content-type'] ?? null,
      durationS: request.headers['x-audio-duration-s'] ?? null,
      language: request.headers['x-language'] ?? null,
      jobIdHeader: request.headers['x-job-id'] ?? null,
      bytes: 0,
      status: 0,
    };
    state.requests.push(entry);
    const answer = (status, body, headers = {}) => {
      entry.status = status;
      send(response, status, body, { ...cors, ...headers });
      request.resume(); // let an unread body drain so the browser sees the answer, not a reset
    };

    if (!url.pathname.startsWith('/v1/')) return answer(404, { error: 'not_found' });
    if (request.method === 'OPTIONS') return answer(allowed(origin) ? 204 : 403, null);
    if (!allowed(origin)) return answer(403, { error: 'origin_not_allowed' });

    const authorization = request.headers.authorization ?? '';
    const invite = authorization.startsWith('Bearer ') && authorization.length > 7 ? authorization.slice(7).trim() : null;
    if (!invite) return answer(401, { error: 'invite_required' });
    const inviteHash = hashOf(invite);

    try {
      if (url.pathname === '/v1/quota' && request.method === 'GET') {
        const row = state.invites.get(inviteHash);
        if (!row || row.revoked) return answer(401, { error: 'invite_invalid' });
        const capLeftS = Math.max(0, Math.floor(((capMicro - state.spentMicro - monthReserved()) * 3600) / priceMicroPerHour));
        const inviteLeftS = Math.max(0, row.quotaS - row.usedS - inviteReserved(inviteHash));
        return answer(200, { on: on(), remainingMinutes: Math.floor((on() ? Math.min(inviteLeftS, capLeftS) : 0) / 60), maxJobMinutes: Math.floor(maxJobSeconds / 60) });
      }

      if (url.pathname === '/v1/jobs' && request.method === 'POST') {
        if (capMicro <= 0) return answer(503, { error: 'cloud_off' });
        const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const sniff = AUDIO_TYPES[type];
        if (!sniff) return answer(415, { error: 'not_audio' });
        const length = Number(request.headers['content-length']);
        if (!Number.isInteger(length) || length <= 0) return answer(411, { error: 'length_required' });
        const declaredS = Number(request.headers['x-audio-duration-s']);
        if (!Number.isFinite(declaredS) || declaredS <= 0) return answer(400, { error: 'duration_required' });
        if (declaredS > maxJobSeconds) return answer(413, { error: 'too_long', maxJobMinutes: maxJobSeconds / 60 });
        if (length > maxUploadBytes || length > Math.ceil(declaredS) * maxBytesPerSecond + UPLOAD_SLACK_BYTES) return answer(413, { error: 'too_large' });
        const language = (request.headers['x-language'] ?? 'auto').toLowerCase();
        if (!LANGUAGE.test(language)) return answer(400, { error: 'bad_language' });
        const wantedId = request.headers['x-job-id'] ?? null;
        if (wantedId !== null && !JOB_ID.test(wantedId)) return answer(400, { error: 'bad_job_id' });

        const address = request.headers['cf-connecting-ip'] ?? 'local';
        const reservation = reserve({ inviteHash, address, declaredS, bytes: length, jobId: wantedId });
        if (!reservation.ok) return answer(reservation.status, { error: reservation.code }, reservation.retryAfterS ? { 'retry-after': String(reservation.retryAfterS) } : {});
        const job = state.jobs.get(reservation.jobId);

        // The sound arrives. The browser may give up (cancel, a dropped network): the reservation is given back.
        const chunks = [];
        let received = 0;
        const body = await new Promise((resolve) => {
          let done = false;
          const finish = (value) => {
            if (done) return;
            done = true;
            resolve(value);
          };
          request.on('data', (chunk) => {
            chunks.push(chunk);
            received += chunk.length;
            entry.bytes = received;
            const cut = state.provider.dropUploadAfterBytes;
            if (cut > 0 && received >= cut) {
              request.destroy();
              response.destroy();
              finish(null);
            }
          });
          request.on('end', () => finish(Buffer.concat(chunks)));
          request.on('close', () => finish(null));
          request.on('error', () => finish(null));
        });
        if (body === null || body.length !== length) {
          state.abortedUploads += 1;
          release(job.id);
          entry.status = -1;
          return undefined;
        }
        if (!sniff(body)) {
          release(job.id);
          return answer(415, { error: 'not_audio' });
        }
        if (state.provider.holdUpload) {
          // A slow upload: nothing is answered until the test lets it through or the browser gives up.
          const outcome = await new Promise((resolve) => {
            state.held.push(() => resolve('released'));
            response.on('close', () => resolve('gone'));
          });
          if (outcome === 'gone') {
            state.abortedUploads += 1;
            release(job.id);
            entry.status = -1;
            return undefined;
          }
        }
        state.uploads.push({ jobId: job.id, bytes: body, contentType: type, durationS: declaredS, language });

        if (state.provider.failUpload) {
          release(job.id);
          return answer(502, { error: 'provider_error', step: 'upload' });
        }
        const uploadUrl = `https://cdn.provider.fake/upload/u-${(state.counter += 1)}`;
        state.uploadsAtProvider.set(uploadUrl, body.length);
        // Deleted by the browser while the sound was still arriving: nothing is started for it.
        if (job.state !== 'reserved') return answer(409, { error: 'job_canceled' });
        if (state.provider.failCreate) {
          release(job.id);
          return answer(502, { error: 'provider_error', step: 'create' });
        }
        const transcriptId = `t-${(state.counter += 1)}`;
        state.transcripts.set(transcriptId, {
          params: { audio_url: uploadUrl, audio_end_at: (reservation.reservedS + 1) * 1000, ...(language === 'auto' ? { language_detection: true } : { language_code: language }) },
          polls: 0,
          deleted: false,
        });
        job.state = 'running';
        job.transcriptId = transcriptId;
        return answer(202, { jobId: job.id, status: 'queued', reservedMinutes: minutes2(reservation.reservedS) });
      }

      const match = /^\/v1\/jobs\/([^/]+)(\/result)?$/.exec(url.pathname);
      if (match && JOB_ID.test(match[1])) {
        const job = state.jobs.get(match[1]);
        if (!job || job.inviteHash !== inviteHash) return answer(404, { error: 'job_not_found' });

        const refresh = () => {
          if (job.state !== 'running' || !job.transcriptId) return 'done';
          const status = providerStatus(job.transcriptId);
          if (status.status === 'completed') settle(job, { status: 'completed', actualS: status.audioDurationS });
          else if (status.status === 'error') settle(job, { status: 'error' });
          else return status.status;
          return 'done';
        };

        if (request.method === 'GET' && !match[2]) {
          if (job.state === 'reserved') return answer(200, { status: 'uploading' });
          const live = refresh();
          if (live !== 'done') return answer(200, { status: live });
          if (job.state === 'failed') return answer(200, { status: 'error' });
          return answer(200, { status: 'completed', minutes: minutes2(job.actualS ?? 0), resultAvailable: !job.providerDeleted && job.transcriptId !== null });
        }
        if (request.method === 'GET' && match[2]) {
          const live = refresh();
          if (live !== 'done') return answer(409, { error: 'not_ready', status: live });
          if (job.state !== 'completed') return answer(409, { error: 'no_result' });
          if (!job.transcriptId || job.providerDeleted) return answer(410, { error: 'result_gone' });
          const result = providerResult(job.transcriptId);
          const transcriptId = job.transcriptId;
          answer(200, result);
          // Once the browser has all of it: deleted at the provider.
          providerDelete(transcriptId);
          markDeleted(job);
          return undefined;
        }
        if (request.method === 'DELETE' && !match[2]) {
          if (job.state === 'running') {
            // As in the Worker: the delete does not depend on the status call.
            let live = 'processing';
            try {
              live = refresh();
            } catch {
              // counted as still working
            }
            if (live !== 'done') settle(job, { status: 'completed', actualS: null });
          } else if (job.state === 'reserved') {
            release(job.id);
          }
          if (job.transcriptId && !job.providerDeleted) {
            providerDelete(job.transcriptId);
            markDeleted(job);
          }
          return answer(200, { deleted: true });
        }
      }
      return answer(404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof UpstreamError) return answer(502, { error: 'provider_error', step: error.step });
      return answer(500, { error: 'internal_error' });
    }
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, { error: 'internal_error' });
    });
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();

  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    limits: { rateLimitPerHour, monthlyCapUsd, priceUsdPerHour },
    /** Forget everything: invites, jobs, what was uploaded, the request log, the provider's switches. */
    reset,
    /** A fresh invite code in the Worker's own format, good for `minutes`. */
    newInvite(minutes = 60) {
      const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789ab';
      const text = [...createHash('sha256').update(randomUUID()).digest()].slice(0, 20).map((byte) => alphabet[byte & 31]).join('');
      const code = `${text.slice(0, 5)}-${text.slice(5, 10)}-${text.slice(10, 15)}-${text.slice(15)}`;
      state.invites.set(hashOf(code), { quotaS: Math.round(minutes * 60), usedS: 0, revoked: false });
      return code;
    },
    /** Changes what an invite has left (as if other jobs had used it up meanwhile). */
    setInviteMinutes(code, minutes) {
      const invite = state.invites.get(hashOf(code));
      if (invite) invite.quotaS = invite.usedS + Math.round(minutes * 60);
    },
    revokeInvite(code) {
      const invite = state.invites.get(hashOf(code));
      if (invite) invite.revoked = true;
    },
    kill(value) {
      state.killed = value;
    },
    /** Steer the faked provider (see `freshProvider`). */
    provider(config) {
      Object.assign(state.provider, config);
    },
    /** Lets a held upload through (`holdUpload`). */
    releaseUpload() {
      for (const waiting of state.held.splice(0)) waiting();
    },
    providerState() {
      return { transcripts: [...state.transcripts.values()].map((transcript) => ({ deleted: transcript.deleted })), uploads: state.uploadsAtProvider.size };
    },
    /** Every request received, in order (never the invite code itself). */
    get requests() {
      return state.requests;
    },
    /** Every complete upload: the bytes the browser sent, as they arrived. */
    get uploads() {
      return state.uploads;
    },
    get abortedUploads() {
      return state.abortedUploads;
    },
    jobs() {
      return [...state.jobs.values()].map((job) => ({ id: job.id, state: job.state, atProvider: job.transcriptId !== null && !job.providerDeleted, reservedS: job.reservedS, actualS: job.actualS }));
    },
    async close() {
      for (const waiting of state.held.splice(0)) waiting();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
