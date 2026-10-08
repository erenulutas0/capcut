import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { watchCsp } from './cspWatch';
import { enhanceFixture, frameLumas, frameRgb, laplacianVariance, rgbMeans } from './enhance-media';
import {
  addKesit,
  installSavePicker,
  openEditor,
  openSettings,
  openVideo,
  opfsFiles,
  pickerCalls,
  probeMp4,
  readSaved,
  sharedFiles,
  stubShare,
} from './kesitFlow';
import { bandLuma, meanVolumeDb } from './wizard-media';

/**
 * "İyileştir" (ADR-037), from the opening screen to the saved file, and the
 * same setting in the editor.
 *
 * The videos are synthetic (enhance-media.ts: fractal noise over colour
 * gradients, made by ffmpeg) but measure like camera pictures; the saved
 * files are read back with ffprobe / ffmpeg, tools that know nothing about
 * the app. The save dialog is the stand-in of kesitFlow.ts.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // a test card: flat graphics

const wizard = (page: Page) => page.getByTestId('wizard');
const preview = (page: Page) => page.getByTestId('enhance-preview');
const slider = (page: Page) => page.getByTestId('enhance-slider');

async function startTask(page: Page, file: string) {
  await page.goto('/');
  await page.getByTestId('task-iyilestir').click();
  await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
}

/** The before/after picture of the strength chosen now is on screen. */
async function previewReady(page: Page) {
  await expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
  await expect(page.getByTestId('iyilestir-summary')).toBeVisible();
}

/** Mean luma (0–255) of one of the two preview canvases, and its size. */
function canvasLuma(page: Page, testId: 'enhance-before' | 'enhance-after') {
  return page.evaluate((id) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"]`);
    if (!canvas) throw new Error(`no canvas ${id}`);
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) throw new Error('no pixels');
    let sum = 0;
    for (let at = 0; at < data.length; at += 4) sum += 0.2126 * (data[at] ?? 0) + 0.7152 * (data[at + 1] ?? 0) + 0.0722 * (data[at + 2] ?? 0);
    return { luma: sum / (data.length / 4), width: canvas.width, height: canvas.height };
  }, testId);
}

/** A preview canvas as 64 × 36 grey values, the way kesitFlow's `frameGray` reads a file's frame. */
function canvasGray(page: Page, testId: 'enhance-before' | 'enhance-after'): Promise<number[]> {
  return page.evaluate((id) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"]`);
    if (!canvas) throw new Error(`no canvas ${id}`);
    const small = document.createElement('canvas');
    small.width = 64;
    small.height = 36;
    const context = small.getContext('2d');
    if (!context) throw new Error('no context');
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, 64, 36);
    const data = context.getImageData(0, 0, 64, 36).data;
    const out: number[] = [];
    for (let at = 0; at < data.length; at += 4) out.push(0.2126 * (data[at] ?? 0) + 0.7152 * (data[at + 1] ?? 0) + 0.0722 * (data[at + 2] ?? 0));
    return out;
  }, testId);
}

function grayOfFile(file: string, atS: number): number[] {
  const rgb = frameRgb(file, atS, 64, 36);
  const out: number[] = [];
  for (let at = 0; at < rgb.length; at += 3) out.push(0.2126 * (rgb[at] ?? 0) + 0.7152 * (rgb[at + 1] ?? 0) + 0.0722 * (rgb[at + 2] ?? 0));
  return out;
}

function meanAbs(a: number[], b: number[]): number {
  expect(a.length).toBe(b.length);
  return a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0) / a.length;
}

async function download(page: Page) {
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
}

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

// ------------------------------------------------------------------ the wizard

