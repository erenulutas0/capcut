import { expect, test, type Page } from './fixtures';

import { ORDINARY_BITRATE_MODE } from '../../src/domain/encoderBitrate';
import { fastCutFixture } from './fastcut-media';
import { addKesit, closeSheet, installSavePicker, openEditor, openSettings, openVideo } from './kesitFlow';

/**
 * ADR-045: the rate control of a re-encoded download. The result's method
 * line carries what the encoder was really configured with
 * (`data-bitrate-mode`), what was asked for (`data-bitrate-mode-asked`) and
 * the bitrate (`data-video-bitrate`). Playwright's Chromium has no hardware
 * H.264 encoder (ADR-024): its downloads follow the software row of
 * `ORDINARY_BITRATE_MODE`.
 */

async function openFixture(page: Page, init?: () => void): Promise<string[]> {
  if (init) await page.addInitScript(init);
  await installSavePicker(page);
  const errors = await openEditor(page);
  await openVideo(page, fastCutFixture());
  await addKesit(page, '00:01.000', '00:03.000');
  // A zoomed picture is always encoded (never a copy).
  await openSettings(page, 'frame');
  await page.getByTestId('zoom-slider').fill('150');
  await page.getByTestId('export-quality').selectOption('720');
  await closeSheet(page);
  return errors;
}

async function download(page: Page) {
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
  return page.getByTestId('export-method');
}

test.describe('bitrate mode of a re-encoded download (ADR-045)', () => {
  test.setTimeout(240_000);

  test("an ordinary download uses the app's mode for this encoder and says so", async ({ page }) => {
    const errors = await openFixture(page);
    const method = await download(page);
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-bitrate-mode', ORDINARY_BITRATE_MODE.software);
    await expect(method).toHaveAttribute('data-bitrate-mode-asked', ORDINARY_BITRATE_MODE.software);
    await expect(method).toHaveAttribute('data-video-bitrate', /^[1-9]\d{5,7}$/);
    expect(errors).toEqual([]);
  });

  for (const mode of ['constant', 'variable'] as const) {
    test(`the measurement hook asks for ${mode}, and the encoder is configured so`, async ({ page }) => {
      const errors = await openFixture(page, mode === 'constant'
        ? () => {
            (window as unknown as { __clipBitrateMode: string }).__clipBitrateMode = 'constant';
          }
        : () => {
            (window as unknown as { __clipBitrateMode: string }).__clipBitrateMode = 'variable';
          });
      const method = await download(page);
      await expect(method).toHaveAttribute('data-bitrate-mode', mode);
      await expect(method).toHaveAttribute('data-bitrate-mode-asked', mode);
      expect(errors).toEqual([]);
    });
  }

  test('a browser that refuses constant rate control still downloads, in variable, and the result says what was asked', async ({ page }) => {
    const errors = await openFixture(page, () => {
      const holder = window as unknown as { __clipBitrateMode: string; __clipRefuseConstantBitrate: boolean };
      holder.__clipBitrateMode = 'constant';
      holder.__clipRefuseConstantBitrate = true;
    });
    const method = await download(page);
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-bitrate-mode-asked', 'constant');
    await expect(method).toHaveAttribute('data-bitrate-mode', 'variable');
    await expect(page.getByTestId('export-failed')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a target-size download asks for constant (ADR-035), whatever the ordinary mode is', async ({ page }) => {
    const errors = await openFixture(page, () => {
      (window as unknown as { __clipExportOptions: unknown }).__clipExportOptions = { targetSize: { targetBytes: 2_000_000 } };
      // The ordinary-download hook does not reach a target-size download.
      (window as unknown as { __clipBitrateMode: string }).__clipBitrateMode = 'variable';
    });
    const method = await download(page);
    await expect(page.getByTestId('target-size-result')).toBeVisible();
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-bitrate-mode', 'constant');
    await expect(method).toHaveAttribute('data-bitrate-mode-asked', 'constant');
    expect(errors).toEqual([]);
  });

  test('a copy reports no rate control (nothing was encoded)', async ({ page }) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, fastCutFixture());
    await addKesit(page, '00:02.000', '00:04.000');
    await openSettings(page, 'frame');
    await page.getByTestId('export-quality').selectOption('720');
    await closeSheet(page);
    const method = await download(page);
    await expect(method).toHaveAttribute('data-method', 'copy');
    await expect(method).toHaveAttribute('data-bitrate-mode', '');
    expect(errors).toEqual([]);
  });
});
