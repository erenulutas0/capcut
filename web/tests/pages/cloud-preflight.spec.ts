import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '../e2e/fixtures';
import { expectPolicy, watchCsp } from '../e2e/cspWatch';
import { cloudOriginFromEnv } from '../../scripts/lib/cloudOrigin.mjs';
import { availableTasks } from '../../src/domain/tasks';
import { PROVIDER_PAGES, cloudTr, type CloudMessageKey } from '../../src/i18n/cloudMessages';
import { cloudEn } from '../../src/i18n/cloudMessages.en';
import { tr } from '../../src/i18n/messages';
import { en } from '../../src/i18n/messages.en';

/**
 * PRE-FLIGHT for switching the internet route of "Yazıya dök" on in the published site (ADR-039,
 * founder decision of 14 Oct 2026: invite-only trial). It runs with the Pages smoke test
 * (playwright.pages.config.ts) against a static export built with
 * `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=<our proxy Worker's origin>` — the same variable in the test's
 * environment — and, through playwright.live.config.ts, against the published site once its policy
 * names the proxy. In a build without the route every test here is skipped (and says so).
 *
 * What must be true the moment the switch is flipped:
 *  - every page's `connect-src` is exactly `'self'` and that one origin, and no other directive names it;
 *  - "Yazıyı nerede çıkaralım?" appears in the founder's wording (option B, 11 Oct 2026);
 *  - the privacy page has the internet section and names the data controller and the contact;
 *  - NOT ONE request goes to the proxy until the user presses a button.
 *
 * Nothing here may reach the real Worker (or AssemblyAI behind it): every request to the proxy's
 * origin is caught by `context.route` — aborted while nobody pressed anything, and answered by a stub
 * in this file after "Kodu kaydet" is pressed (that test proves the guard sees what the page sends).
 * The service worker is blocked so no request can take a path the route does not see.
 */

test.use({ serviceWorkers: 'block' });

const SAMPLE_VIDEO = join(__dirname, '..', 'media', 'sample-24s.mp4');
const WIZARD_PAGES = availableTasks()
  .map((task) => `yap/${task.id}/`)
  .sort();
const PAGES = ['./', 'editor/', 'gizlilik/', 'gizlilik/en/', ...WIZARD_PAGES];
const LIVE = Boolean(process.env.PAGES_SITE_ORIGIN);
/** A well-formed code (four groups of five) that no Worker ever issued: only the local stub below answers it. */
const STUB_INVITE = 'PRFLT-CHECK-NOTAR-EALXX';

const plain = (text: string): string => text.split('**').join('');
const connectSrcOf = (html: string): string | null => {
  const policy = /http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html)?.[1];
  return policy === undefined ? null : policy.replace(/&#x27;/g, "'");
};

/**
 * The proxy origin this run is about, or '' when the build under test has no route. A local run is told
 * by the same variable the build was given; a live run reads the published opening page and accepts only
 * the configured proxy (`LIVE_CLOUD_ORIGIN`, set by playwright.live.config.ts).
 */
async function routeOrigin(request: APIRequestContext): Promise<string> {
  if (!LIVE) return cloudOriginFromEnv();
  const policy = connectSrcOf(await (await request.get('./')).text()) ?? '';
  const connect = /connect-src ([^;]*)(;|$)/.exec(policy)?.[1]?.trim() ?? '';
  if (connect === "'self'") return '';
  expect(connect, 'the published policy names exactly one extra origin, the configured proxy').toBe(`'self' ${process.env.LIVE_CLOUD_ORIGIN}`);
  return process.env.LIVE_CLOUD_ORIGIN ?? '';
}

const NOT_ON = 'the route is not in this build — NOT RUN (build and test with NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=<proxy origin>)';

interface ProxyGuard {
  /** Every request the browser tried to send to the proxy's origin: "METHOD path". */
  hits: string[];
  /** The Authorization header of each, in the same order ('' when there was none). */
  auth: string[];
  /** From now on the stub answers the minutes question; before that everything is aborted. */
  answerQuota(): void;
}