test.describe('İyileştir: the wizard', () => {
  test('card → video → before/after → İndir: a dark video is saved brighter, frame for frame, sound untouched; three taps', async ({
    page,
    context,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const csp = await watchCsp(context);
    await stubShare(page);
    const source = enhanceFixture('dark');

    // Taps inside the app: the card, "Video seç" (the file dialog is the system's), İndir.
    let taps = 0;
    await page.goto('/');
    await page.getByTestId('task-iyilestir').click();
    taps += 1;
    await expect(page).toHaveURL(/\/yap\/iyilestir$/);
    await expect(page.getByTestId('wizard-step')).toContainText('İyileştir · Adım 1 / 3');
    await page.getByTestId('video-input').setInputFiles(source);
    taps += 1;

    // Step 2: the honest sentence, "Otomatik" already chosen, a real frame before and after.
    await expect(page.getByTestId('wizard-title')).toHaveText('Videonu toparlayalım');
    await expect(page.getByTestId('iyilestir-info')).toContainText('Işığı, rengi ve keskinliği toparlar. Çok bulanık bir videoyu netleştiremez.');
    await expect(page.getByTestId('option-auto')).toBeChecked();
    await previewReady(page);
    await expect(page.getByTestId('iyilestir-summary')).toHaveAttribute('data-light', 'much');
    await expect(page.getByTestId('iyilestir-summary')).toContainText('video belirgin biçimde aydınlatılır');
    // The slowness warning is there exactly when no graphics card does the work (this browser may
    // run WebGL on a software rasteriser — bundled Chromium does — or on a real GPU).
    const accelerated = await preview(page).getAttribute('data-accelerated');
    expect(['true', 'false']).toContain(accelerated);
    await expect(page.getByTestId('iyilestir-slow')).toHaveCount(accelerated === 'true' ? 0 : 1);
    const before = await canvasLuma(page, 'enhance-before');
    const after = await canvasLuma(page, 'enhance-after');
    // The picture is the export's size (720p for this 720p video), not a thumbnail.
    expect([before.width, before.height]).toEqual([1280, 720]);
    expect([after.width, after.height]).toEqual([1280, 720]);
    expect(after.luma).toBeGreaterThan(before.luma + 25);
    const previewFrame = Number(await preview(page).getAttribute('data-frame'));
    const previewAfter = await canvasGray(page, 'enhance-after');
    const previewBefore = await canvasGray(page, 'enhance-before');

    await download(page);
    taps += 1;
    expect(taps).toBe(3);
    expect(await pickerCalls(page)).toEqual(['karanlik_iyilestirilmis.mp4']);
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-karanlik_iyilestirilmis.mp4');
    await expect(page.getByTestId('wizard-title')).toHaveText('Kaydedildi');
    await expect(page.getByTestId('download-share')).toBeVisible();

    // The method line says the picture was re-encoded, and why.
    const method = page.getByTestId('export-method');
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-fallback', 'enhance');
    await expect(method).toHaveText('Görüntü yeniden işlendi (iyileştirme her kareyi değiştiriyor)');
    await expect(method).toHaveAttribute('data-frames-encoded', '90');
    await expect(method).toHaveAttribute('data-frames-copied', '0');

    // What was really done, from the worker's result.
    const outcome = page.getByTestId('export-enhance');
    await expect(outcome).toHaveAttribute('data-strength', 'auto');
    await expect(outcome).toHaveAttribute('data-light', 'much');
    await expect(outcome).toHaveAttribute('data-nothing', 'false');
    await expect(outcome).toHaveAttribute('data-enhanced-frames', '90');
    await expect(outcome).toContainText('İyileştirildi (Otomatik): video belirgin biçimde aydınlatıldı');
    expect(['webgl2', 'cpu']).toContain(await outcome.getAttribute('data-engine'));
    expect(Number(await outcome.getAttribute('data-analysed-frames'))).toBeGreaterThanOrEqual(5);

    // The saved file, measured from outside: same frames, same length, same size, brighter picture.
    const saved = await readSaved(page, testInfo, 'saved-karanlik_iyilestirilmis.mp4');
    const probe = probeMp4(saved);
    const original = probeMp4(source);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect([probe.width, probe.height]).toEqual([1280, 720]);
    expect(probe.frames).toBe(original.frames);
    expect(probe.frames).toBe(90);
    expect(probe.durationS).toBeCloseTo(3, 1);

    const lumaIn = frameLumas(source);
    const lumaOut = frameLumas(saved);
    expect(lumaOut).toHaveLength(90);
    // Every frame is brighter, by about the same amount: nothing black, nothing garbled, nothing flickering.
    for (let frame = 0; frame < 90; frame += 1) {
      expect(lumaOut[frame] ?? 0, `frame ${frame}`).toBeGreaterThan((lumaIn[frame] ?? 0) + 15);
    }
    const lift = lumaOut.map((value, frame) => value - (lumaIn[frame] ?? 0));
    expect(Math.max(...lift) - Math.min(...lift)).toBeLessThan(6);

    // The preview was that very frame of the export: what was shown is what was saved (the encoder's loss aside).
    const exported = grayOfFile(saved, previewFrame / 30 + 0.001);
    expect(meanAbs(exported, previewAfter)).toBeLessThan(5);
    expect(meanAbs(exported, previewBefore)).toBeGreaterThan(20);

    // The sound is the video's own: still there, as long as the video, as loud as it was.
    expect(Math.abs(meanVolumeDb(saved) - meanVolumeDb(source))).toBeLessThan(1.5);

    // The stand-in share sheet gets the saved file; nothing else was written.
    await page.getByTestId('download-share').click();
    await expect.poll(async () => (await sharedFiles(page)).length).toBe(1);
    expect((await sharedFiles(page))[0]?.name).toBe('saved-karanlik_iyilestirilmis.mp4');
    expect(Object.keys(await opfsFiles(page)).filter((name) => name.endsWith('.mp4'))).toEqual(['saved-karanlik_iyilestirilmis.mp4']);

    // Shaders are strings compiled by WebGL: nothing in this whole flow touched the Content-Security-Policy.
    expect(csp.violations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the line between before and after follows the pointer and the keyboard', async ({ page }) => {
    await startTask(page, enhanceFixture('dark'));
    await previewReady(page);
    const range = slider(page);
    await expect(range).toHaveAttribute('aria-label', 'Öncesi ile sonrası arasındaki çizgi');
    await expect(range).toHaveValue('50');
    await expect(range).toHaveAttribute('aria-valuetext', 'Resmin yüzde 50 kadarı önceki hâli');

    const split = () => page.getByTestId('enhance-frame').evaluate((frame) => getComputedStyle(frame).getPropertyValue('--ba-split').trim());
    /** How much of the earlier picture is uncovered, as a share of the frame's width. */
    const uncovered = () =>
      page.evaluate(() => {
        const beforeCanvas = document.querySelector<HTMLElement>('[data-testid="enhance-before"]');
        const line = document.querySelector<HTMLElement>('.ba-line');
        const frame = document.querySelector<HTMLElement>('[data-testid="enhance-frame"]');
        if (!beforeCanvas || !line || !frame) throw new Error('preview missing');
        const frameBox = frame.getBoundingClientRect();
        const lineBox = line.getBoundingClientRect();
        return {
          clip: getComputedStyle(beforeCanvas).clipPath,
          line: (lineBox.left + lineBox.width / 2 - frameBox.left) / frameBox.width,
        };
      });
    expect(await split()).toBe('50%');
    expect((await uncovered()).line).toBeCloseTo(0.5, 1);

    // Keyboard: arrows step, Home and End jump, Page Up / Down take bigger steps.
    await range.focus();
    await page.keyboard.press('ArrowRight');
    await expect(range).toHaveValue('51');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(range).toHaveValue('49');
    await page.keyboard.press('Home');
    await expect(range).toHaveValue('0');
    expect(await split()).toBe('0%');
    expect((await uncovered()).line).toBeCloseTo(0, 1);
    await page.keyboard.press('End');
    await expect(range).toHaveValue('100');
    await expect(range).toHaveAttribute('aria-valuetext', 'Resmin yüzde 100 kadarı önceki hâli');
    expect((await uncovered()).line).toBeCloseTo(1, 1);
    await page.keyboard.press('PageDown');
    expect(Number(await range.inputValue())).toBeLessThan(100);

    // Pointer: a click at a quarter of the picture puts the line there, and a drag takes it along.
    const box = await page.getByTestId('enhance-frame').boundingBox();
    if (!box) throw new Error('no preview frame');
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
    expect(Math.abs(Number(await range.inputValue()) - 25)).toBeLessThanOrEqual(1);
    expect((await uncovered()).line).toBeCloseTo(0.25, 1);
    expect((await uncovered()).clip).toContain('inset(');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 6 });
    await page.mouse.up();
    expect(Math.abs(Number(await range.inputValue()) - 80)).toBeLessThanOrEqual(1);
    expect((await uncovered()).line).toBeCloseTo(0.8, 1);
  });

  test('one choice: Hafif / Otomatik / Güçlü change the picture in that order; "Başka bir kare" shows another frame', async ({
    page,
  }) => {
    await startTask(page, enhanceFixture('dark'));
    await previewReady(page);
    await expect(page.getByTestId('iyilestir-choice')).toContainText('Ne kadar?');
    for (const value of ['light', 'auto', 'strong']) await expect(page.getByTestId(`option-${value}`)).toBeVisible();
    const before = (await canvasLuma(page, 'enhance-before')).luma;
    const auto = (await canvasLuma(page, 'enhance-after')).luma;
    const firstFrame = await preview(page).getAttribute('data-frame');

    await page.getByTestId('option-light').check();
    // While the new picture is made the download waits; then it is back.
    await previewReady(page);
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
    const light = (await canvasLuma(page, 'enhance-after')).luma;
    expect((await canvasLuma(page, 'enhance-before')).luma).toBeCloseTo(before, 0);

    // The keyboard changes the choice too (a radio group: arrows move and select).
    await page.getByTestId('option-light').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('option-auto')).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('option-strong')).toBeChecked();
    await previewReady(page);
    const strong = (await canvasLuma(page, 'enhance-after')).luma;

    expect(light).toBeGreaterThan(before + 3);
    expect(auto).toBeGreaterThan(light + 5);
    expect(strong).toBeGreaterThanOrEqual(auto - 0.5);

    await page.getByTestId('enhance-other-frame').click();
    await expect(preview(page)).not.toHaveAttribute('data-frame', firstFrame ?? '');
    await previewReady(page);
    expect((await canvasLuma(page, 'enhance-after')).luma).toBeGreaterThan((await canvasLuma(page, 'enhance-before')).luma + 20);
  });

  test('a video with nothing to fix is told so: no download that would change nothing, no save dialog', async ({ page }) => {
    await startTask(page, SAMPLE);
    await previewReady(page);
    const summary = page.getByTestId('iyilestir-summary');
    await expect(summary).toHaveAttribute('data-nothing', 'true');
    await expect(summary).toContainText('değiştirilecek bir şey bulunamadı');
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('wizard-blocked')).toContainText('Bu ayarla videoda hiçbir şey değişmiyor');
    // Before and after are the same picture.
    const same = meanAbs(await canvasGray(page, 'enhance-before'), await canvasGray(page, 'enhance-after'));
    expect(same).toBe(0);
    // "Güçlü" finds nothing either on a test card: its levels are a design, not an exposure.
    await page.getByTestId('option-strong').check();
    await previewReady(page);
    await expect(summary).toHaveAttribute('data-nothing', 'true');
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    expect(await pickerCalls(page)).toEqual([]);
    // The editor is still one tap away.
    await expect(page.getByTestId('wizard-open-editor')).toBeVisible();
  });

  test('a soft video is sharpened and a grainy one is calmed, as the summary said', async ({ page }, testInfo) => {
    // Soft.
    const soft = enhanceFixture('soft');
    await startTask(page, soft);
    await previewReady(page);
    await expect(page.getByTestId('iyilestir-summary')).toHaveAttribute('data-sharpen', 'true');
    await expect(page.getByTestId('iyilestir-summary')).toContainText('kenarlar keskinleştirilir');
    await download(page);
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-sharpen', 'true');
    const savedSoft = await readSaved(page, testInfo, 'saved-bulanik_iyilestirilmis.mp4');
    const sharpness = (file: string) => laplacianVariance(frameRgb(file, 1.5, 1280, 720), 1280, 720);
    expect(sharpness(savedSoft)).toBeGreaterThan(sharpness(soft) * 1.2);
    expect(probeMp4(savedSoft).frames).toBe(90);

    // Grainy.
    await page.getByTestId('wizard-again').click();
    const noisy = enhanceFixture('noisy');
    await page.getByTestId('video-input').setInputFiles(noisy);
    await previewReady(page);
    await expect(page.getByTestId('iyilestir-summary')).toHaveAttribute('data-denoise', 'true');
    await expect(page.getByTestId('iyilestir-summary')).toContainText('kumlanma azaltılır');
    await download(page);
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-denoise', 'true');
    const savedNoisy = await readSaved(page, testInfo, 'saved-kumlu_iyilestirilmis.mp4');
    // Grain is high-frequency energy: much less of it after.
    expect(sharpness(savedNoisy)).toBeLessThan(sharpness(noisy) * 0.5);
    expect(probeMp4(savedNoisy).frames).toBe(90);
  });

  test('the correction follows a changing exposure without flicker', async ({ page }, testInfo) => {
    const source = enhanceFixture('changing');
    await startTask(page, source);
    await previewReady(page);
    // Where no graphics card does the work this is said before the download (ten seconds of 720p: under two minutes, so
    // the general sentence; the "about N minutes" wording is unit-tested, `slowEnhanceNotice`).
    if ((await preview(page).getAttribute('data-accelerated')) === 'false') {
      await expect(page.getByTestId('iyilestir-slow')).toHaveAttribute('data-kind', 'general');
    }
    await download(page);
    const saved = await readSaved(page, testInfo, 'saved-degisen-isik_iyilestirilmis.mp4');
    expect(probeMp4(saved).frames).toBe(300);
    const input = frameLumas(source);
    const output = frameLumas(saved);
    expect(output).toHaveLength(300);

    const steps = (values: number[]) => values.slice(1).map((value, index) => value - (values[index] ?? 0));
    const inSteps = steps(input);
    const outSteps = steps(output);
    // The source has two sudden changes (at 6 s and 8 s) and a slow rise; the export adds no jump of its own:
    // its largest frame-to-frame change is no larger than the source's largest.
    const largest = (values: number[]) => Math.max(...values.map(Math.abs));
    expect(largest(outSteps)).toBeLessThanOrEqual(largest(inSteps) + 2);
    // Away from the two sudden changes (±1 s), the brightness moves as calmly as the source's does.
    const calm = (frame: number) => Math.abs(frame - 180) > 30 && Math.abs(frame - 240) > 30;
    const jitter = (values: number[]) => {
      // Mean absolute second difference: what the eye sees as flicker.
      let sum = 0;
      let count = 0;
      for (let i = 1; i < values.length; i += 1) {
        if (!calm(i) || !calm(i + 1)) continue;
        sum += Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0));
        count += 1;
      }
      return sum / Math.max(1, count);
    };
    expect(jitter(outSteps)).toBeLessThan(jitter(inSteps) + 0.35);
    // And the dark stretches really were lifted: the first second and the dark step are brighter than in the source.
    const mean = (values: number[], from: number, to: number) => values.slice(from, to).reduce((sum, value) => sum + value, 0) / (to - from);
    expect(mean(output, 0, 30)).toBeGreaterThan(mean(input, 0, 30) + 15);
    expect(mean(output, 195, 225)).toBeGreaterThan(mean(input, 195, 225) + 15);
    // The well-exposed stretch is left as it was. (This limit was not changed when the test failed on
    // another checkout's fixture, 8 Oct 2026: the plan was — see ADR-037 and enhanceSensitivity.test.ts.
    // The light correction there is now exactly nothing; what is left is colour and the encoder.)
    expect(Math.abs(mean(output, 135, 165) - mean(input, 135, 165))).toBeLessThan(6);
    // ... and so is the end of the slow rise, which is well exposed already.
    expect(Math.abs(mean(output, 105, 135) - mean(input, 105, 135))).toBeLessThan(6);
  });

  test('without graphics acceleration the same picture is made by the reference renderer, and the result says so', async ({
    page,
  }, testInfo) => {
    const source = enhanceFixture('dark');
    // First with the default engine.
    await startTask(page, source);
    await previewReady(page);
    const engine = await preview(page).getAttribute('data-engine');
    await download(page);
    const usual = await readSaved(page, testInfo, 'saved-karanlik_iyilestirilmis.mp4');
    const usualRgb = frameRgb(usual, 1.5, 320, 180);

    // Then the reference renderer (the test hook stands in for a browser without WebGL2).
    await page.addInitScript(() => {
      (window as unknown as { __clipEnhanceEngine?: string }).__clipEnhanceEngine = 'cpu';
    });
    await startTask(page, source);
    await previewReady(page);
    await expect(preview(page)).toHaveAttribute('data-engine', 'cpu');
    // Said before the download, not after: this device will be slow (a 3-second video: the general sentence).
    await expect(preview(page)).toHaveAttribute('data-accelerated', 'false');
    await expect(page.getByTestId('iyilestir-slow')).toHaveText(
      'Bu cihazda ekran kartı hızlandırması yok. İyileştirme yine çalışır ama yavaştır: 5 dakikalık bir video yarım saatten uzun sürebilir.',
    );
    await download(page);
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-engine', 'cpu');
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-accelerated', 'false');
    await expect(page.getByTestId('export-enhance')).toContainText('Ekran kartı hızlandırması olmadan yapıldı.');
    const cpu = await readSaved(page, testInfo, 'saved-karanlik_iyilestirilmis.mp4');
    expect(probeMp4(cpu).frames).toBe(90);
    const cpuRgb = frameRgb(cpu, 1.5, 320, 180);

    // Whichever engine ran first, the two files show the same picture (both went through the same encoder).
    testInfo.annotations.push({ type: 'engine', description: String(engine) });
    const a = rgbMeans(usualRgb);
    const b = rgbMeans(cpuRgb);
    expect(Math.abs(a.luma - b.luma)).toBeLessThan(1);
    expect(Math.abs(a.r - b.r)).toBeLessThan(1.5);
    expect(Math.abs(a.b - b.b)).toBeLessThan(1.5);
    let difference = 0;
    for (let at = 0; at < usualRgb.length; at += 1) difference += Math.abs((usualRgb[at] ?? 0) - (cpuRgb[at] ?? 0));
    expect(difference / usualRgb.length).toBeLessThan(2);
  });
});

