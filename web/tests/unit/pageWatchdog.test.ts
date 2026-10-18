import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyCsp, inlineHashes } from '../../scripts/lib/csp.mjs';
import { WATCHDOG_MARKER, insertWatchdog, watchdogConfig, watchdogScript } from '../../scripts/lib/pageWatchdogScript.mjs';
import { PAGE_ALIVE_ATTRIBUTE, PAGE_NOTICE_ID, PAGE_PENDING_ATTRIBUTE, PAGE_RECOVERY_KEY, markPageAlive } from '@/pageWatchdog';

/**
 * The watchdog of a page that never came alive (ADR-044), against a browser
 * made of plain objects: when it reloads, that it reloads once and only
 * once, what it shows, and what it never does. What runs here is the very
 * text a built page carries (`watchdogScript`), not a copy of its logic.
 */

const SCRIPT = watchdogScript('/capcut');
const run = new Function('window', 'document', SCRIPT) as (win: unknown, doc: unknown) => void;

type Listener = (event: Record<string, unknown>) => void;

class FakeElement {
  hidden: boolean;
  isConnected = true;
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  listeners = new Map<string, Listener[]>();
  constructor(attributes: Record<string, string> = {}, hidden = false) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
    this.hidden = hidden;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  querySelectorAll(selector: string) {
    const name = /^\[([a-z-]+)\]$/.exec(selector)?.[1] ?? '';
    const all: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.attributes.has(name)) all.push(child);
        walk(child);
      }
    };
    walk(this);
    return all;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** A press on the child that carries `data-clip-do=<action>`. */
  press(action: string) {
    const button = this.querySelectorAll('[data-clip-do]').find((item) => item.getAttribute('data-clip-do') === action);
    if (!button) throw new Error(`no button ${action}`);
    for (const listener of this.listeners.get('click') ?? []) listener({ target: { closest: () => button } });
  }
}

function fakeNotice(): FakeElement {
  const notice = new FakeElement({ id: PAGE_NOTICE_ID, 'data-state': 'hidden' });
  for (const lang of ['tr', 'en']) {
    const panel = new FakeElement({ 'data-clip-lang': lang }, true);
    panel.children = [
      new FakeElement({ 'data-clip-when': 'dead' }),
      new FakeElement({ 'data-clip-when': 'late' }, true),
      new FakeElement({ 'data-clip-when': 'reset' }, true),
      new FakeElement({ 'data-clip-do': 'reload' }),
      new FakeElement({ 'data-clip-do': 'reset', 'data-clip-when': 'reset' }, true),
      new FakeElement({ 'data-clip-do': 'close', 'data-clip-when': 'late' }, true),
    ];
    notice.children.push(panel);
  }
  return notice;
}

interface TabOptions {
  /** What sessionStorage holds; shared by every load of the tab. */
  storage?: Map<string, string> | 'blocked';
  path?: string;
  /** `<html lang>` of the page (ADR-048: every English page says "en"). */
  lang?: 'tr' | 'en';
  controlled?: boolean;
  online?: boolean;
  readyState?: string;
}

