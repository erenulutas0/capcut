import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from './fixtures';

import { tr } from '../../src/i18n/messages';
import { en } from '../../src/i18n/messages.en';
import { addKesit, installSavePicker, openEditor, openVideo } from './kesitFlow';
import { storedRecord, storedShape } from './projectStore';
import { STUB_LINES, STUB_SCRIPT, expectTestBuild, installTranscriptTest, lineTexts, serveModels, testModels } from './transcriptKit';

/**
 * A transcript written ON THIS DEVICE is KEPT when the editor is opened over
 * it (ADR-034, addendum of 13 Oct 2026 — the founder's second decision of
 * that day, after the internet one in the morning), in the build every user
 * gets: no cloud route here, the scripted stand-in recogniser and the tiny
 * model list of transcriptKit.ts. Before the hand-over, the result screen
 * says the text is not stored.
 *
 * The browser's store holds one project (ADR-012): one that is already there
 * and has work in it is never replaced without the user choosing, and a
 * deleted project does not come back. Every other wizard still stores nothing.
 *
 * The stand-in hears nothing; nothing here says how well speech is written.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');

test.describe.configure({ timeout: 240_000 });
test.use({ storageState: { cookies: [], origins: [] } });

/** The stub's lines as the recipe holds them: the stretch that could not be written is not a line, and no voice is on any. */
const STUB_CUES = STUB_LINES.filter((line) => line !== '(anlaşılamadı)');
const TRANSCRIPT_SHAPE = { video: 'sample-24s.mp4', clips: 0, lines: STUB_CUES.map((line) => [line, null]) };
const EARLIER_SHAPE = { video: 'other-8s.mp4', clips: 1, lines: [] };

const pathOf = (page: Page) => new URL(page.url()).pathname.replace(/\/$/, '');
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** The test doubles, before any page is loaded (an init script reaches every page after it). */
async function prepare(page: Page, context: BrowserContext, stub: unknown = STUB_SCRIPT): Promise<void> {
  const models = testModels();
  await serveModels(context, models);
  await installTranscriptTest(page, models, stub);
}

/** A transcript on the wizard's result screen, written by the stand-in on this device. */
async function writeOnDevice(page: Page): Promise<void> {
  await page.goto('/yap/yazi');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expectTestBuild(page);
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => lineTexts(page)).toEqual(STUB_LINES);
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

/** After a reload at `/editor`: the stored project asks for its video; with the file back, its "Yazı" panel. */
async function relinkAndOpenText(page: Page): Promise<void> {
  await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('relink-filename')).toHaveText('sample-24s.mp4');
  await page.getByTestId('relink-video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('side-tab-yazi').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible();
}

test('opened in the editor, the transcript is the stored project: a reload brings it back', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page, context);
  await writeOnDevice(page);

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
  expect((await storedRecord(page))?.edl.schemaVersion).toBe(5);
  // The same video is still open: no second file dialog.
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('relink-video')).toHaveCount(0);
  // The address is the editor's: that is where the stored project lives.
  expect(pathOf(page)).toBe('/editor');

  // ---- reload: the editor, the same project, asking for its video (a browser cannot keep the file)
  await page.reload();
  await relinkAndOpenText(page);
  await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(STUB_LINES);
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı');

  // ---- coming back later, from the opening screen
  await page.goto('/');
  await page.getByTestId('home-editor-link').click();
  await relinkAndOpenText(page);
  await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(STUB_LINES);

  // An edit after that is saved.
  await page.getByTestId('transcript-edit').nth(0).click();
  await page.getByTestId('transcript-field').fill('Merhaba, hoş geldiniz.');
  await page.getByTestId('transcript-save').click();
  await expect.poll(async () => (await storedShape(page))?.lines[0], { timeout: 15_000 }).toEqual(['Merhaba, hoş geldiniz.', null]);
  expect(errors).toEqual([]);
});

