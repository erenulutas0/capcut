/**
 * A small client for the provider's pre-recorded transcription API (AssemblyAI).
 *
 * Endpoints and shapes, as documented (all read on 2026-10-10):
 *  - POST   {base}/v2/upload            raw bytes, `Content-Type: application/octet-stream`
 *                                       → { upload_url }   (max 2.2 GB)
 *      https://www.assemblyai.com/docs/api-reference/files/upload
 *  - POST   {base}/v2/transcript        JSON { audio_url, speech_models, language_code |
 *                                       language_detection, speaker_labels, ... }
 *                                       → { id, status: queued|processing|completed|error, ... }
 *      https://www.assemblyai.com/docs/api-reference/transcripts/submit
 *  - GET    {base}/v2/transcript/{id}   → the transcript object; `words[].start/end` in ms,
 *                                       `audio_duration` in seconds
 *  - DELETE {base}/v2/transcript/{id}   removes the transcript's data and, with it, the file
 *                                       uploaded through /v2/upload
 *      https://www.assemblyai.com/docs/api-reference/transcripts/delete
 *  - auth: header `authorization: <key>`
 *  - bases: https://api.assemblyai.com (US), https://api.eu.assemblyai.com (EU)
 *
 * SAFETY: the client refuses any non-loopback host unless it was built with
 * `approved: true`. The command line sets that only with
 * `--i-have-founder-approval`. Tests and dry runs can therefore not reach the
 * provider by accident.
 */
import { redact } from './secrets.mjs';

export const PROVIDER_BASES = Object.freeze({
  us: 'https://api.assemblyai.com',
  eu: 'https://api.eu.assemblyai.com',
});

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const isLoopbackUrl = (url) => LOOPBACK.has(new URL(url).hostname);

