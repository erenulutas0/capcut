/**
 * Task-completion walkthroughs: for each card of the opening screen, the
 * scripted first-time user (novice.ts) goes from "Ne yapmak istiyorsun?" to
 * a real file, and everything on the way is counted.
 *
 * The file is then measured with ffprobe / ffmpeg: a task counts as done
 * only when the file is what the card promised.
 */

import { readFileSync } from 'node:fs';

import { expect, type Page, type TestInfo } from '@playwright/test';

import { inspectGif } from '../../../src/domain/gifInspect';
import { enhanceFixture, frameRgb, rgbMeans } from '../../e2e/enhance-media';
import { silenceFixture } from '../../e2e/silence-media';
import { loudness, soundFixFixture } from '../../e2e/soundfix-media';
import { noisyLongFixture } from '../../e2e/targetsize-media';
import { wizardFixture } from '../../e2e/wizard-media';
import type { MessageKey } from '../../../src/i18n/messages';
import { MUSIC, OTHER, SAMPLE, isPhone, langOf, pageLive, pathFor, setupSaving, startsWith, takeDownloadedFile, takeSavedFile, waitForResult, wizardLive, wordsFor } from './app';
import { probeFile, type FileInfo } from './media';
import { Novice, VIDEO } from './novice';
import { round, tr } from './record';
import { watchProblems } from './screen';
import { shot, type VisualEntry } from './visual';

export interface Check {
  name: string;
  ok: boolean;
  value: string;
}

export interface Flow {
  id: string;
  /** What the video is, for the report. */
  sourceNote: string;
  source: () => string;
  /** From "the video is picked" to "the download button can be pressed". */
  middle: (novice: Novice, page: Page, t: (key: MessageKey) => string) => Promise<void>;
  /** The download button: its name and, for a step that cannot be reached by name, its test id. */
  download: { key: MessageKey; testId: string };
  verify: (out: FileInfo, source: FileInfo, files: { out: string; source: string }) => Check[];
  /** Name of this flow's screenshots when it is not the task id (the stand-in build's screens). */
  shotId?: string;
  /** Runs before the page loads (test doubles of the transcript section). */
  prepare?: (page: Page) => Promise<void>;
  /** Stops here on purpose and says why (a step this machine cannot take). */
  stopBeforeDownload?: (page: Page) => Promise<string | null>;
}

export interface WalkResult {
  id: string;
  label: string;
  project: string;
  sourceNote: string;
  completed: boolean;
  /** True when the measuring script itself did not get to the end: the numbers of this row are not measurements. */
  cutShort: boolean;
  /** Why the task did not end with a file, when it did not. */
  stopped: string | null;
  clicks: number;
  typedFields: number;
  screens: number;
  decisions: number;
  wordsTotal: number;
  wordsMax: number;
  /** From the press on the card to the file being ready, by a script that never hesitates. */
  timeToResultS: number | null;
  /** From the press on the download button to the file being ready. */
  exportS: number | null;
  strongJargon: Array<{ screen: string; term: string; context: string }>;
  mildJargon: Array<{ screen: string; term: string; context: string }>;
  unreachable: string[];
  perScreen: Array<{ label: string; title: string; words: number; choiceGroups: number; required: string[] }>;
  steps: Array<{ kind: string; role: string; name: string; byName: boolean }>;
  output: { file: string; bytes: number; durationS: number; streams: string[]; width: number | null; height: number | null } | null;
  checks: Check[];
  problems: { pageErrors: string[]; consoleErrors: string[] };
}

const near = (value: number, target: number, tolerance: number) => Math.abs(value - target) <= tolerance;
const streamsOf = (info: FileInfo) => info.streams.map((stream) => `${stream.type}:${stream.codec}`);
const lengthCheck = (out: FileInfo, expectedS: number, tolerance = 0.15): Check => ({
  name: `süre ≈ ${tr(expectedS)} sn`,
  ok: near(out.durationS, expectedS, tolerance),
  value: `${tr(out.durationS, 3)} sn`,
});
const codecCheck = (out: FileInfo, expected: string[]): Check => ({
  name: `izler: ${expected.join(' + ')}`,
  ok: JSON.stringify(streamsOf(out).sort()) === JSON.stringify([...expected].sort()),
  value: streamsOf(out).join(' + ') || 'yok',
});

const wait = (page: Page, testId: string, timeout = 120_000) => expect(page.getByTestId(testId)).toBeVisible({ timeout });

