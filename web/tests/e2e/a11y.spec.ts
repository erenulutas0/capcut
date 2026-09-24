import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { tr } from '../../src/i18n/messages';
import { browserDecodesHevc, hevcFixture } from './hevc-media';
import { closeSheet, noSavePicker, openMore, openSettings, installSavePicker } from './kesitFlow';
import { timelineFixture } from './timeline-media';

/**
 * Accessibility audit (roadmap P2-03, launch checklist B).
 *
 * Two kinds of checks live here:
 * - axe-core on every reachable page state (WCAG 2.0/2.1/2.2 A and AA rules
 *   plus axe's best-practice rules for landmarks and headings);
 * - the checks axe cannot make: a mouse-free walkthrough of the core flow,
 *   focus trap and return for every dialog, reduced motion, 320 px reflow,
 *   the WCAG 1.4.12 text-spacing override and the names a screen reader hears.
 *
 * None of this replaces a real screen reader session; see
 * docs/a11y/2026-09-22-audit.md for what was not tested.
 */

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const OTHER_VIDEO = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

interface Finding {
  rule: string;
  impact: string;
  nodes: number;
  targets: string[];
}

/**
 * Runs axe on the page as it is now. Soft: one state's findings must not hide
 * the next state's, so the whole walk always runs and reports everything.
 */
async function audit(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const findings: Finding[] = result.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 6).map((node) => node.target.join(' ')),
  }));
  if (findings.length > 0) {
    // One parsable line per state, so a run can be tallied for the audit doc.
    console.log(`A11Y ${JSON.stringify({ state, findings })}`);
    await testInfo.attach(`axe-${state}`, {
      body: JSON.stringify(result.violations, null, 2),
      contentType: 'application/json',
    });
  }
  expect.soft(findings, `axe violations in state "${state}"`).toEqual([]);
}

async function openEditor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('download-all')).toBeVisible();
  return errors;
}

/** Opens the sample: nothing is placed on its own (ADR-026). */
async function importSample(page: Page) {
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

async function withMoments(page: Page) {
  await openEditor(page);
  await importSample(page);
  await addMoment(page, '00:00.000', '00:02.000');
  await addMoment(page, '00:08.000', '00:10.000');
  await expect(page.getByTestId('kesit-card')).toHaveCount(2);
}

function srtFile(): { name: string; mimeType: string; buffer: Buffer } {
  const body = [
    '1',
    '00:00:00,200 --> 00:00:01,400',
    'Merhaba',
    '',
    '2',
    '00:00:01,600 --> 00:00:03,000',
    'Güzel bir gün',
    '',
  ].join('\r\n');
  return { name: 'erisim.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(body, 'utf8') };
}

// ------------------------------------------------------------- IndexedDB

interface StoredRecord {
  edl: { revision: number; clips: unknown[]; captionTracks: unknown[] };
}

function storedRecords(page: Page): Promise<StoredRecord[]> {
  return page.evaluate(
    () =>
      new Promise<StoredRecord[]>((resolve) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          all.onerror = () => {
            db.close();
            resolve([]);
          };
          all.onsuccess = () => {
            db.close();
            resolve(all.result as StoredRecord[]);
          };
        };
      }),
  );
}

/** Polled with page.evaluate: waitForFunction does not await a Promise. */
async function waitForRecord(page: Page, matches: (record: StoredRecord) => boolean): Promise<StoredRecord> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const hit = (await storedRecords(page)).find(matches);
    if (hit) return hit;
    await page.waitForTimeout(200);
  }
  throw new Error('record not stored in time');
}

