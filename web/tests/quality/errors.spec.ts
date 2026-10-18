import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { addKesit, installSavePicker } from '../e2e/kesitFlow';
import { wizardFixture } from '../e2e/wizard-media';
import { MUSIC, OTHER, SAMPLE, takeSavedFile, waitForResult } from './lib/app';
import { strongJargon } from './lib/jargon';
import { enhanceFixture } from '../e2e/enhance-media';
import { probeFile, tailVolumeDb, truncatedCopy } from './lib/media';
import { BUILD, round, writeResult } from './lib/record';
import { watchProblems, type PageProblems } from './lib/screen';

/**
 * Section 3 — error paths. Every wizard is handed files it cannot or should
 * not work with, and what the user is told is written down word for word.
 *
 * A cell is judged by rules a person can check against the text shown:
 *  - iyi:      a message in plain words says what happened, there is a way
 *              on (or back), nothing is stuck, the page reported no error;
 *  - belirsiz: a message is there but does not say what to do, or uses an
 *              engineering word, or the app went on without saying anything
 *              about a file that is not what it should be;
 *  - bozuk:    no message and no progress, a spinner that never ends, a
 *              page error, or a "saved" file from something unusable.
 *
 * The over-limit cases fake the file's size and length INSIDE THE TEST PAGE
 * (a getter on File.prototype / HTMLMediaElement.prototype, installed by this
 * spec): the app's own checks run unchanged against numbers no test machine
 * can hold on disk. Nothing in src/ was changed for it.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');

const TASKS = ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'duzelt', 'cevir', 'iyilestir'] as const;
type Task = (typeof TASKS)[number];
/** Tasks that have nothing to do without the video's own sound. */
const NEEDS_SOUND: readonly Task[] = ['bosluk', 'yazi', 'ses', 'sustur', 'duzelt'];

type FilePayload = string | { name: string; mimeType: string; buffer: Buffer };

interface Case {
  id: string;
  label: string;
  /** What a careful app does with it. */
  expected: 'refuse' | 'refuse-or-fail' | 'say-no-sound';
  file: (task: Task) => FilePayload;
  fake?: 'size' | 'duration';
}

