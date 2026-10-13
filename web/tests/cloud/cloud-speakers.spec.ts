import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page, type TestInfo } from '../e2e/fixtures';

import { openMore, openSettings } from '../e2e/kesitFlow';
import { SAMPLE, SCRIPT_LINES, SCRIPT_WORDS, lineTexts, openReady, startFake, type FakeWorker } from './cloudKit';

/**
 * Speakers that survive (EDL v5, ADR-043), against the LOCAL FAKE of our
 * proxy (cloudKit.ts): the voices the provider told apart are stored on the
 * lines, so "1. kişi / 2. kişi" are there in the editor, after a line is
 * edited, in the project the hand-over stores (ADR-034 addendum, 13 Oct
 * 2026) and after its page is reloaded, in a backup file, and in another
 * browser that reads the backup.
 *
 * The fake hears nothing: who "spoke" is what this file's script says.
 * Nothing here says how well a real provider tells voices apart.
 */

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

const TURNS = ['1. kişi', '2. kişi', '1. kişi', '2. kişi'];

async function saved(testInfo: TestInfo, download: Download): Promise<string> {
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  return readFileSync(file, 'utf8');
}

async function pressAndRead(page: Page, testInfo: TestInfo, testId: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  return saved(testInfo, download);
}

/**
 * The text of every cue of a subtitle file, in order, a two-line cue joined by a space (the way the panel shows a
 * line). SRT: number, timing, text. VTT: timing, text.
 */
function cueBodies(file: string): string[] {
  return file
    .split('\r\n')
    .join('\n')
    .split(/\n\n+/)
    .map((block) => block.split('\n').filter((line) => line !== ''))
    .filter((lines) => lines.some((line) => line.includes('-->')))
    .map((lines) => lines.slice(lines.findIndex((line) => line.includes('-->')) + 1).join(' '));
}

