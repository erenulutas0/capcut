import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { watchCsp } from './cspWatch';
import { installSavePicker, probeMp4, readSaved } from './kesitFlow';

/**
 * "Yazıya dök" with the REAL model (ADR-036): Whisper `base` on WebAssembly,
 * Silero VAD, the real model store — nothing stood in for.
 *
 * It needs the model files next to the site (`public/models/`, 109 MB,
 * placed by `node scripts/fetch-models.mjs --dest=public/models`; never in
 * git). Where they are absent these tests are SKIPPED and say so — they are
 * not counted as passed. CI restores the files from its cache
 * (.github/workflows/ci.yml).
 *
 * The speech is one FLEURS sentence (CC BY 4.0, tests/media/SPEECH_SOURCE.md);
 * the non-speech clip is generated here with ffmpeg.
 */

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src', 'domain', 'modelManifest.json'), 'utf8')) as {
  groups: Record<string, { dir: string; files: { path: string }[] }>;
};
const MODELS = join(process.cwd(), 'public', 'models');
const present = (['runtime', 'vad', 'base'] as const).every((id) =>
  manifest.groups[id]!.files.every((file) => existsSync(join(MODELS, manifest.groups[id]!.dir, file.path))),
);

const SPEECH = join(process.cwd(), 'tests', 'media', 'speech-fleurs-en-01.mp4');
const REFERENCE =
  'It was ruled by the "Vichy" French. These were French people who had made peace with the Germans in 1940 and worked with the invaders instead of fighting them.';

/** 12 s with no speech at all: a chord that swells and fades over a low noise, like a film's opening. */
function musicFixture(): string {
  const dir = join(process.cwd(), 'tests', 'media', 'transcript-e2e');
  const file = join(dir, 'muzik-konusma-yok.mp4');
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  const chord = '0.18*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.6+0.4*sin(2*PI*0.5*t))';
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=5:d=12',
      '-f', 'lavfi', '-i', `aevalsrc=exprs=${chord.replace(/,/g, '\\,')}:s=48000:d=12`,
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.02:sample_rate=48000:duration=12',
      '-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0[a]', '-map', '0:v', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, file);
  return file;
}

/** The brightest luma (0–255) in a horizontal band of one frame: white subtitle text, or only the black picture? */
function brightest(file: string, atS: number, band: { y: number; height: number }): number {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', atS.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `crop=iw:${band.height}:0:${band.y},format=gray`, '-f', 'rawvideo', 'pipe:1'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const bytes = result.stdout as unknown as Buffer;
  if (result.status !== 0 || bytes.length < 1) throw new Error(`ffmpeg failed: ${String(result.stderr)}`);
  let max = 0;
  for (const value of bytes) if (value > max) max = value;
  return max;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate against the reference (Levenshtein over words). */
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

async function runWizard(page: Page, file: string) {
  await page.goto('/yap/yazi');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('transcribe-steps')).toBeVisible({ timeout: 60_000 });
  await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
  if (await page.getByTestId('model-download').count()) {
    // The real size, on the button, before anything is fetched.
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈108,8 MB, bir kez)');
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 300_000 });
  }
  await page.getByTestId('transcribe-start').click();
}

