import { createHash } from 'node:crypto';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

import { expectPolicy, watchCsp } from './cspWatch';
import { expect, expectPageRecovery, test, type BrowserContext, type Page, type Route } from './fixtures';
import { availableTasks } from '../../src/domain/tasks';
import { PAGE_RECOVERY_KEY } from '../../src/pageWatchdog';

/**
 * A page that was served but never came alive (ADR-044).
 *
 * Twice a page's HTML arrived, `load` fired, and React never took the page
 * over: "Video seç" stayed disabled for the five minutes the test waited, and
 * nothing on the screen said so. docs/quality/2026-10-13-hydration-faults.md
 * shows that ANY one build file of the page failing does exactly that. Here:
 * the page now reloads once by itself, says so when that did not help, never
 * reloads twice, never cries wolf on a page that is merely slow or offline
 * from its stored copy — and a part that fails later says so in its place.
 *
 * The limits are the real ones (15 s after load, 4 s after a failed file,
 * 45 s without load): nothing is shortened for the tests.
 */

const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const CHUNK = '**/_next/static/chunks/*.js';

test.describe.configure({ timeout: 180_000 });

/** How many times the tab asked for a document: 1 = no reload. */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads += 1;
  });
  return () => loads;
}

const flag = (page: Page) =>
  page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? 'null') as { s: string; t: number; p: string; why: string } | null, PAGE_RECOVERY_KEY);

const notice = (page: Page) => page.getByTestId('page-dead');

/** The page's build scripts, in document order. */
async function scriptsOf(page: Page, path: string): Promise<string[]> {
  const html = await (await page.request.get(path)).text();
  return [...html.matchAll(/<script src="([^"]+)" async=""/g)].map((match) => match[1] ?? '');
}

async function expectAlive(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
  await expect(page.locator('[data-clip-pending]')).toHaveCount(0);
}

