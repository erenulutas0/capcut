import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { enhanceFixture, frameLumas, frameRgb, laplacianVariance, rgbMeans } from '../e2e/enhance-media';
import { addKesit, installSavePicker } from '../e2e/kesitFlow';
import { takeSavedFile, waitForResult } from './lib/app';
import { buildReference, cameraLikeSource, cameraLikeWebm, fidelity, hasVmaf, loadAvSync, playableEverywhere, probeFile, syncSource, syncWebm, type Fidelity, syncHeavy } from './lib/media';
import { BUILD, SOURCES, ensureDir, round, writeResult } from './lib/record';
import { watchProblems } from './lib/screen';

/**
 * Section 5 — what is in the files, measured with ffmpeg / ffprobe.
 *
 * For Kes, Küçült, Dikey yap and Her yerde açılsın:
 *  - sound against picture, on the flash-and-chirp clip of
 *    scripts/lib/av-sync.mjs (as H.264 MP4, and as VP9 WebM so that every
 *    task has to re-encode it);
 *  - length against what was asked for;
 *  - the picture against the same edit made by ffmpeg alone (SSIM, PSNR, and
 *    VMAF where the local ffmpeg has libvmaf), on a generated camera-like
 *    video;
 *  - for Küçült, the size against the target;
 *  - "opens everywhere": H.264 / AAC / yuv420p, index first, sane timestamps.
 *
 * For İyileştir the measures of ADR-037 are reused (tests/e2e/enhance-media.ts):
 * mean luma before and after, sharpness (Laplacian variance), and that a
 * video with nothing to fix is not offered a download.
 *
 * Each export is timed (press on the download button → file ready): the
 * report's export speed (× real time) comes from here, taken under the
 * machine-wide measure lock.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');

type Task = 'kes' | 'kucult' | 'dikey' | 'cevir';

const CUT_SHORT = 'ölçüm betiği yarıda kaldı (zaman aşımı ya da hata); ayrıntı koşu günlüğünde';

interface OutCase {
  id: string;
  task: Task;
  label: string;
  source: () => Promise<string> | string;
  kind: 'sync' | 'picture';
  /** Kes: the range asked for, in seconds. */
  range?: [number, number];
  /**
   * Küçült: the option to choose. Without one the choice is left as the app made it (WhatsApp); a video
   * that already fits every size has nothing to download there, and the script then takes the way the
   * step points at ("Daha da küçült").
   */
  size?: 'whatsapp' | 'email' | 'share';
  /** The ffmpeg filter that makes the same picture (reference), given the source's size. */
  referenceFilter?: string;
}

const CASES: OutCase[] = [
  { id: 'kes-senkron-mp4', task: 'kes', label: 'Kes 2–8 sn, senkron klibi (H.264 MP4)', source: syncSource, kind: 'sync', range: [2, 8] },
  { id: 'kes-senkron-webm', task: 'kes', label: 'Kes 2–8 sn, senkron klibi (VP9 WebM)', source: async () => syncWebm(await syncSource()), kind: 'sync', range: [2, 8] },
  { id: 'dikey-senkron-mp4', task: 'dikey', label: 'Dikey yap, senkron klibi (zaten 9:16)', source: syncSource, kind: 'sync' },
  { id: 'cevir-senkron-mp4', task: 'cevir', label: 'Her yerde açılsın, senkron klibi (H.264 MP4)', source: syncSource, kind: 'sync' },
  { id: 'cevir-senkron-webm', task: 'cevir', label: 'Her yerde açılsın, senkron klibi (VP9 WebM)', source: async () => syncWebm(await syncSource()), kind: 'sync' },
  { id: 'kucult-senkron-agir', task: 'kucult', label: 'Küçült (seçim değişmeden: WhatsApp), ağır senkron klibi (H.264, yaklaşık 33 MB)', source: async () => syncHeavy(await syncSource()), kind: 'sync' },
  { id: 'kes-goruntu', task: 'kes', label: 'Kes 2,5–5,5 sn, kamera benzeri 1080p', source: cameraLikeSource, kind: 'picture', range: [2.5, 5.5], referenceFilter: 'null' },
  { id: 'dikey-goruntu', task: 'dikey', label: 'Dikey yap (Doldur), kamera benzeri 1080p', source: cameraLikeSource, kind: 'picture', referenceFilter: 'crop=ih*9/16:ih' },
  { id: 'kucult-goruntu', task: 'kucult', label: 'Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB', source: cameraLikeSource, kind: 'picture', size: 'whatsapp', referenceFilter: 'null' },
  { id: 'cevir-goruntu', task: 'cevir', label: 'Her yerde açılsın, kamera benzeri 720p VP9 WebM', source: cameraLikeWebm, kind: 'picture', referenceFilter: 'null' },
];

