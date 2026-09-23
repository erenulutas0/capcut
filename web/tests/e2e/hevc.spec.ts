import { expect, test } from '@playwright/test';

import { tr } from '../../src/i18n/messages';
import { browserDecodesHevc, hevcFixture } from './hevc-media';

/**
 * ADR-022: Edge and Playwright's Chromium on Windows have no HEVC decoder, so
 * an HEVC phone video cannot be opened there. The import error keeps its
 * reason and adds a hint: the Microsoft Store extension may be needed in Edge,
 * or Chrome can be tried. Shown only when the file is HEVC AND the browser
 * reports no decoder; never for other failures.
 */
test.describe('import: HEVC without a decoder', () => {
  test('the refusal names the file, keeps its reason and adds the HEVC hint', async ({ page }) => {
    const file = hevcFixture();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/editor');
    await expect(page.getByTestId('open-export')).toBeVisible();
    test.skip(
      await browserDecodesHevc(page),
      'This browser decodes HEVC: the file opens and there is nothing to hint.',
    );

    await page.getByTestId('video-input').setInputFiles(file);
    const error = page.getByTestId('media-error');
    await expect(error).toBeVisible({ timeout: 60_000 });
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText(
      '“telefon-hevc.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı.',
    );
    const hint = page.getByTestId('media-error-hint');
    await expect(hint).toHaveText(tr['error.hint.hevc_decoder_missing']);
    // A suggestion in plain text: no link out, no promise.
    await expect(error.locator('a')).toHaveCount(0);
    await expect(hint).toContainText('gerekebilir');
    await expect(page.getByTestId('preview-video')).toHaveCount(0);

    // Closing the message closes the hint with it.
    await page.getByTestId('media-error-dismiss').click();
    await expect(error).toHaveCount(0);
    await expect(hint).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a file that is not HEVC gets no HEVC hint', async ({ page }) => {
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles({
      name: 'bozuk.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('not a real mp4'),
    });
    await expect(page.getByTestId('media-error')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('media-error-hint')).toHaveCount(0);
  });
});
