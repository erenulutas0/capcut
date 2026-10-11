import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { SCRIPT_WORDS, openChoice, openReady, startFake, type FakeWorker } from './cloudKit';

/**
 * Pictures of the cloud route for the design record
 * (docs/ux/2026-10-11-cloud-consent/shots), from the running app against the
 * LOCAL FAKE of our proxy. Not a test of anything: it runs only when asked,
 *
 *   $env:CLOUD_SHOTS='1'; npx playwright test -c playwright.cloud.config.ts cloud-shots
 */

test.skip(process.env.CLOUD_SHOTS !== '1', 'pictures for the design record: set CLOUD_SHOTS=1');

const SHOTS = join(process.cwd(), '..', 'docs', 'ux', '2026-10-11-cloud-consent', 'shots');
const SIZES = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  mkdirSync(SHOTS, { recursive: true });
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

const snap = (page: Page, name: string, size: string) => page.screenshot({ path: join(SHOTS, `${name}-${size}.png`), fullPage: true });

for (const size of SIZES) {
  test.describe(`${size.name} px`, () => {
    test.use({ viewport: size.viewport });

    test('the choice, the run, the result', async ({ page }) => {
      test.setTimeout(240_000);
      const invite = fake.newInvite(60);
      fake.provider({ words: SCRIPT_WORDS, holdUpload: true, pollsUntilDone: 500, languageCode: 'tr' });
      await openChoice(page);
      await snap(page, '01-secim-kodsuz', size.name);
      await page.getByTestId('invite-code').fill(invite);
      await page.getByTestId('invite-save').click();
      await expect(page.getByTestId('route-online-go')).toBeVisible();
      await page.mouse.move(1, 1);
      await snap(page, '02-secim', size.name);

      await page.getByTestId('route-online-go').click();
      await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'uploading', { timeout: 60_000 });
      await snap(page, '03-gonderiliyor', size.name);
      fake.releaseUpload();
      await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'writing', { timeout: 30_000 });
      await expect(page.getByTestId('cloud-elapsed')).toBeVisible();
      await snap(page, '04-yaziliyor', size.name);
      fake.provider({ pollsUntilDone: 0 });
      await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('yazi-cloud-summary')).toContainText('dakikan kaldı');
      await snap(page, '05-sonuc', size.name);
    });

    test('a failure, and the privacy page', async ({ page }) => {
      test.setTimeout(120_000);
      const invite = fake.newInvite(60);
      fake.provider({ pollsUntilDone: 0, transcriptError: 'x' });
      await openReady(page, invite);
      await page.getByTestId('route-online-go').click();
      await expect(page.getByTestId('cloud-notice')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('route-online-go')).toBeVisible();
      await page.mouse.move(1, 1);
      await snap(page, '06-olmadi', size.name);
      await page.goto('/gizlilik/');
      await page.getByTestId('privacy-cloud').scrollIntoViewIfNeeded();
      await page.getByTestId('privacy-cloud').screenshot({ path: join(SHOTS, `07-gizlilik-bulut-${size.name}.png`) });
    });
  });
}
