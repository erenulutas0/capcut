import { expect, test } from '@playwright/test';

import { installSavePicker, probeMp4, readSaved } from '../e2e/kesitFlow';
import { SCRIPT_WORDS, enterInvite, openChoice, startFake, type FakeWorker } from './cloudKit';

/**
 * The transcript written on the internet is an ordinary caption track: the
 * wizard's own "Altyazılı videoyu indir" must burn it in like an on-device one.
 */

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

for (const languageCode of ['tr', 'en_us'] as const) {
  test(`a transcript written on the internet (${languageCode}) is burned into the download`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await installSavePicker(page);
    const invite = fake.newInvite(60);
    fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode });

    await openChoice(page);
    await enterInvite(page, invite);
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });

    await expect(page.getByTestId('wizard-download')).toHaveText('Altyazılı videoyu indir');
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved'), errors.join('\n')).toBeVisible({ timeout: 180_000 });
    const name = (await page.getByTestId('download-saved').innerText()).replace(/^Kaydedildi: /, '');
    const probe = probeMp4(await readSaved(page, testInfo, name));
    expect(probe.videoCodec).toBe('h264');
    expect(errors).toEqual([]);
  });
}
