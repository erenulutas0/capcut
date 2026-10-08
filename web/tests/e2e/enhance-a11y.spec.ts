import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { enhanceFixture } from './enhance-media';
import { installSavePicker, openSettings } from './kesitFlow';
import { expectStylesApplied } from './stylesReady';

/**
 * Accessibility of "İyileştir" (ADR-037): the card, the wizard's steps with
 * the before/after picture, the result, and the setting in the editor.
 *
 * The same checks as a11y.spec.ts — axe on every state at 360 / 390 / 1440 px,
 * nothing scrolls sideways (also at 320 px), the WCAG 1.4.12 text spacing,
 * reduced motion, a mouse-free walk with a visible focus indicator at every
 * stop — on the screens this feature added.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function audit(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  // An audit of a page whose stylesheet has not arrived says nothing (stylesReady.ts).
  await expectStylesApplied(page, state, testInfo);
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const findings = result.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 6).map((node) => node.target.join(' ')),
  }));
  if (findings.length > 0) {
    console.log(`A11Y ${JSON.stringify({ state, findings })}`);
    await testInfo.attach(`axe-${state}`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  }
  expect.soft(findings, `axe violations in state "${state}"`).toEqual([]);
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The WCAG 1.4.12 test values, applied as a constructed stylesheet (the page's CSP blocks an injected <style>). */
async function applyTextSpacing(page: Page) {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

/** Controls that hide overflow and whose text no longer fits. */
function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = ['button', 'a[href]', 'label', 'legend', 'select', '.ba-tag', '.wizard-note', '.wizard-option-hint', '.dl-sub'].join(',');
    const clipped: string[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (node.closest('[data-truncates]') || node.closest('.visually-hidden')) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(node);
      const hides = (value: string) => value === 'hidden' || value === 'clip';
      const overX = hides(style.overflowX) && node.scrollWidth - node.clientWidth > 1;
      const overY = hides(style.overflowY) && node.scrollHeight - node.clientHeight > 1;
      if (overX || overY) clipped.push(`${node.tagName.toLowerCase()}.${node.className} "${node.textContent?.trim().slice(0, 30)}"`);
    }
    return clipped;
  });
}

interface FocusStop {
  testId: string | null;
  name: string;
  indicator: boolean;
}

function focusStop(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { testId: null, name: 'body', indicator: false };
    const style = getComputedStyle(element);
    let outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
    // The before/after line is an invisible range input; its focus ring is drawn on the handle next to it.
    if (element.classList.contains('ba-range')) {
      const handle = element.parentElement?.querySelector<HTMLElement>('.ba-handle');
      const handleStyle = handle ? getComputedStyle(handle) : null;
      outline = handleStyle !== null && handleStyle.outlineStyle !== 'none' && parseFloat(handleStyle.outlineWidth) >= 2;
    }
    // A radio inside a big option: the whole option is outlined.
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const option = element.closest<HTMLElement>('.wizard-option');
      const optionStyle = option ? getComputedStyle(option) : null;
      outline = outline || (optionStyle !== null && optionStyle.outlineStyle !== 'none' && parseFloat(optionStyle.outlineWidth) > 0);
    }
    return {
      testId: element.getAttribute('data-testid'),
      name: `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}"`,
      indicator: outline || shadow,
    };
  });
}

/** Presses Tab until the focused element has `testId`, recording every stop without a visible indicator. */
async function tabTo(page: Page, testId: string, unmarked: string[], maxPresses = 60): Promise<void> {
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    const stop = await focusStop(page);
    if (stop.name !== 'body' && !stop.indicator) unmarked.push(stop.name);
    if (stop.testId === testId) return;
  }
  throw new Error(`Tab never reached ${testId}`);
}

async function toChoice(page: Page, file: string) {
  await page.goto('/yap/iyilestir');
  await expect(page.getByTestId('pick-video')).toBeEnabled();
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
}