/** A one-kesit project whose (joined-video) caption cannot fit, so the download fails. */
async function projectWithUnfittableCaption(page: Page, testInfo: TestInfo) {
  await openEditor(page);
  await importSample(page);
  await addMoment(page, '00:00.000', '00:02.000');
  const record = await waitForRecord(page, (r) => r.edl.clips.length === 1);
  const backup = structuredClone(record);
  backup.edl.revision = record.edl.revision + 1000;
  backup.edl.captionTracks = [
    {
      trackId: 't_a11y_001',
      origin: 'manual',
      timeBase: 'output',
      language: 'tr',
      style: { preset: 'box', position: 'bottom', size: 'medium' },
      cues: [
        {
          cueId: 'q_a11y_1',
          startUs: 200_000,
          endUs: 1_800_000,
          text: 'BU SATIR BİLEREK ÇOK UZUN VE BÜYÜK HARFLERLE YAZILDI Kİ VİDEONUN GENİŞLİĞİNE İKİ SATIRDA HİÇBİR ŞEKİLDE SIĞMASIN',
        },
      ],
    },
  ];
  const path = testInfo.outputPath('a11y-captions.clip.json');
  writeFileSync(path, JSON.stringify(backup));
  await page.getByTestId('backup-input').setInputFiles(path);
  await waitForRecord(page, (r) => r.edl.captionTracks.length === 1);
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

async function clearStorage(page: Page) {
  await page.goto('/editor');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('clip-editor');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
}

// ------------------------------------------------------------- axe audit

test.describe('a11y: axe audit', () => {
  // Axe measures colours as painted; with motion reduced (which the app
  // honours) nothing is caught half-way through a fade.
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await installSavePicker(page);
    await clearStorage(page);
  });

  test('landing page', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'landing', testInfo);
  });

  test('privacy page (tr, en) and the report dialog', async ({ page }, testInfo) => {
    await page.goto('/gizlilik');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'privacy-tr', testInfo);
    await page.goto('/gizlilik/en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'privacy-en', testInfo);

    await openEditor(page);
    await openMore(page);
    await page.getByTestId('open-help').click();
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('diag-preview')).toBeVisible();
    await audit(page, 'report-dialog', testInfo);
  });

  test('editor: empty, marking, kesitler, a selected kesit, Ayarlar and Diğer', async ({ page }, testInfo) => {
    const errors = await openEditor(page);
    await audit(page, 'editor-empty', testInfo);

    await importSample(page);
    await expect(page.getByTestId('timeline-notice')).not.toBeEmpty();
    await audit(page, 'editor-video-no-kesit', testInfo);

    // Marking: the pending range and its handles on the strip.
    await page.getByTestId('timeline-playhead').focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('i');
    await expect(page.getByTestId('strip-pending')).toBeVisible();
    await audit(page, 'editor-marking', testInfo);
    await page.keyboard.press('Enter');

    await addMoment(page, '00:08.000', '00:10.000');
    await expect(page.getByTestId('moment-count')).toHaveText('(2)');
    await audit(page, 'editor-kesitler', testInfo);

    await page.getByTestId('kesit-select').first().click();
    await expect(page.getByTestId('trim-start')).toBeVisible();
    await audit(page, 'editor-kesit-selected', testInfo);

    for (const tab of ['frame', 'audio', 'captions'] as const) {
      await openSettings(page, tab);
      await audit(page, `editor-settings-${tab}`, testInfo);
      await closeSheet(page);
    }
    await openMore(page);
    await audit(page, 'editor-more', testInfo);
    await closeSheet(page);
    expect(errors).toEqual([]);
  });

  test('downloads: saved, and offered for saving without a save dialog', async ({ page }, testInfo) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:01.000');
    await openSettings(page, 'frame');
    await page.getByTestId('export-quality').selectOption('720');
    await closeSheet(page);
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
    await page.getByText(tr['download.details']).click();
    await audit(page, 'download-saved', testInfo);
  });

  test('downloads: the fallback route offers "Bilgisayara kaydet"', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await noSavePicker(page);
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:01.000');
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 180_000 });
    await audit(page, 'download-ready-fallback', testInfo);
    await context.close();
  });

  test('downloads: failed', async ({ page }, testInfo) => {
    await projectWithUnfittableCaption(page, testInfo);
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
    await audit(page, 'download-failed', testInfo);
  });

  // ADR-021 per download (ADR-026): a 90-minute video, a kesit over 60
  // minutes, the refusals, and a rejected file.
  test('limits: a kesit over the download limit, the refusal, a rejected file', async ({ page }, testInfo) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await addMoment(page, '0', '1:10:00');
    await expect(page.getByTestId('kesit-over-limit')).toBeVisible();
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('export-over-limit')).toBeVisible();
    await audit(page, 'limit-kesit-over', testInfo);
    await page.getByTestId('video-input').setInputFiles(timelineFixture('tooLong').file).catch(() => undefined);
    page.once('dialog', (dialog) => void dialog.accept());
    await expect(page.getByTestId('media-error')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'limit-rejected-file', testInfo);
  });

  test('dialogs: help, silence, caption import', async ({ page }, testInfo) => {
    await withMoments(page);

    await openMore(page);
    await page.getByTestId('open-help').click();
    await expect(page.getByRole('dialog', { name: tr['help.title'] })).toBeVisible();
    await audit(page, 'dialog-help', testInfo);
    await page.keyboard.press('Escape');

    await openMore(page);
    await page.getByTestId('find-silences').click();
    const silence = page.getByRole('dialog', { name: tr['silence.title'] });
    await expect(silence).toBeVisible();
    await expect(page.getByTestId('silence-running')).toHaveCount(0, { timeout: 30_000 });
    await audit(page, 'dialog-silence', testInfo);
    await page.keyboard.press('Escape');

    await openSettings(page, 'captions');
    await page.getByTestId('caption-file-input').setInputFiles(srtFile());
    const importDialog = page.getByRole('dialog', { name: tr['captions.import.title'] });
    await expect(importDialog).toBeVisible();
    await audit(page, 'dialog-caption-import', testInfo);
    // aria-disabled: Playwright will not click it, a keyboard press can.
    await importDialog.getByTestId('caption-import-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(importDialog.getByTestId('caption-import-need-choice')).toBeVisible();
    await audit(page, 'dialog-caption-import-error', testInfo);
    await importDialog.getByTestId('caption-import-choice-source').check();
    await importDialog.getByTestId('caption-import-confirm').click();
    await expect(importDialog).toHaveCount(0);
    await expect(page.getByTestId('caption-import-count')).toBeVisible();
    await audit(page, 'editor-captions-imported', testInfo);
  });

  test('relink panel: missing file, a download refused, mismatch', async ({ page }, testInfo) => {
    await withMoments(page);
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await audit(page, 'relink-missing', testInfo);

    await page.getByTestId('kesit-download').first().click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'download-blocked', testInfo);

    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('relink-mismatch')).toBeVisible({ timeout: 30_000 });
    await audit(page, 'relink-mismatch', testInfo);
  });

  test.describe('phone 390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('empty editor, kesitler, Ayarlar and Diğer sheets', async ({ page }, testInfo) => {
      await openEditor(page);
      await audit(page, 'phone-empty', testInfo);
      await importSample(page);
      await addMoment(page, '00:00.000', '00:02.000');
      await addMoment(page, '00:08.000', '00:10.000');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await audit(page, 'phone-kesitler', testInfo);
      await page.evaluate(() => window.scrollTo(0, 0));

      for (const tab of ['frame', 'audio', 'captions'] as const) {
        await openSettings(page, tab);
        await audit(page, `phone-settings-${tab}`, testInfo);
        await closeSheet(page);
      }
      await openMore(page);
      await audit(page, 'phone-more', testInfo);
      await closeSheet(page);
    });

    test('a kesit over the download limit (ADR-021)', async ({ page }, testInfo) => {
      await openEditor(page);
      await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await addMoment(page, '0', '1:10:00');
      await page.getByTestId('kesit-download').click();
      await expect(page.getByTestId('export-over-limit')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await audit(page, 'phone-limit-kesit-over', testInfo);
    });
  });

  test.describe('tablet 820 px', () => {
    test.use({ viewport: { width: 820, height: 1100 } });

    test('two columns and both drawers', async ({ page }, testInfo) => {
      await withMoments(page);
      await audit(page, 'tablet', testInfo);
      await openSettings(page, 'frame');
      await audit(page, 'tablet-drawer-settings', testInfo);
      await closeSheet(page);
      await openMore(page);
      await audit(page, 'tablet-drawer-more', testInfo);
    });
  });
});

