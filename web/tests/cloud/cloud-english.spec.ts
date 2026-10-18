import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '../e2e/fixtures';

import { expectStylesApplied } from '../e2e/stylesReady';
import { cloudEn } from '../../src/i18n/cloudMessages.en';
import { cloudTr } from '../../src/i18n/cloudMessages';
import { en } from '../../src/i18n/messages.en';
import { SAMPLE, fill, seedInvite, startFake, type FakeWorker } from './cloudKit';

/**
 * The cloud transcript route (ADR-039) for an English reader (ADR-048): the consent screen says the
 * same four facts as the Turkish one, with the same weight, and nothing it cannot show to be true; the
 * route works end to end in English. Against the LOCAL FAKE of our proxy.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
/** English words the screen must not use: nothing here can show them to be true (ADR-039 "Rıza ekranı"). */
const UNPROVABLE = /secure|encrypted|anonymous|nobody (?:listens|hears)|never used (?:for|to) train|not used (?:for|to) train|private|100\s?%|guarantee/i;

const plainEn = (key: keyof typeof cloudEn): string => cloudEn[key].split('**').join('');

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());
test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });

async function openEnglishChoice(page: Page, invite: string) {
  await seedInvite(page, invite);
  await page.goto('/yap/yazi/');
  // The English browser is put on the English wizard.
  await expect(page).toHaveURL(/\/en\/yap\/yazi\/?$/);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('route-online-go')).toBeVisible({ timeout: 30_000 });
}

test('the choice screen in English: the same two cards, the same four facts, nothing we cannot show to be true', async ({ page }, testInfo) => {
  const invite = fake.newInvite(60);
  await openEnglishChoice(page, invite);
  await expect(page.getByTestId('wizard-title')).toHaveText(cloudEn['cloud.choice.title']);
  await expect(page.getByTestId('route-device').getByRole('heading', { level: 2 })).toHaveText('On my device');
  await expect(page.getByTestId('route-online').getByRole('heading', { level: 2 })).toHaveText('On the internet');
  await expect(page.getByTestId('route-device-go')).toHaveText(cloudEn['cloud.device.go']);
  await expect(page.getByTestId('route-online-go')).toHaveText('Send the sound and write');
  await expect(page.getByTestId('route-facts').locator('li')).toHaveText([
    plainEn('cloud.online.fact.sound'),
    plainEn('cloud.online.fact.who'),
    plainEn('cloud.online.fact.deleted'),
    plainEn('cloud.online.fact.others'),
  ]);
  // The same words in bold as on the Turkish screen: four, one per fact.
  await expect(page.getByTestId('route-facts').locator('strong')).toHaveText(['Only the sound', 'AssemblyAI', 'deleted', 'their voices are sent too']);
  expect(cloudTr['cloud.online.fact.who']).toContain('**AssemblyAI**');
  await expect(page.getByTestId('route-minutes')).toHaveText(fill(cloudEn['cloud.online.minutes'], { n: 1, x: 1, y: 59 }));
  // The privacy page in English, in a new tab.
  await expect(page.getByTestId('route-privacy')).toHaveAttribute('href', /\/gizlilik\/en\/?$/);
  await expect(page.getByTestId('route-privacy')).toHaveAttribute('target', '_blank');
  const words = await page.getByTestId('route-choice').innerText();
  expect(words).not.toMatch(UNPROVABLE);
  expect(words).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
  // The two ways weigh the same in English too.
  const device = await page.getByTestId('route-device-go').boundingBox();
  const online = await page.getByTestId('route-online-go').boundingBox();
  expect(Math.round(device?.width ?? 0)).toBe(Math.round(online?.width ?? -1));
  expect(Math.round(device?.height ?? 0)).toBe(Math.round(online?.height ?? -1));
  await expectStylesApplied(page, 'cloud-choice-en', testInfo);
  const audit = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(audit.violations.map((violation) => violation.id)).toEqual([]);
});

test('the English route end to end: only the sound goes, the text comes back, the summary is English', async ({ page }) => {
  const invite = fake.newInvite(60);
  await openEnglishChoice(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('yazi-cloud-summary')).toContainText(fill(cloudEn['cloud.done'], { lines: 4 }));
  await expect(page.getByTestId('yazi-cloud-summary')).toContainText(fill(cloudEn['cloud.done.minutes'], { y: 59 }));
  await expect(page.getByTestId('wizard-footer')).toHaveText(cloudEn['cloud.footer.sent']);
  // The speakers are named the English way.
  await expect(page.getByTestId('transcript-panel')).toContainText(en['transcript.speaker'].replace('{n}', '1'));
});

test('the English privacy page has the route’s section in English', async ({ page }) => {
  await page.goto('/gizlilik/en');
  await expect(page.getByTestId('privacy-cloud').getByRole('heading', { level: 2 })).toHaveText(cloudEn['cloud.privacy.title']);
  await expect(page.getByTestId('privacy-cloud')).toContainText(cloudEn['cloud.privacy.region']);
  await expect(page.getByTestId('privacy-cloud')).toContainText(cloudEn['cloud.privacy.training']);
  expect(await page.getByTestId('privacy-cloud').innerText()).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
});
