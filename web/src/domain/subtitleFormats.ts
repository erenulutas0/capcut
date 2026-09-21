/**
 * SRT and WebVTT, read and written as plain text (ADR-016).
 *
 * A subtitle file is untrusted input. It is parsed into times and plain text
 * only: markup is stripped, never interpreted; entities are decoded to text;
 * VTT STYLE/REGION/NOTE blocks and cue settings are ignored. Nothing here can
 * produce HTML, a URL, a file path or a network request.
 *
 * Timing policy is NOT decided here. The parser reports every cue it could
 * read and every block it could not; the import command then applies the
 * caption rules and the user's choice of time base.
 */

import type { Micros } from './time';

export type SubtitleFormat = 'srt' | 'vtt';

export interface ParsedCue {
  startUs: Micros;
  endUs: Micros;
  /** Plain text with LF line breaks; not yet normalised to caption rules. */
  text: string;
}

export interface ParseProblem {
  /** 1-based block number in the file, as a person would count them. */
  block: number;
  reason: 'bad_timing' | 'no_text';
}

export interface ParsedSubtitles {
  format: SubtitleFormat;
  cues: ParsedCue[];
  problems: ParseProblem[];
  /** Lines that had more than two lines of text and were joined (see below). */
  joinedLines: number;
}

export type ParseResult = { ok: true; value: ParsedSubtitles } | { ok: false; reason: 'not_subtitles' | 'too_large' };

/** Well above any real subtitle file; guards the tab against a huge paste. */
export const MAX_SUBTITLE_CHARS = 2_000_000;

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const BOM = String.fromCharCode(0xfeff);

/** `HH:MM:SS,mmm` (SRT) or `[HH:]MM:SS.mmm` (VTT). Hours may exceed 99. */
const TIMESTAMP = /^(?:(\d+):)?([0-5]\d):([0-5]\d)[.,](\d{1,3})$/;

function parseTimestamp(raw: string): Micros | null {
  const match = TIMESTAMP.exec(raw.trim());
  if (!match) return null;
  const [, h, m, s, frac] = match;
  const millis = Number((frac ?? '0').padEnd(3, '0'));
  const seconds = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
  return seconds * 1_000_000 + millis * 1000;
}

/** Parses `start --> end [settings]`; null when the line is not a timing line. */
function parseTimingLine(line: string): { startUs: Micros; endUs: Micros } | null {
  const arrow = line.indexOf('-->');
  if (arrow < 0) return null;
  const start = parseTimestamp(line.slice(0, arrow));
  // VTT cue settings follow the end time after whitespace; SRT has none.
  const endPart = line.slice(arrow + 3).trim().split(/\s+/)[0] ?? '';
  const end = parseTimestamp(endPart);
  if (start === null || end === null) return null;
  return { startUs: start, endUs: end };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

/**
 * Markup to plain text: `<i>`, `<b>`, `<font …>`, VTT `<c.x>`, `<v Name>`,
 * `<ruby>`, inline `<00:00:01.000>` timestamps, and SRT/ASS override blocks
 * like `{\an8}` are removed; entities become characters. The result is only
 * ever drawn on a canvas or put into a text node.
 */
export function stripSubtitleMarkup(raw: string): string {
  const backslash = String.fromCharCode(92);
  return raw
    // Only things shaped like tags: `<i>`, `</b>`, `<c.x>`, `<v Name>`,
    // `<00:00:01.000>`. A bare "<" in ordinary text ("a < b") survives.
    .replace(/<\/?(?:[a-zA-Z][^<>]*|\d[\d:.]*)>/g, '')
    .split('{' + backslash)
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('}') + 1)))
    .join('')
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
      if (name.startsWith('#x')) return safeCodePoint(Number.parseInt(name.slice(2), 16), whole);
      if (name.startsWith('#')) return safeCodePoint(Number.parseInt(name.slice(1), 10), whole);
      return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    });
}

function safeCodePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value) || value < 0x20 || value > 0x10ffff) return fallback;
  return String.fromCodePoint(value);
}

/**
 * Captions allow two lines. A file line with three or more lines is kept by
 * joining everything after the first line into the second; the caption rules
 * (length, fit) still apply afterwards, and the join is counted for the user.
 */