const SIZE_BYTES = { whatsapp: 16_000_000, email: 25_000_000, share: 52_000_000 } as const;

async function exportThrough(page: Page, item: OutCase, source: string): Promise<{ phase: string; elapsedS: number; method: string | null; fits: string | null; shown: string | null }> {
  await page.goto(`/yap/${item.task}/`);
  await page.getByTestId('video-input').setInputFiles(source);
  let button = page.getByTestId('wizard-download');
  if (item.task === 'kes') {
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 120_000 });
    await addKesit(page, String(item.range?.[0]), String(item.range?.[1]));
    await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    button = page.getByTestId('kesit-download').first();
  } else if (item.task === 'kucult') {
    await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 120_000 });
    for (const id of ['share', 'email', 'whatsapp']) {
      await expect(page.getByTestId(`size-hint-${id}`)).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
    }
    if (item.size) await page.getByTestId(`option-${item.size}`).check();
    else if ((await page.getByTestId('option-half').count()) > 0) {
      // Already under every size: the app offers no download for the sizes it fits, and says so.
      await expect(page.getByTestId('size-hint-half')).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
      await page.getByTestId('option-half').check();
    }
  } else if (item.task === 'dikey') {
    await page.waitForSelector('[data-testid="dikey-choice"], [data-testid="dikey-already"]', { timeout: 120_000 });
  } else {
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 120_000 });
  }
  // A step that offers no download (it says why next to the button) is a result, not a failed measurement.
  const enabled = await expect(button)
    .toBeEnabled({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (!enabled) {
    const said = await page.getByTestId('wizard-blocked').innerText({ timeout: 2000 }).catch(() => null);
    return { phase: 'indirme sunulmadı', elapsedS: 0, method: null, fits: null, shown: said ? said.replace(/\s+/g, ' ').trim().slice(0, 240) : null };
  }
  const pressed = Date.now();
  await button.click();
  const phase = await waitForResult(page, 180_000);
  const elapsedS = (Date.now() - pressed) / 1000;
  const method = await page.getByTestId('export-method').first().getAttribute('data-method', { timeout: 2000 }).catch(() => null);
  const fits = await page.getByTestId('target-size-result').first().getAttribute('data-fits', { timeout: 2000 }).catch(() => null);
  // When it did not end with a file: what the screen says, for the report.
  const shown =
    phase === 'saved'
      ? null
      : await page
          .locator('[data-testid="download-running"], [data-testid="export-failed"], [data-testid="export-blocked"], [data-testid="export-over-limit"], [data-testid="kesit-panel"], [data-testid="wizard-result"]')
          .first()
          .innerText({ timeout: 2000 })
          .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, 240))
          .catch(() => null);
  return { phase, elapsedS, method, fits, shown };
}

