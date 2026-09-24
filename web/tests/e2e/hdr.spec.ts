import { expect, test } from '@playwright/test';

import { hdrFixture } from './hdr-media';
import { closeSheet, openSettings, installSavePicker } from './kesitFlow';

/**
 * ADR-022: an HDR (PQ) source is exported as SDR through the browser's own
 * conversion plus the highlight soft clip, and only after the runtime check
 * of that path passed in THIS browser. The result says so, in words.
 * Colour accuracy itself is measured by the matrix (M10-hdr), not here.
 */
test('an HDR video exports as SDR after the tone-mapping check, with the HDR note', async ({ page }) => {
  const file = hdrFixture();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installSavePicker(page);
  await page.goto('/editor');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await openSettings(page, 'frame');
  await page.getByTestId('export-quality').selectOption('720');
  await closeSheet(page);

  // The whole video: the gate (with its HDR check) runs, then the encode.
  // Without a verified conversion the download would be blocked instead.
  await page.getByTestId('download-all').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
  await expect(page.getByTestId('export-blocked')).toHaveCount(0);
  // The user is told the file is SDR.
  await expect(page.getByTestId('export-hdr-note')).toContainText('Bu video HDR');
  await expect(page.getByTestId('export-hdr-note')).toContainText('SDR');
  await expect(page.getByTestId('measured-codecs')).toContainText('avc');
  await expect(page.getByTestId('measured-codecs')).toContainText('aac');
  expect(errors).toEqual([]);
});
