import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

import { enhanceFixture } from './enhance-media';
import { silenceFixture } from './silence-media';
import { expectTestBuild, installTranscriptTest, serveModels, testModels } from './transcriptKit';
import { expectDetail, fault, faultBeforeLoad, nextFault, watchLogs, type FaultKind } from './workerFaultKit';

/**
 * The workers beside the export's (ADR-042, addendum of 13 Oct 2026): the
 * loudness worker, the transcript worker (model download and transcription)
 * and the "İyileştir" preview. The cloud sound worker has the same tests in
 * tests/cloud (it exists only in the cloud build).
 *
 * Until now each of them answered an unexpected failure with a bare
 * `internal_error`, and waited for ever when its worker stood still, could
 * not be read or could not be given the request. Checked here, for each
 * worker and each way of breaking:
 *
 * - the job ENDS, as a failure with a plain sentence;
 * - "Ayrıntılar" (closed until asked for) says where it broke and with what
 *   kind of error, and the diagnostics file holds the same checked values;
 * - the error's own text — given a path, a file name, a caption line and a
 *   blob address here — is on no screen, in no stored state, in no log line
 *   of the app and in no diagnostics file;
 * - stopping works while it stands still, and trying again works.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

/** How long a job may be silent in these tests (the app's own limits are 1–10 minutes). */
const STALL_MS = 2500;

const wizard = (page: Page) => page.getByTestId('wizard');

async function startTask(page: Page, id: string, file: string) {
  await page.goto('/');
  await page.getByTestId(`task-${id}`).click();
  await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
}

/** What "Ayrıntılar" and the diagnostics must say for each way of breaking, given the stage and step the worker was in. */
function expected(kind: FaultKind, stage: string, phase: string | null) {
  // "waiting": the worker had not said a word yet; the line names no step then.
  const step = phase && phase !== 'waiting' ? ` · ${phase}` : '';
  if (kind === 'throw') {
    return {
      line: new RegExp(`^EncodingError · ${stage} · decoding_error${step}$`),
      detail: { errorName: 'EncodingError', stage, via: 'exception', hint: 'decoding_error', phase, pageWasHidden: false },
    };
  }
  if (kind === 'crash') {
    return {
      line: new RegExp(`^WorkerError · worker_crash · worker_error_event${step}$`),
      detail: { errorName: 'WorkerError', stage: 'worker_crash', via: 'worker_error_event', hint: null, phase, pageWasHidden: false },
    };
  }
  if (kind === 'stall') {
    return {
      line: new RegExp(`^Stalled · ${stage} · stalled${step}$`),
      detail: { errorName: 'Stalled', stage, via: 'stalled', hint: null, phase, pageWasHidden: false },
    };
  }
  return {
    line: /^DataCloneError · unknown · request_not_sent$/,
    detail: { errorName: 'DataCloneError', stage: 'unknown', via: 'request_not_sent', hint: null, phase: null, pageWasHidden: false },
  };
}

const KINDS: FaultKind[] = ['throw', 'crash', 'stall', 'unsendable'];

// ------------------------------------------------------------------ Boşlukları at (loudness worker)