// ------------------------------------------------------- keyboard and focus

interface FocusStop {
  testId: string | null;
  name: string;
  indicator: boolean;
  inDialog: boolean;
}

/** Describes the focused element, including whether a focus indicator is painted. */
function focusStop(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) {
      return { testId: null, name: 'body', indicator: false, inDialog: false };
    }
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
    return {
      testId: element.getAttribute('data-testid'),
      name: `${element.tagName.toLowerCase()} "${(
        element.getAttribute('aria-label') ??
        element.textContent ??
        ''
      )
        .trim()
        .slice(0, 40)}"`,
      indicator: outline || shadow,
      inDialog: element.closest('[role="dialog"]') !== null,
    };
  });
}

/**
 * Presses Tab until `matches` holds for the focused element, recording every
 * stop without a visible indicator on the way. Fails if it never gets there.
 */
async function tabTo(
  page: Page,
  matches: (stop: FocusStop) => boolean,
  unmarked: string[],
  what: string,
  maxPresses = 90,
): Promise<void> {
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    const stop = await focusStop(page);
    if (stop.testId !== null || stop.name !== 'body') {
      if (!stop.indicator) unmarked.push(stop.name);
    }
    if (matches(stop)) return;
  }
  throw new Error(`Tab never reached ${what}`);
}

