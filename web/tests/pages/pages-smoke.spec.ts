import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { expectPolicy, watchCsp } from '../e2e/cspWatch';
import { addKesit, closeSheet, openMore, openSettings, installSavePicker, probeMp4, readSaved } from '../e2e/kesitFlow';
import { availableTasks } from '../../src/domain/tasks';

/**
 * The published build, under /capcut/, end to end: every thing that resolves
 * a URL at runtime (Next chunks, the export and silence workers, the caption
 * font, plain links, the report dialog's contact) is exercised once, and no
 * request may 404 or leave the origin. The Content-Security-Policy written
 * after the build (scripts/apply-csp.mjs) is on the pages and nothing in the
 * session violates it.
 */

const SAMPLE_VIDEO = join(__dirname, '..', 'media', 'sample-24s.mp4');
const OTHER_VIDEO = join(__dirname, '..', 'media', 'other-8s.mp4');
const WIZARD_PAGES = availableTasks()
  .map((task) => `/capcut/yap/${task.id}/`)
  .sort();

function watchRequests(page: Page) {
  const failures: string[] = [];
  const outside: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('blob:') && !url.startsWith('data:')) {
      outside.push(url);
    }
    if (url.startsWith('http://127.0.0.1:') && !new URL(url).pathname.startsWith('/capcut/')) {
      failures.push(`outside base path: ${url}`);
    }
  });
  return { failures, outside };
}

/** Moves the strip's playhead to a whole second with the keyboard. */
async function playheadTo(page: Page, seconds: number) {
  await page.getByTestId('timeline-playhead').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < seconds; i += 1) await page.keyboard.press('Shift+ArrowRight');
}

/**
 * ADR-034 under the sub-path: the opening screen at /capcut/, the search, a
 * card to its wizard page (/capcut/yap/<id>/), the video, the one choice,
 * İndir and the saved file; then "Daha fazla ayar → editörde aç" over the
 * same video. Every wizard page exists; a task that is not built has none.
 */
