import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { SCRIPT_WORDS, ct, openReady, startFake, type FakeWorker } from '../cloud/cloudKit';
import { openMore } from '../e2e/kesitFlow';
import { SAMPLE, t } from './lib/app';
import { BUILD, tr, writeResult } from './lib/record';
import { blankResult, walk, type Flow, type WalkResult } from './lib/walk';
import { shot, type VisualEntry } from './lib/visual';

/**
 * Section 1, "Yazıya dök → İnternette" from the card to the subtitled video —
 * AGAINST A LOCAL FAKE of our proxy Worker (ADR-039; tests/cloud/cloudKit.ts,
 * cloud/fake-worker/server.mjs), in the cloud build (the proxy named, test
 * hooks on). The route does not exist in the published site.
 *
 * What this measures is the FLOW of the consent screen and the cloud route:
 * presses, screens, words to read, plain language, that a file comes out.
 * It says NOTHING about how well speech is written: the fake hears nothing
 * and returns the words this file scripted. No external service is contacted.
 * The report labels these rows "sahte sunucuya karşı".
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'cloud', 'runs against the cloud build (the runner sets QUALITY_BUILD=cloud)');

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

test('walkthrough: yazi, internet route (against the local fake)', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const visual: VisualEntry[] = [];
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode: 'tr' });

  const flow: Flow = {
    id: 'yazi',
    shotId: 'yazi-bulut',
    sourceNote: 'sample-24s.mp4; bulut derlemesi, SAHTE sunucuya karşı (yerel; konuşmayı duymaz, betikteki kelimeleri döndürür)',
    source: () => SAMPLE,
    middle: async (novice) => {
      // "Yazıyı nerede çıkaralım?" — without a code: the question, the two cards, the invite field.
      await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('wizard-title')).toHaveText(ct('cloud.choice.title'));
      await novice.look('nerede (kodsuz)', ['davet kodu']);
      await shot(page, testInfo, visual, 'yol-yazi-bulut-secim-kodsuz');
      await novice.type(ct('cloud.invite.label'), invite, 'invite-code');
      await novice.press('button', ct('cloud.invite.save'), 'invite-save');
      // With the code: the minutes line and the two buttons of the same size.
      await expect(page.getByTestId('route-online-go')).toBeVisible({ timeout: 30_000 });
      await novice.look('nerede');
      await shot(page, testInfo, visual, 'yol-yazi-bulut-secim');
      await novice.press('button', ct('cloud.online.go'), 'route-online-go');
      await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
      // The minutes left arrive a moment after the text: the screen is read once it has settled.
      await expect(page.getByTestId('yazi-cloud-summary')).toContainText('dakikan kaldı', { timeout: 30_000 });
      await novice.look('yazı');
      await shot(page, testInfo, visual, 'yol-yazi-bulut-yazi', { mask: [page.locator('video')] });
    },
    download: { key: 'wizard.yazi.downloadVideo', testId: 'wizard-download' },
    verify: (out) => [
      { name: 'süre ≈ 24 sn', ok: Math.abs(out.durationS - 24) <= 0.15, value: `${tr(out.durationS, 3)} sn` },
      {
        name: 'izler: video:h264 + audio:aac',
        ok: out.video?.codec === 'h264' && out.audio?.codec === 'aac',
        value: out.streams.map((stream) => `${stream.type}:${stream.codec}`).join(' + '),
      },
    ],
  };

  writeResult('walkthrough-yazi-bulut', testInfo.project.name, { tasks: [blankResult(testInfo, flow, 'ölçüm betiği yarıda kaldı (zaman aşımı)')], fakeServer: true });
  const result: WalkResult = await walk(page, testInfo, flow, visual);
  // What the fake saw: one sound-only upload, and nothing left behind.
  const upload = fake.uploads[0];
  writeResult('walkthrough-yazi-bulut', testInfo.project.name, {
    tasks: [result],
    fakeServer: true,
    upload: upload ? { bytes: upload.bytes.length, contentType: upload.contentType, declaredSeconds: upload.durationS } : null,
    leftAtProvider: fake.jobs().filter((job) => job.atProvider).length,
    uploads: fake.uploads.length,
  });
  // The fake's screens are not the published ones: they get their own baseline names and say what they are.
  writeResult('visual', `${testInfo.project.name}.walkthrough-yazi-bulut`, {
    shots: visual.map((entry) => ({ ...entry, note: [entry.note, 'bulut derlemesi, sahte sunucuya karşı'].filter(Boolean).join('; ') })),
  });
});

/**
 * "Kim konuştu" kalıcı mı (EDL v5, ADR-043) — yine SAHTE sunucuya karşı.
 *
 * The scripted transcript has two voices in four turns, so four labels
 * ("1. kişi", "2. kişi", "1. kişi", "2. kişi") are expected wherever the
 * transcript is shown. Counted at every place a user can meet it again: the
 * result screen, the editor, the browser's store right after the editor was
 * opened (that hand-over stores the project — ADR-034 addendum, 13 Oct 2026),
 * the store and the screen after THAT page was reloaded, the backup file,
 * and another browser that reads the backup. A place the script could not
 * reach is written as "not measured" (null), never as a pass.
 */
const EXPECTED_TURNS = ['1. kişi', '2. kişi', '1. kişi', '2. kişi'];