const byTestId = (testId: string) => (stop: FocusStop) => stop.testId === testId;

/**
 * Playwright switches file-chooser interception on when the first listener is
 * added, asynchronously. A waitForEvent made just before the key press can
 * lose that race; the chooser then opens natively and the event never comes.
 * A standing listener added early keeps interception on for the whole test.
 */
function catchFileChoosers(page: Page) {
  page.on('filechooser', () => undefined);
}

test.describe('a11y: keyboard only', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ timeout: 180_000 });

  test('the core flow without a mouse, with visible focus at every stop', async ({ page }) => {
    await installSavePicker(page);
    await clearStorage(page);
    catchFileChoosers(page);
    const errors = await openEditor(page);
    const unmarked: string[] = [];

    // 1. Pick the video: the empty-state button opens the file chooser.
    await tabTo(page, (stop) => stop.name.includes(tr['preview.pickVideo']), unmarked, 'Video seç');
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');
    const ranges = page.getByTestId('kesit-range');

    // 2. The playhead on the strip: Shift+Right is one second. I and O mark,
    //    Enter adds the kesit. Twice.
    await tabTo(page, byTestId('timeline-playhead'), unmarked, 'the playhead');
    await page.keyboard.press('Home');
    for (let i = 0; i < 2; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('i');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('o');
    await page.keyboard.press('Enter');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('i');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('o');
    await page.keyboard.press('Enter');
    await expect(ranges).toHaveText(['00:02 → 00:06', '00:10 → 00:13']);
    await expect(page.getByTestId('timeline-playhead')).toBeFocused();

    // 3. Reorder with the grip's arrow keys; focus stays on the grip.
    await tabTo(page, (stop) => stop.name.startsWith("button \"Kesit 2'yi taşı"), unmarked, 'the grip of kesit 2');
    await page.keyboard.press('ArrowUp');
    await expect(ranges).toHaveText(['00:10 → 00:13', '00:02 → 00:06']);
    expect((await focusStop(page)).name).toContain("Kesit 1'i taşı");

    // 4. Delete one with its button; undo brings it back.
    await tabTo(page, (stop) => stop.name.startsWith("button \"Kesit 2'yi sil"), unmarked, 'delete kesit 2');
    await page.keyboard.press('Enter');
    await expect(ranges).toHaveText(['00:10 → 00:13']);
    expect((await focusStop(page)).name).not.toBe('body');
    await page.keyboard.press('Control+z');
    await expect(ranges).toHaveText(['00:10 → 00:13', '00:02 → 00:06']);

    // 5. Select kesit 2 and shorten its end with the edge slider; Escape leaves it.
    await tabTo(page, (stop) => stop.name.startsWith("button \"Kesit 2'yi seç"), unmarked, 'select kesit 2');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('kesit-editing')).toBeVisible();
    await tabTo(page, byTestId('trim-end'), unmarked, 'the end of kesit 2');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(ranges.nth(1)).toHaveText('00:02 → 00:05');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('kesit-editing')).toHaveCount(0);

    // 6. Download kesit 1 with its button: the save dialog, then "Kaydedildi".
    await tabTo(page, (stop) => stop.name.startsWith("button \"Kesit 1'i indir"), unmarked, 'download kesit 1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });

    // 7. Ayarlar: focus inside, Escape closes, focus returns.
    await tabTo(page, byTestId('open-settings'), unmarked, 'Ayarlar');
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: tr['settings.title'] });
    await expect(settings).toBeVisible();
    expect((await focusStop(page)).inDialog).toBe(true);
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    expect((await focusStop(page)).testId).toBe('open-settings');

    // 8. Diğer → help; closing help lands back on ⋯.
    await tabTo(page, byTestId('open-more'), unmarked, 'Diğer');
    await page.keyboard.press('Enter');
    await tabTo(page, byTestId('open-help'), unmarked, 'Kısayollar');
    await page.keyboard.press('Enter');
    const help = page.getByRole('dialog', { name: tr['help.title'] });
    await expect(help).toBeVisible();
    expect((await focusStop(page)).indicator).toBe(true);
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect.poll(async () => (await focusStop(page)).testId).toBe('open-more');

    // 9. F watches full screen from the keyboard, and again leaves it.
    await tabTo(page, byTestId('timeline-playhead'), unmarked, 'the playhead');
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

    expect(unmarked, 'focus stops without a visible indicator').toEqual([]);
    expect(errors).toEqual([]);
  });
});