test('opening screen → search → wizard → download → editor hand-off', async ({ page, context, request }, testInfo) => {
  test.setTimeout(240_000);
  const seen = watchRequests(page);
  const csp = await watchCsp(context);
  await csp.attach(page);
  await installSavePicker(page);

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
  await expectPolicy(page);
  const cards = page.getByTestId('task-grid').getByRole('link');
  expect(await cards.evaluateAll((links) => links.map((link) => link.getAttribute('href')).sort())).toEqual(WIZARD_PAGES);

  // Type to find: the unavailable task is honest, the available one starts with Enter.
  await page.getByTestId('finder-input').fill('altyazı ekle');
  await expect(page.getByTestId('result-yazi')).toContainText('Bu henüz yok, üzerinde çalışıyoruz.');
  await expect(page.getByTestId('result-start')).toHaveCount(0);
  await page.getByTestId('finder-input').fill('tiktok için dikey');
  await page.getByTestId('finder-input').press('Enter');
  await expect(page).toHaveURL(/\/capcut\/yap\/dikey\/$/);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  // The search moved here without a page load, so <head> is the opening
  // screen's, re-ordered by the router (its policy was applied at load and
  // still holds). Load the wizard's own HTML to check the policy IT ships.
  await page.reload();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await expectPolicy(page);

  await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
  await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('option-contain').check();
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-other-8s_dikey.mp4', {
    timeout: 180_000,
  });
  const probe = probeMp4(await readSaved(page, testInfo, 'saved-other-8s_dikey.mp4'));
  expect([probe.width, probe.height]).toEqual([1080, 1920]);
  expect(probe.videoCodec).toBe('h264');

  // The same video in the editor, in place: no navigation, no second file dialog.
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-aspect', '9:16');
  await expect(page).toHaveURL(/\/capcut\/yap\/dikey\/$/);
  // And the wordmark leads back to the opening screen, under the base path.
  await page.getByTestId('home-link').click();
  await expect(page).toHaveURL(/\/capcut\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');

  // "Boşlukları at": its analysis worker is served from the sub-path too.
  await page.getByTestId('task-bosluk').click();
  await expect(page).toHaveURL(/\/capcut\/yap\/bosluk\/$/);
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.locator('[data-testid="bosluk-summary"], [data-testid="bosluk-unclear"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('bosluk-problem')).toHaveCount(0);

  // Every wizard page is published; a task that is not built yet has no page.
  for (const path of WIZARD_PAGES) expect((await request.get(path)).status(), path).toBe(200);
  for (const id of ['yazi']) {
    expect((await request.get(`/capcut/yap/${id}/`)).status(), id).toBe(404);
  }

  // "Sesini al" (ADR-035): the export worker's sound-only path under the sub-path.
  await page.goto('./');
  await page.getByTestId('task-ses').click();
  await expect(page).toHaveURL(/\/capcut\/yap\/ses\/$/);
  await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
  await expect(page.getByTestId('ses-info')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toHaveText('Ses dosyası kaydedildi: saved-other-8s_ses.m4a', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('export-method')).toHaveAttribute('data-output', 'audio');

  // The only 404 of the session is the one asked for above (it is not a page request).
  expect(seen.failures).toEqual([]);
  expect(seen.outside).toEqual([]);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
});

test('opening screen → editor → kesitler, caption, silence, download, report, privacy', async ({ page, context }) => {
  const seen = watchRequests(page);
  const csp = await watchCsp(context);
  await csp.attach(page);
  await installSavePicker(page);

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectPolicy(page);
  await page.getByRole('link', { name: 'Kendim düzenleyeceğim' }).click();
  await expect(page).toHaveURL(/\/capcut\/editor\/?$/);

  // The kesit list (ADR-026): mark with I / O, Enter adds; one more typed.
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await playheadTo(page, 0);
  await page.keyboard.press('i');
  await playheadTo(page, 4);
  await page.keyboard.press('o');
  await page.keyboard.press('Enter');
  await addKesit(page, '8', '14');
  await addKesit(page, '16', '18');
  await page.getByTestId('kesit-delete').nth(2).click();
  await expect(page.getByTestId('kesit-range')).toHaveText(['00:00 → 00:04', '00:08 → 00:14']);
  await expect(page.getByTestId('timeline-notice')).toContainText('Kesit 3 silindi');

  // Caption: needs the bundled font from /capcut/fonts/caption/.
  await openSettings(page, 'captions');
  await page.getByTestId('captions-add').click();
  const field = page.getByTestId('cue-draft').getByTestId('cue-text');
  await expect(field).toBeFocused();
  await page.keyboard.type('Yayında altyazı');
  await field.blur();
  await expect(page.getByTestId('cue-draft')).toHaveCount(0);
  await expect(page.getByTestId('caption-font-failed')).toHaveCount(0);
  await closeSheet(page);

  // Silence analysis: its own worker script, served from the sub-path.
  await openMore(page);
  await page.getByTestId('find-silences').click();
  const silence = page.getByRole('dialog', { name: 'Sessizlikleri bul' });
  await expect(silence.getByTestId('silence-clips')).toBeVisible({ timeout: 60_000 });
  await expect(silence.getByTestId('silence-problem')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Download both joined, with the caption: export worker + font inside the
  // worker, straight into the file picked in the (stand-in) save dialog.
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_2-kesit.mp4', {
    timeout: 180_000,
  });

  // Report dialog: contact is the public issue tracker, with the warning.
  await openMore(page);
  await page.getByTestId('open-help').click();
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('support-open-issue')).toHaveAttribute(
    'href',
    'https://github.com/erenulutas0/capcut/issues',
  );
  await expect(page.getByTestId('support-public-warning')).toBeVisible();

  // Privacy link opens a new tab under the base path, with the host filled in.
  const [privacy] = await Promise.all([
    context.waitForEvent('page'),
    page.getByTestId('report-privacy-link').click(),
  ]);
  const privacySeen = watchRequests(privacy);
  await privacy.waitForLoadState();
  await expect(privacy).toHaveURL(/\/capcut\/gizlilik\/?$/);
  await expect(privacy.getByTestId('privacy-draft')).toBeVisible();
  await expect(privacy.getByText('GitHub Pages (GitHub, Inc.)')).toBeVisible();
  await expectPolicy(privacy);

  expect(seen.failures).toEqual([]);
  expect(seen.outside).toEqual([]);
  expect(privacySeen.failures).toEqual([]);
  expect(privacySeen.outside).toEqual([]);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
});

/**
 * ADR-031 under the sub-path: the manifest and its icons, the service worker
 * scoped to /capcut/ with only /capcut/ app files in its cache, and the site
 * opening again with the network off — the opening screen, the editor (with
 * and without the trailing slash GitHub Pages redirects), privacy, a task
 * wizard through to its saved file — and a kesit downloading offline through
 * the worker scripts served from the cache.
 */