/** Catches every request of the context to `origin` — pages, workers, beacons — and never lets one through. */
async function guardProxy(context: BrowserContext, origin: string, page: Page): Promise<ProxyGuard> {
  const hits: string[] = [];
  const auth: string[] = [];
  let answering = false;
  const siteOrigin = new URL(page.url() === 'about:blank' ? (test.info().project.use.baseURL ?? 'http://127.0.0.1/') : page.url()).origin;
  await context.route(
    (url) => url.origin === origin,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      hits.push(`${request.method()} ${url.pathname}${url.search}`);
      auth.push((await request.headerValue('authorization')) ?? '');
      const cors = {
        'access-control-allow-origin': siteOrigin,
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, x-audio-duration-s, x-job-id',
        'cache-control': 'no-store',
      };
      if (answering && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (answering && request.method() === 'GET' && url.pathname === '/v1/quota') {
        // The shape the real Worker answers (cloud/contract/cases.mjs, "quota").
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ on: true, remainingMinutes: 60, maxJobMinutes: 120 }) });
      }
      return route.abort('blockedbyclient');
    },
  );
  // A WebSocket is not routed: it is counted here, and the policy blocks it anyway.
  context.on('page', (opened) => opened.on('websocket', (socket) => hits.push(`WEBSOCKET ${socket.url()}`)));
  page.on('websocket', (socket) => hits.push(`WEBSOCKET ${socket.url()}`));
  return {
    hits,
    auth,
    answerQuota: () => {
      answering = true;
    },
  };
}

test('pre-flight: every page allows exactly the site and the proxy, and no other directive names it', async ({ request }) => {
  const origin = await routeOrigin(request);
  test.skip(!origin, NOT_ON);
  const expected = `'self' ${origin}`;
  const policies = new Map<string, string>();
  if (LIVE) {
    for (const path of PAGES) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      policies.set(path, connectSrcOf(await response.text()) ?? '');
    }
  } else {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const out = join(process.cwd(), 'out');
    for (const file of walk(out).filter((f) => f.endsWith('.html') && !f.startsWith(join(out, 'models')))) {
      policies.set(relative(out, file), connectSrcOf(readFileSync(file, 'utf8')) ?? '');
    }
    // Every page this test walks below is among them.
    for (const path of PAGES.filter((p) => p !== './')) expect([...policies.keys()].map((k) => k.replace(/\\/g, '/'))).toContain(`${path}index.html`);
  }
  expect(policies.size).toBeGreaterThan(10);
  for (const [path, policy] of policies) {
    expect(policy, `${path}: has a policy`).not.toBe('');
    const directives = policy.split(';').map((part) => part.trim()).filter(Boolean);
    expect(directives.filter((d) => d.startsWith('connect-src ')), path).toEqual([`connect-src ${expected}`]);
    // The proxy is a connect-src origin and nothing else: no script, frame, image, form or other origin anywhere.
    const others = directives.filter((d) => !d.startsWith('connect-src '));
    expect(others.filter((d) => d.includes(origin) || /https?:|\*/.test(d)), path).toEqual([]);
    expect(policy.split(origin).length - 1, `${path}: the origin once`).toBe(1);
  }
});

test('pre-flight: nobody presses anything — not one request reaches the proxy; the choice is the founder’s, word for word', async ({ page, context, request }) => {
  test.setTimeout(180_000);
  const origin = await routeOrigin(request);
  test.skip(!origin, NOT_ON);
  const guard = await guardProxy(context, origin, page);
  const csp = await watchCsp(context);
  await csp.attach(page);

  // Every page, loaded as a document (so its own policy tag is read), left alone for a moment.
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '', { timeout: 30_000 });
    await expectPolicy(page);
    await page.waitForTimeout(400);
  }
  expect(guard.hits, 'requests to the proxy while walking the pages').toEqual([]);

  // "Yazıya dök" with a video: the choice screen, as approved (option B, 11 Oct 2026; cloudMessages.ts).
  await page.goto('yap/yazi/');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('route-choice')).toHaveAttribute('data-invite', 'none');
  await expect(page.getByTestId('wizard-title')).toHaveText(cloudTr['cloud.choice.title']);
  const device = page.getByTestId('route-device');
  await expect(device.getByRole('heading', { level: 2 })).toHaveText(cloudTr['cloud.device.title']);
  await expect(device.locator('.route-card-body')).toHaveText(cloudTr['cloud.device.body']);
  await expect(page.getByTestId('route-device-go')).toHaveText(cloudTr['cloud.device.go']);
  const online = page.getByTestId('route-online');
  await expect(online.getByRole('heading', { level: 2 })).toHaveText(cloudTr['cloud.online.title']);
  await expect(online.locator('.route-card-body')).toHaveText(cloudTr['cloud.online.body']);
  await expect(page.getByTestId('route-facts').locator('li')).toHaveText(
    (['cloud.online.fact.sound', 'cloud.online.fact.who', 'cloud.online.fact.deleted', 'cloud.online.fact.others'] as const).map((key) => plain(cloudTr[key])),
  );
  // No code saved: the card asks for one, and offers no "send" at all.
  await expect(online).toContainText(cloudTr['cloud.invite.need']);
  await expect(page.getByTestId('invite-code')).toBeVisible();
  await expect(page.getByTestId('route-online-go')).toHaveCount(0);
  await expect(page.getByTestId('route-privacy')).toHaveAttribute('href', /\/gizlilik\/?$/);
  // Neither card is pre-selected; nothing is remembered in the browser.
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);

  await page.waitForTimeout(3000);
  expect(guard.hits, 'requests to the proxy while the choice screen was open').toEqual([]);

  // The device way: still nothing to the proxy.
  await page.getByTestId('route-device-go').click();
  await expect(page.getByTestId('route-choice')).toHaveCount(0);
  await expect(page.getByTestId('model-download').or(page.getByTestId('transcribe-start'))).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  expect(guard.hits, 'requests to the proxy after "Cihazımda yaz"').toEqual([]);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
});

