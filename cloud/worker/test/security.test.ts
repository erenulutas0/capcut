/**
 * The threat model of cloud/SECURITY.md, item by item, against the real
 * Worker code in workerd with its real Durable Object and the faked provider
 * (mock-upstream.mjs). No network. Each test names the threat it answers.
 */
import { SELF, env, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../src/config';
import { MOCK_KEY } from './mock-upstream.mjs';

const ORIGIN = 'https://erenulutas0.github.io';
const BASE = 'https://proxy.test';
const ADMIN = 'test-admin-token-0123456789abcdef';
const MOCK = 'http://provider.mock/__mock';
const testEnv = env as unknown as Env;

interface MockState {
  requests: { method: string; path: string }[];
  leaks: string[];
  uploads: number;
  transcripts: { id: string; deleted: boolean; params: Record<string, unknown> }[];
}
const mockConfig = (config: Record<string, unknown>) => fetch(`${MOCK}/config`, { method: 'POST', body: JSON.stringify(config) });
const mockState = async () => (await (await fetch(`${MOCK}/state`)).json()) as MockState;
const admin = (path: string, init: RequestInit = {}) => SELF.fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${ADMIN}`, ...(init.headers ?? {}) } });
async function newInvite(minutes = 600, label = 'test'): Promise<string> {
  const response = await admin('/admin/invites', { method: 'POST', body: JSON.stringify({ label, minutes }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { code: string }).code;
}
interface Spend { spentUsd: number; reservedUsd: number; capUsd: number; on: boolean; killSwitch: boolean; activeJobs: number; transcriptsStillAtProvider: number; invites: { label: string; usedMinutes: number; revoked: unknown }[] }
const spend = async () => (await (await admin('/admin/spend')).json()) as Spend;

function ogg(bytes = 4096): Uint8Array {
  const data = new Uint8Array(bytes);
  data.set([0x4f, 0x67, 0x67, 0x53]);
  for (let i = 4; i < bytes; i += 1) data[i] = i % 251;
  return data;
}
interface StartOptions { invite: string; seconds: number; body?: BodyInit; ip?: string; origin?: string | null; headers?: Record<string, string> }
function start({ invite, seconds, body = ogg(), ip = '203.0.113.7', origin = ORIGIN, headers = {} }: StartOptions) {
  return SELF.fetch(`${BASE}/v1/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${invite}`, 'content-type': 'audio/ogg', 'x-audio-duration-s': String(seconds), 'cf-connecting-ip': ip, ...(origin ? { origin } : {}), ...headers },
    body,
  });
}
const call = (path: string, invite: string, method = 'GET', origin: string | null = ORIGIN) =>
  SELF.fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${invite}`, ...(origin ? { origin } : {}) } });
async function startOk(options: StartOptions): Promise<string> {
  const response = await start(options);
  expect(response.status, await response.clone().text()).toBe(202);
  return ((await response.json()) as { jobId: string }).jobId;
}
const ledger = () => testEnv.LEDGER.get(testEnv.LEDGER.idFromName('ledger'));
const HOUR = 3600_000;

beforeEach(async () => {
  await reset();
  await fetch(`${MOCK}/reset`);
});
afterEach(async () => {
  expect((await mockState()).leaks, 'a request left for a host that is not the mock').toEqual([]);
});

