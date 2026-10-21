/**
 * "GIF yap" (ADR-046): the plan of a GIF, before anything is decoded.
 *
 * Pure: which part of the video (at most 10 seconds), how large (never
 * larger than the video, ADR-041), which moments become frames, where the
 * top and bottom text go and how they wrap. The only thing taken from a real
 * font is a width (`measure`), supplied by the caller — the page measures
 * with the same bundled font the worker draws with, so the preview and the
 * GIF break the lines in the same places (as the captions do, ADR-015).
 */

import { fileBaseName } from './kesit';
import { WEB_LOCAL_POLICY } from './policy';
import { US_PER_SECOND, type Micros } from './time';

// ---------------------------------------------------------------- the part

/**
 * The longest GIF (doc 15 v11). A GIF has no video compression: every frame
 * is a full picture, so ten seconds of a 480-pixel GIF of grainy or softly
 * shaded pictures already weighed 5,3–6,6 MB (ADR-046) — more than most chat
 * apps take as a GIF.
 */
export const GIF_MAX_DURATION_US: Micros = WEB_LOCAL_POLICY.maxGifDurationUs;
/** The part chosen before the user chooses (mockup B: "4 sn"). */
export const GIF_DEFAULT_DURATION_US: Micros = 4 * US_PER_SECOND;
/** The shortest part the bar allows: about six frames. A shorter video is taken whole. */
export const GIF_MIN_DURATION_US: Micros = US_PER_SECOND / 2;

export interface GifRange {
  startUs: Micros;
  endUs: Micros;
}

export function gifRangeLength(range: GifRange): Micros {
  return range.endUs - range.startUs;
}

/** The shortest part of this video: half a second, or the whole video when it is shorter. */
export function minGifLength(videoUs: Micros): Micros {
  return Math.min(GIF_MIN_DURATION_US, Math.max(0, videoUs));
}

/**
 * The first part offered: a video that fits in a GIF is taken whole; a longer
 * one starts with its first four seconds.
 */
