import { expect, test } from '@playwright/test';

import { STUB_SCRIPT, installTranscriptTest, serveModels, testModels } from '../e2e/transcriptKit';
import { SAMPLE, startsWith, t } from './lib/app';
import { BUILD, writeResult } from './lib/record';
import { blankResult, walk, type Flow, type WalkResult } from './lib/walk';
import type { VisualEntry } from './lib/visual';

/**
 * Section 1, "Yazıya dök" from the card to the subtitled video — with TEST
 * DOUBLES: a tiny model list and a scripted stand-in for the recogniser
 * (tests/e2e/transcriptKit.ts), in the `CLIP_TEST_HOOKS=1` build.
 *
 * What this measures is the FLOW (presses, screens, words, that a file comes
 * out). It says nothing about how well speech is written: the stand-in hears
 * nothing. The report labels these rows as made with the stand-in.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'hooks', 'runs against the test-hooks build (the runner sets QUALITY_BUILD=hooks)');

const YAZI_STAND_IN: Flow = {
  id: 'yazi',
  shotId: 'yazi-kancali',
  sourceNote: 'sample-24s.mp4; test kancalı derleme, küçük model listesi ve betikli tanıyıcı (konuşmayı duymaz)',
  source: () => SAMPLE,
  prepare: async (page) => {
    const models = testModels();
    await serveModels(page.context(), models);
    await installTranscriptTest(page, models, STUB_SCRIPT);
  },
  middle: async (novice, page) => {
    await expect(page.getByTestId('transcribe-steps')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('transcribe-steps')).toHaveAttribute('data-test-hooks', '1');
    await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });
    await novice.look('model', ['model indirme (bir kez)']);
    await novice.press('button', startsWith(t('transcript.model.download').split(' (')[0] ?? ''), 'model-download');
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    await novice.look('yazıya dök');
    await novice.press('button', t('transcript.start'), 'transcribe-start');
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
    await novice.look('yazı');
  },
  download: { name: t('wizard.yazi.downloadVideo'), testId: 'wizard-download' },
  verify: (out) => [
    { name: 'süre ≈ 24 sn', ok: Math.abs(out.durationS - 24) <= 0.15, value: `${out.durationS} sn` },
    {
      name: 'izler: video:h264 + audio:aac',
      ok: out.video?.codec === 'h264' && out.audio?.codec === 'aac',
      value: out.streams.map((stream) => `${stream.type}:${stream.codec}`).join(' + '),
    },
  ],
};

test('walkthrough: yazi (stand-in recogniser)', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const visual: VisualEntry[] = [];
  writeResult('walkthrough-yazi', testInfo.project.name, { tasks: [blankResult(testInfo, YAZI_STAND_IN, 'ölçüm betiği yarıda kaldı (zaman aşımı)')], standIn: true });
  const result: WalkResult = await walk(page, testInfo, { ...YAZI_STAND_IN }, visual);
  writeResult('walkthrough-yazi', testInfo.project.name, { tasks: [result], standIn: true });
  // The stand-in's screens are not the published ones: they get their own baseline names.
  writeResult('visual', `${testInfo.project.name}.walkthrough-yazi-kancali`, {
    shots: visual.map((entry) => ({ ...entry, note: [entry.note, 'test kancalı derleme'].filter(Boolean).join('; ') })),
  });
});
