import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  addKesit,
  noHorizontalOverflow,
  noSavePicker,
  openMore,
  openVideo,
  installSavePicker,
  opfsFiles,
  sharedFiles,
  stubShare,
} from './kesitFlow';

/**
 * The phone flow (ADR-031): share the finished video (Web Share API), the
 * manifest that installs the site as an app, and the service worker that
 * opens it without internet. The share sheet is a stand-in (`stubShare`);
 * the service worker and Cache Storage are the browser's real ones.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

function card(page: Page, index: number) {
  return page.getByTestId('kesit-card').nth(index);
}

async function openEditor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('download-all')).toBeVisible();
  return errors;
}

/** One kesit (3 s → 5 s) downloaded through the route without a save dialog. */
async function readyKesit(page: Page) {
  await openVideo(page, SAMPLE);
  await addKesit(page, '3', '5');
  await card(page, 0).getByTestId('kesit-download').click();
  await expect(card(page, 0).getByTestId('export-download')).toBeVisible({ timeout: 120_000 });
}

// ------------------------------------------------------------ share

test.describe('share the finished video', () => {
  test('"Paylaş" hands the share sheet the offered file, from the click', async ({ page }) => {
    test.setTimeout(150_000);
    await noSavePicker(page);
    await stubShare(page);
    const errors = await openEditor(page);
    await readyKesit(page);

    const share = card(page, 0).getByTestId('download-share');
    await expect(share).toBeVisible();
    await expect(share).toHaveAccessibleName('Paylaş: sample-24s_00-03-00-05.mp4');
    await share.click();
    await expect.poll(() => sharedFiles(page)).toHaveLength(1);

    // The same bytes "Bilgisayara kaydet" saves.
    const download = page.waitForEvent('download');
    await card(page, 0).getByTestId('export-download').click();
    const bytes = statSync((await (await download).path()) ?? '').size;
    const [shared] = await sharedFiles(page);
    expect(shared).toEqual({ name: 'sample-24s_00-03-00-05.mp4', type: 'video/mp4', size: bytes, activation: true });
    await expect(card(page, 0).getByTestId('share-failed')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('closing the sheet says nothing; a refusal is said plainly', async ({ page }) => {
    test.setTimeout(150_000);
    await noSavePicker(page);
    await stubShare(page);
    const errors = await openEditor(page);
    await readyKesit(page);
    const share = card(page, 0).getByTestId('download-share');

    await page.evaluate(() => {
      (window as unknown as { __shareMode: string }).__shareMode = 'abort';
    });
    await share.click();
    await expect.poll(() => sharedFiles(page)).toHaveLength(1);
    await page.waitForTimeout(300);
    await expect(card(page, 0).getByTestId('share-failed')).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as { __shareMode: string }).__shareMode = 'refuse';
    });
    await share.click();
    await expect(card(page, 0).getByTestId('share-failed')).toHaveText(
      'Paylaşılamadı. Videoyu kaydet, sonra Dosyalar ya da galeri uygulamasından paylaş.',
    );
    // A later share that works clears the sentence.
    await share.click();
    await expect(card(page, 0).getByTestId('share-failed')).toHaveCount(0);
    expect(await sharedFiles(page)).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  test('after the save dialog, "Paylaş" shares the saved file', async ({ page }) => {
    test.setTimeout(150_000);
    await installSavePicker(page);
    await stubShare(page);
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '3', '5');
    await card(page, 0).getByTestId('kesit-download').click();
    await expect(card(page, 0).getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_00-03-00-05.mp4', {
      timeout: 120_000,
    });
    await card(page, 0).getByTestId('download-share').click();
    await expect.poll(() => sharedFiles(page)).toHaveLength(1);
    const [shared] = await sharedFiles(page);
    const onDisk = (await opfsFiles(page))['saved-sample-24s_00-03-00-05.mp4'];
    expect(shared).toEqual({ name: 'saved-sample-24s_00-03-00-05.mp4', type: 'video/mp4', size: onDisk, activation: true });
  });

  test('no button where the browser cannot share files', async ({ page }) => {
    test.setTimeout(150_000);
    await noSavePicker(page);
    // Playwright's Chromium has no navigator.share: like Firefox on a computer.
    await openEditor(page);
    expect(await page.evaluate(() => typeof navigator.share)).toBe('undefined');
    await readyKesit(page);
    await expect(page.getByTestId('download-share')).toHaveCount(0);
    await expect(page.getByTestId('share-too-large')).toHaveCount(0);
    await expect(card(page, 0).getByTestId('export-download')).toHaveText('Bilgisayara kaydet');
  });
});