/** One page load in a tab. */
function load(options: TabOptions = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const windowListeners = new Map<string, Listener[]>();
  const documentListeners = new Map<string, Listener[]>();
  const root = new FakeElement();
  root.setAttribute('lang', options.lang ?? 'tr');
  const notice = fakeNotice();
  const state = { reloads: 0, pending: false, unregistered: [] as string[], deletedCaches: [] as string[], styleLinks: [] as Array<{ sheet: object | null; href: string }> };
  const registrations = [
    { scope: 'https://example.test/capcut/', unregister: async () => state.unregistered.push('/capcut/') },
    { scope: 'https://example.test/other-app/', unregister: async () => state.unregistered.push('/other-app/') },
  ];
  const win = {
    location: { pathname: options.path ?? '/capcut/yap/cevir/', origin: 'https://example.test', href: `https://example.test${options.path ?? '/capcut/yap/cevir/'}`, reload: () => (state.reloads += 1) },
    sessionStorage: {
      getItem(key: string) {
        if (storage === 'blocked') throw new Error('SecurityError');
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (storage === 'blocked') throw new Error('SecurityError');
        storage.set(key, value);
      },
    },
    navigator: {
      onLine: options.online ?? true,
      serviceWorker: { controller: options.controlled ? {} : null, getRegistrations: async () => registrations },
    },
    caches: {
      keys: async () => ['clip-app-abc', 'clip-app-old', 'clip-models-v1', 'someone-elses'],
      delete: async (name: string) => state.deletedCaches.push(name),
    },
    addEventListener(type: string, listener: Listener) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
    clearInterval: (id: number) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  };
  const doc = {
    documentElement: root,
    readyState: options.readyState ?? 'loading',
    body: { appendChild: (node: FakeElement) => void (node.isConnected = true) },
    getElementById: (id: string) => (id === PAGE_NOTICE_ID ? notice : null),
    querySelector: (selector: string) => (selector === `[${PAGE_PENDING_ATTRIBUTE}]` && state.pending ? {} : null),
    querySelectorAll: () => state.styleLinks,
    addEventListener(type: string, listener: Listener) {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    },
  };
  run(win, doc);
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const listener of windowListeners.get(type) ?? []) listener(event);
  };
  const flag = () => (storage === 'blocked' ? null : (JSON.parse(storage.get(PAGE_RECOVERY_KEY) ?? 'null') as { s: string; t: number; p: string; why: string } | null));
  const visiblePanel = () => notice.children.filter((panel) => !panel.hidden).map((panel) => panel.getAttribute('data-clip-lang'));
  const shownParts = () => {
    const panel = notice.children.find((item) => !item.hidden);
    return panel ? panel.children.filter((part) => !part.hidden).map((part) => part.getAttribute('data-clip-do') ?? part.getAttribute('data-clip-when')) : [];
  };
  return {
    state,
    notice,
    storage,
    flag,
    visiblePanel,
    shownParts,
    noticeState: () => notice.getAttribute('data-state'),
    loaded: () => fire('load'),
    seconds: (n: number) => vi.advanceTimersByTime(n * 1000),
    alive: () => root.setAttribute(PAGE_ALIVE_ATTRIBUTE, ''),
    scriptFailed: (src: string) => fire('error', { target: new FakeElementWith('SCRIPT', { src }) }),
    styleFailed: (href: string, own = true) =>
      fire('error', { target: new FakeElementWith('LINK', { href, rel: 'stylesheet' }, own ? { 'data-precedence': 'next' } : {}) }),
    uncaught: (name: string) => fire('error', { target: win, error: { name } }),
    rejected: (name: string) => fire('unhandledrejection', { reason: { name } }),
  };
}

class FakeElementWith extends FakeElement {
  tagName: string;
  src?: string;
  href?: string;
  rel?: string;
  constructor(tagName: string, props: { src?: string; href?: string; rel?: string }, attributes: Record<string, string> = {}) {
    super(attributes);
    this.tagName = tagName;
    Object.assign(this, props);
  }
}

const OWN_SCRIPT = 'https://example.test/capcut/_next/static/chunks/main.js';
const OWN_STYLE = 'https://example.test/capcut/_next/static/chunks/app.css';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a page that comes alive', () => {
  it('is left alone: no reload, no notice, nothing stored', () => {
    const page = load();
    page.loaded();
    page.seconds(1);
    page.alive();
    page.seconds(600);
    expect(page.state.reloads).toBe(0);
    expect(page.noticeState()).toBe('hidden');
    expect(page.flag()).toBeNull();
  });

  it('may take its time: alive one second before the limit is alive', () => {
    const page = load();
    page.loaded();
    page.seconds(14);
    expect(page.state.reloads).toBe(0);
    page.alive();
    page.seconds(600);
    expect(page.state.reloads).toBe(0);
    expect(page.noticeState()).toBe('hidden');
  });

  it('is not alive while a part of it still waits for its code', () => {
    const page = load();
    page.loaded();
    page.alive();
    page.state.pending = true;
    page.seconds(15);
    expect(page.state.reloads).toBe(1);
  });

  it('a file that failed and was fetched again by the bundler costs nothing', () => {
    const page = load();
    page.scriptFailed(OWN_SCRIPT);
    page.seconds(2);
    page.alive();
    page.loaded();
    page.seconds(600);
    expect(page.state.reloads).toBe(0);
    expect(page.noticeState()).toBe('hidden');
  });
});

