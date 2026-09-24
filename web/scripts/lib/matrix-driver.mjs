/**
 * Shared app driver and measurement checks for the matrix runners.
 *
 * `run-matrix.mjs` (synthetic doc 22 fixtures) and `run-real-media.mjs`
 * (a user's own recordings) must exercise exactly the same code paths, so the
 * driving and the assessment live here once.
 */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assessHdrExport, blackFrames } from './hdr-check.mjs';
import { emptyTimeline } from './range-flow.mjs';
import {
  bandRmsDb,
  buildReference,
  captionBox,
  captionRegion,
  extractFramePng,
  ffprobeJson,
  labelRuns,
  loadCaptionLayoutModule,
  loadCaptionsModule,
  measureCaptionBurnIn,
  measureCaptionIdentity,
  peakDb,
  perFrameSsim,
  ssim,
} from './media-measure.mjs';

/** 'mm:ss.mmm' (the moment fields' format) to microseconds. */
function clockToUs(text) {
  const [minutes, seconds] = text.split(':');
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 1_000_000);
}

/**
 * Where source-time lines must appear in the output, computed HERE from the
 * ADR-016 rule and nothing else: a moment cut from source [S, E) that starts
 * at output O shows the part of a line inside [S, E) at O + (t − S).
 *
 * Deliberately not `outputCues` from the app: the measurement must be able to
 * disagree with the code it is checking. `outputCues` is only compared
 * against this afterwards, as a cross-check.
 */
export function anchoredExpectation(moments, sourceCues) {
  const shown = [];
  let outputStartUs = 0;
  for (const [from, to] of moments) {
    const S = clockToUs(from);
    const E = clockToUs(to);
    for (const cue of sourceCues) {
      const a = Math.max(cue.startUs, S);
      const b = Math.min(cue.endUs, E);
      if (b > a) shown.push({ text: cue.text, startUs: outputStartUs + (a - S), endUs: outputStartUs + (b - S) });
    }
    outputStartUs += E - S;
  }
  return shown.sort((p, q) => p.startUs - q.startUs);
}

/** Short, stable name for a caption line in reports: its first line. */
const cueLabel = (text) => text.split('\n')[0];

/**
 * Every string `wrapCaptionText` may ask the width of for these texts: each
 * run of consecutive words of each paragraph. (No word here is wider than a
 * line, so the per-character split never runs.)
 */
function measuredStrings(texts) {
  const out = new Set();
  for (const text of texts) {
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(' ');
      for (let i = 0; i < words.length; i += 1) {
        for (let j = i + 1; j <= words.length; j += 1) out.add(words.slice(i, j).join(' '));
      }
    }
  }
  return [...out];
}

/**
 * @param {{ mediaDir: string, outDir: string, baseURL: string }} ctx
 */
/** A committed, known-good file used to check the app still works after a refusal. */
const RECOVERY_FILE = fileURLToPath(new URL('../../tests/media/sample-24s.mp4', import.meta.url));