describe('money', () => {
  it('the cap cannot be passed by a race: twelve half-hour starts at once, exactly the eight that fit are accepted', async () => {
    // $1 cap, 30 min at $0.23/h = $0.115 each: 8 × 0.115 = 0.92 fits, a ninth (1.035) does not.
    const invites = await Promise.all(Array.from({ length: 12 }, (_, n) => newInvite(600, `race-${n}`)));
    const responses = await Promise.all(invites.map((invite, n) => start({ invite, seconds: 1800, ip: `198.51.100.${n + 1}` })));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 202)).toHaveLength(8);
    expect(statuses.filter((status) => status === 503)).toHaveLength(4);
    const totals = await spend();
    expect(totals.reservedUsd).toBeCloseTo(0.92, 4);
    expect(totals.reservedUsd + totals.spentUsd).toBeLessThanOrEqual(totals.capUsd);
    expect((await mockState()).uploads).toBe(8);
  });

  it('a stolen invite used from many addresses at once starts one job, not many', async () => {
    const invite = await newInvite(600, 'stolen');
    const responses = await Promise.all(Array.from({ length: 6 }, (_, n) => start({ invite, seconds: 600, ip: `192.0.2.${n + 10}` })));
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409, 409, 409, 409, 409]);
    expect((await mockState()).uploads).toBe(1);
    expect((await spend()).activeJobs).toBe(1);
  });

  it('a provider that never finishes does not hold the money for ever: after 24 h the alarm settles the reservation, deletes there, frees the invite', async () => {
    const invite = await newInvite(60, 'slow');
    await mockConfig({ pollsUntilDone: 1000 });
    const jobId = await startOk({ invite, seconds: 600 });
    expect((await spend()).reservedUsd).toBeCloseTo((600 / 3600) * 0.23, 4);
    expect((await start({ invite, seconds: 60 })).status).toBe(409);
    await runInDurableObject(ledger(), (_instance, state) => {
      state.storage.sql.exec('UPDATE jobs SET created_at = created_at - ? WHERE id = ?', 25 * HOUR, jobId);
    });
    expect(await runDurableObjectAlarm(ledger())).toBe(true);
    const totals = await spend();
    expect(totals.reservedUsd).toBe(0);
    expect(totals.spentUsd).toBeCloseTo((600 / 3600) * 0.23, 4);
    expect(totals.invites[0].usedMinutes).toBe(10);
    expect(totals.transcriptsStillAtProvider).toBe(0);
    expect((await mockState()).transcripts[0].deleted).toBe(true);
    await startOk({ invite, seconds: 60 });
  });

  it('the kill switch refuses every new start and quota says off, while a job already running can still be finished and deleted', async () => {
    const invite = await newInvite(60);
    await mockConfig({ pollsUntilDone: 0 });
    const jobId = await startOk({ invite, seconds: 60 });
    await admin('/admin/kill', { method: 'POST', body: JSON.stringify({ on: true }) });
    expect((await start({ invite: await newInvite(60, 'late'), seconds: 60, ip: '192.0.2.77' })).status).toBe(503);
    expect(await (await call('/v1/quota', invite)).json()).toMatchObject({ on: false, remainingMinutes: 0 });
    expect(await (await call(`/v1/jobs/${jobId}`, invite)).json()).toMatchObject({ status: 'completed' });
    expect((await call(`/v1/jobs/${jobId}/result`, invite)).status).toBe(200);
    expect(await (await call(`/v1/jobs/${jobId}`, invite, 'DELETE')).json()).toEqual({ deleted: true });
    expect((await mockState()).requests.filter((r) => r.path === '/v2/upload')).toHaveLength(1);
  });

  it('M5: a file longer than declared that is deleted before the provider finishes is charged the reservation plus the upload slack (89 s for "1 s + 64 KB"), not one second', async () => {
    const invite = await newInvite(60, 'liar');
    await mockConfig({ pollsUntilDone: 1000, audioDurationS: 3600 });
    const jobId = await startOk({ invite, seconds: 1, body: ogg(8000 + 64 * 1024) });
    expect(await (await call(`/v1/jobs/${jobId}`, invite, 'DELETE')).json()).toEqual({ deleted: true });
    const totals = await spend();
    // An estimate is charged, but it never suspends the invite (only the provider's own length does).
    expect(totals.invites[0]).toMatchObject({ usedMinutes: 1.5, revoked: false });
    expect(totals.spentUsd).toBe(0.0057); // 89 s at $0.23/h, as spend shows it (4 decimals)
    // What the provider was told limits the damage: only the declared second (+1) is to be transcribed.
    expect((await mockState()).transcripts[0].params.audio_end_at).toBe(2000);
    // Whether the provider bills a deleted-in-progress transcript, and whether by audio_end_at: not provable here.
  });

  it('M5 bound: the "declare 1 s, send 64 KB, delete before the end" loop runs out of invite minutes after 41 rounds (one second each would have allowed 3600)', async () => {
    const invite = await newInvite(60, 'loop');
    await mockConfig({ pollsUntilDone: 1000 });
    let rounds = 0;
    for (;;) {
      // A fresh address each round: the hourly per-address limit is not what stops this.
      const response = await start({ invite, seconds: 1, body: ogg(8000 + 64 * 1024), ip: `198.18.${Math.floor(rounds / 250)}.${(rounds % 250) + 1}` });
      if (response.status !== 202) {
        expect(response.status).toBe(402);
        expect(await response.json()).toEqual({ error: 'invite_minutes_used_up' });
        break;
      }
      const { jobId } = (await response.json()) as { jobId: string };
      expect((await call(`/v1/jobs/${jobId}`, invite, 'DELETE')).status).toBe(200);
      rounds += 1;
      expect(rounds).toBeLessThan(100);
    }
    // Round k+1 is accepted while 89·k + 1 ≤ 3600: 41 rounds, then the minutes are gone.
    expect(rounds).toBe(41);
    const totals = await spend();
    expect(totals.invites[0].usedMinutes).toBeCloseTo((41 * 89) / 60, 1);
    expect(totals.invites[0].revoked).toBe(false);
    expect(totals.transcriptsStillAtProvider).toBe(0);
  });

  it('M5 for honest users: a 10-minute job (24 kbit/s) cancelled while the provider works is charged its reservation plus at most 88 s', async () => {
    const invite = await newInvite(60, 'honest');
    await mockConfig({ pollsUntilDone: 1000 });
    const jobId = await startOk({ invite, seconds: 600, body: ogg(600 * 3000) });
    expect((await call(`/v1/jobs/${jobId}`, invite, 'DELETE')).status).toBe(200);
    expect((await spend()).invites[0]).toMatchObject({ usedMinutes: Number(((600 + 88) / 60).toFixed(1)), revoked: false });
  });
});

