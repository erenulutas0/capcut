import { expect, test } from '@playwright/test';

import { SCRIPT_WORDS, ct, startFake, type FakeWorker } from '../cloud/cloudKit';
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
    download: { name: t('wizard.yazi.downloadVideo'), testId: 'wizard-download' },
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
