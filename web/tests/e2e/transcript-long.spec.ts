import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { expectStylesApplied } from './stylesReady';
import { LONG_LINE_S, expectTestBuild, installTranscriptTest, longScript, longVideo, serveModels, testModels } from './transcriptKit';

/**
 * A LONG transcript in the "Yazı" panel (ADR-036, 7 Oct 2026): from 200 lines
 * on the list is drawn a window at a time. Everything the panel does must
 * work on a line that is not in the page — it is drawn first:
 * click-to-seek, the spoken line followed while the video plays, arrow keys /
 * Home / End / Enter, ticking a range for "Bunlardan kesit yap", correcting a
 * line in place, what a screen reader is told (size of the list, place of the
 * row), and finding a word (the panel's own search, because the browser's
 * find-in-page only sees the rows that are drawn).
 *
 * The recogniser is the scripted stand-in (transcriptKit.ts): 600 lines over
 * a 25-minute, all but empty video made with ffmpeg.
 */

const LINES = 600;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

const rows = (page: Page) => page.getByTestId('transcript-row');
const row = (page: Page, index: number) => page.locator(`[data-testid="transcript-row"][data-index="${index}"]`);
const list = (page: Page) => page.getByTestId('transcript-list');
/** Seconds at which line `index` (0-based) starts: the script's first word of that line. */
const lineStartS = (index: number) => 2 + index * LONG_LINE_S;

async function openLong(page: Page, context: BrowserContext, options: { editor?: boolean; lines?: number } = {}) {
  const models = testModels();
  await serveModels(context, models);
  await installTranscriptTest(page, models, longScript(options.lines ?? LINES));
  await page.goto('/yap/yazi');
  await page.getByTestId('video-input').setInputFiles(longVideo(25));
  await expectTestBuild(page);
  await page.getByTestId('model-download').click();
  await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('transcript-count')).toHaveText(`(${options.lines ?? LINES})`);
  if (options.editor) {
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('side-tab-yazi')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('side-tab-yazi').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible();
  }
}

/** Is row `index` drawn AND inside the list's own visible box? */
function inListView(page: Page, index: number): Promise<boolean> {
  return page.evaluate((wanted) => {
    const box = document.querySelector('[data-testid="transcript-list"]') as HTMLElement | null;
    const element = document.querySelector(`[data-testid="transcript-row"][data-index="${wanted}"]`) as HTMLElement | null;
    if (!box || !element) return false;
    const outer = box.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
  }, index);
}

const focusedRow = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return { index: element?.closest('[data-testid="transcript-row"]')?.getAttribute('data-index') ?? null, control: element?.getAttribute('data-row-control') ?? null };
  });

