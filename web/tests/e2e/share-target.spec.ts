import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

import { expect, test, type Browser, type Page } from './fixtures';
import { installSavePicker, noHorizontalOverflow } from './kesitFlow';
import { shareFiles, storedShares, waitForWorker } from './shareKit';
import { expectStylesApplied } from './stylesReady';

/**
 * "LiloCut'a paylaş" (ADR-047): Android's share sheet → the installed app → the opening screen with
 * the video already picked → a task card → that task's next step with the video.
 *
 * The share is the request Android makes: a top-level navigation POST of a multipart form to
 * `/paylas/`, from outside the app (here a blank page, as the gallery is another app), with the
 * video in the field the manifest names. It goes through the browser's real service worker — the
 * one the app registered — and the stored copy is read back from the browser's real Cache Storage.
 * Only Android's share sheet itself is not here (tested on the phone, ADR-047 "Telefonda").
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, 24 s
const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, 8 s
const PICTURE = join(process.cwd(), 'public', 'icons', 'icon-192.png');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

test.describe.configure({ timeout: 180_000 });

/** The app was opened once (the worker installed), as it was before the phone could offer it to share to. */
async function installed(page: Page) {
  await page.goto('/');
  await waitForWorker(page);
}

/** Android's share sheet sending `files` to the installed app (shareKit.ts). */
function share(page: Page, files: string[], baseURL: string): Promise<URL> {
  return shareFiles(page, files, new URL('/paylas/', baseURL).href);
}

