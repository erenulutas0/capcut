import { expect, test, type Page } from '@playwright/test';

import { availableTasks, TASKS, TASK_EXAMPLES } from '../../src/domain/tasks';
import { tr } from '../../src/i18n/messages';
import { noHorizontalOverflow } from './kesitFlow';

/**
 * The opening screen (ADR-034, founder decision 3 Oct 2026: designs A + C):
 * "Ne yapmak istiyorsun?", the type-to-find box, the task cards, the quiet
 * way to the editor. The matching itself is unit-tested
 * (tests/unit/taskSearch.test.ts); here it is the screen around it.
 */

const SIZES = [
  { name: 'phone 360', width: 360, height: 780 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'desktop 1440', width: 1440, height: 900 },
] as const;

const box = (page: Page) => page.getByTestId('finder-input');
const results = (page: Page) => page.getByRole('option');

/** No request may leave the page while the user types: the search is local. */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));
  return seen;
}

test.describe('opening screen', () => {
  test('says what it is for: the question, the box, a card per working task, the editor link, the trust line', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
    await expect(box(page)).toBeVisible();
    await expect(box(page)).toHaveAttribute('placeholder', 'Yaz: sessiz yerleri sil');
    await expect(page.getByTestId('finder-example')).toHaveText([...TASK_EXAMPLES]);

    // The cards, in the registry's order: exactly the tasks that work today.
    const cards = page.getByTestId('task-grid').getByRole('link');
    await expect(cards).toHaveCount(5);
    expect(await cards.evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(
      availableTasks().map((task) => `/yap/${task.id}`),
    );
    await expect(page.getByTestId('task-kes')).toContainText('Kes');
    await expect(page.getByTestId('task-kes')).toContainText('İstediğin yerleri al');
    await expect(page.getByTestId('task-bosluk')).toContainText('Boşlukları at');
    await expect(page.getByTestId('task-dikey')).toContainText('Dikey yap');
    await expect(page.getByTestId('task-muzik')).toContainText('Müzik ekle');
    await expect(page.getByTestId('task-cevir')).toContainText('Her yerde açılsın');
    // Not built yet: no card, no mention on the screen.
    for (const task of TASKS.filter((item) => !item.available)) {
      await expect(page.getByTestId(`task-${task.id}`)).toHaveCount(0);
      await expect(page.getByText(tr[task.labelKey], { exact: true })).toHaveCount(0);
    }

    await expect(page.getByTestId('home-trust')).toHaveText('Videon cihazından çıkmaz. Hesap gerekmez.');
    await expect(page.getByTestId('home-editor-link')).toHaveText('Kendim düzenleyeceğim');
    await page.getByTestId('home-editor-link').click();
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByTestId('download-all')).toBeVisible();

    // And back: the editor's wordmark is the way to the opening screen.
    await page.getByTestId('home-link').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
  });

  for (const size of SIZES) {
    test(`${size.name}: every card is on the screen, big enough for a thumb, nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/');
      await noHorizontalOverflow(page);
      const cards = page.getByTestId('task-grid').getByRole('link');
      const boxes = await cards.evaluateAll((links) =>
        links.map((link) => {
          const rect = link.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
      );
      expect(boxes).toHaveLength(5);
      for (const rect of boxes) {
        expect(rect.width).toBeGreaterThanOrEqual(120);
        expect(rect.height).toBeGreaterThanOrEqual(120);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(size.width);
      }
      // Reading order = registry order: rows top to bottom, left to right.
      const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
      expect(boxes).toEqual(sorted);
      // Two columns on a phone; three on a desktop (five cards: 3 + 2, no card alone on a row).
      const columns = new Set(boxes.map((rect) => Math.round(rect.x))).size;
      expect(columns).toBe(size.width >= 700 ? 3 : 2);

      // Every other control is at least 44 px tall.
      for (const testId of ['home-editor-link', 'finder-input', 'finder-example']) {
        const height = await page.getByTestId(testId).first().evaluate((element) => element.getBoundingClientRect().height);
        expect(height, testId).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('the opening screen is light: no media engine in its scripts, no worker started, nothing from elsewhere', async ({
    page,
  }) => {
    // Doc 11: the first page must not carry the export engine (mediabunny);
    // it arrives with the editor or a wizard. Its MP4 box names survive minification.
    const scripts: string[] = [];
    const outside: string[] = [];
    const bodies: Array<Promise<void>> = [];
    page.on('response', (response) => {
      const url = response.url();
      if (new URL(url).origin !== new URL(page.url() === 'about:blank' ? url : page.url()).origin) outside.push(url);
      if (response.request().resourceType() !== 'script') return;
      bodies.push(
        response
          .text()
          .then((text) => {
            if (text.includes('"moov"') || text.includes('unsupported or unrecognizable format')) scripts.push(url);
          })
          .catch(() => undefined),
      );
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('finder-input').fill('tiktok için dikey');
    await expect(page.getByRole('option')).toHaveCount(1);
    await Promise.all(bodies);
    expect(bodies.length).toBeGreaterThan(2);
    expect(scripts, 'scripts carrying the media engine').toEqual([]);
    expect(outside).toEqual([]);
    // Only the service worker may exist; no export or analysis worker.
    expect(page.workers().map((worker) => worker.url())).toEqual([]);
  });

  test('a card opens its wizard at the first step', async ({ page }) => {
    for (const task of availableTasks()) {
      await page.goto('/');
      await page.getByTestId(`task-${task.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/yap/${task.id}$`));
      await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Videonu seç');
      await expect(page.getByTestId('wizard-step')).toContainText(`${tr[task.labelKey]} · Adım 1 /`);
      await expect(page.getByTestId('pick-video')).toBeEnabled();
    }
  });
});

test.describe('type to find', () => {
  test('typing replaces the cards with “Bunu mu demek istedin?”; clearing brings them back; nothing is sent', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const requests = watchRequests(page);

    await box(page).fill('tiktok için dikey');
    await expect(page.getByTestId('finder-results')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bunu mu demek istedin?' })).toBeVisible();
    await expect(results(page)).toHaveCount(1);
    await expect(page.getByTestId('result-dikey')).toContainText('Dikey yap');
    await expect(page.getByTestId('result-dikey').getByTestId('result-start')).toHaveText('Başla');
    await expect(page.getByTestId('task-grid')).toHaveCount(0);
    await expect(page.getByTestId('finder-example')).toHaveCount(0);
    await expect(page.getByTestId('finder-status')).toHaveText('1 sonuç. İlki: Dikey yap.');

    // The × clears and the cards are back; focus stays in the box.
    await page.getByTestId('finder-clear').click();
    await expect(box(page)).toHaveValue('');
    await expect(box(page)).toBeFocused();
    await expect(page.getByTestId('task-grid')).toBeVisible();
    await expect(page.getByTestId('finder-results')).toBeHidden();
    await expect(page.getByTestId('finder-status')).toHaveText('');

    // One letter, or only "video": nothing was said yet, the cards stay.
    await box(page).fill('v');
    await expect(page.getByTestId('task-grid')).toBeVisible();
    await box(page).fill('videom');
    await expect(page.getByTestId('task-grid')).toBeVisible();

    expect(requests).toEqual([]);
  });

  test('Enter starts the first result', async ({ page }) => {
    await page.goto('/');
    await box(page).click();
    await page.keyboard.type('sessiz yerleri sil');
    await expect(results(page).first()).toContainText('Boşlukları at');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/yap\/bosluk$/);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-task', 'bosluk');
  });

  test('keyboard: a real combobox — arrows move the highlighted result, Enter starts it, Escape clears', async ({ page }) => {
    await page.goto('/');
    const input = box(page);
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(await input.getAttribute('aria-activedescendant')).toBeNull();
    // The box has a name and its keys are described.
    await expect(page.getByRole('combobox', { name: 'Ne yapmak istediğini yaz' })).toBeVisible();
    await expect(page.locator(`#${await input.getAttribute('aria-describedby')}`)).toHaveText(tr['home.search.keys']);

    // Reached with Tab alone: wordmark is not a link here, so editor link, then the box.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('home-editor-link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();

    await page.keyboard.type('tiktok için kes');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const listId = await input.getAttribute('aria-controls');
    const listbox = page.locator(`#${listId}`);
    await expect(listbox).toHaveAttribute('role', 'listbox');
    await expect(listbox.getByRole('option')).toHaveCount(2);
    await expect(page.getByRole('listbox', { name: 'Bunu mu demek istedin?' })).toBeVisible();

    // The first result is highlighted; focus never leaves the box.
    await expect(input).toHaveAttribute('aria-activedescendant', 'finder-option-dikey');
    await expect(page.locator('#finder-option-dikey')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#finder-option-kes')).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'finder-option-kes');
    await expect(page.locator('#finder-option-kes')).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeFocused();
    // It wraps, both ways.
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'finder-option-dikey');
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveAttribute('aria-activedescendant', 'finder-option-kes');

    // Escape clears the box and brings the cards back.
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect(page.getByTestId('task-grid')).toBeVisible();

    // Enter starts the highlighted one, not always the first.
    await page.keyboard.type('tiktok için kes');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/yap\/kes$/);
  });

  test('touch: an example chip fills the box, a tap on a result starts it', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByTestId('finder-example').filter({ hasText: 'müzik koy' }).tap();
    await expect(box(page)).toHaveValue('müzik koy');
    await expect(results(page)).toHaveCount(1);
    const row = page.getByTestId('result-muzik');
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(64);
    await row.tap();
    await expect(page).toHaveURL(/\/yap\/muzik$/);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-task', 'muzik');
    await context.close();
  });

  test('every example chip leads to a task that works', async ({ page }) => {
    await page.goto('/');
    const chips = await page.getByTestId('finder-example').count();
    expect(chips).toBe(TASK_EXAMPLES.length);
    for (let index = 0; index < chips; index += 1) {
      await page.getByTestId('finder-example').nth(index).click();
      await expect(results(page).first().getByTestId('result-start')).toBeVisible();
      await expect(results(page).first()).not.toHaveAttribute('aria-disabled', 'true');
      await box(page).fill('');
    }
  });

  test('a task that is not built yet answers honestly: “Bu henüz yok”, no button, nothing starts', async ({ page }) => {
    await page.goto('/');
    const phrases: Array<[string, string]> = [
      ['videom whatsapp’a sığmıyor', 'kucult'],
      ['sesini mp3 yap', 'ses'],
      ['altyazı ekle', 'yazi'],
    ];
    for (const [phrase, id] of phrases) {
      await box(page).fill(phrase);
      const row = page.getByTestId(`result-${id}`);
      await expect(row).toBeVisible();
      await expect(results(page)).toHaveCount(1);
      await expect(row).toHaveAttribute('aria-disabled', 'true');
      await expect(row.getByTestId('result-unavailable')).toHaveText('Bu henüz yok, üzerinde çalışıyoruz.');
      await expect(row.getByTestId('result-start')).toHaveCount(0);
      await expect(page.getByText('Başla', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('finder-status')).toContainText('Bu henüz yok, üzerinde çalışıyoruz.');
      // Neither Enter nor a click goes anywhere.
      await box(page).press('Enter');
      // (forced: Playwright itself will not click an aria-disabled element.)
      await row.click({ force: true });
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
    }
    // And there is no page behind it.
    for (const id of ['kucult', 'ses', 'yazi']) {
      const response = await page.request.get(`/yap/${id}`);
      expect(response.status(), id).toBe(404);
    }
  });

  test('an unavailable task next to an available one: only the available one can start', async ({ page }) => {
    await page.goto('/');
    await box(page).fill('sesi kes');
    await expect(results(page)).toHaveCount(2);
    await expect(page.getByTestId('result-kes').getByTestId('result-start')).toBeVisible();
    await expect(page.getByTestId('result-ses').getByTestId('result-start')).toHaveCount(0);
    await expect(page.getByTestId('result-ses')).toContainText('Bu henüz yok, üzerinde çalışıyoruz.');
  });

  test('nothing found: “Bunu bulamadım” and “Tüm işleri gör” brings the cards back', async ({ page }) => {
    await page.goto('/');
    await box(page).fill('pizza siparişi');
    await expect(page.getByTestId('finder-none')).toContainText('Bunu bulamadım.');
    await expect(page.getByTestId('finder-none')).toContainText('Başka kelimelerle dene ya da bütün işlere bak.');
    await expect(page.getByTestId('finder-status')).toHaveText('Sonuç yok. Bunu bulamadım.');
    await expect(results(page)).toHaveCount(0);
    await expect(box(page)).toHaveAttribute('aria-expanded', 'false');
    // Enter has nothing to start.
    await box(page).press('Enter');
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('finder-show-all').click();
    await expect(box(page)).toHaveValue('');
    await expect(page.getByTestId('task-grid')).toBeVisible();
    await expect(page.getByTestId('finder-none')).toHaveCount(0);
    // Focus continues from the cards' heading, not from the top of the page.
    await expect(page.getByRole('heading', { name: 'Bütün işler' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('task-kes')).toBeFocused();
  });

  test('a typo and English both find the task', async ({ page }) => {
    await page.goto('/');
    await box(page).fill('sesiz yerleri sil');
    await expect(results(page).first()).toContainText('Boşlukları at');
    await box(page).fill('make it vertical');
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText('Dikey yap');
    await box(page).fill('iphone videosu açılmıyor');
    await expect(results(page).first()).toContainText('Her yerde açılsın');
  });
});