test.describe('without a service worker', () => {
  test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });

  test('every page comes alive, and an alive page is left alone', async ({ page }) => {
    const loads = countLoads(page);
    const pages = ['/', '/editor', '/gizlilik', '/no-such-page', ...availableTasks().map((task) => `/yap/${task.id}`)];
    for (const path of pages) {
      await page.goto(path);
      await expectAlive(page);
      await expect(notice(page)).toHaveAttribute('data-state', 'hidden');
      await expect(notice(page)).toBeHidden();
    }
    // ADR-048: the English pages, for a reader who chose English (this browser is Turkish: without the
    // choice the language script would put it on the Turkish twin — one more load, not a recovery).
    await page.evaluate(() => localStorage.setItem('clip.language', 'en'));
    const english = ['/gizlilik/en', '/en', '/en/editor', ...availableTasks().map((task) => `/en/yap/${task.id}`)];
    for (const path of english) {
      await page.goto(path);
      await expectAlive(page);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(notice(page)).toHaveAttribute('data-state', 'hidden');
      await expect(notice(page)).toBeHidden();
    }
    await page.evaluate(() => localStorage.removeItem('clip.language'));
    expect(loads()).toBe(pages.length + english.length);
    // Well past every limit of the watchdog: nothing happens on a page that works.
    await page.goto('/yap/cevir');
    await expect(page.getByTestId('video-input')).toBeAttached();
    await page.waitForTimeout(20_000);
    expect(loads()).toBe(pages.length + english.length + 1);
    await expect(notice(page)).toBeHidden();
    expect(await flag(page)).toBeNull();
  });

  for (const which of ['every script', 'the first script', 'the last script'] as const) {
    test(`${which} of the page fails once: one automatic reload, and the page is alive`, async ({ page }) => {
      expectPageRecovery();
      const loads = countLoads(page);
      const scripts = await scriptsOf(page, '/yap/cevir');
      expect(scripts.length).toBeGreaterThan(5);
      const pattern = which === 'every script' ? CHUNK : `**${which === 'the first script' ? scripts[0] : scripts[scripts.length - 1]}`;
      // Fails for as long as the tab is on its first load — the bundler's own second attempt included.
      await page.route(pattern, (route) => (loads() < 2 ? route.abort('connectionreset') : route.continue()));

      await page.goto('/yap/cevir');
      // What the CI run of 13 Oct 2026 showed for five minutes: the heading, and a disabled button. Now it heals.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Videonu seç');
      await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
      await expect(page.getByTestId('pick-video')).toBeEnabled();
      await expectAlive(page);
      expect(loads()).toBe(2);
      expect(await flag(page)).toMatchObject({ s: 'recovered', p: '/yap/cevir', why: 'file' });
      await expect(notice(page)).toBeHidden();

      // And it stays that way: no second reload.
      await page.waitForTimeout(20_000);
      expect(loads()).toBe(2);
      await expect(notice(page)).toBeHidden();
    });
  }

  test('a script that arrives cut in half (no error event): reloaded 15 s after load, then alive', async ({ page }) => {
    expectPageRecovery();
    const loads = countLoads(page);
    const scripts = await scriptsOf(page, '/yap/cevir');
    const target = scripts[1] ?? '';
    await page.route(`**${target}`, async (route) => {
      if (loads() >= 2) return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      return route.fulfill({ response, body: body.slice(0, Math.floor(body.length / 2)) });
    });
    const started = Date.now();
    await page.goto('/yap/cevir');
    await expect(page.getByTestId('pick-video')).toBeDisabled();
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 40_000 });
    expect(Date.now() - started, 'not before the 15 s a slow page is given').toBeGreaterThan(14_000);
    expect(loads()).toBe(2);
    expect(await flag(page)).toMatchObject({ s: 'recovered', why: 'timeout' });
  });

  test('scripts that never arrive: exactly one reload, then the notice with a real button — and no loop', async ({ page, context }) => {
    expectPageRecovery();
    const csp = await watchCsp(context);
    await csp.attach(page);
    const loads = countLoads(page);
    let broken = true;
    await page.route(CHUNK, (route) => (broken ? route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }) : route.continue()));

    await page.goto('/yap/cevir');
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 40_000 });
    expect(loads()).toBe(2);
    expect(await flag(page)).toMatchObject({ s: 'retried', p: '/yap/cevir', why: 'file' });

    // What it says, to whom, and how it can be pressed.
    const panel = notice(page).locator('[data-clip-lang="tr"]');
    await expect(panel).toBeVisible();
    await expect(notice(page).locator('[data-clip-lang="en"]')).toBeHidden();
    await expect(panel).toContainText('Sayfa tam açılamadı.');
    await expect(panel).toContainText('İnternet bağlantın takılmış olabilir.');
    await expect(notice(page)).toHaveAttribute('role', 'alert');
    const reload = page.getByTestId('page-dead-reload-tr');
    await expect(reload).toHaveText('Yeniden yükle');
    await expect(page.getByRole('button', { name: 'Yeniden yükle' })).toBeVisible();
    const box = await reload.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    // No stored copy is in use here, so there is nothing to "download again"; nothing to close on a dead page.
    await expect(page.getByTestId('page-dead-reset-tr')).toBeHidden();
    await expect(page.getByTestId('page-dead-close-tr')).toBeHidden();
    await reload.focus();
    await expect(reload).toBeFocused();
    const audit = await new AxeBuilder({ page }).include('#clip-page-dead').withTags(AXE_TAGS).analyze();
    expect(audit.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
    // The page under it is still the prerendered one: the notice does not pretend otherwise.
    await expect(page.getByTestId('pick-video')).toBeDisabled();

    // No loop: a minute later it is still the second load, and the notice.
    await page.waitForTimeout(60_000);
    expect(loads()).toBe(2);
    await expect(notice(page)).toHaveAttribute('data-state', 'dead');

    // The button reloads; while the files still fail, that load shows the notice again WITHOUT reloading by itself.
    await reload.click();
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 40_000 });
    expect(loads()).toBe(3);
    await page.waitForTimeout(25_000);
    expect(loads()).toBe(3);

    // The connection is back: the button brings the page to life, and the notice is gone.
    broken = false;
    await page.getByTestId('page-dead-reload-tr').click();
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
    expect(loads()).toBe(4);
    await expect(notice(page)).toBeHidden();
    await expectPolicy(page);
    expect(csp.violations, csp.violations.join('\n')).toEqual([]);
  });

  test('the English page says it in English', async ({ page }) => {
    expectPageRecovery();
    await page.route(CHUNK, (route) => route.abort('connectionreset'));
    // ADR-048: this browser is Turkish; `?lang=en` is the English choice (what the language button opens).
    await page.goto('/gizlilik/en?lang=en');
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 40_000 });
    const panel = notice(page).locator('[data-clip-lang="en"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('lang', 'en');
    await expect(panel).toContainText('The page did not open fully.');
    await expect(page.getByTestId('page-dead-reload-en')).toHaveText('Reload');
    await expect(notice(page).locator('[data-clip-lang="tr"]')).toBeHidden();
  });

  test('a script that stands still: the notice after 45 s, no reload; when the file arrives after all the notice goes away', async ({ page }) => {
    expectPageRecovery();
    const loads = countLoads(page);
    const scripts = await scriptsOf(page, '/yap/cevir');
    const held: Route[] = [];
    await page.route(`**${scripts[2]}`, (route) => void held.push(route));
    const started = Date.now();
    await page.goto('/yap/cevir', { waitUntil: 'commit' });
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 70_000 });
    expect(Date.now() - started).toBeGreaterThan(44_000);
    expect(loads()).toBe(1);
    expect(await flag(page)).toBeNull();
    await expect(notice(page).locator('[data-clip-lang="tr"]')).toContainText('Sayfa tam açılamadı.');

    for (const route of held) await route.continue();
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
    await expect(notice(page)).toBeHidden();
    await expect(notice(page)).toHaveAttribute('data-state', 'hidden');
    expect(loads()).toBe(1);
  });

  test('a page that is only slow — a script 40 s late — is never reloaded and never shows the notice', async ({ page }) => {
    const loads = countLoads(page);
    const scripts = await scriptsOf(page, '/yap/cevir');
    await page.route(`**${scripts[2]}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 40_000));
      await route.continue();
    });
    const states: string[] = [];
    await page.exposeFunction('noteNoticeState', (state: string) => void states.push(state));
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const box = document.getElementById('clip-page-dead');
        if (!box) return;
        new MutationObserver(() => (window as unknown as { noteNoticeState(state: string): void }).noteNoticeState(box.getAttribute('data-state') ?? '')).observe(box, {
          attributes: true,
          attributeFilter: ['data-state'],
        });
      });
    });
    await page.goto('/yap/cevir', { waitUntil: 'commit' });
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 70_000 });
    await page.waitForTimeout(20_000);
    expect(loads()).toBe(1);
    expect(states, 'the notice was never shown, not even for a moment').toEqual([]);
    expect(await flag(page)).toBeNull();
  });

  test('a stylesheet of the page fails once: one reload and the page has its styles', async ({ page }) => {
    expectPageRecovery();
    const loads = countLoads(page);
    await page.route('**/_next/static/chunks/*.css', (route) => (loads() < 2 ? route.abort('connectionreset') : route.continue()));
    await page.goto('/yap/cevir');
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
    await expect.poll(() => loads()).toBe(2);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(16, 19, 21)');
    expect(await flag(page)).toMatchObject({ s: 'recovered', why: 'style' });
    await expect(notice(page)).toBeHidden();
  });

  test('a stylesheet that never arrives: one reload, then the alive page says a part is missing and lets the user close that', async ({ page }) => {
    expectPageRecovery();
    const loads = countLoads(page);
    const html = await (await page.request.get('/yap/cevir')).text();
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1] ?? '');
    // Not the first sheet (globals.css): the notice is drawn with it.
    await page.route(`**${sheets[sheets.length - 1]}`, (route) => route.abort('connectionreset'));
    await page.goto('/yap/cevir');
    await expect(notice(page)).toHaveAttribute('data-state', 'late', { timeout: 30_000 });
    expect(loads()).toBe(2);
    await expectAlive(page);
    const panel = notice(page).locator('[data-clip-lang="tr"]');
    await expect(panel).toContainText('Uygulamanın bir parçası açılamadı.');
    await expect(panel).toContainText('Yeniden yüklersen videonu yeniden seçmen gerekebilir.');
    await expect(page.getByTestId('page-dead-reload-tr')).toBeVisible();
    const audit = await new AxeBuilder({ page }).include('#clip-page-dead').withTags(AXE_TAGS).analyze();
    expect(audit.violations.map((violation) => violation.id)).toEqual([]);
    await page.getByTestId('page-dead-close-tr').click();
    await expect(notice(page)).toBeHidden();
    await page.waitForTimeout(20_000);
    expect(loads()).toBe(2);
    // The page works: it is alive, only not as pretty as it should be.
    await expect(page.getByTestId('pick-video')).toBeEnabled();
  });
});

test.describe('a part of the app that fails after the page is alive', () => {
  test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });

  test('“Sorun bildir” whose code does not arrive says so; “Tekrar dene” opens it; the page is never reloaded', async ({ page }) => {
    const loads = countLoads(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible();
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-help').click();

    let broken = true;
    let asked = 0;
    await page.route(CHUNK, (route) => {
      asked += 1;
      return broken ? route.abort('connectionreset') : route.continue();
    });
    await page.getByTestId('open-report').click();
    const failed = page.getByTestId('part-failed');
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed).toHaveAttribute('role', 'alert');
    await expect(failed).toContainText('Bu bölüm açılamadı. İnternet bağlantın takılmış olabilir.');
    expect(asked, 'the bundler asked twice before giving up').toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/Application error|client-side exception/i)).toHaveCount(0);
    await expect(notice(page)).toBeHidden();
    const audit = await new AxeBuilder({ page }).include('[data-testid="part-failed"]').withTags(AXE_TAGS).analyze();
    expect(audit.violations.map((violation) => violation.id)).toEqual([]);
    for (const id of ['part-retry', 'part-close']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
    }

    // Still broken: trying again says the same, it does not pile up or crash.
    await page.getByTestId('part-retry').click();
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed).toHaveCount(1);

    broken = false;
    await page.getByTestId('part-retry').click();
    await expect(page.getByTestId('diag-preview')).toBeVisible({ timeout: 15_000 });
    await expect(failed).toHaveCount(0);
    expect(loads()).toBe(1);
    expect(errors).toEqual([]);
  });

  test('“Kapat” on a part that did not arrive closes it; asking again later works', async ({ page }) => {
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible();
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-help').click();
    let broken = true;
    await page.route(CHUNK, (route) => (broken ? route.abort('connectionreset') : route.continue()));
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('part-failed')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('part-close').click();
    await expect(page.getByTestId('part-failed')).toHaveCount(0);
    broken = false;
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('diag-preview')).toBeVisible({ timeout: 15_000 });
  });

  test('a part whose request stands still: after 30 s the screen says so instead of waiting for ever; when the code arrives the part opens', async ({ page }) => {
    const loads = countLoads(page);
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible();
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-help').click();
    const held: Route[] = [];
    await page.route(CHUNK, (route) => void held.push(route));
    const started = Date.now();
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('part-failed')).toBeVisible({ timeout: 45_000 });
    expect(Date.now() - started).toBeGreaterThan(29_000);
    await expect(page.getByTestId('part-failed')).toContainText('Bu bölüm açılamadı.');
    for (const route of held.splice(0)) await route.continue();
    await page.unroute(CHUNK);
    await expect(page.getByTestId('diag-preview')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('part-failed')).toHaveCount(0);
    expect(loads()).toBe(1);
    await expect(notice(page)).toBeHidden();
  });

  test('the editor opened from a wizard: its code does not arrive, the wizard’s video and choice survive “Tekrar dene”', async ({ page }) => {
    const loads = countLoads(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/yap/dikey');
    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('option-contain').check();

    let broken = true;
    await page.route(CHUNK, (route) => (broken ? route.abort('connectionreset') : route.continue()));
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('editor-failed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('part-failed')).toContainText('Bu bölüm açılamadı.');
    await expect(page.getByText(/Application error|client-side exception/i)).toHaveCount(0);
    await expect(notice(page)).toBeHidden();

    broken = false;
    await page.getByTestId('part-retry').click();
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('download-all')).toBeVisible();
    expect(loads(), 'the same page all along: the video was never picked again').toBe(1);
    expect(errors).toEqual([]);
  });

  test('a wizard with its own screen, reached from the opening screen while its code cannot be fetched: the app’s own words and a button, not the framework’s error', async ({ page }) => {
    const loads = countLoads(page);
    await page.goto('/');
    await expect(page.getByTestId('finder-input')).toBeEnabled();
    await expectAlive(page);
    let broken = true;
    await page.route(CHUNK, (route) => (broken ? route.abort('connectionreset') : route.continue()));
    await page.getByTestId('task-yazi').click();
    const crash = page.getByTestId('page-crash');
    await expect(crash).toBeVisible({ timeout: 30_000 });
    await expect(crash).toHaveAttribute('data-part', 'true');
    await expect(crash).toContainText('Bir şey ters gitti');
    await expect(crash).toContainText('İnternet bağlantın takılmış olabilir.');
    await expect(page.getByText(/Application error|client-side exception/i)).toHaveCount(0);
    // The page was alive: nothing reloads by itself.
    await page.waitForTimeout(8_000);
    expect(loads()).toBe(1);
    // One message, not two: the watchdog's own notice stays out of it.
    await expect(notice(page)).toBeHidden();
    expect(await flag(page)).toBeNull();
    const audit = await new AxeBuilder({ page }).include('[data-testid="page-crash"]').withTags(AXE_TAGS).analyze();
    expect(audit.violations.map((violation) => violation.id)).toEqual([]);

    broken = false;
    await page.getByTestId('page-crash-reload').click();
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/yap\/yazi$/);
    expect(loads()).toBe(2);
  });
});

test.describe('with the service worker and its stored copy', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /** Loads the page until the service worker controls it. */
  async function controlled(page: Page, path: string) {
    await page.goto(path);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active;
      if (worker && worker.state !== 'activated') {
        await new Promise((resolve) => worker.addEventListener('statechange', () => worker.state === 'activated' && resolve(null)));
      }
    });
    await page.reload();
    await expect(page.getByTestId('video-input')).toBeAttached();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  }

  const mainScript = async (page: Page) => (await scriptsOf(page, '/yap/cevir'))[1] ?? '';

  /**
   * The renderer's memory cache and the HTTP cache would hand the page (and the worker) the good copy
   * they still hold from a moment ago. A user who comes back tomorrow has neither: only the stored copy.
   */
  async function forgetBrowserCaches(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }

  async function setOffline(context: BrowserContext, offline: boolean) {
    await context.setOffline(offline);
  }

  test('offline, everything stored: the page opens from the stored copy and the watchdog stays silent', async ({ page, context }) => {
    await controlled(page, '/yap/cevir');
    const loads = countLoads(page);
    await setOffline(context, true);
    await page.reload();
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
    await expectAlive(page);
    await page.waitForTimeout(20_000);
    expect(loads()).toBe(1);
    await expect(notice(page)).toBeHidden();
    expect(await flag(page)).toBeNull();
    // Another stored page, by a full load, still offline.
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible();
    await expectAlive(page);
    await expect(notice(page)).toBeHidden();
    expect(await flag(page)).toBeNull();
    await setOffline(context, false);
  });

  test('offline with a file missing from the stored copy: one reload, then the notice — without the offer to throw the stored copy away', async ({ page, context }) => {
    expectPageRecovery();
    await controlled(page, '/yap/cevir');
    const target = await mainScript(page);
    await page.evaluate(async (path) => {
      for (const name of await caches.keys()) await (await caches.open(name)).delete(path);
    }, target);
    const loads = countLoads(page);
    await forgetBrowserCaches(page);
    await setOffline(context, true);
    // A browser without a connection reports `navigator.onLine === false`; the test browser's emulated
    // offline cuts the requests but leaves that value true (measured here, 13 Oct 2026), so it is set.
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
    await page.reload();
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 40_000 });
    expect(loads()).toBe(2);
    await expect(notice(page).locator('[data-clip-lang="tr"]')).toContainText('Sayfa tam açılamadı.');
    await expect(page.getByTestId('page-dead-reload-tr')).toBeVisible();
    // Offline the stored copy is all there is: taking it away is not offered.
    expect(await page.evaluate(() => navigator.onLine), 'the browser itself says it is offline').toBe(false);
    await expect(page.getByTestId('page-dead-reset-tr')).toBeHidden();
    await setOffline(context, false);
  });

  test('a broken file in the stored copy: reloading cannot help, “Uygulamayı baştan indir” does — and touches nothing else the browser keeps', async ({ page }) => {
    expectPageRecovery();
    await controlled(page, '/yap/cevir');
    const target = await mainScript(page);
    // A stored copy that is not the file (what a hotspot's sign-in page stored in its place would be).
    await page.evaluate(async (path) => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        if (await cache.match(path)) await cache.put(path, new Response('<!doctype html><title>Sign in</title>', { headers: { 'content-type': 'text/html' } }));
      }
      // What must survive: the speech model's cache, a stored project, the first-run note.
      await (await caches.open('clip-models-test')).put('/models/keep.bin', new Response('model'));
      localStorage.setItem('clip.firstRunHint.dismissed', '1');
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('watchdog-test-keep', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kept');
        open.onsuccess = () => {
          const write = open.result.transaction('kept', 'readwrite');
          write.objectStore('kept').put('project', 'p1');
          write.oncomplete = () => {
            open.result.close();
            resolve();
          };
          write.onerror = () => reject(write.error);
        };
        open.onerror = () => reject(open.error);
      });
    }, target);
    const loads = countLoads(page);
    await forgetBrowserCaches(page);
    await page.reload();
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 60_000 });
    expect(loads()).toBe(2);

    // "Yeniden yükle" alone gets the same broken copy again.
    await page.getByTestId('page-dead-reload-tr').click();
    await expect(notice(page)).toHaveAttribute('data-state', 'dead', { timeout: 60_000 });
    expect(loads()).toBe(3);

    const reset = page.getByTestId('page-dead-reset-tr');
    await expect(reset).toBeVisible();
    await expect(reset).toHaveText('Uygulamayı baştan indir');
    await expect(notice(page).locator('[data-clip-lang="tr"]')).toContainText('videolarını ve projelerini silmez');
    const audit = await new AxeBuilder({ page }).include('#clip-page-dead').withTags(AXE_TAGS).analyze();
    expect(audit.violations.map((violation) => violation.id)).toEqual([]);
    await reset.click();
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 60_000 });
    await expectAlive(page);
    await expect(notice(page)).toBeHidden();

    const kept = await page.evaluate(async () => {
      const names = await caches.keys();
      const model = await (await caches.open('clip-models-test')).match('/models/keep.bin');
      const project = await new Promise<unknown>((resolve) => {
        const open = indexedDB.open('watchdog-test-keep', 1);
        open.onsuccess = () => {
          const read = open.result.transaction('kept').objectStore('kept').get('p1');
          read.onsuccess = () => resolve(read.result);
        };
      });
      return { models: names.includes('clip-models-test'), model: model ? await model.text() : null, project, hint: localStorage.getItem('clip.firstRunHint.dismissed') };
    });
    expect(kept).toEqual({ models: true, model: 'model', project: 'project', hint: '1' });
  });
});

test('the watchdog script is in every page: the first script, before any stylesheet, its hash in the policy', async ({ page }) => {
  for (const path of ['/', '/yap/cevir', '/yap/yazi', '/editor', '/gizlilik', '/gizlilik/en', '/en', '/en/yap/cevir', '/no-such-page']) {
    const html = await (await page.request.get(path)).text();
    const ours = [...html.matchAll(/<script data-clip-watchdog="">([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
    expect(ours.length, `${path}: one watchdog script`).toBe(1);
    expect(ours[0]).toContain(PAGE_RECOVERY_KEY);
    const hash = `'sha256-${createHash('sha256').update(ours[0] ?? '', 'utf8').digest('base64')}'`;
    const policy = /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(policy, path).toContain(hash);
    expect(policy).not.toContain('unsafe-inline');
    // charset, the policy, then the watchdog: nothing of the page is asked for before it listens. On an app page
    // the language script (ADR-048) comes first — it starts nothing, it may only hide the page and replace it.
    const at = html.indexOf('<script data-clip-watchdog');
    expect(at, path).toBeGreaterThan(html.indexOf('http-equiv="Content-Security-Policy"'));
    const language = /<script data-clip-language="">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? null;
    if (path === '/no-such-page') {
      expect(language, path).toBeNull();
      expect(html.search(/<script[\s>]/), path).toBe(at);
    } else {
      expect(language, path).not.toBeNull();
      expect(html.search(/<script[\s>]/), path).toBe(html.indexOf('<script data-clip-language'));
      expect(html.indexOf('<script data-clip-language'), path).toBeLessThan(at);
      expect(policy, path).toContain(`'sha256-${createHash('sha256').update(language ?? '', 'utf8').digest('base64')}'`);
      // Nothing between the two but each other.
      expect(html.slice(html.indexOf('</script>', html.indexOf('<script data-clip-language')) + '</script>'.length, at), path).toBe('');
    }
    expect(at, path).toBeLessThan(html.search(/<link[\s>]/));
    expect(html).toContain('id="clip-page-dead"');
    // The limits are in the page as written in the ADR.
    expect(ours[0]).toContain('"graceS":15');
    expect(ours[0]).toContain('"errorS":4');
    expect(ours[0]).toContain('"stuckS":45');
  }
});
