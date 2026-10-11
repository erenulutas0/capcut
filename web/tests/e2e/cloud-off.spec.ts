import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { startFakeWorker } from '../../../cloud/fake-worker/server.mjs';
import { tr } from '../../src/i18n/messages';
import { expectPolicy, watchCsp } from './cspWatch';
import { STUB_LINES, STUB_SCRIPT, installTranscriptTest, lineTexts, serveModels, testModels } from './transcriptKit';

/**
 * The cloud transcript route (ADR-039) is OFF unless a build names our proxy
 * (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`). This suite's build does not — like the
 * published site and CI — and these tests hold it to that: "Yazıya dök" is
 * what it was, nothing can leave for another origin, and the pages say
 * nothing about a service they do not use.
 *
 * (The route itself is tested in tests/cloud, against a build that names a
 * local fake: `npx playwright test -c playwright.cloud.config.ts`.)
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
/** Where the cloud suite's local fake listens; here it stands for "any other origin". */
const FAKE_PORT = 38197;
const FAKE_ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;
const BUILD_HINT = 'this suite needs the ordinary e2e build (no NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL): $env:NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=\'\'; $env:CLIP_TEST_HOOKS=\'1\'; npm run build';

function walk(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('"Yazıya dök" has no choice screen: the on-device steps, the same words, a transcript — and no request to any other origin', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  const site = new URL(baseURL ?? '').origin;
  const elsewhere: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'blob:' && url.protocol !== 'data:' && url.origin !== site) elsewhere.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
  const models = testModels();
  await serveModels(context, models);
  await installTranscriptTest(page, models, STUB_SCRIPT);

  await page.goto('/yap/yazi/');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  // Straight to the model step, under the wizard's own heading; the cloud route's screen is not in this build.
  await expect(page.getByTestId('transcribe-steps')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('route-choice'), BUILD_HINT).toHaveCount(0);
  await expect(page.getByTestId('wizard-title')).toHaveText(tr['wizard.yazi.title']);
  await expect(page.getByTestId('wizard-footer')).toHaveText(tr['home.trust']);
  await expect(page.getByTestId('transcribe-english')).toContainText(tr['transcript.onDevice']);
  const screen = await page.locator('body').innerText();
  expect(screen).not.toMatch(/İnternette|AssemblyAI|davet kodu|Sesi gönder/i);

  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(await lineTexts(page)).toEqual(STUB_LINES);
  await expect(page.getByTestId('transcript-machine-note')).toContainText(tr['transcript.machine']);
  await expect(page.getByTestId('transcript-speaker')).toHaveCount(0);
  await expect(page.getByTestId('yazi-summary')).toBeVisible();
  await expect(page.getByTestId('wizard-footer')).toHaveText(tr['home.trust']);
  expect(elsewhere).toEqual([]);
  // Nothing about an invite is kept.
  expect(await page.evaluate(() => window.localStorage.getItem('clip.cloudInvite'))).toBeNull();
});

test('no request to another origin is possible: the policy is same-origin, and a listening server next door hears nothing', async ({ page, context, baseURL }) => {
  const csp = await watchCsp(context);
  await csp.attach(page);
  // A real server on the address the cloud build would talk to, willing to answer this site: if anything could
  // reach it, it would answer.
  const fake = await startFakeWorker({ port: FAKE_PORT, allowedOrigins: [new URL(baseURL ?? '').origin] });
  try {
    for (const path of ['/', '/yap/yazi', '/gizlilik', '/editor']) {
      await page.goto(path);
      const policy = await expectPolicy(page);
      expect(/connect-src ([^;]*)/.exec(policy)?.[1], BUILD_HINT).toBe("'self'");
      expect(policy).not.toContain(FAKE_ORIGIN);
      expect(policy).not.toMatch(/https?:\/\//);
    }
    await page.goto('/yap/yazi');
    const outcome = await page.evaluate(async (origin) => {
      const tries: Record<string, string> = {};
      const attempt = async (name: string, run: () => Promise<unknown>) => {
        try {
          await run();
          tries[name] = 'allowed';
        } catch {
          tries[name] = 'blocked';
        }
      };
      await attempt('fetch', () => fetch(`${origin}/v1/quota`, { headers: { authorization: 'Bearer AAAAA-BBBBB-CCCCC-DDDDD' } }));
      await attempt('fetch no-cors', () => fetch(`${origin}/v1/quota`, { mode: 'no-cors' }));
      await attempt('xhr', () => new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', `${origin}/v1/jobs`);
        request.onload = resolve;
        request.onerror = reject;
        request.send('x');
      }));
      // A beacon is queued and refused later (its return value says nothing): it is sent, and the server is asked below.
      try {
        navigator.sendBeacon(`${origin}/v1/jobs`, 'x');
      } catch {
        // some browsers refuse it on the spot
      }
      await attempt('websocket', () => new Promise((resolve, reject) => {
        const socket = new WebSocket(origin.replace('http', 'ws'));
        socket.onopen = resolve;
        socket.onerror = reject;
      }));
      return tries;
    }, FAKE_ORIGIN);
    expect(outcome).toEqual({ fetch: 'blocked', 'fetch no-cors': 'blocked', xhr: 'blocked', websocket: 'blocked' });
    await expect.poll(() => csp.violations.filter((violation) => violation.includes('connect-src')).length).toBeGreaterThan(0);
    // The server next door was listening the whole time and received nothing — not the fetches, not the beacon.
    await page.waitForTimeout(1500);
    expect(fake.requests).toEqual([]);
  } finally {
    await fake.close();
  }
});

test('the cloud route\'s code is not in this build at all', async () => {
  // What `next start` serves to browsers (the static export is checked the same way by scripts/apply-csp.mjs).
  const chunks = walk(join(process.cwd(), '.next', 'static')).filter((file) => file.endsWith('.js'));
  expect(chunks.length).toBeGreaterThan(10);
  const carrying = chunks.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return ['/v1/jobs', '/v1/quota', 'AssemblyAI', 'clip.cloudInvite', 'clip-cloud-audio'].some((marker) => text.includes(marker));
  });
  expect(carrying, BUILD_HINT).toEqual([]);
});

test('the privacy page says what is true of this build: nothing is sent, no cloud section, no invite code', async ({ page }) => {
  for (const [path, local, notCollected] of [
    ['/gizlilik/', tr['privacy.summary.local'], tr['privacy.notCollected.body']],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId('privacy-local')).toHaveText(local);
    await expect(page.getByTestId('privacy-not-collected')).toHaveText(notCollected);
    await expect(page.getByTestId('privacy-cloud'), BUILD_HINT).toHaveCount(0);
    await expect(page.getByTestId('stored-invite')).toHaveCount(0);
    await expect(page.getByTestId('privacy-network-cloud')).toHaveCount(0);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/AssemblyAI|Cloudflare|davet kodu|İnternette yazıya dökme/i);
    expect(text).toContain('hiçbir sunucuya gönderilmez');
  }
  await page.goto('/gizlilik/en/');
  await expect(page.getByTestId('privacy-cloud')).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/AssemblyAI|Cloudflare|invite code/i);
});