test('output: the sources’ own sound-against-picture offsets', async ({}, testInfo) => {
  const av = await loadAvSync();
  const mp4 = await syncSource();
  const webm = syncWebm(mp4);
  writeResult('output', `${testInfo.project.name}.sources`, {
    kind: 'sources',
    vmafAvailable: hasVmaf(),
    syncMp4: av.avSync(mp4),
    syncWebm: av.avSync(webm),
    camera: (() => {
      const info = probeFile(cameraLikeSource());
      return { bytes: info.bytes, durationS: info.durationS, width: info.video?.width, height: info.video?.height };
    })(),
  });
});

for (const item of CASES) {
  test(`output: ${item.id}`, async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    // Written first: if this script is cut short the row says so instead of being missing.
    writeResult('output', `${testInfo.project.name}.${item.id}`, { kind: item.kind, id: item.id, task: item.task, label: item.label, measured: false, reason: CUT_SHORT });
    const problems = await watchProblems(page);
    await installSavePicker(page);
    const source = await item.source();
    const sourceInfo = probeFile(source);
    const requestedS = item.range ? item.range[1] - item.range[0] : sourceInfo.durationS;
    const run = await exportThrough(page, item, source);
    const base = {
      kind: item.kind,
      id: item.id,
      task: item.task,
      label: item.label,
      phase: run.phase,
      method: run.method,
      exportS: round(run.elapsedS, 2),
      pageErrors: problems.pageErrors,
      consoleErrors: problems.consoleErrors,
    };
    if (run.phase !== 'saved') {
      writeResult('output', `${testInfo.project.name}.${item.id}`, {
        ...base,
        measured: false,
        reason: `indirme “${run.phase}” ile bitti${run.shown ? `; ekranda: “${run.shown}”` : ''}`,
      });
      return;
    }
    const file = await takeSavedFile(page, testInfo, `cikti-${item.id}`);
    const out = probeFile(file);
    const result: Record<string, unknown> = {
      ...base,
      measured: true,
      bytes: out.bytes,
      sourceBytes: sourceInfo.bytes,
      width: out.video?.width ?? null,
      height: out.video?.height ?? null,
      fps: out.video?.fps ? round(out.video.fps, 3) : null,
      requestedS: round(requestedS, 3),
      durationS: round(out.durationS, 3),
      durationErrorMs: Math.round(Math.abs(out.durationS - requestedS) * 1000),
      videoDurationErrorMs: out.video?.durationS ? Math.round(Math.abs(out.video.durationS - requestedS) * 1000) : null,
      audioDurationErrorMs: out.audio?.durationS ? Math.round(Math.abs(out.audio.durationS - requestedS) * 1000) : null,
      speedXRealtime: round(out.durationS / run.elapsedS, 2),
      playable: playableEverywhere(file, sourceInfo.audio !== null),
    };
    if (item.kind === 'sync') {
      const av = await loadAvSync();
      result.avSync = av.avSync(file);
      result.avSyncSource = av.avSync(source);
    }
    if (item.kind === 'picture' && item.referenceFilter && out.video?.width && out.video.height && sourceInfo.video?.width && sourceInfo.video.height) {
      // Compared at the SOURCE's size, so a download at a lower resolution pays for it in the numbers.
      const compareAt =
        item.task === 'dikey'
          ? { width: out.video.width, height: out.video.height }
          : { width: sourceInfo.video.width, height: sourceInfo.video.height };
      const reference = buildReference(source, join(ensureDir(SOURCES), `referans-${item.id}.mp4`), {
        startS: item.range?.[0] ?? 0,
        lengthS: requestedS,
        filter: item.referenceFilter,
        width: compareAt.width,
        height: compareAt.height,
      });
      let measuredFidelity: Fidelity | null = null;
      let fidelityError: string | null = null;
      try {
        measuredFidelity = fidelity(file, reference, compareAt);
      } catch (error) {
        fidelityError = String((error as Error).message).slice(0, 200);
      }
      result.fidelity = measuredFidelity;
      result.fidelityError = fidelityError;
      result.comparedAt = `${compareAt.width} × ${compareAt.height}`;
    }
    if (item.size) {
      const target = SIZE_BYTES[item.size];
      result.targetBytes = target;
      result.fitsTarget = out.bytes <= target;
      result.targetUsedPercent = round((out.bytes / target) * 100, 1);
      result.appSaysFits = run.fits;
    }
    writeResult('output', `${testInfo.project.name}.${item.id}`, result);
  });
}