interface StoredCue {
  cueId: string;
  text: string;
  speaker?: number;
}
interface Stored {
  edl: { schemaVersion: number; captionTracks: { origin: string; cues: StoredCue[] }[] };
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

const storedVoices = async (page: Page) => (await storedRecord(page))?.edl.captionTracks[0]?.cues.map((cue) => cue.speaker ?? null) ?? null;

test('who spoke stays with the lines: wizard, files, edit, editor, kesit, the stored project, reload, backup, another browser', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode: 'tr' });

  // ---- the wizard's result
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(await lineTexts(page)).toEqual(SCRIPT_LINES);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);

  // ---- the files: VTT names the voice in a voice tag, SRT does not carry it at all
  const vtt = await pressAndRead(page, testInfo, 'transcript-save-vtt');
  expect(vtt.startsWith('WEBVTT\n')).toBe(true);
  expect(cueBodies(vtt)).toEqual([
    '<v 1. kişi>Merhaba, bugün videoyu yazıya döküyoruz.',
    '<v 2. kişi>Çok iyi, ben de dinliyorum.',
    '<v 1. kişi>Önce sesi ayırıyoruz, sonra yazı geliyor.',
    '<v 2. kişi>Teşekkürler.',
  ]);
  const srt = await pressAndRead(page, testInfo, 'transcript-save-srt');
  expect(srt).not.toContain('kişi');
  expect(srt).not.toContain('<v');
  expect(srt.split('\r\n').slice(0, 2)).toEqual(['1', expect.stringMatching(/^00:00:01,000 --> /)]);
  // The words alone, exactly the lines of the panel.
  expect(cueBodies(srt)).toEqual(SCRIPT_LINES);

  // ---- a wrong word fixed: the line is still the second voice's
  await page.getByTestId('transcript-edit').nth(1).click();
  await page.getByTestId('transcript-field').fill('Çok iyi, ben de izliyorum.');
  await page.getByTestId('transcript-save').click();
  const edited = [SCRIPT_LINES[0], 'Çok iyi, ben de izliyorum.', SCRIPT_LINES[2], SCRIPT_LINES[3]];
  await expect.poll(() => lineTexts(page)).toEqual(edited);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);
  // Each label sits on the row of the line it belongs to.
  const rowsWithLabel = page.getByTestId('transcript-row').filter({ has: page.getByTestId('transcript-speaker') });
  await expect(rowsWithLabel).toHaveCount(4);
  await expect(page.getByTestId('transcript-row').nth(1)).toContainText('2. kişi');

  // ---- the editor: the same labels in its "Yazı" panel
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('download-all')).toBeVisible();
  await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(edited);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);

  // "Bunlardan kesit yap" from the second voice's first line: a kesit is added, no label moves.
  await page.getByTestId('transcript-check').nth(1).click();
  await page.getByTestId('transcript-make-kesit').click();
  await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (1)');
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);

  // A word fixed in the editor's panel: the line keeps its voice here too.
  await page.getByTestId('transcript-edit').nth(3).click();
  await page.getByTestId('transcript-field').fill('Çok teşekkürler.');
  await page.getByTestId('transcript-save').click();
  await expect(page.getByTestId('transcript-row').nth(3)).toContainText('Çok teşekkürler.');
  await expect(page.getByTestId('transcript-row').nth(3)).toContainText('2. kişi');
  const final = [...edited.slice(0, 3), 'Çok teşekkürler.'];

  // The editor's own subtitle files: the kesit shows one line; VTT names its voice, SRT is the words alone.
  await openSettings(page, 'captions');
  const editorVtt = await pressAndRead(page, testInfo, 'caption-export-vtt');
  expect(cueBodies(editorVtt)).toEqual(['<v 2. kişi>Çok iyi, ben de izliyorum.']);
  const editorSrt = await pressAndRead(page, testInfo, 'caption-export-srt');
  expect(cueBodies(editorSrt)).toEqual(['Çok iyi, ben de izliyorum.']);
  expect(editorSrt).not.toContain('kişi');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ---- the hand-over stored the project (ADR-034 addendum, 13 Oct 2026): the store holds the lines with their voices
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
  await expect
    .poll(async () => (await storedRecord(page))?.edl.captionTracks[0]?.cues.map((cue) => [cue.text.split('\n').join(' '), cue.speaker]), { timeout: 15_000 })
    .toEqual([
      [final[0], 1],
      [final[1], 2],
      [final[2], 1],
      [final[3], 2],
    ]);

  // ---- the backup file: numbers on the lines, schema v5, no label text
  await openMore(page);
  const backupDownload = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const backupText = await saved(testInfo, await backupDownload);
  const backup = JSON.parse(backupText) as Stored;
  expect(backup.edl.schemaVersion).toBe(5);
  expect(backup.edl.captionTracks[0]?.origin).toBe('transcript');
  // (A stored line may be two lines of text; the panel shows it joined by a space.)
  expect(backup.edl.captionTracks[0]?.cues.map((cue) => [cue.text.split('\n').join(' '), cue.speaker])).toEqual([
    [final[0], 1],
    [final[1], 2],
    [final[2], 1],
    [final[3], 2],
  ]);
  expect(backupText).not.toContain('kişi');
  expect(backupText).not.toContain('blob:');
  await page.keyboard.press('Escape');

  // ---- reload: the stored project comes back, asks for its video, and the voices are still there
  await page.reload();
  await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('relink-video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('side-tab-yazi').click();
  await expect.poll(() => lineTexts(page), { timeout: 30_000 }).toEqual(final);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);

  // An edit after the reload is saved with the voice still on the line.
  await page.getByTestId('transcript-edit').nth(0).click();
  await page.getByTestId('transcript-field').fill('Merhaba, bugün videoyu yazıya döküyoruz!');
  await page.getByTestId('transcript-save').click();
  await expect
    .poll(async () => (await storedRecord(page))?.edl.captionTracks[0]?.cues[0], { timeout: 15_000 })
    .toMatchObject({ text: 'Merhaba, bugün videoyu yazıya döküyoruz!', speaker: 1 });
  expect(await storedVoices(page)).toEqual([1, 2, 1, 2]);
  await expect(page.getByTestId('transcript-speaker')).toHaveText(TURNS);

  // ---- the backup file in ANOTHER browser (nothing stored there): the project is stored there too, with its voices
  const elsewhere = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1440, height: 900 }, baseURL: testInfo.project.use.baseURL });
  try {
    const other = await elsewhere.newPage();
    other.on('pageerror', (error) => errors.push(error.message));
    await other.goto('/editor');
    await expect(other.getByTestId('download-all')).toBeVisible();
    await expect(other.getByTestId('save-state')).toContainText('Düzenleme henüz saklanmadı');
    await other.getByTestId('backup-input').setInputFiles({ name: 'gorusme.lilocut.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await expect(other.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await other.getByTestId('relink-video-input').setInputFiles(SAMPLE);
    await expect(other.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await other.getByTestId('side-tab-yazi').click();
    await expect(other.getByTestId('transcript-panel')).toBeVisible();
    await expect.poll(() => lineTexts(other), { timeout: 30_000 }).toEqual(final);
    await expect(other.getByTestId('transcript-speaker')).toHaveText(TURNS);
    await expect.poll(() => storedVoices(other), { timeout: 15_000 }).toEqual([1, 2, 1, 2]);
  } finally {
    await elsewhere.close();
  }

  expect(errors).toEqual([]);
});

test('one voice only: its number is stored, and nobody is labelled anywhere', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS.map((word) => ({ ...word, speaker: 'A' })), pollsUntilDone: 1, languageCode: 'tr' });

  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('transcript-row').first()).toBeVisible();
  await expect(page.getByTestId('transcript-speaker')).toHaveCount(0);
  const vtt = await pressAndRead(page, testInfo, 'transcript-save-vtt');
  expect(vtt).not.toContain('<v');
  expect(vtt).not.toContain('kişi');
  const text = await pressAndRead(page, testInfo, 'transcript-save-txt');
  expect(text).not.toContain('kişi');

  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('transcript-row').first()).toBeVisible();
  await expect(page.getByTestId('transcript-speaker')).toHaveCount(0);
  await openMore(page);
  const backupDownload = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const backup = JSON.parse(await saved(testInfo, await backupDownload)) as Stored;
  expect(new Set(backup.edl.captionTracks[0]?.cues.map((cue) => cue.speaker))).toEqual(new Set([1]));
});
