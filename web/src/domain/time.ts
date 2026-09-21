/**
 * Canonical time unit for the whole product: integer microseconds.
 * Ranges are half-open: [inUs, outUs).
 *
 * Floating point seconds are a display/IO concern only. They never become the
 * source of a business rule (docs 09 "Zaman modeli", 10 "Doğrulama kuralları").
 */

export type Micros = number;

export const US_PER_MS = 1_000;
export const US_PER_SECOND = 1_000_000;

/** Product decision (doc 09): a clip must be at least 100 ms long. */
export const MIN_CLIP_DURATION_US = 100_000;

export function isSafeMicros(value: unknown): value is Micros {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/** Rounds to the nearest microsecond; media APIs hand us float seconds. */
export function secondsToUs(seconds: number): Micros {
  if (!Number.isFinite(seconds)) {
    throw new RangeError('secondsToUs: non-finite input');
  }
  return Math.round(seconds * US_PER_SECOND);
}

export function usToSeconds(us: Micros): number {
  return us / US_PER_SECOND;
}

/** Duration of a half-open range. */
export function rangeDurationUs(inUs: Micros, outUs: Micros): Micros {
  return outUs - inUs;
}

/** `MM:SS.mmm`, or `HH:MM:SS.mmm` past one hour. Always non-negative. */
export function formatTimecode(us: Micros): string {
  const clamped = Math.max(0, Math.round(us));
  const totalMs = Math.floor(clamped / US_PER_MS);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const tail = `${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
  return hours > 0 ? `${pad(hours)}:${tail}` : tail;
}

/** Short, human label used on cards and totals: `4.0 sn` / `1:06 dk`. */
export function formatDurationShort(us: Micros): string {
  const seconds = Math.max(0, us) / US_PER_SECOND;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} sn`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}:${String(rest).padStart(2, '0')} dk`;
}

/**
 * Screen-reader form of a time, e.g. "1 dakika 4,033 saniye". The words and
 * the decimal mark come from the caller's dictionary, so the domain stays
 * language-free. Milliseconds are kept (trailing zeros dropped): a trim handle
 * moves in 1/30 s steps, and "4 saniye" for 4.033 s would hide the change.
 */
export function formatSpokenTime(
  us: Micros,
  words: { minute: string; second: string; decimalMark: string },
): string {
  const totalMs = Math.round(Math.max(0, us) / US_PER_MS);
  const minutes = Math.floor(totalMs / 60_000);
  const restMs = totalMs - minutes * 60_000;
  const whole = Math.floor(restMs / 1000);
  const fraction = String(restMs % 1000).padStart(3, '0').replace(/0+$/, '');
  const seconds = fraction === '' ? String(whole) : `${whole}${words.decimalMark}${fraction}`;
  const secondPart = `${seconds} ${words.second}`;
  if (minutes === 0) return secondPart;
  return restMs === 0 ? `${minutes} ${words.minute}` : `${minutes} ${words.minute} ${secondPart}`;
}

/**
 * Accepts `SS`, `SS.mmm`, `MM:SS`, `MM:SS.mmm`, `HH:MM:SS.mmm`.
 * Returns null for anything else — callers show an invalid-input state rather
 * than silently coercing a typo into a real edit.
 */
export function parseTimecode(input: string): Micros | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  // Extra leading zeros are harmless ("00:015.000" is plainly 15 s) and plain
  // seconds may be long ("150"), so digits are not capped per component. What
  // stays invalid is a minute or second field that overflows 59.
  if (!/^\d{1,6}(:\d{1,3}){0,2}(\.\d{1,6})?$/.test(text)) return null;

  const [clock, fraction = ''] = text.split('.');
  const parts = (clock ?? '').split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.slice(1).some((part) => part > 59)) return null;

  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  const fractionUs = fraction === '' ? 0 : Math.round(Number(`0.${fraction}`) * US_PER_SECOND);
  return seconds * US_PER_SECOND + fractionUs;
}