test.describe('Yazı panel: a long transcript', () => {
  test('only a window of the lines is in the page; the list still says its size and every row its place', async ({ page, context }) => {
    await openLong(page, context);
    await expect(page.getByTestId('transcript-panel')).toHaveAttribute('data-windowed', 'true');
    const drawn = await rows(page).count();
    expect(drawn).toBeGreaterThan(5);
    expect(drawn).toBeLessThan(80);

    // What a screen reader is told: a list (ul / li), 600 items, each row "n of 600".
    const semantics = async () =>
      page.evaluate(() => {
        const box = document.querySelector('[data-testid="transcript-list"]') as HTMLElement;
        const items = Array.from(box.children) as HTMLElement[];
        return {
          tag: box.tagName,
          labelled: box.getAttribute('aria-labelledby'),
          onlyItems: items.every((item) => item.tagName === 'LI'),
          sizes: [...new Set(items.map((item) => item.getAttribute('aria-setsize')))],
          placesMatch: items.every((item) => Number(item.getAttribute('aria-posinset')) === Number(item.getAttribute('data-index')) + 1),
          inOrder: items.every((item, k) => k === 0 || Number(item.getAttribute('data-index')) > Number(items[k - 1]!.getAttribute('data-index'))),
          first: Number(items[0]!.getAttribute('aria-posinset')),
        };
      });
    expect(await semantics()).toEqual({ tag: 'UL', labelled: 'yazi-transcript-title', onlyItems: true, sizes: [String(LINES)], placesMatch: true, inOrder: true, first: 1 });
    // The browser's accessibility tree: a named list whose items are exactly the drawn rows (the pinned one included).
    // (Chrome's protocol does not print posinset/setsize; they are checked as attributes above.)
    const cdp = await context.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: { role?: { value?: string }; name?: { value?: string }; properties?: { name: string; value: { value?: unknown } }[] }[];
    };
    const items = nodes.filter((node) => node.role?.value === 'listitem');
    expect(items.length).toBe(drawn);
    expect(nodes.some((node) => node.role?.value === 'list' && node.name?.value?.startsWith('Yazı'))).toBe(true);

    // The scroll bar is that of the whole list: far taller than what is drawn.
    const heights = await list(page).evaluate((box) => ({ scroll: box.scrollHeight, client: box.clientHeight }));
    expect(heights.scroll).toBeGreaterThan(LINES * 40);

    // Half-way down: other rows, the same few, the right places.
    await list(page).evaluate((box) => {
      box.scrollTop = box.scrollHeight / 2;
    });
    await expect.poll(async () => Number(await rows(page).nth(3).getAttribute('data-index'))).toBeGreaterThan(200);
    expect(await rows(page).count()).toBeLessThan(80);
    const middle = await semantics();
    expect(middle.placesMatch && middle.inOrder && middle.onlyItems).toBe(true);
    expect(middle.sizes).toEqual([String(LINES)]);
    // The row that holds the Tab stop (the first line) is still in the page, though far away.
    expect(middle.first).toBe(1);
    // To the very end: the last line is line 600 and nothing is left under it.
    await list(page).evaluate((box) => {
      box.scrollTop = box.scrollHeight;
    });
    await expect(row(page, LINES - 1)).toBeVisible();
    await expect(row(page, LINES - 1)).toHaveAttribute('aria-posinset', String(LINES));
    await expect(row(page, LINES - 1).locator('.transcript-text')).toContainText(`Line ${LINES},`);
    expect(await inListView(page, LINES - 1)).toBe(true);
  });

  test('a line far down is followed while the video plays there, and a click on a line sends the video to it', async ({ page, context }) => {
    await openLong(page, context);
    const target = 412;
    await page.getByTestId('wizard-video').evaluate((video: HTMLVideoElement, at) => {
      video.currentTime = at;
    }, lineStartS(target) + 0.4);
    // The list scrolled to the spoken line by itself (it was not drawn before), the page did not move.
    await expect(row(page, target)).toHaveAttribute('data-active', 'true', { timeout: 20_000 });
    await expect.poll(() => inListView(page, target)).toBe(true);
    await expect(row(page, target).getByTestId('transcript-line')).toHaveAttribute('aria-current', 'true');
    expect(await page.locator('[data-testid="transcript-line"][aria-current="true"]').count()).toBe(1);
    // Focus was not taken.
    expect((await focusedRow(page)).index).toBeNull();

    // Scrolling by hand stops the following; "Şimdiye dön" brings the spoken line back.
    await list(page).hover();
    await page.mouse.wheel(0, -4000);
    await expect(page.getByTestId('transcript-follow')).toBeVisible();
    await expect.poll(() => inListView(page, target)).toBe(false);
    await page.getByTestId('transcript-follow').click();
    await expect.poll(() => inListView(page, target)).toBe(true);

    // Click another line: the video goes to that line's start.
    const other = target + 4;
    await row(page, other).getByTestId('transcript-line').click();
    await expect
      .poll(() => page.getByTestId('wizard-video').evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeCloseTo(lineStartS(other), 0);
    await expect(row(page, other)).toHaveAttribute('data-active', 'true');
  });

  test('keyboard only: arrows, End and Home reach lines that were not drawn; focus is never lost when the list scrolls away', async ({ page, context }) => {
    await openLong(page, context);
    await row(page, 0).getByTestId('transcript-line').focus();
    for (let k = 0; k < 3; k += 1) await page.keyboard.press('ArrowDown');
    expect(await focusedRow(page)).toEqual({ index: '3', control: 'line' });

    // End: the last line (not in the page until now) gets the focus and is in view.
    await page.keyboard.press('End');
    await expect.poll(() => focusedRow(page)).toEqual({ index: String(LINES - 1), control: 'line' });
    await expect.poll(() => inListView(page, LINES - 1)).toBe(true);
    await page.keyboard.press('ArrowUp');
    expect(await focusedRow(page)).toEqual({ index: String(LINES - 2), control: 'line' });
    // Enter on a line: the video goes there.
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.getByTestId('wizard-video').evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeCloseTo(lineStartS(LINES - 2), 0);

    // Home: back to the first.
    await page.keyboard.press('Home');
    await expect.poll(() => focusedRow(page)).toEqual({ index: '0', control: 'line' });
    await expect.poll(() => inListView(page, 0)).toBe(true);

    // The pencil of a line keeps its column while walking (the same control of the next line).
    await page.keyboard.press('Tab');
    expect(await focusedRow(page)).toEqual({ index: '0', control: 'edit' });
    await page.keyboard.press('ArrowDown');
    expect(await focusedRow(page)).toEqual({ index: '1', control: 'edit' });

    // The list is scrolled far away (a mouse wheel, a touch): the focused row stays in the page, focus is not lost…
    await list(page).evaluate((box) => {
      box.scrollTop = box.scrollHeight;
    });
    await expect(row(page, LINES - 1)).toBeVisible();
    expect(await focusedRow(page)).toEqual({ index: '1', control: 'edit' });
    // …and the next arrow key continues from where the reader was.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedRow(page)).toEqual({ index: '2', control: 'edit' });
    await expect.poll(() => inListView(page, 2)).toBe(true);
    // One Tab stop per column, as in a short list: the list holds exactly the line and its pencil.
    expect(await page.locator('[data-testid="transcript-list"] [tabindex="0"]').count()).toBe(2);
  });

  test('a line far down is corrected in place: Enter saves, focus returns to the line, Esc leaves it as it was', async ({ page, context }) => {
    await openLong(page, context);
    await page.getByTestId('transcript-search-input').fill('Line 500,');
    await page.keyboard.press('Enter');
    await expect(row(page, 499)).toBeVisible();
    await row(page, 499).getByTestId('transcript-edit').click();
    await expect(page.getByTestId('transcript-field')).toBeFocused();
    // While it is being edited the list is scrolled away: the field stays in the page with what was typed.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Corrected far down.');
    await list(page).evaluate((box) => {
      box.scrollTop = 0;
    });
    await expect(row(page, 0)).toBeVisible();
    await expect(page.getByTestId('transcript-field')).toHaveValue('Corrected far down.');
    await expect(page.getByTestId('transcript-field')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(row(page, 499).locator('.transcript-text')).toHaveText('Corrected far down.');
    await expect.poll(() => focusedRow(page)).toEqual({ index: '499', control: 'line' });
    await expect(page.getByTestId('transcript-count')).toHaveText(`(${LINES})`);

    await row(page, 499).getByTestId('transcript-edit').click();
    await page.keyboard.type('thrown away');
    await page.keyboard.press('Escape');
    await expect(row(page, 499).locator('.transcript-text')).toHaveText('Corrected far down.');
    await expect.poll(() => focusedRow(page)).toEqual({ index: '499', control: 'edit' });
  });

  test('"Yazıda ara" finds lines that are not drawn, steps through the results and says where it is', async ({ page, context }) => {
    await openLong(page, context);
    // Said honestly: the browser's own find only sees what is drawn.
    await expect(page.getByTestId('transcript-search-hint')).toContainText('Ctrl+F');
    const input = page.getByTestId('transcript-search-input');
    const status = page.getByTestId('transcript-search-status');
    await expect(page.getByRole('search', { name: 'Yazıda ara' })).toBeVisible();

    // The browser's find could not see line 437 (it is not in the page); the panel's search does.
    expect(await row(page, 436).count()).toBe(0);
    await input.fill('line 437,');
    await expect(status).toHaveText('1 satırda bulundu. Enter ile ilkine git.');
    await page.keyboard.press('Enter');
    await expect(row(page, 436)).toHaveAttribute('data-found', 'true');
    await expect.poll(() => inListView(page, 436)).toBe(true);
    await expect(status).toContainText('1 / 1 — ');
    await expect(status).toContainText('Line 437,');
    // Focus stays in the box (the reader keeps typing); the found line is the list's Tab stop.
    await expect(input).toBeFocused();
    await expect(row(page, 436).getByTestId('transcript-line')).toHaveAttribute('tabindex', '0');

    // Several results: Enter / the arrows walk them and wrap round; every match is marked.
    await input.fill('LINE 59');
    await expect(status).toHaveText('11 satırda bulundu. Enter ile ilkine git.'); // 59, 590 … 599
    await page.keyboard.press('Enter');
    await expect(row(page, 58)).toHaveAttribute('data-found', 'true');
    await expect(status).toContainText('1 / 11 — ');
    await page.getByTestId('transcript-search-next').click();
    await expect(row(page, 589)).toHaveAttribute('data-found', 'true');
    await expect(row(page, 590)).toHaveAttribute('data-match', 'true');
    await expect(row(page, 590)).not.toHaveAttribute('data-found', 'true');
    await page.getByTestId('transcript-search-previous').click();
    await expect(row(page, 58)).toHaveAttribute('data-found', 'true');
    await page.getByTestId('transcript-search-previous').click();
    await expect(row(page, 598)).toHaveAttribute('data-found', 'true');
    await expect(status).toContainText('11 / 11 — ');
    await input.focus();
    await page.keyboard.press('Shift+Enter');
    await expect(row(page, 597)).toHaveAttribute('data-found', 'true');

    // The places that could not be written can be walked the same way.
    await input.fill('anlaşılamadı');
    await expect(status).toHaveText('15 satırda bulundu. Enter ile ilkine git.');
    await page.keyboard.press('Enter');
    await expect(row(page, 17)).toHaveAttribute('data-found', 'true');
    await expect(row(page, 17)).toHaveAttribute('data-kind', 'unclear');

    await input.fill('zebra');
    await expect(status).toHaveText('Bulunamadı.');
    await expect(page.getByTestId('transcript-search-next')).toBeDisabled();
    await input.fill('');
    await expect(status).toHaveText('');
    expect(await page.locator('[data-testid="transcript-row"][data-match]').count()).toBe(0);
  });

  test('editor: a range ticked across hundreds of lines becomes kesitler, in one undo step', async ({ page, context }) => {
    await openLong(page, context, { editor: true });
    await expect(page.getByTestId('side-tab-yazi')).toHaveText(`Yazı (${LINES})`);
    await expect(page.getByTestId('transcript-panel')).toHaveAttribute('data-windowed', 'true');
    await expect(row(page, 0).getByTestId('transcript-check')).toHaveAttribute('aria-label', /^Seç: 0:02 Line 1,/);

    // Tick line 3, go far down with the search, Shift+click line 351: the 349 lines between are ticked, drawn or not.
    await row(page, 2).getByTestId('transcript-check').click();
    await expect(page.getByTestId('transcript-selected-count')).toHaveText('1 satır seçili');
    await page.getByTestId('transcript-search-input').fill('Line 351,');
    await page.keyboard.press('Enter');
    await expect(row(page, 350)).toBeVisible();
    await row(page, 350).getByTestId('transcript-check').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('transcript-selected-count')).toHaveText('349 satır seçili');
    await expect(row(page, 349)).toHaveAttribute('data-selected', 'true');
    // A line in the middle, drawn only now, shows its tick.
    await list(page).evaluate((box) => {
      box.scrollTop = box.scrollHeight / 4;
    });
    await expect.poll(async () => Number(await rows(page).nth(3).getAttribute('data-index'))).toBeGreaterThan(100);
    const middleIndex = Number(await rows(page).nth(5).getAttribute('data-index'));
    await expect(row(page, middleIndex).getByTestId('transcript-check')).toBeChecked();

    // Neighbouring lines are one kesit: the whole range is a single one.
    await page.getByTestId('transcript-make-kesit').click();
    await expect(page.getByTestId('transcript-status')).toHaveText('1 kesit eklendi. Geri al ile vazgeçebilirsin.');
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (1)');
    await expect(page.getByTestId('transcript-selected-count')).toHaveText('Kesit yapmak için satırları işaretle.');
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (0)');

    // The keyboard does the same: Space ticks, Shift+arrow extends.
    await page.getByTestId('transcript-search-input').fill('Line 5,');
    await page.keyboard.press('Enter');
    await row(page, 4).getByTestId('transcript-check').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('transcript-selected-count')).toHaveText('3 satır seçili');
    expect(await focusedRow(page)).toEqual({ index: '6', control: 'check' });
  });

  for (const size of [
    { name: 'phone-360', width: 360, height: 780 },
    { name: 'phone-390', width: 390, height: 844 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    test(`${size.name}: the windowed panel and its search — no axe finding, nothing scrolls sideways (wizard and editor)`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openLong(page, context);
      const audit = async (state: string) => {
        await expectStylesApplied(page, state, testInfo);
        const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        const findings = result.violations.map((violation) => ({ rule: violation.id, nodes: violation.nodes.length, targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')) }));
        if (findings.length > 0) await testInfo.attach(`axe-${state}`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
        expect.soft(findings, `axe violations in state "${state}"`).toEqual([]);
      };
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await audit(`${size.name}-long-result`);
      expect(await sideways(), 'wizard result').toBe(0);
      // A search in progress, on a result far down.
      await page.getByTestId('transcript-search-input').fill('Line 300,');
      await page.keyboard.press('Enter');
      await expect(row(page, 299)).toHaveAttribute('data-found', 'true');
      await audit(`${size.name}-long-search`);
      expect(await sideways(), 'search').toBe(0);
      // A line being corrected.
      await row(page, 299).getByTestId('transcript-edit').click();
      await expect(page.getByTestId('transcript-field')).toBeFocused();
      await audit(`${size.name}-long-edit`);
      await page.keyboard.press('Escape');

      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('side-tab-yazi')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('side-tab-yazi').click();
      await expect(page.getByTestId('transcript-panel')).toBeVisible();
      await page.getByTestId('transcript-search-input').fill('Line 450,');
      await page.keyboard.press('Enter');
      await expect(row(page, 449)).toHaveAttribute('data-found', 'true');
      await row(page, 449).getByTestId('transcript-check').click();
      await audit(`${size.name}-long-editor`);
      expect(await sideways(), 'editor').toBe(0);
    });
  }

  test('320 px wide: the long panel and its search reflow, nothing scrolls sideways', async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openLong(page, context);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await sideways(), 'wizard result').toBe(0);
    await page.getByTestId('transcript-search-input').fill('Line 59');
    await page.keyboard.press('Enter');
    await expect(row(page, 58)).toHaveAttribute('data-found', 'true');
    expect(await sideways(), 'search').toBe(0);
    // Every control of the search is inside the panel's box.
    const cut = await page.evaluate(() => {
      const panel = (document.querySelector('[data-testid="transcript-panel"]') as HTMLElement).getBoundingClientRect();
      return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="transcript-search"] *'))
        .filter((element) => !element.closest('.visually-hidden'))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.left < panel.left - 1 || box.right > panel.right + 1);
        }).length;
    });
    expect(cut).toBe(0);
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('side-tab-yazi')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('side-tab-yazi').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible();
    expect(await sideways(), 'editor').toBe(0);
  });

  test('a short transcript is drawn whole (the browser\'s own find sees every line); the search box comes with 12 lines', async ({ page, context }) => {
    await openLong(page, context, { lines: 150 });
    await expect(page.getByTestId('transcript-panel')).not.toHaveAttribute('data-windowed', 'true');
    expect(await rows(page).count()).toBe(150);
    // Every row still says its place, and the search is there without the "Ctrl+F" caveat.
    await expect(row(page, 149)).toHaveAttribute('aria-posinset', '150');
    await expect(row(page, 149)).toHaveAttribute('aria-setsize', '150');
    await expect(page.getByTestId('transcript-search-input')).toBeVisible();
    await expect(page.getByTestId('transcript-search-hint')).toHaveCount(0);
    await page.getByTestId('transcript-search-input').fill('Line 140,');
    await page.keyboard.press('Enter');
    await expect(row(page, 139)).toHaveAttribute('data-found', 'true');
    await expect.poll(() => inListView(page, 139)).toBe(true);
  });
});