describe('a page that does not come alive', () => {
  it('is reloaded once, 15 s after load, and the tab remembers it', () => {
    const page = load();
    page.loaded();
    page.seconds(14);
    expect(page.state.reloads).toBe(0);
    page.seconds(1);
    expect(page.state.reloads).toBe(1);
    expect(page.flag()).toEqual({ s: 'reloading', t: Date.parse('2026-10-13T12:00:15Z'), p: '/capcut/yap/cevir/', why: 'timeout' });
    page.seconds(600);
    expect(page.state.reloads).toBe(1);
    expect(page.noticeState()).toBe('hidden');
  });

  it('is reloaded 4 s after one of its build files failed, without waiting for load', () => {
    const page = load();
    page.seconds(1);
    page.scriptFailed(OWN_SCRIPT);
    page.seconds(3);
    expect(page.state.reloads).toBe(0);
    page.seconds(1);
    expect(page.state.reloads).toBe(1);
    expect(page.flag()?.why).toBe('file');
  });

  it('is reloaded at once when its own stylesheet failed (nothing retries a stylesheet)', () => {
    const page = load();
    page.styleFailed(OWN_STYLE);
    expect(page.state.reloads).toBe(1);
    expect(page.flag()?.why).toBe('style');
  });

  it('a stylesheet that fails again on the second try: no reload; the page, alive without it, says a part is missing', () => {
    const storage = new Map<string, string>();
    const first = load({ storage });
    first.styleFailed(OWN_STYLE);
    expect(first.state.reloads).toBe(1);

    const second = load({ storage });
    second.styleFailed(OWN_STYLE);
    expect(second.state.reloads).toBe(0);
    expect(second.noticeState()).toBe('hidden');
    second.loaded();
    second.alive();
    second.seconds(1);
    expect(second.noticeState()).toBe('late');
    expect(second.shownParts()).toEqual(['late', 'reload', 'close']);
    second.seconds(600);
    expect(second.state.reloads).toBe(0);
  });

  it('…and if that second try does not come alive either, it is the dead-page notice', () => {
    const storage = new Map<string, string>();
    load({ storage }).styleFailed(OWN_STYLE);
    const second = load({ storage });
    second.styleFailed(OWN_STYLE);
    second.seconds(4);
    expect(second.noticeState()).toBe('dead');
    expect(second.state.reloads).toBe(0);
  });

  it('a stylesheet that has no sheet when load fires counts as failed, even if no error event was seen', () => {
    const page = load();
    page.state.styleLinks = [
      { sheet: {}, href: OWN_STYLE },
      { sheet: null, href: 'https://elsewhere.test/x.css' },
    ];
    page.loaded();
    expect(page.state.reloads).toBe(0);
    const broken = load();
    broken.state.styleLinks = [{ sheet: null, href: OWN_STYLE }];
    broken.loaded();
    expect(broken.state.reloads).toBe(1);
    expect(broken.flag()?.why).toBe('style');
  });

  it('ignores files that are not the app’s build files', () => {
    const page = load();
    page.scriptFailed('https://elsewhere.test/capcut/_next/static/chunks/main.js');
    page.scriptFailed('https://example.test/other-app/_next/static/chunks/main.js');
    page.scriptFailed('https://example.test/capcut/models/x.js');
    page.seconds(10);
    expect(page.state.reloads).toBe(0);
  });

  it('the second try is never reloaded again: it shows the notice, for as long as the page stays dead', () => {
    const storage = new Map<string, string>();
    const first = load({ storage });
    first.loaded();
    first.seconds(15);
    expect(first.state.reloads).toBe(1);

    const second = load({ storage });
    expect(second.flag()?.s).toBe('retried');
    second.loaded();
    second.seconds(15);
    expect(second.state.reloads).toBe(0);
    expect(second.noticeState()).toBe('dead');
    expect(second.visiblePanel()).toEqual(['tr']);
    expect(second.shownParts()).toEqual(['dead', 'reload']);
    // An hour of being dead, files failing all the while: still no reload.
    for (let i = 0; i < 60; i += 1) {
      second.scriptFailed(OWN_SCRIPT);
      second.styleFailed(OWN_STYLE);
      second.rejected('ChunkLoadError');
      second.seconds(60);
    }
    expect(second.state.reloads).toBe(0);
    // The note keeps when and why the one reload was made.
    expect(second.flag()).toEqual({ s: 'retried', t: Date.parse('2026-10-13T12:00:15Z'), p: '/capcut/yap/cevir/', why: 'timeout' });
  });

  it('a tab where every load dies makes exactly one automatic reload, however often the user presses the button', () => {
    const storage = new Map<string, string>();
    let automatic = 0;
    let pressed = 0;
    let page = load({ storage });
    for (let visit = 0; visit < 6; visit += 1) {
      page.loaded();
      page.seconds(120);
      if (page.state.reloads === 1 && page.noticeState() === 'hidden') {
        automatic += 1;
      } else {
        expect(page.noticeState()).toBe('dead');
        page.notice.press('reload');
        expect(page.state.reloads).toBe(1);
        pressed += 1;
      }
      page = load({ storage });
    }
    expect(automatic).toBe(1);
    expect(pressed).toBe(5);
  });

  it('a later, separate failure in the same tab within five minutes shows the notice instead of reloading again', () => {
    const storage = new Map<string, string>();
    storage.set(PAGE_RECOVERY_KEY, JSON.stringify({ s: 'recovered', t: Date.now() - 60_000, p: '/capcut/', why: 'timeout' }));
    const page = load({ storage });
    page.loaded();
    page.seconds(15);
    expect(page.state.reloads).toBe(0);
    expect(page.noticeState()).toBe('dead');
  });

  it('…and after five minutes may be reloaded once again', () => {
    const storage = new Map<string, string>();
    storage.set(PAGE_RECOVERY_KEY, JSON.stringify({ s: 'recovered', t: Date.now() - 6 * 60_000, p: '/capcut/', why: 'timeout' }));
    const page = load({ storage });
    page.loaded();
    page.seconds(15);
    expect(page.state.reloads).toBe(1);
  });

  it('where the tab cannot remember (sessionStorage refused) there is no automatic reload, only the notice', () => {
    const page = load({ storage: 'blocked' });
    page.loaded();
    page.seconds(15);
    expect(page.state.reloads).toBe(0);
    expect(page.noticeState()).toBe('dead');
    page.notice.press('reload');
    expect(page.state.reloads).toBe(1);
  });

  it('a flag that is not what the app writes is treated as no flag', () => {
    const storage = new Map<string, string>([[PAGE_RECOVERY_KEY, '"nonsense"']]);
    const page = load({ storage });
    page.loaded();
    page.seconds(15);
    expect(page.state.reloads).toBe(1);
  });

  it('without load after 45 s (a request that stands still) the notice is shown and nothing is reloaded', () => {
    const page = load();
    page.seconds(44);
    expect(page.noticeState()).toBe('hidden');
    page.seconds(1);
    expect(page.noticeState()).toBe('dead');
    expect(page.state.reloads).toBe(0);
    expect(page.flag()).toBeNull();
    // The file arrives after all: the notice goes away by itself.
    page.loaded();
    page.alive();
    page.seconds(1);
    expect(page.noticeState()).toBe('hidden');
    expect(page.visiblePanel()).toEqual([]);
    expect(page.state.reloads).toBe(0);
  });

  it('seconds are counted while the page runs: a tab that slept is not judged by the time it was asleep', () => {
    const page = load();
    page.loaded();
    page.seconds(5);
    // A frozen tab: an hour passes on the clock, one timer tick runs when it wakes.
    vi.setSystemTime(Date.now() + 3_600_000);
    page.seconds(1);
    expect(page.state.reloads).toBe(0);
    page.seconds(8);
    expect(page.state.reloads).toBe(0);
    page.seconds(1);
    expect(page.state.reloads).toBe(1);
  });

  it('speaks English on the English page: the one whose <html lang> says so', () => {
    for (const path of ['/capcut/gizlilik/en/', '/capcut/en/', '/capcut/en/yap/kes/']) {
      const storage = new Map<string, string>([[PAGE_RECOVERY_KEY, JSON.stringify({ s: 'reloading', t: Date.now(), p: path, why: 'timeout' })]]);
      const page = load({ storage, path, lang: 'en' });
      page.loaded();
      page.seconds(15);
      expect(page.visiblePanel(), path).toEqual(['en']);
    }
  });

  it('speaks Turkish on a Turkish page, whatever its address looks like', () => {
    const storage = new Map<string, string>([[PAGE_RECOVERY_KEY, JSON.stringify({ s: 'reloading', t: Date.now(), p: '/capcut/', why: 'timeout' })]]);
    const page = load({ storage, path: '/capcut/', lang: 'tr' });
    page.loaded();
    page.seconds(15);
    expect(page.visiblePanel()).toEqual(['tr']);
  });
});