describe('data', () => {
  it('neither the provider key nor the admin token appears in any answer, header or ledger row — including error paths', async () => {
    const invite = await newInvite(60);
    const texts: string[] = [];
    const take = async (response: Response) => {
      texts.push(await response.text(), JSON.stringify([...response.headers]));
    };
    await mockConfig({ failUpload: 500 });
    await take(await start({ invite, seconds: 60 }));
    await mockConfig({ failUpload: 0, failCreate: 401 });
    await take(await start({ invite, seconds: 60 }));
    await mockConfig({ failCreate: 0, failStatus: 500 });
    const jobId = await startOk({ invite, seconds: 60 });
    await take(await call(`/v1/jobs/${jobId}`, invite));
    await mockConfig({ failStatus: 0, pollsUntilDone: 0 });
    await take(await call(`/v1/jobs/${jobId}`, invite));
    await take(await call(`/v1/jobs/${jobId}/result`, invite));
    await take(await call(`/v1/jobs/${jobId}`, invite, 'DELETE'));
    await take(await admin('/admin/spend'));
    await take(await SELF.fetch(`${BASE}/admin/spend`, { headers: { authorization: 'Bearer nope' } }));
    const rows = await runInDurableObject(ledger(), (_instance, state) =>
      JSON.stringify(['invites', 'jobs', 'months', 'rate', 'flags'].map((table) => state.storage.sql.exec(`SELECT * FROM ${table}`).toArray())),
    );
    for (const text of [...texts, rows]) {
      expect(text).not.toContain(MOCK_KEY);
      expect(text).not.toContain(ADMIN);
      expect(text).not.toContain(invite);
      expect(text).not.toContain('SECRET PROVIDER TEXT');
      expect(text).not.toContain('203.0.113.7');
    }
  });

  it('a foreign origin holding a valid invite and a valid job id gets nothing: no body it can use, no CORS header on any route', async () => {
    const invite = await newInvite(60);
    await mockConfig({ pollsUntilDone: 0 });
    const jobId = await startOk({ invite, seconds: 60 });
    for (const [path, method] of [['/v1/quota', 'GET'], [`/v1/jobs/${jobId}`, 'GET'], [`/v1/jobs/${jobId}/result`, 'GET'], [`/v1/jobs/${jobId}`, 'DELETE']] as const) {
      for (const origin of ['https://evil.example', 'null', null]) {
        const response = await call(path, invite, method, origin);
        expect(response.status, `${method} ${path} from ${origin}`).toBe(403);
        expect(await response.json()).toEqual({ error: 'origin_not_allowed' });
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(response.headers.get('access-control-allow-credentials')).toBeNull();
      }
    }
    expect((await mockState()).transcripts[0].deleted).toBe(false);
    // The preflight for a foreign origin allows nothing either.
    const preflight = await SELF.fetch(`${BASE}/v1/jobs/${jobId}`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' } });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('every answer is no-store and nosniff; the site origin is echoed, never a wildcard; no credentials are allowed', async () => {
    const invite = await newInvite(60);
    const response = await call('/v1/quota', invite);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary')).toBe('Origin');
  });
});

describe('admin and a stranger with the address only', () => {
  it('the root, an unknown path, the admin API without the token and with a wrong token of the right length all look the same: 404 not_found', async () => {
    const wrongSameLength = `${ADMIN.slice(0, -1)}X`;
    const answers = await Promise.all([
      SELF.fetch(`${BASE}/`),
      SELF.fetch(`${BASE}/nothing`),
      SELF.fetch(`${BASE}/admin/spend`),
      SELF.fetch(`${BASE}/admin/spend`, { headers: { authorization: `Bearer ${wrongSameLength}` } }),
      SELF.fetch(`${BASE}/admin/invites`, { method: 'POST', headers: { authorization: 'Bearer short' }, body: '{}' }),
      SELF.fetch(`${BASE}/admin/kill`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, origin: 'https://evil.example' }, body: '{"on":true}' }),
    ]);
    for (const response of answers.slice(0, 5)) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('{"error":"not_found"}');
      expect(response.headers.get('server')).toBeNull();
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    // The admin API works with the token whatever Origin is sent (it is curl's API) — and never sends CORS headers,
    // so a web page cannot read it even if the token were in it.
    expect(answers[5].status).toBe(200);
    expect(answers[5].headers.get('access-control-allow-origin')).toBeNull();
    await admin('/admin/kill', { method: 'POST', body: JSON.stringify({ on: false }) });
    expect((await spend()).killSwitch).toBe(false);
  });

  it('without the admin token nothing can be spent: the shipped Worker refuses every start when ADMIN_TOKEN is missing or short', async () => {
    const invite = await newInvite(60);
    const { default: worker } = await import('../src/index');
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    for (const token of [undefined, 'short-token']) {
      const request = new Request(`${BASE}/v1/jobs`, { method: 'POST', headers: { authorization: `Bearer ${invite}`, origin: ORIGIN, 'content-type': 'audio/ogg', 'x-audio-duration-s': '60' }, body: ogg() });
      const response = await worker.fetch(request, { ...testEnv, ADMIN_TOKEN: token } as Env, ctx);
      expect(response.status, String(token)).toBe(503);
      const adminTry = await worker.fetch(new Request(`${BASE}/admin/spend`, { headers: { authorization: `Bearer ${token ?? ''}` } }), { ...testEnv, ADMIN_TOKEN: token } as Env, ctx);
      expect(adminTry.status).toBe(404);
    }
    expect((await mockState()).requests).toEqual([]);
  });

  it('an invite revoked by the founder is refused everywhere at once, and its running job can still be cleaned up by the alarm', async () => {
    const invite = await newInvite(60, 'revoked-mid-job');
    await mockConfig({ pollsUntilDone: 1000 });
    const jobId = await startOk({ invite, seconds: 60 });
    const id = ((await (await admin('/admin/spend')).json()) as { invites: { id: string }[] }).invites[0].id;
    expect(((await (await admin(`/admin/invites/${id}`, { method: 'DELETE' })).json()) as { revoked: number }).revoked).toBe(1);
    expect((await call('/v1/quota', invite)).status).toBe(401);
    expect((await start({ invite, seconds: 60 })).status).toBe(401);
    // Documented: the job already paid for stays reachable by the hash that started it (status, result, delete) —
    // a revocation stops new spending, it does not take a running job away.
    expect((await call(`/v1/jobs/${jobId}`, invite)).status).toBe(200);
    // The alarm deletes the transcript at the provider when its time comes, whoever owned it.
    await runInDurableObject(ledger(), (_instance, state) => {
      state.storage.sql.exec('UPDATE jobs SET created_at = created_at - ? WHERE id = ?', 25 * HOUR, jobId);
    });
    await runDurableObjectAlarm(ledger());
    expect((await mockState()).transcripts[0].deleted).toBe(true);
    expect((await spend()).transcriptsStillAtProvider).toBe(0);
  });
});

