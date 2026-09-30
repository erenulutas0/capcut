/**
 * The system share sheet for a finished video (Web Share API, ADR-031).
 * `navigator.share` needs the click's user activation: `shareVideo` calls it
 * at once, before anything is awaited, so the caller must call it straight
 * from the click handler with a `File` it already holds.
 */
import { isChromiumUserAgent, shareOutcome, shareVerdict, type ShareOutcome, type ShareVerdict } from '@/domain/share';

type ShareNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

/** Whether (and how) this browser can share `file`; no side effects. */
export function shareVerdictFor(file: File): ShareVerdict {
  if (typeof navigator === 'undefined') return 'unsupported';
  const nav = navigator as ShareNavigator;
  let canShareFile = false;
  try {
    canShareFile = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
  } catch {
    canShareFile = false;
  }
  return shareVerdict({ canShareFile, chromium: isChromiumUserAgent(navigator.userAgent), sizeBytes: file.size });
}

/** Opens the share sheet with the video. Call synchronously from a click. */
export function shareVideo(file: File): Promise<ShareOutcome> {
  const nav = navigator as ShareNavigator;
  let pending: Promise<void>;
  try {
    if (typeof nav.share !== 'function') throw new DOMException('Web Share is not available', 'NotSupportedError');
    pending = nav.share({ files: [file] });
  } catch (error) {
    pending = Promise.reject(error);
  }
  return pending.then(
    () => 'shared' as const,
    (error: unknown) => shareOutcome(error ?? new Error('share failed')),
  );
}
