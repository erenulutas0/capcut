import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { tr } from '../../src/i18n/messages';
import { browserDecodesHevc, hevcFixture } from './hevc-media';
import { startWithEmptyTimeline } from './rangeFlow';
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
  await expect(page.getByTestId('open-export')).toBeVisible();
  return errors;
}

/** Opens the sample: it arrives on the timeline as one piece (ADR-019). */
async function openSample(page: Page) {
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

/** Opens the sample and empties the timeline, for states built with the range flow. */
async function importSample(page: Page) {
  await openSample(page);
  await startWithEmptyTimeline(page);
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
  // The strip is in every layout; the moment list is in a drawer on tablets.
  await expect(page.getByTestId('strip-clip')).toHaveCount(2);
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

/** A one-moment project whose caption cannot fit, so the export fails. */
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
    await clearStorage(page);
  });

  test('landing page', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'landing', testInfo);
  });

  // Added after the privacy/support work landed next to this audit.
  test('privacy page (tr, en) and the report dialog', async ({ page }, testInfo) => {
    await page.goto('/gizlilik');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'privacy-tr', testInfo);
    await page.goto('/gizlilik/en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'privacy-en', testInfo);

    await openEditor(page);
    await page.getByTestId('open-help').click();
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('diag-preview')).toBeVisible();
    await audit(page, 'report-dialog', testInfo);
  });

  test('editor: empty, with video and moments, every panel tab', async ({ page }, testInfo) => {
    const errors = await openEditor(page);
    await audit(page, 'editor-empty', testInfo);

    // ADR-019: the video arrives as one piece, with a confirmation.
    await openSample(page);
    await expect(page.getByTestId('timeline-notice')).not.toBeEmpty();
    await audit(page, 'editor-video-one-piece', testInfo);

    // Undo empties the timeline; it offers the whole video or a range.
    await startWithEmptyTimeline(page);
    await expect(page.getByTestId('timeline-add-whole')).toBeVisible();
    await audit(page, 'editor-video', testInfo);

    await addMoment(page, '00:00.000', '00:02.000');
    await addMoment(page, '00:08.000', '00:10.000');
    await expect(page.getByTestId('moment-count')).toHaveText('2 parça');
    // A selected piece shows the trim handles on the timeline.
    await page.getByTestId('strip-clip').first().locator('.strip-clip-select').click();
    await expect(page.getByTestId('trim-start')).toBeVisible();
    await audit(page, 'editor-moments-inspector-frame', testInfo);

    await page.getByRole('tab', { name: tr['tabs.audio'] }).click();
    await audit(page, 'editor-inspector-audio', testInfo);

    await page.getByTestId('inspector-tab-captions').click();
    await audit(page, 'editor-inspector-captions', testInfo);

    await page.getByRole('tab', { name: tr['tabs.sources'] }).click();
    await audit(page, 'editor-left-sources', testInfo);

    await page.getByRole('tab', { name: tr['preview.output'] }).click();
    await expect(page.getByTestId('output-note')).toBeVisible();
    await audit(page, 'editor-result-mode', testInfo);
    expect(errors).toEqual([]);
  });

  // Added with the single timeline (ADR-019).
  // Policy v4 (ADR-021): a 90-minute video arrives whole, over the 60-minute
  // download limit; the strip marks the limit and the excess, and the
  // download dialog refuses with the amount to delete. Both are audited.
  test('timeline: a video over the download limit as one piece, the gate, a rejected file', async ({ page }, testInfo) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
    await expect(page.getByTestId('strip-clip')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId('timeline-over-limit')).toBeVisible();
    await audit(page, 'timeline-over-limit', testInfo);
    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-over-limit')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'dialog-export-over-limit', testInfo);
    await page.keyboard.press('Escape');
    await page.getByTestId('video-input').setInputFiles(timelineFixture('tooLong').file);
    await expect(page.getByTestId('media-error')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'timeline-rejected-file', testInfo);
    await page.getByTestId('strip-clip').first().locator('.strip-clip-select').click();
    await expect(page.getByTestId('trim-end')).toBeVisible();
    await audit(page, 'timeline-piece-selected', testInfo);
  });

  test('dialogs: help, export (ready), silence, caption import', async ({ page }, testInfo) => {
    await withMoments(page);

    await page.getByTestId('open-help').click();
    await expect(page.getByRole('dialog', { name: tr['help.title'] })).toBeVisible();
    await audit(page, 'dialog-help', testInfo);
    await page.keyboard.press('Escape');

    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'dialog-export-ready', testInfo);
    await page.keyboard.press('Escape');

    await page.getByTestId('open-silence').click();
    const silence = page.getByRole('dialog', { name: tr['silence.title'] });
    await expect(silence).toBeVisible();
    await expect(page.getByTestId('silence-running')).toHaveCount(0, { timeout: 30_000 });
    await audit(page, 'dialog-silence', testInfo);
    await page.keyboard.press('Escape');

    await page.getByTestId('inspector-tab-captions').click();
    await page.getByTestId('caption-file-input').setInputFiles(srtFile());
    const importDialog = page.getByRole('dialog', { name: tr['captions.import.title'] });
    await expect(importDialog).toBeVisible();
    await audit(page, 'dialog-caption-import', testInfo);
    // The "choose first" error state is part of the dialog too.
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

  test('export dialog: succeeded', async ({ page }, testInfo) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:01.000');
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption('720');
    await expect(page.getByTestId('export-create')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('export-create').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
    await audit(page, 'dialog-export-succeeded', testInfo);
  });

  test('export dialog: failed', async ({ page }, testInfo) => {
    await projectWithUnfittableCaption(page, testInfo);
    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-create')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('export-create').click();
    await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
    await audit(page, 'dialog-export-failed', testInfo);
  });

  test('relink panel: missing file and mismatch', async ({ page }, testInfo) => {
    await withMoments(page);
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await audit(page, 'relink-missing', testInfo);

    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 60_000 });
    await audit(page, 'dialog-export-blocked', testInfo);
    await page.keyboard.press('Escape');

    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('relink-mismatch')).toBeVisible({ timeout: 30_000 });
    await audit(page, 'relink-mismatch', testInfo);
  });

  test.describe('phone 390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('empty editor, then every bottom sheet with moments', async ({ page }, testInfo) => {
      await openEditor(page);
      await audit(page, 'phone-empty', testInfo);
      await importSample(page);
      await addMoment(page, '00:00.000', '00:02.000');
      await addMoment(page, '00:08.000', '00:10.000');
      // Scrolled to the end: mid-scroll, axe's target-size rule counts the
      // strip's last button as "too small" because the sticky tool bar is
      // passing over it. That is a scroll snapshot, not a small target;
      // whether focus can end up hidden there is checked separately below.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await audit(page, 'phone-moments', testInfo);

      const sheets: Array<[string, string]> = [
        ['tab-moments', tr['tabs.moments']],
        ['tab-frame', tr['tabs.frame']],
        ['tab-audio', tr['tabs.audio']],
        ['tab-captions', tr['captions.tab']],
        ['tab-file', tr['tabs.file']],
      ];
      for (const [testId, name] of sheets) {
        await page.getByTestId(testId).click();
        const sheet = page.getByRole('dialog', { name });
        await expect(sheet).toBeVisible();
        await audit(page, `phone-sheet-${testId.replace('tab-', '')}`, testInfo);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
      }
    });

    test('a video over the download limit (ADR-021)', async ({ page }, testInfo) => {
      await openEditor(page);
      await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
      await expect(page.getByTestId('timeline-over-limit')).toBeVisible({ timeout: 60_000 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await audit(page, 'phone-timeline-over-limit', testInfo);
      // The open dialog's edge passes over the import notice's close button
      // on the page behind it, and axe's target-size rule counts the covered
      // part of that (44 px) button as small. The page behind a modal cannot
      // be used, so the notice is dismissed first; the dialog is what is
      // audited here.
      await page.getByRole('button', { name: tr['timeline.notice.dismiss'] }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId('open-export').click();
      await expect(page.getByTestId('export-over-limit')).toBeVisible({ timeout: 60_000 });
      await audit(page, 'phone-dialog-export-over-limit', testInfo);
    });
  });

  test.describe('tablet 820 px', () => {
    test.use({ viewport: { width: 820, height: 1100 } });

    test('both drawers', async ({ page }, testInfo) => {
      await withMoments(page);
      await audit(page, 'tablet', testInfo);
      await page.getByTestId('open-moments-drawer').click();
      await expect(page.getByRole('dialog', { name: tr['tabs.moments'] })).toBeVisible();
      await audit(page, 'tablet-drawer-moments', testInfo);
      await page.keyboard.press('Escape');
      await page.getByTestId('open-inspector-drawer').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'tablet-drawer-inspector', testInfo);
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
  test.describe.configure({ timeout: 120_000 });

  test('the core flow without a mouse, with visible focus at every stop', async ({ page }) => {
    await clearStorage(page);
    catchFileChoosers(page);
    const errors = await openEditor(page);
    const unmarked: string[] = [];

    // 1. Pick the video: the empty-state button opens the file chooser. The
    //    whole video arrives on the timeline as one piece (ADR-019).
    await tabTo(page, (stop) => stop.name.includes(tr['preview.pickVideo']), unmarked, 'Video seç');
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('moment-count')).toHaveText('1 parça');
    const ranges = page.getByTestId('moment-card').locator('.moment-range');

    // 2. Tab to the playhead on the timeline; Shift+Right is one second.
    //    S cuts the piece under it, twice.
    await tabTo(page, byTestId('timeline-playhead'), unmarked, 'the playhead');
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByTestId('current-time')).toHaveText('00:03.000');
    await page.keyboard.press('s');
    for (let i = 0; i < 7; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('s');
    await expect(ranges).toHaveText(['00:00.000 — 00:03.000', '00:03.000 — 00:10.000', '00:10.000 — 00:24.000']);
    await expect(page.getByTestId('timeline-playhead')).toBeFocused();

    // 3. Select the middle piece from the keyboard and delete it. Focus
    //    lands back on the playhead, not on the page body.
    await tabTo(page, (stop) => stop.name.startsWith('button "Parça 02'), unmarked, 'piece 02');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('strip-clip').nth(1)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(ranges).toHaveText(['00:00.000 — 00:03.000', '00:10.000 — 00:24.000']);
    await expect(page.getByTestId('timeline-notice')).toContainText('Parça 02 silindi');
    await expect(page.getByTestId('timeline-playhead')).toBeFocused();

    // 4. Trim the end of the first piece with its edge slider, then undo it.
    await tabTo(page, (stop) => stop.name.startsWith('button "Parça 01'), unmarked, 'piece 01');
    await page.keyboard.press('Enter');
    await tabTo(page, byTestId('trim-end'), unmarked, 'the end edge of piece 01');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(ranges.first()).toHaveText('00:00.000 — 00:02.000');
    await page.keyboard.press('Control+z');
    await expect(ranges.first()).toHaveText('00:00.000 — 00:03.000');

    // 5. Reorder: "move down" on the first card. Tab wraps round the page.
    const firstRange = ranges.first();
    await tabTo(page, byTestId('move-down'), unmarked, 'Arkaya al');
    await page.keyboard.press('Enter');
    await expect(firstRange).toHaveText('00:10.000 — 00:24.000');

    // 5. Export dialog: opens with focus inside, Escape closes, focus returns.
    await tabTo(page, byTestId('open-export'), unmarked, 'Videoyu indir');
    await page.keyboard.press('Enter');
    const exportDialog = page.getByRole('dialog', { name: tr['export.title'] });
    await expect(exportDialog).toBeVisible();
    expect((await focusStop(page)).inDialog).toBe(true);
    await page.keyboard.press('Escape');
    await expect(exportDialog).toHaveCount(0);
    expect((await focusStop(page)).testId).toBe('open-export');

    // 6. Help.
    await tabTo(page, byTestId('open-help'), unmarked, 'Kısayollar');
    await page.keyboard.press('Enter');
    const help = page.getByRole('dialog', { name: tr['help.title'] });
    await expect(help).toBeVisible();
    expect((await focusStop(page)).indicator).toBe(true);
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    expect((await focusStop(page)).testId).toBe('open-help');

    // 7. The secondary range flow: the source preview and the I / O
    //    shortcuts the help dialog promises.
    const sourceTab = page.getByRole('tab', { name: tr['preview.source'], exact: true });
    await tabTo(page, (stop) => stop.name.includes(tr['preview.output']), unmarked, 'the preview tabs');
    await page.keyboard.press('ArrowLeft');
    await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('play-toggle').focus();
    await page.getByLabel(tr['preview.seekLabel']).focus();
    await page.keyboard.press('End');
    await page.getByTestId('open-help').focus();
    await page.keyboard.press('o');
    await expect(page.getByTestId('range-end')).toHaveValue('00:24.000');

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

  test('desktop dialogs', async ({ page }) => {
    await clearStorage(page);
    catchFileChoosers(page);
    await withMoments(page);

    await trapAndReturn(page, page.getByTestId('open-help'), page.getByRole('dialog', { name: tr['help.title'] }));
    await trapAndReturn(page, page.getByTestId('open-export'), page.getByRole('dialog', { name: tr['export.title'] }));

    const silenceOpener = page.getByTestId('open-silence');
    const silence = page.getByRole('dialog', { name: tr['silence.title'] });
    await silenceOpener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('silence-running')).toHaveCount(0, { timeout: 30_000 });
    await expectTrapped(page, silence);
    await page.keyboard.press('Escape');
    await expect(silence).toHaveCount(0);
    expect(await silenceOpener.evaluate((node) => node === document.activeElement)).toBe(true);

    // The import dialog opens after the file chooser; focus goes back to the
    // "Altyazı dosyası seç" button that started it.
    await page.getByTestId('inspector-tab-captions').click();
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

  test.describe('phone sheets', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('every bottom sheet traps and returns focus', async ({ page }) => {
      await clearStorage(page);
      await withMoments(page);
      const sheets: Array<[string, string]> = [
        ['tab-moments', tr['tabs.moments']],
        ['tab-frame', tr['tabs.frame']],
        ['tab-audio', tr['tabs.audio']],
        ['tab-captions', tr['captions.tab']],
        ['tab-file', tr['tabs.file']],
      ];
      for (const [testId, name] of sheets) {
        await trapAndReturn(page, page.getByTestId(testId), page.getByRole('dialog', { name }));
      }
    });

    test('a focused control is never hidden under the sticky tool bar (WCAG 2.4.11)', async ({ page }) => {
      await clearStorage(page);
      await withMoments(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const hidden: string[] = [];
      for (let press = 0; press < 45; press += 1) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          const bar = document.querySelector('.mobile-tabbar');
          if (!element || !bar || bar.contains(element) || element === document.body) return null;
          const box = element.getBoundingClientRect();
          const barTop = bar.getBoundingClientRect().top;
          return box.bottom > barTop + 1 ? `${element.tagName} "${element.textContent?.trim().slice(0, 30)}"` : null;
        });
        if (stop) hidden.push(stop);
      }
      expect(hidden).toEqual([]);
    });
  });

  test.describe('tablet drawers', () => {
    test.use({ viewport: { width: 820, height: 1100 } });

    test('both drawers trap and return focus', async ({ page }) => {
      await clearStorage(page);
      await withMoments(page);
      await trapAndReturn(page, page.getByTestId('open-moments-drawer'), page.getByRole('dialog', { name: tr['tabs.moments'] }));
      await trapAndReturn(page, page.getByTestId('open-inspector-drawer'), page.getByRole('dialog'));
    });
  });
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
        expect(await horizontalOverflow(page), 'editor with moments').toBe(0);
        for (const testId of ['tab-moments', 'tab-captions', 'tab-file']) {
          await page.getByTestId(testId).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          expect(await horizontalOverflow(page), testId).toBe(0);
          const sheetOverflow = await page.evaluate(() => {
            const body = document.querySelector('.sheet-body');
            return body ? body.scrollWidth - body.clientWidth : 0;
          });
          expect(sheetOverflow, `${testId} sheet`).toBe(0);
          await page.keyboard.press('Escape');
        }
        // ADR-021: the limit line, its label and the over-limit sentence.
        await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
        await expect(page.getByTestId('timeline-over-limit')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('timeline-limit-label')).toBeVisible();
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
      '.moment-range',
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
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      expect(await clippedControls(page), 'landing').toEqual([]);

      await clearStorage(page);
      await withMoments(page);
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      if (viewport.width > 760) {
        await page.getByTestId('strip-clip').first().locator('.strip-clip-select').click();
      }
      expect(await clippedControls(page), 'editor').toEqual([]);
      expect(await horizontalOverflow(page), 'editor page width').toBe(0);

      await page.getByTestId('open-export').click();
      await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
      expect(await clippedControls(page), 'export dialog').toEqual([]);
    });

    test(`over the download limit, nothing clips at ${viewport.width} px (ADR-021)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openEditor(page);
      await page.getByTestId('video-input').setInputFiles(timelineFixture('ninety').file);
      await expect(page.getByTestId('timeline-over-limit')).toBeVisible({ timeout: 60_000 });
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      expect(await clippedControls(page), 'editor over the limit').toEqual([]);
      expect(await horizontalOverflow(page), 'editor page width').toBe(0);
      await page.getByTestId('open-export').click();
      await expect(page.getByTestId('export-over-limit')).toBeVisible({ timeout: 60_000 });
      expect(await clippedControls(page), 'export dialog over the limit').toEqual([]);
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

/** A finished one-second export, so the note under "Bilgisayara kaydet" shows. */
async function exportSucceeded(page: Page) {
  await openEditor(page);
  await importSample(page);
  await addMoment(page, '00:00.000', '00:01.000');
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-quality').selectOption('720');
  await expect(page.getByTestId('export-create')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('export-create').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
  await expect(page.getByTestId('export-save-space')).toBeVisible();
}

test.describe('a11y: HEVC hint and the save-space note', () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
  test.describe.configure({ timeout: 240_000 });

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
      await audit(page, `dialog-export-succeeded-${viewport.width}`, testInfo);
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      expect(await clippedControls(page), 'export succeeded').toEqual([]);
      expect(await horizontalOverflow(page), 'export succeeded page width').toBe(0);
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
      expect(await horizontalOverflow(page), 'export succeeded').toBe(0);
      const dialogOverflow = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? dialog.scrollWidth - dialog.clientWidth : 0;
      });
      expect(dialogOverflow, 'export dialog').toBe(0);
    });
  });
});

// ------------------------------------------------------ screen reader names

test.describe('a11y: names a screen reader hears', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('preview, transport, time readouts, trim handles, caption overlay', async ({ page }) => {
    await clearStorage(page);
    await withMoments(page);

    await expect(page.getByTestId('preview-video')).toHaveAccessibleName(tr['a11y.previewVideo']);
    const play = page.getByTestId('play-toggle');
    await expect(play).toHaveAccessibleName(tr['preview.play']);
    await expect(page.getByRole('slider', { name: tr['preview.seekLabel'] })).toBeVisible();

    // The readouts say what they are, not just "00:00.000".
    await expect(page.getByTestId('time-now')).toHaveText(new RegExp(`^${tr['a11y.timeNow']} \\d\\d:\\d\\d\\.\\d{3}$`));
    await expect(page.getByTestId('time-total')).toContainText(tr['a11y.timeTotal']);

    // Trim handles: sliders with a spoken Turkish value.
    await page.getByTestId('strip-clip').first().locator('.strip-clip-select').click();
    const start = page.getByRole('slider', { name: 'Parça 01 başlangıcı' });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('aria-valuetext', /saniye/);

    // The one playhead is a named slider with a spoken value.
    const playhead = page.getByRole('slider', { name: tr['timeline.playhead'] });
    await expect(playhead).toBeVisible();
    await expect(playhead).toHaveAttribute('aria-valuetext', /saniye, toplam 4 saniye$/);
    await expect(playhead).toHaveAttribute('aria-describedby', 'timeline-hint');

    // The caption overlay is pixels; the words are in the caption panel.
    await page.getByRole('tab', { name: tr['preview.output'] }).click();
    await expect(page.getByTestId('caption-overlay')).toHaveAttribute('aria-hidden', 'true');

    // Result mode and source mode are a real tab pair, reachable with arrows.
    const sourceTab = page.getByRole('tab', { name: tr['preview.source'], exact: true });
    const outputTab = page.getByRole('tab', { name: tr['preview.output'] });
    await expect(outputTab).toHaveAttribute('aria-selected', 'true');
    await outputTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
    await expect(sourceTab).toBeFocused();
  });
});
