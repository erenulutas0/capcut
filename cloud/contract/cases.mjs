/**
 * The browser-facing contract of the transcript proxy (ADR-039), as cases
 * that run against TWO implementations:
 *
 *  - the real Worker code inside workerd with its real Durable Object
 *    (cloud/worker/test/contract.test.ts), and
 *  - the local fake the web app's tests talk to (cloud/fake-worker/server.mjs,
 *    run by cloud/fake-worker/test/contract.test.mjs).
 *
 * One list, two runners: when the Worker's answers change, the fake fails the
 * same case until it is changed too — the web tests cannot drift onto an API
 * that no longer exists.
 *
 * A case gets a `driver` and throws when an answer is not the expected one.
 * Plain JavaScript without Node APIs: it also runs inside workerd.
 *
 * The driver (one per implementation):
 *   origin                       an allowed site origin
 *   send(path, init)             → { status, headers: Headers, text }   (init: method, headers, body)
 *   newInvite(minutes)           → the invite code
 *   kill(on)                     the founder's emergency switch
 *   provider(config)             steer the faked provider: { pollsUntilDone, failUpload, failCreate, failStatus, transcriptError, audioDurationS }
 *   providerState()              → { transcripts: [{ deleted }], uploads }
 *   limits                       { rateLimitPerHour, monthlyCapUsd, priceUsdPerHour } the implementation was started with
 */

export function equal(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}
function truthy(value, what) {
  if (!value) throw new Error(`${what}: expected a true value, got ${JSON.stringify(value)}`);
}