function noise(length: number): Buffer {
  const out = Buffer.alloc(length);
  let state = 12345;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

const CASES: Case[] = [
  {
    id: 'yanlis-tur',
    label: 'Video olmayan dosya (.txt)',
    expected: 'refuse',
    file: () => ({ name: 'notlar.txt', mimeType: 'text/plain', buffer: Buffer.from('bu bir video değil') }),
  },
  {
    id: 'bos',
    label: 'Sıfır baytlık .mp4',
    expected: 'refuse',
    file: () => ({ name: 'bos.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) }),
  },
  {
    id: 'bozuk',
    label: 'İçi rastgele bayt olan .mp4',
    expected: 'refuse',
    file: () => ({ name: 'bozuk.mp4', mimeType: 'video/mp4', buffer: noise(200_000) }),
  },
  {
    id: 'yarim',
    label: 'Yarıda kesilmiş MP4 (baytların %55’i)',
    expected: 'refuse-or-fail',
    // İyileştir has nothing to do on the flat test card (by design), so it gets a dark camera-like video cut short instead.
    file: (task) =>
      task === 'iyilestir'
        ? { name: 'yarim-inmis.mp4', mimeType: 'video/mp4', buffer: truncatedCopy(enhanceFixture('dark'), 'karanlik-3s', 0.55) }
        : { name: 'yarim-inmis.mp4', mimeType: 'video/mp4', buffer: truncatedCopy(SAMPLE, 'sample-24s', 0.55) },
  },
  {
    id: 'yalniz-ses',
    label: 'Yalnızca ses dosyası (.m4a)',
    expected: 'refuse',
    file: () => MUSIC,
  },
  {
    id: 'sessiz-video',
    label: 'Sesi olmayan video',
    expected: 'say-no-sound',
    file: () => wizardFixture('noAudio'),
  },
  {
    id: 'cok-buyuk',
    label: 'Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB)',
    expected: 'refuse',
    fake: 'size',
    file: () => ({ name: 'kalite-cok-buyuk.mp4', mimeType: 'video/mp4', buffer: readFileSync(OTHER) }),
  },
  {
    id: 'cok-uzun',
    label: 'Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika)',
    expected: 'refuse',
    fake: 'duration',
    file: () => ({ name: 'kalite-cok-uzun.mp4', mimeType: 'video/mp4', buffer: readFileSync(OTHER) }),
  },
];

/**
 * A verb that tells the user what to do next ("Başka bir dosya dene", "Videoyu yeniden seç"): the
 * imperative or "…ebilirsin" forms as whole words. Not a stem match — "açılamadı" is not advice.
 */
const SAYS_WHAT_TO_DO =
  /(?<![\p{L}])(dene|deneyin|deneyebilirsin|deneyebilir|seç|seçin|seçebilirsin|kullan|kullanabilirsin|yenile|kısalt|kes|böl|indir|kapat|ekle|bağla|bak)(?![\p{L}])/iu;

interface Observation {
  outcome: 'refused' | 'opened' | 'silent';
  step: string | null;
  messages: string[];
  stillBusy: boolean;
  downloadEnabled: boolean;
  controls: string[];
  answerMs: number;
}

async function observe(page: Page): Promise<Omit<Observation, 'outcome' | 'answerMs'>> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const withCheck = element as Element & { checkVisibility?: () => boolean };
      return box.width > 0 && box.height > 0 && (!withCheck.checkVisibility || withCheck.checkVisibility());
    };
    // What a sighted user reads: without the copy of the sentence that is there, hidden, for screen readers.
    const text = (element: Element) => {
      const pieces: string[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.visually-hidden, button, details')) continue;
        const piece = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (piece !== '') pieces.push(piece);
      }
      return pieces.join(' ');
    };
    const nameOf = (element: Element) => ((element as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
    const messages = new Set<string>();
    const selector =
      '[role="alert"], [data-testid="media-error"], .wizard-blocked, [data-testid="bosluk-problem"] .wizard-panel-title, ' +
      '[data-testid="bosluk-unclear"] .wizard-panel-title, [data-testid="bosluk-none"], [data-testid="export-failed"], ' +
      '[data-testid="export-blocked"], [data-testid="enhance-preview-failed"]';
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest('.visually-hidden') || !visible(element)) continue;
      const value = text(element);
      if (value !== '' && ![...messages].some((known) => known.includes(value))) messages.add(value);
    }
    const controls: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('button, a[href]')) {
      if (!visible(element) || (element as HTMLButtonElement).disabled) continue;
      const name = (element.getAttribute('aria-label') ?? nameOf(element)).replace(/\s+/g, ' ').trim();
      if (name !== '' && !controls.includes(name)) controls.push(name);
    }
    const download = document.querySelector<HTMLButtonElement>('[data-testid="wizard-download"]');
    return {
      step: document.querySelector('[data-testid="wizard"]')?.getAttribute('data-step') ?? (document.querySelector('[data-testid="preview-video"]') ? 'editor' : null),
      messages: [...messages],
      stillBusy: [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible),
      downloadEnabled: download !== null && !download.disabled,
      controls: controls.slice(0, 12),
    };
  });
}

/** Waits until the app has answered the file: a refusal, the next step, or nothing at all for 25 s. */
async function firstAnswer(page: Page): Promise<Observation['outcome']> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    // One look at the page per turn (in "Kes" the wizard gives way to the editor: nothing here may wait for either).
    const now = await page.evaluate(() => ({
      refused: document.querySelector('[data-testid="media-error"]') !== null,
      step: document.querySelector('[data-testid="wizard"]')?.getAttribute('data-step') ?? null,
      // The editor over the picked video: its preview, or at least its download button with the wizard gone.
      editor:
        document.querySelector('[data-testid="preview-video"]') !== null ||
        (document.querySelector('[data-testid="wizard"]') === null && document.querySelector('[data-testid="download-all"]') !== null),
    }));
    if (now.refused) return 'refused';
    if (now.step === 'choose' || now.editor) return 'opened';
    await page.waitForTimeout(200);
  }
  return 'silent';
}

