/**
 * The fuzz run's helpers (scripts/fuzz/run-fuzz.mjs, tests/fuzz/fuzz.spec.ts):
 * the corpus manifest, what is on the screen, what a saved file measures
 * like, and how a cell is judged — the quality layer's rules
 * (tests/quality/errors.spec.ts), extended with "what a careful app should
 * have done with this file" (the manifest's `expect`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Page } from '@playwright/test';

import { PAGE_NOTICE_ID, PAGE_RECOVERED_LOG } from '../../src/pageWatchdog';
import { strongJargon } from '../quality/lib/jargon';
import { probeFile, type FileInfo } from '../quality/lib/media';

export const SCRATCH = join(process.cwd(), '.scratch', 'fuzz');
export const CORPUS_DIR = process.env.FUZZ_CORPUS ?? join(SCRATCH, 'corpus');
export const RESULTS = join(SCRATCH, 'results');
export const OUTPUTS = join(SCRATCH, 'outputs');

export const TASKS = ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'cevir', 'iyilestir'] as const;
export type Task = (typeof TASKS)[number];
export type Surface = Task | 'editor';
export const SURFACES: readonly Surface[] = [...TASKS, 'editor'];

export type Expectation = 'open' | 'refuse' | 'any';

export interface CorpusItem {
  id: string;
  group: string;
  label: string;
  expect: Expectation;
  file: string;
  name: string;
  mime: string;
  bytes: number;
  durationS: number | null;
  tolerance: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export function readManifest(): CorpusItem[] {
  const path = join(CORPUS_DIR, 'manifest.json');
  if (!existsSync(path)) throw new Error(`no corpus at ${path}: run \`node scripts/fuzz/make-corpus.mjs\` first`);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { items: CorpusItem[] };
  const only = (process.env.FUZZ_FILES ?? '').split(',').filter(Boolean);
  return only.length > 0 ? manifest.items.filter((item) => only.includes(item.id)) : manifest.items;
}

export function selectedSurfaces(): Surface[] {
  const only = (process.env.FUZZ_SURFACES ?? '').split(',').filter(Boolean) as Surface[];
  return only.length > 0 ? SURFACES.filter((surface) => only.includes(surface)) : [...SURFACES];
}

export function payloadOf(item: CorpusItem): { name: string; mimeType: string; buffer: Buffer } {
  return { name: item.name, mimeType: item.mime, buffer: readFileSync(join(CORPUS_DIR, item.file)) };
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeCell(surface: string, id: string, data: unknown): void {
  ensureDir(RESULTS);
  writeFileSync(join(RESULTS, `${surface}.${id}.json`), `${JSON.stringify({ surface, id, measuredAt: new Date().toISOString(), data }, null, 2)}\n`);
}

// ------------------------------------------------------------ the screen

export interface Observation {
  step: string | null;
  messages: string[];
  stillBusy: boolean;
  downloadEnabled: boolean;
  controls: string[];
}

/** What a sighted user reads: the messages, the controls, whether a download can be pressed. */
export async function observe(page: Page): Promise<Observation> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const withCheck = element as Element & { checkVisibility?: () => boolean };
      return box.width > 0 && box.height > 0 && (!withCheck.checkVisibility || withCheck.checkVisibility());
    };
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
      '[data-testid="export-blocked"], [data-testid="export-over-limit"], [data-testid="enhance-preview-failed"], ' +
      '[data-testid="cevir-already"], [data-testid="yazi-no-sound"], [data-testid="wizard-unavailable"], [data-testid="editor-failed"], ' +
      // The watchdog's own notice (src/pageWatchdog.ts PAGE_NOTICE_ID).
      '#clip-page-dead';
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
    const download = document.querySelector<HTMLButtonElement>('[data-testid="wizard-download"], [data-testid="kesit-download"], [data-testid="download-all"]');
    return {
      step: document.querySelector('[data-testid="wizard"]')?.getAttribute('data-step') ?? (document.querySelector('[data-testid="preview-video"]') ? 'editor' : null),
      messages: [...messages],
      stillBusy: [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible),
      downloadEnabled: download !== null && !download.disabled && visible(download),
      controls: controls.slice(0, 12),
    };
  });
}

export interface PageProblems {
  pageErrors: string[];
  consoleErrors: string[];
  unhandledRejections: string[];
  /** The page reloaded itself because it never came alive (src/pageWatchdog.ts). */
  watchdogReloads: number;
  crashed: boolean;
}