function toTwoLines(lines: string[]): { text: string; joined: boolean } {
  const kept = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (kept.length <= 2) return { text: kept.join(LF), joined: false };
  return { text: `${kept[0]}${LF}${kept.slice(1).join(' ')}`, joined: true };
}

export function detectSubtitleFormat(text: string): SubtitleFormat | null {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  if (/^WEBVTT(?:[ \t]|$)/.test(body.split(LF)[0]?.replace(CR, '') ?? '')) return 'vtt';
  // SRT has no header: accept when a timing line appears early.
  const head = body.split(LF).slice(0, 12);
  if (head.some((line) => /-->/.test(line) && parseTimingLine(line.replace(CR, '')) !== null)) return 'srt';
  return null;
}

export function parseSubtitles(input: string): ParseResult {
  if (input.length > MAX_SUBTITLE_CHARS) return { ok: false, reason: 'too_large' };
  const text = (input.startsWith(BOM) ? input.slice(1) : input).split(CR + LF).join(LF).split(CR).join(LF);
  const format = detectSubtitleFormat(text);
  if (!format) return { ok: false, reason: 'not_subtitles' };

  const blocks = text.split(/\n[ \t]*\n+/).map((block) => block.split(LF));
  const cues: ParsedCue[] = [];
  const problems: ParseProblem[] = [];
  let joinedLines = 0;
  let blockNumber = 0;

  for (const [index, rawLines] of blocks.entries()) {
    const lines = rawLines.filter((line, lineIndex) => lineIndex > 0 || line.trim() !== '');
    if (lines.length === 0) continue;
    const first = lines[0]?.trim() ?? '';
    if (format === 'vtt') {
      if (index === 0 && first.startsWith('WEBVTT')) continue;
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(first)) continue;
    }
    blockNumber += 1;

    const timingAt = lines.findIndex((line) => line.includes('-->'));
    // SRT: [number] timing text…; VTT: [identifier] timing text…
    if (timingAt < 0 || timingAt > 1) {
      problems.push({ block: blockNumber, reason: 'bad_timing' });
      continue;
    }
    const timing = parseTimingLine(lines[timingAt] ?? '');
    if (!timing) {
      problems.push({ block: blockNumber, reason: 'bad_timing' });
      continue;
    }
    const body = lines.slice(timingAt + 1).map((line) => stripSubtitleMarkup(line));
    const { text: cueText, joined } = toTwoLines(body);
    if (cueText.length === 0) {
      problems.push({ block: blockNumber, reason: 'no_text' });
      continue;
    }
    if (joined) joinedLines += 1;
    cues.push({ ...timing, text: cueText });
  }

  return { ok: true, value: { format, cues, problems, joinedLines } };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Microseconds to `HH:MM:SS,mmm` / `HH:MM:SS.mmm`, rounded to the millisecond. */
export function formatSubtitleTimestamp(us: Micros, format: SubtitleFormat): string {
  const totalMs = Math.max(0, Math.round(us / 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const separator = format === 'srt' ? ',' : '.';
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(ms, 3)}`;
}

/** Text is plain; VTT reserves `<` and `&`, so they are escaped there. */
function escapeVtt(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Writes cues (already on the clock the file is meant for, sorted, non
 * overlapping) as SRT (CRLF, the most compatible form) or WebVTT (LF).
 * Styling is not written: SRT/VTT cannot promise it in every player.
 */
export function serializeSubtitles(cues: readonly ParsedCue[], format: SubtitleFormat): string {
  if (format === 'srt') {
    const eol = CR + LF;
    return cues
      .map(
        (cue, index) =>
          `${index + 1}${eol}${formatSubtitleTimestamp(cue.startUs, 'srt')} --> ${formatSubtitleTimestamp(cue.endUs, 'srt')}${eol}` +
          `${cue.text.split(LF).join(eol)}${eol}`,
      )
      .join(eol);
  }
  const body = cues
    .map(
      (cue) =>
        `${formatSubtitleTimestamp(cue.startUs, 'vtt')} --> ${formatSubtitleTimestamp(cue.endUs, 'vtt')}${LF}` +
        `${escapeVtt(cue.text)}${LF}`,
    )
    .join(LF);
  return `WEBVTT${LF}${LF}${body}`;
}