export function initialGifRange(videoUs: Micros): GifRange {
  const length = Math.max(0, videoUs);
  if (length <= GIF_MAX_DURATION_US) return { startUs: 0, endUs: length };
  return { startUs: 0, endUs: GIF_DEFAULT_DURATION_US };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The same length, starting at `startUs` (dragged along the bar); kept inside the video. */
export function moveGifRange(range: GifRange, startUs: Micros, videoUs: Micros): GifRange {
  const length = Math.min(gifRangeLength(range), videoUs);
  const start = clamp(Math.round(startUs), 0, Math.max(0, videoUs - length));
  return { startUs: start, endUs: start + length };
}

/**
 * One edge moved. `capped`: the user asked for more than ten seconds, and
 * the part stopped at ten — the screen says so in words.
 */
export function moveGifEdge(
  range: GifRange,
  edge: 'start' | 'end',
  toUs: Micros,
  videoUs: Micros,
): { range: GifRange; capped: boolean } {
  const min = minGifLength(videoUs);
  const to = Math.round(toUs);
  if (edge === 'start') {
    const lowest = Math.max(0, range.endUs - GIF_MAX_DURATION_US);
    const start = clamp(to, lowest, Math.max(0, range.endUs - min));
    return { range: { startUs: start, endUs: range.endUs }, capped: to < lowest && lowest > 0 };
  }
  const highest = Math.min(videoUs, range.startUs + GIF_MAX_DURATION_US);
  const end = clamp(to, Math.min(videoUs, range.startUs + min), highest);
  return { range: { startUs: range.startUs, endUs: end }, capped: to > highest && highest < videoUs };
}

/** A part made valid for this video: inside it, at least the minimum, at most ten seconds. */
export function normalizeGifRange(range: GifRange, videoUs: Micros): GifRange {
  const min = minGifLength(videoUs);
  const length = clamp(gifRangeLength(range), min, Math.min(GIF_MAX_DURATION_US, videoUs));
  const start = clamp(range.startUs, 0, Math.max(0, videoUs - length));
  return { startUs: start, endUs: start + length };
}

// ---------------------------------------------------------------- frames

/**
 * 12,5 frames a second: one frame every 8 hundredths of a second, the unit
 * a GIF counts its delays in, so the GIF runs at exactly the video's pace
 * (15 fps would need 7, 7, 6 … hundredths). Measured in ADR-046: 15 fps made
 * the files 13–22 % larger, 10 fps 15–21 % smaller; 12,5 is the middle.
 */
export const GIF_FRAME_DELAY_CS = 8;
export const GIF_FRAME_US: Micros = GIF_FRAME_DELAY_CS * 10_000;

/** The source moments that become frames, in microseconds from the start of the video. */
export function gifFrameTimesUs(range: GifRange): Micros[] {
  const length = gifRangeLength(range);
  const count = Math.max(1, Math.round(length / GIF_FRAME_US));
  const times: Micros[] = [];
  for (let i = 0; i < count; i += 1) times.push(range.startUs + i * GIF_FRAME_US);
  return times;
}

// ---------------------------------------------------------------- size

export type GifSizeId = 'small' | 'medium' | 'large' | 'xlarge';

/** Smallest first. */
export const GIF_SIZE_IDS: readonly GifSizeId[] = ['small', 'medium', 'large', 'xlarge'];

/**
 * The long edge of each size ("Küçük", "Orta", "Büyük", "Çok büyük"). "Büyük" since 19 October 2026
 * (ADR-046 addendum): measured on real phone recordings, what a phone shows of a GIF depends far more
 * on its size than on its colours — VMAF of the GIF shown at the phone's width, median of 13
 * recordings, 36 (320) → 62 (480) → 78 (640), while every palette and dithering choice moved it by 3
 * at most. "Çok büyük" (960) since 21 October (addendum 2, its pre-registered rule): phone-view VMAF
 * (NEG model) 78 → 88; a 4-second GIF 11,5 MB (median of 12 recordings, at most 22 MB); ten seconds of
 * its frames 259 MB in memory. 1280 and 1920 failed that rule on file size (4 s: 20 / 39 MB median)
 * and on memory (461 / 1037 MB).
 */
export const GIF_LONG_EDGE: Record<GifSizeId, number> = { small: 320, medium: 480, large: 640, xlarge: 960 };

export interface GifSize {
  width: number;
  height: number;
}

/**
 * The GIF's size: the video's own shape with the chosen long edge — never
 * larger than the video itself (ADR-041).
 */
export function planGifSize(videoWidth: number, videoHeight: number, size: GifSizeId): GifSize {
  const w = Math.max(1, Math.round(videoWidth));
  const h = Math.max(1, Math.round(videoHeight));
  const scale = Math.min(1, GIF_LONG_EDGE[size] / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * The sizes offered for this video, smallest first: each one larger than the one before it — a size
 * that would only be the video's own size again is not offered (nothing is enlarged, ADR-041). A
 * small video has one size only.
 */
export function gifSizeChoices(videoWidth: number, videoHeight: number): GifSizeId[] {
  const choices: GifSizeId[] = [];
  let previous = 0;
  for (const id of GIF_SIZE_IDS) {
    const { width } = planGifSize(videoWidth, videoHeight, id);
    if (width > previous) choices.push(id);
    previous = width;
  }
  return choices;
}

// ---------------------------------------------------------------- memory

/**
 * How many bytes of decoded frames the GIF worker may hold at once (ADR-046 memory addendum,
 * 21 Oct 2026). Every frame drawn at the GIF's size is RGBA, 4 bytes a pixel: ten seconds of
 * "Büyük" (640 × 360, 125 frames) is 115 MB — on a phone with 3–4 GB, or in Safari with its
 * tighter limit per tab, possibly enough to have the tab closed (not tried on such a phone).
 * Within the budget the frames are held as they come (one decode, as before); above it the
 * part is decoded twice — once for the palette, once to write each frame as it comes — and no
 * frame is held. Both write the same bytes (unit and e2e tests). The second decode costs time:
 * measured on this desktop, 10 s of "Büyük" took 1,9 → 2,9 s (test pattern) and 10,5 → 15 s
 * (heavy grain); so a device that says it has 8 GB or more keeps the larger budget below.
 *
 * This one: a device that says it has less than 8 GB, or says nothing (Safari, Firefox).
 * 32 MiB holds every "Küçük" GIF, 4 s of "Orta" and 2,9 s of "Büyük". Since ADR-052 the size chosen first is
 * the sharpest under 10 MB — often "Büyük" or "Çok büyük" for four seconds of a phone video: on such a device
 * that GIF is made in two passes, holding no frame (unit test `gifSharpest.test.ts`).
 */
export const GIF_HELD_FRAMES_MAX_BYTES = 32 * 1024 * 1024;
/** A device that says it has 8 GB or more (`navigator.deviceMemory`, Chromium only, rounded): every GIF in one pass. */
export const GIF_HELD_FRAMES_MAX_BYTES_LARGE_MEMORY = 128 * 1024 * 1024;

/** The frames budget for a device that reports `deviceMemory` gigabytes (undefined, or not a number: it says nothing). */
export function gifFramesBudget(deviceMemoryGb: unknown): number {
  return typeof deviceMemoryGb === 'number' && deviceMemoryGb >= 8 ? GIF_HELD_FRAMES_MAX_BYTES_LARGE_MEMORY : GIF_HELD_FRAMES_MAX_BYTES;
}

/** The decoded frames of a GIF of this size, all in memory (RGBA). */
export function gifFramesBytes(size: GifSize, frames: number): number {
  return size.width * size.height * 4 * Math.max(0, frames);
}

/**
 * Whether the GIF is made in one pass with its frames held (`true`) or in two passes holding
 * none. `budget`: a test build may move it; everything else uses the constant.
 */
export function gifHoldsFrames(size: GifSize, frames: number, budget: number = GIF_HELD_FRAMES_MAX_BYTES): boolean {
  return gifFramesBytes(size, frames) <= budget;
}

// ---------------------------------------------------------------- the estimate

/**
 * Above this the screen says that some apps may not take the GIF (founder's decision, 20 Oct 2026,
 * ADR-046 addendum): Discord's free upload limit is 10 MB; X/Twitter takes GIFs up to 15 MB; WhatsApp
 * turns a GIF into a video. Decimal megabytes, as the screen shows sizes ("10 MB" = 10 000 000 bytes).
 * Nothing is blocked.
 */
export const GIF_LARGE_FILE_BYTES = 10_000_000;

/** Whether the GIF, as estimated, is larger than many apps take. */
export function gifIsLarge(estimatedBytes: number): boolean {
  return estimatedBytes > GIF_LARGE_FILE_BYTES;
}

/**
 * The size chosen before the user chooses one (ADR-052, 21 Oct 2026: "her zaman en neti vermeliyiz"):
 * the LARGEST size this video has whose measured estimate stays within `GIF_AUTO_PICK_MAX_BYTES` (9 MB, so
 * that the file stays under 10 MB) — the sharpest GIF that is still easy to share. Never guessed: the sizes
 * are measured from the largest down (`measure`), one at a time, and the first that fits is the one (`fits`).
 * When none fits, the smallest (`none_fit`; over 10 MB the warning then says so); when a measurement itself failed, the
 * smallest too (`unknown`: the screen cannot say it fits, and "Küçük" is the size that fitted every
 * real recording measured — 10 s at most 5,1 MB, ADR-046 addendum).
 */
export type GifAutoSize =
  | { kind: 'measure'; size: GifSizeId }
  | { kind: 'chosen'; size: GifSizeId; why: 'fits' | 'none_fit' | 'unknown' | 'timeout_fits' | 'timeout_smallest' };

/** What is known of each size's estimate: bytes, `failed`, or nothing yet (absent). */
export type GifSizeEstimates = Partial<Record<GifSizeId, number | 'failed'>>;

/**
 * The estimate a size chosen FOR the user may have (ADR-052, main session's decision of 21 Oct 2026): 9 MB,
 * not 10. The screen says the GIF stays under 10 MB and the estimate is right to about ±10 % (ADR-046), so a
 * GIF estimated at 9 MB comes out under 10. The warning stays at `GIF_LARGE_FILE_BYTES` (10 MB): a size the
 * user chooses is said to be large only when its estimate passes 10 MB.
 */
export const GIF_AUTO_PICK_MAX_BYTES = 9_000_000;

/**
 * How long the search may make the user wait (ADR-052, main session's decision): after this the size is
 * settled on what is known — the largest size already measured under `GIF_AUTO_PICK_MAX_BYTES`, or the
 * smallest — and the screen says so. It never changes by itself afterwards.
 */
export const GIF_AUTO_PICK_LIMIT_MS = 8_000;

/**
 * `timedOut`: the search ran past `GIF_AUTO_PICK_LIMIT_MS`; nothing more is measured, the largest size
 * measured to fit is the one (`timeout_fits`), else the smallest (`timeout_smallest`).
 */
export function sharpestShareableGifSize(choices: readonly GifSizeId[], estimates: GifSizeEstimates, timedOut = false): GifAutoSize {
  const smallest = choices[0] ?? 'small';
  const fits = (known: number | 'failed' | undefined): known is number => typeof known === 'number' && known <= GIF_AUTO_PICK_MAX_BYTES;
  if (timedOut) {
    for (let i = choices.length - 1; i >= 0; i -= 1) {
      const size = choices[i] as GifSizeId;
      if (fits(estimates[size])) return { kind: 'chosen', size, why: 'timeout_fits' };
    }
    return { kind: 'chosen', size: smallest, why: 'timeout_smallest' };
  }
  for (let i = choices.length - 1; i >= 0; i -= 1) {
    const size = choices[i] as GifSizeId;
    const known = estimates[size];
    if (known === undefined) return { kind: 'measure', size };
    if (known === 'failed') return { kind: 'chosen', size: smallest, why: 'unknown' };
    if (fits(known)) return { kind: 'chosen', size, why: 'fits' };
  }
  return { kind: 'chosen', size: smallest, why: 'none_fit' };
}

/** GIF header, logical screen, 256-entry colour table, loop extension, trailer. */
export const GIF_FIXED_BYTES = 6 + 7 + 768 + 19 + 1;

/**
 * About how large the GIF will be, from frames really encoded (`adapters/gif`
 * encodes a few of them the way the GIF will): the first frame is a whole
 * picture, every later one costs what changed. Rounded to bytes.
 */
export function estimateGifBytes(sample: { firstFrameBytes: number; laterFrameBytes: number }, frames: number): number {
  const later = Math.max(0, frames - 1);
  return Math.round(GIF_FIXED_BYTES + sample.firstFrameBytes + later * sample.laterFrameBytes);
}

// ---------------------------------------------------------------- the text

/** The most a text box takes: a short meme line, which two lines hold even on the narrowest GIF. */
export const GIF_TEXT_MAX_CHARS = 40;

/** Typed text as it is drawn: spaces collapsed, ends trimmed, at most `GIF_TEXT_MAX_CHARS` characters. */
export function cleanGifText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(collapsed);
  return chars.length <= GIF_TEXT_MAX_CHARS ? collapsed : chars.slice(0, GIF_TEXT_MAX_CHARS).join('').trim();
}

export type MeasureGifText = (text: string, fontPx: number) => number;

export interface GifTextLine {
  text: string;
  centerX: number;
  /** Draw with textBaseline = 'middle'. */
  centerY: number;
}

export interface GifTextLayout {
  fontPx: number;
  lineHeightPx: number;
  /** The width of the dark edge around the letters (the stroke is twice this, centred on the edge). */
  outlinePx: number;
  /** The widest a line may be. */
  maxWidth: number;
  lines: GifTextLine[];
  /** The band the text takes, top to bottom. */
  top: number;
  bottom: number;
  /** Even the smallest letters needed more than two lines: the second ends in "…" (the screen says so). */
  truncated: boolean;
}

/** At most this many lines per text box. */
export const GIF_TEXT_MAX_LINES = 2;
/** The smallest letters drawn, in GIF pixels. */
export const GIF_TEXT_MIN_PX = 13;

/** The largest letters for a GIF of this size: a seventh of its height, and never wider than its width allows. */
export function gifTextMaxPx(size: GifSize): number {
  return Math.max(GIF_TEXT_MIN_PX, Math.round(Math.min(size.height * 0.14, size.width * 0.13)));
}

/**
 * Greedy word wrap at `maxWidth`; a word wider than a line by itself is cut
 * between its letters (never in the middle of a letter made of two code
 * units: Turkish letters are single code points, emoji are not).
 */
export function wrapGifText(text: string, fontPx: number, maxWidth: number, measure: MeasureGifText): string[] {
  const words = text.split(' ').filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = '';
  const push = (word: string) => {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, fontPx) <= maxWidth) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = '';
    if (measure(word, fontPx) <= maxWidth) {
      line = word;
      return;
    }
    // A word longer than a whole line: as many letters as fit, then the rest on the next line.
    let piece = '';
    for (const char of Array.from(word)) {
      if (piece && measure(piece + char, fontPx) > maxWidth) {
        lines.push(piece);
        piece = char;
      } else {
        piece += char;
      }
    }
    line = piece;
  };
  for (const word of words) push(word);
  if (line) lines.push(line);
  return lines;
}

