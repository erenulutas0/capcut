/**
 * The proxy inside the real Workers runtime (workerd) with its real Durable
 * Object; the provider is the local fake (mock-upstream.mjs). No network.
 */
import { SELF, env, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import worker from '../src/index';
import type { Env } from '../src/config';

const ORIGIN = 'https://erenulutas0.github.io';
const BASE = 'https://proxy.test';
const ADMIN = 'test-admin-token-0123456789abcdef';
const MOCK = 'http://provider.mock/__mock';
const testEnv = env as unknown as Env;

interface MockState {
  requests: { method: string; path: string; keyOk: boolean; bytes: number; head: string; contentType: string | null }[];
  leaks: string[];
  uploads: number;
  transcripts: { id: string; deleted: boolean; polls: number; params: Record<string, unknown> }[];
}
const mockConfig = (config: Record<string, unknown>) => fetch(`${MOCK}/config`, { method: 'POST', body: JSON.stringify(config) });
const mockState = async () => (await (await fetch(`${MOCK}/state`)).json()) as MockState;

const admin = (path: string, init: RequestInit = {}) => SELF.fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${ADMIN}`, ...(init.headers ?? {}) } });
async function newInvite(minutes = 600, label = 'test'): Promise<string> {
  const response = await admin('/admin/invites', { method: 'POST', body: JSON.stringify({ label, minutes }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { code: string }).code;
}
const spend = async () => (await (await admin('/admin/spend')).json()) as { spentUsd: number; reservedUsd: number; on: boolean; activeJobs: number; transcriptsStillAtProvider: number; invites: { label: string; usedMinutes: number; revoked: unknown }[] };

/** Bytes that begin like an Ogg file. */
function ogg(bytes = 4096): Uint8Array {
  const data = new Uint8Array(bytes);
  data.set([0x4f, 0x67, 0x67, 0x53]);
  for (let i = 4; i < bytes; i += 1) data[i] = i % 251;
  return data;
}
interface StartOptions { invite: string; seconds: number; body?: BodyInit; type?: string; ip?: string; origin?: string | null; headers?: Record<string, string> }
function start({ invite, seconds, body = ogg(), type = 'audio/ogg', ip = '203.0.113.7', origin = ORIGIN, headers = {} }: StartOptions) {
  return SELF.fetch(`${BASE}/v1/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${invite}`, 'content-type': type, 'x-audio-duration-s': String(seconds), 'cf-connecting-ip': ip, ...(origin ? { origin } : {}), ...headers },
    body,
  });
}
const call = (path: string, invite: string, method = 'GET') => SELF.fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${invite}`, origin: ORIGIN } });
async function startOk(options: StartOptions): Promise<string> {
  const response = await start(options);
  expect(response.status, await response.clone().text()).toBe(202);
  return ((await response.json()) as { jobId: string }).jobId;
}
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not reached');
}
const ledger = () => testEnv.LEDGER.get(testEnv.LEDGER.idFromName('ledger'));
const dump = () =>
  runInDurableObject(ledger(), (_instance, state) =>
    JSON.stringify(['invites', 'jobs', 'months', 'rate', 'flags'].map((table) => state.storage.sql.exec(`SELECT * FROM ${table}`).toArray())),
  );

beforeEach(async () => {
  await reset();
  await fetch(`${MOCK}/reset`);
});
afterEach(async () => {
  expect((await mockState()).leaks, 'a request left for a host that is not the mock').toEqual([]);
});

describe('off unless the founder turns it on', () => {
  const request = () =>
    new Request(`${BASE}/v1/jobs`, { method: 'POST', headers: { authorization: 'Bearer x', origin: ORIGIN, 'content-type': 'audio/ogg', 'x-audio-duration-s': '60' }, body: ogg() });
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

  it('the shipped defaults (ENABLED=false, MONTHLY_CAP_USD=0) refuse every job and call nobody', async () => {
    const shipped = { ...testEnv, ENABLED: 'false', MONTHLY_CAP_USD: '0' };
    const response = await worker.fetch(request(), shipped, ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'cloud_off' });
    expect((await mockState()).requests).toEqual([]);
  });
  it('enabled but cap 0 is still off; cap set but not enabled is still off; no key is off', async () => {
    for (const override of [{ MONTHLY_CAP_USD: '0' }, { ENABLED: undefined }, { ENABLED: 'TRUE' }, { MONTHLY_CAP_USD: 'lots' }, { ASSEMBLYAI_API_KEY: undefined }, { ADMIN_TOKEN: undefined }]) {
      const response = await worker.fetch(request(), { ...testEnv, ...override } as Env, ctx);
      expect(response.status, JSON.stringify(override)).toBe(503);
    }
    expect((await mockState()).requests).toEqual([]);
  });
  it('the admin kill switch stops new jobs at once and can be lifted', async () => {
    const invite = await newInvite();
    await admin('/admin/kill', { method: 'POST', body: JSON.stringify({ on: true }) });
    const refused = await start({ invite, seconds: 60 });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: 'cloud_off' });
    expect((await spend()).on).toBe(false);
    expect((await (await call('/v1/quota', invite)).json()) as object).toMatchObject({ on: false, remainingMinutes: 0 });
    await admin('/admin/kill', { method: 'POST', body: JSON.stringify({ on: false }) });
    await startOk({ invite, seconds: 60 });
  });
});

