import { join } from 'node:path';
import { expect, test, type Page } from '../e2e/fixtures';

import { addKesit, installSavePicker, openEditor, openVideo } from '../e2e/kesitFlow';
import { storedRecord, storedShape } from '../e2e/projectStore';
import { STUB_LINES, STUB_SCRIPT, installTranscriptTest, serveModels, testModels } from '../e2e/transcriptKit';
import { cloudEn } from '../../src/i18n/cloudMessages.en';
import { tr } from '../../src/i18n/messages';
import { SAMPLE, SCRIPT_LINES, SCRIPT_WORDS, ct, fill, lineTexts, openReady, startFake, type FakeWorker } from './cloudKit';

/**
 * A transcript written on the internet is KEPT when the editor is opened
 * over it (ADR-034, addendum of 13 Oct 2026) — against the LOCAL FAKE of our
 * proxy (cloudKit.ts). Before that, the result screen says it is not stored.
 *
 * The rule, the sentence and the question are the wizard's own and in every
 * build (`tests/e2e/transcript-keep.spec.ts` walks them with the on-device
 * stand-in); what this suite adds is the internet route: who spoke survives
 * the store, and the on-device route of THIS build keeps the text too
 * without a word to the proxy.
 *
 * The fake hears nothing; nothing here says how well speech is written.
 */

const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');
const TURNS = ['1. kişi', '2. kişi', '1. kişi', '2. kişi'];

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

const TRANSCRIPT_SHAPE = {
  video: 'sample-24s.mp4',
  clips: 0,
  lines: SCRIPT_LINES.map((line, index) => [line, index % 2 === 0 ? 1 : 2]),
};

const pathOf = (page: Page) => new URL(page.url()).pathname.replace(/\/$/, '');

/** A cloud transcript on the wizard's result screen. */
async function writeOnline(page: Page): Promise<void> {
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode: 'tr' });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => lineTexts(page)).toEqual(SCRIPT_LINES);
}

/** A project the user made earlier in `/editor`: another video with one kesit, really in the store. */
async function earlierProject(page: Page, withKesit = true): Promise<void> {
  await openEditor(page);
  await openVideo(page, OTHER);
  if (withKesit) {
    await addKesit(page, '00:01.000', '00:03.000');
    await expect.poll(async () => (await storedShape(page))?.clips ?? 0, { timeout: 15_000 }).toBe(1);
  } else {
    await expect.poll(async () => (await storedShape(page))?.video ?? null, { timeout: 15_000 }).toBe('other-8s.mp4');
  }
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
}

const EARLIER_SHAPE = { video: 'other-8s.mp4', clips: 1, lines: [] };

/** After a reload at `/editor`: the stored project asks for `fileName`; with the file back, its "Yazı" panel. */
async function relinkAndOpenText(page: Page): Promise<void> {
  await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('relink-filename')).toHaveText('sample-24s.mp4');
  await page.getByTestId('relink-video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('side-tab-yazi').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible();
}

test('opened in the editor, the transcript is the stored project: a reload brings it back with who spoke', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await writeOnline(page);

  // ---- before the hand-over: said plainly, and true — nothing is in the store
  await expect(page.getByTestId('yazi-keep-note')).toHaveText(tr['wizard.yazi.keepNote']);
  expect(await storedRecord(page)).toBeNull();

  // ---- the hand-over: no question (nothing was stored), the editor, and its usual "saved" words
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('keep-choice')).toHaveCount(0);
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
  await expect(page.getByTestId('save-state-off')).toHaveCount(0);
  expect(await storedShape(page)).toEqual(TRANSCRIPT_SHAPE);
  expect((await storedRecord(page))?.edl.schemaVersion).toBe(6);
  // The same video is still open: no second file dialog.
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('relink-video')).toHaveCount(0);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);
  // The address is the editor's: that is where the stored project lives.
  expect(pathOf(page)).toBe('/editor');

  // ---- reload: the editor, the same project, asking for its video (a browser cannot keep the file)
  await page.reload();
  await relinkAndOpenText(page);
  await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(SCRIPT_LINES);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı');

  // ---- coming back later, from the opening screen
  await page.goto('/');
  await page.getByTestId('home-editor-link').click();
  await relinkAndOpenText(page);
  await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(SCRIPT_LINES);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);

  // An edit after that is saved with the voice still on the line.
  await page.getByTestId('transcript-edit').nth(1).click();
  await page.getByTestId('transcript-field').fill('Çok iyi, ben de izliyorum.');
  await page.getByTestId('transcript-save').click();
  await expect
    .poll(async () => (await storedShape(page))?.lines[1], { timeout: 15_000 })
    .toEqual(['Çok iyi, ben de izliyorum.', 2]);
  expect(errors).toEqual([]);
});