async function axe(page: Page) {
  await expectStylesApplied(page, 'home');
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test.describe('share a video to the app', () => {
  test('the opening screen opens with the shared video; "GIF yap" goes straight to its choose step and makes the GIF', async ({
    page,
    baseURL,
  }, testInfo) => {
    await installSavePicker(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installed(page);

    const landed = await share(page, [SAMPLE], baseURL ?? '');
    // The worker answered the POST on the device (303) and the browser followed to the opening screen.
    expect(landed.pathname).toBe('/');
    const id = landed.searchParams.get('paylasim') ?? '';
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]{6}$/);
    expect(await storedShares(page)).toEqual([`/paylas/dosya/${id}`]);

    await expect(page.getByTestId('home-title')).toHaveText('Bu videoyla ne yapmak istiyorsun?');
    const block = page.getByTestId('home-video');
    await expect(block).toHaveAttribute('data-source', 'shared');
    await expect(block).toHaveAccessibleName('Paylaştığın video');
    await expect(page.getByTestId('home-video-name')).toHaveText('sample-24s.mp4');
    await expect(page.getByTestId('home-video-length')).toHaveText('24,0 sn');
    await expect(page.getByTestId('home-video-change')).toHaveText('Başka bir video seç');
    await expect(page.getByTestId('home-share-many')).toHaveCount(0);
    // Every task is still there, each carrying the video.
    await expect(page.getByTestId('task-grid').getByRole('link')).toHaveCount(11);
    await expect(page.getByTestId('task-gif')).toHaveAttribute('href', `/yap/gif?paylasim=${id}`);

    await page.getByTestId('task-gif').click();
    await expect(page).toHaveURL(/\/yap\/gif$/);
    // No "Videonu seç": the next step, with the video.
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
    await expect(page.getByTestId('wizard-step')).toContainText('Adım 2 / 3');
    await expect(page.getByTestId('wizard-video-name')).toHaveText('sample-24s.mp4');
    // Taken: the stored copy is gone at once.
    await expect.poll(() => storedShares(page)).toBeNull();

    // The video read from the deleted copy is still whole: the GIF is made from it.
    await expect(page.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_gif.gif', { timeout: 120_000 });
    testInfo.annotations.push({ type: 'share', description: `id ${id}` });

    // Back on the opening screen the video is still in hand: another task with it, here "Kes".
    await page.getByTestId('wizard-home').click();
    await expect(page.getByTestId('home-title')).toHaveText('Bu videoyla ne yapmak istiyorsun?');
    await expect(page.getByTestId('home-video-name')).toHaveText('sample-24s.mp4');
    await page.getByTestId('task-kes').click();
    // "Kes" is the editor: it opens over the video, no second file dialog.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    expect(errors).toEqual([]);
  });

  test('"Kes" from a fresh share opens the editor with the video, after a full page load too', async ({ page, baseURL }) => {
    await installed(page);
    const landed = await share(page, [OTHER], baseURL ?? '');
    const id = landed.searchParams.get('paylasim') ?? '';
    await expect(page.getByTestId('home-video-name')).toHaveText('other-8s.mp4');
    // A full load of the wizard (what the offline fallback and ADR-044's 10 s guard do): from the stored copy.
    await page.goto(`/yap/kes?paylasim=${id}`);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => storedShares(page)).toBeNull();
    // A reload is the wizard's own first step again: the address no longer names the share.
    expect(new URL(page.url()).search).toBe('');
  });

  test('several files at once: the first video is taken, and the screen says so', async ({ page, baseURL }) => {
    await installed(page);
    await share(page, [PICTURE, OTHER, SAMPLE], baseURL ?? '');
    await expect(page.getByTestId('home-video-name')).toHaveText('other-8s.mp4');
    await expect(page.getByTestId('home-share-many')).toHaveText(
      '3 dosya paylaştın. Bir seferde bir video açılır: ilk videoyu aldım. Ötekiler için onları tek tek paylaş.',
    );
    expect(await storedShares(page)).toHaveLength(1);
  });

  test('a share without a video: said plainly, nothing kept, the cards as always', async ({ page, baseURL }) => {
    await installed(page);
    const landed = await share(page, [PICTURE], baseURL ?? '');
    expect(landed.pathname).toBe('/');
    expect(landed.searchParams.get('paylasim-hata')).toBe('video-degil');
    await expect(page.getByTestId('home-share-notice')).toHaveText(
      'Paylaştığın dosya bir video değil. Bu uygulama yalnızca videolarla çalışır: galeriden bir video paylaş.',
    );
    await expect(page.getByTestId('home-title')).toHaveText('Ne yapmak istiyorsun?');
    await expect(page.getByTestId('home-video')).toHaveCount(0);
    await expect(page.getByTestId('task-kes')).toHaveAttribute('href', '/yap/kes');
    expect(await storedShares(page)).toBeNull();
    expect(await axe(page)).toEqual([]);
  });

  test('nobody took it: the stored copy goes 15 minutes after the share; the video in hand still works', async ({ page, baseURL }) => {
    // The page's clock only (the worker's is the real one): the share is stamped at the real time.
    await page.clock.install();
    await installed(page);
    await share(page, [OTHER], baseURL ?? '');
    await expect(page.getByTestId('home-video-name')).toHaveText('other-8s.mp4');
    expect(await storedShares(page)).toHaveLength(1);
    await page.clock.fastForward('14:00');
    expect(await storedShares(page)).toHaveLength(1);
    await page.clock.fastForward('01:30');
    await expect.poll(() => storedShares(page)).toBeNull();
    await page.getByTestId('task-cevir').click();
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
    await expect(page.getByTestId('wizard-video-name')).toHaveText('other-8s.mp4');
  });

  test('nobody took it: the next start of the app deletes it', async ({ page, baseURL }) => {
    await installed(page);
    await share(page, [OTHER], baseURL ?? '');
    await expect(page.getByTestId('home-video-name')).toHaveText('other-8s.mp4');
    expect(await storedShares(page)).toHaveLength(1);
    // Opened again later from its icon: no share in the address.
    await page.goto('/');
    await expect.poll(() => storedShares(page)).toBeNull();
    await expect(page.getByTestId('home-title')).toHaveText('Ne yapmak istiyorsun?');
    await expect(page.getByTestId('home-video')).toHaveCount(0);
  });

  test('a share that is no longer here says so, on the opening screen and in a wizard', async ({ page }) => {
    await installed(page);
    await page.goto('/?paylasim=lq2x00-abcdef');
    await expect(page.getByTestId('home-share-notice')).toHaveText(
      'Paylaştığın video artık burada değil. Yeniden paylaş ya da aşağıdan bir iş seçip videonu seç.',
    );
    await page.goto('/yap/dikey?paylasim=lq2x00-abcdef');
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    await expect(page.getByTestId('wizard-share-gone')).toHaveText('Paylaştığın video artık burada değil. Videonu buradan seç.');
    await expect(page.getByTestId('pick-video')).toBeEnabled();
    // A video picked on the opening screen lives only in the page: a full load of the wizard says so.
    await page.goto('/yap/sustur?paylasim=secilen');
    await expect(page.getByTestId('wizard-share-gone')).toHaveText(
      'Ana ekranda seçtiğin video bu sayfaya gelemedi. Videonu buradan yeniden seç.',
    );
  });

  test('"Başka bir video seç" swaps the video; the search still finds, and what cannot be done still says so', async ({ page, baseURL }) => {
    await installed(page);
    await share(page, [SAMPLE], baseURL ?? '');
    await expect(page.getByTestId('home-video-name')).toHaveText('sample-24s.mp4');
    await page.getByTestId('home-video-input').setInputFiles(OTHER);
    await expect(page.getByTestId('home-video-name')).toHaveText('other-8s.mp4');
    await expect(page.getByTestId('home-video')).toHaveAttribute('data-source', 'picked');
    await expect(page.getByTestId('home-video')).toHaveAccessibleName('Seçtiğin video');
    // The shared copy is no longer wanted: deleted, and the address no longer names it.
    await expect.poll(() => storedShares(page)).toBeNull();
    expect(new URL(page.url()).search).toBe('');

    // Something that is not built yet: the honest line, no button.
    await page.getByTestId('finder-input').fill('döndür');
    await expect(page.getByTestId('result-unavailable').first()).toHaveText('Bunu henüz yapamıyoruz.');
    // A task found by typing starts with the video too.
    await page.getByTestId('finder-input').fill('dikey yap');
    await page.getByTestId('finder-input').press('Enter');
    await expect(page).toHaveURL(/\/yap\/dikey$/);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
    await expect(page.getByTestId('wizard-video-name')).toHaveText('other-8s.mp4');
  });

  test('a11y: the opening screen with a shared video, on a phone and a computer', async ({ browser, baseURL }) => {
    for (const viewport of [
      { width: 360, height: 740 },
      { width: 1440, height: 900 },
    ]) {
      const context = await (browser as Browser).newContext({ viewport });
      const page = await context.newPage();
      await installed(page);
      await share(page, [SAMPLE], baseURL ?? '');
      await expect(page.getByTestId('home-video-name')).toHaveText('sample-24s.mp4');
      expect(await axe(page), `${viewport.width} px`).toEqual([]);
      await noHorizontalOverflow(page);
      const change = await page.getByTestId('home-video-change').boundingBox();
      expect(change?.height ?? 0).toBeGreaterThanOrEqual(44);
      await context.close();
    }
  });
});

test.describe('without the app ready (no service worker)', () => {
  test('the POST goes to the site’s server, nothing of the app answers it, nothing is kept', async ({ browser, baseURL }) => {
    // A browser that has no worker for the site (its data was cleared, or the browser evicted it): what
    // remains of the share target is the host. ADR-047 "Uygulama hazır değilken": the host answers
    // with an error of its own (here `next start`: "Server action not found."; GitHub Pages: 405).
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(`${new URL(request.url()).pathname} ${request.headers()['content-type']?.split(';')[0]}`);
    });
    const landed = await share(page, [OTHER], baseURL ?? '');
    // The video went to the server (`next start` sends it on once more: its 308 to "/paylas" keeps the POST).
    expect(posts[0]).toBe('/paylas/ multipart/form-data');
    expect(posts.every((post) => post.endsWith(' multipart/form-data'))).toBe(true);
    expect(landed.searchParams.get('paylasim')).toBeNull();
    await expect(page.getByTestId('home-video')).toHaveCount(0);
    // Nothing of the share was kept in the browser.
    await page.goto('/');
    expect(await storedShares(page)).toBeNull();
    await expect(page.getByTestId('home-title')).toHaveText('Ne yapmak istiyorsun?');
    await context.close();
  });
});
