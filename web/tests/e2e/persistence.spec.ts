import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { startWithEmptyTimeline } from './rangeFlow';

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const OTHER_VIDEO = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');
const SAMPLE_AUDIO = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');

async function openEditor(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  return errors;
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

/** Builds a two-moment project and waits until it is really on disk. */
async function buildAndSave(page: Page) {
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await startWithEmptyTimeline(page);
  await addMoment(page, '00:00.000', '00:04.000');
  await addMoment(page, '00:08.000', '00:14.000');
  await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });
}

test.describe('local persistence', () => {
  // Each test gets its own storage so a leftover project cannot leak across.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
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
  });

  test('says "saved" only after the write, and explains it is browser storage', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('save-state')).toContainText('Henüz kaydedilmedi');

    await buildAndSave(page);

    const badge = page.getByTestId('save-state');
    await expect(badge).toContainText('Kaydedildi');
    // The tooltip must not let anyone believe this is a cloud backup.
    const hint = await badge.getAttribute('title');
    expect(hint).toContain('bulut yedeği değildir');
    expect(hint).toContain('Video dosyaların hiçbir zaman kaydedilmez');
  });

  test('the recipe survives a reload and asks for the file back', async ({ page }) => {
    const errors = await openEditor(page);
    await buildAndSave(page);

    await page.reload();

    // The recipe came back. The preview stage is replaced by the re-link
    // prompt, so the total is read from the output strip, which is always there.
    await expect(page.getByTestId('moment-count')).toHaveText('2 parça', { timeout: 20_000 });
    await expect(page.getByTestId('output-summary')).toContainText('10.0 sn');

    // ...and the editor asks for exactly the file it is missing.
    await expect(page.getByTestId('relink-video')).toBeVisible();
    await expect(page.getByTestId('relink-filename')).toHaveText('sample-24s.mp4');
    await expect(page.getByTestId('preview-video')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('re-linking the same file restores playback and export (M14)', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('relink-video-input').setInputFiles(SAMPLE_VIDEO);

    // The file is recognised, the moments are untouched, the preview is back.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('relink-video')).toHaveCount(0);
    await expect(page.getByTestId('moment-count')).toHaveText('2 parça');
    await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');
    await expect(page.getByTestId('output-summary')).toContainText('10.0 sn');

    // And the restored project can actually be exported.
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption('720');
    await page.getByTestId('export-ready').waitFor({ timeout: 90_000 });
    await page.getByTestId('export-create').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
    await expect(page.getByTestId('measured-duration')).toContainText(/^00:1[01]\./);
  });

  test('a different file is refused rather than silently re-pointed', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);

    await expect(page.getByTestId('relink-mismatch')).toBeVisible({ timeout: 30_000 });
    // Nothing has been changed yet: the moments and the prompt are still there.
    await expect(page.getByTestId('moment-count')).toHaveText('2 parça');
    await expect(page.getByTestId('preview-video')).toHaveCount(0);
  });

  test('accepting a different file starts a new source and says so', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('relink-mismatch')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('relink-use-as-new').click();

    // The ranges belonged to the old footage, so they are gone — as warned.
    // Like any newly opened video (ADR-019), the new file is one whole piece.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('moment-count')).toHaveText('1 parça');
    await expect(page.getByTestId('moment-card').locator('.moment-range')).toHaveText([
      '00:00.000 — 00:08.000',
    ]);
    await expect(page.getByTestId('total-time')).toHaveText('00:08.000');
  });

  test('music is re-linked separately and keeps its settings', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await startWithEmptyTimeline(page);
    await addMoment(page, '00:00.000', '00:06.000');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await page.getByRole('tab', { name: 'Ses' }).click();
    await expect(page.getByTestId('music-in')).toBeVisible();
    await page.getByTestId('music-out').fill('00:05.000');
    await page.getByTestId('music-out').blur();
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });

    await page.reload();
    await page.getByTestId('relink-video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('tab', { name: 'Ses' }).click();
    await expect(page.getByTestId('relink-audio')).toBeVisible();
    await page.getByTestId('relink-audio-input').setInputFiles(SAMPLE_AUDIO);

    await expect(page.getByTestId('music-file-name')).toHaveText('tone-30s.m4a', { timeout: 30_000 });
    // The edited segment survived the round trip.
    await expect(page.getByTestId('music-out')).toHaveValue('00:05.000');
  });

  test('export is blocked with the right reason while the source is missing', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('export-blocked')).toContainText('video dosyası bu sekmede açık değil');
    await expect(page.getByTestId('export-create')).toBeDisabled();
  });

  test('deleting the saved project clears it and keeps the app usable', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('relink-discard').click();

    await expect(page.getByTestId('moment-count')).toHaveText('0 parça', { timeout: 30_000 });
    await expect(page.getByTestId('relink-video')).toHaveCount(0);

    // A fresh project can be started right away.
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
  });
});

test.describe('storage failures are shown, not hidden', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a browser that refuses IndexedDB still works and says saving failed', async ({ page }) => {
    // Fault injection: behave like a private window that denies storage.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    });

    const errors = await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await startWithEmptyTimeline(page);
    await addMoment(page, '00:00.000', '00:04.000');

    // The editor keeps working...
    await expect(page.getByTestId('moment-count')).toHaveText('1 parça');
    // ...and it does not claim the work is saved.
    await expect(page.getByTestId('save-state')).toContainText('Kaydedilemedi', { timeout: 15_000 });
    await expect(page.getByTestId('save-state')).not.toContainText('Kaydedildi ·');
    // A recovery route is offered.
    await expect(page.getByTestId('save-recover')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the backup file carries the recipe and no media', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await startWithEmptyTimeline(page);
    await addMoment(page, '00:00.000', '00:04.000');

    await page.getByTestId('tab-file').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.clip\.json$/);

    const stream = await saved.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const record = JSON.parse(text);

    expect(record.recordVersion).toBe(1);
    expect(record.edl.clips).toHaveLength(1);
    expect(record.bindings[0].fileName).toBe('sample-24s.mp4');
    // The recipe travels; the video does not.
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('data:video');
    expect(text.length).toBeLessThan(20_000);
  });
});
