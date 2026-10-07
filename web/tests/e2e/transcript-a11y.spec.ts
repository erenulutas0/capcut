import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installSavePicker } from './kesitFlow';
import { expectStylesApplied } from './stylesReady';
import { STUB_LINES, STUB_SCRIPT, installTranscriptTest, lineTexts, panelLines, serveModels, testModels } from './transcriptKit';

/**
 * Accessibility of "Yazıya dök" (ADR-036): the wizard's steps, the result
 * screen and the transcript panel (wizard and editor).
 *
 * The same checks as a11y.spec.ts — axe on every state at 360 / 390 / 1440 px,
 * nothing scrolls sideways (also at 320 px), the WCAG 1.4.12 text spacing,
 * reduced motion, a mouse-free walk with a visible focus indicator at every
 * stop — on the screens this feature added. The recogniser is the scripted
 * stand-in (transcriptKit.ts): what is audited is the interface.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function audit(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  // An audit stands on the page's stylesheets: a sheet that never arrived is a broken page, not a contrast finding.
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
    const selector = ['button', 'a[href]', '[role="tab"]', 'label', 'legend', '.transcript-time', '.transcript-text', '.transcript-note', '.wizard-note'].join(',');
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
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
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

async function toResult(page: Page) {
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
}

test.describe('a11y: Yazıya dök (ADR-036)', () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
  test.describe.configure({ timeout: 300_000 });

  for (const size of [
    { name: 'phone-360', width: 360, height: 780 },
    { name: 'phone-390', width: 390, height: 844 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    test(`${size.name}: the wizard's steps, the result and the editor's Yazı tab — no axe finding, nothing scrolls sideways`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const models = testModels();
      await serveModels(context, models);
      // Slow enough that the running state can be audited.
      await installTranscriptTest(page, models, { ...STUB_SCRIPT, stepMs: 700 });
      await installSavePicker(page);

      await page.goto('/yap/yazi');
      await expect(page.getByTestId('pick-video')).toBeEnabled();
      await audit(page, `${size.name}-yazi-pick`, testInfo);
      await page.getByTestId('video-input').setInputFiles(SAMPLE);
      await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });
      await audit(page, `${size.name}-yazi-model`, testInfo);
      expect(await horizontalOverflow(page), 'model step').toBe(0);

      await page.getByTestId('model-download').click();
      await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
      await audit(page, `${size.name}-yazi-ready`, testInfo);

      await page.getByTestId('transcribe-start').click();
      await expect(page.getByTestId('transcribe-phase')).toContainText('Yazılıyor', { timeout: 30_000 });
      await audit(page, `${size.name}-yazi-running`, testInfo);
      expect(await horizontalOverflow(page), 'running').toBe(0);

      await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
      expect(await lineTexts(page)).toEqual(STUB_LINES);
      await audit(page, `${size.name}-yazi-result`, testInfo);
      expect(await horizontalOverflow(page), 'result').toBe(0);

      // A line being corrected, with a refusal showing.
      await panelLines(page).first().getByTestId('transcript-edit').click();
      await page.getByTestId('transcript-field').fill('');
      await page.getByTestId('transcript-save').click();
      await expect(page.getByTestId('transcript-edit-error')).toBeVisible();
      await audit(page, `${size.name}-yazi-editing`, testInfo);
      expect(await horizontalOverflow(page), 'editing').toBe(0);
      await page.getByTestId('transcript-cancel').click();

      // The editor over the same recipe: the Yazı tab with a selection.
      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('side-tab-yazi')).toHaveAttribute('aria-selected', 'true');
      await panelLines(page).nth(2).getByTestId('transcript-check').click();
      await audit(page, `${size.name}-editor-yazi-tab`, testInfo);
      expect(await horizontalOverflow(page), 'editor yazı tab').toBe(0);
      await page.getByTestId('transcript-make-kesit').click();
      await expect(page.getByTestId('transcript-status')).toContainText('1 kesit eklendi');
      await audit(page, `${size.name}-editor-yazi-kesit-added`, testInfo);
      await page.getByTestId('side-tab-kesit').click();
      await audit(page, `${size.name}-editor-kesit-tab`, testInfo);
      expect(await horizontalOverflow(page), 'editor kesit tab').toBe(0);

      // The editor's own dialog (the model is already here).
      await page.getByTestId('open-more').click();
      await page.getByTestId('open-transcribe').click();
      await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('transcribe-replace-note')).toBeVisible();
      await audit(page, `${size.name}-editor-transcribe-dialog`, testInfo);
      expect(await horizontalOverflow(page), 'editor dialog').toBe(0);
    });
  }

  test('the states that say no: no sound, nothing heard, a refused model file', async ({ page, context }, testInfo) => {
    const models = testModels();
    const server = await serveModels(context, models);
    server.behave('base-test/onnx/encoder.onnx', 'corrupt');
    await installTranscriptTest(page, models, { segments: [], stepMs: 10 });
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-failed')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('model-failed')).toHaveAttribute('role', 'alert');
    await audit(page, 'yazi-model-refused', testInfo);
    server.behave('base-test/onnx/encoder.onnx', 'ok');
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-failed')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('transcribe-failed')).toHaveAttribute('role', 'alert');
    await audit(page, 'yazi-nothing-heard', testInfo);
  });

  for (const width of [320, 640]) {
    test(`reflow at ${width} px: the wizard and the panel never scroll sideways`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      const models = testModels();
      await serveModels(context, models);
      await installTranscriptTest(page, models);
      await page.goto('/yap/yazi');
      await page.getByTestId('video-input').setInputFiles(SAMPLE);
      await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });
      expect(await horizontalOverflow(page), 'model step').toBe(0);
      await toResult(page);
      expect(await horizontalOverflow(page), 'result').toBe(0);
      await panelLines(page).first().getByTestId('transcript-edit').click();
      expect(await horizontalOverflow(page), 'editing').toBe(0);
      await page.getByTestId('transcript-cancel').click();
      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      expect(await horizontalOverflow(page), 'editor').toBe(0);
    });
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`text spacing: no control clips its text at ${viewport.width} px`, async ({ page, context }) => {
      await page.setViewportSize(viewport);
      const models = testModels();
      await serveModels(context, models);
      await installTranscriptTest(page, models);
      await page.goto('/yap/yazi');
      await page.getByTestId('video-input').setInputFiles(SAMPLE);
      await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });
      await applyTextSpacing(page);
      expect(await clippedControls(page), 'model step').toEqual([]);
      await toResult(page);
      expect(await clippedControls(page), 'result').toEqual([]);
      expect(await horizontalOverflow(page), 'result').toBe(0);
      await page.getByTestId('wizard-open-editor').click();
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await applyTextSpacing(page);
      expect(await clippedControls(page), 'editor Yazı tab').toEqual([]);
    });
  }

  test('keyboard only: download the model, write, walk the lines, correct one — focus visible at every stop', async ({
    page,
    context,
  }) => {
    const unmarked: string[] = [];
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models);
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });
    // The step's heading has focus: a screen reader hears where it is.
    await expect(page.getByTestId('wizard-title')).toBeFocused();

    await tabTo(page, 'model-download', unmarked);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    await tabTo(page, 'transcribe-start', unmarked);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });

    // Into the list: one stop for the line, one for its pencil; arrows move between lines.
    await tabTo(page, 'transcript-line', unmarked);
    await expect(panelLines(page).first().getByTestId('transcript-line')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(panelLines(page).nth(2).getByTestId('transcript-line')).toBeFocused();
    expect((await focusStop(page)).indicator, 'a line shows its focus').toBe(true);
    await page.keyboard.press('Enter');
    await expect(panelLines(page).nth(2)).toHaveAttribute('data-active', 'true');

    // The pencil of that line, a correction, Enter saves and focus returns to the line.
    await page.keyboard.press('Tab');
    await expect(panelLines(page).nth(2).getByTestId('transcript-edit')).toBeFocused();
    expect((await focusStop(page)).indicator, 'the pencil shows its focus').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('transcript-field')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Today we cut by text.');
    await page.keyboard.press('Enter');
    await expect(panelLines(page).nth(2).locator('.transcript-text')).toHaveText('Today we cut by text.');
    await expect(panelLines(page).nth(2).getByTestId('transcript-line')).toBeFocused();

    // On to the downloads without a mouse.
    await tabTo(page, 'transcript-save-txt', unmarked);
    await tabTo(page, 'wizard-download', unmarked);
    expect(unmarked, 'stops without a visible focus indicator').toEqual([]);
  });

  test('reduced motion: the list jumps to the spoken line instead of gliding, and nothing animates', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    // Enough lines that the list has to scroll.
    const segments = Array.from({ length: 40 }, (_, index) => ({
      startUs: index * 500_000,
      endUs: index * 500_000 + 400_000,
      state: 'ok',
      words: [{ text: `Line${index + 1}.`, startUs: index * 500_000 + 20_000, endUs: index * 500_000 + 380_000 }],
    }));
    await installTranscriptTest(page, models, { segments, stepMs: 2 });
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { __scrollBehaviours: string[] }).__scrollBehaviours = calls;
      const original = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function scrollTo(this: Element, ...args: unknown[]) {
        const options = args[0] as ScrollToOptions | undefined;
        if (options && typeof options === 'object') calls.push(String(options.behavior));
        return (original as (...inner: unknown[]) => void).apply(this, args);
      } as typeof Element.prototype.scrollTo;
    });
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await toResult(page);
    await expect(page.getByTestId('transcript-count')).toHaveText('(40)');
    // Jump the video to a line far down: the list follows, without gliding.
    await page.getByTestId('wizard-video').evaluate((video: HTMLVideoElement) => {
      video.currentTime = 19.3;
    });
    await expect(panelLines(page).nth(38)).toHaveAttribute('data-active', 'true', { timeout: 20_000 });
    // In view INSIDE the list (the list scrolls itself; it never scrolls the page).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const list = document.querySelector('[data-testid="transcript-list"]') as HTMLElement;
          const row = list.children[38] as HTMLElement;
          const outer = list.getBoundingClientRect();
          const inner = row.getBoundingClientRect();
          return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => window.scrollY), 'the page itself did not move').toBe(0);
    const behaviours = await page.evaluate(() => (window as unknown as { __scrollBehaviours: string[] }).__scrollBehaviours);
    expect(behaviours.length).toBeGreaterThan(0);
    expect(behaviours.every((behaviour) => behaviour === 'auto')).toBe(true);
    // Nothing in the panel runs a transition or an animation.
    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.transcript *')).filter((element) => {
        const style = getComputedStyle(element);
        return (parseFloat(style.transitionDuration) || 0) > 0.01 || (parseFloat(style.animationDuration) || 0) > 0.01;
      }).length,
    );
    expect(moving).toBe(0);
  });

  test('names a screen reader hears: the list, the lines, the tick boxes, the status', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models);
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-transcribe').click();
    // The dialog is named by its heading; the progress bar by what it measures.
    await expect(page.getByRole('dialog', { name: 'Videoyu yazıya dök' })).toBeVisible();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-done')).toHaveAttribute('role', 'status');
    await page.getByTestId('transcribe-close').click();

    await expect(page.getByRole('tablist', { name: 'Kesitler ve yazı' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Yazı (5)' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Yazı (5)' })).toBeVisible();
    const list = page.getByRole('list', { name: 'Yazı (5)' });
    await expect(list.getByRole('listitem')).toHaveCount(5);
    await expect(list.getByRole('button', { name: '0:01 Hello and welcome to the show.', exact: true })).toBeVisible();
    await expect(list.getByRole('checkbox', { name: 'Seç: 0:01 Hello and welcome to the show.' })).toBeVisible();
    await expect(list.getByRole('button', { name: 'Satırı düzelt: 0:01 Hello and welcome to the show.' })).toBeVisible();
    await expect(list.getByRole('button', { name: 'Elle yaz: 0:06 (anlaşılamadı)' })).toBeVisible();
    await expect(page.getByTestId('transcript-status')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('transcript-machine-note')).toContainText('Otomatik yazıldı');
  });
});
