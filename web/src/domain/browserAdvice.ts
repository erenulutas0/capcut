/**
 * What to tell someone whose browser cannot make the file (13 Oct 2026, the
 * Firefox / WebKit walk: docs/quality/browsers-2026-10-13.md).
 *
 * The refusal itself was always honest ("Bu tarayıcıda çıktı alınamıyor"),
 * but it ended there: no way forward. The way forward depends on where the
 * user is, and wrong advice is worse than none:
 *
 * - Already in Chrome or Edge: nothing to advise ("try Chrome" said inside
 *   Chrome sends people in a circle — see adapters/browserKind.ts).
 * - iPhone / iPad: every browser there runs on the same engine, so "install
 *   Chrome" would lead to the same refusal. Only another device helps.
 * - Anywhere else (Firefox, desktop Safari…): Chrome or Edge, where the
 *   export is measured to work (docs/SUPPORT_MATRIX.md).
 *
 * Advice is given only for refusals that are the BROWSER's: an encoder or
 * worker it does not have. A video that cannot be read, a target that is too
 * small or an HDR source have sentences of their own.
 */

import type { ExportFailureCode } from './exportEvents';

export type BrowserAdvice = 'none' | 'try_chromium' | 'other_device';

/** Refusals another browser would not give for the same video. */
export const BROWSER_SIDE_BLOCKERS: ReadonlySet<ExportFailureCode> = new Set<ExportFailureCode>([
  'video_encoder_unsupported',
  'audio_encoder_unsupported',
  'worker_unavailable',
]);

export interface BrowserAdviceFacts {
  /** Chrome, Edge or another Chromium browser (never one on iPhone / iPad: those are not Chromium inside). */
  chromium: boolean;
  /** iPhone or iPad, whichever browser. */
  ios: boolean;
  /** The environment check failed (WebCodecs, workers or OffscreenCanvas missing). */
  environmentFailed: boolean;
  blockers: readonly ExportFailureCode[];
}

export function isBrowserSideRefusal(facts: Pick<BrowserAdviceFacts, 'environmentFailed' | 'blockers'>): boolean {
  return facts.environmentFailed || facts.blockers.some((code) => BROWSER_SIDE_BLOCKERS.has(code));
}

export function browserAdvice(facts: BrowserAdviceFacts): BrowserAdvice {
  if (!isBrowserSideRefusal(facts)) return 'none';
  // Asked first: Chrome on an iPhone calls itself Chrome and is not.
  if (facts.ios) return 'other_device';
  if (facts.chromium) return 'none';
  return 'try_chromium';
}
