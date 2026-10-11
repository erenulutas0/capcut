/**
 * The browser-facing contract (cloud/contract/cases.mjs) against the REAL
 * Worker code in workerd with its real Durable Object. The same cases run
 * against the local fake the web app's tests use
 * (cloud/fake-worker/test/contract.test.mjs).
 */
import { SELF, reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONTRACT_CASES } from '../../contract/cases.mjs';

const ORIGIN = 'https://erenulutas0.github.io';
const BASE = 'https://proxy.test';
const ADMIN = 'test-admin-token-0123456789abcdef';
const MOCK = 'http://provider.mock/__mock';

const admin = (path: string, body: unknown) => SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify(body) });

const driver = {
  origin: ORIGIN,
  // The bindings of vitest.config.ts.
  limits: { rateLimitPerHour: 30, monthlyCapUsd: 1, priceUsdPerHour: 0.23 },
  async send(path: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array }) {
    const response = await SELF.fetch(`${BASE}${path}`, { method: init.method, headers: { 'cf-connecting-ip': '203.0.113.7', ...init.headers }, body: init.body });
    return { status: response.status, headers: response.headers, text: await response.text() };
  },
  async newInvite(minutes: number) {
    const response = await admin('/admin/invites', { label: 'contract', minutes });
    return ((await response.json()) as { code: string }).code;
  },
  async kill(on: boolean) {
    await admin('/admin/kill', { on });
  },
  async provider(config: Record<string, unknown>) {
    await fetch(`${MOCK}/config`, { method: 'POST', body: JSON.stringify(config) });
  },
  async providerState() {
    return (await (await fetch(`${MOCK}/state`)).json()) as { transcripts: { deleted: boolean }[]; uploads: number; leaks: string[] };
  },
};

beforeEach(async () => {
  await reset();
  await fetch(`${MOCK}/reset`);
});
afterEach(async () => {
  expect((await driver.providerState()).leaks, 'a request left for a host that is not the mock').toEqual([]);
});

describe('the contract the site relies on (shared with the local fake)', () => {
  for (const item of CONTRACT_CASES) {
    it(item.name, async () => {
      await item.run(driver);
    });
  }
});
