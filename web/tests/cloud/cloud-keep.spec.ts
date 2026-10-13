import { join } from 'node:path';
import { expect, test, type Page } from '../e2e/fixtures';

import { addKesit, installSavePicker, openEditor, openVideo } from '../e2e/kesitFlow';
import { STUB_LINES, STUB_SCRIPT, installTranscriptTest, serveModels, testModels } from '../e2e/transcriptKit';
import { cloudEn } from '../../src/i18n/cloudMessages.en';
import { SAMPLE, SCRIPT_LINES, SCRIPT_WORDS, ct, fill, lineTexts, openReady, startFake, type FakeWorker } from './cloudKit';

/**
 * A transcript written on the internet is KEPT when the editor is opened
 * over it (ADR-034, addendum of 13 Oct 2026) — against the LOCAL FAKE of our
 * proxy (cloudKit.ts). Before that, the result screen says it is not stored.
 *
 * The browser's store holds one project (ADR-012): one that is already there
 * and has work in it is never replaced without the user choosing, and a
 * deleted project does not come back.
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

interface Stored {
  title: string;
  edl: { schemaVersion: number; clips: unknown[]; captionTracks: { origin: string; cues: { text: string; speaker?: number }[] }[] };
  bindings: { kind: string; fileName: string }[];
}

/** The project as the browser's store holds it right now (null: nothing stored). */
function storedRecord(page: Page): Promise<Stored | null> {
  return page.evaluate(
    () =>
      new Promise<Stored | null>((resolve, reject) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve(null);
            return;
          }
          const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result[0] as Stored | undefined) ?? null);
          };
        };
      }),
  );
}

/** What identifies the stored project in these tests: its video, its kesit count, its lines with their voices. */
async function storedShape(page: Page) {
  const record = await storedRecord(page);
  if (!record) return null;
  return {
    video: record.bindings.find((binding) => binding.kind === 'video')?.fileName ?? null,
    clips: record.edl.clips.length,
    lines: record.edl.captionTracks[0]?.cues.map((cue) => [cue.text.split('\n').join(' '), cue.speaker ?? null]) ?? [],
  };
}

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
  await expect(page.getByTestId('yazi-cloud-keep-note')).toHaveText(ct('cloud.keep.note'));
  expect(await storedRecord(page)).toBeNull();

  // ---- the hand-over: no question (nothing was stored), the editor, and its usual "saved" words
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('cloud-keep')).toHaveCount(0);
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
  await expect(page.getByTestId('save-state-off')).toHaveCount(0);
  expect(await storedShape(page)).toEqual(TRANSCRIPT_SHAPE);
  expect((await storedRecord(page))?.edl.schemaVersion).toBe(5);
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
  await expect(page.getByTestId('yazi-cloud-keep-note')).toBeVisible();
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
  await expect(page.getByTestId('wizard-editor-note')).toHaveText(ct('cloud.keep.note'));
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
    await expect(choice.getByRole('heading', { level: 2 })).toHaveText(ct('cloud.keep.title'));
    await expect(page.getByTestId('cloud-keep-name')).toHaveText(fill(ct('cloud.keep.named'), { name: 'other-8s.mp4' }));
    await expect(page.getByTestId('cloud-keep')).toContainText(ct('cloud.keep.body'));
    await expect(page.getByTestId('cloud-keep-old')).toHaveText(ct('cloud.keep.old'));
    await expect(page.getByTestId('cloud-keep-new')).toHaveText(ct('cloud.keep.new'));
    await expect(page.getByTestId('cloud-keep')).toContainText(ct('cloud.keep.hint'));
    // The question is on screen and nothing has been done yet.
    await page.waitForTimeout(1200);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
    await expect(page.getByTestId('download-all')).toHaveCount(0);

    // Escape, and the close button: back on the result screen, the transcript still there, the store as it was.
    await page.keyboard.press('Escape');
    await expect(choice).toHaveCount(0);
    await expect(page.getByTestId('wizard')).toBeVisible();
    expect(await lineTexts(page)).toEqual(SCRIPT_LINES);
    await page.getByTestId('wizard-open-editor').click();
    await expect(choice).toBeVisible();
    await page.getByTestId('cloud-keep-cancel').click();
    await expect(choice).toHaveCount(0);
    await expect(page.getByTestId('yazi-cloud-keep-note')).toHaveText(ct('cloud.keep.note'));
    await page.waitForTimeout(800);
    expect(await storedShape(page)).toEqual(EARLIER_SHAPE);
    expect(pathOf(page)).toBe('/yap/yazi');
  });

  test('"Eski proje kalsın": the editor opens unsaved and says so; the earlier project is untouched', async ({ page }) => {
    test.setTimeout(240_000);
    await earlierProject(page);
    await writeOnline(page);
    await page.getByTestId('wizard-open-editor').click();
    await page.getByTestId('cloud-keep-old').click();

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
    await page.getByTestId('cloud-keep-new').click();

    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
    // What is on screen is the transcript's project, not the earlier one loaded over it.
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
    expect(await lineTexts(page)).toEqual(SCRIPT_LINES);
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

test('a transcript written ON THE DEVICE hands over as before: unsaved, no sentence, no question', async ({ page, context }) => {
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
  await expect(page.getByTestId('yazi-cloud-keep-note')).toHaveCount(0);

  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('save-state-off')).toHaveText('Bu düzenleme saklanmıyor');
  await page.waitForTimeout(1500);
  expect(await storedRecord(page)).toBeNull();
  expect(pathOf(page)).toBe('/yap/yazi');
  expect(fake.requests.length).toBe(before);
});

test('the privacy page of this build says the opened transcript is stored on the device, and how to delete it', async ({ page }) => {
  await page.goto('/gizlilik/');
  await expect(page.getByTestId('privacy-cloud')).toContainText(ct('cloud.privacy.kept'));
  await expect(page.getByTestId('stored-project-cloud')).toHaveText(ct('cloud.privacy.stored.project.extra'));
  // The way to delete it is the project's own, named as the button is.
  await expect(page.getByTestId('privacy-cloud')).toContainText('Kayıtlı projeyi sil');
  await expect(page.getByTestId('stored-project')).toContainText('Kayıtlı projeyi sil');
  await page.goto('/gizlilik/en/');
  await expect(page.getByTestId('privacy-cloud')).toContainText(cloudEn['cloud.privacy.kept']);
  await expect(page.getByTestId('stored-project-cloud')).toHaveText(cloudEn['cloud.privacy.stored.project.extra']);
});
