/**
 * The provider, faked, for the Worker's tests. It runs in the Node process of
 * the test runner as Miniflare's `outboundService`: EVERY outgoing fetch of
 * the Worker and of its Durable Object lands here, so the tests cannot reach
 * the internet at all — a request to any host other than `provider.mock` is
 * answered with 599 and recorded as a leak.
 *
 * Tests steer it and read what it saw through `http://provider.mock/__mock/*`.
 */
const HOST = 'provider.mock';
export const MOCK_KEY = 'mock-worker-key-5d0c';

const fresh = () => ({
  config: { pollsUntilDone: 1, failUpload: 0, failCreate: 0, failStatus: 0, transcriptError: null, audioDurationS: null, bigResult: false },
  requests: [],
  leaks: [],
  uploads: new Map(),
  transcripts: new Map(),
  counter: 0,
});
let state = fresh();

const json = (Response, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createOutboundService(Response) {
  return async function outboundService(request) {
    const url = new URL(request.url);
    if (url.hostname !== HOST) {
      state.leaks.push(`${request.method} ${url.origin}${url.pathname}`);
      return new Response('no network in tests', { status: 599 });
    }
    if (url.pathname === '/__mock/reset') {
      state = fresh();
      return json(Response, {});
    }
    if (url.pathname === '/__mock/config') {
      Object.assign(state.config, await request.json());
      return json(Response, state.config);
    }
    if (url.pathname === '/__mock/state') {
      return json(Response, {
        requests: state.requests,
        leaks: state.leaks,
        uploads: state.uploads.size,
        transcripts: [...state.transcripts.entries()].map(([id, t]) => ({ id, deleted: t.deleted, params: t.params, polls: t.polls })),
      });
    }

    const body = request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);
    const keyOk = request.headers.get('authorization') === MOCK_KEY;
    state.requests.push({ method: request.method, path: url.pathname.replace(/t-\d+$/, ':id'), keyOk, bytes: body.length, head: body.subarray(0, 4).toString('latin1'), contentType: request.headers.get('content-type') });
    if (!keyOk) return json(Response, { error: 'Authentication error, API token missing/invalid' }, 401);

    if (request.method === 'POST' && url.pathname === '/v2/upload') {
      if (state.config.failUpload) return json(Response, { error: 'SECRET PROVIDER TEXT upload' }, state.config.failUpload);
      const uploadUrl = `https://cdn.provider.mock/upload/u-${(state.counter += 1)}`;
      state.uploads.set(uploadUrl, body.length);
      return json(Response, { upload_url: uploadUrl });
    }
    if (request.method === 'POST' && url.pathname === '/v2/transcript') {
      if (state.config.failCreate) return json(Response, { error: 'SECRET PROVIDER TEXT create' }, state.config.failCreate);
      const params = JSON.parse(body.toString('utf8'));
      if (!state.uploads.has(params.audio_url)) return json(Response, { error: 'unknown audio_url' }, 400);
      const id = `t-${(state.counter += 1)}`;
      state.transcripts.set(id, { params, polls: 0, deleted: false });
      return json(Response, { id, status: 'queued' });
    }
    const match = /^\/v2\/transcript\/(t-\d+)$/.exec(url.pathname);
    const transcript = match && state.transcripts.get(match[1]);
    if (transcript && request.method === 'GET') {
      if (transcript.deleted) return json(Response, { error: 'transcript deleted' }, 404);
      if (state.config.failStatus) return json(Response, { error: 'SECRET PROVIDER TEXT status' }, state.config.failStatus);
      transcript.polls += 1;
      if (transcript.polls <= state.config.pollsUntilDone) return json(Response, { id: match[1], status: transcript.polls === 1 ? 'queued' : 'processing', words: null, audio_duration: null });
      if (state.config.transcriptError) return json(Response, { id: match[1], status: 'error', error: state.config.transcriptError });
      const words = [{ text: 'Merhaba', start: 100, end: 500, confidence: 0.99, speaker: 'A' }, { text: 'dünya.', start: 550, end: 900, confidence: 0.98, speaker: 'B' }];
      if (state.config.bigResult) for (let i = 0; i < 2000; i += 1) words.push({ text: `word${i}`, start: 1000 + i * 300, end: 1250 + i * 300, confidence: 0.9, speaker: 'A' });
      return json(Response, {
        id: match[1],
        status: 'completed',
        text: 'Merhaba dünya.',
        words,
        utterances: null,
        language_code: transcript.params.language_code ?? 'tr',
        audio_duration: state.config.audioDurationS ?? Math.round(transcript.params.audio_end_at / 1000) - 1,
      });
    }
    if (transcript && request.method === 'DELETE') {
      transcript.deleted = true;
      state.uploads.delete(transcript.params.audio_url);
      return json(Response, { id: match[1], status: 'completed', text: 'Deleted by user.' });
    }
    return json(Response, { error: 'not found' }, 404);
  };
}