/** After the video opened: waits until the step has made up its mind (a message, or a download that can be pressed). */
async function settle(page: Page): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const now = await observe(page);
    const modelStep = (await page.locator('[data-testid="model-download"], [data-testid="transcribe-start"]').count()) > 0;
    if (now.step === 'editor' || modelStep || now.downloadEnabled || (now.messages.length > 0 && !now.stillBusy)) return;
    await page.waitForTimeout(300);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks the page a trivial question every two seconds. A page that does not answer for a minute has a
 * locked main thread: for the user the tab is frozen, whatever the script was waiting for.
 */
function watchFreeze(page: Page) {
  let stopped = false;
  let longest = 0;
  let giveUp: (ms: number) => void = () => undefined;
  const gaveUp = new Promise<number>((resolve) => {
    giveUp = resolve;
  });
  void (async () => {
    while (!stopped) {
      const asked = Date.now();
      const answered = await Promise.race([
        page.evaluate(() => 1).then(() => true).catch(() => true),
        sleep(60_000).then(() => false),
      ]);
      const took = Date.now() - asked;
      if (!stopped && took > longest) longest = took;
      if (!answered) {
        if (!stopped) giveUp(took);
        return;
      }
      await sleep(2000);
    }
  })();
  return { gaveUp, stop: () => void (stopped = true), longest: () => longest };
}

interface Verdict {
  verdict: 'iyi' | 'belirsiz' | 'bozuk' | 'geçerli değil' | 'ölçülemedi';
  why: string;
}

function judgeMessage(messages: string[], controls: string[]): Verdict {
  const text = messages.join(' ');
  const jargon = strongJargon(text);
  const saysWhatToDo = SAYS_WHAT_TO_DO.test(text);
  if (jargon.length > 0) return { verdict: 'belirsiz', why: `mesajda teknik terim: ${[...new Set(jargon.map((hit) => hit.term))].join(', ')}` };
  if (!saysWhatToDo) {
    return {
      verdict: 'belirsiz',
      why: `ne olduğunu söylüyor, ne yapılacağını söylemiyor (ekrandaki düğmeler: ${controls.slice(0, 4).join(', ') || 'yok'})`,
    };
  }
  return { verdict: 'iyi', why: 'ne olduğunu ve ne yapılacağını söylüyor' };
}

for (const task of TASKS) {
  for (const item of CASES) {
    test(`errors: ${task} × ${item.id}`, async ({ page }, testInfo) => {
      test.setTimeout(420_000);
      const part = `${testInfo.project.name}.${task}.${item.id}`;
      const blank = { task, case: item.id, caseLabel: item.label, expected: item.expected, messages: [], pageErrors: [], consoleErrors: [], answerMs: 0, attempt: null };
      // Written first: if this script itself is cut short, the cell says so instead of being missing.
      writeResult('errors', part, { ...blank, verdict: 'ölçülemedi', why: 'ölçüm betiği yarıda kaldı' });
      const problems = await watchProblems(page);
      const freeze = watchFreeze(page);
      const cell = measureCell(page, testInfo, task, item, problems);
      cell.catch(() => undefined);
      const outcome = await Promise.race([
        cell.then((data) => ({ kind: 'done' as const, data })).catch((error: Error) => ({ kind: 'error' as const, message: error.message })),
        freeze.gaveUp.then((ms) => ({ kind: 'frozen' as const, ms })),
        sleep(330_000).then(() => ({ kind: 'late' as const })),
      ]);
      freeze.stop();
      if (outcome.kind === 'done') {
        writeResult('errors', part, { ...outcome.data, longestUnresponsiveMs: freeze.longest() });
      } else {
        const why =
          outcome.kind === 'frozen'
            ? `sayfa en az ${Math.round(outcome.ms / 1000)} sn hiç yanıt vermedi (dondu); kullanıcı için sekme kilitlenir`
            : outcome.kind === 'late'
              ? 'adım 330 sn içinde bitmedi'
              : `ölçüm betiği hata verdi: ${outcome.message.split(/\r?\n/)[0]?.slice(0, 160)}`;
        writeResult('errors', part, {
          ...blank,
          outcome: outcome.kind,
          verdict: outcome.kind === 'error' ? 'ölçülemedi' : 'bozuk',
          why,
          pageErrors: problems.pageErrors,
          consoleErrors: problems.consoleErrors,
          longestUnresponsiveMs: freeze.longest(),
        });
      }
    });
  }
}

