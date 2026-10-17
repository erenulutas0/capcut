import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, expectPageRecovery, test, type Page } from '../e2e/fixtures';

import { allowedConnectSrc, expectPolicy, expectedConnectSrc, watchCsp } from '../e2e/cspWatch';
import { enhanceFixture, frameLumas } from '../e2e/enhance-media';
import { addKesit, closeSheet, openMore, openSettings, installSavePicker, probeMp4, readSaved } from '../e2e/kesitFlow';
import { shareFiles, storedShares, waitForWorker } from '../e2e/shareKit';
import { APP_NAME } from '../../src/appIdentity';
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

/** Where the site under test lives: the local static server, or the published site (playwright.live.config.ts). */
const SITE_PREFIX = process.env.PAGES_SITE_ORIGIN ? process.env.PAGES_SITE_ORIGIN + '/' : 'http://127.0.0.1:';

function watchRequests(page: Page) {
  const failures: string[] = [];
  const outside: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(SITE_PREFIX) && !url.startsWith('blob:') && !url.startsWith('data:')) {
      outside.push(url);
    }
    if (url.startsWith(SITE_PREFIX) && !new URL(url).pathname.startsWith('/capcut/')) {
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

  // Type to find: every task can start since ADR-036 ("altyazı ekle" finds "Yazıya dök"); Enter starts the first result.
  await page.getByTestId('finder-input').fill('altyazı ekle');
  await expect(page.getByTestId('result-yazi').getByTestId('result-start')).toBeVisible();
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
  // ADR-041: the picture is never enlarged. "Sığdır" keeps the 640 × 360
  // source at its own width and adds bars up to 9:16.
  expect([probe.width, probe.height]).toEqual([640, 1138]);
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
  // Every task has its page since ADR-036 ("Yazıya dök" was the last without one); an id that is no task has none.
  expect((await request.get('/capcut/yap/yok/')).status()).toBe(404);

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
    name: APP_NAME,
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
    /^\/capcut\/((editor|gizlilik|gizlilik\/en|yap\/(kes|bosluk|dikey|kucult|yazi|muzik|ses|sustur|cevir|iyilestir|gif))\/)?$/,
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
  // ADR-036: the bundler's copy of the speech runtime is not published twice,
  // and the test stand-in for the recogniser is not in the published scripts.
  expect(files.filter((f) => /_next[\\/]static[\\/].*\.wasm$/.test(f))).toEqual([]);
  const scripts = files.filter((f) => f.endsWith('.js'));
  expect(scripts.filter((f) => readFileSync(join(process.cwd(), f), 'utf8').includes('clip-transcript-stub-engine'))).toEqual([]);
  expect(scripts.filter((f) => readFileSync(join(process.cwd(), f), 'utf8').includes('__clipTranscriptTest'))).toEqual([]);
});

/**
 * The cloud transcript route (ADR-039) is in the published site only when the
 * build was given our proxy's origin — and then with exactly that origin in
 * the policy. Without it: no other origin in any page's policy, none of the
 * route's code, and no word about a service the site does not use.
 *
 * Against the published site (playwright.live.config.ts) there is no `out/`
 * folder to read: the pages' own policies are read from the site, and they
 * must say one thing — absent everywhere, or exactly one extra origin, the
 * configured proxy, everywhere — and the privacy page must match.
 */