/** Tabs forwards and backwards inside the open dialog; focus must never leave it. */
async function expectTrapped(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let press = 0; press < 25; press += 1) {
      await page.keyboard.press(key);
      const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
      expect(inside, `${key} #${press + 1} left the dialog`).toBe(true);
    }
  }
}

/** Opens a dialog from `opener` with the keyboard, checks the trap, closes with Escape. */
async function trapAndReturn(page: Page, opener: Locator, dialog: Locator) {
  await opener.focus();
  await page.keyboard.press('Enter');
  await expectTrapped(page, dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const back = await opener.evaluate((node) => node === document.activeElement);
  expect(back, 'focus returned to the control that opened the dialog').toBe(true);
}

test.describe('a11y: focus trap and return', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ timeout: 120_000 });

  test('desktop dialogs and drawers', async ({ page }) => {
    await clearStorage(page);
    catchFileChoosers(page);
    await withMoments(page);

    await trapAndReturn(page, page.getByTestId('open-settings'), page.getByRole('dialog', { name: tr['settings.title'] }));
    await trapAndReturn(page, page.getByTestId('open-more'), page.getByRole('dialog', { name: tr['more.title'] }));

    // Help and silences open from Diğer; closing them returns to ⋯.
    const more = page.getByTestId('open-more');
    for (const [testId, name] of [
      ['open-help', tr['help.title']],
      ['find-silences', tr['silence.title']],
    ] as const) {
      await more.focus();
      await page.keyboard.press('Enter');
      await page.getByTestId(testId).focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name });
      if (testId === 'find-silences') await expect(page.getByTestId('silence-running')).toHaveCount(0, { timeout: 30_000 });
      await expectTrapped(page, dialog);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(more).toBeFocused();
    }

    // The import dialog opens after the file chooser, over Ayarlar; focus
    // goes back to the "Altyazı dosyası seç" button that started it.
    await openSettings(page, 'captions');
    const importButton = page.getByTestId('caption-import');
    await importButton.focus();
    await expect(importButton).toBeFocused();
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(srtFile());
    const importDialog = page.getByRole('dialog', { name: tr['captions.import.title'] });
    await expectTrapped(page, importDialog);
    await page.keyboard.press('Escape');
    await expect(importDialog).toHaveCount(0);
    expect(await importButton.evaluate((node) => node === document.activeElement)).toBe(true);
  });

  for (const [label, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 820, height: 1100 }],
  ] as const) {
    test.describe(`${label} sheets`, () => {
      test.use({ viewport });

      test('Ayarlar and Diğer trap and return focus', async ({ page }) => {
        await clearStorage(page);
        await withMoments(page);
        await trapAndReturn(page, page.getByTestId('open-settings'), page.getByRole('dialog', { name: tr['settings.title'] }));
        await trapAndReturn(page, page.getByTestId('open-more'), page.getByRole('dialog', { name: tr['more.title'] }));
      });
    });
  }
});

// ------------------------------------------------------ motion, reflow, text

test.describe('a11y: reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no animation or transition runs when the system asks for less motion', async ({ page }) => {
    await openEditor(page);
    // The indeterminate export bar is the app's one animation; a probe with
    // its classes proves the rule is really in force, not just absent.
    const probe = await page.evaluate(() => {
      const bar = document.createElement('div');
      bar.className = 'progress-fill progress-indeterminate';
      document.body.append(bar);
      const name = getComputedStyle(bar).animationName;
      bar.remove();
      const moving = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((node) => {
        const style = getComputedStyle(node);
        const transition = style.transitionDuration.split(',').some((part) => parseFloat(part) > 0);
        return style.animationName !== 'none' || transition;
      });
      return { name, moving: moving.map((node) => node.className || node.tagName) };
    });
    expect(probe).toEqual({ name: 'none', moving: [] });
  });

  test('the probe does animate without the preference', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await page.goto('/editor');
    const name = await page.evaluate(() => {
      const bar = document.createElement('div');
      bar.className = 'progress-fill progress-indeterminate';
      document.body.append(bar);
      return getComputedStyle(bar).animationName;
    });
    expect(name).not.toBe('none');
    await context.close();
  });
});

