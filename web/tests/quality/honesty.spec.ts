import { expect, test, type Page } from '@playwright/test';

import { enhanceFixture } from '../e2e/enhance-media';
import { installSavePicker, noSavePicker, opfsFiles, pickerCalls } from '../e2e/kesitFlow';
import { wizardFixture } from '../e2e/wizard-media';
import { SAMPLE, takeDownloadedFile, takeSavedFile, waitForResult } from './lib/app';
import { cameraLikeSource, probeFile } from './lib/media';
import { BUILD, round, writeResult } from './lib/record';
import { watchProblems } from './lib/screen';

/**
 * Section 4 — honesty of what the app says while it works.
 *
 *  - Progress: sampled every 40 ms from the press on "İndir" to the result.
 *    It must never go backwards and must not sit at 100 % while there is no
 *    file yet.
 *  - Success: at the moment the screen says "Kaydedildi" the file must be
 *    there, non-empty, and readable by ffprobe.
 *  - Cancel: "İptal et" must stop the work and leave nothing behind in the
 *    page's private storage (OPFS).
 *
 * What the e2e suite already proves is not measured again; the report cites
 * those tests by name (scripts/quality/citations.json).
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');

const CUT_SHORT = 'ölçüm betiği yarıda kaldı (zaman aşımı ya da hata); ayrıntı koşu günlüğünde';

interface Sample {
  t: number;
  percent: number | null;
  pass: string | null;
  phase: 'running' | 'saved' | 'ready' | 'other';
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __samples: unknown[]; __sampler?: number };
    w.__samples = [];
    const started = performance.now();
    w.__sampler = window.setInterval(() => {
      const running = document.querySelector('[data-testid="download-running"]');
      const bar = running?.querySelector('[role="progressbar"]');
      const now = bar?.getAttribute('aria-valuenow');
      w.__samples.push({
        t: Math.round(performance.now() - started),
        percent: now === null || now === undefined ? null : Number(now),
        pass: running?.getAttribute('data-pass') ?? null,
        phase: running
          ? 'running'
          : document.querySelector('[data-testid="download-saved"]')
            ? 'saved'
            : document.querySelector('[data-testid="export-download"]')
              ? 'ready'
              : 'other',
      });
    }, 40);
  });
}

async function stopSampling(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __samples: Sample[]; __sampler?: number };
    window.clearInterval(w.__sampler);
    return w.__samples;
  });
}

function readProgress(samples: Sample[]) {
  const running = samples.filter((sample) => sample.phase === 'running');
  let backwards = 0;
  let backwardsAcrossPasses = 0;
  let largestDrop = 0;
  let previous: Sample | null = null;
  for (const sample of running) {
    if (sample.percent === null) continue;
    if (previous && previous.percent !== null && sample.percent < previous.percent) {
      if (sample.pass === previous.pass) backwards += 1;
      else backwardsAcrossPasses += 1;
      largestDrop = Math.max(largestDrop, previous.percent - sample.percent);
    }
    previous = sample;
  }
  const at100 = running.filter((sample) => sample.percent !== null && sample.percent >= 100);
  const withNumber = running.filter((sample) => sample.percent !== null);
  const values = [...new Set(withNumber.map((sample) => sample.percent as number))];
  return {
    samples: running.length,
    samplesWithNumber: withNumber.length,
    distinctValues: values.length,
    first: withNumber[0]?.percent ?? null,
    last: withNumber.at(-1)?.percent ?? null,
    backwards,
    backwardsAcrossPasses,
    largestDrop,
    /** How long the bar showed 100 % while the work was still running. */
    msAt100BeforeFile: at100.length > 0 ? (at100.at(-1)?.t ?? 0) - (at100[0]?.t ?? 0) + 40 : 0,
    passes: [...new Set(running.map((sample) => sample.pass))].filter((pass) => pass !== null),
    runningMs: running.length > 0 ? (running.at(-1)?.t ?? 0) - (running[0]?.t ?? 0) : 0,
  };
}

interface Scenario {
  id: string;
  label: string;
  task: string;
  source: () => string;
  ready: (page: Page) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'dikey',
    label: 'Dikey yap: 12 sn’lik 1920 × 1080 video yeniden işlenir',
    task: 'dikey',
    source: cameraLikeSource,
    ready: async (page) => {
      await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 120_000 });
    },
  },
  {
    id: 'kucult-whatsapp',
    label: 'Küçült → WhatsApp: yaklaşık 24 MB’lık video 16 MB’ın altına iner',
    task: 'kucult',
    source: cameraLikeSource,
    ready: async (page) => {
      await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('size-hint-whatsapp')).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
      await page.getByTestId('option-whatsapp').check();
      await expect(page.getByTestId('wizard-download')).toBeEnabled();
    },
  },
  {
    id: 'iyilestir',
    label: 'İyileştir: ışığı değişen 10 sn’lik video',
    task: 'iyilestir',
    source: () => enhanceFixture('changing'),
    ready: async (page) => {
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
      await expect(page.getByTestId('wizard-download')).toBeEnabled({ timeout: 60_000 });
    },
  },
];

