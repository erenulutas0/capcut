'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { BASE_PATH } from '@/basePath';

/**
 * A card or a search result on the opening screen that seems dead
 * (ADR-044, addendum of 14 Oct 2026).
 *
 * A press opens the task with Next's client router, which first asks for
 * the page's data (`?_rsc=…`). When that request FAILS, Next itself falls
 * back to loading the page in full. When it never ANSWERS, nothing happens
 * — no error, no timeout, the card looks as if it did nothing (reproduced
 * with Playwright holding the request: 25 s later still on `/`, no second
 * request). This guard covers that case and only that one:
 *
 * - the press is said at once ("Açılıyor…" on the pressed card or row);
 * - if the opening screen is still here `CARD_NAVIGATION_FALLBACK_MS` after
 *   the press, the same address is loaded in full (`location.assign`);
 * - at most once per opening screen: a second press re-arms nothing after
 *   the fallback ran, so a page whose full load ALSO stalls is not loaded
 *   again and again. The page that the full load brings is another page
 *   with no timer of its own.
 *
 * "Completed" needs no signal of its own: when the client navigation
 * completes, the opening screen goes away, and with it the timer.
 */

/**
 * 10 s. ADR-044's soak run measured a FULL page load, from the start of the
 * navigation to a page React had taken over (more work than a client
 * navigation, which reuses the framework already running): median 0.3–0.8 s,
 * p99 6.2 s, longest 10.6 s under 16 parallel pages + 10 CPU burners; idle,
 * the longest was 0.44 s. 10 s is 1.6 × that p99 and ADR-044's own rule ("under
 * 10 s is too close to the measured 6.5 s") — while the press is never silent
 * meanwhile, so the wait is not a dead screen. A false alarm costs one full
 * load of the page that was about to open; the opening screen holds no work.
 */
export const CARD_NAVIGATION_FALLBACK_MS = 10_000;

/**
 * The address a full load must use for an app path: with the base path
 * (`/capcut` on GitHub Pages) and, in the static export, the trailing slash
 * its folders need (`/capcut/yap/kes/`) — what `next/link` itself renders.
 */
export function fullPageHref(path: string, basePath: string = BASE_PATH, trailingSlash: boolean = process.env.NEXT_PUBLIC_TRAILING_SLASH === '1'): string {
  const withSlash = trailingSlash && !path.endsWith('/') ? `${path}/` : path;
  return `${basePath}${withSlash}`;
}

export interface NavigationFallback {
  /** A press started a client navigation to `path`: arm the fallback for it (a new press re-arms it). */
  start(path: string): void;
  /** Nothing is pending any more (the screen goes away). */
  cancel(): void;
  /** The screen came back from the browser's back-forward cache: a new visit, the fallback may run again. */
  reset(): void;
  /** The fallback ran. */
  readonly used: boolean;
}

export interface NavigationFallbackOptions {
  assign: (url: string) => void;
  resolve?: (path: string) => string;
  timeoutMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export function createNavigationFallback(options: NavigationFallbackOptions): NavigationFallback {
  const resolve = options.resolve ?? ((path: string) => fullPageHref(path));
  const timeoutMs = options.timeoutMs ?? CARD_NAVIGATION_FALLBACK_MS;
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => window.setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => window.clearTimeout(timer as number));
  let timer: unknown = null;
  let used = false;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  return {
    start(path) {
      cancel();
      // Once per screen: after the full load was asked for, a press is left to the client router alone.
      if (used) return;
      timer = setTimer(() => {
        timer = null;
        used = true;
        options.assign(resolve(path));
      }, timeoutMs);
    },
    cancel,
    reset() {
      cancel();
      used = false;
    },
    get used() {
      return used;
    },
  };
}

/** A press that the client router handles (not a new tab, a new window or a download). */
export function isPlainPress(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The opening screen's side of the guard: which path is opening (for
 * "Açılıyor…") and `begin(path)` for a press.
 */
export function useNavigationFallback(): { pendingPath: string | null; begin: (path: string) => void } {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const guardRef = useRef<NavigationFallback | null>(null);

  useEffect(() => {
    const guard = createNavigationFallback({ assign: (url) => window.location.assign(url) });
    guardRef.current = guard;
    // Back to this screen from the back-forward cache (after a full load): nothing is opening any more.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      guard.reset();
      setPendingPath(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      guard.cancel();
      window.removeEventListener('pageshow', onPageShow);
      guardRef.current = null;
    };
  }, []);

  const begin = useCallback((path: string) => {
    setPendingPath(path);
    guardRef.current?.start(path);
  }, []);

  return { pendingPath, begin };
}