test.describe('the loudness worker', () => {
  test('every way of breaking ends as a failure that says where, keeps nothing of the error text, and trying again works', async ({ page }) => {
    const logs = watchLogs(page);
    const { file } = silenceFixture('bursts');
    await faultBeforeLoad(page, fault('silence', 'throw'), STALL_MS);
    await startTask(page, 'bosluk', file);

    for (const kind of KINDS) {
      await test.step(kind, async () => {
        const problem = page.getByTestId('bosluk-problem');
        await expect(problem.getByRole('alert')).toHaveText('Çözümleme beklenmedik bir hatayla durdu. Tekrar dene.', { timeout: 60_000 });
        const want = expected(kind, 'audio_decode', kind === 'unsendable' ? null : 'analysing');
        await expectDetail(page, logs, { testId: 'bosluk-failed', area: 'silence', code: 'internal_error', label: `silence/${kind}`, ...want });
        // Nothing was found, and nothing is offered for download.
        await expect(page.getByTestId('bosluk-summary')).toHaveCount(0);
        const next = KINDS[KINDS.indexOf(kind) + 1];
        await nextFault(page, next ? fault('silence', next) : null, STALL_MS);
        await page.getByTestId('bosluk-retry').click();
      });
    }
    // The same page, the same video, no fault: the search runs and finds the gap.
    await expect(page.getByTestId('bosluk-found')).toHaveText('1 sessiz yer bulundu.', { timeout: 60_000 });
    await expect(page.getByTestId('bosluk-problem')).toHaveCount(0);
  });

  test('“Durdur” ends a search that stands still at once; a healthy search is never ended by the watch', async ({ page }) => {
    // The stall itself is not waited out here: the press comes first.
    await faultBeforeLoad(page, fault('silence', 'stall'), 600_000);
    await startTask(page, 'bosluk', silenceFixture('many').file);
    await expect(page.getByTestId('bosluk-stop')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('bosluk-problem')).toHaveCount(0);
    await page.getByTestId('bosluk-stop').click();
    await expect(page.getByTestId('bosluk-problem')).toBeVisible({ timeout: 10_000 });
    // Stopped by the user: not a failure, no alert, no "Ayrıntılar".
    await expect(page.getByTestId('bosluk-problem').getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('bosluk-failed-details')).toHaveCount(0);

    // No fault now, and a limit of one second: a search that keeps reporting is never "standing still".
    await nextFault(page, null, 1000);
    await page.getByTestId('bosluk-retry').click();
    await expect(page.getByTestId('bosluk-limit')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('bosluk-problem')).toHaveCount(0);
  });
});

// ------------------------------------------------------------------ Sesi düzelt (the same loudness worker, ADR-049)

test.describe('Sesi düzelt’s measuring', () => {
  test('every way of breaking ends as a failure that says where, keeps nothing of the error text, and trying again works', async ({ page }) => {
    const logs = watchLogs(page);
    await faultBeforeLoad(page, fault('silence', 'throw'), STALL_MS);
    await startTask(page, 'duzelt', SAMPLE);

    for (const kind of KINDS) {
      await test.step(kind, async () => {
        const problem = page.getByTestId('duzelt-problem');
        await expect(problem.getByRole('alert')).toHaveText('Ses dinlenirken beklenmedik bir hata oldu. Tekrar dene.', { timeout: 60_000 });
        const want = expected(kind, 'audio_decode', kind === 'unsendable' ? null : 'analysing');
        await expectDetail(page, logs, { testId: 'duzelt-failed', area: 'silence', code: 'internal_error', label: `duzelt/${kind}`, ...want });
        // Nothing was measured, and nothing is offered for download.
        await expect(page.getByTestId('duzelt-summary')).toHaveCount(0);
        await expect(page.getByTestId('wizard-download')).toHaveCount(0);
        const next = KINDS[KINDS.indexOf(kind) + 1];
        await nextFault(page, next ? fault('silence', next) : null, STALL_MS);
        await page.getByTestId('duzelt-retry').click();
      });
    }
    // The same page, the same video, no fault: the measuring finishes and "İndir" is there.
    await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
    await expect(page.getByTestId('duzelt-problem')).toHaveCount(0);
  });
});

// ------------------------------------------------------------------ Yazıya dök (transcript worker)

