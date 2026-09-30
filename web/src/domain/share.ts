/**
 * Sharing a finished video through the system share sheet (Web Share API,
 * PRD R10, ADR-031). Pure: the browser facts come in as arguments.
 *
 * Chromium browsers (Chrome, Edge, Samsung Internet, Chrome on Android) say
 * `canShare({ files })` is true for a video of any size, but `share()` then
 * refuses more than 50 MiB in total at once — `NotAllowedError`
 * ("Permission denied"), before any sheet opens. Measured with
 * scripts/measure-share.mjs (Chrome 154, Edge 154, Chrome with Android
 * emulation; 50 MiB passes, 50 MiB + 1 byte is refused). Such a file gets an
 * honest sentence instead of a button that cannot work. Safari (iOS, macOS)
 * has no such measured limit here and is left to its own answer.
 */
export const CHROMIUM_SHARE_MAX_BYTES = 50 * 1024 * 1024;

export type ShareVerdict =
  /** Show "Paylaş". */
  | 'share'
  /** The browser would refuse this size: say so, and how to share it instead. */
  | 'too_large'
  /** No file sharing in this browser: no button at all. */
  | 'unsupported';

export interface ShareFacts {
  /** `navigator.share` exists and `navigator.canShare({ files: [file] })` said yes. */
  canShareFile: boolean;
  /** A Chromium browser (its own user agent brand), which has the 50 MiB limit. */
  chromium: boolean;
  sizeBytes: number;
}

export function shareVerdict({ canShareFile, chromium, sizeBytes }: ShareFacts): ShareVerdict {
  if (!canShareFile) return 'unsupported';
  if (chromium && sizeBytes > CHROMIUM_SHARE_MAX_BYTES) return 'too_large';
  return 'share';
}

/**
 * Chromium, from the user agent: "Chrome/" (desktop, Android, Edge, Samsung
 * Internet, Opera all carry it). Chrome on iOS ("CriOS") is WebKit and has
 * no "Chrome/" token.
 */
export function isChromiumUserAgent(userAgent: string): boolean {
  return /\b(?:Chrome|Chromium)\/\d/.test(userAgent) && !/\b(?:CriOS|FxiOS|EdgiOS)\//.test(userAgent);
}

/** What a failed `navigator.share` means for the user. */
export type ShareOutcome = 'shared' | 'closed' | 'failed';

export function shareOutcome(error: unknown): ShareOutcome {
  if (error === null || error === undefined) return 'shared';
  // The user closed the sheet (or picked nothing): not an error to report.
  const name = typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'AbortError' ? 'closed' : 'failed';
}