export const FLOWS: Flow[] = [
  {
    id: 'kes',
    sourceNote: 'sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir',
    source: () => SAMPLE,
    middle: async (novice, page, t) => {
      await wait(page, 'preview-video');
      await novice.look('editör', ['başlangıç ve bitiş zamanı']);
      await novice.type(t('range.start'), '2', 'range-start');
      await novice.type(t('range.end'), '5', 'range-end');
      await novice.press('button', startsWith(t('mark.add')), 'add-moment');
      await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    },
    download: { key: 'download.one', testId: 'download-all' },
    verify: (out, source) => [
      lengthCheck(out, 3),
      codecCheck(out, ['video:h264', 'audio:aac']),
      {
        // Cutting must not blow the picture up (10 Oct 2026: a 720p video came out as 1920 × 1080).
        name: 'görüntü kaynaktan büyük değil',
        ok: (out.video?.width ?? 0) <= (source.video?.width ?? 0) && (out.video?.height ?? 0) <= (source.video?.height ?? 0),
        value: `${source.video?.width} × ${source.video?.height} → ${out.video?.width} × ${out.video?.height}`,
      },
      {
        // Three seconds out of 24 cannot weigh more than the whole video.
        name: 'kesit, videonun tamamından küçük',
        ok: out.bytes < source.bytes,
        value: `${tr(source.bytes / 1000)} KB → ${tr(out.bytes / 1000)} KB`,
      },
    ],
  },
  {
    id: 'bosluk',
    sourceNote: 'bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik)',
    source: () => silenceFixture('bursts').file,
    middle: async (novice, page) => {
      await wait(page, 'bosluk-summary');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out, source) => [
      lengthCheck(out, 3.6),
      { name: 'kaynaktan kısa', ok: out.durationS < source.durationS - 0.5, value: `${tr(source.durationS)} → ${tr(out.durationS)} sn` },
      codecCheck(out, ['video:h264', 'audio:aac']),
    ],
  },
  {
    id: 'dikey',
    sourceNote: 'other-8s.mp4 (640 × 360 yatay, 8 sn)',
    source: () => OTHER,
    middle: async (novice, page) => {
      await wait(page, 'dikey-choice');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out, source) => [
      // ADR-041: the 9:16 slice at its own pixels — vertical, and no larger than the 640 × 360 it was cut from.
      {
        name: 'dikey (9:16) ve kaynaktan büyük değil',
        ok:
          (out.video?.width ?? 0) > 0 &&
          Math.abs((out.video?.width ?? 0) / (out.video?.height ?? 1) - 9 / 16) < 0.01 &&
          (out.video?.width ?? 0) * (out.video?.height ?? 0) <= (source.video?.width ?? 0) * (source.video?.height ?? 0),
        value: `${out.video?.width} × ${out.video?.height}`,
      },
      lengthCheck(out, 8),
      codecCheck(out, ['video:h264', 'audio:aac']),
    ],
  },
  {
    id: 'kucult',
    sourceNote: 'noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden',
    source: () => noisyLongFixture(),
    middle: async (novice, page) => {
      await wait(page, 'kucult-choice');
      for (const id of ['share', 'email', 'whatsapp']) {
        await expect(page.getByTestId(`size-hint-${id}`)).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
      }
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out, source) => [
      lengthCheck(out, 14),
      codecCheck(out, ['video:h264', 'audio:aac']),
      {
        // The card says "Küçült — WhatsApp’a sığdır"; with the choice left as it is the target is 52 MB.
        name: 'dosya kaynaktan küçük',
        ok: out.bytes < source.bytes * 0.98,
        value: `${tr(source.bytes / 1_000_000)} MB → ${tr(out.bytes / 1_000_000)} MB`,
      },
      { name: 'WhatsApp sınırına (16 MB) sığıyor', ok: out.bytes <= 16_000_000, value: `${tr(out.bytes / 1_000_000)} MB` },
    ],
  },
  {
    id: 'muzik',
    sourceNote: 'other-8s.mp4 + tone-30s.m4a',
    source: () => OTHER,
    middle: async (novice, page, t) => {
      await wait(page, 'muzik-pick');
      await novice.look('seçim', ['müzik dosyası']);
      await novice.pickFile(startsWith(t('wizard.muzik.pick')), MUSIC, 'muzik-pick');
      await wait(page, 'muzik-picked');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out) => [lengthCheck(out, 8), codecCheck(out, ['video:h264', 'audio:aac'])],
  },
  {
    id: 'ses',
    sourceNote: 'sample-24s.mp4',
    source: () => SAMPLE,
    middle: async (novice, page) => {
      await wait(page, 'ses-info');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out) => [lengthCheck(out, 24, 0.05), codecCheck(out, ['audio:aac'])],
  },
  {
    id: 'sustur',
    sourceNote: 'sample-24s.mp4',
    source: () => SAMPLE,
    middle: async (novice, page) => {
      await wait(page, 'sustur-info');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out) => [lengthCheck(out, 24), codecCheck(out, ['video:h264'])],
  },
  {
    // ADR-049: speech recorded far too quietly (ffmpeg's synthetic voice, about −38 LUFS).
    id: 'duzelt',
    sourceNote: 'kisik-konusma.mp4 (640 × 360, 16 sn, yapay ses, yaklaşık −38 LUFS)',
    source: () => soundFixFixture('quiet'),
    middle: async (novice, page) => {
      await wait(page, 'duzelt-summary');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out, _source, files) => {
      const level = loudness(files.out);
      return [
        lengthCheck(out, 16.37),
        codecCheck(out, ['video:h264', 'audio:aac']),
        { name: '−16 LUFS (±1)', ok: Math.abs(level.integratedLufs + 16) <= 1, value: `${tr(level.integratedLufs, 1)} LUFS` },
        { name: 'gerçek tepe ≤ −1 dBTP', ok: level.truePeakDbtp <= -1, value: `${tr(level.truePeakDbtp, 1)} dBTP` },
      ];
    },
  },
  {
    id: 'cevir',
    sourceNote: 'tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn)',
    source: () => wizardFixture('webm'),
    middle: async (novice, page) => {
      await wait(page, 'cevir-info');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out) => [lengthCheck(out, 2), codecCheck(out, ['video:h264', 'audio:aac']), { name: 'MP4', ok: /mp4/.test(out.format), value: out.format }],
  },
  {
    id: 'iyilestir',
    sourceNote: 'karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn)',
    source: () => enhanceFixture('dark'),
    middle: async (novice, page) => {
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
      await wait(page, 'iyilestir-summary');
      await novice.look('seçim');
    },
    download: { key: 'wizard.download', testId: 'wizard-download' },
    verify: (out, source, files) => {
      const before = rgbMeans(frameRgb(files.source, 1.5, 320, 180)).luma;
      const after = rgbMeans(frameRgb(files.out, 1.5, 320, 180)).luma;
      return [
        lengthCheck(out, 3),
        codecCheck(out, ['video:h264', 'audio:aac']),
        { name: 'görüntü aydınlandı (ortalama parlaklık en az +10)', ok: after - before >= 10, value: `${tr(before, 1)} → ${tr(after, 1)}` },
        { name: 'boyut aynı', ok: out.video?.width === source.video?.width && out.video?.height === source.video?.height, value: `${out.video?.width} × ${out.video?.height}` },
      ];
    },
  },
  {
    // ADR-046: the part offered first (four seconds), a top text typed, the size left as it is.
    id: 'gif',
    sourceNote: 'sample-24s.mp4 (1280 × 720, 24 sn); üste yazı yazılır, kısım ve boyut değiştirilmeden',
    source: () => SAMPLE,
    middle: async (novice, page, t) => {
      const estimate = page.getByTestId('gif-estimate');
      await expect(estimate).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
      await novice.look('seçim', ['üst ya da alt yazı (isteğe bağlı)']);
      await novice.type(t('wizard.gif.topLabel'), 'PAZARTESİ SABAHI', 'gif-text-top');
      await expect(estimate).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    },
    download: { key: 'wizard.gif.download', testId: 'wizard-download' },
    verify: (out, _source, files) => {
      const gif = inspectGif(new Uint8Array(readFileSync(files.out)));
      return [
        { name: 'GIF', ok: out.format === 'gif' && out.video?.codec === 'gif', value: `${out.format} / ${out.video?.codec ?? 'yok'}` },
        // "Orta" is the size offered first since 20 Oct 2026 (founder's decision, ADR-046 addendum).
        { name: '480 × 270 (Orta, kaynaktan büyük değil)', ok: out.video?.width === 480 && out.video?.height === 270, value: `${out.video?.width} × ${out.video?.height}` },
        {
          name: '50 kare, 4 sn, durmadan döner',
          ok: gif.ok && gif.gif.frames === 50 && gif.gif.durationCs === 400 && gif.gif.loops === 0,
          value: gif.ok ? `${gif.gif.frames} kare, ${tr(gif.gif.durationCs / 100)} sn, döngü ${gif.gif.loops ?? 'yok'}` : gif.reason,
        },
      ];
    },
  },
];