test('the cloud transcript route: absent from the export unless the build names the proxy; then one origin, exactly', async ({ request }) => {
  if (process.env.PAGES_SITE_ORIGIN) {
    const seen = new Map<string, string>();
    for (const path of ['./', 'editor/', 'gizlilik/', 'gizlilik/en/', ...WIZARD_PAGES]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const policy = /http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(await response.text())?.[1] ?? '';
      seen.set(path, /connect-src ([^;]*);/.exec(policy.replace(/&#x27;/g, "'"))?.[1] ?? '(none)');
    }
    const values = [...new Set(seen.values())];
    expect(values, JSON.stringify(Object.fromEntries(seen))).toHaveLength(1);
    expect(allowedConnectSrc()).toContain(values[0]);
    const routeOn = values[0] !== "'self'";
    console.log(`LIVE-CLOUD-ROUTE ${routeOn ? `on (${values[0]})` : 'off'}`);
    const privacy = await (await request.get('gizlilik/')).text();
    expect(privacy.includes('AssemblyAI'), 'the privacy page names the provider exactly when the route is on').toBe(routeOn);
    return;
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const out = join(process.cwd(), 'out');
  const files = walk(out).filter((f) => !f.startsWith(join(out, 'models')));
  const pages = files.filter((f) => f.endsWith('.html'));
  expect(pages.length).toBeGreaterThan(5);
  const expected = expectedConnectSrc();
  for (const page of pages) {
    const policy = /http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(readFileSync(page, 'utf8'))?.[1] ?? '';
    expect(/connect-src ([^;]*);/.exec(policy.replace(/&#x27;/g, "'"))?.[1], relative(out, page)).toBe(expected);
  }
  const carrying = (markers: string[], kinds: RegExp) =>
    files.filter((f) => kinds.test(f)).filter((f) => markers.some((marker) => readFileSync(f, 'utf8').includes(marker))).map((f) => relative(out, f));
  if (expected === "'self'") {
    expect(carrying(['/v1/jobs', '/v1/quota', 'clip.cloudInvite', 'clip-cloud-audio'], /\.js$/)).toEqual([]);
    expect(carrying(['AssemblyAI', 'davet kodu', 'invite code'], /\.(js|html|txt)$/)).toEqual([]);
    // (A bundled library names "Cloudflare-Workers" among the runtimes it can tell apart: pages only.)
    expect(carrying(['Cloudflare'], /\.html$/)).toEqual([]);
  } else {
    // The route is on: its code and its privacy section are published, and the policy above names its one origin.
    expect(carrying(['/v1/jobs'], /\.js$/).length).toBeGreaterThan(0);
    expect(carrying(['AssemblyAI'], /gizlilik[\\/]index\.html$/).length).toBe(1);
  }
});

// ------------------------------------------------------------ Yazıya dök (ADR-036)

const MODEL_MANIFEST = JSON.parse(readFileSync(join(process.cwd(), 'src', 'domain', 'modelManifest.json'), 'utf8')) as {
  groups: Record<string, { dir: string; files: { path: string; bytes: number; sha256: string }[] }>;
};
const OUT_MODELS = join(process.cwd(), 'out', 'models');
const groupPublished = (id: string) =>
  MODEL_MANIFEST.groups[id]!.files.every((file) => existsSync(join(OUT_MODELS, MODEL_MANIFEST.groups[id]!.dir, file.path)));
// Against the published site the models are on the site itself, not in a local out/ folder.
const BASE_PUBLISHED = Boolean(process.env.PAGES_SITE_ORIGIN) || ['runtime', 'vad', 'base'].every(groupPublished);
const SPEECH_VIDEO = join(__dirname, '..', 'media', 'speech-fleurs-en-01.mp4');

test('the model files are served under /capcut/models/: exact length, exact sha256, Range, licences', async ({ request }) => {
  test.skip(!BASE_PUBLISHED, 'out/models has no model files (node scripts/fetch-models.mjs --dest=out/models --copy) — NOT RUN');
  // 675 MB from the published site: minutes on a fast line, over a quarter of an hour on a slow evening one.
  test.setTimeout(process.env.PAGES_SITE_ORIGIN ? 3_600_000 : 900_000);
  // Published site: every group must be there, and the bytes are read from the site itself.
  const live = process.env.PAGES_SITE_ORIGIN;
  const published = live ? ['runtime', 'vad', 'base', 'turbo'] : ['runtime', 'vad', 'base', 'turbo'].filter(groupPublished);
  expect(published).toEqual(expect.arrayContaining(['runtime', 'vad', 'base']));
  let bytes = 0;
  for (const id of published) {
    const group = MODEL_MANIFEST.groups[id]!;
    for (const file of group.files) {
      // What is on disk in the export is what the pin says (the published bytes).
      if (live) {
        const response = await fetch(new URL(`capcut/models/${group.dir}/${file.path}`, `${live}/`));
        expect(response.status, `${group.dir}/${file.path}`).toBe(200);
        const hash = createHash('sha256');
        let length = 0;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          length += chunk.length;
        }
        expect(length, `${group.dir}/${file.path}`).toBe(file.bytes);
        expect(hash.digest('hex'), `${group.dir}/${file.path}`).toBe(file.sha256);
        bytes += length;
      } else {
        const body = readFileSync(join(OUT_MODELS, group.dir, file.path));
        expect(body.length, `${group.dir}/${file.path}`).toBe(file.bytes);
        expect(createHash('sha256').update(body).digest('hex'), `${group.dir}/${file.path}`).toBe(file.sha256);
        bytes += body.length;
      }
      // And the server hands it out under the sub-path, in ranges.
      const part = await request.get(`models/${group.dir}/${file.path}`, { headers: { Range: 'bytes=0-15', 'Accept-Encoding': 'identity' } });
      expect([200, 206], `${group.dir}/${file.path}`).toContain(part.status());
      if (part.status() === 206) expect((await part.body()).length).toBe(Math.min(16, file.bytes));
    }
  }
  console.log(`PAGES-MODELS ${JSON.stringify({ published, bytes })}`);
  const licences = await request.get('models/LICENSES.txt');
  expect(licences.status()).toBe(200);
  const text = await licences.text();
  expect(text).toContain('Copyright (c) 2022 OpenAI');
  expect(text).toContain('Silero Team');
  expect(text).toContain('Apache License');
});

test('Yazıya dök under /capcut/ with the real model: download from this site, write, burn in; no request leaves it', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!BASE_PUBLISHED, 'out/models has no model files — NOT RUN');
  test.setTimeout(600_000);
  const seen = watchRequests(page);
  const watch = await watchCsp(context);
  await watch.attach(page);
  await installSavePicker(page);
  const modelRequests: string[] = [];
  page.context().on('request', (request) => {
    if (request.url().includes('/models/')) modelRequests.push(new URL(request.url()).pathname);
  });

  await page.goto('./');
  await expect(page.getByTestId('task-yazi')).toHaveAttribute('href', '/capcut/yap/yazi/');
  // Loaded as a document (not a soft navigation), so the page's own policy tag can be read.
  await page.goto('yap/yazi/');
  await expectPolicy(page);
  await page.getByTestId('video-input').setInputFiles(SPEECH_VIDEO);
  // With the internet route in the site (ADR-039) "Yazıyı nerede çıkaralım?" comes first; this test is the
  // on-device way, and nothing may leave the site on the way (`seen.outside` below).
  const routeChoice = page.getByTestId('route-choice');
  await expect(page.getByTestId('model-download').or(routeChoice)).toBeVisible({ timeout: 60_000 });
  if (await routeChoice.isVisible()) {
    expect(allowedConnectSrc().some((value) => value !== "'self'"), 'a choice screen in a build without the route').toBe(true);
    await page.getByTestId('route-device-go').click();
  }
  await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });
  // Where this browser can run the large model it is the pre-selected, recommended one (ADR-036, 7 Oct):
  // this test is about the small one, so it says so.
  if (await page.getByTestId('option-model-base').count()) await page.getByTestId('option-model-base').check();
  await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈108,8 MB, bir kez)', { timeout: 60_000 });
  // The published build has no test hooks.
  await expect(page.getByTestId('transcribe-steps')).not.toHaveAttribute('data-test-hooks', '1');
  expect(modelRequests).toEqual([]);
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 300_000 });
  expect(modelRequests.length).toBeGreaterThan(5);
  expect(modelRequests.every((path) => path.startsWith('/capcut/models/'))).toBe(true);

  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 300_000 });
  const text = (await page.locator('[data-testid="transcript-row"][data-kind="cue"] .transcript-text').allTextContents()).join(' ');
  expect(text).toContain('French people who had made peace with the Germans in 1940');
  await expect(page.getByTestId('transcript-machine-note')).toContainText('Otomatik yazıldı');

  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
  const saved = probeMp4(await readSaved(page, testInfo, 'saved-speech-fleurs-en-01_altyazili.mp4'));
  expect(saved.videoCodec).toBe('h264');

  expect(watch.violations).toEqual([]);
  expect(seen.failures).toEqual([]);
  expect(seen.outside).toEqual([]);
});

