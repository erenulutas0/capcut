/**
 * "The large model failed here" (ADR-036, addendum of 14 Oct 2026): one
 * localStorage key, so a browser where the large speech model stopped while
 * writing is not offered it as "Önerilen" again.
 *
 * - Written only when a run of the large model ends in a failure the small
 *   model may get past (`classifyLargeModelFailure`), never for the small
 *   model, a stop by the user, or a video without sound.
 * - The value is `1`. No time, no file, no error, no device detail.
 * - Removed when the large model later writes a transcript in this browser
 *   (the user chose it again and it worked), with "Bu notu sil" on the
 *   privacy page and in the editor's "Kısayollar ve sınırlar" window, or by
 *   clearing the site's data.
 *
 * Never sent anywhere; not in the diagnostics file. A browser that refuses
 * storage (a private window) keeps the note for the open tab only.
 */

export const LARGE_FAILED_KEY = 'clip.transcriptLargeFailed';

let inMemory = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function largeModelFailedHere(): boolean {
  try {
    if (window.localStorage.getItem(LARGE_FAILED_KEY) === '1') return true;
  } catch {
    // Storage refused: the tab's own copy below.
  }
  return inMemory;
}

export function rememberLargeModelFailed(): void {
  inMemory = true;
  try {
    window.localStorage.setItem(LARGE_FAILED_KEY, '1');
  } catch {
    // Kept for this tab only.
  }
  notify();
}

export function forgetLargeModelFailed(): void {
  inMemory = false;
  try {
    window.localStorage.removeItem(LARGE_FAILED_KEY);
  } catch {
    // Nothing was stored.
  }
  notify();
}

export function subscribeLargeModelNote(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LARGE_FAILED_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