/**
 * Classic meme text: centred, as large as fits in at most two lines, at the
 * top or the bottom of the picture. Null for an empty box (no text at all).
 * The letters shrink before a third line is needed. Ordinary words of
 * `GIF_TEXT_MAX_CHARS` letters fit even the narrowest GIF (unit tested);
 * a text that still needs more than two lines at the smallest letters keeps
 * two, the second ending in "…", and says so (`truncated`).
 */
export function layoutGifText(
  rawText: string,
  where: 'top' | 'bottom',
  size: GifSize,
  measure: MeasureGifText,
): GifTextLayout | null {
  const text = cleanGifText(rawText);
  if (!text) return null;
  const maxWidth = Math.max(1, Math.round(size.width * 0.92));
  const largest = gifTextMaxPx(size);
  let fontPx = largest;
  let lines = wrapGifText(text, fontPx, maxWidth, measure);
  while (lines.length > GIF_TEXT_MAX_LINES && fontPx > GIF_TEXT_MIN_PX) {
    fontPx -= 1;
    lines = wrapGifText(text, fontPx, maxWidth, measure);
  }
  const truncated = lines.length > GIF_TEXT_MAX_LINES;
  lines = lines.slice(0, GIF_TEXT_MAX_LINES);
  if (truncated) {
    // The end that does not fit is not dropped silently: the last line ends in "…", and the screen says so.
    const last = Array.from(lines[GIF_TEXT_MAX_LINES - 1] ?? '');
    while (last.length > 0 && measure(`${last.join('')}…`, fontPx) > maxWidth) last.pop();
    lines[GIF_TEXT_MAX_LINES - 1] = `${last.join('').trimEnd()}…`;
  }
  const lineHeightPx = Math.round(fontPx * 1.15);
  const outlinePx = Math.max(1, Math.round(fontPx * 0.09));
  const margin = Math.round(size.height * 0.04) + outlinePx;
  const blockHeight = lines.length * lineHeightPx;
  const top = where === 'top' ? margin : size.height - margin - blockHeight;
  return {
    fontPx,
    lineHeightPx,
    outlinePx,
    maxWidth,
    top,
    bottom: top + blockHeight,
    truncated,
    lines: lines.map((line, index) => ({
      text: line,
      centerX: Math.round(size.width / 2),
      centerY: Math.round(top + lineHeightPx * index + lineHeightPx / 2),
    })),
  };
}

/** What the user typed in the two boxes. */
export interface GifTexts {
  top: string;
  bottom: string;
}

// ---------------------------------------------------------------- the file

/** `tatil.mp4` → `tatil_gif.gif` (the same cleaned base name every download uses). */
export function gifFileName(videoFileName: string): string {
  return `${fileBaseName(videoFileName)}_gif.gif`;
}

export const GIF_MIME = 'image/gif';

// ---------------------------------------------------------------- the video instead (ADR-052)

/**
 * What the "GIF yap" card saves: the GIF (the default — the card's own name, and the one file that
 * plays as a GIF everywhere), or the same part as a short video ("Video olarak (en net)"): H.264 at
 * the video's own size up to Full HD (ADR-041), no sound, the same text — through the ordinary MP4
 * export, not a second encoder. Chat apps (WhatsApp, Telegram, Instagram) show such a video the way
 * they show a GIF; whether it loops is decided by the app that shows it, not by the file.
 */
export type GifOutput = 'gif' | 'video';