/**
 * ADR-037 under the sub-path: the card, the wizard page, the before/after made by the export
 * worker (WebGL shaders compiled from strings, or the reference renderer), the download. The
 * published build has no test hook for the engine; whichever engine this browser gets must work
 * with the policy the site ships and without one request leaving it.
 */
test('İyileştir under /capcut/: before/after from the export worker, download, the policy holds', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(300_000);
  const seen = watchRequests(page);
  const watch = await watchCsp(context);
  await watch.attach(page);
  await installSavePicker(page);
  const source = enhanceFixture('dark');

  await page.goto('./');
  await expect(page.getByTestId('task-iyilestir')).toHaveAttribute('href', '/capcut/yap/iyilestir/');
  await page.getByTestId('finder-input').fill('kaliteyi yükselt');
  await expect(page.getByTestId('result-iyilestir')).toContainText('Çok bulanık bir videoyu netleştiremez.');
  // Loaded as a document (not a soft navigation), so the page's own policy tag can be read.
  await page.goto('yap/iyilestir/');
  await expectPolicy(page);
  await page.getByTestId('video-input').setInputFiles(source);
  await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
  expect(['webgl2', 'cpu']).toContain(await page.getByTestId('enhance-preview').getAttribute('data-engine'));
  await expect(page.getByTestId('iyilestir-summary')).toHaveAttribute('data-light', 'much');

  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('export-method')).toHaveAttribute('data-fallback', 'enhance');
  await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-enhanced-frames', '90');
  const savedPath = await readSaved(page, testInfo, 'saved-karanlik_iyilestirilmis.mp4');
  const saved = probeMp4(savedPath);
  expect(saved.videoCodec).toBe('h264');
  expect(saved.frames).toBe(90);
  const before = frameLumas(source);
  const after = frameLumas(savedPath);
  expect((after[45] ?? 0) - (before[45] ?? 0)).toBeGreaterThan(15);

  expect(watch.violations).toEqual([]);
  expect(seen.failures).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('GIF yap under /capcut/: its worker, the typeface of its text and the saved GIF, the policy holds', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const seen = watchRequests(page);
  const watch = await watchCsp(context);
  await watch.attach(page);
  await installSavePicker(page);

  await page.goto('./');
  await expect(page.getByTestId('task-gif')).toHaveAttribute('href', '/capcut/yap/gif/');
  await page.goto('yap/gif/');
  await expectPolicy(page);
  await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
  await expect(page.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  // Text: the worker loads the caption typeface from the sub-path, or refuses ("Yazının harfleri yüklenemedi").
  await page.getByTestId('gif-text-top').fill('PAZARTESİ');
  await expect(page.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
  const savedPath = await readSaved(page, testInfo, 'saved-other-8s_gif.gif');
  const bytes = readFileSync(savedPath);
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  expect(bytes.readUInt16LE(6)).toBe(320);
  expect(bytes.readUInt16LE(8)).toBe(180);
  expect(seen.outside).toEqual([]);
  expect(watch.violations).toEqual([]);
  expect(seen.failures).toEqual([]);
});

/**
 * "LiloCut'a paylaş" (ADR-047) under the sub-path: the manifest's share target is `/capcut/paylas/`,
 * the worker registered for `/capcut/` takes Android's POST there on the device and answers with
 * `/capcut/?paylasim=<id>`; the cards carry the video under `/capcut/yap/…/`. Without the worker
 * the POST meets the host (here `serve-static.mjs`, which answers 405 as GitHub Pages is reported to).
 */
test('share to the app under /capcut/: the worker takes the POST, the opening screen and a wizard have the video', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const seen = watchRequests(page);
  const origin = new URL(testInfo.project.use.baseURL ?? '').origin;
  const manifest = (await (await request.get('/capcut/manifest.webmanifest')).json()) as { share_target?: { action?: string } };
  expect(manifest.share_target?.action).toBe('/capcut/paylas/');

  await page.goto('./');
  await waitForWorker(page);
  const landed = await shareFiles(page, [OTHER_VIDEO], `${origin}/capcut/paylas/`);
  expect(landed.pathname).toBe('/capcut/');
  const id = landed.searchParams.get('paylasim') ?? '';
  expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]{6}$/);
  expect(await storedShares(page)).toEqual([`/capcut/paylas/dosya/${id}`]);
  await expect(page.getByTestId('home-title')).toHaveText('Bu videoyla ne yapmak istiyorsun?');
  await expect(page.getByTestId('home-video-name')).toHaveText('other-8s.mp4');
  await expect(page.getByTestId('task-dikey')).toHaveAttribute('href', `/capcut/yap/dikey/?paylasim=${id}`);
  await page.getByTestId('task-dikey').click();
  await expect(page).toHaveURL(/\/capcut\/yap\/dikey\/$/);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(page.getByTestId('wizard-video-name')).toHaveText('other-8s.mp4');
  await expect.poll(() => storedShares(page)).toBeNull();
  expect(seen.outside).toEqual([]);

  // No worker (the browser lost the site's data): the host's own answer, nothing of the app, nothing kept.
  const bare = await browser.newContext({ serviceWorkers: 'block' });
  const other = await bare.newPage();
  const answer = other.waitForResponse((response) => response.request().method() === 'POST');
  await shareFiles(other, [OTHER_VIDEO], `${origin}/capcut/paylas/`);
  expect((await answer).status()).toBe(405);
  await expect(other.getByTestId('home-title')).toHaveCount(0);
  await bare.close();
});