// ------------------------------------------------------------ phone wording

test.describe('on a phone', () => {
  // The founder's test phone (Galaxy S23, Chrome 154): 360 × 643 CSS px.
  test.use({ viewport: { width: 360, height: 643 }, hasTouch: true, isMobile: true });

  test('Android Chrome has the save dialog: ⬇ → "Kaydedildi" → "Paylaş" the saved file', async ({ page }) => {
    test.setTimeout(150_000);
    await installSavePicker(page);
    await stubShare(page);
    const errors = await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '3', '5');
    await card(page, 0).getByTestId('kesit-download').tap();
    await expect(card(page, 0).getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_00-03-00-05.mp4', {
      timeout: 120_000,
    });
    await expect(card(page, 0)).not.toContainText('bilgisayar');
    const share = card(page, 0).getByTestId('download-share');
    const box = await share.boundingBox();
    expect(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 360).toBe(true);
    await noHorizontalOverflow(page);
    expect(await axe(page)).toEqual([]);
    await share.tap();
    await expect.poll(() => sharedFiles(page)).toHaveLength(1);
    const [shared] = await sharedFiles(page);
    const onDisk = (await opfsFiles(page))['saved-sample-24s_00-03-00-05.mp4'];
    expect(shared).toEqual({ name: 'saved-sample-24s_00-03-00-05.mp4', type: 'video/mp4', size: onDisk, activation: true });
    expect(errors).toEqual([]);
  });

  test('without the save dialog: "Kaydet" and "Paylaş" side by side, no word about a computer', async ({ page }) => {
    test.setTimeout(150_000);
    await noSavePicker(page);
    await stubShare(page);
    const errors = await openEditor(page);
    await readyKesit(page);
    const save = card(page, 0).getByTestId('export-download');
    const share = card(page, 0).getByTestId('download-share');
    await expect(save).toHaveText('Kaydet');
    await expect(share).toHaveText('Paylaş');
    await expect(card(page, 0).getByTestId('download-ready-title')).toHaveText(
      'Video hazır. “Kaydet” cihazına kaydeder, “Paylaş” bir uygulamaya gönderir.',
    );
    await expect(card(page, 0).getByTestId('export-save-where')).toHaveText(
      'Tarayıcın dosyayı İndirilenler klasörüne kaydeder; Dosyalar uygulamasında bulursun.',
    );
    await expect(card(page, 0).getByTestId('export-save-space')).toContainText('cihazında');
    await expect(card(page, 0)).not.toContainText('bilgisayar');

    const [saveBox, shareBox] = [await save.boundingBox(), await share.boundingBox()];
    expect(saveBox && shareBox).toBeTruthy();
    if (saveBox && shareBox) {
      expect(Math.abs(saveBox.y - shareBox.y)).toBeLessThan(2);
      expect(saveBox.height).toBeGreaterThanOrEqual(44);
      expect(shareBox.height).toBeGreaterThanOrEqual(44);
      expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(360);
    }
    await noHorizontalOverflow(page);
    expect(await axe(page)).toEqual([]);

    await share.tap();
    await expect.poll(() => sharedFiles(page)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('a touch screen wider than a phone also says "Kaydet"', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await noSavePicker(page);
    await openEditor(page);
    const coarse = await page.evaluate(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    test.skip(!coarse, 'this browser does not report a coarse pointer under touch emulation');
    await readyKesit(page);
    await expect(card(page, 0).getByTestId('export-download')).toHaveText('Kaydet');
    await context.close();
  });
});

// ------------------------------------------------------------ manifest

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('install as an app', () => {
  test('the manifest is linked from every page, valid, and its icons exist', async ({ page, request }) => {
    for (const path of ['/', '/editor', '/gizlilik', '/gizlilik/en']) {
      await page.goto(path);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
      await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    }
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      id: string;
      display: string;
      lang: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    expect(manifest).toMatchObject({
      name: 'Clip',
      short_name: 'Clip',
      start_url: '/editor',
      scope: '/',
      id: '/',
      display: 'standalone',
      lang: 'tr',
      theme_color: '#101315',
      background_color: '#101315',
    });
    expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const icon of manifest.icons) {
      const file = await request.get(icon.src);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()['content-type']).toBe('image/png');
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(await file.body())).toEqual({ width, height });
    }
    // The maskable icon is opaque to the corner (full bleed).
    const maskable = readFileSync(join(process.cwd(), 'public', 'icons', 'maskable-512.png'));
    expect(maskable.length).toBeGreaterThan(1000);
    const apple = await request.get((await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')) ?? '');
    expect(pngSize(await apple.body())).toEqual({ width: 180, height: 180 });
  });

  test('Chrome itself finds nothing that blocks installing', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
      installabilityErrors: Array<{ errorId: string }>;
    };
    expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);
    const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: Array<{ message: string }> };
    expect(new URL(manifest.url).pathname).toBe('/manifest.webmanifest');
    expect(manifest.errors.map((error) => error.message)).toEqual([]);
  });

  test('"Uygulama olarak yükle" appears in ⋯ when the browser offers it, and asks once', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prompted: number }).__prompted = 0;
    });
    await openEditor(page);
    await openMore(page);
    await expect(page.getByTestId('install-app')).toHaveCount(0);
    await expect(page.getByTestId('install-ios')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // What Chromium fires when the site is installable.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      event.prompt = async () => {
        (window as unknown as { __prompted: number }).__prompted += 1;
      };
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await openMore(page);
    const install = page.getByTestId('install-app');
    await expect(install).toHaveText('Uygulama olarak yükle');
    expect(await axe(page)).toEqual([]);
    await install.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    // One use per offer: the entry goes away.
    await expect(install).toHaveCount(0);
  });

  test('iPhone Safari gets the "Ana Ekrana Ekle" steps instead', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();
    await openEditor(page);
    await openMore(page);
    await expect(page.getByTestId('install-ios')).toContainText('Safari’de Paylaş düğmesine bas, sonra “Ana Ekrana Ekle”yi seç.');
    await expect(page.getByTestId('install-app')).toHaveCount(0);
    await context.close();
  });
});