test('never opening the editor stores nothing: the wizard alone is as it was', async ({ page }) => {
  test.setTimeout(180_000);
  await writeOnline(page);
  await expect(page.getByTestId('yazi-keep-note')).toBeVisible();
  // A file is saved, a line is fixed, time passes: still nothing in the store.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('transcript-save-txt').click()]);
  expect(download.suggestedFilename()).toMatch(/\.txt$/);
  await page.getByTestId('transcript-edit').nth(0).click();
  await page.getByTestId('transcript-field').fill('Merhaba!');
  await page.getByTestId('transcript-save').click();
  await page.waitForTimeout(1500);
  expect(await storedRecord(page)).toBeNull();
  expect(pathOf(page)).toBe('/yap/yazi');

  // The reload loses it, as the sentence said; the editor has nothing either.
  await page.reload();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  expect(await storedRecord(page)).toBeNull();
  await page.goto('/editor');
  await expect(page.getByTestId('download-all')).toBeVisible();
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme henüz saklanmadı');
  await expect(page.getByTestId('relink-video')).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(await storedRecord(page)).toBeNull();
});

test('after "Altyazılı videoyu indir" the sentence still stands above the editor link, and the editor still keeps the text', async ({ page }) => {
  test.setTimeout(300_000);
  await installSavePicker(page);
  await writeOnline(page);
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
  // A video was saved; the text itself is still only in this page.
  await expect(page.getByTestId('wizard-editor-note')).toHaveText(tr['wizard.yazi.keepNote']);
  await expect(page.getByTestId('wizard-open-editor')).toBeVisible();
  expect(await storedRecord(page)).toBeNull();

  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
  await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual(TRANSCRIPT_SHAPE);
});

test.describe('a project is already stored', () => {
  test('nothing is replaced until the user chooses; "Vazgeç" changes nothing', async ({ page }) => {
    test.setTimeout(240_000);
    await earlierProject(page);
    await writeOnline(page);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);

    await page.getByTestId('wizard-open-editor').click();
    const choice = page.getByRole('dialog');
    await expect(choice).toBeVisible({ timeout: 30_000 });
    await expect(choice.getByRole('heading', { level: 2 })).toHaveText(tr['wizard.yazi.keep.title']);
    await expect(page.getByTestId('keep-choice-name')).toHaveText(fill(tr['wizard.yazi.keep.named'], { name: 'other-8s.mp4' }));
    await expect(page.getByTestId('keep-choice')).toContainText(tr['wizard.yazi.keep.body']);
    await expect(page.getByTestId('keep-old')).toHaveText(tr['wizard.yazi.keep.old']);
    await expect(page.getByTestId('keep-new')).toHaveText(tr['wizard.yazi.keep.new']);
    await expect(page.getByTestId('keep-choice')).toContainText(tr['wizard.yazi.keep.hint']);
    // The question is on screen and nothing has been done yet.
    await page.waitForTimeout(1200);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
    await expect(page.getByTestId('download-all')).toHaveCount(0);

    // Escape, and the close button: back on the result screen, the transcript still there, the store as it was.
    await page.keyboard.press('Escape');
    await expect(choice).toHaveCount(0);
    await expect(page.getByTestId('wizard')).toBeVisible();
    await expect.poll(() => lineTexts(page)).toEqual(SCRIPT_LINES);
    await page.getByTestId('wizard-open-editor').click();
    await expect(choice).toBeVisible();
    await page.getByTestId('keep-cancel').click();
    await expect(choice).toHaveCount(0);
    await expect(page.getByTestId('yazi-keep-note')).toHaveText(tr['wizard.yazi.keepNote']);
    await page.waitForTimeout(800);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
    expect(pathOf(page)).toBe('/yap/yazi');
  });

  test('"Eski proje kalsın": the editor opens unsaved and says so; the earlier project is untouched', async ({ page }) => {
    test.setTimeout(240_000);
    await earlierProject(page);
    await writeOnline(page);
    await page.getByTestId('wizard-open-editor').click();
    await page.getByTestId('keep-old').click();

    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);
    await expect(page.getByTestId('save-state-off')).toHaveText('Bu düzenleme saklanmıyor');
    await expect(page.getByTestId('save-state')).toHaveCount(0);
    // Work goes on in this editor; none of it reaches the store.
    await page.getByTestId('transcript-check').nth(1).click();
    await page.getByTestId('transcript-make-kesit').click();
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (1)');
    await page.waitForTimeout(1500);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
    expect(pathOf(page)).toBe('/yap/yazi');

    // The earlier project is what the editor opens.
    await page.goto('/editor');
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText('other-8s.mp4');
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
  });

  test('"Bu yazı saklansın": the transcript takes the earlier project\'s place, and a reload shows it', async ({ page }) => {
    test.setTimeout(240_000);
    await earlierProject(page);
    await writeOnline(page);
    await page.getByTestId('wizard-open-editor').click();
    await page.getByTestId('keep-new').click();

    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
    // What is on screen is the transcript's project, not the earlier one loaded over it.
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => lineTexts(page)).toEqual(SCRIPT_LINES);
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (0)');
    await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual(TRANSCRIPT_SHAPE);
    expect(pathOf(page)).toBe('/editor');

    await page.reload();
    await relinkAndOpenText(page);
    await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(SCRIPT_LINES);
    await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);
  });

  test('a video that was only opened in the editor is not work: no question, the transcript is stored', async ({ page }) => {
    test.setTimeout(240_000);
    await earlierProject(page, false);
    await writeOnline(page);
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
    await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual(TRANSCRIPT_SHAPE);
  });
});