test.describe('the transcript worker', () => {
  async function openYazi(page: Page) {
    await page.goto('/');
    await page.getByTestId('task-yazi').click();
    await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expectTestBuild(page);
  }

  test('model download: every way of breaking ends, says what happened, and the next press downloads', async ({ page, context }) => {
    const logs = watchLogs(page);
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models);
    await openYazi(page);
    await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 60_000 });

    const sentences: Record<FaultKind, { reason: string; text: RegExp }> = {
      // Thrown inside the download: the store's own catch-all, now with the error's name and stage.
      throw: { reason: 'storage_failed', text: /^Tarayıcı model dosyasını saklayamadı\./ },
      // It never said a word: "could not be started".
      crash: { reason: 'worker_unavailable', text: /^İndirme bu tarayıcıda başlatılamadı\./ },
      stall: { reason: 'stalled', text: /^İndirme durdu: bir süredir hiçbir şey inmedi\. İndirilen kısım duruyor; tekrar denersen kaldığı yerden devam eder\.$/ },
      unsendable: { reason: 'internal_error', text: /^İndirme beklenmedik bir hatayla durdu\. İndirilen kısım duruyor; tekrar dene\.$/ },
    };
    for (const kind of KINDS) {
      await test.step(kind, async () => {
        await nextFault(page, fault('model_download', kind), STALL_MS);
        await page.getByTestId('model-download').click();
        const failed = page.getByTestId('model-failed');
        await expect(failed).toBeVisible({ timeout: 60_000 });
        await expect(failed).toHaveAttribute('data-reason', sentences[kind].reason);
        await expect(failed).toHaveText(sentences[kind].text);
        // The fault comes before the first byte: only the answered failure (`throw`) has a step to name.
        const want = expected(kind, 'model_download', kind === 'throw' ? 'downloading' : kind === 'unsendable' ? null : 'waiting');
        await expectDetail(page, logs, { testId: 'model-failed', area: 'model_download', code: sentences[kind].reason, label: `model/${kind}`, ...want });
        // Nothing half-made is offered as a model.
        await expect(page.getByTestId('transcribe-start')).toHaveCount(0);
      });
    }
    await nextFault(page, null);
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  });

  test('transcription: every way of breaking ends, says where, and the next press writes the text', async ({ page, context }) => {
    const logs = watchLogs(page);
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models);
    await openYazi(page);
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });

    for (const kind of KINDS) {
      await test.step(kind, async () => {
        await nextFault(page, fault('transcript', kind), STALL_MS);
        await page.getByTestId('transcribe-start').click();
        const failed = page.getByTestId('transcribe-failed');
        await expect(failed).toBeVisible({ timeout: 60_000 });
        await expect(failed).toHaveAttribute('data-reason', 'internal_error');
        await expect(failed).toHaveText('Yazıya dökme beklenmedik bir hatayla durdu. Tekrar dene.');
        const want = expected(kind, 'model_load', kind === 'unsendable' ? null : 'loading');
        await expectDetail(page, logs, { testId: 'transcribe-failed', area: 'transcript', code: 'internal_error', label: `transcript/${kind}`, ...want });
        // No partial transcript is kept.
        await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
      });
    }

    // "Durdur" while it stands still: at once, and not a failure.
    await nextFault(page, fault('transcript', 'stall'), 600_000);
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-stop')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.getByTestId('transcribe-stop').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('transcribe-failed')).toHaveCount(0);

    // No fault, and a limit of one second: the stand-in reports every 120 ms and is never "standing still".
    await nextFault(page, null, 1000);
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
  });
});

// ------------------------------------------------------------------ İyileştir (the preview, in the export worker)

test.describe('the “İyileştir” preview', () => {
  test('every way of breaking ends as a failure that says where, keeps nothing of the error text, and “Tekrar dene” shows the picture', async ({ page }) => {
    const logs = watchLogs(page);
    await faultBeforeLoad(page, fault('enhance_preview', 'throw'), STALL_MS);
    await startTask(page, 'iyilestir', enhanceFixture('dark'));

    for (const kind of KINDS) {
      await test.step(kind, async () => {
        const failed = page.getByTestId('enhance-preview-failed');
        await expect(failed).toBeVisible({ timeout: 60_000 });
        await expect(failed).toHaveAttribute('data-reason', 'internal_error');
        await expect(failed).toHaveText('Önizleme hazırlanamadı.');
        const want = expected(kind, 'open_source', kind === 'unsendable' ? null : 'analysing');
        await expectDetail(page, logs, { testId: 'enhance-preview-failed', area: 'enhance_preview', code: 'internal_error', label: `preview/${kind}`, ...want });
        const next = KINDS[KINDS.indexOf(kind) + 1];
        await nextFault(page, next ? fault('enhance_preview', next) : null, STALL_MS);
        await page.getByTestId('enhance-preview-retry').click();
      });
    }
    await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
    await expect(page.getByTestId('enhance-preview-failed')).toHaveCount(0);
  });
});
