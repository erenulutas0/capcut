/**
 * "Uygulama olarak yükle" (ADR-031).
 *
 * - Chromium (Android Chrome, desktop Chrome/Edge, Samsung Internet where it
 *   fires the event): the browser announces an installable site with
 *   `beforeinstallprompt`; the event is kept and its `prompt()` is called
 *   from the ⋯ menu's button. It can be used once.
 * - iPhone/iPad Safari has no such event; installing is "Paylaş → Ana Ekrana
 *   Ekle", so a short hint is shown instead. Detected conservatively
 *   (Safari itself, not another app's web view or another iOS browser).
 * - Otherwise (already installed, Firefox, desktop Safari…): nothing.
 */

export type InstallState = 'prompt' | 'ios' | 'none';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

let deferred: InstallPromptEvent | null = null;
let installed = false;
let listening = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Running as the installed app (home-screen icon) already. */
function standalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** Safari on iPhone/iPad (iPadOS reports a Mac with touch). */
export function isIosSafari(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  const ios = /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!ios) return false;
  return /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent) && !/\b(CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV)\b/.test(userAgent);
}

/** Starts listening; call once, as early as the page runs. */
export function listenForInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep it for the ⋯ menu instead of the browser's own mini bar.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function installState(): InstallState {
  if (typeof window === 'undefined' || installed || standalone()) return 'none';
  if (deferred) return 'prompt';
  return isIosSafari(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) ? 'ios' : 'none';
}

export function subscribeInstall(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's install question. Call from a click. */
export function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return Promise.resolve('unavailable');
  // One use per event; the browser may announce again later.
  deferred = null;
  let shown: Promise<void>;
  try {
    shown = event.prompt();
  } catch (error) {
    shown = Promise.reject(error);
  }
  notify();
  return shown.then(
    () => event.userChoice.then((choice) => choice.outcome),
    () => 'unavailable' as const,
  );
}