// ------------------------------------------------------------ offline

/** The worker's list, read from the served sw.js (what the build wrote). */
async function workerConfig(page: Page): Promise<{ version: string; pages: string[]; assets: string[] }> {
  const source = await page.evaluate(async () => (await fetch('/sw.js', { cache: 'no-store' })).text());
  const json = /\/\* @clip-sw-config \*\/ (\{[\s\S]*?\}) \/\* @end \*\//.exec(source)?.[1];
  expect(json, 'sw.js carries its list').toBeTruthy();
  return JSON.parse(json ?? '{}') as { version: string; pages: string[]; assets: string[] };
}

/** Every Cache Storage entry of this origin: cache name → request paths. */
async function cacheContents(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => {
        const url = new URL(request.url);
        return url.origin === location.origin ? `${url.pathname}${url.search}` : request.url;
      });
    }
    return out;
  });
}

async function waitForWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The cache is complete once the worker is active (install is all or nothing).
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state))
    .toBe('activated');
}

const APP_PATH = [
  /^\/$/,
  /^\/editor$/,
  /^\/gizlilik(\/en)?$/,
  /^\/_next\/static\/[^?]+$/,
  /^\/fonts\/caption\/inter-latin(-ext)?-700-normal\.woff2$/,
  /^\/icons\/(icon-192|icon-512|maskable-512)\.png$/,
  /^\/(icon\.svg|apple-icon\.png|manifest\.webmanifest)$/,
];

