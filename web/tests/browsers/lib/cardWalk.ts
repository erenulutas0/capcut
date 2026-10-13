/**
 * One task card, walked the way the quality layer's first-time user walks it
 * (tests/quality/lib/novice.ts: controls found by role and name), in an
 * engine that is not Chromium — and judged:
 *
 *  works    a real file came out and ffprobe agrees it is what the card said;
 *  refusal  the app stopped and said why (the words are kept);
 *  broken   anything else: a wait that never ends, a file that is wrong, an
 *           exception nobody was told about, a stop without words.
 *
 * Nothing is stubbed in Firefox and WebKit: no save dialog exists there, so
 * the file leaves through the real download (ADR-026). Only the Chromium
 * control gets the stand-in save dialog, because the real one is an
 * operating-system window a test cannot press.
 */

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

import { installSavePicker, pickerCalls, readSaved } from '../../e2e/kesitFlow';
import { startsWith, t, waitForResult } from '../../quality/lib/app';
import { probeFile, type FileInfo } from '../../quality/lib/media';
import { Novice } from '../../quality/lib/novice';
import type { Flow } from '../../quality/lib/walk';
import { OUTPUTS, crypticIn, engineOf, ensureDir, visibleText, watchProblems, type Cell } from './cells';

const streamsOf = (info: FileInfo) => info.streams.map((stream) => `${stream.type}:${stream.codec}`);
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** How long a download may take before it is called stuck (the app's own watchdog is far shorter). */
const RESULT_WAIT_MS = 240_000;

/** Where the words of a stop are, most specific first. */
const STOP_SELECTORS = [
  '[data-testid="export-blocked"]',
  '[data-testid="export-failed"]',
  '[data-testid="export-over-limit"]',
  '[data-testid="media-error"]',
  '[data-testid="browser-unsupported"]',
  '.dl-status',
];

async function stopText(page: Page): Promise<string> {
  for (const selector of STOP_SELECTORS) {
    const text = await visibleText(page, selector);
    // The status line a screen reader hears repeats the title: a sighted user reads it once.
    if (text) return text.replace(/^(.{8,80}?[.!?]) \1/, '$1');
  }
  return '';
}

export async function walkCard(page: Page, testInfo: TestInfo, flow: Flow): Promise<Cell> {
  const engine = engineOf(testInfo);
  const touch = testInfo.project.use.hasTouch === true;
  const label = t(`task.${flow.id}.label` as Parameters<typeof t>[0]);
  const novice = new Novice(page, touch);
  const problems = await watchProblems(page);
  if (engine === 'chromium') await installSavePicker(page);

  const cell: Cell = {
    area: 'card',
    id: flow.id,
    project: testInfo.project.name,
    verdict: 'broken',
    summary: 'betik başlamadı',
    reached: [],
    output: null,
    checks: [],
    problems,
  };
  const reached = cell.reached as string[];
  const started = Date.now();

  try {
    const sourceFile = flow.source();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    reached.push('ana ekran');

    await novice.press('link', startsWith(label), `task-${flow.id}`);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    reached.push('sihirbaz');

    await novice.pickFile(startsWith(t('preview.pickVideo')), sourceFile, 'pick-video');
    cell.facts = { ...cell.facts, upfrontNotice: await visibleText(page, '[data-testid="browser-unsupported"]') };
    try {
      // A file refused in words (it cannot be opened here) ends the wait: no two minutes for a preview that will not come.
      const refused = page.getByTestId('media-error');
      await Promise.race([
        flow.middle(novice, page),
        refused.waitFor({ state: 'visible', timeout: 200_000 }).then(
          () => Promise.reject(new Error('the picked file was refused (media-error)')),
          () => new Promise<never>(() => undefined),
        ),
      ]);
    } catch (error) {
      // The video was handed over and the next screen never came: either the app said why, or it is stuck.
      const text = await stopText(page);
      cell.text = text || (await visibleText(page, 'main'));
      if (text && !crypticIn(text)) {
        cell.verdict = 'refusal';
        cell.summary = 'video verildikten sonra durdu ve nedenini söyledi';
      } else {
        cell.verdict = 'broken';
        cell.summary = `video verildikten sonra ilerlemedi, açıklama yok: ${String((error as Error).message).split('\n')[0]?.slice(0, 160)}`;
      }
      return cell;
    }
    reached.push('video kabul edildi');
    // The background check of the open video may still be running: give its notice a moment to appear.
    await page.getByTestId('browser-unsupported').waitFor({ state: 'visible', timeout: 2500 }).catch(() => undefined);
    cell.facts = {
      ...cell.facts,
      // What the wizard says before "İndir" is pressed, and which renderer İyileştir chose.
      noticeBeforeDownload: await visibleText(page, '[data-testid="browser-unsupported"]'),
      enhanceEngine: await page
        .getByTestId('enhance-preview')
        .first()
        .getAttribute('data-engine', { timeout: 1000 })
        .catch(() => null),
    };

    const stop = await flow.stopBeforeDownload?.(page);
    if (stop) {
      cell.verdict = 'not-run';
      cell.summary = stop;
      cell.note = stop;
      return cell;
    }

    await novice.press('button', flow.download.name, flow.download.testId);
    reached.push('indir’e basıldı');
    const phase = await waitForResult(page, RESULT_WAIT_MS);
    cell.seconds = round((Date.now() - started) / 1000, 1);

    if (phase === 'timeout') {
      cell.text = await stopText(page);
      cell.verdict = 'broken';
      cell.summary = `takıldı: ${RESULT_WAIT_MS / 1000} sn içinde ne dosya ne mesaj (ekranda: “${cell.text.slice(0, 120)}”)`;
      return cell;
    }
    if (phase === 'blocked' || phase === 'failed' || phase === 'canceled') {
      cell.text = await stopText(page);
      const cryptic = crypticIn(cell.text);
      if (phase === 'canceled' || !cell.text || cryptic) {
        cell.verdict = 'broken';
        cell.summary = cryptic ? `mesajda programcı dili: “${cryptic}”` : `indirme “${phase}” ile bitti, anlaşılır bir açıklama yok`;
      } else {
        cell.verdict = 'refusal';
        cell.summary = phase === 'blocked' ? 'indirme başlamadan durdu ve nedenini söyledi' : 'indirme yarıda durdu ve nedenini söyledi';
      }
      return cell;
    }

    // A file is promised: take it the way this browser really hands it over.
    reached.push(phase === 'saved' ? 'kaydedildi' : 'dosya hazır');
    let file: string;
    if (phase === 'saved') {
      const name = (await pickerCalls(page)).at(-1);
      if (!name) throw new Error('the save dialog was never asked for a file');
      const saved = await readSaved(page, testInfo, `saved-${name}`);
      file = join(ensureDir(OUTPUTS), `${flow.id}-${testInfo.project.name}-${name}`);
      copyFileSync(saved, file);
    } else {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        novice.press('link', startsWith(t(touch ? 'export.saveDevice' : 'export.save')), 'export-download'),
      ]);
      file = join(ensureDir(OUTPUTS), `${flow.id}-${testInfo.project.name}-${download.suggestedFilename()}`);
      await download.saveAs(file);
    }
    reached.push('dosya alındı');

    const out = probeFile(file);
    const source = probeFile(sourceFile);
    cell.output = {
      bytes: out.bytes,
      durationS: round(out.durationS, 3),
      streams: streamsOf(out),
      width: out.video?.width ?? null,
      height: out.video?.height ?? null,
    };
    cell.checks = [
      { name: 'dosya boş değil', ok: out.bytes > 1000, value: `${out.bytes} bayt` },
      ...flow.verify(out, source, { out: file, source: sourceFile }),
    ];
    const failed = cell.checks.filter((check) => !check.ok);
    if (failed.length === 0) {
      cell.verdict = 'works';
      cell.summary = `dosya çıktı: ${cell.output.streams.join(' + ')}, ${String(cell.output.durationS).replace('.', ',')} sn`;
    } else {
      cell.verdict = 'broken';
      cell.summary = `SAHTE BAŞARI: dosya verildi ama söz verildiği gibi değil — ${failed.map((check) => `${check.name}: ${check.value}`).join('; ')}`;
    }
  } catch (error) {
    cell.verdict = 'broken';
    cell.text = cell.text ?? (await stopText(page).catch(() => ''));
    cell.summary = `betik ilerleyemedi (${reached.at(-1) ?? 'başlangıç'} adımından sonra): ${String((error as Error).message).split('\n')[0]?.slice(0, 200)}`;
  } finally {
    if (novice.unreachable.length > 0) cell.note = `${cell.note ? `${cell.note} ` : ''}adıyla bulunamayan: ${novice.unreachable.join('; ')}`;
    // An exception nobody was told about makes any outcome a broken one.
    if (cell.verdict !== 'broken' && (problems.pageErrors.length > 0 || problems.unhandledRejections.length > 0)) {
      cell.note = `${cell.note ? `${cell.note} ` : ''}(sonuç “${cell.verdict}” idi)`;
      cell.verdict = 'broken';
      cell.summary = `yakalanmamış hata: ${[...problems.pageErrors, ...problems.unhandledRejections][0]}`;
    }
  }
  return cell;
}
