import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '../e2e/fixtures';

import { addKesit, installSavePicker, pickerCalls, readSaved } from '../e2e/kesitFlow';
import { STUB_SCRIPT, installTranscriptTest, serveModels, testModels } from '../e2e/transcriptKit';
import {
  OUTPUTS,
  ensureDir,
  judge,
  measureSaved,
  observe,
  pageDead,
  payloadOf,
  readManifest,
  selectedSurfaces,
  sleep,
  watchFreeze,
  watchProblems,
  writeCell,
  type CorpusItem,
  type Outcome,
  type PageProblems,
  type SavedFile,
  type Surface,
} from './lib';

/**
 * The fuzz run (docs/quality/2026-10-15-fuzz.md): every file of the corpus
 * (scripts/fuzz/make-corpus.mjs) is picked on each of the ten task cards and
 * in the editor; the default path is driven to the download; what happened
 * is written down and judged (tests/fuzz/lib.ts):
 *
 *  - iyi:      a plain refusal with a way on, an honest failure, a card that
 *              says there is nothing to do, or a saved file that ffprobe
 *              confirms is what the card promised;
 *  - belirsiz: a message with an engineering word or without a way on, a
 *              valid file the app could not work on (said honestly), a saved
 *              file that is right but not quite as promised, a bad file
 *              opened without a word;
 *  - bozuk:    a fake success (a saved file that is not what was promised, or
 *              from a file that should have been refused), a valid file
 *              refused, no answer or a spinner for over a minute, a frozen
 *              page, a page error, a crash.
 *
 * Every wait is bounded. Nothing leaves the machine: the server is local and
 * the corpus is synthetic.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
const ITEMS = readManifest();
const SURFACES = selectedSurfaces();

for (const surface of SURFACES) {
  for (const item of ITEMS) {
    test(`fuzz: ${surface} × ${item.id}`, async ({ page }, testInfo) => {
      test.setTimeout(540_000);
      const blank = { surface, id: item.id, label: item.label, group: item.group, expect: item.expect, outcome: null, messages: [], saved: null, answerMs: null, totalMs: null };
      // Written first: if this script itself is cut short, the cell says so instead of being missing.
      writeCell(surface, item.id, { ...blank, verdict: 'ölçülemedi', why: 'ölçüm betiği yarıda kaldı' });
      const problems = await watchProblems(page);
      const freeze = watchFreeze(page);
      const cell = measureCell(page, testInfo, surface, item, problems);
      cell.catch(() => undefined);
      const result = await Promise.race([
        cell.then((data) => ({ kind: 'done' as const, data })).catch((error: Error) => ({ kind: 'error' as const, message: error.message })),
        freeze.gaveUp.then((ms) => ({ kind: 'frozen' as const, ms })),
        sleep(480_000).then(() => ({ kind: 'late' as const })),
      ]);
      freeze.stop();
      if (result.kind === 'frozen') {
        // A tab whose main thread never comes back would hold the test until its own timeout (the
        // fixture's last look at the page waits on it): the browser closes it; the cell is already judged.
        await Promise.race([page.close({ runBeforeUnload: false }).catch(() => undefined), sleep(15_000)]);
      }
      if (result.kind === 'done') {
        writeCell(surface, item.id, { ...result.data, longestUnresponsiveMs: freeze.longest() });
        return;
      }
      const outcome: Outcome = result.kind === 'frozen' ? 'frozen' : result.kind === 'late' ? 'stuck' : 'crash';
      const verdict =
        result.kind === 'error'
          ? { verdict: 'ölçülemedi' as const, why: `ölçüm betiği hata verdi: ${result.message.split(/\r?\n/)[0]?.slice(0, 160)}` }
          : judge({ outcome, messages: [], controls: [], stillBusy: false, saved: null, problems, dead: false }, item);
      writeCell(surface, item.id, {
        ...blank,
        outcome,
        ...verdict,
        pageErrors: problems.pageErrors,
        consoleErrors: problems.consoleErrors,
        unhandledRejections: problems.unhandledRejections,
        watchdogReloads: problems.watchdogReloads,
        longestUnresponsiveMs: freeze.longest(),
      });
    });
  }
}

type FirstAnswer = 'refused' | 'opened' | 'silent' | 'dead' | 'crash';

/** Waits until the app has answered the file: a refusal, the next step (or the editor), or nothing at all. */
async function firstAnswer(page: Page, problems: PageProblems, waitMs: number): Promise<FirstAnswer> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (problems.crashed) return 'crash';
    // One look at the page per turn (in "Kes" the wizard gives way to the editor: nothing here may wait for either).
    const now = await page
      .evaluate(() => ({
        refused: document.querySelector('[data-testid="media-error"]') !== null,
        step: document.querySelector('[data-testid="wizard"]')?.getAttribute('data-step') ?? null,
        // The preview element exists only once a video is open (the empty editor already has "download-all").
        editor: document.querySelector('[data-testid="preview-video"]') !== null,
        dead: document.getElementById('clip-page-dead')?.getAttribute('data-state') === 'dead',
      }))
      .catch(() => null);
    if (now === null) {
      await sleep(500);
      continue;
    }
    if (now.dead) return 'dead';
    if (now.refused) return 'refused';
    if (now.step === 'choose' || now.editor) return 'opened';
    await sleep(200);
  }
  return 'silent';
}

