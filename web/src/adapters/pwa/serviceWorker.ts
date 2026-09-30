/**
 * Registers the service worker (`<base>/sw.js`, ADR-031) and tells the page
 * when a newer build is waiting.
 *
 * - Production builds only: `next dev` never registers it (its hot reload
 *   and a cache-first worker do not mix; the dev route is a no-op anyway).
 * - A newer worker that finished installing waits (the browser keeps the old
 *   one while a page uses it). If this page itself already belongs to the
 *   newer build (it was loaded from the network), the newer worker is
 *   switched on silently: nothing to reload. Otherwise the page shows
 *   "Yeni sürüm hazır — yenile"; only the user's press reloads, and never
 *   while a download is running (`setAppBusy`).
 */
import { BASE_PATH, withBasePath } from '@/basePath';

type Listener = () => void;

// ------------------------------------------------------------ busy (downloads)

const busyReasons = new Set<string>();
const busyListeners = new Set<Listener>();

/** While any reason is set, the update notice will not reload the page. */
export function setAppBusy(reason: string, busy: boolean): void {
  const had = busyReasons.has(reason);
  if (busy === had) return;
  if (busy) busyReasons.add(reason);
  else busyReasons.delete(reason);
  for (const listener of busyListeners) listener();
}

export function isAppBusy(): boolean {
  return busyReasons.size > 0;
}

export function subscribeAppBusy(listener: Listener): () => void {
  busyListeners.add(listener);
  return () => busyListeners.delete(listener);
}

// ------------------------------------------------------------ update waiting

let waiting: ServiceWorker | null = null;
let reloadRequested = false;
const updateListeners = new Set<Listener>();

function setWaiting(worker: ServiceWorker | null): void {
  waiting = worker;
  for (const listener of updateListeners) listener();
}

export function isUpdateWaiting(): boolean {
  return waiting !== null;
}

export function subscribeUpdate(listener: Listener): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/** "Yenile": switch to the waiting build and reload. False while busy. */
export function applyUpdate(): boolean {
  const worker = waiting;
  if (!worker || isAppBusy()) return false;
  reloadRequested = true;
  if (worker.state === 'activated' || worker.state === 'redundant') {
    // Another tab already switched: the page only needs to reload.
    window.location.reload();
    return true;
  }
  worker.postMessage({ type: 'clip-sw:activate' });
  return true;
}

/** "Sonra": hide the notice for this page; the next visit uses the new build. */
export function dismissUpdate(): void {
  setWaiting(null);
}

/** This page's own build files (hashed names), as the worker lists them. */
function ownBuildFiles(): string[] {
  const prefix = `${BASE_PATH}/_next/static/`;
  const paths = new Set<string>();
  for (const element of document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
    'script[src], link[rel="stylesheet"][href]',
  )) {
    const raw = element instanceof HTMLScriptElement ? element.src : element.href;
    try {
      const url = new URL(raw, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith(prefix)) paths.add(url.pathname);
    } catch {
      // Not a URL: not a build file.
    }
  }
  return [...paths];
}

/** Asks a worker whether it stores this page's build files (false on no answer). */
function workerOwnsPage(worker: ServiceWorker, paths: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(false), 3000);
    channel.port1.onmessage = (event: MessageEvent<{ owns?: boolean }>) => {
      window.clearTimeout(timer);
      resolve(event.data?.owns === true);
    };
    worker.postMessage({ type: 'clip-sw:owns', paths }, [channel.port2]);
  });
}

async function considerWaiting(worker: ServiceWorker): Promise<void> {
  const paths = ownBuildFiles();
  if (paths.length > 0 && (await workerOwnsPage(worker, paths))) {
    // The page is already this build: switch without a reload.
    worker.postMessage({ type: 'clip-sw:activate' });
    return;
  }
  setWaiting(worker);
}

// ------------------------------------------------------------ registration

const UPDATE_CHECK_MS = 60 * 60 * 1000;
let started = false;

/** Called once per page load (PwaClient). Safe to call again. */
export function registerServiceWorker(): void {
  if (started) return;
  started = true;
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const container = navigator.serviceWorker;

  container.addEventListener('controllerchange', () => {
    // Only the user's "Yenile" reloads; a switch made by another tab does not.
    if (reloadRequested) window.location.reload();
  });

  const register = () => {
    container
      .register(withBasePath('/sw.js'), { scope: withBasePath('/'), updateViaCache: 'none' })
      .then((registration) => {
        if (registration.waiting && container.controller) void considerWaiting(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const next = registration.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // With no controller this is the first install: it just activates.
            if (next.state === 'installed' && container.controller) void considerWaiting(next);
          });
        });
        // An installed app can stay open for days: look for a newer build
        // when it comes back to the screen, at most once an hour.
        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
          lastCheck = Date.now();
          registration.update().catch(() => undefined);
        });
      })
      .catch(() => {
        // No offline copy in this browser (private window, storage blocked):
        // the site works online exactly as before.
      });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
