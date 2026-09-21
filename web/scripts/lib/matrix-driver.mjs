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

import {
  bandRmsDb,
  buildReference,
  captionRegion,
  extractFramePng,
  ffprobeJson,
  loadCaptionLayoutModule,
  measureCaptionBurnIn,
  peakDb,
  ssim,
} from './media-measure.mjs';

/**
 * @param {{ mediaDir: string, outDir: string, baseURL: string }} ctx
 */
/** A committed, known-good file used to check the app still works after a refusal. */
const RECOVERY_FILE = fileURLToPath(new URL('../../tests/media/sample-24s.mp4', import.meta.url));

export function createDriver({ mediaDir, outDir, baseURL }) {
  const FRAME_TOLERANCE = 1 / 30 + 0.002;
  /** The app's caption layout, transpiled once per run (see media-measure). */
  let captionLayoutModule = null;

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

    const measured = {
      durationSeconds: Number(duration.toFixed(6)),
      frames: video ? Number(video.nb_frames) : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      frameRate: video?.r_frame_rate ?? null,
      sizeBytes: Number(probe.format.size),
    };

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

    if (want.captions) assessCaptions(testCase, driveResult, measured, add);

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

  return { drive, assess, waitForAny };
}