/** "Yazıya dök" on the build people get: as far as a first-time user gets before the model has to come down. */
export const YAZI_PUBLISHED: Flow = {
  id: 'yazi',
  sourceNote: 'sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok',
  source: () => SAMPLE,
  middle: async (novice, page) => {
    await wait(page, 'transcribe-steps');
    await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
    await novice.look('model', ['model indirme (bir kez)']);
  },
  download: { key: 'wizard.yazi.downloadVideo', testId: 'wizard-download' },
  stopBeforeDownload: async (page) => {
    const button = page.getByTestId('model-download');
    const text = (await button.count()) > 0 ? ((await button.textContent()) ?? '').trim() : '';
    return `“${text}” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.`;
  },
  verify: () => [],
};

/** A task that has not been walked yet: what stays in the results when the script itself is cut short. */
export function blankResult(testInfo: TestInfo, flow: Flow, stopped: string | null): WalkResult {
  const t = wordsFor(testInfo);
  return {
    id: flow.id,
    label: t(`task.${flow.id}.label` as MessageKey),
    project: testInfo.project.name,
    sourceNote: flow.sourceNote,
    completed: false,
    stopped,
    clicks: 0,
    typedFields: 0,
    screens: 0,
    decisions: 0,
    wordsTotal: 0,
    wordsMax: 0,
    timeToResultS: null,
    exportS: null,
    strongJargon: [],
    mildJargon: [],
    unreachable: [],
    perScreen: [],
    steps: [],
    output: null,
    checks: [],
    problems: { pageErrors: [], consoleErrors: [] },
    cutShort: stopped !== null,
  };
}