const visible = async (page: Page, testId: string) => (await page.getByTestId(testId).count()) > 0 && page.getByTestId(testId).first().isVisible();

/**
 * The default path from the opened video to the download button, pressed when it can be. Returns
 * whether it was pressed; for "Kes" also the length of the one kesit that was added.
 */
async function drive(page: Page, surface: Surface, item: CorpusItem): Promise<{ pressed: boolean; kesitS: number | null }> {
  if (surface === 'editor' || surface === 'kes') {
    const preview = page.getByTestId('preview-video');
    const shown = await preview.isVisible({ timeout: 30_000 }).catch(() => false);
    if (!shown) {
      await expect(preview).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
      if (!(await preview.isVisible().catch(() => false))) return { pressed: false, kesitS: null };
    }
    if (surface === 'editor') {
      await page.getByTestId('download-all').click({ timeout: 10_000 });
      return { pressed: true, kesitS: null };
    }
    // "Kes": the first two seconds (or what there is of the video) as one kesit, then its download.
    const duration = await preview.evaluate((video) => (video as HTMLVideoElement).duration).catch(() => Number.NaN);
    const kesitS = Number.isFinite(duration) && duration > 0 ? Math.min(2, Math.max(0.1, Math.floor(duration * 10) / 10)) : 2;
    await addKesit(page, '0', String(kesitS));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await page.getByTestId('kesit-download').count()) > 0) {
        await page.getByTestId('kesit-download').first().click({ timeout: 10_000 });
        return { pressed: true, kesitS };
      }
      const now = await observe(page);
      if (now.messages.length > 0 && !now.stillBusy) return { pressed: false, kesitS };
      await sleep(250);
    }
    return { pressed: false, kesitS };
  }

  const deadline = Date.now() + 90_000;
  let musicPicked = false;
  let modelPressed = false;
  let startPressed = false;
  let saidAt: number | null = null;
  while (Date.now() < deadline) {
    const now = await observe(page);
    if (now.downloadEnabled && (await visible(page, 'wizard-download'))) {
      await page.getByTestId('wizard-download').click({ timeout: 10_000 });
      return { pressed: true, kesitS: null };
    }
    if (surface === 'muzik' && !musicPicked && (await page.getByTestId('audio-input').count()) > 0) {
      await page.getByTestId('audio-input').setInputFiles(MUSIC);
      musicPicked = true;
      await sleep(500);
      continue;
    }
    if (surface === 'yazi') {
      if (!modelPressed && (await visible(page, 'model-download'))) {
        await page.getByTestId('model-download').click({ timeout: 10_000 });
        modelPressed = true;
        continue;
      }
      if (!startPressed && (await visible(page, 'transcribe-start'))) {
        await page.getByTestId('transcribe-start').click({ timeout: 10_000 });
        startPressed = true;
        continue;
      }
    }
    if (now.messages.length > 0 && !now.stillBusy) {
      // A sentence without a download: give the step three seconds to add one anyway, then take it as the answer.
      saidAt ??= Date.now();
      if (Date.now() - saidAt > 3000) return { pressed: false, kesitS: null };
    } else {
      saidAt = null;
    }
    await sleep(300);
  }
  return { pressed: false, kesitS: null };
}

type ResultPhase = 'saved' | 'ready' | 'failed' | 'blocked' | 'canceled' | 'timeout';

const PHASE_SELECTOR =
  '[data-testid="download-saved"], [data-testid="export-download"], [data-testid="export-failed"], ' +
  '[data-testid="export-blocked"], [data-testid="export-over-limit"], [data-testid="export-canceled"]';

