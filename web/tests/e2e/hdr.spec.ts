import { expect, test } from '@playwright/test';

import { hdrFixture } from './hdr-media';

/**
 * ADR-022: an HDR (PQ) source is exported as SDR through the browser's own
 * conversion plus the highlight soft clip, and only after the runtime check
 * of that path passed in THIS browser. The dialog says so, in words.
 * Colour accuracy itself is measured by the matrix (M10-hdr), not here.
 */
test('an HDR video exports as SDR after the tone-mapping check, with the HDR note', async ({ page }) => {
  const file = hdrFixture();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('strip-clip')).toHaveCount(1);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-quality').selectOption('720');
  await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });

  // The check ran and passed, and the user is told the file will be SDR.
  await expect(page.getByTestId('gate-hdr')).toBeVisible();
  await expect(page.getByTestId('gate-hdr')).toContainText(/geçti|passed/);
  await expect(page.getByTestId('export-hdr-note')).toContainText('Bu video HDR');
  await expect(page.getByTestId('export-hdr-note')).toContainText('SDR');

  await page.getByTestId('export-create').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
  await expect(page.getByTestId('measured-codecs')).toContainText('avc');
  await expect(page.getByTestId('measured-codecs')).toContainText('aac');
  // ADR-027: HDR pictures are never copied; the dialog says the file was encoded and why.
  await expect(page.getByTestId('measured-method')).toHaveAttribute('data-method', 'encode');
  await expect(page.getByTestId('measured-method')).toHaveAttribute('data-fallback', 'hdr');
  expect(errors).toEqual([]);
});