test('never opening the editor stores nothing: the wizard alone is as it was', async ({ page, context }) => {
  await prepare(page, context);
  await writeOnDevice(page);
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

test('after "Altyazılı videoyu indir" the sentence still stands above the editor link, and the editor still keeps the text', async ({ page, context }) => {
  test.setTimeout(300_000);
  await installSavePicker(page);
  await prepare(page, context);
  await writeOnDevice(page);
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
  test('nothing is replaced until the user chooses; "Vazgeç" changes nothing', async ({ page, context }) => {
    await prepare(page, context);
    await earlierProject(page);
    await writeOnDevice(page);
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
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    await page.getByTestId('wizard-open-editor').click();
    await expect(choice).toBeVisible();
    await page.getByTestId('keep-cancel').click();
    await expect(choice).toHaveCount(0);
    await expect(page.getByTestId('yazi-keep-note')).toHaveText(tr['wizard.yazi.keepNote']);
    await page.waitForTimeout(800);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
    expect(pathOf(page)).toBe('/yap/yazi');
  });

  test('"Eski proje kalsın": the editor opens unsaved and says so; the earlier project is untouched', async ({ page, context }) => {
    await prepare(page, context);
    await earlierProject(page);
    await writeOnDevice(page);
    await page.getByTestId('wizard-open-editor').click();
    await page.getByTestId('keep-old').click();

    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    await expect(page.getByTestId('save-state-off')).toHaveText('Bu düzenleme saklanmıyor');
    await expect(page.getByTestId('save-state')).toHaveCount(0);
    // Work goes on in this editor; none of it reaches the store.
    await page.getByTestId('transcript-check').nth(0).click();
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

  test('"Bu yazı saklansın": the transcript takes the earlier project\'s place, and a reload shows it', async ({ page, context }) => {
    await prepare(page, context);
    await earlierProject(page);
    await writeOnDevice(page);
    await page.getByTestId('wizard-open-editor').click();
    await page.getByTestId('keep-new').click();

    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
    // What is on screen is the transcript's project, not the earlier one loaded over it.
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (0)');
    await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual(TRANSCRIPT_SHAPE);
    expect(pathOf(page)).toBe('/editor');

    await page.reload();
    await relinkAndOpenText(page);
    await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(STUB_LINES);
    // The earlier project's kesit is gone with it (the tab's count: the list itself is behind the "Yazı" tab).
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (0)');
  });

  test('a video that was only opened in the editor is not work: no question, the transcript is stored', async ({ page, context }) => {
    await prepare(page, context);
    await earlierProject(page, false);
    await writeOnDevice(page);
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
    await expect.poll(() => storedShape(page), { timeout: 15_000 }).toEqual(TRANSCRIPT_SHAPE);
  });
});

test('deleting the kept transcript removes it, and it does not come back', async ({ page, context }) => {
  await prepare(page, context);
  await writeOnDevice(page);
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

test('a store that cannot be used: the editor opens and its header says the work is not stored', async ({ page, context }) => {
  await prepare(page, context);
  await writeOnDevice(page);
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

test('no line could be written: nothing to keep, so the hand-over is every wizard\'s — unsaved, no sentence', async ({ page, context }) => {
  // The stand-in hears speech it cannot write, and nothing else.
  await prepare(page, context, { stepMs: 50, segments: [{ startUs: 1_000_000, endUs: 4_000_000, state: 'unclear', words: [] }] });
  await page.goto('/yap/yazi');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expectTestBuild(page);
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('wizard-blocked')).toHaveText(tr['wizard.yazi.noLines']);
  await expect(page.getByTestId('yazi-keep-note')).toHaveCount(0);

  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('save-state-off')).toHaveText('Bu düzenleme saklanmıyor');
  await page.waitForTimeout(1500);
  expect(await storedRecord(page)).toBeNull();
  expect(pathOf(page)).toBe('/yap/yazi');
});

test('"Kes" still hands over unsaved: the rule is "Yazıya dök"\'s alone (ADR-034 stands)', async ({ page }) => {
  await page.goto('/yap/kes');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('save-state-off')).toHaveText('Bu düzenleme saklanmıyor');
  await expect(page.getByTestId('save-state')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(await storedRecord(page)).toBeNull();
  expect(pathOf(page)).toBe('/yap/kes');
});

test('the privacy page of this build says the opened transcript is stored, and how to delete it — in both languages', async ({ page }) => {
  await page.goto('/gizlilik/');
  const card = page.getByTestId('stored-project');
  await expect(card).toContainText(tr['privacy.stored.project.body']);
  await expect(card).toContainText('Tek istisna “Yazıya dök”');
  // The way to delete it is the project's own, named as the button is.
  await expect(card).toContainText(tr['relink.discard']);
  // Nothing of the cloud route is on this page.
  await expect(page.getByTestId('stored-project-cloud')).toHaveCount(0);
  await expect(page.getByTestId('privacy-cloud')).toHaveCount(0);
  // ADR-047: the shared video's card, without the route's extra line.
  await expect(page.getByTestId('stored-shared')).toContainText(tr['privacy.stored.shared.body']);
  await expect(page.getByTestId('stored-shared-cloud')).toHaveCount(0);
  await page.goto('/gizlilik/en/');
  await expect(page.getByTestId('stored-shared')).toContainText(en['privacy.stored.shared.delete']);
  await expect(page.getByTestId('stored-project')).toContainText(en['privacy.stored.project.body']);
  await expect(page.getByTestId('stored-project')).toContainText(en['relink.discard']);
  await expect(page.getByTestId('stored-project-cloud')).toHaveCount(0);
});
