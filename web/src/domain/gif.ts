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

export type GifSizeId = 'small' | 'medium';

/** The long edge of each size ("Küçük", "Orta"). */
export const GIF_LONG_EDGE: Record<GifSizeId, number> = { small: 320, medium: 480 };

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

/** Whether "Orta" would be any larger than "Küçük" for this video (a small video has one size only). */
export function mediumIsLarger(videoWidth: number, videoHeight: number): boolean {
  const small = planGifSize(videoWidth, videoHeight, 'small');
  const medium = planGifSize(videoWidth, videoHeight, 'medium');
  return medium.width > small.width;
}

// ---------------------------------------------------------------- the estimate

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