test('deleting the kept transcript removes it, and it does not come back', async ({ page }) => {
  test.setTimeout(240_000);
  await writeOnline(page);
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 30_000 });
  await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual(TRANSCRIPT_SHAPE);

  await page.reload();
  await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('relink-discard').click();

  // The editor is empty, says so, and the store has nothing — now, and after the debounce and another reload.
  await expect(page.getByTestId('relink-video')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme henüz saklanmadı');
  await expect(page.getByTestId('side-tab-yazi')).toHaveCount(0);
  expect(await storedRecord(page)).toBeNull();
  await page.waitForTimeout(1500);
  expect(await storedRecord(page)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('download-all')).toBeVisible();
  await expect(page.getByTestId('relink-video')).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(await storedRecord(page)).toBeNull();
  // The wizard does not bring it back either.
  await page.goto('/yap/yazi/');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  expect(await storedRecord(page)).toBeNull();
});

test('a store that cannot be used: the editor opens and its header says the work is not stored', async ({ page }) => {
  test.setTimeout(240_000);
  await writeOnline(page);
  // From here on the browser refuses IndexedDB (as some private windows do).
  await page.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklanamadı', { timeout: 15_000 });
  await expect(page.getByTestId('save-state')).not.toContainText('Düzenleme saklandı');
  // The way to keep it anyway is offered right there.
  await expect(page.getByTestId('save-recover')).toBeVisible();
});

test('a transcript written ON THE DEVICE in this build is kept the same way, without a word to the proxy', async ({ page, context }) => {
  test.setTimeout(240_000);
  const models = testModels();
  await serveModels(context, models);
  await installTranscriptTest(page, models, STUB_SCRIPT);
  const invite = fake.newInvite(60);
  await openReady(page, invite);
  const before = fake.requests.length;
  await page.getByTestId('route-device-go').click();
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(await lineTexts(page)).toEqual(STUB_LINES);
  // The same sentence as over the internet one; no "İnternette yazıldı" line, no voices.
  await expect(page.getByTestId('yazi-keep-note')).toHaveText(tr['wizard.yazi.keepNote']);
  await expect(page.getByTestId('yazi-cloud-summary')).toHaveCount(0);
  expect(await storedRecord(page)).toBeNull();

  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
  await expect(page.getByTestId('save-state-off')).toHaveCount(0);
  await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual({
    video: 'sample-24s.mp4',
    clips: 0,
    lines: STUB_LINES.filter((line) => line !== '(anlaşılamadı)').map((line) => [line, null]),
  });
  expect(pathOf(page)).toBe('/editor');
  // Nothing of it went to the proxy: the quota was asked once on the choice screen, before, and that is all.
  expect(fake.requests.length).toBe(before);
});

test('the privacy page of this build says the opened transcript is stored on the device, and how to delete it', async ({ page }) => {
  await page.goto('/gizlilik/');
  await expect(page.getByTestId('privacy-cloud')).toContainText(ct('cloud.privacy.kept'));
  // The exception is in the card every build has; the route's own line adds what more of its text is kept.
  await expect(page.getByTestId('stored-project')).toContainText('Tek istisna “Yazıya dök”');
  await expect(page.getByTestId('stored-project-cloud')).toHaveText(ct('cloud.privacy.stored.project.extra'));
  // The way to delete it is the project's own, named as the button is.
  await expect(page.getByTestId('privacy-cloud')).toContainText('Kayıtlı projeyi sil');
  await expect(page.getByTestId('stored-project')).toContainText('Kayıtlı projeyi sil');
  // A video shared to the app (ADR-047): the card every build has, and what this build adds to it.
  await expect(page.getByTestId('stored-shared')).toContainText('“clip-shared”');
  await expect(page.getByTestId('stored-shared-cloud')).toHaveText(ct('cloud.privacy.stored.shared.extra'));
  // ADR-048: a Turkish browser opens the English page by choosing it (what the language button does).
  await page.goto('/gizlilik/en/?lang=en');
  await expect(page.getByTestId('privacy-cloud')).toContainText(cloudEn['cloud.privacy.kept']);
  await expect(page.getByTestId('stored-project-cloud')).toHaveText(cloudEn['cloud.privacy.stored.project.extra']);
  await expect(page.getByTestId('stored-shared-cloud')).toHaveText(cloudEn['cloud.privacy.stored.shared.extra']);
});