test('pre-flight: a button press is what reaches the proxy — the guard sees it, a local stub answers, the code is in a header only', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120_000);
  const origin = await routeOrigin(request);
  test.skip(!origin, NOT_ON);
  const guard = await guardProxy(context, origin, page);

  await page.goto('yap/yazi/');
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 60_000 });
  // Typing is not pressing: nothing leaves while the code is typed.
  await page.getByTestId('invite-code').fill(STUB_INVITE);
  await page.waitForTimeout(1000);
  expect(guard.hits).toEqual([]);

  guard.answerQuota();
  await page.getByTestId('invite-save').click();
  await expect(page.getByTestId('route-online-go')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('route-online-go')).toHaveText(cloudTr['cloud.online.go']);
  // Only the minutes question (and the browser's own CORS check, if it made one); no sound.
  const asked = guard.hits.filter((hit) => hit !== 'OPTIONS /v1/quota');
  expect(asked.length).toBeGreaterThan(0);
  expect(new Set(asked)).toEqual(new Set(['GET /v1/quota']));
  for (const [index, hit] of guard.hits.entries()) {
    expect(hit, 'the code is never in an address').not.toContain(STUB_INVITE);
    if (hit.startsWith('GET ')) expect(guard.auth[index]).toBe(`Bearer ${STUB_INVITE}`);
  }
  // "Sesi gönder ve yaz" was not pressed: no job, no sound.
  await page.waitForTimeout(1500);
  expect(guard.hits.filter((hit) => hit.includes('/v1/jobs'))).toEqual([]);
});

test('pre-flight: the privacy page has the internet section and names who answers for it', async ({ page, context, request }) => {
  const origin = await routeOrigin(request);
  test.skip(!origin, NOT_ON);
  const guard = await guardProxy(context, origin, page);
  const name = (process.env.NEXT_PUBLIC_DATA_CONTROLLER_NAME ?? '').trim();
  const contact = (process.env.NEXT_PUBLIC_SUPPORT_CONTACT ?? '').trim();

  for (const [path, words, cloudWords] of [
    ['gizlilik/', tr, cloudTr],
    // A Turkish browser is sent to the Turkish page unless it asks (ADR-048): ask for English.
    ['gizlilik/en/?lang=en', en, cloudEn],
  ] as const) {
    await page.goto(path);
    const section = page.getByTestId('privacy-cloud');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(cloudWords['cloud.privacy.title']);
    const facts: CloudMessageKey[] = [
      'cloud.privacy.what',
      'cloud.privacy.who',
      'cloud.privacy.region',
      'cloud.privacy.deletion',
      'cloud.privacy.retention',
      'cloud.privacy.ledger',
      'cloud.privacy.quota',
      'cloud.privacy.training',
      'cloud.privacy.trial',
      'cloud.privacy.controller.named',
    ];
    for (const key of facts) await expect(section, key).toContainText(cloudWords[key]);
    await expect(section.getByRole('link', { name: cloudWords['cloud.privacy.provider.retention'] })).toHaveAttribute('href', PROVIDER_PAGES.retention);
    await expect(section.getByRole('link', { name: cloudWords['cloud.privacy.provider.dpa'] })).toHaveAttribute('href', PROVIDER_PAGES.dpa);
    await expect(page.getByTestId('stored-invite')).toBeVisible();

    // The data controller (doc 30 K02): named, never "belirlenmedi", once the route is on — and exactly the
    // name and contact the build was given, when the run is told them (CI passes both).
    const controller = page.getByTestId('privacy-controller');
    await expect(controller.getByTestId('controller-name').getByTestId('undecided'), 'the data controller must be named before the route is on').toHaveCount(0);
    await expect(controller.getByTestId('controller-contact').getByTestId('undecided'), 'the contact must be named before the route is on').toHaveCount(0);
    if (name) await expect(controller.getByTestId('controller-name').locator('dd')).toHaveText(words['privacy.controller.person'].replace('{name}', name));
    if (contact) await expect(controller.getByTestId('controller-contact').locator('dd')).toHaveText(contact);
    await expect(page.getByTestId('privacy-draft')).toContainText(words['privacy.draftBadge.named']);
  }
  expect(guard.hits, 'requests to the proxy from the privacy page').toEqual([]);
});