export function createDriver({ mediaDir, outDir, baseURL }) {
  const FRAME_TOLERANCE = 1 / 30 + 0.002;
  /** The app's caption layout, transpiled once per run (see media-measure). */
  let captionLayoutModule = null;
  /** The app's captions.ts, for cross-checking the independent expectation only. */
  let captionsModule = null;
  /** Per-frame caption labels of anchored runs, so M18b can be compared to M18. */
  const anchoredLabels = new Map();

  /**
   * Waits until one of several test ids is present, and says which.
   *
   * `Promise.race` over `waitFor()` calls proved flaky here: a rejection that is
   * caught still settles the race, so a slow happy path could be read as a
   * failure. Polling the counts is slower but deterministic, which matters more
   * for a run whose output becomes a published support matrix.
   */
  async function waitForAny(page, testIds, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const id of testIds) {
        if ((await page.getByTestId(id).count()) > 0) return id;
      }
      await page.waitForTimeout(150);
    }
    return null;
  }

  /* ------------------------------------------------------------ app driving */

  async function drive(page, testCase, artefactPath) {
    const setup = testCase.setup;
    const notes = [];

    await page.goto(`${baseURL}/editor`);
    await page.getByTestId('open-export').waitFor({ timeout: 30_000 });

    // --- import ------------------------------------------------------------
    await page.getByTestId('video-input').setInputFiles(join(mediaDir, setup.video));

    // A file can be refused at import (unplayable, too large) or accepted. Wait
    // for whichever happens instead of assuming the happy path.
    const preview = page.getByTestId('preview-video');
    const importError = page.getByTestId('media-error');
    const importOutcome = await waitForAny(page, ['preview-video', 'media-error'], 90_000);

    if (importOutcome !== 'preview-video') {
      const message = ((await importError.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

      // The app must still work afterwards: a good file must import cleanly.
      await page.getByTestId('video-input').setInputFiles(RECOVERY_FILE);
      const recovered = (await waitForAny(page, ['preview-video'], 60_000)) === 'preview-video';

      return {
        importRejected: true,
        importMessage: message || '(mesaj görünmedi)',
        appStillUsable: recovered,
        notes,
      };
    }

    const editorDisplaySize = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video ? [video.videoWidth, video.videoHeight] : null;
    });

    // --- moments -----------------------------------------------------------
    await emptyTimeline(page);
    if (setup.repeatMoment) {
      const { count, lengthSeconds } = setup.repeatMoment;
      for (let i = 0; i < count; i += 1) {
        const from = i * lengthSeconds;
        await page.getByTestId('range-start').fill(from.toFixed(3));
        await page.getByTestId('range-end').fill((from + lengthSeconds).toFixed(3));
        await page.getByTestId('add-moment').click();
      }
      if (setup.expectExtraRejected) {
        await page.getByTestId('range-start').fill('15.000');
        await page.getByTestId('range-end').fill('16.000');
        await page.getByTestId('add-moment').click();
        const error = await page.getByTestId('range-error').textContent().catch(() => null);
        notes.push(`21. an reddi: ${error ? error.trim() : 'MESAJ YOK'}`);
      }
    } else {
      for (const [from, to] of setup.moments ?? []) {
        await page.getByTestId('range-start').fill(from);
        await page.getByTestId('range-end').fill(to);
        await page.getByTestId('add-moment').click();
      }
    }

    const momentCount = (await page.getByTestId('moment-count').textContent()) ?? '';

    // --- framing -----------------------------------------------------------
    if (setup.aspect) await page.getByTestId(`aspect-${setup.aspect}`).click();

    // --- music -------------------------------------------------------------
    if (setup.music) {
      await page.getByTestId('audio-input').setInputFiles(join(mediaDir, setup.music));
      await page.getByRole('tab', { name: 'Ses' }).click();
      await page.getByTestId('music-in').waitFor({ timeout: 30_000 });

      if (setup.musicSegment) {
        // Order matters: widen the selection before moving its start point.
        await page.getByTestId('music-out').fill(setup.musicSegment.outTime);
        await page.getByTestId('music-out').blur();
        await page.getByTestId('music-in').fill(setup.musicSegment.inTime);
        await page.getByTestId('music-in').blur();
        await page.getByTestId('music-start').fill(setup.musicSegment.startTime);
        await page.getByTestId('music-start').blur();
      }
      if (setup.musicGainDb !== undefined) {
        await page.getByTestId('music-gain').fill(String(setup.musicGainDb));
      }
      if (setup.fades) {
        await page.locator('#fade-in').fill(setup.fades.inTime);
        await page.locator('#fade-in').blur();
        await page.locator('#fade-out').fill(setup.fades.outTime);
        await page.locator('#fade-out').blur();
      }
    }

    // --- losing access to the source, then getting it back -----------------
    let relinked = false;
    if (setup.reloadBeforeExport) {
      // Wait for THIS recipe to really be stored before throwing the page
      // away. The "Kaydedildi" badge alone is not proof: cases share one
      // browser context, and the badge can still describe the previous save
      // while the debounced one for the new moments has not run yet — then the
      // reload restores an older case's project.
      const expected = {
        clips: (setup.moments ?? []).length,
        bytes: statSync(join(mediaDir, setup.video)).size,
      };
      // Polled with page.evaluate, not waitForFunction: waitForFunction does
      // not await a returned Promise, and a Promise object is truthy — so it
      // "passed" at once and the page reloaded before the save.
      const readStored = () =>
        page.evaluate(
          ({ clips, bytes }) =>
            new Promise((resolve) => {
              const open = indexedDB.open('clip-editor');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('projects')) {
                  db.close();
                  resolve(false);
                  return;
                }
                const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
                all.onerror = () => {
                  db.close();
                  resolve(false);
                };
                all.onsuccess = () => {
                  db.close();
                  resolve(
                    all.result.some(
                      (r) =>
                        r.edl?.clips?.length === clips &&
                        r.bindings?.some((b) => b.kind === 'video' && b.sizeBytes === bytes),
                    ),
                  );
                };
              };
            }),
          expected,
        );
      let stored = false;
      const storeDeadline = Date.now() + 30_000;
      while (!stored && Date.now() < storeDeadline) {
        stored = await readStored();
        if (!stored) await page.waitForTimeout(250);
      }
      if (!stored) {
        return { failed: true, failureText: 'proje yenilemeden önce kaydedilmedi', notes };
      }
      await page.reload();

      const after = await waitForAny(page, ['relink-video', 'preview-video'], 60_000);
      if (after !== 'relink-video') {
        return { failed: true, failureText: 'yeniden yükleme sonrası re-link istenmedi', notes };
      }
      notes.push(
        `yeniden yükleme sonrası aranan dosya: ${(await page.getByTestId('relink-filename').textContent()) ?? '?'}`,
      );
      await page.getByTestId('relink-video-input').setInputFiles(join(mediaDir, setup.video));
      await waitForAny(page, ['preview-video'], 60_000);
      relinked = (await page.getByTestId('preview-video').count()) > 0;
      notes.push(`yeniden bağlandı: ${relinked ? 'evet' : 'hayır'}`);
    }

    if (setup.captions) {
      return driveCaptionExports(page, testCase, artefactPath, { momentCount, editorDisplaySize, notes });
    }
    if (setup.anchoredCaptions) {
      return driveAnchoredCaptionExports(page, testCase, artefactPath, { momentCount, editorDisplaySize, notes });
    }

    const outcome = await exportOnce(page, setup, artefactPath, notes);
    return { ...outcome, momentCount, editorDisplaySize, relinked, notes };
  }

  /**
   * Opens the export dialog, runs the gate and, when it passes, exports and
   * saves the file. Shared by the plain cases and the caption variants.
   */
  async function exportOnce(page, setup, savePath, notes) {
    await page.getByTestId('open-export').click();
    if (setup.quality) {
      await page.getByTestId('export-quality').selectOption(setup.quality);
    }

    const blocked = page.getByTestId('export-blocked');
    await waitForAny(page, ['export-ready', 'export-blocked'], 90_000);

    const gate = {};
    for (const row of ['gate-environment', 'gate-encoder', 'gate-selftest', 'gate-source']) {
      gate[row.replace('gate-', '')] = ((await page.getByTestId(row).textContent().catch(() => '')) ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if ((await blocked.count()) > 0) {
      const blockerTexts = await page.getByTestId('export-blockers').allTextContents().catch(() => []);
      const body = ((await blocked.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      return { blocked: true, gate, blockerTexts, blockedText: body };
    }

    await page.getByTestId('export-create').click();
    await waitForAny(page, ['export-running', 'export-succeeded', 'export-failed'], 60_000);

    if (setup.backgroundDuringExport) {
      // Push the page to the background while it encodes.
      const other = await page.context().newPage();
      await other.goto(`${baseURL}/`);
      await other.bringToFront();
      notes.push('export sırasında sekme arka plana alındı');
      await page.waitForTimeout(1500);
      await other.close();
      await page.bringToFront();
    }

    const succeeded = page.getByTestId('export-succeeded');
    const failed = page.getByTestId('export-failed');
    await waitForAny(page, ['export-succeeded', 'export-failed'], 300_000);

    if ((await failed.count()) > 0) {
      const text = ((await failed.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      return { failed: true, failureText: text, gate };
    }

    const reported = {
      duration: await succeeded.locator('[data-testid="measured-duration"]').textContent(),
      resolution: await succeeded.locator('[data-testid="measured-resolution"]').textContent(),
      codecs: await succeeded.locator('[data-testid="measured-codecs"]').textContent(),
      delta: await succeeded.locator('[data-testid="measured-delta"]').textContent(),
    };
    // ADR-027: how the video was produced (copy / smart / encode) and why not faster.
    const method = succeeded.locator('[data-testid="measured-method"]');
    if ((await method.count()) > 0) {
      reported.method = await method.getAttribute('data-method');
      reported.fallbackReason = (await method.getAttribute('data-fallback')) || null;
      reported.framesEncoded = Number(await method.getAttribute('data-frames-encoded'));
    }
    // Held frames are an honest partial result, and must show up in reports.
    const held = succeeded.locator('[data-testid="measured-frames-missing"]');
    if ((await held.count()) > 0) {
      notes.push(`çözülemeyen kare: ${((await held.textContent()) ?? '').trim()}`);
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-download').click();
    const download = await downloadPromise;
    await download.saveAs(savePath);

    return { exported: true, gate, reported };
  }

  /* ------------------------------------------------------------- captions */

  /**
   * Reads the stored project record the editor saved for the open project.
   * Polled with page.evaluate: waitForFunction does not await a Promise.
   */
  async function readStoredRecord(page, matches, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const records = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('clip-editor');
            open.onerror = () => resolve([]);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('projects')) {
                db.close();
                resolve([]);
                return;
              }
              const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
              all.onerror = () => {
                db.close();
                resolve([]);
              };
              all.onsuccess = () => {
                db.close();
                resolve(all.result);
              };
            };
          }),
      );
      // Newest first: cases share one browser profile, so older projects with
      // the same file and moments can still be in storage.
      const hits = records.filter(matches);
      hits.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (hits[0]) return hits[0];
      await page.waitForTimeout(250);
    }
    return null;
  }

  /**
   * Gives the project captions through a supported app path — the backup
   * import — rather than any caption editing UI, then exports once per style
   * variant. The recipe the editor saved is taken, captions are added to it,
   * and it goes back in through `.clip.json` validation like any user backup.
   */
  async function driveCaptionExports(page, testCase, artefactPath, base) {
    const setup = testCase.setup;
    const { notes } = base;
    const aspect = (setup.aspect ?? '').replace('-', ':');
    const bytes = statSync(join(mediaDir, setup.video)).size;
    const clips = (setup.moments ?? []).length;

    const record = await readStoredRecord(
      page,
      (r) =>
        r.edl?.clips?.length === clips &&
        r.edl?.canvas?.aspect === aspect &&
        r.bindings?.some((b) => b.kind === 'video' && b.sizeBytes === bytes),
    );
    if (!record) return { failed: true, failureText: 'proje kaydı bulunamadı (yedek alınamadı)', notes, ...base };

    captionLayoutModule ??= await loadCaptionLayoutModule(outDir);
    const runs = [];
    for (const [index, variant] of setup.captions.variants.entries()) {
      const trackId = `t_${testCase.id.toLowerCase()}_${index + 1}`;
      const backup = structuredClone(record);
      // Adding captions is an edit, so the revision moves on, as it would in
      // the editor. A changed revision is also what makes the editor autosave
      // the restored project, which is how the import is confirmed below. The
      // step is large because the export dialog's quality setting is an edit
      // too and may already have moved the live revision past `record`.
      backup.edl.revision = record.edl.revision + 1000 * (index + 1);
      backup.edl.captionTracks = [
        {
          trackId,
          origin: 'manual',
          timeBase: 'output',
          language: 'tr',
          style: variant.style,
          cues: setup.captions.cues.map((cue, cueIndex) => ({
            cueId: `q_${index + 1}_${cueIndex + 1}`,
            startUs: cue.startUs,
            endUs: cue.endUs,
            text: cue.text,
          })),
        },
      ];
      const backupPath = join(outDir, `${testCase.id}-${variant.label}.clip.json`);
      writeFileSync(backupPath, JSON.stringify(backup, null, 2));

      await page.getByTestId('backup-input').setInputFiles(backupPath);
      // Proof the import really went through the app: the restored project,
      // captions included, is saved back to storage by the editor itself.
      const restored = await readStoredRecord(page, (r) => r.edl?.captionTracks?.[0]?.trackId === trackId);
      if (!restored) {
        return { failed: true, failureText: `yedek içe aktarılamadı (${variant.label})`, ...base };
      }
      notes.push(`${variant.label}: yedekten ${restored.edl.captionTracks[0].cues.length} altyazı satırı yüklendi`);

      const view = await waitForAny(page, ['relink-video', 'preview-video'], 30_000);
      if (view === 'relink-video') {
        await page.getByTestId('relink-video-input').setInputFiles(join(mediaDir, setup.video));
        await waitForAny(page, ['preview-video'], 60_000);
      }

      const savePath = index === 0 ? artefactPath : artefactPath.replace(/\.mp4$/, `-${variant.label}.mp4`);
      const outcome = await exportOnce(page, setup, savePath, notes);
      if (!outcome.exported) return { ...outcome, ...base };

      runs.push({ label: variant.label, style: variant.style, path: savePath, gate: outcome.gate, reported: outcome.reported });
      // Close the dialog so the next import starts from a clean export state.
      await page.keyboard.press('Escape');
      await page.getByTestId('export-succeeded').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    }

    const first = runs[0];
    return {
      exported: true,
      gate: first?.gate,
      reported: first?.reported,
      captionRuns: runs,
      ...base,
    };
  }

  /**
   * Widths of caption strings with the bundled caption font, measured in the
   * editor page (the same engine and font file the export worker draws with).
   * Waits for the editor's own font load; null when the font never loads.
   */
  async function measureCaptionWidths(page, strings, fontPx) {
    return page.evaluate(
      async ({ strings: list, px }) => {
        const family = 'Clip Caption';
        const ours = () => [...document.fonts].filter((face) => face.family.replaceAll('"', '') === family);
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const faces = ours();
          if (faces.length > 0 && faces.every((face) => face.status === 'loaded')) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const faces = ours();
        if (faces.length === 0 || !faces.every((face) => face.status === 'loaded')) return null;
        const font = `700 ${px}px "${family}"`;
        await document.fonts.load(font, list.join(' '));
        const context = document.createElement('canvas').getContext('2d');
        context.font = font;
        return Object.fromEntries(list.map((text) => [text, context.measureText(text).width]));
      },
      { strings, px: fontPx },
    );
  }

  /**
   * M18/M18b: a SOURCE-time caption track (or its output-time conversion)
   * reaches the project through the backup import, like M17, and the edit is
   * exported once per variant. A variant with `track: null` is exported
   * before any import, as the caption-free negative control.
   */
  async function driveAnchoredCaptionExports(page, testCase, artefactPath, base) {
    const setup = testCase.setup;
    const spec = setup.anchoredCaptions;
    const { notes } = base;
    const aspect = (setup.aspect ?? '').replace('-', ':');
    const bytes = statSync(join(mediaDir, setup.video)).size;
    const sourceIns = setup.moments.map(([from]) => clockToUs(from));

    // Match THIS case's project: same file, same moments in the same order.
    // Its caption track is NOT assumed empty: the editor reopens the previous
    // case's project and picking the video keeps that project's captions, so
    // every variant below sets the track explicitly through the backup.
    const sameEdit = (r) =>
      r.edl?.canvas?.aspect === aspect &&
      JSON.stringify(r.edl?.clips?.map((clip) => clip.sourceInUs)) === JSON.stringify(sourceIns) &&
      r.bindings?.some((b) => b.kind === 'video' && b.sizeBytes === bytes);
    const record = await readStoredRecord(page, sameEdit);
    if (!record) {
      return {
        failed: true,
        failureText: `proje kaydı bulunamadı (yedek alınamadı); editördeki an sayısı: ${base.momentCount.trim()}`,
        ...base,
      };
    }
    const video = record.edl.assets.find((asset) => asset.kind === 'video');
    if (!video) return { failed: true, failureText: 'kayıtta video kaynağı yok', ...base };

    const expected = anchoredExpectation(setup.moments, spec.sourceCues);

    // Caption boxes from the app's layout + the browser's font measure.
    captionLayoutModule ??= await loadCaptionLayoutModule(outDir);
    captionsModule ??= await loadCaptionsModule(outDir);
    const [width, height] = testCase.expect.size;
    const frame = { width, height, aspect };
    const texts = spec.sourceCues.map((cue) => cue.text);
    const probe = captionLayoutModule.layoutCaption(texts[0], spec.style, frame, () => 0);
    const fontPx = probe.ok ? probe.layout.fontPx : null;
    const widths = fontPx ? await measureCaptionWidths(page, measuredStrings(texts), fontPx) : null;
    if (!widths) return { failed: true, failureText: 'altyazı fontu sayfada yüklenmedi; kutular ölçülemez', ...base };
    const measure = (text) => {
      if (!(text in widths)) throw new Error(`ölçülmemiş metin: ${text}`);
      return widths[text];
    };
    const boxes = texts.map((text) => ({ label: cueLabel(text), box: captionBox(captionLayoutModule, text, spec.style, frame, measure) }));
    notes.push(
      `kutular (${fontPx}px): ${boxes.map((b) => `${b.label} ${b.box.width}x${b.box.height}@${b.box.x},${b.box.y}`).join('; ')}`,
    );

    const runs = [];
    let appOutputCues = null;
    for (const [index, variant] of spec.variants.entries()) {
      const savePath = index === 0 ? artefactPath : artefactPath.replace(/\.mp4$/, `-${variant.label}.mp4`);
      const trackId = `t_${testCase.id.toLowerCase()}_${variant.label}`;
      const backup = structuredClone(record);
      backup.edl.revision = record.edl.revision + 1000 * (index + 1);
      const cues =
        variant.track === 'source'
          ? spec.sourceCues
          : // The output-time version of the same track, built with the
            // independent rule: each appearance becomes its own line.
            expected;
      backup.edl.captionTracks =
        variant.track === null
          ? []
          : [
              {
                trackId,
                origin: 'imported',
                timeBase: variant.track,
                ...(variant.track === 'source' ? { assetId: video.assetId } : {}),
                language: 'tr',
                style: spec.style,
                cues: cues.map((cue, cueIndex) => ({
                  cueId: `q_${String(cueIndex + 1).padStart(3, '0')}`,
                  startUs: cue.startUs,
                  endUs: cue.endUs,
                  text: cue.text,
                })),
              },
            ];
      const backupPath = join(outDir, `${testCase.id}-${variant.label}.clip.json`);
      writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      await page.getByTestId('backup-input').setInputFiles(backupPath);
      // Proof the import went through the app: the editor saves the restored
      // project back. The caption-free control is recognised by its revision.
      const restored = await readStoredRecord(page, (r) =>
        variant.track === null
          ? sameEdit(r) && r.edl.revision >= backup.edl.revision && (r.edl.captionTracks ?? []).length === 0
          : r.edl?.captionTracks?.[0]?.trackId === trackId,
      );
      if (!restored) return { failed: true, failureText: `yedek içe aktarılamadı (${variant.label})`, ...base };
      const track = restored.edl.captionTracks?.[0];
      notes.push(
        track
          ? `${variant.label}: yedekten ${track.cues.length} satır yüklendi (timeBase ${track.timeBase})`
          : `${variant.label}: yedekten altyazısız proje yüklendi`,
      );
      if (variant.track === 'source') {
        // Cross-check only: what the app itself maps this project to.
        appOutputCues = captionsModule.outputCues(restored.edl).map((cue) => ({
          text: cue.text,
          startUs: cue.startUs,
          endUs: cue.endUs,
        }));
      }

      const view = await waitForAny(page, ['relink-video', 'preview-video'], 30_000);
      if (view === 'relink-video') {
        await page.getByTestId('relink-video-input').setInputFiles(join(mediaDir, setup.video));
        await waitForAny(page, ['preview-video'], 60_000);
      }

      const outcome = await exportOnce(page, setup, savePath, notes);
      if (!outcome.exported) return { ...outcome, ...base };
      runs.push({ label: variant.label, track: variant.track, path: savePath, gate: outcome.gate, reported: outcome.reported });
      await page.keyboard.press('Escape');
      await page.getByTestId('export-succeeded').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    }

    return {
      exported: true,
      gate: runs[0]?.gate,
      reported: runs[0]?.reported,
      anchoredRuns: runs,
      anchored: { expected, appOutputCues, boxes, frame },
      ...base,
    };
  }

  /* --------------------------------------------------------------- checking */

  /**
   * True when the gate itself reported that this browser cannot do the job.
   * Used to separate "the browser lacks H.264/AAC encoding" from "our code is
   * broken". It is only ever consulted when the app refused cleanly.
   */
  function browserCannotEncode(driveResult) {
    const gate = driveResult.gate ?? {};
    const failedStage =
      /geçmedi/.test(gate.environment ?? '') || /geçmedi/.test(gate.encoder ?? '') || /geçmedi/.test(gate.selftest ?? '');
    return driveResult.blocked === true && failedStage;
  }

  function assess(testCase, driveResult, artefactPath) {
    const checks = [];
    const add = (label, ok, detail = '') => checks.push({ label, ok, detail });
    const want = testCase.expect ?? {};

    // A browser without H.264/AAC encoding must refuse clearly. That is a pass
    // for the app's behaviour and an "unsupported" row in the support matrix.
    if (want.exports && browserCannotEncode(driveResult)) {
      add('bu tarayıcıda encoder yok; açık şekilde reddedildi', true, driveResult.blockedText ?? '');
      add('sahte başarı gösterilmedi', driveResult.exported !== true);
      return { checks, measured: { outcome: 'browser_unsupported' }, unsupported: true };
    }

    if (want.importRejected) {
      add('dosya reddedildi', driveResult.importRejected === true, driveResult.importMessage ?? '');
      add('uygulama kullanılabilir kaldı', driveResult.appStillUsable === true);
      return { checks, measured: {} };
    }

    if (want.blocksWith) {
      const combined = `${driveResult.blockedText ?? ''} ${(driveResult.blockerTexts ?? []).join(' ')}`;
      const blocked = driveResult.blocked === true;
      add('çıktı engellendi', blocked, driveResult.blockedText ?? '');
      // The reason must be the specific one, not just any refusal.
      const reasonShown = /HDR/i.test(combined);
      add('gerekçe HDR olarak gösterildi', blocked && reasonShown, combined.slice(0, 160));
      return { checks, measured: {} };
    }

    if (want.exportsOrBlocks) {
      if (driveResult.importRejected) {
        add('içe aktarmada açık şekilde reddedildi', true, driveResult.importMessage ?? '');
        add('uygulama kullanılabilir kaldı', driveResult.appStillUsable === true);
        return { checks, measured: { outcome: 'import_rejected' } };
      }
      if (driveResult.blocked) {
        add('uygunluk kapısında açık şekilde reddedildi', true, driveResult.blockedText ?? '');
        if (want.hdrColors) {
          // An HDR refusal must name HDR, not fail for some unrelated reason.
          const combined = `${driveResult.blockedText ?? ''} ${(driveResult.blockerTexts ?? []).join(' ')}`;
          add('gerekçe HDR olarak gösterildi', /HDR/i.test(combined), combined.slice(0, 160));
        }
        return { checks, measured: { outcome: 'gate_blocked' } };
      }
      if (driveResult.failed) {
        add('kontrollü hata verdi', true, driveResult.failureText ?? '');
        return { checks, measured: { outcome: 'failed' } };
      }
      add('dosya üretildi', driveResult.exported === true);
    }

    if (want.exports) {
      add(
        'dosya üretildi',
        driveResult.exported === true,
        driveResult.importMessage ?? driveResult.failureText ?? driveResult.blockedText ?? '',
      );
      if (!driveResult.exported) return { checks, measured: {} };
    }

    if (want.blocksWith && driveResult.importRejected) {
      add(
        'uygunluk kapısına ulaşıldı',
        false,
        `dosya içe aktarmada reddedildi: ${driveResult.importMessage ?? ''}`,
      );
      return { checks, measured: { outcome: 'import_rejected' } };
    }

    if (!driveResult.exported) return { checks, measured: {} };

    const probe = ffprobeJson(artefactPath);
    if (!probe) {
      add('çıktı ffprobe ile açılabildi', false);
      return { checks, measured: {} };
    }

    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    const duration = Number(probe.format.duration);

    // ADR-027: a fast-cut file keeps the source's rotation as metadata (the
    // stored picture is landscape, the display matrix turns it). What a player
    // shows is the display size, so that is what is checked; the stored size
    // and rotation are recorded next to it.
    const rotation = Number(
      video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0,
    );
    const quarterTurn = Math.abs(rotation) % 180 === 90;
    const measured = {
      durationSeconds: Number(duration.toFixed(6)),
      frames: video ? Number(video.nb_frames) : null,
      width: (quarterTurn ? video?.height : video?.width) ?? null,
      height: (quarterTurn ? video?.width : video?.height) ?? null,
      storedSize: video ? [video.width, video.height] : null,
      rotation,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      frameRate: video?.r_frame_rate ?? null,
      sizeBytes: Number(probe.format.size),
      method: driveResult.reported?.method ?? null,
      fallbackReason: driveResult.reported?.fallbackReason ?? null,
    };

    if (want.method) {
      add(
        `yöntem ${want.method} (ADR-027)`,
        measured.method === want.method,
        `bildirilen ${measured.method}${measured.fallbackReason ? ` (${measured.fallbackReason})` : ''}, ` +
          `kodlanan kare ${driveResult.reported?.framesEncoded ?? '—'}`,
      );
    }

    if (want.durationSeconds !== undefined) {
      const delta = Math.abs(duration - want.durationSeconds);
      add(
        `süre ${want.durationSeconds} s (±1 kare)`,
        delta <= FRAME_TOLERANCE,
        `ölçülen ${duration.toFixed(6)} s, sapma ${(delta * 1000).toFixed(1)} ms`,
      );
    }
    if (want.frames !== undefined) {
      add(`kare sayısı ${want.frames}`, measured.frames === want.frames, `ölçülen ${measured.frames}`);
    }
    if (want.size) {
      add(
        `çözünürlük ${want.size[0]}x${want.size[1]}`,
        measured.width === want.size[0] && measured.height === want.size[1],
        `ölçülen ${measured.width}x${measured.height}`,
      );
    }
    if (want.videoCodec) {
      add(`video codec ${want.videoCodec}`, measured.videoCodec === want.videoCodec, `${measured.videoCodec}`);
    }
    if (want.audioCodec) {
      add(`ses codec ${want.audioCodec}`, measured.audioCodec === want.audioCodec, `${measured.audioCodec}`);
    }
    if (want.constantFrameRate) {
      add(
        `sabit ${want.constantFrameRate} fps`,
        measured.frameRate === `${want.constantFrameRate}/1`,
        `${measured.frameRate}`,
      );
    }
    if (want.relinked) {
      add(
        'kaynak kaybedildikten sonra yeniden bağlandı ve tarif korundu',
        driveResult.relinked === true,
        (driveResult.notes ?? []).join(' | '),
      );
    }
    if (want.editorDisplaySize && driveResult.editorDisplaySize) {
      const [w, h] = driveResult.editorDisplaySize;
      add(
        `editör kaynağı ${want.editorDisplaySize[0]}x${want.editorDisplaySize[1]} olarak okudu`,
        w === want.editorDisplaySize[0] && h === want.editorDisplaySize[1],
        `okunan ${w}x${h}`,
      );
    }

    // --- picture ------------------------------------------------------------
    if (want.reference) {
      const referencePath = join(outDir, `${testCase.id}-reference.mp4`);
      try {
        buildReference(
          join(mediaDir, testCase.setup.video),
          want.reference,
          measured.width,
          measured.height,
          referencePath,
        );
        const score = ssim(artefactPath, referencePath);
        measured.ssim = Number.isFinite(score) ? Number(score.toFixed(4)) : null;
        add(
          `görüntü ffmpeg referansıyla eşleşiyor (SSIM ≥ ${want.minSsim})`,
          Number.isFinite(score) && score >= want.minSsim,
          `SSIM ${Number.isFinite(score) ? score.toFixed(4) : 'ölçülemedi'}`,
        );
      } catch (error) {
        add('referans karşılaştırması', false, String(error).slice(0, 160));
      }
    }

    // HDR -> SDR (ADR-022): colours against the nearest standard tone-mapping
    // operator, structure against that operator's reference, no black frames.
    if (want.hdrColors) {
      try {
        const colors = assessHdrExport({
          output: artefactPath,
          source: join(mediaDir, testCase.setup.video),
          reference: want.hdrColors,
          width: measured.width,
          height: measured.height,
          frames: measured.frames,
          workDir: outDir,
          id: testCase.id,
        });
        measured.hdr = { nearest: colors.nearest, operatorSet: colors.operatorSet, operators: colors.operators, frames: colors.frames, ...colors.worst };
        const score = ssim(artefactPath, colors.nearestRefPath);
        measured.ssim = Number.isFinite(score) ? Number(score.toFixed(4)) : null;
        add(
          `görüntü ffmpeg referansıyla eşleşiyor (ton eşleme ${colors.nearest}, SSIM ≥ ${want.minSsim})`,
          Number.isFinite(score) && score >= want.minSsim,
          `SSIM ${Number.isFinite(score) ? score.toFixed(4) : 'ölçülemedi'}`,
        );
        add(
          `HDR→SDR renkleri standart bir ton eşlemeye yakın (en yakını ${colors.nearest})`,
          colors.verdict.pass,
          colors.verdict.pass
            ? `ΔE00 ${colors.worst.meanDeltaE00}, kayma ${colors.worst.cast}, doygunluk ${colors.worst.saturationRatioMin}..${colors.worst.saturationRatioMax}, ton ${colors.worst.hueError}°, kırpma ${colors.worst.clipDelta}`
            : colors.verdict.failures.join('; '),
        );
        const black = blackFrames(artefactPath);
        add('siyah kare yok', black.length === 0, black.length ? `${black.length} siyah kare` : '');
      } catch (error) {
        add('HDR renk ölçümü', false, String(error).slice(0, 200));
      }
    }

    if (want.captions) assessCaptions(testCase, driveResult, measured, add);
    if (want.anchoredCaptions) assessAnchoredCaptions(testCase, driveResult, measured, add);

    // --- audio --------------------------------------------------------------
    const control = bandRmsDb(artefactPath, 3000);
    measured.controlBandDb = Number(control.toFixed(1));

    for (const frequency of want.tonePresent ?? []) {
      const level = bandRmsDb(artefactPath, frequency);
      measured[`tone${frequency}Db`] = Number(level.toFixed(1));
      add(
        `${frequency} Hz mikste duyuluyor`,
        level - control > 20,
        `${level.toFixed(1)} dB / kontrol ${control.toFixed(1)} dB`,
      );
    }
    if (want.toneBelow) {
      const { frequency, reference, minMarginDb } = want.toneBelow;
      const level = bandRmsDb(artefactPath, frequency);
      const referenceLevel = bandRmsDb(artefactPath, reference);
      measured.toneBelow = { level: Number(level.toFixed(1)), reference: Number(referenceLevel.toFixed(1)) };
      add(
        `${frequency} Hz mikste yok (${reference} Hz'in en az ${minMarginDb} dB altında)`,
        referenceLevel - level >= minMarginDb,
        `${frequency} Hz ${level.toFixed(1)} dB / ${reference} Hz ${referenceLevel.toFixed(1)} dB`,
      );
    }

    if (want.perMomentTone) {
      const first = bandRmsDb(artefactPath, want.perMomentTone, { start: 0.2, duration: 3 });
      const second = bandRmsDb(artefactPath, want.perMomentTone, { start: 4.5, duration: 4 });
      measured.momentToneDb = [Number(first.toFixed(1)), Number(second.toFixed(1))];
      add(
        'her iki an da kaynak sesi taşıyor',
        Math.abs(first - second) < 6,
        `${first.toFixed(1)} dB / ${second.toFixed(1)} dB`,
      );
    }

    if (want.pitchCheck) {
      const width = want.pitchCheck.width ?? 25;
      const right = bandRmsDb(artefactPath, want.pitchCheck.expected, { width });
      const wrong = bandRmsDb(artefactPath, want.pitchCheck.wrong, { width });
      measured.pitch = { right: Number(right.toFixed(1)), wrong: Number(wrong.toFixed(1)) };
      add(
        `perde korunuyor (${want.pitchCheck.expected} Hz >> ${want.pitchCheck.wrong} Hz)`,
        right - wrong >= want.pitchCheck.minMarginDb,
        `${right.toFixed(1)} dB / ${wrong.toFixed(1)} dB`,
      );
    }

    if (want.musicWindow) {
      const { frequency, silentUntil, audibleFrom, minMarginDb, notch = null } = want.musicWindow;
      const before = bandRmsDb(artefactPath, frequency, { start: 0, duration: silentUntil, notch });
      const after = bandRmsDb(artefactPath, frequency, { start: audibleFrom, duration: 3, notch });
      measured.musicWindow = { before: Number(before.toFixed(1)), after: Number(after.toFixed(1)) };
      add(
        'müzik timeline başlangıcından önce sessiz',
        after - before >= minMarginDb,
        `önce ${before.toFixed(1)} dB, sonra ${after.toFixed(1)} dB`,
      );
    }

    if (want.boundaryContinuity) {
      const { frequency, atSeconds, windowSeconds, maxDipDb } = want.boundaryContinuity;
      const atBoundary = bandRmsDb(artefactPath, frequency, {
        start: atSeconds - windowSeconds / 2,
        duration: windowSeconds,
      });
      const overall = bandRmsDb(artefactPath, frequency);
      measured.boundary = { atBoundary: Number(atBoundary.toFixed(1)), overall: Number(overall.toFixed(1)) };
      add(
        'klip sınırında ses kesilmiyor',
        overall - atBoundary <= maxDipDb,
        `sınırda ${atBoundary.toFixed(1)} dB, genel ${overall.toFixed(1)} dB`,
      );
    }

    if (want.maxPeakDb !== undefined) {
      const peak = peakDb(artefactPath);
      measured.peakDb = Number(peak.toFixed(2));
      add(
        `tepe seviye ${want.maxPeakDb} dB altında (clipping yok)`,
        peak <= want.maxPeakDb,
        `${peak.toFixed(2)} dB`,
      );
    }

    if (want.fadeCheck) {
      const { frequency, quietAt, loudAt, minMarginDb } = want.fadeCheck;
      const quiet = bandRmsDb(artefactPath, frequency, { start: quietAt, duration: 0.15 });
      const loud = bandRmsDb(artefactPath, frequency, { start: loudAt, duration: 0.5 });
      measured.fade = { quiet: Number(quiet.toFixed(1)), loud: Number(loud.toFixed(1)) };
      add(
        'fade in gerçekten uygulanıyor',
        loud - quiet >= minMarginDb,
        `başta ${quiet.toFixed(1)} dB, ortada ${loud.toFixed(1)} dB`,
      );
    }

    return { checks, measured };
  }

  /**
   * Caption burn-in (ADR-015), measured against a caption-free ffmpeg
   * reference of the same edit: inside each cue's window its region must
   * differ clearly, outside every window the picture must match, and the
   * first/last frame showing the caption must be the planned ones (±1).
   */
  function assessCaptions(testCase, driveResult, measured, add) {
    const want = testCase.expect.captions;
    const setup = testCase.setup;
    const runs = driveResult.captionRuns ?? [];
    add(
      `altyazılı ${setup.captions.variants.length} çıktı üretildi`,
      runs.length === setup.captions.variants.length,
      runs.map((run) => run.label).join(', '),
    );
    if (!captionLayoutModule || runs.length === 0) return;

    const width = measured.width;
    const height = measured.height;
    const aspect = (setup.aspect ?? '').replace('-', ':');
    const frame = { width, height, aspect };
    const fps = want.fps;
    const referencePath = join(outDir, `${testCase.id}-reference.mp4`);
    try {
      buildReference(join(mediaDir, setup.video), want.reference, width, height, referencePath);
    } catch (error) {
      add('altyazısız referans üretildi', false, String(error).slice(0, 160));
      return;
    }

    measured.captions = [];
    for (const [runIndex, run] of runs.entries()) {
      const probe = ffprobeJson(run.path);
      const video = probe?.streams.find((stream) => stream.codec_type === 'video');
      const frames = video ? Number(video.nb_frames) : null;
      add(`${run.label}: kare sayısı ${want.totalFrames}`, frames === want.totalFrames, `ölçülen ${frames}`);

      // Same grid rule as the render plan: frameAtUs = round(us * fps / 1e6).
      const cues = setup.captions.cues.map((cue) => ({
        text: cue.text,
        startFrame: Math.min(want.totalFrames, Math.round((cue.startUs * fps) / 1_000_000)),
        endFrame: Math.min(want.totalFrames, Math.round((cue.endUs * fps) / 1_000_000)),
        region: captionRegion(captionLayoutModule, cue.text, run.style, frame),
      }));
      const result = measureCaptionBurnIn(run.path, referencePath, { cues, totalFrames: want.totalFrames });
      const summary = {
        label: run.label,
        style: run.style,
        cleanFrames: result.cleanFrames,
        cleanSsimMean: Number(result.cleanSsimMean.toFixed(4)),
        cleanSsimMin: Number(result.cleanSsimMin.toFixed(4)),
        cues: result.perCue,
      };
      measured.captions.push(summary);

      add(
        `${run.label}: satır dışı karelerde görüntü referansla aynı (SSIM ort. ≥ ${want.minCleanSsim}, en düşük ≥ ${want.minCleanSsimFrame})`,
        result.cleanSsimMean >= want.minCleanSsim && result.cleanSsimMin >= want.minCleanSsimFrame,
        `${result.cleanFrames} kare, SSIM ort. ${summary.cleanSsimMean}, en düşük ${summary.cleanSsimMin}`,
      );

      for (const [cueIndex, cue] of result.perCue.entries()) {
        const name = `${run.label} satır ${cueIndex + 1}`;
        // Two encoders never agree pixel for pixel, so "differs" is judged
        // against that noise: the median must rise well above it, and the
        // quietest frame inside the window must still beat the loudest
        // caption-free frame outside it.
        const rise = cue.insideDiff - cue.noiseDiff;
        const separation = cue.minInsideDiff - cue.maxOutsideDiff;
        add(
          `${name}: pencere içinde bölge belirgin farklı (medyan artışı ≥ ${want.minRegionRise}, kare kare ayrım ≥ ${want.minRegionSeparation})`,
          rise >= want.minRegionRise && separation >= want.minRegionSeparation,
          `ort. mutlak luma farkı içeride ${cue.insideDiff} (en düşük ${cue.minInsideDiff}), ` +
            `dışarıda ${cue.noiseDiff} (en yüksek ${cue.maxOutsideDiff}); ` +
            `bölge SSIM içeride ${cue.regionSsimInside}, dışarıda ${cue.regionSsimOutside}`,
        );
        add(
          `${name}: ilk/son görünen kare planla aynı (±1)`,
          cue.first !== null &&
            cue.last !== null &&
            Math.abs(cue.first - cue.plannedFirst) <= 1 &&
            Math.abs(cue.last - cue.plannedLast) <= 1,
          `plan ${cue.plannedFirst}–${cue.plannedLast}, ölçülen ${cue.first}–${cue.last}`,
        );
        add(
          `${name}: pencere boyunca her karede var, dışarıya taşmıyor`,
          cue.missingInside === 0 && cue.leakedFrames === 0,
          `eksik ${cue.missingInside}, taşan ${cue.leakedFrames}, dışarıdaki en yüksek fark ${cue.maxOutsideDiff}`,
        );
      }

      // One frame per style for a human to look at (synthetic media only).
      const shot = want.screenshots?.[runIndex];
      if (shot) {
        const target = fileURLToPath(new URL(`../../${shot.file}`, import.meta.url));
        const saved = extractFramePng(run.path, shot.frame, target);
        add(`${run.label}: örnek kare kaydedildi`, saved, shot.file);
      }
    }
  }

  /**
   * Source-anchored captions (ADR-016), measured frame by frame against a
   * caption-free ffmpeg reference of the same out-of-order, repeating edit:
   *
   * (a) every frame the independent O + (t − S) rule puts a line on shows
   *     THAT line (identified by its box), incl. both appearances of the
   *     repeated range and the cut at a moment edge;
   * (b) every other frame shows no caption;
   * (c) each appearance starts and ends within ±1 frame of the plan.
   *
   * The only frames excused from (a)/(b) are the two straddling a planned
   * change; (c) is what bounds those.
   */
  function assessAnchoredCaptions(testCase, driveResult, measured, add) {
    const want = testCase.expect.anchoredCaptions;
    const spec = testCase.setup.anchoredCaptions;
    const runs = driveResult.anchoredRuns ?? [];
    add(
      `${spec.variants.length} çıktı üretildi`,
      runs.length === spec.variants.length,
      runs.map((run) => run.label).join(', '),
    );
    const anchored = driveResult.anchored;
    if (!anchored || runs.length === 0) return;

    const { fps, totalFrames } = want;
    const { width, height } = anchored.frame;
    const toFrame = (us) => Math.min(totalFrames, Math.round((us * fps) / 1_000_000));

    // The plan, on the same grid rule as the render plan.
    const appearances = anchored.expected.map((cue) => ({
      label: cueLabel(cue.text),
      startUs: cue.startUs,
      endUs: cue.endUs,
      startFrame: toFrame(cue.startUs),
      endFrame: toFrame(cue.endUs),
    }));
    const expectedLabels = Array.from({ length: totalFrames }, (_, frame) => {
      const hit = appearances.find((item) => frame >= item.startFrame && frame < item.endFrame);
      return hit ? hit.label : 'none';
    });
    // The two frames on either side of every planned change (incl. start/end).
    const nearChange = new Set();
    for (let frame = 1; frame < totalFrames; frame += 1) {
      if (expectedLabels[frame] !== expectedLabels[frame - 1]) {
        nearChange.add(frame - 1);
        nearChange.add(frame);
      }
    }
    measured.anchoredCaptions = {
      plan: appearances.map(({ label, startFrame, endFrame }) => ({ label, first: startFrame, last: endFrame - 1 })),
      boxes: anchored.boxes,
      runs: [],
    };

    // Cross-check: the app's own mapping must agree with the independent
    // rule. A disagreement is a bug in one of them and fails the case.
    if (anchored.appOutputCues) {
      const key = (list) => JSON.stringify(list.map((cue) => [cue.text, cue.startUs, cue.endUs]));
      add(
        'bağımsız O + (t − S) beklentisi uygulamanın outputCues sonucuyla aynı',
        key(anchored.appOutputCues) === key(anchored.expected),
        anchored.expected
          .map((cue) => `${cueLabel(cue.text)} ${(cue.startUs / 1e6).toFixed(3)}–${(cue.endUs / 1e6).toFixed(3)} s`)
          .join(', '),
      );
    }

    const referencePath = join(outDir, `${testCase.id}-reference.mp4`);
    try {
      buildReference(join(mediaDir, testCase.setup.video), want.reference, width, height, referencePath);
    } catch (error) {
      add('altyazısız referans üretildi', false, String(error).slice(0, 160));
      return;
    }

    const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

    for (const run of runs) {
      const probe = ffprobeJson(run.path);
      const stream = probe?.streams.find((item) => item.codec_type === 'video');
      const frames = stream ? Number(stream.nb_frames) : null;
      add(`${run.label}: kare sayısı ${totalFrames}`, frames === totalFrames, `ölçülen ${frames}`);

      const identity = measureCaptionIdentity(run.path, referencePath, {
        candidates: anchored.boxes,
        frameWidth: width,
        frameHeight: height,
        minContrast: want.minContrast,
      });
      const labels = identity.frames.map((item) => item.label);
      const fullSsim = perFrameSsim(run.path, referencePath);
      const summary = { label: run.label, track: run.track, band: identity.band, labels: labelRuns(labels) };
      measured.anchoredCaptions.runs.push(summary);

      if (run.track === null) {
        // Negative control: the same edit without captions.
        const maxBest = Math.max(...identity.frames.map((item) => item.bestScore));
        const maxPresence = Math.max(...identity.frames.map((item) => item.presence));
        summary.maxEdgeContrast = round(maxBest);
        summary.maxPresence = round(maxPresence);
        add(
          `${run.label}: altyazısız kontrolde hiçbir karede altyazı bulunmadı`,
          labels.length === totalFrames && labels.every((label) => label === 'none'),
          `${labels.filter((label) => label !== 'none').length} kare işaretlendi; en yüksek kenar karşıtlığı ` +
            `${summary.maxEdgeContrast}, en yüksek varlık farkı ${summary.maxPresence} (eşik ${want.minContrast})`,
        );
        // The picture itself: moments in this order, the repeat included.
        const values = fullSsim.filter(Number.isFinite);
        const meanSsim = values.reduce((s, v) => s + v, 0) / (values.length || 1);
        summary.ssimMean = round(meanSsim, 4);
        summary.ssimMin = round(Math.min(...values), 4);
        add(
          `${run.label}: görüntü sırası değişmiş/tekrarlı ffmpeg referansıyla eşleşiyor (SSIM ort. ≥ ${want.minSsim})`,
          values.length === totalFrames && meanSsim >= want.minSsim && Math.min(...values) >= want.minCleanSsimFrame,
          `${values.length} kare, SSIM ort. ${summary.ssimMean}, en düşük ${summary.ssimMin}`,
        );
        continue;
      }

      // (a) + identity: planned frames show the planned line.
      let missing = 0;
      let wrongLine = 0;
      let leaked = 0;
      let strictMismatch = 0;
      for (let frame = 0; frame < totalFrames; frame += 1) {
        const planned = expectedLabels[frame];
        const got = labels[frame];
        if (got !== planned) strictMismatch += 1;
        if (nearChange.has(frame) || got === planned) continue;
        if (planned === 'none') leaked += 1;
        else if (got === 'none') missing += 1;
        else wrongLine += 1;
      }
      // Evidence for the threshold: how the true box scores inside the
      // windows vs. the best any box scores where no line is planned.
      const insideScores = [];
      const outsideScores = [];
      const rivalScores = [];
      for (let frame = 0; frame < Math.min(totalFrames, identity.frames.length); frame += 1) {
        if (nearChange.has(frame)) continue;
        const item = identity.frames[frame];
        const label = expectedLabels[frame];
        if (label === 'none') outsideScores.push(Math.max(item.bestScore, item.presence));
        else {
          insideScores.push(item.scores[label]);
          for (const [other, score] of Object.entries(item.scores)) if (other !== label) rivalScores.push(score);
        }
      }
      summary.trueBoxContrastMin = round(Math.min(...insideScores));
      summary.otherBoxContrastMax = round(Math.max(...rivalScores));
      summary.noCaptionMax = round(Math.max(...outsideScores));
      summary.strictMismatchFrames = strictMismatch;

      add(
        `${run.label}: planlanan her karede planlanan satır var (değişim sınırındaki ±1 kare hariç)`,
        missing === 0 && wrongLine === 0,
        `eksik ${missing}, yanlış satır ${wrongLine}; doğru kutunun en düşük karşıtlığı ${summary.trueBoxContrastMin}, ` +
          `diğer kutuların en yüksek ${summary.otherBoxContrastMax} (eşik ${want.minContrast})`,
      );
      // (b) nothing anywhere else.
      add(
        `${run.label}: planlanmayan karelerde altyazı yok`,
        leaked === 0,
        `taşan ${leaked}; altyazısız karelerde en yüksek karşıtlık ${summary.noCaptionMax}; ` +
          `sınır kareleri dahil plandan farklı kare ${strictMismatch}`,
      );

      // (c) each appearance's first and last frame, from the label runs.
      summary.appearances = [];
      for (const item of appearances) {
        const middle = Math.floor((item.startFrame + item.endFrame - 1) / 2);
        let first = null;
        let last = null;
        if (labels[middle] === item.label) {
          first = middle;
          while (first > 0 && labels[first - 1] === item.label) first -= 1;
          last = middle;
          while (last < labels.length - 1 && labels[last + 1] === item.label) last += 1;
        }
        const plannedFirst = item.startFrame;
        const plannedLast = item.endFrame - 1;
        summary.appearances.push({ label: item.label, plannedFirst, plannedLast, first, last });
        add(
          `${run.label}: "${item.label}" ${(item.startUs / 1e6).toFixed(0)}–${(item.endUs / 1e6).toFixed(0)} s ilk/son kare planla aynı (±1)`,
          first !== null && Math.abs(first - plannedFirst) <= 1 && Math.abs(last - plannedLast) <= 1,
          `plan ${plannedFirst}–${plannedLast}, ölçülen ${first ?? '-'}–${last ?? '-'}`,
        );
      }

      // The picture outside the lines still matches the reference.
      const clean = [];
      for (let frame = 0; frame < totalFrames; frame += 1) {
        if (expectedLabels[frame] === 'none' && !nearChange.has(frame) && Number.isFinite(fullSsim[frame])) {
          clean.push(fullSsim[frame]);
        }
      }
      const cleanMean = clean.reduce((s, v) => s + v, 0) / (clean.length || 1);
      summary.cleanSsimMean = round(cleanMean, 4);
      summary.cleanSsimMin = round(Math.min(...clean), 4);
      add(
        `${run.label}: satır dışı karelerde görüntü referansla aynı (SSIM ort. ≥ ${want.minSsim}, en düşük ≥ ${want.minCleanSsimFrame})`,
        clean.length > 0 && cleanMean >= want.minSsim && Math.min(...clean) >= want.minCleanSsimFrame,
        `${clean.length} kare, SSIM ort. ${summary.cleanSsimMean}, en düşük ${summary.cleanSsimMin}`,
      );

      anchoredLabels.set(`${testCase.id}:${run.label}`, labels);
      if (want.sameAs) {
        const other = anchoredLabels.get(`${want.sameAs.caseId}:${want.sameAs.variant}`);
        if (!other) {
          add(`${run.label}: ${want.sameAs.caseId} ile kare kare karşılaştırma`, false, `${want.sameAs.caseId} bu koşuda ölçülmedi`);
        } else {
          const differing = labels.filter((label, frame) => label !== other[frame]).length;
          add(
            `${run.label}: altyazı kareleri ${want.sameAs.caseId} (${want.sameAs.variant}) ile kare kare aynı`,
            differing === 0 && labels.length === other.length,
            `farklı kare ${differing}`,
          );
        }
      }

      const shot = want.screenshot;
      if (shot && shot.variant === run.label) {
        const target = fileURLToPath(new URL(`../../${shot.file}`, import.meta.url));
        add(`${run.label}: örnek kare kaydedildi`, extractFramePng(run.path, shot.frame, target), shot.file);
      }
    }
  }

  return { drive, assess, waitForAny };
}
