import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';

import { lineTexts } from '../e2e/transcriptKit';
import { SPEECH } from './lib/app';
import { BUILD, round, writeResult } from './lib/record';

/**
 * Section 6, opt-in (`npm run quality -- --with-transcript`): the REAL
 * recogniser on the published build, on the one rights-clean sentence that
 * is in the repository (tests/media/speech-fleurs-en-01.mp4, FLEURS,
 * CC BY 4.0).
 *
 * It needs the model files of the small model on this machine
 * (`node scripts/fetch-models.mjs --models=base --dest=public/models`, 109 MB,
 * never in git). They are served to the page from disk by this spec, at the
 * address the published site has them (`/models/…`). Without them nothing is
 * measured and the report says so.
 *
 * One sentence is a smoke measurement, not transcript quality: the numbers
 * that describe quality are the recorded ones of ADR-036 (the realistic set
 * of 15 clips, 188 minutes), which the report prints with their date and
 * commit. Re-measuring those takes the set's media and hours
 * (scripts/transcript/run-app.mjs, score-real.mjs).
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');
test.skip(process.env.QUALITY_WITH_TRANSCRIPT !== '1', 'opt-in: --with-transcript');

const REFERENCE =
  'It was ruled by the "Vichy" French. These were French people who had made peace with the Germans in 1940 and worked with the invaders instead of fighting them.';

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate (Levenshtein over words), the strict measure of tests/e2e/transcript-real.spec.ts. */
function wer(reference: string, hypothesis: string): number {
  const ref = words(reference);
  const hyp = words(hypothesis);
  const row = Array.from({ length: hyp.length + 1 }, (_, index) => index);
  for (let i = 1; i <= ref.length; i += 1) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= hyp.length; j += 1) {
      const keep = row[j] as number;
      row[j] = Math.min((row[j] as number) + 1, (row[j - 1] as number) + 1, previous + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
      previous = keep;
    }
  }
  return (row[hyp.length] as number) / ref.length;
}

function modelsDir(): string | null {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src', 'domain', 'modelManifest.json'), 'utf8')) as {
    groups: Record<string, { dir: string; files: { path: string }[] }>;
  };
  for (const dir of [join(process.cwd(), 'out', 'models'), join(process.cwd(), 'public', 'models')]) {
    const complete = (['runtime', 'vad', 'base'] as const).every((id) =>
      (manifest.groups[id]?.files ?? []).every((file) => existsSync(join(dir, manifest.groups[id]?.dir ?? '', file.path))),
    );
    if (complete) return dir;
  }
  return null;
}

test('transcript: the real small model on one sentence', async ({ page, context }, testInfo) => {
  const dir = modelsDir();
  if (dir === null) {
    writeResult('transcript', testInfo.project.name, {
      measured: false,
      reason: 'küçük modelin dosyaları bu makinede yok (public/models ya da out/models); node scripts/fetch-models.mjs --models=base --dest=public/models',
    });
    return;
  }
  // The model files, from disk, with byte ranges like a static host.
  await context.route('**/models/**', async (route) => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/models/') + '/models/'.length));
    const file = normalize(join(dir, relative));
    if (!file.startsWith(dir) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    const size = statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] !== '' ? Math.min(size - 1, Number(range[2])) : size - 1;
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream(file, { start, end })) chunks.push(chunk as Buffer);
    return route.fulfill({
      status: range ? 206 : 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      },
      body: Buffer.concat(chunks),
    });
  });

  await page.goto('/yap/yazi/');
  await page.getByTestId('video-input').setInputFiles(SPEECH);
  await expect(page.getByTestId('transcribe-steps')).toBeVisible({ timeout: 60_000 });
  await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
  if ((await page.getByTestId('option-model-base').count()) > 0) await page.getByTestId('option-model-base').check();
  const downloadStarted = Date.now();
  if ((await page.getByTestId('model-download').count()) > 0) {
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 600_000 });
  }
  const modelS = (Date.now() - downloadStarted) / 1000;
  const started = Date.now();
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 600_000 });
  const transcribeS = (Date.now() - started) / 1000;
  const lines = await lineTexts(page);
  const text = lines.filter((line) => !line.startsWith('(')).join(' ');
  writeResult('transcript', testInfo.project.name, {
    measured: true,
    clip: 'speech-fleurs-en-01.mp4 (tek cümle, 27 kelime)',
    model: 'base',
    modelsFrom: dir,
    modelFetchS: round(modelS, 1),
    transcribeS: round(transcribeS, 1),
    lines,
    werPercent: round(wer(REFERENCE, text) * 100, 1),
    unclearLines: lines.filter((line) => line.startsWith('(')).length,
  });
});