export class ProviderError extends Error {
  constructor(message, { status = null, code = 'provider_error', attempts = 1 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.attempts = attempts;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.apiKey
 * @param {boolean} [options.approved]   must be true for a non-loopback base URL
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms:number)=>Promise<void>} [options.sleep]
 * @param {(line:string)=>void} [options.log]
 * @param {number} [options.maxAttempts]  per request, for 429 / 5xx / network errors
 * @param {number} [options.backoffBaseMs]
 * @param {number} [options.backoffMaxMs]
 * @param {()=>number} [options.random]   jitter source, 0..1
 */
export function createProviderClient(options) {
  const {
    baseUrl,
    apiKey,
    approved = false,
    fetchImpl = fetch,
    sleep = defaultSleep,
    log = () => {},
    maxAttempts = 5,
    backoffBaseMs = 1000,
    backoffMaxMs = 30000,
    random = Math.random,
  } = options;
  if (!apiKey) throw new ProviderError('no API key', { code: 'no_key' });
  if (!isLoopbackUrl(baseUrl) && approved !== true) {
    throw new ProviderError(`refusing to talk to ${new URL(baseUrl).host}: no founder approval for a real run`, { code: 'not_approved' });
  }
  const secrets = [apiKey];
  const safe = (text) => redact(text, secrets);
  const stats = { requests: 0, retries: 0, waitedMs: 0 };

  /** Delay before attempt n+1: Retry-After if the server sent one, else exponential with full jitter. */
  function backoffMs(attempt, retryAfterHeader) {
    const retryAfter = Number(retryAfterHeader);
    if (retryAfterHeader !== null && retryAfterHeader !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0) {
      return Math.min(backoffMaxMs, retryAfter * 1000);
    }
    const ceiling = Math.min(backoffMaxMs, backoffBaseMs * 2 ** (attempt - 1));
    return Math.round(ceiling / 2 + (ceiling / 2) * random());
  }

  async function request(method, path, { body, headers = {}, makeBody } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      stats.requests += 1;
      let response;
      try {
        const payload = makeBody ? makeBody() : body;
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: { authorization: apiKey, ...headers },
          body: payload,
          ...(payload && typeof payload === 'object' && typeof payload.getReader === 'function' ? { duplex: 'half' } : {}),
        });
      } catch (error) {
        lastError = new ProviderError(safe(`${method} ${path}: network error: ${error?.cause?.code ?? error?.message ?? error}`), { code: 'network', attempts: attempt });
        if (attempt === maxAttempts) break;
        const wait = backoffMs(attempt, null);
        stats.retries += 1;
        stats.waitedMs += wait;
        log(safe(`${method} ${path}: network error, retry ${attempt}/${maxAttempts - 1} in ${wait} ms`));
        await sleep(wait);
        continue;
      }
      if (response.ok) {
        const text = await response.text();
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw new ProviderError(safe(`${method} ${path}: HTTP ${response.status} with a body that is not JSON`), { status: response.status, code: 'bad_body', attempts: attempt });
        }
      }
      const text = await response.text().catch(() => '');
      let detail = text.slice(0, 300);
      try {
        const json = JSON.parse(text);
        if (typeof json?.error === 'string') detail = json.error;
      } catch {
        /* plain-text error body (the provider sends one for 422) */
      }
      lastError = new ProviderError(safe(`${method} ${path}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`), {
        status: response.status,
        code: response.status === 429 ? 'rate_limited' : response.status === 401 ? 'unauthorized' : 'http_error',
        attempts: attempt,
      });
      if (!RETRYABLE.has(response.status) || attempt === maxAttempts) break;
      const wait = backoffMs(attempt, response.headers.get('retry-after'));
      stats.retries += 1;
      stats.waitedMs += wait;
      log(safe(`${method} ${path}: HTTP ${response.status}, retry ${attempt}/${maxAttempts - 1} in ${wait} ms`));
      await sleep(wait);
    }
    throw lastError;
  }

  return {
    stats,
    /** Uploads audio bytes. `makeBody` is called once per attempt so a retry sends the file again from the start. */
    async upload(makeBody) {
      const json = await request('POST', '/v2/upload', { headers: { 'content-type': 'application/octet-stream' }, makeBody });
      if (typeof json.upload_url !== 'string') throw new ProviderError('upload: no upload_url in the answer', { code: 'bad_body' });
      return json.upload_url;
    },
    async createTranscript(params) {
      const json = await request('POST', '/v2/transcript', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
      if (typeof json.id !== 'string') throw new ProviderError('create transcript: no id in the answer', { code: 'bad_body' });
      return json;
    },
    getTranscript(id) {
      return request('GET', `/v2/transcript/${encodeURIComponent(id)}`);
    },
    /** Polls until `completed`; throws on `error` (not charged, per the provider's billing FAQ) or on timeout. */
    async waitForTranscript(id, { intervalMs = 3000, timeoutMs = 60 * 60 * 1000, now = Date.now } = {}) {
      const started = now();
      let polls = 0;
      for (;;) {
        const transcript = await this.getTranscript(id);
        polls += 1;
        if (transcript.status === 'completed') return { transcript, polls };
        if (transcript.status === 'error') {
          throw new ProviderError(safe(`transcript ${id} failed at the provider: ${transcript.error ?? 'no reason given'}`), { code: 'transcript_error' });
        }
        if (now() - started > timeoutMs) throw new ProviderError(`transcript ${id}: not finished after ${Math.round(timeoutMs / 1000)} s`, { code: 'timeout' });
        await sleep(intervalMs);
      }
    },
    deleteTranscript(id) {
      return request('DELETE', `/v2/transcript/${encodeURIComponent(id)}`);
    },
  };
}

/** The transcript request the harness sends. Word timestamps need no parameter: `words[]` always comes back. */
export function transcriptParams({ audioUrl, models, language, speakerLabels, speakersExpected = null }) {
  const params = { audio_url: audioUrl, speech_models: models, punctuate: true, format_text: true };
  if (language === 'auto') params.language_detection = true;
  else params.language_code = language;
  if (speakerLabels) {
    params.speaker_labels = true;
    if (Number.isInteger(speakersExpected) && speakersExpected > 0) params.speakers_expected = speakersExpected;
  }
  return params;
}
