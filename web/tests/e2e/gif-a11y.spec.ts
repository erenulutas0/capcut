import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

import { expect, test, type Page, type TestInfo } from './fixtures';
import { installSavePicker } from './kesitFlow';
import { expectStylesApplied } from './stylesReady';

/**
 * "GIF yap" (ADR-046) for everyone: axe on each state of its screen, names
 * a screen reader hears for the two text boxes and the three sliders, every
 * target at least 44 px, every word read on a phone at least 14 px, nothing
 * scrolling sideways down to 320 px.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

test.describe.configure({ timeout: 180_000 });

async function audit(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  await expectStylesApplied(page, state, testInfo);
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const findings = result.violations.map((violation) => ({
    rule: violation.id,
    nodes: violation.nodes.slice(0, 6).map((node) => node.target.join(' ')),
  }));
  if (findings.length > 0) console.log(`A11Y ${JSON.stringify({ state, findings })}`);
  expect.soft(findings, `axe violations in state "${state}"`).toEqual([]);
}

/** Every control a finger may need, smaller than 44 × 44 px. */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('main button, main a, main input, main textarea, main [role="slider"], main summary'))) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // A radio inside its label: the label is the target.
      const target = element.matches('input[type="radio"]') ? (element.closest('label') ?? element) : element;
      const box = target.getBoundingClientRect();
      if (box.width < 44 || box.height < 44) out.push(`${element.getAttribute('data-testid') ?? element.tagName} ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return out;
  });
}

/** Visible text set under 14 px on the page (the picture's own letters are part of the picture, not text to read). */
function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('.visually-hidden, [aria-hidden="true"], script, style')) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Inside a closed "Ayrıntılar": not on the screen until it is opened.
      if (!parent.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true } as CheckVisibilityOptions)) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 14) out.push(`${size}px “${text.slice(0, 40)}”`);
    }
    return out;
  });
}

function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const size of [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
]) {
  test(`${size.name}: the GIF screen — no axe finding, named boxes and sliders, 44 px targets, readable text`, async ({ page }, testInfo) => {
    await installSavePicker(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/yap/gif/');
    await audit(page, `${size.name}-gif-pick`, testInfo);
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });

    // What a screen reader hears.
    await expect(page.getByRole('textbox', { name: 'Üst yazı' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Alt yazı' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'GIF olacak kısım' })).toHaveAttribute('aria-valuetext', '0:00 ile 0:04 arası');
    await expect(page.getByRole('slider', { name: 'Kısmın başı' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Kısmın sonu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Önizlemeyi durdur' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Boyut' }).or(page.getByRole('group', { name: 'Boyut' }))).toBeVisible();
    await expect(page.getByTestId('gif-estimate')).toHaveAttribute('role', 'status');
    await audit(page, `${size.name}-gif-empty`, testInfo);

    await page.getByRole('textbox', { name: 'Üst yazı' }).fill('PAZARTESİ SABAHI');
    await page.getByRole('textbox', { name: 'Alt yazı' }).fill('kahveden önce ben');
    await page.getByTestId('gif-range-end').focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('gif-max-length')).toBeVisible();
    await audit(page, `${size.name}-gif-texts-capped`, testInfo);
    expect(await smallTargets(page), 'targets under 44 px').toEqual([]);
    if (size.width < 700) expect(await smallText(page), 'text under 14 px on a phone').toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);

    await page.getByTestId('gif-range-end').focus();
    await page.keyboard.press('Home');
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('wizard-title')).toBeFocused();
    await audit(page, `${size.name}-gif-saved`, testInfo);
    expect(await smallTargets(page), 'targets under 44 px (saved)').toEqual([]);
    if (size.width < 700) expect(await smallText(page), 'text under 14 px on a phone (saved)').toEqual([]);
  });
}

test('reflow at 320 px: the GIF screen never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/yap/gif/');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.getByRole('textbox', { name: 'Alt yazı' }).fill('çok uzun bir alt yazı ki iki satıra insin');
  expect(await horizontalOverflow(page)).toBe(0);
});
