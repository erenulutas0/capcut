/**
 * The browser-facing contract (cloud/contract/cases.mjs) against the LOCAL
 * FAKE. The same cases pass against the real Worker code in workerd
 * (cloud/worker/test/contract.test.ts): the fake answers what the Worker answers.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { CONTRACT_CASES, webm } from '../../contract/cases.mjs';
import { startFakeWorker } from '../server.mjs';

const ORIGIN = 'http://127.0.0.1:3999';
const JOB = '11111111-2222-4333-8444-555555555555';
let fake;
before(async () => {
  // The numbers the Worker's own tests run with (cloud/worker/vitest.config.ts).
  fake = await startFakeWorker({ allowedOrigins: [ORIGIN], monthlyCapUsd: 1, priceUsdPerHour: 0.23, rateLimitPerHour: 30 });
});
after(() => fake.close());
beforeEach(() => fake.reset());

const driver = {
  origin: ORIGIN,
  get limits() {
    return fake.limits;
  },
  async send(path, init) {
    const response = await fetch(`${fake.url}${path}`, { method: init.method, headers: init.headers, body: init.body });
    return { status: response.status, headers: response.headers, text: await response.text() };
  },
  newInvite: async (minutes) => fake.newInvite(minutes),
  kill: async (on) => fake.kill(on),
  provider: async (config) => fake.provider(config),
  providerState: async () => fake.providerState(),
};

describe('the contract the site relies on (shared with the real Worker)', () => {
  for (const item of CONTRACT_CASES) it(item.name, () => item.run(driver));
});

describe('what only the fake does (for the web tests)', () => {
  const auth = (invite) => ({ origin: ORIGIN, authorization: `Bearer ${invite}` });
  const start = (invite, headers = {}, body = webm(), signal = undefined) =>
    fetch(`${fake.url}/v1/jobs`, { method: 'POST', signal, headers: { ...auth(invite), 'content-type': 'audio/webm', 'x-audio-duration-s': '24', ...headers }, body });
  const seen = async (condition) => {
    for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(condition(), 'condition not reached');
  };

  it('keeps the uploaded bytes and a log of every request, without the invite code', async () => {
    const invite = fake.newInvite(60);
    const audio = webm(9000);
    const response = await start(invite, { 'x-language': 'en' }, audio);
    assert.equal(response.status, 202);
    assert.equal(fake.uploads.length, 1);
    assert.deepEqual(new Uint8Array(fake.uploads[0].bytes), audio);
    assert.equal(fake.uploads[0].language, 'en');
    assert.equal(fake.requests.at(-1).bytes, 9000);
    assert.equal(fake.requests.at(-1).hasInvite, true);
    assert.ok(!JSON.stringify(fake.requests).includes(invite));
  });

  it('scripted words, an empty result, a failing status and a failing result fetch', async () => {
    const invite = fake.newInvite(60);
    const headers = auth(invite);
    fake.provider({ pollsUntilDone: 0, words: [], languageCode: 'en_us' });
    let jobId = (await (await start(invite)).json()).jobId;
    await fetch(`${fake.url}/v1/jobs/${jobId}`, { headers });
    const empty = await (await fetch(`${fake.url}/v1/jobs/${jobId}/result`, { headers })).json();
    assert.deepEqual([empty.words, empty.text, empty.language_code], [[], '', 'en_us']);

    fake.provider({ failStatus: 500 });
    jobId = (await (await start(invite)).json()).jobId;
    const status = await fetch(`${fake.url}/v1/jobs/${jobId}`, { headers });
    assert.deepEqual([status.status, await status.json()], [502, { error: 'provider_error', step: 'status' }]);
    fake.provider({ failStatus: 0, failResult: 500 });
    await fetch(`${fake.url}/v1/jobs/${jobId}`, { headers });
    const result = await fetch(`${fake.url}/v1/jobs/${jobId}/result`, { headers });
    assert.deepEqual([result.status, await result.json()], [502, { error: 'provider_error', step: 'result' }]);
    // Still at the provider: the browser's DELETE removes it.
    assert.equal(fake.jobs().at(-1).atProvider, true);
    await fetch(`${fake.url}/v1/jobs/${jobId}`, { method: 'DELETE', headers });
    assert.equal(fake.jobs().at(-1).atProvider, false);
  });

  it('a held upload deleted by the browser meanwhile: nothing is started at the provider (as in the Worker)', async () => {
    const invite = fake.newInvite(60);
    fake.provider({ holdUpload: true });
    const pending = start(invite, { 'x-job-id': JOB });
    await seen(() => fake.jobs().length === 1);
    assert.deepEqual(await (await fetch(`${fake.url}/v1/jobs/${JOB}`, { headers: auth(invite) })).json(), { status: 'uploading' });
    assert.deepEqual(await (await fetch(`${fake.url}/v1/jobs/${JOB}`, { method: 'DELETE', headers: auth(invite) })).json(), { deleted: true });
    fake.releaseUpload();
    const response = await pending;
    assert.deepEqual([response.status, await response.json()], [409, { error: 'job_canceled' }]);
    assert.deepEqual(fake.providerState().transcripts, []);
    assert.equal(fake.jobs()[0].state, 'failed');
  });

  it('a held upload the browser gives up on is given back', async () => {
    const invite = fake.newInvite(60);
    fake.provider({ holdUpload: true });
    const abort = new AbortController();
    const pending = start(invite, { 'x-job-id': JOB }, webm(), abort.signal).then(() => 'answered', () => 'gave up');
    await seen(() => fake.requests.some((request) => request.bytes > 0));
    abort.abort();
    assert.equal(await pending, 'gave up');
    await seen(() => fake.abortedUploads === 1);
    assert.equal(fake.jobs()[0].state, 'failed');
    assert.deepEqual(fake.providerState(), { transcripts: [], uploads: 0 });
  });

  it('a connection cut in the middle of the upload gives the reservation back', async () => {
    const invite = fake.newInvite(60);
    fake.provider({ dropUploadAfterBytes: 1000 });
    const outcome = await start(invite, { 'x-audio-duration-s': '600' }, webm(200_000)).then(() => 'answered', () => 'failed');
    assert.equal(outcome, 'failed');
    assert.equal(fake.abortedUploads, 1);
    assert.equal(fake.jobs()[0].state, 'failed');
    assert.equal(fake.uploads.length, 0);
  });
});