/** Waits for the download to end one way or another and says which; never longer than `timeoutMs`. */
async function waitForResult(page: Page, timeoutMs: number): Promise<ResultPhase> {
  try {
    await page.locator(PHASE_SELECTOR).first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return 'timeout';
  }
  if ((await page.getByTestId('download-saved').count()) > 0) return 'saved';
  if ((await page.getByTestId('export-download').count()) > 0) return 'ready';
  if ((await page.getByTestId('export-failed').count()) > 0) return 'failed';
  if ((await page.getByTestId('export-canceled').count()) > 0) return 'canceled';
  return 'blocked';
}

/** Copies the file the stand-in save dialog received out of the page's storage. */
async function takeSavedFile(page: Page, testInfo: TestInfo, surface: Surface, item: CorpusItem): Promise<{ path: string; name: string } | null> {
  const name = (await pickerCalls(page)).at(-1);
  if (!name) return null;
  const path = await readSaved(page, testInfo, `saved-${name}`);
  const target = join(ensureDir(OUTPUTS), `${surface}-${item.id}-${name}`);
  copyFileSync(path, target);
  return { path: target, name };
}

async function measureCell(page: Page, testInfo: TestInfo, surface: Surface, item: CorpusItem, problems: PageProblems): Promise<Record<string, unknown>> {
  await installSavePicker(page);
  if (surface === 'yazi') {
    // The test-hooks build: a tiny model list and a scripted stand-in that hears nothing (tests/e2e/transcriptKit.ts).
    const models = testModels();
    await serveModels(page.context(), models);
    await installTranscriptTest(page, models, STUB_SCRIPT);
  }
  const started = Date.now();
  if (surface === 'editor') {
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible({ timeout: 60_000 });
  } else {
    await page.goto(`/yap/${surface}/`);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick', { timeout: 60_000 });
  }
  await expect(page.getByTestId('video-input')).toHaveCount(1);
  const pickedAt = Date.now();
  await page.getByTestId('video-input').setInputFiles(payloadOf(item));
  const first = await firstAnswer(page, problems, 60_000);
  const answerMs = Date.now() - pickedAt;

  let outcome: Outcome;
  let phase: ResultPhase | null = null;
  let saved: SavedFile | null = null;
  let kesitS: number | null = null;
  if (first === 'opened') {
    const driven = await drive(page, surface, item);
    kesitS = driven.kesitS;
    if (driven.pressed) {
      // Big pictures take longer to decode and encode; the bound is still a bound.
      const heavy = item.bytes > 5_000_000 || (item.width ?? 0) * (item.height ?? 0) > 4_000_000;
      phase = await waitForResult(page, heavy ? 240_000 : 150_000);
      if (phase === 'saved') {
        outcome = 'saved';
        const taken = await takeSavedFile(page, testInfo, surface, item).catch(() => null);
        if (taken) saved = measureSaved(taken.path, taken.name, surface, item, kesitS);
      } else if (phase === 'ready') outcome = 'ready';
      else if (phase === 'failed' || phase === 'canceled') outcome = 'failed';
      else if (phase === 'blocked') outcome = 'blocked';
      else outcome = 'stuck';
    } else {
      const now = await observe(page);
      outcome = now.messages.length > 0 && !now.stillBusy ? 'noop' : 'unclear';
    }
  } else if (first === 'refused') outcome = 'refused';
  else if (first === 'crash') outcome = 'crash';
  else outcome = 'silent';

  const seen = await observe(page).catch(() => ({ step: null, messages: [], stillBusy: false, downloadEnabled: false, controls: [] }));
  const dead = first === 'dead' || (await pageDead(page));
  const verdict = judge({ outcome, messages: seen.messages, controls: seen.controls, stillBusy: seen.stillBusy, saved, problems, dead }, item);
  return {
    surface,
    id: item.id,
    label: item.label,
    group: item.group,
    expect: item.expect,
    outcome,
    phase,
    answerMs,
    totalMs: Date.now() - started,
    step: seen.step,
    messages: seen.messages.map((message) => message.slice(0, 400)),
    controls: seen.controls,
    stillBusy: seen.stillBusy,
    kesitS,
    saved,
    pageErrors: problems.pageErrors,
    consoleErrors: [...new Set(problems.consoleErrors)].slice(0, 8),
    unhandledRejections: problems.unhandledRejections.slice(0, 8),
    watchdogReloads: problems.watchdogReloads,
    ...verdict,
  };
}