describe('the notice’s buttons', () => {
  const dead = (options: TabOptions = {}) => {
    const storage = new Map<string, string>([[PAGE_RECOVERY_KEY, JSON.stringify({ s: 'reloading', t: Date.now(), p: '/capcut/', why: 'timeout' })]]);
    const page = load({ storage, ...options });
    page.loaded();
    page.seconds(15);
    expect(page.noticeState()).toBe('dead');
    return page;
  };

  it('“Yeniden yükle” reloads and marks the next load as a second try', () => {
    const page = dead();
    page.notice.press('reload');
    expect(page.state.reloads).toBe(1);
    expect(page.flag()).toMatchObject({ s: 'reloading', why: 'button' });
  });

  it('the stored copy can be taken away only where one is in use, and not offline', () => {
    expect(dead().shownParts()).toEqual(['dead', 'reload']);
    expect(dead({ controlled: true }).shownParts()).toEqual(['dead', 'reset', 'reload', 'reset']);
    expect(dead({ controlled: true, online: false }).shownParts()).toEqual(['dead', 'reload']);
  });

  it('“Uygulamayı baştan indir” removes this app’s worker and app-shell caches — not the speech model, not another app’s — then reloads', async () => {
    const page = dead({ controlled: true });
    page.notice.press('reset');
    await vi.advanceTimersByTimeAsync(10);
    expect(page.state.unregistered).toEqual(['/capcut/']);
    expect(page.state.deletedCaches).toEqual(['clip-app-abc', 'clip-app-old']);
    expect(page.state.reloads).toBe(1);
    expect(page.flag()).toMatchObject({ s: 'reloading', why: 'reset' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.state.reloads).toBe(1);
  });
});

describe('a page that IS alive and loses a part later', () => {
  it('is never reloaded; an unhandled failed part shows the notice with a way to close it', () => {
    const page = load();
    page.loaded();
    page.alive();
    page.seconds(2);
    page.scriptFailed(OWN_SCRIPT);
    page.seconds(60);
    // The file event alone says nothing: the bundler retries, and the app's own message speaks.
    expect(page.noticeState()).toBe('hidden');
    page.rejected('ChunkLoadError');
    expect(page.noticeState()).toBe('late');
    expect(page.shownParts()).toEqual(['late', 'reload', 'close']);
    page.seconds(600);
    expect(page.state.reloads).toBe(0);
    page.notice.press('close');
    expect(page.noticeState()).toBe('hidden');
    expect(page.visiblePanel()).toEqual([]);
  });

  it('other uncaught errors are not its business', () => {
    const page = load();
    page.loaded();
    page.alive();
    page.uncaught('TypeError');
    page.rejected('AbortError');
    expect(page.noticeState()).toBe('hidden');
    page.uncaught('ChunkLoadError');
    expect(page.noticeState()).toBe('late');
  });

  it('its own stylesheet failing late shows the notice, without a reload', () => {
    const page = load();
    page.loaded();
    page.alive();
    page.styleFailed(OWN_STYLE);
    expect(page.noticeState()).toBe('late');
    expect(page.state.reloads).toBe(0);
  });
});

describe('the inline script', () => {
  it('stands alone: its text runs with nothing but window and document', () => {
    const script = SCRIPT;
    expect(script).not.toMatch(/<\/script|<!--/i);
    expect(script).toContain(PAGE_RECOVERY_KEY);
    // No comment lines reach the page, and nothing a browser of 2019 could not parse.
    expect(script).not.toMatch(/^\s*\/\//m);
    expect(script).not.toMatch(/=>|`|\?\.|\?\?|\b(let|const|async|await|class)\b/);
    let reloads = 0;
    const storage = new Map<string, string>();
    const listeners = new Map<string, Listener[]>();
    const win = {
      location: { pathname: '/capcut/', origin: 'https://example.test', href: 'https://example.test/capcut/', reload: () => (reloads += 1) },
      sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) },
      navigator: {},
      addEventListener: (type: string, listener: Listener) => void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    };
    const doc = {
      documentElement: new FakeElement(),
      readyState: 'loading',
      getElementById: () => null,
      querySelector: () => null,
      addEventListener: () => undefined,
    };
    new Function('window', 'document', script)(win, { ...doc, querySelectorAll: () => [] });
    for (const listener of listeners.get('load') ?? []) listener({});
    vi.advanceTimersByTime(15_000);
    expect(reloads).toBe(1);
    expect(JSON.parse(storage.get(PAGE_RECOVERY_KEY) ?? 'null')).toMatchObject({ s: 'reloading', why: 'timeout' });
  });

  it('the limits are the ones the ADR argues for, and the names are the ones the app uses', () => {
    expect(watchdogConfig('')).toEqual({
      key: PAGE_RECOVERY_KEY,
      aliveAttr: PAGE_ALIVE_ATTRIBUTE,
      pendingAttr: PAGE_PENDING_ATTRIBUTE,
      noticeId: PAGE_NOTICE_ID,
      staticPrefix: '/_next/static/',
      scope: '/',
      cachePrefix: 'clip-app-',
      graceS: 15,
      errorS: 4,
      stuckS: 45,
      quietMs: 300_000,
    });
    expect(watchdogConfig('/capcut')).toMatchObject({ staticPrefix: '/capcut/_next/static/', scope: '/capcut/' });
    expect(SCRIPT).toContain(JSON.stringify(watchdogConfig('/capcut')));
  });

  it('is the first script of the page, after the charset and the policy, and its hash is in the policy', () => {
    const page = '<!DOCTYPE html><html><head><meta charSet="utf-8"/><link rel="stylesheet" href="/a.css"/><script src="/a.js" async=""></script></head><body><script>self.__next_f=[]</script></body></html>';
    const { html, policy } = applyCsp(insertWatchdog(page, SCRIPT));
    const opening = `<script ${WATCHDOG_MARKER}="">`;
    expect(html.indexOf(opening)).toBeGreaterThan(html.indexOf('Content-Security-Policy'));
    expect(html.indexOf(opening)).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    expect(html.indexOf(opening)).toBeLessThan(html.indexOf('<script src='));
    const hashes = inlineHashes(`<script>${SCRIPT}</script>`).scripts;
    expect(hashes).toHaveLength(1);
    expect(policy).toContain(hashes[0]);
    expect(policy).not.toContain('unsafe-inline');
    // Running the build step again on the same page changes nothing (one script, same place).
    const again = applyCsp(insertWatchdog(html, SCRIPT));
    expect(again.html).toBe(html);
    expect(again.html.split(opening)).toHaveLength(2);
  });

  it('a template without its markers stops the build', () => {
    expect(() => watchdogScript('', 'var a = 1;')).toThrow(/@clip-watchdog-begin/);
    expect(() => watchdogScript('', '// @clip-watchdog-begin\nvar a = 1;\n// @clip-watchdog-end')).toThrow(/@clip-watchdog-config/);
    expect(() => insertWatchdog('<html><head></head></html>', SCRIPT)).toThrow(/charset/);
    const template = readFileSync(join(process.cwd(), 'scripts', 'lib', 'page-watchdog.js'), 'utf8');
    expect(watchdogScript('/capcut', template)).toBe(SCRIPT);
  });
});

describe('markPageAlive', () => {
  function browser(stored: string | null) {
    const storage = new Map<string, string>(stored === null ? [] : [[PAGE_RECOVERY_KEY, stored]]);
    const root = new FakeElement();
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', { location: { pathname: '/yap/cevir' }, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) } });
    return { root, storage };
  }

  it('marks the page, and a second try that came alive is written down as recovered', () => {
    const { root, storage } = browser(JSON.stringify({ s: 'retried', t: 5, p: '/yap/cevir', why: 'file' }));
    markPageAlive();
    expect(root.hasAttribute(PAGE_ALIVE_ATTRIBUTE)).toBe(true);
    expect(JSON.parse(storage.get(PAGE_RECOVERY_KEY) ?? 'null')).toEqual({ s: 'recovered', t: 5, p: '/yap/cevir', why: 'file' });
  });

  it('writes nothing when there was no reload', () => {
    const { root, storage } = browser(null);
    markPageAlive();
    expect(root.hasAttribute(PAGE_ALIVE_ATTRIBUTE)).toBe(true);
    expect(storage.size).toBe(0);
  });
});