describe('who may call', () => {
  it('preflight: the site origin gets CORS headers, any other origin does not', async () => {
    const ok = await SELF.fetch(`${BASE}/v1/jobs`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(ok.headers.get('access-control-allow-headers')).toContain('x-audio-duration-s');
    const other = await SELF.fetch(`${BASE}/v1/jobs`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('a request from another origin or with no origin is refused before anything else', async () => {
    const invite = await newInvite();
    for (const origin of ['https://evil.example', 'https://erenulutas0.github.io.evil.example', null]) {
      const response = await start({ invite, seconds: 60, origin });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect((await mockState()).requests).toEqual([]);
  });
  it('no invite, a wrong invite and a revoked invite are refused; nothing is uploaded', async () => {
    const none = await SELF.fetch(`${BASE}/v1/jobs`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'audio/ogg', 'x-audio-duration-s': '60' }, body: ogg() });
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'invite_required' });
    const wrong = await start({ invite: 'AAAAA-BBBBB-CCCCC-DDDDD', seconds: 60 });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'invite_invalid' });
    const invite = await newInvite(60, 'to-revoke');
    const id = ((await (await admin('/admin/spend')).json()) as { invites: { id: string }[] }).invites[0].id;
    expect(((await (await admin(`/admin/invites/${id}`, { method: 'DELETE' })).json()) as { revoked: number }).revoked).toBe(1);
    expect((await start({ invite, seconds: 60 })).status).toBe(401);
    expect((await mockState()).requests).toEqual([]);
  });
  it('the admin API needs the admin token and is invisible without it', async () => {
    for (const headers of [{}, { authorization: 'Bearer wrong-token-wrong-token-wrong' }, { authorization: `Bearer ${ADMIN}x` }] as Record<string, string>[]) {
      const response = await SELF.fetch(`${BASE}/admin/spend`, { headers });
      expect(response.status).toBe(404);
    }
    const ok = await admin('/admin/spend');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('a whole job', () => {
  it('start → status → result → deleted at the provider; the right things are sent upstream', async () => {
    const invite = await newInvite(60);
    const audio = ogg(50_000);
    await mockConfig({ pollsUntilDone: 2 });
    const jobId = await startOk({ invite, seconds: 600, body: audio, headers: { 'x-language': 'tr' } });

    let state = await mockState();
    expect(state.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /v2/upload', 'POST /v2/transcript']);
    expect(state.requests.every((r) => r.keyOk)).toBe(true);
    expect(state.requests[0]).toMatchObject({ bytes: 50_000, head: 'OggS', contentType: 'application/octet-stream' });
    expect(state.transcripts[0].params).toMatchObject({ speech_models: ['universal-3-5-pro'], language_code: 'tr', speaker_labels: true, audio_end_at: 601_000 });
    expect(state.transcripts[0].params.language_detection).toBeUndefined();
    expect((await spend()).reservedUsd).toBeCloseTo((600 / 3600) * 0.23, 4);

    expect(await (await call(`/v1/jobs/${jobId}`, invite)).json()).toEqual({ status: 'queued' });
    expect(await (await call(`/v1/jobs/${jobId}/result`, invite)).json()).toMatchObject({ error: 'not_ready' });
    const done = await until(async () => (await (await call(`/v1/jobs/${jobId}`, invite)).json()) as { status: string; minutes?: number; resultAvailable?: boolean }, (s) => s.status === 'completed');
    expect(done).toEqual({ status: 'completed', minutes: 10, resultAvailable: true });

    const result = await call(`/v1/jobs/${jobId}/result`, invite);
    expect(result.status).toBe(200);
    expect(result.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const transcript = (await result.json()) as { text: string; words: unknown[] };
    expect(transcript.text).toBe('Merhaba dünya.');
    expect(transcript.words).toHaveLength(2);

    state = await until(mockState, (s) => s.transcripts[0].deleted);
    expect(state.uploads).toBe(0);
    await until(async () => (await (await call(`/v1/jobs/${jobId}`, invite)).json()) as { resultAvailable?: boolean }, (s) => s.resultAvailable === false);
    expect((await call(`/v1/jobs/${jobId}/result`, invite)).status).toBe(410);

    const after = await spend();
    expect(after.spentUsd).toBeCloseTo((600 / 3600) * 0.23, 4);
    expect(after.reservedUsd).toBe(0);
    expect(after.invites[0].usedMinutes).toBe(10);
    expect(after.transcriptsStillAtProvider).toBe(0);
    expect(await (await call('/v1/quota', invite)).json()).toEqual({ on: true, remainingMinutes: 50, maxJobMinutes: 120 });
  });

  it('a finished transcript of megabytes is recognised without being parsed, and passed through whole', async () => {
    const invite = await newInvite();
    await mockConfig({ pollsUntilDone: 0, bigResult: true, audioDurationS: 299.4 });
    const jobId = await startOk({ invite, seconds: 300 });
    expect(await (await call(`/v1/jobs/${jobId}`, invite)).json()).toEqual({ status: 'completed', minutes: 5, resultAvailable: true });
    const body = await (await call(`/v1/jobs/${jobId}/result`, invite)).text();
    expect(body.length).toBeGreaterThan(100_000);
    expect((JSON.parse(body) as { words: unknown[] }).words).toHaveLength(2002);
  });

  it('automatic language detection is the default', async () => {
    const invite = await newInvite();
    await startOk({ invite, seconds: 60 });
    const params = (await mockState()).transcripts[0].params;
    expect(params.language_detection).toBe(true);
    expect(params.language_code).toBeUndefined();
  });

  it('a job belongs to the invite that started it; DELETE removes it at the provider', async () => {
    const mine = await newInvite(60, 'mine');
    const other = await newInvite(60, 'other');
    const jobId = await startOk({ invite: mine, seconds: 60 });
    expect((await call(`/v1/jobs/${jobId}`, other)).status).toBe(404);
    expect((await call(`/v1/jobs/${jobId}/result`, other)).status).toBe(404);
    expect((await call(`/v1/jobs/${jobId}`, other, 'DELETE')).status).toBe(404);
    expect((await mockState()).transcripts[0].deleted).toBe(false);
    const deleted = await call(`/v1/jobs/${jobId}`, mine, 'DELETE');
    expect(await deleted.json()).toEqual({ deleted: true });
    expect((await mockState()).transcripts[0].deleted).toBe(true);
    // Cancelled while the provider was still working: the reservation counts as spent.
    expect((await spend()).spentUsd).toBeCloseTo((60 / 3600) * 0.23, 4);
  });
});

describe('what is refused at the door', () => {
  it('content that is not audio: by type and by its first bytes', async () => {
    const invite = await newInvite();
    for (const type of ['video/mp4', 'application/octet-stream', 'text/plain', '']) {
      const response = await start({ invite, seconds: 60, type });
      expect(response.status, type).toBe(415);
    }
    // Says audio/ogg, is an MP4 (a video container): refused after the first chunk, reservation given back.
    const mp4 = new Uint8Array(4096);
    mp4.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
    const disguised = await start({ invite, seconds: 60, body: mp4 });
    expect(disguised.status).toBe(415);
    expect(await disguised.json()).toEqual({ error: 'not_audio' });
    expect((await mockState()).requests).toEqual([]);
    expect((await spend()).reservedUsd).toBe(0);
    await startOk({ invite, seconds: 60 }); // the invite is not stuck
  });
  it('longer than the per-job maximum, or heavier than its declared length allows', async () => {
    const invite = await newInvite(10_000);
    const long = await start({ invite, seconds: 120 * 60 + 1 });
    expect(long.status).toBe(413);
    expect(await long.json()).toEqual({ error: 'too_long', maxJobMinutes: 120 });
    // 10 s declared → at most 10 × 8000 + 65536 bytes
    const heavy = await start({ invite, seconds: 10, body: ogg(10 * 8000 + 65536 + 1) });
    expect(heavy.status).toBe(413);
    expect(await heavy.json()).toEqual({ error: 'too_large' });
    for (const seconds of [0, -5, Number.NaN]) expect((await start({ invite, seconds })).status).toBe(400);
    expect((await start({ invite, seconds: 60, headers: { 'x-language': 'tr; drop' } })).status).toBe(400);
    expect((await mockState()).requests).toEqual([]);
  });
});

describe('cost control', () => {
  it('per-invite minutes: a job that does not fit is refused; one job at a time', async () => {
    const invite = await newInvite(10);
    const first = await startOk({ invite, seconds: 360 });
    const second = await start({ invite, seconds: 60 });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'job_in_progress' });
    await mockConfig({ pollsUntilDone: 0 });
    await call(`/v1/jobs/${first}`, invite);
    const tooMuch = await start({ invite, seconds: 241 });
    expect(tooMuch.status).toBe(402);
    expect(await tooMuch.json()).toEqual({ error: 'invite_minutes_used_up' });
    await startOk({ invite, seconds: 240 });
  });

  it('monthly cap ($1 here, $0.46 per two-hour job): the third job is refused, also when five start at the same moment', async () => {
    const invites = await Promise.all([1, 2, 3, 4, 5].map((n) => newInvite(600, `i${n}`)));
    const responses = await Promise.all(invites.map((invite, n) => start({ invite, seconds: 7200, ip: `198.51.100.${n}` })));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([202, 202, 503, 503, 503]);
    const refused = responses.find((response) => response.status === 503) as Response;
    expect(await refused.json()).toEqual({ error: 'monthly_cap_reached' });
    const totals = await spend();
    expect(totals.reservedUsd).toBeCloseTo(0.92, 4);
    expect(totals.reservedUsd + totals.spentUsd).toBeLessThanOrEqual(1);
    expect((await mockState()).requests.filter((r) => r.path === '/v2/upload')).toHaveLength(2);
    // A small job still fits under the cap: 0.92 + 20 min × 0.23/60 = 0.9967
    const small = responses.findIndex((response) => response.status === 503);
    await startOk({ invite: invites[small], seconds: 1200, ip: '198.51.100.99' });
    expect((await start({ invite: invites[(small + 1) % 5], seconds: 60, ip: '198.51.100.98' })).status).not.toBe(202);
  });

  it('the provider\'s own length is what is charged; a file much longer than declared suspends the invite', async () => {
    const invite = await newInvite(600, 'liar');
    await mockConfig({ pollsUntilDone: 0, audioDurationS: 1800 });
    const jobId = await startOk({ invite, seconds: 600 });
    expect(await (await call(`/v1/jobs/${jobId}`, invite)).json()).toMatchObject({ status: 'completed', minutes: 30 });
    const totals = await spend();
    expect(totals.spentUsd).toBeCloseTo(0.115, 4);
    expect(totals.invites[0]).toMatchObject({ usedMinutes: 30, revoked: 'longer_than_declared' });
    expect((await start({ invite, seconds: 60 })).status).toBe(401);
  });

  it('a length within tolerance of the declared one does not suspend the invite', async () => {
    const invite = await newInvite(600);
    await mockConfig({ pollsUntilDone: 0, audioDurationS: 602.4 });
    const jobId = await startOk({ invite, seconds: 600 });
    await call(`/v1/jobs/${jobId}`, invite);
    expect((await spend()).invites[0].revoked).toBe(false);
  });

  it('a transcript that fails at the provider costs nothing', async () => {
    const invite = await newInvite(60);
    await mockConfig({ pollsUntilDone: 0, transcriptError: 'SECRET PROVIDER TEXT' });
    const jobId = await startOk({ invite, seconds: 600 });
    const status = await call(`/v1/jobs/${jobId}`, invite);
    expect(await status.text()).toBe('{"status":"error"}');
    const totals = await spend();
    expect(totals.spentUsd).toBe(0);
    expect(totals.reservedUsd).toBe(0);
    expect(totals.invites[0].usedMinutes).toBe(0);
    expect((await call(`/v1/jobs/${jobId}/result`, invite)).status).toBe(409);
  });

  it('provider errors at upload or at start: 502 without the provider\'s text, reservation given back', async () => {
    const invite = await newInvite(60);
    await mockConfig({ failUpload: 500 });
    const upload = await start({ invite, seconds: 600 });
    expect(upload.status).toBe(502);
    expect(await upload.text()).toBe('{"error":"provider_error","step":"upload"}');
    await mockConfig({ failUpload: 0, failCreate: 429 });
    const create = await start({ invite, seconds: 600 });
    expect(await create.text()).toBe('{"error":"provider_error","step":"create"}');
    expect(create.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await spend()).reservedUsd).toBe(0);
    await mockConfig({ failCreate: 0 });
    await startOk({ invite, seconds: 600 });
  });

  it('per-IP rate limit: the 31st attempt in an hour is refused, wrong invites count, another address is not affected', async () => {
    const invite = await newInvite(600);
    for (let i = 0; i < 30; i += 1) expect((await start({ invite: `WRONG-${i}`, seconds: 60, ip: '192.0.2.50' })).status).toBe(401);
    const limited = await start({ invite, seconds: 60, ip: '192.0.2.50' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(limited.headers.get('retry-after'))).toBeLessThanOrEqual(3600);
    await startOk({ invite, seconds: 60, ip: '192.0.2.51' });
  });
});

describe('privacy', () => {
  it('the ledger holds no audio, no text, no invite code, no IP address — and forgets the transcript id', async () => {
    const invite = await newInvite(60, 'p');
    await mockConfig({ pollsUntilDone: 0 });
    const jobId = await startOk({ invite, seconds: 60, ip: '203.0.113.99' });
    await call(`/v1/jobs/${jobId}`, invite);
    await (await call(`/v1/jobs/${jobId}/result`, invite)).text();
    await until(mockState, (s) => s.transcripts[0].deleted);
    const stored = await until(dump, (text) => !text.includes('"t-'));
    expect(stored).not.toContain(invite);
    expect(stored).not.toContain('203.0.113.99');
    expect(stored).not.toContain('Merhaba');
    expect(stored).not.toContain('OggS');
    expect(stored).not.toContain('mock-worker-key');
    const tables = JSON.parse(stored) as Record<string, unknown>[][];
    expect(Object.keys(tables[1][0]).sort()).toEqual(['actual_s', 'bytes', 'charged_micro', 'created_at', 'declared_s', 'id', 'invite_hash', 'month', 'provider_deleted', 'reserved_micro', 'reserved_s', 'state', 'transcript_id', 'updated_at']);
    expect(tables[1][0]).toMatchObject({ transcript_id: null, provider_deleted: 1, state: 'completed' });
    expect(Object.keys(tables[3][0]).sort()).toEqual(['count', 'ip_hash', 'window']);
  });

  it('clean-up alarm: old IP counters go, a stuck reservation is given back, an unfetched transcript is deleted at the provider', async () => {
    const fetched = await newInvite(60, 'never-fetched');
    const stuck = await newInvite(60, 'stuck');
    await mockConfig({ pollsUntilDone: 0 });
    const jobId = await startOk({ invite: fetched, seconds: 60 });
    await call(`/v1/jobs/${jobId}`, fetched); // completed, result never fetched
    const hour = 3600_000;
    await runInDurableObject(ledger(), (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec('UPDATE jobs SET updated_at = updated_at - ? WHERE id = ?', 2 * hour, jobId);
      sql.exec("INSERT INTO jobs (id, invite_hash, month, state, declared_s, reserved_s, reserved_micro, bytes, created_at, updated_at) SELECT 'stuck-job', hash, '2026-10', 'reserved', 600, 600, 38334, 1, ?, ? FROM invites WHERE label = 'stuck'", Date.now() - hour, Date.now() - hour);
      sql.exec("INSERT INTO rate (ip_hash, window, count) VALUES ('old', 1, 5)");
    });
    expect((await mockState()).transcripts[0].deleted).toBe(false);
    expect(await runDurableObjectAlarm(ledger())).toBe(true);
    expect((await mockState()).transcripts[0].deleted).toBe(true);
    const tables = JSON.parse(await dump()) as Record<string, unknown>[][];
    expect(tables[1].find((job) => job.id === jobId)).toMatchObject({ transcript_id: null, provider_deleted: 1 });
    expect(tables[1].find((job) => job.id === 'stuck-job')).toMatchObject({ state: 'failed' });
    expect(tables[3].some((row) => row.ip_hash === 'old')).toBe(false);
    expect((await spend()).reservedUsd).toBe(0);
    await startOk({ invite: stuck, seconds: 60 });
  });
});