test.describe('a11y: İyileştir (ADR-037)', () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(async ({ page }) => {
    await installSavePicker(page);
  });

  for (const size of [
    { name: 'phone-360', width: 360, height: 780 },
    { name: 'phone-390', width: 390, height: 844 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    test(`${size.name}: the card, the wizard's steps, the result and the editor's setting — no axe finding, nothing scrolls sideways`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });

      // The card on the opening screen, and the search result with its honest line.
      await page.goto('/');
      await expect(page.getByTestId('task-iyilestir')).toBeVisible();
      await audit(page, `${size.name}-home-with-card`, testInfo);
      expect(await horizontalOverflow(page), 'home').toBe(0);
      await page.getByTestId('finder-input').fill('4K yap');
      await expect(page.getByTestId('result-iyilestir')).toContainText('Çok bulanık bir videoyu netleştiremez');
      await audit(page, `${size.name}-home-result`, testInfo);
      expect(await horizontalOverflow(page), 'home result').toBe(0);

      await page.goto('/yap/iyilestir');
      await expect(page.getByTestId('pick-video')).toBeEnabled();
      await audit(page, `${size.name}-iyilestir-pick`, testInfo);

      // The before/after with its three strengths.
      await page.getByTestId('video-input').setInputFiles(enhanceFixture('dark'));
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
      await audit(page, `${size.name}-iyilestir-choice`, testInfo);
      expect(await horizontalOverflow(page), 'choice').toBe(0);
      // The picture fits the screen: never wider than the page, and both labels are on it.
      const frame = await page.getByTestId('enhance-frame').boundingBox();
      expect(frame?.width ?? 0).toBeLessThanOrEqual(size.width);
      expect(frame?.width ?? 0).toBeGreaterThan(size.width >= 1000 ? 500 : size.width - 60);

      await page.getByTestId('option-strong').check();
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
      await audit(page, `${size.name}-iyilestir-strong`, testInfo);

      // Saved.
      await page.getByTestId('wizard-download').click();
      await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
      await audit(page, `${size.name}-iyilestir-saved`, testInfo);
      expect(await horizontalOverflow(page), 'saved').toBe(0);

      // The editor over the same recipe: Ayarlar → Görüntü with the setting on and its picture.
      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await openSettings(page, 'frame');
      await expect(page.getByTestId('enhance-strength')).toHaveValue('strong');
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
      await page.getByTestId('enhance-setting').scrollIntoViewIfNeeded();
      await audit(page, `${size.name}-editor-enhance-setting`, testInfo);
      expect(await horizontalOverflow(page), 'editor setting').toBe(0);
    });
  }

  test('the states that say no: nothing to change, and the setting switched off', async ({ page }, testInfo) => {
    await toChoice(page, SAMPLE);
    await expect(page.getByTestId('wizard-blocked')).toBeVisible();
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    // The disabled button says why, for a screen reader too.
    await expect(page.getByTestId('wizard-download')).toHaveAttribute('aria-describedby', 'wizard-blocked');
    await expect(page.getByTestId('iyilestir-summary')).toHaveAttribute('role', 'status');
    await audit(page, 'iyilestir-nothing', testInfo);

    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await openSettings(page, 'frame');
    await page.getByTestId('enhance-strength').selectOption('off');
    await expect(page.getByTestId('enhance-preview')).toHaveCount(0);
    await audit(page, 'editor-enhance-off', testInfo);
  });

  for (const width of [320, 640]) {
    test(`reflow at ${width} px: the wizard, the picture and the result never scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await toChoice(page, enhanceFixture('dark'));
      expect(await horizontalOverflow(page), 'choice').toBe(0);
      const frame = await page.getByTestId('enhance-frame').boundingBox();
      expect((frame?.x ?? 0) + (frame?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.getByTestId('wizard-download').click();
      await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
      expect(await horizontalOverflow(page), 'saved').toBe(0);
      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await openSettings(page, 'frame');
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
      expect(await horizontalOverflow(page), 'editor setting').toBe(0);
    });
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`text spacing: no control clips its text at ${viewport.width} px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await toChoice(page, enhanceFixture('dark'));
      await applyTextSpacing(page);
      expect(await clippedControls(page), 'choice').toEqual([]);
      expect(await horizontalOverflow(page), 'choice').toBe(0);
      await page.getByTestId('wizard-download').click();
      await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
      expect(await clippedControls(page), 'saved').toEqual([]);
      expect(await horizontalOverflow(page), 'saved').toBe(0);
      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await openSettings(page, 'frame');
      await applyTextSpacing(page);
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
      expect(await clippedControls(page), 'editor setting').toEqual([]);
    });
  }

  test('keyboard only: move the line, choose a strength, download — focus visible at every stop', async ({ page }) => {
    const unmarked: string[] = [];
    await toChoice(page, enhanceFixture('dark'));
    // The step's heading has focus: a screen reader hears where it is.
    await expect(page.getByTestId('wizard-title')).toBeFocused();

    // The line between before and after is the first stop inside the picture.
    await tabTo(page, 'enhance-slider', unmarked);
    await expect(page.getByTestId('enhance-slider')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('enhance-slider')).toHaveValue('48');
    await page.keyboard.press('End');
    await expect(page.getByTestId('enhance-slider')).toHaveValue('100');

    await tabTo(page, 'enhance-other-frame', unmarked);
    const firstFrame = await page.getByTestId('enhance-preview').getAttribute('data-frame');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('enhance-preview')).not.toHaveAttribute('data-frame', firstFrame ?? '');
    await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });

    // The radio group is one stop; arrows move inside it.
    await tabTo(page, 'option-auto', unmarked);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('option-light')).toBeChecked();
    expect((await focusStop(page)).indicator, 'the chosen option shows its focus').toBe(true);
    await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });

    await tabTo(page, 'wizard-download', unmarked);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-strength', 'light');
    // The result's heading takes focus when the step changes.
    await expect(page.getByTestId('wizard-title')).toBeFocused();
    expect(unmarked, 'stops without a visible focus indicator').toEqual([]);
  });

  test('reduced motion: nothing on the wizard animates, and the picture has names for what a screen reader cannot see', async ({
    page,
  }) => {
    await toChoice(page, enhanceFixture('dark'));
    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.wizard *'))
        .filter((node) => {
          const style = getComputedStyle(node);
          const animated = style.animationName !== 'none' && parseFloat(style.animationDuration) > 0.01;
          const transitions = parseFloat(style.transitionDuration) > 0.01;
          return animated || transitions;
        })
        .map((node) => node.className),
    );
    expect(moving).toEqual([]);

    // Names: the group, the slider (with what its value means), and the two canvases stay out of the tree.
    await expect(page.getByRole('group', { name: 'Öncesi ve sonrası' })).toBeVisible();
    const range = page.getByRole('slider', { name: 'Öncesi ile sonrası arasındaki çizgi' });
    await expect(range).toHaveAttribute('aria-valuetext', 'Resmin yüzde 50 kadarı önceki hâli');
    await expect(range).toHaveAccessibleDescription(/Çizgiyi sürükle ya da ok tuşlarıyla kaydır/);
    await expect(page.getByTestId('enhance-before')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('enhance-after')).toHaveAttribute('aria-hidden', 'true');
    // What will be done is said in words, not only shown.
    await expect(page.getByTestId('iyilestir-summary')).toContainText('Yapılacaklar:');
    // The three strengths are a labelled radio group.
    await expect(page.getByRole('group', { name: 'Ne kadar?' }).getByRole('radio')).toHaveCount(3);
  });
});
