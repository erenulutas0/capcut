import { expect, test, type Page, type Route } from './fixtures';

/**
 * A task card or a search result that seems dead (ADR-044, addendum of 14 Oct
 * 2026; "Bilinen sınırlar: yerinde sayan `?_rsc` isteği").
 *
 * A press on the opening screen opens the task with Next's client router,
 * which first asks for the page's data (`?_rsc=…`). When that request never
 * answers, nothing happened: reproduced on this build before the change —
 * 25 s after the press still on `/`, the one `?_rsc` request held, no
 * document request, the card unchanged.
 *
 * Now: the pressed card or row says "Açılıyor…" at once; 10 s after the press
 * the same address is loaded in full, once. A normal navigation — also a slow
 * one that completes — never triggers it, and a full load that stalls too is
 * not repeated.
 *
 * 15 Oct 2026: the same guard, one per screen, for the other links that go
 * through the client router — "Kendim düzenleyeceğim" and the privacy link
 * on the opening screen, "Geri" / the wordmark / "Ana ekrana dön" in a
 * wizard, the wordmark in the editor (`FallbackLink.tsx`).
 */

const FALLBACK_MS = 10_000;

/** Holds every `?_rsc` request without an answer, as a connection that stalls would. */
async function holdRsc(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.route(
    (url) => url.searchParams.has('_rsc'),
    (route) => {
      held.push(route);
    },
  );
  return held;
}

/** Document (full page) requests, with when they were made. */
function watchDocuments(page: Page): { path: string; at: number }[] {
  const seen: { path: string; at: number }[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') seen.push({ path: new URL(request.url()).pathname, at: Date.now() });
  });
  return seen;
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  // React owns the page: a press goes to the client router, not the browser.
  await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
}