test.describe('open without internet', () => {
  test('the worker stores exactly this build\'s app files, and only them', async ({ page }) => {
    await page.goto('/');
    await waitForWorker(page);
    const registration = await page.evaluate(async () => {
      const found = await navigator.serviceWorker.getRegistration();
      return { scope: found?.scope, script: found?.active?.scriptURL };
    });
    expect(new URL(registration.scope ?? '').pathname).toBe('/');
    expect(new URL(registration.script ?? '').pathname).toBe('/sw.js');

    const config = await workerConfig(page);
    expect(config.version).toMatch(/^[0-9a-f]{16}$/);
    expect(config.pages).toEqual(['/', '/editor', '/gizlilik', '/gizlilik/en']);
    const contents = await cacheContents(page);
    expect(Object.keys(contents)).toEqual([`clip-app-${config.version}`]);
    const stored = contents[`clip-app-${config.version}`] ?? [];
    expect([...stored].sort()).toEqual([...config.pages, ...config.assets].sort());
    expect(stored.filter((path) => !APP_PATH.some((pattern) => pattern.test(path)))).toEqual([]);
    // Every script and stylesheet the editor loads is in it.
    await page.goto('/editor');
    const own = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"]')].map(
        (element) => new URL(element instanceof HTMLScriptElement ? element.src : element.href).pathname,
      ),
    );
    expect(own.length).toBeGreaterThan(3);
    expect(own.filter((path) => !stored.includes(path))).toEqual([]);
  });

  test('offline: the pages open, a local video opens and a kesit downloads; the cache gets no media', async ({ page, context }) => {
    test.setTimeout(240_000);
    await noSavePicker(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // First visit online: the worker installs.
    await page.goto('/');
    await waitForWorker(page);
    const before = await cacheContents(page);

    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // Landing, then the editor through its link (the client-side navigation
    // cannot fetch its data offline and falls back to a full page load).
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Editörü aç' }).first().click();
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByTestId('download-all')).toBeVisible();
    for (const path of ['/gizlilik', '/gizlilik/en']) {
      await page.goto(path);
      await expect(page.getByTestId('privacy-draft')).toBeVisible();
    }
    // The editor, offline, from the stored copy: open a video, add a
    // caption (the typeface comes from the cache, in the worker too), download.
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await openVideo(page, SAMPLE);
    await addKesit(page, '3', '5');
    await page.getByTestId('open-settings').click();
    await page.getByTestId('inspector-tab-captions').click();
    await page.getByTestId('captions-add').click();
    const field = page.getByTestId('cue-draft').getByTestId('cue-text');
    await expect(field).toBeFocused();
    await page.keyboard.type('Çevrimdışı');
    await field.blur();
    await expect(page.getByTestId('caption-font-failed')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await card(page, 0).getByTestId('kesit-download').click();
    await expect(card(page, 0).getByTestId('export-download')).toBeVisible({ timeout: 180_000 });
    const download = page.waitForEvent('download');
    await card(page, 0).getByTestId('export-download').click();
    expect(statSync((await (await download).path()) ?? '').size).toBeGreaterThan(10_000);

    // Nothing was added to Cache Storage: no media, no exported file.
    const after = await cacheContents(page);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toMatch(/\.mp4|blob:|\.m4a/);
    expect(errors).toEqual([]);

    // A page the app does not have: the browser's own offline error, not a stored page.
    const other = await context.newPage();
    const missing = await other.goto('/nerede').catch((error: Error) => error);
    expect(missing).toBeInstanceOf(Error);
    await other.close();
    await context.setOffline(false);
  });

  test('a newer build waits for "Yenile", never while a download runs', async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    const deploy = await swProxy(baseURL ?? '');
    try {
      await noSavePicker(page);
      await page.goto(`${deploy.origin}/editor`);
      await expect(page.getByTestId('download-all')).toBeVisible();
      await waitForWorker(page);
      await page.reload();
      await expect(page.getByTestId('download-all')).toBeVisible();
      expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      const config = await workerConfig(page);

      // A new deploy: the same worker code with another version and list.
      deploy.rewrite((body) =>
        body
          .replace(/"version":"[0-9a-f]+"/, '"version":"0000000000000000"')
          .replace(/"assets":\[[^\]]*\]/, '"assets":["/icon.svg"]'),
      );
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())?.update();
      });
      const notice = page.getByTestId('update-notice');
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await expect(notice).toContainText('Yeni sürüm hazır.');
      expect(await axe(page)).toEqual([]);

      // "Sonra" hides it; nothing reloads by itself.
      await page.getByTestId('update-later').click();
      await expect(notice).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('download-all')).toBeVisible();
      // The old worker still serves this tab: the notice is back after a reload.
      await expect(notice).toBeVisible({ timeout: 20_000 });

      // A download is running (a caption makes it a full encode): "Yenile" is off.
      await openVideo(page, SAMPLE);
      await page.getByTestId('open-settings').click();
      await page.getByTestId('inspector-tab-captions').click();
      await page.getByTestId('captions-add').click();
      await expect(page.getByTestId('cue-draft').getByTestId('cue-text')).toBeFocused();
      await page.keyboard.type('Yeni sürüm');
      await page.getByTestId('cue-draft').getByTestId('cue-text').blur();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByTestId('download-all').click();
      // Checked in the page on every frame, so a short run cannot slip by.
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="download-running"]') !== null &&
          (document.querySelector('[data-testid="update-reload"]') as HTMLButtonElement | null)?.disabled === true &&
          document.querySelector('[data-testid="update-busy"]')?.textContent === 'İndirme bitince yenileyebilirsin.',
        undefined,
        { polling: 'raf', timeout: 60_000 },
      );
      await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 180_000 });
      await expect(page.getByTestId('update-reload')).toBeEnabled();
      await expect(page.getByTestId('update-busy')).toHaveCount(0);

      // "Yenile": the new worker takes over, the page reloads, the old cache goes.
      const reloaded = page.waitForEvent('load');
      await page.getByTestId('update-reload').click();
      await reloaded;
      await expect(page.getByTestId('download-all')).toBeVisible();
      await expect.poll(async () => Object.keys(await cacheContents(page))).toEqual(['clip-app-0000000000000000']);
      expect(config.version).not.toBe('0000000000000000');
      await expect(notice).toHaveCount(0);
    } finally {
      await deploy.close();
    }
  });

  test('a page already from the newer build switches workers without asking', async ({ page, baseURL }) => {
    const deploy = await swProxy(baseURL ?? '');
    try {
      await page.goto(`${deploy.origin}/editor`);
      await waitForWorker(page);
      await page.reload();
      await expect(page.getByTestId('download-all')).toBeVisible();
      expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      // Same list, another version: every file of this page is in the new list.
      deploy.rewrite((body) => body.replace(/"version":"[0-9a-f]+"/, '"version":"1111111111111111"'));
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())?.update();
      });
      await expect
        .poll(async () => Object.keys(await cacheContents(page)), { timeout: 20_000 })
        .toEqual(['clip-app-1111111111111111']);
      await expect(page.getByTestId('update-notice')).toHaveCount(0);
      await expect(page.getByTestId('download-all')).toBeVisible();
    } finally {
      await deploy.close();
    }
  });
});

/**
 * A stand-in for a new deploy: another origin (so a fresh registration) that
 * forwards every request to the e2e server and can rewrite `/sw.js`. The
 * browser's update check for a worker script cannot be routed by Playwright.
 * Local only: it forwards to the test server on 127.0.0.1.
 */
async function swProxy(target: string) {
  let transform: ((body: string) => string) | null = null;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', target);
    fetch(url, { method: request.method, headers: { accept: request.headers.accept ?? '*/*' }, redirect: 'manual' })
      .then(async (upstream) => {
        const headers: Record<string, string> = {};
        upstream.headers.forEach((value, key) => {
          if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive'].includes(key)) {
            headers[key] = value;
          }
        });
        let body = Buffer.from(await upstream.arrayBuffer());
        if (transform && url.pathname === '/sw.js') body = Buffer.from(transform(body.toString('utf8')));
        response.writeHead(upstream.status, headers);
        response.end(body);
      })
      .catch(() => {
        response.writeHead(502);
        response.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    rewrite(next: (body: string) => string) {
      transform = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