export async function walk(page: Page, testInfo: TestInfo, flow: Flow, visual: VisualEntry[]): Promise<WalkResult> {
  const phone = isPhone(testInfo);
  // ADR-048: the project's language — its words, and the start screen of that language.
  const t = wordsFor(testInfo);
  const label = t(`task.${flow.id}.label` as MessageKey);
  const novice = new Novice(page, phone);
  const problems = await watchProblems(page);
  await setupSaving(page, phone);
  await flow.prepare?.(page);
  const result: WalkResult = {
    id: flow.id,
    label,
    project: testInfo.project.name,
    sourceNote: flow.sourceNote,
    cutShort: false,
    completed: false,
    stopped: null,
    clicks: 0,
    typedFields: 0,
    screens: 0,
    decisions: 0,
    wordsTotal: 0,
    wordsMax: 0,
    timeToResultS: null,
    exportS: null,
    strongJargon: [],
    mildJargon: [],
    unreachable: [],
    perScreen: [],
    steps: [],
    output: null,
    checks: [],
    problems: { pageErrors: [], consoleErrors: [] },
  };
  try {
    const sourceFile = flow.source();
    await page.goto(pathFor('/', langOf(testInfo)));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Read and pressed once live: before that the card is a plain link and the wizard opens as a
    // prerendered page of its own, drawn for a wide window (lib/app.ts, `pageLive`, `wizardLive`).
    await pageLive(page);
    await novice.look('ana ekran');
    const started = Date.now();
    await novice.press('link', startsWith(label), `task-${flow.id}`);
    await wizardLive(page);
    await novice.look('video seç', [VIDEO]);
    await shot(page, testInfo, visual, `yol-${flow.shotId ?? flow.id}-ilk`);
    await novice.pickFile(startsWith(t('preview.pickVideo')), sourceFile, 'pick-video');
    await flow.middle(novice, page, t);

    const stop = await flow.stopBeforeDownload?.(page);
    if (stop) {
      result.stopped = stop;
    } else {
      const pressed = Date.now();
      await novice.press('button', t(flow.download.key), flow.download.testId);
      const phase = await waitForResult(page);
      const ended = Date.now();
      result.exportS = round((ended - pressed) / 1000, 2);
      result.timeToResultS = round((ended - started) / 1000, 2);
      await novice.look('sonuç');
      if (phase !== 'saved' && phase !== 'ready') {
        result.stopped = `indirme “${phase}” ile bitti`;
      } else {
        await shot(page, testInfo, visual, `yol-${flow.shotId ?? flow.id}-sonuc`);
        const file =
          phase === 'saved'
            ? await takeSavedFile(page, testInfo, `yol-${flow.id}`)
            : await takeDownloadedFile(page, testInfo, `yol-${flow.id}`, () =>
                novice.press('link', startsWith(t(phone ? 'export.saveDevice' : 'export.save')), 'export-download'),
              );
        const out = probeFile(file);
        const source = probeFile(sourceFile);
        result.output = {
          file,
          bytes: out.bytes,
          durationS: round(out.durationS, 3),
          streams: streamsOf(out),
          width: out.video?.width ?? null,
          height: out.video?.height ?? null,
        };
        result.checks = [
          { name: 'dosya boş değil', ok: out.bytes > 1000, value: `${tr(out.bytes)} bayt` },
          ...flow.verify(out, source, { out: file, source: sourceFile }),
        ];
        result.completed = result.checks.every((check) => check.ok);
        if (!result.completed) result.stopped = 'dosya kaydedildi ama kartın söz verdiği gibi değil (denetimlere bak)';
      }
    }
  } catch (error) {
    result.stopped = `betik ilerleyemedi: ${String((error as Error).message).split('\n')[0]?.slice(0, 240)}`;
  }
  Object.assign(result, novice.summary());
  result.problems = { pageErrors: problems.pageErrors, consoleErrors: problems.consoleErrors };
  return result;
}