function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('a11y: reflow at 320 CSS px (WCAG 1.4.10)', () => {
  // 1280 px at 400 % zoom, the criterion's own example; also 640 px (200 %).
  for (const width of [320, 640]) {
    test.describe(`${width} px`, () => {
      test.use({ viewport: { width, height: 720 }, storageState: { cookies: [], origins: [] } });

      test('landing and editor never scroll sideways', async ({ page }) => {
        await page.goto('/');
        expect(await horizontalOverflow(page), 'landing').toBe(0);
        await clearStorage(page);
        await openEditor(page);
        expect(await horizontalOverflow(page), 'empty editor').toBe(0);
        await importSample(page);
        await addMoment(page, '00:00.000', '00:02.000');
        await addMoment(page, '00:08.000', '00:10.000');
        await page.getByTestId('kesit-select').first().click();
        expect(await horizontalOverflow(page), 'editor with kesitler').toBe(0);
        for (const open of [() => openSettings(page, 'captions'), () => openMore(page)]) {
          await open();
          expect(await horizontalOverflow(page), 'sheet').toBe(0);
          const sheetOverflow = await page.evaluate(() => {
            const body = document.querySelector('.sheet-body');
            return body ? body.scrollWidth - body.clientWidth : 0;
          });
          expect(sheetOverflow, 'sheet body').toBe(0);
          await closeSheet(page);
        }
        // ADR-021 per download: the refusal sentence on a kesit card.
        page.once('dialog', (dialog) => void dialog.accept());
        await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
        await expect(page.getByTestId('total-time')).toHaveText('01:30:00.000', { timeout: 60_000 });
        await addMoment(page, '0', '1:10:00');
        await page.getByTestId('kesit-download').click();
        await expect(page.getByTestId('export-over-limit')).toBeVisible();
        expect(await horizontalOverflow(page), 'editor over the download limit').toBe(0);
      });
    });
  }
});

/** The WCAG 1.4.12 test values ("text spacing bookmarklet"). */
const TEXT_SPACING_CSS = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

/**
 * Controls whose text is clipped: an element that hides overflow and whose
 * content no longer fits. Visible overflow is not clipping and is not counted.
 * File names are shortened on purpose (with the full name in the title), so
 * elements marked data-truncates are skipped.
 */
function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = [
      'button',
      'a[href]',
      '[role="tab"]',
      '[role="slider"]',
      'label',
      'legend',
      '.time-readout',
      '.kesit-range',
      '.kesit-length',
      '.pill',
      '.field-label',
      '.inline-error',
      '.notice',
    ].join(',');
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