/** Bytes that begin like a WebM (EBML) file — what the site sends. */
export function webm(bytes = 4096) {
  const data = new Uint8Array(bytes);
  data.set([0x1a, 0x45, 0xdf, 0xa3]);
  for (let i = 4; i < bytes; i += 1) data[i] = i % 251;
  return data;
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function client(driver, invite) {
  const auth = invite ? { authorization: `Bearer ${invite}` } : {};
  const parse = async (response) => {
    let body = null;
    try {
      body = JSON.parse(response.text);
    } catch {
      body = response.text;
    }
    return { status: response.status, headers: response.headers, body };
  };
  return {
    get: async (path) => parse(await driver.send(path, { method: 'GET', headers: { origin: driver.origin, ...auth } })),
    del: async (path) => parse(await driver.send(path, { method: 'DELETE', headers: { origin: driver.origin, ...auth } })),
    start: async ({ seconds, body = webm(), type = 'audio/webm', headers = {} }) =>
      parse(
        await driver.send('/v1/jobs', {
          method: 'POST',
          headers: { origin: driver.origin, ...auth, ...(type === null ? {} : { 'content-type': type }), 'x-audio-duration-s': String(seconds), ...headers },
          body,
        }),
      ),
  };
}

async function until(read, done, what) {
  for (let i = 0; i < 200; i += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${what}: not reached`);
}

export const CONTRACT_CASES = [
  {
    name: 'preflight: the site origin may send the headers the site uses; another origin gets nothing',
    run: async (driver) => {
      const ok = await driver.send('/v1/jobs', { method: 'OPTIONS', headers: { origin: driver.origin, 'access-control-request-method': 'POST' } });
      equal(ok.status, 204, 'preflight status');
      equal(ok.headers.get('access-control-allow-origin'), driver.origin, 'allow-origin');
      const allowed = (ok.headers.get('access-control-allow-headers') ?? '').split(',').map((name) => name.trim());
      for (const name of ['authorization', 'content-type', 'x-audio-duration-s', 'x-job-id', 'x-language']) truthy(allowed.includes(name), `preflight allows ${name}`);
      const methods = ok.headers.get('access-control-allow-methods') ?? '';
      for (const method of ['GET', 'POST', 'DELETE']) truthy(methods.includes(method), `preflight allows ${method}`);
      const other = await driver.send('/v1/jobs', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
      equal(other.status, 403, 'foreign preflight');
      equal(other.headers.get('access-control-allow-origin'), null, 'foreign allow-origin');
    },
  },
  {
    name: 'another origin, no invite, a wrong invite',
    run: async (driver) => {
      const invite = await driver.newInvite(60);
      const foreign = await driver.send('/v1/quota', { method: 'GET', headers: { origin: 'https://evil.example', authorization: `Bearer ${invite}` } });
      equal([foreign.status, JSON.parse(foreign.text)], [403, { error: 'origin_not_allowed' }], 'foreign origin');
      const none = await client(driver, null).get('/v1/quota');
      equal([none.status, none.body], [401, { error: 'invite_required' }], 'no invite');
      const wrong = await client(driver, 'AAAAA-BBBBB-CCCCC-DDDDD').get('/v1/quota');
      equal([wrong.status, wrong.body], [401, { error: 'invite_invalid' }], 'wrong invite (quota)');
      const start = await client(driver, 'AAAAA-BBBBB-CCCCC-DDDDD').start({ seconds: 60 });
      equal([start.status, start.body], [401, { error: 'invite_invalid' }], 'wrong invite (start)');
      equal((await driver.providerState()).uploads, 0, 'nothing uploaded');
    },
  },
  {
    name: 'quota: minutes left, the longest job, and the answer carries CORS and no-store',
    run: async (driver) => {
      const invite = await driver.newInvite(60);
      const quota = await client(driver, invite).get('/v1/quota');
      equal([quota.status, quota.body], [200, { on: true, remainingMinutes: 60, maxJobMinutes: 120 }], 'quota');
      equal(quota.headers.get('access-control-allow-origin'), driver.origin, 'quota allow-origin');
      equal(quota.headers.get('cache-control'), 'no-store', 'quota cache-control');
    },
  },
  {
    name: 'the emergency switch: quota says off, a start is refused, and it can be lifted',
    run: async (driver) => {
      const invite = await driver.newInvite(60);
      const api = client(driver, invite);
      await driver.kill(true);
      equal((await api.get('/v1/quota')).body, { on: false, remainingMinutes: 0, maxJobMinutes: 120 }, 'quota while off');
      const refused = await api.start({ seconds: 60 });
      equal([refused.status, refused.body], [503, { error: 'cloud_off' }], 'start while off');
      equal((await driver.providerState()).uploads, 0, 'nothing uploaded while off');
      await driver.kill(false);
      equal((await api.start({ seconds: 60 })).status, 202, 'start after the switch is lifted');
    },
  },
  {
    name: 'refused at the door: not audio, no length, too long, too heavy, a bad language, a bad job name',
    run: async (driver) => {
      const invite = await driver.newInvite(100);
      const api = client(driver, invite);
      for (const type of ['video/mp4', 'application/octet-stream', 'video/webm']) {
        const response = await api.start({ seconds: 60, type });
        equal([response.status, response.body], [415, { error: 'not_audio' }], `type ${type}`);
      }
      // Says audio/webm, begins like an MP4: refused on its first bytes.
      const mp4 = new Uint8Array(4096);
      mp4.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
      const disguised = await api.start({ seconds: 60, body: mp4 });
      equal([disguised.status, disguised.body], [415, { error: 'not_audio' }], 'disguised');
      for (const seconds of [0, -5, 'abc']) equal((await api.start({ seconds })).body, { error: 'duration_required' }, `seconds ${seconds}`);
      const long = await api.start({ seconds: 120 * 60 + 1 });
      equal([long.status, long.body], [413, { error: 'too_long', maxJobMinutes: 120 }], 'too long');
      const heavy = await api.start({ seconds: 10, body: webm(10 * 8000 + 65536 + 1) });
      equal([heavy.status, heavy.body], [413, { error: 'too_large' }], 'too heavy');
      const language = await api.start({ seconds: 60, headers: { 'x-language': 'tr; drop' } });
      equal([language.status, language.body], [400, { error: 'bad_language' }], 'bad language');
      const name = await api.start({ seconds: 60, headers: { 'x-job-id': 'not-a-uuid' } });
      equal([name.status, name.body], [400, { error: 'bad_job_id' }], 'bad job name');
      equal((await driver.providerState()).uploads, 0, 'nothing uploaded');
      // None of the refusals used the invite up.
      equal((await api.get('/v1/quota')).body, { on: true, remainingMinutes: 100, maxJobMinutes: 120 }, 'quota untouched');
    },
  },
  {
    name: 'both containers the site can make are accepted: WebM (Opus) and MP4 (AAC)',
    run: async (driver) => {
      const invite = await driver.newInvite(60);
      const api = client(driver, invite);
      const first = await api.start({ seconds: 30 });
      equal(first.status, 202, 'webm');
      await api.del(`/v1/jobs/${first.body.jobId}`);
      const m4a = new Uint8Array(4096);
      m4a.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
      equal((await api.start({ seconds: 30, type: 'audio/mp4', body: m4a })).status, 202, 'mp4');
    },
  },
  {
    name: 'a whole job: start (named by the browser) → status → result with words and speakers → gone at the provider',
    run: async (driver) => {
      const invite = await driver.newInvite(60);
      const api = client(driver, invite);
      await driver.provider({ pollsUntilDone: 2 });
      const started = await api.start({ seconds: 600, body: webm(50_000), headers: { 'x-job-id': uuid(1), 'x-language': 'tr' } });
      equal([started.status, started.body], [202, { jobId: uuid(1), status: 'queued', reservedMinutes: 10 }], 'start');
      equal((await api.get('/v1/quota')).body, { on: true, remainingMinutes: 50, maxJobMinutes: 120 }, 'quota while reserved');

      equal((await api.get(`/v1/jobs/${uuid(1)}`)).body, { status: 'queued' }, 'first status');
      const early = await api.get(`/v1/jobs/${uuid(1)}/result`);
      equal(early.status, 409, 'result before it is ready');
      equal(early.body.error, 'not_ready', 'result before it is ready');
      const done = await until(async () => (await api.get(`/v1/jobs/${uuid(1)}`)).body, (body) => body.status === 'completed', 'completed');
      equal(done, { status: 'completed', minutes: 10, resultAvailable: true }, 'completed');

      const result = await api.get(`/v1/jobs/${uuid(1)}/result`);
      equal(result.status, 200, 'result');
      equal(result.headers.get('access-control-allow-origin'), driver.origin, 'result allow-origin');
      equal(result.headers.get('cache-control'), 'no-store', 'result cache-control');
      equal(result.body.status, 'completed', 'result.status');
      truthy(Array.isArray(result.body.words) && result.body.words.length > 0, 'result.words');
      for (const word of result.body.words) {
        truthy(typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start, 'a word has text and millisecond times');
        truthy(typeof word.speaker === 'string', 'a word names its speaker');
      }
      truthy(typeof result.body.language_code === 'string', 'result.language_code');

      const state = await until(driver.providerState, (s) => s.transcripts.length === 1 && s.transcripts[0].deleted, 'deleted at the provider');
      equal(state.uploads, 0, 'the uploaded sound is gone too');
      await until(async () => (await api.get(`/v1/jobs/${uuid(1)}`)).body, (body) => body.resultAvailable === false, 'status after deletion');
      const again = await api.get(`/v1/jobs/${uuid(1)}/result`);
      equal([again.status, again.body], [410, { error: 'result_gone' }], 'result a second time');
      equal((await api.get('/v1/quota')).body, { on: true, remainingMinutes: 50, maxJobMinutes: 120 }, 'quota after the job');
    },
  },
  {
    name: 'without a name from the browser the proxy names the job',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      const started = await api.start({ seconds: 60 });
      equal(started.status, 202, 'start');
      truthy(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(started.body.jobId), 'a UUID');
    },
  },
  {
    name: 'one job at a time per invite; a job name that exists is refused; minutes that do not fit are refused',
    run: async (driver) => {
      const invite = await driver.newInvite(10);
      const api = client(driver, invite);
      equal((await api.start({ seconds: 360, headers: { 'x-job-id': uuid(2) } })).status, 202, 'first');
      const second = await api.start({ seconds: 60 });
      equal([second.status, second.body], [409, { error: 'job_in_progress' }], 'second while the first runs');
      await driver.provider({ pollsUntilDone: 0 });
      equal((await api.get(`/v1/jobs/${uuid(2)}`)).body.status, 'completed', 'first finished');
      const taken = await api.start({ seconds: 60, headers: { 'x-job-id': uuid(2) } });
      equal([taken.status, taken.body], [409, { error: 'job_id_taken' }], 'name taken');
      const tooMuch = await api.start({ seconds: 241 });
      equal([tooMuch.status, tooMuch.body], [402, { error: 'invite_minutes_used_up' }], 'does not fit');
      equal((await api.start({ seconds: 240 })).status, 202, 'fits exactly');
    },
  },
  {
    name: 'a job belongs to its invite; unknown jobs are not found',
    run: async (driver) => {
      const mine = client(driver, await driver.newInvite(60));
      const other = client(driver, await driver.newInvite(60));
      equal((await mine.start({ seconds: 60, headers: { 'x-job-id': uuid(3) } })).status, 202, 'start');
      for (const response of [await other.get(`/v1/jobs/${uuid(3)}`), await other.get(`/v1/jobs/${uuid(3)}/result`), await other.del(`/v1/jobs/${uuid(3)}`), await mine.get(`/v1/jobs/${uuid(999)}`)]) {
        equal([response.status, response.body], [404, { error: 'job_not_found' }], 'someone else\'s or unknown job');
      }
      equal((await driver.providerState()).transcripts[0].deleted, false, 'not deleted by a stranger');
    },
  },
  {
    name: 'delete while the provider still works: gone there at once, and the status says there is no result',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      await driver.provider({ pollsUntilDone: 50 });
      equal((await api.start({ seconds: 120, headers: { 'x-job-id': uuid(4) } })).status, 202, 'start');
      const deleted = await api.del(`/v1/jobs/${uuid(4)}`);
      equal([deleted.status, deleted.body], [200, { deleted: true }], 'delete');
      const state = await driver.providerState();
      equal([state.transcripts[0].deleted, state.uploads], [true, 0], 'gone at the provider');
      equal((await api.get(`/v1/jobs/${uuid(4)}`)).body, { status: 'completed', minutes: 2, resultAvailable: false }, 'status after delete');
      equal((await api.get(`/v1/jobs/${uuid(4)}/result`)).status, 410, 'result after delete');
      // Deleting twice is not an error, and the invite is free for the next job.
      equal((await api.del(`/v1/jobs/${uuid(4)}`)).body, { deleted: true }, 'delete again');
      equal((await api.start({ seconds: 60 })).status, 202, 'next job');
    },
  },
  {
    name: 'the provider refuses the upload or the start: 502 naming the step only, minutes given back',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      await driver.provider({ failUpload: 500 });
      const upload = await api.start({ seconds: 600 });
      equal([upload.status, upload.body], [502, { error: 'provider_error', step: 'upload' }], 'upload refused');
      equal(upload.headers.get('access-control-allow-origin'), driver.origin, 'the refusal carries CORS');
      await driver.provider({ failUpload: 0, failCreate: 429 });
      const create = await api.start({ seconds: 600 });
      equal([create.status, create.body], [502, { error: 'provider_error', step: 'create' }], 'start refused');
      equal((await api.get('/v1/quota')).body.remainingMinutes, 60, 'minutes given back');
      await driver.provider({ failCreate: 0 });
      equal((await api.start({ seconds: 600 })).status, 202, 'the invite is not stuck');
    },
  },
  {
    name: 'the provider fails the transcript: status "error", no result, no minutes used',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      await driver.provider({ pollsUntilDone: 0, transcriptError: 'SECRET PROVIDER TEXT' });
      const started = await api.start({ seconds: 600 });
      const status = await api.get(`/v1/jobs/${started.body.jobId}`);
      equal(status.body, { status: 'error' }, 'status');
      const result = await api.get(`/v1/jobs/${started.body.jobId}/result`);
      equal([result.status, result.body], [409, { error: 'no_result' }], 'result');
      equal((await api.get('/v1/quota')).body.remainingMinutes, 60, 'no minutes used');
    },
  },
  {
    name: 'the provider\'s status cannot be read: 502 naming the step — and a delete still deletes there',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      const started = await api.start({ seconds: 120 });
      await driver.provider({ failStatus: 500 });
      const status = await api.get(`/v1/jobs/${started.body.jobId}`);
      equal([status.status, status.body], [502, { error: 'provider_error', step: 'status' }], 'status');
      const deleted = await api.del(`/v1/jobs/${started.body.jobId}`);
      equal([deleted.status, deleted.body], [200, { deleted: true }], 'delete');
      const state = await driver.providerState();
      equal([state.transcripts[0].deleted, state.uploads], [true, 0], 'gone at the provider');
      // Stopped while it may have been working: the reservation counts as used.
      equal((await api.get('/v1/quota')).body.remainingMinutes, 58, 'quota');
    },
  },
  {
    name: 'the provider\'s own length is what is used up',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      await driver.provider({ pollsUntilDone: 0, audioDurationS: 299.4 });
      const started = await api.start({ seconds: 300 });
      equal((await api.get(`/v1/jobs/${started.body.jobId}`)).body, { status: 'completed', minutes: 5, resultAvailable: true }, 'status');
      equal((await api.get('/v1/quota')).body.remainingMinutes, 55, 'quota');
    },
  },
  {
    name: 'monthly cap: a job that would pass it is refused, and quota shows what the cap still allows',
    run: async (driver) => {
      const { monthlyCapUsd, priceUsdPerHour } = driver.limits;
      const hoursUnderCap = monthlyCapUsd / priceUsdPerHour;
      // Two-hour jobs until the next one would pass the cap.
      const fit = Math.floor(hoursUnderCap / 2);
      await driver.provider({ pollsUntilDone: 0 });
      for (let n = 0; n < fit; n += 1) {
        const api = client(driver, await driver.newInvite(600));
        const started = await api.start({ seconds: 7200 });
        equal(started.status, 202, `job ${n + 1} under the cap`);
        equal((await api.get(`/v1/jobs/${started.body.jobId}`)).body.status, 'completed', `job ${n + 1} finished`);
      }
      const api = client(driver, await driver.newInvite(600));
      const refused = await api.start({ seconds: 7200 });
      equal([refused.status, refused.body], [503, { error: 'monthly_cap_reached' }], 'the job over the cap');
      const leftMinutes = Math.floor((monthlyCapUsd * 1e6 - fit * Math.ceil((7200 * priceUsdPerHour * 1e6) / 3600)) * 3600 / (priceUsdPerHour * 1e6) / 60);
      equal((await api.get('/v1/quota')).body, { on: true, remainingMinutes: leftMinutes, maxJobMinutes: 120 }, 'quota under the cap');
    },
  },
  {
    name: 'per-address rate limit: attempts over the hourly limit are refused with Retry-After',
    run: async (driver) => {
      const invite = await driver.newInvite(600);
      for (let i = 0; i < driver.limits.rateLimitPerHour; i += 1) {
        equal((await client(driver, `WRONG-${i}`).start({ seconds: 60 })).status, 401, `attempt ${i + 1}`);
      }
      const limited = await client(driver, invite).start({ seconds: 60 });
      equal([limited.status, limited.body], [429, { error: 'rate_limited' }], 'over the limit');
      const retry = Number(limited.headers.get('retry-after'));
      truthy(retry > 0 && retry <= 3600, 'Retry-After within the hour');
      // Asking for the quota with a known code is not an attempt.
      equal((await client(driver, invite).get('/v1/quota')).status, 200, 'quota is not limited');
      // … but with an unknown code it is answered like a start over the limit: guessing is not cheaper here.
      const guess = await client(driver, 'WRONG-GUESS-AFTER-LIMIT').get('/v1/quota');
      equal([guess.status, guess.body], [429, { error: 'rate_limited' }], 'quota with a wrong code over the limit');
    },
  },
  {
    name: 'guessing codes through quota counts like guessing them through a start',
    run: async (driver) => {
      const invite = await driver.newInvite(60);
      for (let i = 0; i < driver.limits.rateLimitPerHour; i += 1) {
        const wrong = await client(driver, `WRONG-QUOTA-${i}`).get('/v1/quota');
        equal([wrong.status, wrong.body], [401, { error: 'invite_invalid' }], `guess ${i + 1}`);
      }
      const limited = await client(driver, 'WRONG-QUOTA-LAST').get('/v1/quota');
      equal([limited.status, limited.body], [429, { error: 'rate_limited' }], 'guess over the limit');
      const retry = Number(limited.headers.get('retry-after'));
      truthy(retry > 0 && retry <= 3600, 'Retry-After within the hour');
      // The same counter as the starts: a start from this address is refused too …
      const start = await client(driver, invite).start({ seconds: 60 });
      equal([start.status, start.body], [429, { error: 'rate_limited' }], 'start after guessing');
      equal((await driver.providerState()).uploads, 0, 'nothing uploaded');
      // … while the quota of a known code is still answered (the card asks for it on every opening).
      equal((await client(driver, invite).get('/v1/quota')).body, { on: true, remainingMinutes: 60, maxJobMinutes: 120 }, 'known code still answered');
    },
  },
  {
    name: 'unknown paths',
    run: async (driver) => {
      const api = client(driver, await driver.newInvite(60));
      const response = await api.get('/v1/nothing');
      equal([response.status, response.body], [404, { error: 'not_found' }], 'unknown path');
    },
  },
];