test.describe('Yazıya dök with the real model', () => {
  test.describe.configure({ timeout: 600_000 });
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!present, 'the model files are not in public/models (node scripts/fetch-models.mjs --dest=public/models) — NOT RUN');

  test('real speech is written, timed and burned in; no request leaves the site; then the same offline', async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const watch = await watchCsp(context);
    await watch.attach(page);
    const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1').origin;
    const outside: string[] = [];
    const modelRequests: string[] = [];
    context.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('blob:') || url.startsWith('data:')) return;
      if (!url.startsWith(origin)) outside.push(url);
      else if (url.includes('/models/')) modelRequests.push(url);
    });
    await installSavePicker(page);

    // The recogniser's script (Transformers.js + onnxruntime-web, ~570 KB) is fetched only when
    // a transcription starts: not by the opening screen, not by the wizard page, not by the model download.
    const engineScripts: string[] = [];
    const bodies: Array<Promise<void>> = [];
    context.on('response', (response) => {
      if (!/\.js(\?|$)/.test(response.url())) return;
      bodies.push(
        response
          .text()
          .then((body) => {
            if (body.includes('onnxruntime') && body.includes('WhisperForConditionalGeneration')) engineScripts.push(response.url());
          })
          .catch(() => undefined),
      );
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SPEECH);
    await expect(page.getByTestId('transcribe-steps')).toBeVisible({ timeout: 60_000 });
    await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await Promise.all(bodies);
    expect(engineScripts, 'no recogniser script before "Yazıya dök"').toEqual([]);

    await runWizard(page, SPEECH);
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 300_000 });
    await Promise.all(bodies);
    expect(engineScripts.length, 'the recogniser script arrived with the transcription').toBeGreaterThan(0);
    // The model's files came from this site, under /models/, and from nowhere else.
    expect(modelRequests.length).toBeGreaterThan(5);
    expect(outside).toEqual([]);

    const text = (await page.locator('[data-testid="transcript-row"][data-kind="cue"] .transcript-text').allTextContents()).join(' ');
    // Whisper base hears "Vicki" for "Vichy": two word errors in 29 is what the spike measured for this clip.
    expect(wer(REFERENCE, text), text).toBeLessThanOrEqual(0.12);
    expect(text).toContain('French people who had made peace with the Germans in 1940');
    await expect(page.getByTestId('transcript-machine-note')).toContainText('Otomatik yazıldı');
    // Timed: the speech starts about 0.8 s in, and the first line says so.
    await expect(page.getByTestId('transcript-row').first().locator('.transcript-time')).toHaveText('0:00');
    await page.getByTestId('transcript-row').nth(1).getByTestId('transcript-line').click();
    const at = await page.getByTestId('wizard-video').evaluate((video: HTMLVideoElement) => video.currentTime);
    expect(at).toBeGreaterThan(1.5);
    expect(at).toBeLessThan(5);

    // The burned-in download: white subtitle text appears on the black picture, in the lower part.
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    const saved = await readSaved(page, test.info(), 'saved-speech-fleurs-en-01_altyazili.mp4');
    const probe = probeMp4(saved);
    expect(probe.videoCodec).toBe('h264');
    // As long as the source (its picture runs two seconds past the 9.6 s of speech).
    expect(probe.durationS).toBeCloseTo(probeMp4(SPEECH).durationS, 0);
    const lower = { y: Math.round(probe.height * 0.72), height: Math.round(probe.height * 0.26) };
    expect(brightest(saved, 4, lower), 'a subtitle is on screen at 4 s').toBeGreaterThan(200);
    expect(brightest(saved, 0.2, lower), 'before the first word the picture is black').toBeLessThan(40);

    expect(watch.violations).toEqual([]);
    expect(outside).toEqual([]);

    // Offline, after the model is in the browser: a new video is still written.
    modelRequests.length = 0;
    await context.setOffline(true);
    await page.getByTestId('wizard-again').click();
    await page.getByTestId('video-input').setInputFiles(SPEECH);
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 300_000 });
    const again = (await page.locator('[data-testid="transcript-row"][data-kind="cue"] .transcript-text').allTextContents()).join(' ');
    expect(again).toBe(text);
    expect(modelRequests).toEqual([]);
    await context.setOffline(false);
    expect(watch.violations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('music without speech: nothing is invented', async ({ page }) => {
    await runWizard(page, musicFixture());
    await page.waitForSelector('[data-testid="transcript-panel"], [data-testid="transcribe-failed"]', { timeout: 300_000 });
    // Either nothing was heard at all, or what the detector let through is shown as "(anlaşılamadı)" — never as words.
    const cues = await page.locator('[data-testid="transcript-row"][data-kind="cue"]').count();
    expect(cues).toBe(0);
    if (await page.getByTestId('transcribe-failed').count()) {
      await expect(page.getByTestId('transcribe-failed')).toHaveAttribute('data-reason', 'nothing_heard');
    } else {
      const shown = await page.locator('[data-testid="transcript-row"] .transcript-text').allTextContents();
      expect(shown.every((line) => line === '(anlaşılamadı)')).toBe(true);
      await expect(page.getByTestId('wizard-download')).toBeDisabled();
    }
  });
});