test('output: İyileştir — the measures of ADR-037 on the synthetic set', async ({ page }, testInfo) => {
  writeResult('output', `${testInfo.project.name}.iyilestir`, { kind: 'enhance', rows: [], reason: CUT_SHORT });
  await installSavePicker(page);
  const rows: Array<Record<string, unknown>> = [];
  for (const name of ['dark', 'soft', 'noisy', 'good'] as const) {
    const source = enhanceFixture(name);
    await page.goto('/yap/iyilestir/');
    await page.getByTestId('video-input').setInputFiles(source);
    await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
    await expect(page.getByTestId('iyilestir-summary')).toBeVisible();
    const summary = page.getByTestId('iyilestir-summary');
    const said = {
      nothing: (await summary.getAttribute('data-nothing')) === 'true',
      light: await summary.getAttribute('data-light'),
      colour: await summary.getAttribute('data-colour'),
      sharpen: await summary.getAttribute('data-sharpen'),
      denoise: await summary.getAttribute('data-denoise'),
      text: ((await summary.textContent()) ?? '').trim(),
    };
    const download = page.getByTestId('wizard-download');
    const offered = (await download.count()) > 0 && (await download.isEnabled());
    // Whether a graphics card did the work in this browser (Playwright's Chromium may draw WebGL in software).
    const accelerated = (await page.getByTestId('enhance-preview').getAttribute('data-accelerated')) === 'true';
    const row: Record<string, unknown> = { fixture: name, said, downloadOffered: offered, accelerated };
    if (offered) {
      const pressed = Date.now();
      await download.click();
      const phase = await waitForResult(page);
      row.phase = phase;
      row.exportS = round((Date.now() - pressed) / 1000, 2);
      if (phase === 'saved') {
        const file = await takeSavedFile(page, testInfo, `cikti-iyilestir-${name}`);
        const out = probeFile(file);
        const before = frameRgb(source, 1.5, 640, 360);
        const after = frameRgb(file, 1.5, 640, 360);
        const lumasBefore = frameLumas(source);
        const lumasAfter = frameLumas(file);
        const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
        // Frame-to-frame brightness jumps the source does not have: flicker added by the correction.
        let worstJump = 0;
        for (let i = 1; i < Math.min(lumasBefore.length, lumasAfter.length); i += 1) {
          const jump = Math.abs((lumasAfter[i] ?? 0) - (lumasAfter[i - 1] ?? 0)) - Math.abs((lumasBefore[i] ?? 0) - (lumasBefore[i - 1] ?? 0));
          if (jump > worstJump) worstJump = jump;
        }
        row.durationS = round(out.durationS, 3);
        row.speedXRealtime = round(out.durationS / (row.exportS as number), 2);
        row.lumaBefore = round(mean(lumasBefore), 1);
        row.lumaAfter = round(mean(lumasAfter), 1);
        row.sharpnessBefore = round(laplacianVariance(before, 640, 360), 1);
        row.sharpnessAfter = round(laplacianVariance(after, 640, 360), 1);
        row.frameLumaBefore = round(rgbMeans(before).luma, 1);
        row.frameLumaAfter = round(rgbMeans(after).luma, 1);
        row.worstAddedBrightnessJump = round(worstJump, 2);
        row.frames = lumasAfter.length;
        row.sourceFrames = lumasBefore.length;
      }
    }
    rows.push(row);
  }
  writeResult('output', `${testInfo.project.name}.iyilestir`, { kind: 'enhance', rows });
});
