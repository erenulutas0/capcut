/**
 * The invite code of the cloud transcript route (ADR-039), kept on this
 * device so it is typed once: one localStorage key, written only when the
 * user presses "Kodu kaydet" and the proxy accepted the code, removed by
 * "Kodu kaldır" (on the card and on the privacy page).
 *
 * The code leaves the device only in the `Authorization` header of requests
 * to our proxy — never in an address, never to anyone else.
 */

export const INVITE_STORAGE_KEY = 'clip.cloudInvite';

/** What the proxy issues: four groups of five (letters and digits). Anything else is not sent anywhere. */
const INVITE_SHAPE = /^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/;

/** The code as typed, tidied: spaces out, the dashes where they belong. Null when it cannot be an invite code. */
export function tidyInvite(typed: string): string | null {
  const compact = typed.replace(/[\s-]+/g, '');
  if (!/^[A-Za-z0-9]{20}$/.test(compact)) return null;
  return `${compact.slice(0, 5)}-${compact.slice(5, 10)}-${compact.slice(10, 15)}-${compact.slice(15)}`;
}

const listeners = new Set<() => void>();
/** For a browser that refuses storage (a private window): the code lasts as long as the tab. */
let inMemory: string | null = null;

export function readInvite(): string | null {
  try {
    const stored = window.localStorage.getItem(INVITE_STORAGE_KEY);
    if (stored !== null) return INVITE_SHAPE.test(stored) ? stored : null;
  } catch {
    // Storage refused: fall through to the tab's own copy.
  }
  return inMemory;
}

export function saveInvite(code: string): void {
  inMemory = code;
  try {
    window.localStorage.setItem(INVITE_STORAGE_KEY, code);
  } catch {
    // Kept for this tab only.
  }
  for (const listener of listeners) listener();
}

export function removeInvite(): void {
  inMemory = null;
  try {
    window.localStorage.removeItem(INVITE_STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
  for (const listener of listeners) listener();
}

export function subscribeInvite(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab saved or removed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === INVITE_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
