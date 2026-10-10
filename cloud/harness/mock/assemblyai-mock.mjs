/**
 * A local stand-in for the provider's API, for tests. It listens on 127.0.0.1
 * only and implements the four calls the harness and the Worker make, with the
 * documented shapes (see lib/provider.mjs for the doc links):
 *
 *   POST   /v2/upload            → { upload_url }
 *   POST   /v2/transcript        → { id, status: "queued" }
 *   GET    /v2/transcript/:id    → queued → processing → completed | error
 *   DELETE /v2/transcript/:id    → the transcript with its text removed
 *
 * It is NOT the provider: it proves the client's sequencing, retry, redaction
 * and deletion logic, not the provider's accuracy, speed or real error texts.
 *
 * Behaviour switches (constructor options, all optional):
 *   apiKey            the only key accepted (401 otherwise)
 *   pollsUntilDone    how many GETs answer queued/processing first (default 2)
 *   failUploads       answer the first N uploads with `failStatus`
 *   failCreates       answer the first N transcript creations with `failStatus`
 *   failStatus        429 (default; sent with Retry-After) or 500 / 503
 *   retryAfterS       value of the Retry-After header on 429 (default 0)
 *   transcriptError   if set, the transcript ends in status "error" with this text
 *   echoAuthInErrors  put the received authorization value into error bodies
 *                     (a badly behaved server — the client must still redact it)
 *   words             [{ text, start, end, speaker? }] returned as the result (ms)
 *   audioDurationS    `audio_duration` of the result (default: derived from bytes)
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startMockProvider(options = {}) {
  const config = {
    apiKey: 'mock-key-0000',
    pollsUntilDone: 2,
    failUploads: 0,
    failCreates: 0,
    failStatus: 429,
    retryAfterS: 0,
    transcriptError: null,
    echoAuthInErrors: false,
    words: [
      { text: 'Hello', start: 100, end: 400, speaker: 'A' },
      { text: 'world.', start: 450, end: 900, speaker: 'A' },
    ],
    audioDurationS: null,
    ...options,
  };
  const state = {
    requests: [], // { method, path, authorization, contentType, bytes }
    uploads: new Map(), // upload_url → bytes
    transcripts: new Map(), // id → { polls, deleted, body, uploadUrl }
    failedUploads: 0,
    failedCreates: 0,
  };

  const send = (res, status, body, headers = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
    res.end(text);
  };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const authorization = req.headers.authorization ?? null;
    state.requests.push({ method: req.method, path: url.pathname, authorization, contentType: req.headers['content-type'] ?? null, bytes: body.length, head: body.subarray(0, 4).toString('latin1') });

    const fail = (status, message) => send(res, status, { error: config.echoAuthInErrors ? `${message} (authorization: ${authorization})` : message }, status === 429 ? { 'retry-after': String(config.retryAfterS) } : {});
    if (authorization !== config.apiKey) return fail(401, 'Authentication error, API token missing/invalid');

    if (req.method === 'POST' && url.pathname === '/v2/upload') {
      if (state.failedUploads < config.failUploads) {
        state.failedUploads += 1;
        return fail(config.failStatus, config.failStatus === 429 ? 'Too many requests' : 'Server error');
      }
      if (body.length === 0) return send(res, 422, 'Upload failed, please try again. If you continue to have issues please reach out to support@assemblyai.com');
      const uploadUrl = `https://cdn.assemblyai.invalid/upload/${randomUUID()}`;
      state.uploads.set(uploadUrl, body.length);
      return send(res, 200, { upload_url: uploadUrl });
    }

    if (req.method === 'POST' && url.pathname === '/v2/transcript') {
      if (state.failedCreates < config.failCreates) {
        state.failedCreates += 1;
        return fail(config.failStatus, config.failStatus === 429 ? 'Too many requests' : 'Server error');
      }
      let params;
      try {
        params = JSON.parse(body.toString('utf8'));
      } catch {
        return fail(400, 'Invalid JSON');
      }
      if (!state.uploads.has(params.audio_url)) return fail(400, 'audio_url is not a file uploaded to this mock');
      if (params.language_code && params.language_detection) return fail(400, 'language_code and language_detection cannot be combined');
      const id = randomUUID();
      state.transcripts.set(id, { polls: 0, deleted: false, params, uploadUrl: params.audio_url });
      return send(res, 200, { id, status: 'queued', audio_url: params.audio_url });
    }

    const match = /^\/v2\/transcript\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const transcript = state.transcripts.get(id);
      if (!transcript) return fail(404, 'Transcript lookup error, transcript id not found');
      if (req.method === 'GET') {
        if (transcript.deleted) return send(res, 200, { id, status: 'completed', text: null, words: null, utterances: null, audio_duration: 0 });
        transcript.polls += 1;
        if (transcript.polls <= config.pollsUntilDone) return send(res, 200, { id, status: transcript.polls === 1 ? 'queued' : 'processing' });
        if (config.transcriptError) return send(res, 200, { id, status: 'error', error: config.transcriptError });
        const bytes = state.uploads.get(transcript.uploadUrl) ?? 0;
        const withSpeakers = transcript.params.speaker_labels === true;
        const words = config.words.map((word) => ({ confidence: 0.99, ...word, speaker: withSpeakers ? (word.speaker ?? 'A') : null }));
        return send(res, 200, {
          id,
          status: 'completed',
          text: words.map((word) => word.text).join(' '),
          words,
          utterances: withSpeakers
            ? [...new Set(words.map((word) => word.speaker))].map((speaker) => {
                const own = words.filter((word) => word.speaker === speaker);
                return { speaker, text: own.map((word) => word.text).join(' '), start: own[0].start, end: own[own.length - 1].end, confidence: 0.99, words: own };
              })
            : null,
          audio_duration: config.audioDurationS ?? Math.max(1, Math.round(bytes / 3000)),
          language_code: transcript.params.language_code ?? 'en',
          speech_model_used: transcript.params.speech_models?.[0] ?? null,
        });
      }
      if (req.method === 'DELETE') {
        transcript.deleted = true;
        state.uploads.delete(transcript.uploadUrl);
        return send(res, 200, { id, status: 'completed', text: 'Deleted by user.', words: null, utterances: null });
      }
    }
    return fail(404, 'Not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    config,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