for (const scenario of SCENARIOS) {
  test(`honesty: progress and success — ${scenario.id}`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const part = `${testInfo.project.name}.progress-${scenario.id}`;
    writeResult('honesty', part, { kind: 'progress', id: scenario.id, label: scenario.label, measured: false, reason: CUT_SHORT });
    const problems = await watchProblems(page);
    await installSavePicker(page);
    await page.goto(`/yap/${scenario.task}/`);
    await page.getByTestId('video-input').setInputFiles(scenario.source());
    await scenario.ready(page);

    await startSampling(page);
    await page.getByTestId('wizard-download').click();
    const phase = await waitForResult(page);
    // What is in the file the moment the screen says it is saved.
    const name = (await pickerCalls(page)).at(-1) ?? '';
    const atSuccess = phase === 'saved' ? ((await opfsFiles(page))[`saved-${name}`] ?? 0) : null;
    const samples = await stopSampling(page);
    const progress = readProgress(samples);

    let fileOk: { bytes: number; durationS: number; streams: string[] } | null = null;
    let fileError: string | null = null;
    if (phase === 'saved') {
      try {
        const info = probeFile(await takeSavedFile(page, testInfo, `durust-${scenario.id}`));
        fileOk = { bytes: info.bytes, durationS: round(info.durationS, 3), streams: info.streams.map((stream) => `${stream.type}:${stream.codec}`) };
      } catch (error) {
        fileError = String((error as Error).message).slice(0, 200);
      }
    }
    writeResult('honesty', part, {
      kind: 'progress',
      id: scenario.id,
      label: scenario.label,
      measured: true,
      phase,
      progress,
      bytesWhenSuccessShown: atSuccess,
      file: fileOk,
      fileError,
      successWithoutFile: phase === 'saved' && (atSuccess === 0 || fileOk === null),
      pageErrors: problems.pageErrors,
      consoleErrors: problems.consoleErrors,
    });
  });
}

test('honesty: “ready” on the route without a save dialog points at a real file', async ({ page }, testInfo) => {
  await noSavePicker(page);
  await page.goto('/yap/cevir/');
  await page.getByTestId('video-input').setInputFiles(wizardFixture('webm'));
  await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wizard-download').click();
  const phase = await waitForResult(page);
  // What the browser really saves when the user presses the button (the page's own policy forbids reading the link from script).
  let bytes: number | null = null;
  if (phase === 'ready') {
    try {
      const file = await takeDownloadedFile(page, testInfo, 'durust-hazir', () => page.getByTestId('export-download').click());
      bytes = probeFile(file).bytes;
    } catch {
      bytes = 0;
    }
  }
  writeResult('honesty', `${testInfo.project.name}.ready-link`, {
    kind: 'ready-link',
    phase,
    bytesBehindTheLink: bytes,
    successWithoutFile: phase === 'ready' && (bytes === null || bytes <= 0),
  });
});

for (const route of ['save-dialog', 'no-save-dialog'] as const) {
  test(`honesty: cancel stops the work and leaves nothing behind — ${route}`, async ({ page }, testInfo) => {
    writeResult('honesty', `${testInfo.project.name}.cancel-${route}`, { kind: 'cancel', route, measured: false, reason: CUT_SHORT });
    const problems = await watchProblems(page);
    if (route === 'save-dialog') await installSavePicker(page);
    else await noSavePicker(page);
    await page.goto('/yap/dikey/');
    // 24 s at 1080 × 1920: long enough to press "İptal et" while it runs.
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    const before = await opfsFiles(page);
    await page.getByTestId('wizard-download').click();
    let reachedRunning = true;
    try {
      await expect(page.getByTestId('export-progress')).toBeVisible({ timeout: 60_000 });
      // Let it really work first: a number above zero.
      await expect
        .poll(async () => Number(await page.getByTestId('download-running').getByRole('progressbar').getAttribute('aria-valuenow')), { timeout: 60_000 })
        .toBeGreaterThan(3);
    } catch {
      reachedRunning = false;
    }
    const during = await opfsFiles(page).catch(() => ({}));
    let canceled = false;
    let cancelMs: number | null = null;
    if (reachedRunning && (await page.getByTestId('export-cancel').count()) > 0) {
      const pressed = Date.now();
      await page.getByTestId('export-cancel').click();
      try {
        await expect(page.getByTestId('export-canceled')).toBeVisible({ timeout: 30_000 });
        canceled = true;
        cancelMs = Date.now() - pressed;
      } catch {
        canceled = false;
      }
    }
    // The words a sighted user reads (the same sentence is also there, hidden, for screen readers).
    const message = canceled
      ? await page.getByTestId('export-canceled').evaluate((element) => {
          const pieces: string[] = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.parentElement?.closest('.visually-hidden, button')) continue;
            const piece = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (piece !== '') pieces.push(piece);
          }
          return pieces.join(' ');
        })
      : null;
    // Give a worker that did not stop the time to show itself.
    await page.waitForTimeout(4000);
    const after = await opfsFiles(page);
    const savedAppeared = (await page.locator('[data-testid="download-saved"], [data-testid="export-download"]').count()) > 0;
    const leftovers = Object.entries(after)
      .filter(([name]) => !(name in before))
      .map(([name, bytes]) => ({ name, bytes }));
    writeResult('honesty', `${testInfo.project.name}.cancel-${route}`, {
      kind: 'cancel',
      route,
      measured: true,
      reachedRunning,
      canceled,
      cancelMs,
      message,
      filesWhileRunning: Object.entries(during).map(([name, bytes]) => ({ name, bytes })),
      leftovers,
      /** The stand-in save dialog hands the app a file the USER chose: an empty one may stay, bytes in it may not. */
      leftoverBytes: leftovers.reduce((sum, item) => sum + item.bytes, 0),
      successAfterCancel: savedAppeared,
      pageErrors: problems.pageErrors,
      consoleErrors: problems.consoleErrors,
    });
  });
}