async function measureCell(page: Page, testInfo: TestInfo, task: Task, item: Case, problems: PageProblems): Promise<Record<string, unknown>> {
  {
    {
      await installSavePicker(page);
      if (item.fake === 'size') {
        await page.addInitScript(() => {
          const real = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
          Object.defineProperty(File.prototype, 'size', {
            configurable: true,
            get(this: File) {
              return this.name.startsWith('kalite-cok-buyuk') ? 5 * 1024 ** 3 : (real?.call(this) ?? 0);
            },
          });
        });
      }
      if (item.fake === 'duration') {
        await page.addInitScript(() => {
          const real = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')?.get;
          Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
            configurable: true,
            get(this: HTMLMediaElement) {
              const value = real?.call(this) as number;
              return Number.isFinite(value) && value > 0 ? 3 * 3600 : value;
            },
          });
        });
      }

      await page.goto(`/yap/${task}/`);
      await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
      await expect(page.getByTestId('video-input')).toHaveCount(1);
      const started = Date.now();
      await page.getByTestId('video-input').setInputFiles(item.file(task) as string);
      const outcome = await firstAnswer(page);
      const answerMs = Date.now() - started;
      if (outcome === 'opened') await settle(page);
      const seen: Observation = { outcome, answerMs, ...(await observe(page)) };

      // A file that opened although it is not whole: what does "İndir" make of it?
      let attempt: { phase: string; text: string; savedDurationS: number | null; savedTailDb: number | null; shownLength: string | null } | null = null;
      if (item.expected === 'refuse-or-fail' && outcome === 'opened') {
        const shownLength = task === 'kes' ? null : await page.getByTestId('wizard-video-length').textContent({ timeout: 5000 }).catch(() => null);
        let pressed = false;
        if (task === 'kes') {
          await addKesit(page, '2', '20');
          if ((await page.getByTestId('kesit-download').count()) > 0) {
            await page.getByTestId('kesit-download').first().click();
            pressed = true;
          }
        } else {
          if (task === 'muzik' && (await page.getByTestId('audio-input').count()) > 0) {
            await page.getByTestId('audio-input').setInputFiles(MUSIC);
            await page.getByTestId('muzik-picked').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
          }
          const download = page.getByTestId('wizard-download');
          if ((await download.count()) > 0 && (await download.isEnabled())) {
            await download.click();
            pressed = true;
          }
        }
        if (pressed) {
          const phase = await waitForResult(page, 150_000);
          const after = await observe(page);
          let savedDurationS: number | null = null;
          let savedTailDb: number | null = null;
          if (phase === 'saved') {
            try {
              const saved = await takeSavedFile(page, testInfo, `hata-${task}-${item.id}`);
              const info = probeFile(saved);
              savedDurationS = round(info.durationS, 2);
              // Is the end of the file sound, or the silence of the part that never arrived?
              if (info.audio) savedTailDb = tailVolumeDb(saved, Math.min(4, info.durationS / 4));
            } catch {
              savedDurationS = null;
            }
          }
          // What a sighted user reads in the result (without the hidden copy for screen readers, without button labels).
          const resultText = await page
            .locator('[data-testid="export-failed"], [data-testid="export-succeeded"], [data-testid="wizard-result"]')
            .first()
            .evaluate((element) => {
              const pieces: string[] = [];
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (node.parentElement?.closest('.visually-hidden, button, details')) continue;
                const piece = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (piece !== '') pieces.push(piece);
              }
              return pieces.join(' ');
            })
            .catch(() => '');
          attempt = { phase, text: (after.messages.join(' ') || resultText).replace(/\s+/g, ' ').trim().slice(0, 300), savedDurationS, savedTailDb, shownLength };
        }
      }

      let judged: Verdict;
      if (problems.pageErrors.length > 0) {
        judged = { verdict: 'bozuk', why: `sayfa hatası: ${problems.pageErrors[0]?.slice(0, 120)}` };
      } else if (outcome === 'silent') {
        judged = { verdict: 'bozuk', why: '25 sn içinde ne bir mesaj ne bir ilerleme' };
      } else if (item.expected === 'say-no-sound') {
        if (!NEEDS_SOUND.includes(task)) {
          // "Küçült" on a video that is already small offers no download and SAYS so (10 Oct 2026): that is
          // an answer about the file's size, not a silence about its missing sound. The sentence is kept in `why`.
          judged =
            seen.step === 'editor' || seen.downloadEnabled || task === 'muzik'
              ? { verdict: 'geçerli değil', why: 'bu iş videonun sesine ihtiyaç duymaz; video açıldı' }
              : seen.messages.length > 0
                ? { verdict: 'geçerli değil', why: `bu iş videonun sesine ihtiyaç duymaz; video açıldı, adım indirme sunmadı ve nedenini söyledi (“${seen.messages.join(' ').slice(0, 120)}”)` }
                : { verdict: 'belirsiz', why: 'video açıldı ama adım ilerlemiyor ve nedenini söylemiyor' };
        } else if (seen.messages.length === 0) {
          judged = seen.downloadEnabled
            ? { verdict: 'bozuk', why: 'ses yok ama hiçbir şey söylenmeden indirme sunuluyor' }
            : { verdict: 'bozuk', why: 'ses yok; ne mesaj var ne indirme' };
        } else if (seen.downloadEnabled) {
          judged = { verdict: 'belirsiz', why: 'ses olmadığını söylüyor ama indirme yine de açık' };
        } else {
          const wayOn = seen.controls.length > 0;
          judged = wayOn
            ? { verdict: 'iyi', why: 'ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var' }
            : { verdict: 'belirsiz', why: 'ses olmadığını söylüyor ama ekranda basılacak bir şey yok' };
        }
      } else if (outcome === 'refused') {
        judged = seen.stillBusy ? { verdict: 'bozuk', why: 'reddetti ama ekranda hâlâ bekleme göstergesi var' } : judgeMessage(seen.messages, seen.controls);
      } else if (item.expected === 'refuse') {
        judged = { verdict: item.id === 'yalniz-ses' ? 'belirsiz' : 'bozuk', why: 'reddedilmesi gereken dosya hiçbir şey söylenmeden açıldı' };
      } else if (attempt === null) {
        judged =
          task === 'yazi'
            ? { verdict: 'ölçülemedi', why: 'yarım dosya açıldı; yazıya dökme model dosyaları bu makinede olmadığı için denenemedi' }
            : seen.messages.length > 0
              ? { verdict: 'ölçülemedi', why: `yarım dosya açıldı ama bu adım indirme sunmadı (“${seen.messages.join(' ').slice(0, 80)}”); yarım dosyanın işlenmesi denenemedi` }
              : { verdict: 'belirsiz', why: 'yarım dosya açıldı; indirme düğmesi kapalı ve nedenini söyleyen bir şey yok' };
      } else if (attempt.phase === 'timeout') {
        judged = { verdict: 'bozuk', why: 'indirme 150 sn içinde ne bitti ne hata verdi' };
      } else if (attempt.phase === 'saved' || attempt.phase === 'ready') {
        const tr = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
        const tail =
          attempt.savedTailDb === null
            ? ''
            : `; dosyanın son bölümünün ses düzeyi ${Number.isFinite(attempt.savedTailDb) ? `${tr(attempt.savedTailDb)} dB` : 'tam sessizlik'}${attempt.savedTailDb < -70 ? ' (sessizlik)' : ''}`;
        judged = {
          verdict: 'belirsiz',
          why: `yarım dosyadan uyarısız bir dosya kaydedildi (ekranda gösterilen süre ${attempt.shownLength ?? '—'}, kaydedilen ${attempt.savedDurationS === null ? '—' : tr(attempt.savedDurationS)} sn${tail})`,
        };
      } else if (/chrome|edge|tarayıcı/iu.test(attempt.text)) {
        // The file is cut short; a sentence that points at the browser sends the user the wrong way.
        judged = { verdict: 'belirsiz', why: 'sorun dosyada (yarım), mesaj tarayıcıyı gösteriyor ve başka tarayıcı öneriyor: yanlış yöne gönderir' };
      } else {
        judged = judgeMessage([attempt.text], seen.controls);
      }

      return {
        task,
        case: item.id,
        caseLabel: item.label,
        expected: item.expected,
        ...seen,
        attempt,
        verdict: judged.verdict,
        why: judged.why,
        pageErrors: problems.pageErrors,
        consoleErrors: problems.consoleErrors,
      };
    }
  }
}