async function expectWizard(page: Page, id: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/yap/${id}$`));
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await expect(page.getByTestId('pick-video')).toBeEnabled();
}

test.describe.configure({ timeout: 120_000 });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a card whose page data never arrives: "Açılıyor…" at once, then the same page loads in full after 10 s', async ({ page }) => {
  await openHome(page);
  const held = await holdRsc(page);
  const documents = watchDocuments(page);
  const card = page.getByTestId('task-kes');
  const pressedAt = Date.now();
  await card.click();

  // Never silent: the pressed card says so, and the page's status tells a screen reader.
  await expect(card).toHaveAttribute('aria-busy', 'true', { timeout: 1_000 });
  await expect(card.locator('.task-card-sub')).toHaveText('Açılıyor…');
  await expect(page.getByTestId('finder-status')).toHaveText('Açılıyor…');
  await expect(page.getByTestId('task-yazi')).not.toHaveAttribute('aria-busy', 'true');
  expect(held.length).toBeGreaterThan(0);

  // The client router waits; the guard does not wait forever.
  await expect.poll(() => documents.length, { timeout: FALLBACK_MS + 10_000 }).toBe(1);
  expect(documents[0].path).toBe('/yap/kes');
  const waited = documents[0].at - pressedAt;
  expect(waited).toBeGreaterThanOrEqual(FALLBACK_MS - 200);
  expect(waited).toBeLessThan(FALLBACK_MS + 3_000);
  await expectWizard(page, 'kes');
  expect(documents.map((entry) => entry.path)).toEqual(['/yap/kes']);
});

test('a search result whose page data never arrives: "Açılıyor…" on the row, then the full load', async ({ page }) => {
  await openHome(page);
  await page.getByTestId('finder-input').fill('yazıya dök');
  const row = page.getByTestId('result-yazi');
  await expect(row).toBeVisible();
  const held = await holdRsc(page);
  const documents = watchDocuments(page);
  await row.click();
  await expect(row.getByTestId('result-start')).toHaveText('Açılıyor…', { timeout: 1_000 });
  await expect(row).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('finder-status')).toHaveText('Açılıyor…');
  expect(held.length).toBeGreaterThan(0);

  await expect.poll(() => documents.map((entry) => entry.path), { timeout: FALLBACK_MS + 10_000 }).toEqual(['/yap/yazi']);
  await expect(page).toHaveURL(/\/yap\/yazi$/);
  await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
});

test('a normal navigation — also one whose data takes 3 s — never triggers the full load', async ({ page }) => {
  await openHome(page);
  const documents = watchDocuments(page);

  // Fast: the client router alone.
  await page.getByTestId('task-dikey').click();
  await expectWizard(page, 'dikey');

  // Slow but completing: the data arrives 3 s after it was asked for.
  await page.goBack();
  await expect(page.getByTestId('task-kes')).toBeVisible();
  await page.route(
    (url) => url.searchParams.has('_rsc'),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue().catch(() => undefined);
    },
  );
  await page.getByTestId('task-kes').click();
  await expect(page.getByTestId('task-kes').locator('.task-card-sub')).toHaveText('Açılıyor…', { timeout: 1_000 });
  await expectWizard(page, 'kes');

  // Well past the 10 s: no page was loaded in full, the wizard is where it was.
  await page.waitForTimeout(FALLBACK_MS + 2_000);
  expect(documents).toEqual([]);
  await expect(page).toHaveURL(/\/yap\/kes$/);
});

test.describe('the other links of a screen (15 Oct 2026: one guard per screen, FallbackLink)', () => {
  // Before: "Kendim düzenleyeceğim" was left out of the 14 Oct guard. Reproduced on that build with the
  // `?_rsc` request held: 25 s after the press still on `/`, no document request, the link unchanged.

  test('"Kendim düzenleyeceğim" whose page data never arrives: "Açılıyor…" at once, then the editor loads in full after 10 s', async ({ page }) => {
    await openHome(page);
    const held = await holdRsc(page);
    const documents = watchDocuments(page);
    const link = page.getByTestId('home-editor-link');
    const pressedAt = Date.now();
    await link.click();

    await expect(link).toHaveAttribute('aria-busy', 'true', { timeout: 1_000 });
    await expect(link).toHaveText('Açılıyor…');
    // The same guard as the cards': the screen's status says it, and no card is marked.
    await expect(page.getByTestId('finder-status')).toHaveText('Açılıyor…');
    await expect(page.getByTestId('task-kes')).not.toHaveAttribute('aria-busy', 'true');
    expect(held.length).toBeGreaterThan(0);

    await expect.poll(() => documents.length, { timeout: FALLBACK_MS + 10_000 }).toBe(1);
    expect(documents[0].path).toBe('/editor');
    const waited = documents[0].at - pressedAt;
    expect(waited).toBeGreaterThanOrEqual(FALLBACK_MS - 200);
    expect(waited).toBeLessThan(FALLBACK_MS + 3_000);
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByTestId('download-all')).toBeVisible();
    expect(documents.map((entry) => entry.path)).toEqual(['/editor']);
  });

  test('a wizard\'s "Geri" whose page data never arrives: "Açılıyor…", then the opening screen loads in full', async ({ page }) => {
    await page.goto('/yap/kes');
    await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
    await expect(page.getByTestId('pick-video')).toBeEnabled();
    const held = await holdRsc(page);
    const documents = watchDocuments(page);
    const back = page.getByTestId('wizard-back');
    await back.click();
    await expect(back).toHaveText('Açılıyor…', { timeout: 1_000 });
    await expect(back).toHaveAttribute('aria-busy', 'true');
    expect(held.length).toBeGreaterThan(0);

    await expect.poll(() => documents.map((entry) => entry.path), { timeout: FALLBACK_MS + 10_000 }).toEqual(['/']);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
    expect(documents.map((entry) => entry.path)).toEqual(['/']);
  });

  test('the editor\'s wordmark: the logo stays, assistive technology hears "Açılıyor…", then the full load', async ({ page }) => {
    await page.goto('/editor');
    await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
    await expect(page.getByTestId('download-all')).toBeVisible();
    await holdRsc(page);
    const documents = watchDocuments(page);
    const link = page.getByTestId('home-link');
    await link.click();
    await expect(link).toHaveAttribute('aria-busy', 'true', { timeout: 1_000 });
    await expect(link).toHaveAttribute('aria-label', 'Açılıyor…');
    await expect(link.locator('.wordmark')).toBeVisible();

    await expect.poll(() => documents.map((entry) => entry.path), { timeout: FALLBACK_MS + 10_000 }).toEqual(['/']);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
  });

  test('normal presses — the editor link, the editor\'s wordmark, a card, "Geri" — never trigger the full load', async ({ page }) => {
    await openHome(page);
    const documents = watchDocuments(page);

    await page.getByTestId('home-editor-link').click();
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByTestId('download-all')).toBeVisible();

    await page.getByTestId('home-link').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-editor-link')).toHaveText('Kendim düzenleyeceğim');
    await expect(page.getByTestId('home-editor-link')).not.toHaveAttribute('aria-busy', 'true');

    await page.getByTestId('task-kes').click();
    await expectWizard(page, 'kes');
    await page.getByTestId('wizard-back').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('task-kes')).toBeVisible();

    // Well past the 10 s since the last press: nothing was loaded in full.
    await page.waitForTimeout(FALLBACK_MS + 2_000);
    expect(documents).toEqual([]);
  });
});

test.describe('a full load that stalls too', () => {
  // No service worker: it would answer the full load from its copy of the page (as it does for a user who
  // has been here before). Without one — a first visit — the full load can stall like the data request did.
  test.use({ serviceWorkers: 'block' });

  test('it cannot loop: the full load is asked for once, and not again', async ({ page }) => {
    await openHome(page);
    await holdRsc(page);
    // The full load of the task's page gets no answer either.
    const heldLoads: Route[] = [];
    await page.route(
      (url) => url.pathname === '/yap/kes' && !url.searchParams.has('_rsc'),
      (route) => {
        heldLoads.push(route);
      },
    );
    const documents = watchDocuments(page);
    await page.getByTestId('task-kes').click();
    await expect(page.getByTestId('task-kes').locator('.task-card-sub')).toHaveText('Açılıyor…', { timeout: 1_000 });
    await expect.poll(() => documents.length, { timeout: FALLBACK_MS + 10_000 }).toBe(1);

    // Long after: still the one full load. (While a full load is pending, Playwright waits for it before it
    // reads the page, so only the requests are looked at here; a second press on the same screen is the
    // unit test's: tests/unit/navigationFallback.test.ts.)
    await page.waitForTimeout(3 * FALLBACK_MS);
    expect(documents.map((entry) => entry.path)).toEqual(['/yap/kes']);

    // The stalled load is let through at last: the task opens, and nothing loads it a second time.
    expect(heldLoads).toHaveLength(1);
    await heldLoads[0].continue();
    await expectWizard(page, 'kes');
    expect(documents.map((entry) => entry.path)).toEqual(['/yap/kes']);
  });
});