/**
 * ADR-044 under the sub-path: the watchdog of a page that never came alive is
 * in every published page as an inline script, its hash is in that page's
 * policy, it knows the site lives under /capcut/ — and it does its work on
 * the published files: a build file that fails once costs one reload.
 */
test.describe('the page watchdog under /capcut/', () => {
  // Without the service worker: once it controls the page, the build files come from its stored copy and
  // the failures made below would never reach the page.
  test.use({ serviceWorkers: 'block' });

  test('a page that does not come alive: the watchdog is in the export, hashed into the policy, and recovers under /capcut/', async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(120_000);
    // It breaks a page load on purpose: its recovery is counted apart (tests/e2e/fixtures.ts).
    expectPageRecovery();
    for (const path of ['./', 'editor/', 'yap/cevir/', 'gizlilik/', 'gizlilik/en/']) {
      const html = await (await request.get(path)).text();
      const ours = [...html.matchAll(/<script data-clip-watchdog="">([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
      expect(ours.length, `${path}: one watchdog script`).toBe(1);
      const script = ours[0] ?? '';
      expect(script).toContain('clip:page-recovery');
      // The first script of the page, before any stylesheet is asked for.
      expect(html.search(/<script[\s>]/), path).toBe(html.indexOf('<script data-clip-watchdog'));
      expect(html.indexOf('<script data-clip-watchdog'), path).toBeLessThan(html.search(/<link[\s>]/));
      const policy = /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html)?.[1] ?? '';
      expect(policy, path).toContain(`'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`);
      expect(policy).not.toContain('unsafe-inline');
      expect(script).toContain('"staticPrefix":"/capcut/_next/static/"');
      expect(script).toContain('"scope":"/capcut/"');
      expect(script).toContain('"enPrefix":"/capcut/gizlilik/en"');
      expect(script).toContain('"graceS":15');
      expect(html).toContain('id="clip-page-dead"');
      expect(html).toContain('Sayfa tam açılamadı.');
      expect(html).toContain('The page did not open fully.');
    }

    const csp = await watchCsp(context);
    await csp.attach(page);
    let documents = 0;
    page.on('request', (item) => {
      if (item.isNavigationRequest() && item.frame() === page.mainFrame()) documents += 1;
    });
    // Every build script fails while the tab is on its first load.
    await page.route('**/capcut/_next/static/chunks/*.js', (route) => (documents < 2 ? route.abort('connectionreset') : route.continue()));
    await page.goto('yap/cevir/');
    await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 40_000 });
    expect(documents).toBe(2);
    await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
    await expect(page.getByTestId('page-dead')).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('clip:page-recovery') ?? 'null'))).toMatchObject({
      s: 'recovered',
      p: '/capcut/yap/cevir/',
      why: 'file',
    });

    // And when they keep failing: the notice, in the page's own colours, with its button; no further reload.
    await page.unroute('**/capcut/_next/static/chunks/*.js');
    await page.evaluate(() => sessionStorage.clear());
    documents = 0;
    await page.route('**/capcut/_next/static/chunks/*.js', (route) => route.abort('connectionreset'));
    await page.goto('yap/cevir/');
    await expect(page.getByTestId('page-dead')).toHaveAttribute('data-state', 'dead', { timeout: 40_000 });
    expect(documents).toBe(2);
    await expect(page.getByTestId('page-dead-reload-tr')).toBeVisible();
    await page.waitForTimeout(20_000);
    expect(documents).toBe(2);
    expect(csp.violations, csp.violations.join('\n')).toEqual([]);
  });
});