describe('availability', () => {
  it('requests refused before the ledger (bad origin, no invite, not audio, no length, bad duration) cost no provider request and no reservation', async () => {
    const invite = await newInvite(60);
    const refused = [
      await start({ invite, seconds: 60, origin: 'https://evil.example' }),
      await SELF.fetch(`${BASE}/v1/jobs`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'audio/ogg', 'x-audio-duration-s': '60' }, body: ogg() }),
      await start({ invite, seconds: 60, headers: { 'content-type': 'video/mp4' } }),
      await start({ invite, seconds: 0 }),
      await start({ invite, seconds: 121 * 60 }),
      await start({ invite, seconds: 10, body: ogg(10 * 8000 + 65536 + 1) }),
    ];
    expect(refused.map((response) => response.status)).toEqual([403, 401, 415, 400, 413, 413]);
    expect((await mockState()).requests).toEqual([]);
    expect((await spend()).activeJobs).toBe(0);
    // The hourly counter was not touched by any of them: the limit of 30 is still whole.
    for (let i = 0; i < 30; i += 1) expect((await start({ invite: `WRONG-${i}`, seconds: 60 })).status).toBe(401);
    expect((await start({ invite, seconds: 60 })).status).toBe(429);
  });

  it('an upload that stalls holds its reservation for 30 minutes at most, then the invite and the money are free again and the late upload starts nothing', async () => {
    const invite = await newInvite(60, 'stalled');
    const audio = ogg(40_000);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(audio.subarray(0, 10_000));
        await held;
        controller.enqueue(audio.subarray(10_000));
        controller.close();
      },
    });
    const JOB = '22222222-2222-4333-8444-555555555555';
    const pending = SELF.fetch(`${BASE}/v1/jobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${invite}`, origin: ORIGIN, 'content-type': 'audio/ogg', 'content-length': String(audio.length), 'x-audio-duration-s': '600', 'x-job-id': JOB, 'cf-connecting-ip': '203.0.113.7' },
      body,
      duplex: 'half',
    } as RequestInit);
    for (let i = 0; i < 100 && (await spend()).activeJobs === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await spend()).reservedUsd).toBeCloseTo((600 / 3600) * 0.23, 4);
    // Half an hour passes (the row is aged; the next reservation attempt releases stale ones).
    await runInDurableObject(ledger(), (_instance, state) => {
      state.storage.sql.exec('UPDATE jobs SET created_at = created_at - ? WHERE id = ?', 31 * 60_000, JOB);
    });
    await startOk({ invite, seconds: 60, ip: '203.0.113.8' });
    expect((await spend()).activeJobs).toBe(1);
    release();
    const late = await pending;
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: 'job_canceled' });
    expect((await mockState()).transcripts).toHaveLength(1); // only the second job's
  });
});