/** Listens for everything a page can say about having broken; call before the page loads. */
export async function watchProblems(page: Page): Promise<PageProblems> {
  const problems: PageProblems = { pageErrors: [], consoleErrors: [], unhandledRejections: [], watchdogReloads: 0, crashed: false };
  page.on('pageerror', (error) => problems.pageErrors.push(error.message.slice(0, 300)));
  page.on('crash', () => {
    problems.crashed = true;
  });
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith(PAGE_RECOVERED_LOG)) problems.watchdogReloads += 1;
    else if (message.type() === 'error') problems.consoleErrors.push(text.slice(0, 300));
  });
  await page.exposeFunction('__fuzzRejection', (reason: string) => {
    problems.unhandledRejections.push(reason.slice(0, 300));
  });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const report = (window as unknown as { __fuzzRejection?: (reason: string) => void }).__fuzzRejection;
      report?.(String((event.reason as { message?: string } | undefined)?.message ?? event.reason));
    });
  });
  return problems;
}

/** Whether the page shows "Sayfa tam açılamadı" (the watchdog gave up). */
export async function pageDead(page: Page): Promise<boolean> {
  return page.evaluate((id) => document.getElementById(id)?.getAttribute('data-state') === 'dead', PAGE_NOTICE_ID).catch(() => false);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks the page a trivial question every two seconds. A page that does not answer for a minute has a
 * locked main thread: for the user the tab is frozen, whatever the script was waiting for.
 */
export function watchFreeze(page: Page) {
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

// ------------------------------------------------------------ the saved file

export interface SanityCheck {
  name: string;
  ok: boolean;
  value: string;
  /** A failed check of this weight makes the cell broken (a fake success); the others make it unclear. */
  weight: 'broken' | 'unclear';
}

export interface SavedFile {
  name: string;
  bytes: number;
  durationS: number | null;
  streams: string[];
  width: number | null;
  height: number | null;
  decodeErrors: string | null;
  decodedFrames: number | null;
  checks: SanityCheck[];
}

const tr = (value: number, digits = 2) => value.toLocaleString('tr-TR', { maximumFractionDigits: digits });

/** Decodes the whole file with ffmpeg: a file that "plays" has no decode error and at least one frame (or sample). */
function decodeAll(file: string, hasVideo: boolean): { errors: string | null; frames: number | null } {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // The null muxer's own complaint is not about the file: it rounds a low-rate, variable-rate video's
  // times to its own coarse clock (1 s at 1 frame/s) and then finds two equal ones. The packets
  // themselves are checked by ffprobe. Every other line — the decoders' — counts.
  const lines = (result.stderr ?? '').split(/\r?\n/);
  const kept: string[] = [];
  let skipped = false;
  for (const line of lines) {
    const repeat = /^\s*Last message repeated \d+ times?$/.test(line);
    if (/^\[null @ [^\]]+\] Application provided invalid, non monotonically increasing dts to muxer/.test(line) || (repeat && skipped)) {
      skipped = true;
      continue;
    }
    skipped = false;
    if (line.trim() !== '') kept.push(line);
  }
  const errors = kept.join('\n').trim();
  let frames: number | null = null;
  if (hasVideo) {
    const count = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    // With a display matrix (a rotated video) ffprobe prints "60," — the side data's empty column: the first field is the count.
    frames = Number.parseInt((count.stdout ?? '').trim().split(/[,\s]/)[0] ?? '', 10) || 0;
  }
  return { errors: errors === '' ? null : errors.slice(0, 300), frames };
}

/** The display matrix's rotation of the first picture track, in degrees (0 when there is none). */
function displayRotation(file: string): number {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_side_data=rotation', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number.parseInt((result.stdout ?? '').trim().split(/[,\s]/)[0] ?? '', 10) || 0;
}

/**
 * Is the saved file what the card promised for this source? Length against the source's (what the
 * default path keeps: the whole video, the first two seconds in "Kes", the gaps removed in "Boşlukları
 * at"), the tracks the card promises, a picture no larger than the source's (ADR-041), portrait where
 * the source is rotated or the card is "Dikey yap", and a decode of the whole file with ffmpeg.
 */
export function measureSaved(file: string, name: string, surface: Surface, item: CorpusItem, kesitS: number | null): SavedFile {
  let info: FileInfo | null = null;
  try {
    info = probeFile(file);
  } catch {
    info = null;
  }
  const checks: SanityCheck[] = [];
  const add = (check: SanityCheck) => checks.push(check);
  if (!info) {
    add({ name: 'ffprobe okuyabildi', ok: false, value: 'okunamadı', weight: 'broken' });
    return { name, bytes: 0, durationS: null, streams: [], width: null, height: null, decodeErrors: null, decodedFrames: null, checks };
  }
  const streams = info.streams.map((stream) => `${stream.type}:${stream.codec}`);
  const audioOnly = surface === 'ses';
  // "Müzik ekle" brings its own sound: a source without one still gets the music.
  // "Sesini al" saves only the sound; "Sesi kapat" only the picture.
  const expectAudio = audioOnly || (surface !== 'sustur' && (item.hasAudio || surface === 'muzik'));
  const expectVideo = !audioOnly;

  // Length.
  const source = item.durationS;
  if (source !== null) {
    const wanted = surface === 'kes' && kesitS !== null ? kesitS : source;
    const tolerance = Math.max(0.25, item.tolerance);
    const got = info.durationS;
    if (surface === 'bosluk') {
      add({ name: 'süre: kaynaktan uzun değil, sıfır değil', ok: got > 0 && got <= wanted + tolerance, value: `${tr(got)} sn (kaynak ${tr(wanted)} sn)`, weight: 'broken' });
    } else {
      add({ name: `süre ≈ ${tr(wanted)} sn (± ${tr(tolerance)})`, ok: Math.abs(got - wanted) <= tolerance, value: `${tr(got)} sn`, weight: 'broken' });
    }
  }
  // Tracks.
  add({ name: expectVideo ? 'görüntü izi var' : 'görüntü izi yok (yalnızca ses)', ok: expectVideo ? info.video !== null : info.video === null, value: streams.join(' + ') || 'iz yok', weight: 'broken' });
  add({ name: expectAudio ? 'ses izi var' : 'ses izi yok', ok: expectAudio ? info.audio !== null : info.audio === null, value: streams.join(' + ') || 'iz yok', weight: 'broken' });
  if (expectVideo && info.video) {
    add({ name: 'görüntü H.264', ok: info.video.codec === 'h264', value: info.video.codec, weight: 'unclear' });
    const width = info.video.width ?? 0;
    const height = info.video.height ?? 0;
    if (surface === 'dikey') {
      // An already upright (rotated) source is copied with its display matrix: players show it upright.
      const turned = Math.abs(displayRotation(file)) % 180 === 90;
      const [shownWidth, shownHeight] = turned ? [height, width] : [width, height];
      add({ name: 'dikey (9:16)', ok: shownHeight > shownWidth, value: `${shownWidth} × ${shownHeight}${turned ? ' (döndürme bilgisiyle)' : ''}`, weight: 'unclear' });
    } else if (item.width && item.height) {
      // Never enlarged (ADR-041): a rotated source swaps its sides, so pixels are compared, not sides. The one
      // exception is deliberate (src/domain/outputSize.ts MIN_OUTPUT_SHORT_EDGE): a picture smaller than 144 px on
      // its short side is brought up to 144, because hardware encoders refuse smaller ones; with subtitles burned
      // in ("Yazıya dök") to 360 (MIN_CAPTION_SHORT_EDGE), so the letters keep their shape.
      const floor = surface === 'yazi' ? 360 : 144;
      const lifted = Math.min(item.width, item.height) < floor && Math.min(width, height) <= floor;
      add({ name: `büyütülmemiş (piksel ≤ kaynak; ${floor} px tabanı hariç)`, ok: lifted || width * height <= item.width * item.height + 2 * Math.max(item.width, item.height), value: `${width} × ${height} (kaynak ${item.width} × ${item.height})`, weight: 'unclear' });
      if (/^dondurme-(90|270)$/.test(item.id)) {
        // Turned upright either in the pixels or by a display matrix the players apply (the quick cut copies it).
        const turned = Math.abs(displayRotation(file)) % 180 === 90;
        const [shownWidth, shownHeight] = turned ? [height, width] : [width, height];
        add({ name: 'döndürme uygulanmış (dikey görünüyor)', ok: shownHeight > shownWidth, value: `${shownWidth} × ${shownHeight}${turned ? ' (döndürme bilgisiyle)' : ''}`, weight: 'unclear' });
      }
    }
  }
  if (expectAudio && info.audio) add({ name: 'ses AAC', ok: info.audio.codec === 'aac', value: info.audio.codec, weight: 'unclear' });
  // Plays.
  const decoded = decodeAll(file, expectVideo);
  add({ name: 'baştan sona çözülüyor (ffmpeg hatasız)', ok: decoded.errors === null, value: decoded.errors ?? 'hata yok', weight: 'broken' });
  if (expectVideo) add({ name: 'en az bir kare', ok: (decoded.frames ?? 0) > 0, value: `${decoded.frames ?? 0} kare`, weight: 'broken' });
  return {
    name,
    bytes: info.bytes,
    durationS: info.durationS,
    streams,
    width: info.video?.width ?? null,
    height: info.video?.height ?? null,
    decodeErrors: decoded.errors,
    decodedFrames: decoded.frames,
    checks,
  };
}

// ------------------------------------------------------------ the verdict

export type Outcome =
  /** Refused when picked (the media-error notice). */
  | 'refused'
  /** "Kaydedildi": a file was written through the save dialog. */
  | 'saved'
  /** The file is ready but there was no save dialog (the phone route): not expected on the desktop. */
  | 'ready'
  /** The download ended with "Bu sefer olmadı" and a reason. */
  | 'failed'
  /** The download was not started: the capability check or a plan rule said no. */
  | 'blocked'
  /** The video opened, the card offered no download and said why. */
  | 'noop'
  /** The video opened; after the bounded wait there is neither a download nor a word about it. */
  | 'unclear'
  /** Nothing — no refusal, no next step — within the bounded wait after the file was picked. */
  | 'silent'
  /** The download neither ended nor failed within its bound. */
  | 'stuck'
  /** The page process crashed, or the page reported an uncaught error. */
  | 'crash'
  /** The main thread did not answer for a minute. */
  | 'frozen';

export type VerdictKind = 'iyi' | 'belirsiz' | 'bozuk' | 'ölçülemedi';

export interface Verdict {
  verdict: VerdictKind;
  why: string;
}

/**
 * A verb that tells the user what to do next ("Başka bir dosya dene", "Videoyu yeniden seç"): the
 * imperative or "…ebilirsin" forms as whole words (the quality layer's list).
 */
const SAYS_WHAT_TO_DO =
  /(?<![\p{L}])(dene|deneyin|deneyebilirsin|deneyebilir|seç|seçin|seçebilirsin|kullan|kullanabilirsin|yenile|kısalt|kes|böl|indir|kapat|ekle|bağla|bak|aç)(?![\p{L}])/iu;

/** A button that leads on from a card with nothing to do: another video, or the editor. */
const WAY_ON_CONTROL = /başka bir video|editörde|editöre/iu;

/** The file is damaged or lying: a sentence that points at the browser sends the user the wrong way. */
const DAMAGED_GROUPS = new Set(['bozuk', 'yalan']);
const BLAMES_BROWSER = /\bchrome\b|\bedge\b/iu;

export function judgeMessage(messages: string[], controls: string[], item: CorpusItem): Verdict {
  const text = messages.join(' ');
  const jargon = strongJargon(text);
  if (jargon.length > 0) return { verdict: 'belirsiz', why: `mesajda teknik terim: ${[...new Set(jargon.map((hit) => hit.term))].join(', ')}` };
  if (DAMAGED_GROUPS.has(item.group) && BLAMES_BROWSER.test(text)) {
    return { verdict: 'belirsiz', why: 'sorun dosyada, mesaj başka tarayıcı öneriyor: yanlış yöne gönderir' };
  }
  if (!SAYS_WHAT_TO_DO.test(text)) {
    return { verdict: 'belirsiz', why: `ne olduğunu söylüyor, ne yapılacağını söylemiyor (ekrandaki düğmeler: ${controls.slice(0, 4).join(', ') || 'yok'})` };
  }
  return { verdict: 'iyi', why: 'ne olduğunu ve ne yapılacağını söylüyor' };
}

export interface CellFacts {
  outcome: Outcome;
  messages: string[];
  controls: string[];
  stillBusy: boolean;
  saved: SavedFile | null;
  problems: PageProblems;
  dead: boolean;
}

export function judge(facts: CellFacts, item: CorpusItem): Verdict {
  const { outcome, messages, controls, saved, problems } = facts;
  if (facts.dead) return { verdict: 'bozuk', why: 'sayfa hiç açılamadı ("Sayfa tam açılamadı")' };
  if (problems.crashed) return { verdict: 'bozuk', why: 'sekme çöktü' };
  if (problems.pageErrors.length > 0) return { verdict: 'bozuk', why: `sayfa hatası: ${problems.pageErrors[0]?.slice(0, 120)}` };
  if (outcome === 'frozen') return { verdict: 'bozuk', why: 'sayfa en az 60 sn hiç yanıt vermedi (dondu); kullanıcı için sekme kilitlenir' };
  if (outcome === 'silent') return { verdict: 'bozuk', why: 'dosya seçildikten sonra 60 sn içinde ne bir mesaj ne bir ilerleme' };
  if (outcome === 'stuck') return { verdict: 'bozuk', why: 'indirme süresi içinde ne bitti ne hata verdi (takılı bekleme)' };
  if (outcome === 'crash') return { verdict: 'bozuk', why: 'sayfa hatası' };

  const failedSanity = saved?.checks.filter((check) => !check.ok) ?? [];
  const brokenSanity = failedSanity.filter((check) => check.weight === 'broken');
  const describe = (checks: SanityCheck[]) => checks.map((check) => `${check.name}: ${check.value}`).join('; ');

  let verdict: Verdict;
  if (outcome === 'refused') {
    if (facts.stillBusy) verdict = { verdict: 'bozuk', why: 'reddetti ama ekranda hâlâ bekleme göstergesi var' };
    else if (item.expect === 'open') verdict = { verdict: 'bozuk', why: `geçerli bir dosya reddedildi (yanlış ret): “${messages.join(' ').slice(0, 160)}”` };
    else verdict = judgeMessage(messages, controls, item);
  } else if (outcome === 'saved' || outcome === 'ready') {
    if (!saved) verdict = { verdict: 'ölçülemedi', why: 'dosya kaydedildi dendi ama dosya alınamadı' };
    else if (brokenSanity.length > 0) verdict = { verdict: 'bozuk', why: `sahte başarı: “Kaydedildi” dendi ama dosya söz verilen gibi değil — ${describe(brokenSanity)}` };
    else if (item.expect === 'refuse') verdict = { verdict: 'bozuk', why: `reddedilmesi gereken dosyadan uyarısız bir dosya kaydedildi (${describe(saved.checks.filter((c) => c.ok)).slice(0, 120)})` };
    else if (failedSanity.length > 0) verdict = { verdict: 'belirsiz', why: `dosya kaydedildi ama ${describe(failedSanity)}` };
    else verdict = { verdict: 'iyi', why: `kaydedildi; dosya ffprobe ile denetlendi (${saved.streams.join(' + ')}, ${saved.durationS === null ? '—' : tr(saved.durationS)} sn)` };
  } else if (outcome === 'failed' || outcome === 'blocked') {
    const judged = judgeMessage(messages, controls, item);
    if (item.expect === 'open') verdict = { verdict: judged.verdict === 'iyi' ? 'belirsiz' : judged.verdict, why: `geçerli bir dosya işlenemedi; dürüst hata (${judged.why})` };
    else verdict = judged;
  } else if (outcome === 'noop') {
    if (item.expect === 'refuse') verdict = { verdict: 'belirsiz', why: `reddedilmesi gereken dosya açıldı; adım indirme sunmadı ve şöyle dedi: “${messages.join(' ').slice(0, 120)}”` };
    else {
      // "Nothing to do with this video" is not a refusal: as in the quality layer's sound-less videos
      // (tests/quality/errors.spec.ts), a plain reason plus a button on the screen that leads on
      // ("Başka bir video seç", the editor) is the way forward.
      const judged = judgeMessage(messages, controls, item);
      const leadsOn = controls.some((name) => WAY_ON_CONTROL.test(name));
      verdict = judged.verdict === 'belirsiz' && judged.why.startsWith('ne olduğunu söylüyor') && leadsOn
        ? { verdict: 'iyi', why: `yapacak iş olmadığını sade sözle söylüyor; ekranda yol var (${controls.filter((name) => WAY_ON_CONTROL.test(name)).slice(0, 2).join(', ')})` }
        : judged;
    }
  } else {
    // unclear
    verdict = facts.stillBusy
      ? { verdict: 'bozuk', why: 'video açıldı, 90 sn sonra hâlâ bekleme göstergesi var ve bir şey söylenmiyor (bitmeyen bekleme)' }
      : item.expect === 'refuse'
        ? { verdict: 'belirsiz', why: 'reddedilmesi gereken dosya hiçbir şey söylenmeden açıldı; indirme sunulmadı' }
        : { verdict: 'belirsiz', why: 'video açıldı ama adım ilerlemiyor ve nedenini söylemiyor' };
  }
  if (problems.watchdogReloads > 0 && verdict.verdict === 'iyi') {
    verdict = { verdict: 'belirsiz', why: `${verdict.why}; ama sayfa kendini ${problems.watchdogReloads} kez yeniden yüklemek zorunda kaldı (bekçi)` };
  }
  return verdict;
}