interface SpeakerCounts {
  expected: number;
  /** Labels on the wizard's result screen that are the expected ones, in order. */
  wizard: number | null;
  /** Voice tags in the downloaded VTT. */
  vttVoices: number | null;
  /** Times "kişi" appears in the downloaded SRT (must be none: SRT carries the words alone). */
  srtMentions: number | null;
  editor: number | null;
  /** Lines in the browser's own store that carry a speaker number, once the editor was opened from the wizard. */
  storedAfterHandoff: number | null;
  /** Lines of the backup file that carry a speaker number. */
  backupFile: number | null;
  /** Lines in the browser's own store that carry a speaker number, after the editor's page was reloaded. */
  storedAfterReload: number | null;
  /** Labels on screen after that reload (the video picked again). No backup file is involved. */
  afterReload: number | null;
  /** Labels in ANOTHER browser (an empty store) that was given the backup file. */
  restoredEditor: number | null;
  stopped: string | null;
}

/** How many of the labels on screen are the expected ones, position by position. */
async function labelsRight(page: Page): Promise<number> {
  await expect(page.getByTestId('transcript-row').first()).toBeVisible({ timeout: 30_000 });
  const seen = await page.getByTestId('transcript-speaker').allTextContents();
  return seen.length === EXPECTED_TURNS.length ? seen.filter((label, index) => label === EXPECTED_TURNS[index]).length : Math.min(seen.length, EXPECTED_TURNS.length - 1);
}

async function downloadedText(page: Page, testInfo: TestInfo, press: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), press()]);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  return readFileSync(file, 'utf8');
}

const storedSpeakerLines = (page: Page): Promise<number | null> =>
  page.evaluate(
    () =>
      new Promise<number | null>((resolve) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve(null);
            return;
          }
          const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          all.onerror = () => resolve(null);
          all.onsuccess = () => {
            db.close();
            const record = all.result[0] as { edl?: { captionTracks?: { cues?: { speaker?: unknown }[] }[] } } | undefined;
            const cues = record?.edl?.captionTracks?.[0]?.cues;
            resolve(cues ? cues.filter((cue) => typeof cue.speaker === 'number').length : null);
          };
        };
      }),
  );

test('speakers that survive: result, editor, the stored project, reload, backup, another browser (against the local fake)', async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode: 'tr' });
  const counts: SpeakerCounts = {
    expected: EXPECTED_TURNS.length,
    wizard: null,
    vttVoices: null,
    srtMentions: null,
    editor: null,
    storedAfterHandoff: null,
    backupFile: null,
    storedAfterReload: null,
    afterReload: null,
    restoredEditor: null,
    stopped: 'ölçüm betiği yarıda kaldı (zaman aşımı)',
  };
  const write = () => writeResult('walkthrough-yazi-bulut-kisiler', testInfo.project.name, { speakers: counts, fakeServer: true });
  write();
  try {
    await openReady(page, invite, SAMPLE);
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
    counts.wizard = await labelsRight(page);

    const vtt = await downloadedText(page, testInfo, () => page.getByTestId('transcript-save-vtt').click());
    counts.vttVoices = vtt.split('\n').filter((line) => /^<v \d+\. kişi>/.test(line)).length;
    const srt = await downloadedText(page, testInfo, () => page.getByTestId('transcript-save-srt').click());
    counts.srtMentions = srt.split('kişi').length - 1;

    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
    counts.editor = await labelsRight(page);
    // Opening the editor stored the project: read from the store itself, once the write has had its time.
    await expect.poll(() => storedSpeakerLines(page), { timeout: 15_000 }).not.toBeNull();
    counts.storedAfterHandoff = await storedSpeakerLines(page);

    await openMore(page);
    const backupText = await downloadedText(page, testInfo, () => page.getByTestId('backup-download').click());
    const backup = JSON.parse(backupText) as { edl: { captionTracks: { cues: { speaker?: unknown }[] }[] } };
    counts.backupFile = (backup.edl.captionTracks[0]?.cues ?? []).filter((cue) => typeof cue.speaker === 'number').length;
    await page.keyboard.press('Escape');

    // The reload of THIS page — no backup file on the way: the stored project, its video picked again.
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    counts.storedAfterReload = await storedSpeakerLines(page);
    await page.getByTestId('relink-video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('side-tab-yazi').click();
    counts.afterReload = await labelsRight(page);

    // The backup file, in another browser that has nothing stored.
    const { baseURL, viewport, locale, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
    const elsewhere = await browser.newContext({ baseURL, viewport, locale, userAgent, deviceScaleFactor, isMobile, hasTouch, storageState: { cookies: [], origins: [] } });
    try {
      const other = await elsewhere.newPage();
      await other.goto('/editor');
      await expect(other.getByTestId('download-all')).toBeVisible();
      await other.getByTestId('backup-input').setInputFiles({ name: 'yedek.lilocut.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
      await expect(other.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
      await other.getByTestId('relink-video-input').setInputFiles(SAMPLE);
      await expect(other.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
      await other.getByTestId('side-tab-yazi').click();
      counts.restoredEditor = await labelsRight(other);
    } finally {
      await elsewhere.close();
    }
    counts.stopped = null;
  } catch (error) {
    counts.stopped = `betik ilerleyemedi: ${String((error as Error).message).split('\n')[0]?.slice(0, 240)}`;
  }
  write();
});
