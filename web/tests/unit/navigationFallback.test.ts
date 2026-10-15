import { describe, expect, it } from 'vitest';

import { CARD_NAVIGATION_FALLBACK_MS, createNavigationFallback, fullPageHref, isPlainPress } from '@/components/home/navigationFallback';
import { tr } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

/**
 * A card that seems dead (ADR-044, addendum of 14 Oct 2026): when the client
 * navigation from the opening screen has not completed 10 s after the press,
 * the same address is loaded in full — once. The page-level proof (a held
 * `?_rsc` request, a fast navigation, a full load that stalls too) is
 * `tests/e2e/card-navigation.spec.ts`; here the guard runs on a hand-driven clock.
 */

function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

function guard() {
  const time = clock();
  const assigned: string[] = [];
  const fallback = createNavigationFallback({
    assign: (url) => assigned.push(url),
    resolve: (path) => `/capcut${path}/`,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return { time, assigned, fallback };
}

describe('the fallback for a client navigation that never completes', () => {
  it('waits 10 s, then loads the same address in full, once', () => {
    expect(CARD_NAVIGATION_FALLBACK_MS).toBe(10_000);
    const { time, assigned, fallback } = guard();
    fallback.start('/yap/kes');
    time.advance(9_999);
    expect(assigned).toEqual([]);
    time.advance(1);
    expect(assigned).toEqual(['/capcut/yap/kes/']);
    expect(fallback.used).toBe(true);
    time.advance(600_000);
    expect(assigned).toHaveLength(1);
  });

  it('a navigation that completes (the screen goes away) never triggers it', () => {
    const { time, assigned, fallback } = guard();
    fallback.start('/yap/kes');
    time.advance(300);
    fallback.cancel();
    time.advance(60_000);
    expect(assigned).toEqual([]);
    expect(time.pending()).toBe(0);
  });

  it('a second press re-arms it for the new address and the full 10 s; it never runs twice', () => {
    const { time, assigned, fallback } = guard();
    fallback.start('/yap/kes');
    time.advance(6_000);
    fallback.start('/yap/yazi');
    time.advance(6_000);
    expect(assigned).toEqual([]);
    time.advance(4_000);
    expect(assigned).toEqual(['/capcut/yap/yazi/']);
    // The full load stalls too and the user presses again: no second full load from this screen.
    fallback.start('/yap/yazi');
    fallback.start('/yap/kes');
    time.advance(600_000);
    expect(assigned).toEqual(['/capcut/yap/yazi/']);
    expect(time.pending()).toBe(0);
  });

  it('back from the back-forward cache is a new visit: it may run again, once', () => {
    const { time, assigned, fallback } = guard();
    fallback.start('/yap/kes');
    time.advance(10_000);
    fallback.reset();
    fallback.start('/yap/kes');
    time.advance(10_000);
    expect(assigned).toEqual(['/capcut/yap/kes/', '/capcut/yap/kes/']);
  });
});

describe('the address of the full load', () => {
  it('is what next/link renders: base path, and the trailing slash of the static export', () => {
    expect(fullPageHref('/yap/kes', '', false)).toBe('/yap/kes');
    expect(fullPageHref('/yap/kes', '/capcut', true)).toBe('/capcut/yap/kes/');
    expect(fullPageHref('/yap/kes/', '/capcut', true)).toBe('/capcut/yap/kes/');
    expect(fullPageHref('/yap/kes', '/capcut', false)).toBe('/capcut/yap/kes');
  });

  it('also for the editor and the way back to the opening screen (15 Oct 2026: every link of a screen)', () => {
    expect(fullPageHref('/editor', '/capcut', true)).toBe('/capcut/editor/');
    expect(fullPageHref('/editor', '', false)).toBe('/editor');
    expect(fullPageHref('/', '/capcut', true)).toBe('/capcut/');
    expect(fullPageHref('/', '', false)).toBe('/');
    expect(fullPageHref('/', '', true)).toBe('/');
  });
});

describe('which presses are watched', () => {
  const press = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('a plain press; not a new tab, a new window, a middle button, or a press already handled', () => {
    expect(isPlainPress(press)).toBe(true);
    expect(isPlainPress({ ...press, ctrlKey: true })).toBe(false);
    expect(isPlainPress({ ...press, metaKey: true })).toBe(false);
    expect(isPlainPress({ ...press, shiftKey: true })).toBe(false);
    expect(isPlainPress({ ...press, altKey: true })).toBe(false);
    expect(isPlainPress({ ...press, button: 1 })).toBe(false);
    expect(isPlainPress({ ...press, defaultPrevented: true })).toBe(false);
  });
});

describe('what the pressed card says', () => {
  it('one word, both languages', () => {
    expect(tr['home.opening']).toBe('Açılıyor…');
    expect(en['home.opening']).toBe('Opening…');
  });
});