test('installable and offline under /capcut/: manifest, service worker, offline reload and download', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(240_000);
  const seen = watchRequests(page);
  await installSavePicker(page);
  await page.goto('./');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/capcut/manifest.webmanifest');

  const response = await request.get('/capcut/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    id: string;
    start_url: string;
    scope: string;
    display: string;
    name: string;
    icons: Array<{ src: string; purpose: string }>;
  };
  expect(manifest).toMatchObject({
    id: '/capcut/',
    // The installed app starts at the opening screen (ADR-034).
    start_url: '/capcut/',
    scope: '/capcut/',
    display: 'standalone',
    name: 'Clip',
  });
  expect(manifest.icons.map((icon) => icon.src).sort()).toEqual([
    '/capcut/icons/icon-192.png',
    '/capcut/icons/icon-512.png',
    '/capcut/icons/maskable-512.png',
  ]);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);

  // The worker: registered for /capcut/ only, its cache all /capcut/ app files.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const registration = await page.evaluate(async () => {
    const found = await navigator.serviceWorker.getRegistration();
    return { scope: found?.scope ?? '', script: found?.active?.scriptURL ?? '' };
  });
  expect(new URL(registration.scope).pathname).toBe('/capcut/');
  expect(new URL(registration.script).pathname).toBe('/capcut/sw.js');
  // Chrome's own installability check (what Lighthouse's old PWA audit asked).
  const cdp = await context.newCDPSession(page);
  const installability = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: Array<{ errorId: string }>;
  };
  expect(installability.installabilityErrors.map((error) => error.errorId)).toEqual([]);
  const manifestState = (await cdp.send('Page.getAppManifest')) as { errors: Array<{ message: string }> };
  expect(manifestState.errors.map((error) => error.message)).toEqual([]);
  await cdp.detach();
  const cached = await page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      out[name] = (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname);
    }
    return out;
  });
  const names = Object.keys(cached);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^clip-app-[0-9a-f]{16}$/);
  const paths = cached[names[0] ?? ''] ?? [];
  for (const stored of ['/capcut/', '/capcut/editor/', '/capcut/gizlilik/', '/capcut/gizlilik/en/', ...WIZARD_PAGES]) {
    expect(paths).toContain(stored);
  }
  const allowed = [
    /^\/capcut\/((editor|gizlilik|gizlilik\/en|yap\/(kes|bosluk|dikey|muzik|cevir))\/)?$/,
    /^\/capcut\/_next\/static\/.+\.(js|css|png|svg)$/,
    /^\/capcut\/fonts\/caption\/inter-latin(-ext)?-700-normal\.woff2$/,
    /^\/capcut\/icons\/(icon-192|icon-512|maskable-512)\.png$/,
    /^\/capcut\/(icon\.svg|apple-icon\.png|manifest\.webmanifest)$/,
  ];
  expect(paths.filter((path) => !allowed.some((pattern) => pattern.test(path)))).toEqual([]);

  // No network: the stored copy opens every page, even the slash-less address.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
  // A wizard, offline, from its card to the saved file.
  await page.getByTestId('task-cevir').click();
  await expect(page).toHaveURL(/\/capcut\/yap\/cevir\/$/);
  await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
  await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-other-8s_uyumlu.mp4', {
    timeout: 120_000,
  });
  // The slash-less address GitHub Pages would redirect opens from the stored copy too.
  await page.goto('./yap/kes');
  await expect(page.getByTestId('pick-video')).toBeEnabled();
  await page.goto('./editor');
  await expect(page.getByTestId('download-all')).toBeVisible();
  await page.goto('./gizlilik/');
  await expect(page.getByTestId('privacy-draft')).toBeVisible();
  await page.goto('./editor/');
  await expect(page.getByTestId('download-all')).toBeVisible();

  // And the export worker comes from the cache: a kesit downloads offline.
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await addKesit(page, '2', '4');
  await page.getByTestId('kesit-download').click();
  await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_00-02-00-04.mp4', {
    timeout: 120_000,
  });
  const after = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      for (const entry of await (await caches.open(name)).keys()) out.push(new URL(entry.url).pathname);
    }
    return out.sort();
  });
  expect(after).toEqual([...paths].sort());
  await context.setOffline(false);
  expect(seen.failures).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('the export publishes compiled files only: no source maps, no TypeScript sources', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const files = walk(join(process.cwd(), 'out')).map((f) => relative(process.cwd(), f));
  expect(files.length).toBeGreaterThan(10);
  expect(files.filter((f) => /\.(map|tsx?)$/.test(f))).toEqual([]);
});