// ------------------------------------------------------------------ the editor

test.describe('İyileştir: the editor setting', () => {
  test('"Daha fazla ayar → editörde aç" carries the strength into Ayarlar → Görüntü, where it applies to every download', async ({
    page,
  }, testInfo) => {
    const source = enhanceFixture('dark');
    await startTask(page, source);
    await previewReady(page);
    await page.getByTestId('option-strong').check();
    await previewReady(page);
    await page.getByTestId('wizard-open-editor').click();

    // The editor, in place, over the same video and the same recipe.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/yap\/iyilestir$/);
    await openSettings(page, 'frame');
    const setting = page.getByTestId('enhance-strength');
    await expect(setting).toHaveValue('strong');
    await expect(page.getByTestId('enhance-setting')).toContainText('çok bulanık bir videoyu netleştiremez');
    // The same before/after, made the same way, in the drawer.
    await expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
    expect((await canvasLuma(page, 'enhance-after')).luma).toBeGreaterThan((await canvasLuma(page, 'enhance-before')).luma + 25);

    // Changing it there is one undo step.
    await setting.selectOption('light');
    await expect(setting).toHaveValue('light');
    await expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('undo').click();
    await openSettings(page, 'frame');
    await expect(page.getByTestId('enhance-strength')).toHaveValue('strong');
    await page.getByTestId('enhance-strength').selectOption('light');
    await page.keyboard.press('Escape');

    // Every download of the editor is enhanced: the whole video here.
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-strength', 'light');
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-fallback', 'enhance');
    const name = (await pickerCalls(page)).at(-1) ?? '';
    const saved = await readSaved(page, testInfo, `saved-${name}`);
    expect(probeMp4(saved).frames).toBe(90);
    const lumaIn = frameLumas(source);
    const lumaOut = frameLumas(saved);
    expect((lumaOut[45] ?? 0) - (lumaIn[45] ?? 0)).toBeGreaterThan(3);
  });

  test('off by default; switched on it is stored with the project and comes back after a reload; off again restores a plain download', async ({
    page,
  }, testInfo) => {
    const source = enhanceFixture('dark');
    await openEditor(page);
    await openVideo(page, source);
    // One kesit over the whole video: a project the editor stores and restores.
    await addKesit(page, '00:00.000', '00:03.000');
    await openSettings(page, 'frame');
    const setting = page.getByTestId('enhance-strength');
    await expect(setting).toHaveValue('off');
    // Off: the video is not even looked at.
    await expect(preview(page)).toHaveCount(0);
    await expect(page.getByLabel('Görüntüyü iyileştir')).toBeVisible();

    await setting.selectOption('auto');
    await expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
    await expect(page.getByTestId('enhance-setting-summary')).toContainText('video belirgin biçimde aydınlatılır');
    await page.keyboard.press('Escape');

    // The recipe in the browser's project store carries it (EDL v4).
    const stored = () =>
      page.evaluate(
        () =>
          new Promise<{ schemaVersion: number; enhance: unknown } | null>((resolve) => {
            const open = indexedDB.open('clip-editor');
            open.onerror = () => resolve(null);
            open.onsuccess = () => {
              const db = open.result;
              const request = db.transaction('projects', 'readonly').objectStore('projects').getAll();
              request.onsuccess = () => {
                const record = (request.result as Array<{ edl: { schemaVersion: number; enhance?: unknown } }>)[0];
                db.close();
                resolve(record ? { schemaVersion: record.edl.schemaVersion, enhance: record.edl.enhance ?? null } : null);
              };
              request.onerror = () => {
                db.close();
                resolve(null);
              };
            };
          }),
      );
    await expect.poll(stored, { timeout: 15_000 }).toEqual({ schemaVersion: 4, enhance: { strength: 'auto' } });

    // After a reload the project asks for its video again and the setting is still on.
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('relink-video-input').setInputFiles(source);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await openSettings(page, 'frame');
    await expect(page.getByTestId('enhance-strength')).toHaveValue('auto');

    // Enhanced download of the whole video; the step "Videona bakılıyor…" is real work with a real share.
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __steps: Set<string> }).__steps = seen;
      new MutationObserver(() => {
        for (const node of Array.from(document.querySelectorAll('.dl-step'))) seen.add(node.textContent ?? '');
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    const steps = await page.evaluate(() => Array.from((window as unknown as { __steps: Set<string> }).__steps));
    expect(steps).toContain('Videona bakılıyor…');
    await expect(page.getByTestId('export-enhance')).toHaveAttribute('data-strength', 'auto');
    const enhancedName = (await pickerCalls(page)).at(-1) ?? '';
    // Measured now: the next download has the same name and replaces this file.
    const lumaEnhanced = frameLumas(await readSaved(page, testInfo, `saved-${enhancedName}`));

    // Off again: the next download has no enhancement line and its picture is the source's.
    await page.getByTestId('download-dismiss').click();
    await openSettings(page, 'frame');
    await page.getByTestId('enhance-strength').selectOption('off');
    await page.keyboard.press('Escape');
    await expect.poll(stored, { timeout: 15_000 }).toEqual({ schemaVersion: 4, enhance: null });
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('export-enhance')).toHaveCount(0);
    await expect(page.getByTestId('export-method')).not.toHaveAttribute('data-fallback', 'enhance');
    const plain = await readSaved(page, testInfo, `saved-${(await pickerCalls(page)).at(-1) ?? ''}`);

    const lumaIn = frameLumas(source);
    const lumaPlain = frameLumas(plain);
    expect(lumaPlain).toHaveLength(90);
    expect(lumaEnhanced).toHaveLength(90);
    expect(Math.abs((lumaPlain[45] ?? 0) - (lumaIn[45] ?? 0))).toBeLessThan(3);
    expect((lumaEnhanced[45] ?? 0) - (lumaPlain[45] ?? 0)).toBeGreaterThan(25);
  });

  test('"Sığdır" in a vertical frame: the picture is enhanced, the bars stay black', async ({ page }, testInfo) => {
    const source = enhanceFixture('dark');
    await openEditor(page);
    await openVideo(page, source);
    await openSettings(page, 'frame');
    await page.getByTestId('aspect-9-16').click();
    await page.getByTestId('fit-contain').check();
    await page.getByTestId('export-quality').selectOption('720');
    await page.getByTestId('enhance-strength').selectOption('strong');
    await expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
    // The preview shows the frame as it will be saved: 720 × 1280 with the picture in the middle.
    expect(await canvasLuma(page, 'enhance-after')).toMatchObject({ width: 720, height: 1280 });
    await page.keyboard.press('Escape');
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    const saved = await readSaved(page, testInfo, `saved-${(await pickerCalls(page)).at(-1) ?? ''}`);
    const probe = probeMp4(saved);
    expect([probe.width, probe.height]).toEqual([720, 1280]);
    expect(probe.frames).toBe(90);
    // 1280 × 720 fitted into 720 × 1280 is 720 × 405 in the middle: rows 437.5 – 842.5.
    expect(bandLuma(saved, 1.5, { y: 20, height: 380 })).toBeLessThanOrEqual(2);
    expect(bandLuma(saved, 1.5, { y: 880, height: 380 })).toBeLessThanOrEqual(2);
    // The picture itself is clearly brighter than the dark source's (mean luma about 77).
    expect(bandLuma(saved, 1.5, { y: 450, height: 380 })).toBeGreaterThan(100);
  });
});