test.describe('a11y: text spacing (WCAG 1.4.12)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`no control clips its text at ${viewport.width} px`, async ({ page }) => {
      await installSavePicker(page);
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      expect(await clippedControls(page), 'landing').toEqual([]);

      await clearStorage(page);
      await withMoments(page);
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      await page.getByTestId('kesit-select').first().click();
      expect(await clippedControls(page), 'editor').toEqual([]);
      expect(await horizontalOverflow(page), 'editor page width').toBe(0);

      await page.getByTestId('kesit-download').first().click();
      await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
      expect(await clippedControls(page), 'download saved').toEqual([]);

      await openSettings(page, 'frame');
      expect(await clippedControls(page), 'Ayarlar').toEqual([]);
    });

    test(`over the download limit, nothing clips at ${viewport.width} px (ADR-021)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openEditor(page);
      await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await addMoment(page, '0', '1:10:00');
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      await page.getByTestId('kesit-download').click();
      await expect(page.getByTestId('export-over-limit')).toBeVisible();
      expect(await clippedControls(page), 'kesit over the limit').toEqual([]);
      expect(await horizontalOverflow(page), 'editor page width').toBe(0);
    });
  }
});

// ------------------------------- the HEVC import hint and the save-space note

/** Opens the HEVC clip; false when this browser decodes HEVC (no hint then). */
async function openHevcWithoutDecoder(page: Page): Promise<boolean> {
  await openEditor(page);
  if (await browserDecodesHevc(page)) return false;
  await page.getByTestId('video-input').setInputFiles(hevcFixture());
  await expect(page.getByTestId('media-error-hint')).toBeVisible({ timeout: 60_000 });
  return true;
}

/** A finished one-second download without a save dialog, so the note under "Bilgisayara kaydet" shows. */
async function exportSucceeded(page: Page) {
  await openEditor(page);
  await importSample(page);
  await addMoment(page, '00:00.000', '00:01.000');
  await page.getByTestId('kesit-download').click();
  await expect(page.getByTestId('export-save-space')).toBeVisible({ timeout: 180_000 });
}

test.describe('a11y: HEVC hint and the save-space note', () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await noSavePicker(page);
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`axe and text spacing at ${viewport.width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await clearStorage(page);
      if (await openHevcWithoutDecoder(page)) {
        await audit(page, `hevc-hint-${viewport.width}`, testInfo);
        await page.addStyleTag({ content: TEXT_SPACING_CSS });
        expect(await clippedControls(page), 'HEVC hint').toEqual([]);
        expect(await horizontalOverflow(page), 'HEVC hint page width').toBe(0);
      } else {
        testInfo.annotations.push({ type: 'skipped-part', description: 'browser decodes HEVC: no hint state' });
      }

      await clearStorage(page);
      await exportSucceeded(page);
      await audit(page, `download-ready-${viewport.width}`, testInfo);
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      expect(await clippedControls(page), 'download ready').toEqual([]);
      expect(await horizontalOverflow(page), 'download ready page width').toBe(0);
    });
  }

  test.describe('320 px', () => {
    test.use({ viewport: { width: 320, height: 720 } });

    test('reflow: neither scrolls sideways', async ({ page }) => {
      await clearStorage(page);
      if (await openHevcWithoutDecoder(page)) {
        expect(await horizontalOverflow(page), 'HEVC hint').toBe(0);
      }
      await clearStorage(page);
      await exportSucceeded(page);
      expect(await horizontalOverflow(page), 'download ready').toBe(0);
    });
  });
});

// ------------------------------------------------------ screen reader names

test.describe('a11y: names a screen reader hears', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('preview, transport, strip, kesit list, handles, caption overlay', async ({ page }) => {
    await clearStorage(page);
    await withMoments(page);

    await expect(page.getByTestId('preview-video')).toHaveAccessibleName(tr['a11y.previewVideo']);
    await expect(page.getByTestId('play-toggle')).toHaveAccessibleName(tr['preview.play']);
    await expect(page.getByTestId('fullscreen-toggle')).toHaveAccessibleName(tr['preview.fullscreen']);

    // The readouts say what they are, not just "00:00.000".
    await expect(page.getByTestId('time-now')).toContainText(tr['a11y.timeNow']);
    await expect(page.getByTestId('time-now')).toContainText(tr['a11y.timeTotal']);

    // The one playhead: a named slider with a spoken value and a hint.
    const playhead = page.getByRole('slider', { name: tr['strip.playhead'] });
    await expect(playhead).toBeVisible();
    await expect(playhead).toHaveAttribute('aria-valuetext', /saniye, toplam 24 saniye$/);
    await expect(playhead).toHaveAttribute('aria-describedby', 'strip-hint');
    await expect(page.getByRole('button', { name: tr['strip.zoomIn'] })).toBeVisible();

    // The kesit list is a real list; every button says which kesit and range.
    const list = page.getByRole('list', { name: /^Kesitler/ });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    for (const [name, pressed] of [
      ["Kesit 1'i seç, 00:00–00:02", 'false'],
      ["Kesit 2'yi seç, 00:08–00:10", 'false'],
    ] as const) {
      await expect(page.getByRole('button', { name })).toHaveAttribute('aria-pressed', pressed);
    }
    for (const name of [
      "Kesit 1'i oynat, 00:00–00:02",
      "Kesit 1'i indir, 00:00–00:02",
      "Kesit 1'i sil, 00:00–00:02",
      "Kesit 2'yi taşı, 00:08–00:10",
    ]) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: "Kesit 2'yi taşı, 00:08–00:10" })).toHaveAttribute(
      'aria-describedby',
      'kesit-move-hint',
    );

    // Edge handles: sliders with a spoken Turkish value.
    await page.getByRole('button', { name: "Kesit 1'i seç, 00:00–00:02" }).click();
    const start = page.getByRole('slider', { name: 'Kesit 1 başlangıcı' });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('aria-valuetext', /saniye/);

    // The caption overlay is pixels; the words are in the caption panel.
    await expect(page.getByTestId('caption-overlay')).toHaveAttribute('aria-hidden', 'true');
  });
});
