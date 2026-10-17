import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { collectPrecache, precacheVersion, renderServiceWorker, withShareInbox } from '../../scripts/lib/precache.mjs';
import { SHARE_CACHE, SHARE_TTL_MS, readShareEntry } from '../../scripts/lib/share-target.mjs';

const TEMPLATE = readFileSync(join(process.cwd(), 'scripts', 'lib', 'service-worker.js'), 'utf8');
/** The worker's code as build-sw.mjs writes it: the template with the share target's inbox (ADR-047). */
const WORKER = withShareInbox(TEMPLATE, readFileSync(join(process.cwd(), 'scripts', 'lib', 'share-target.mjs'), 'utf8'));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'clip-sw-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const urls = (entries: Array<{ url: string }>) => entries.map((entry) => entry.url);

describe('precache list (ADR-031)', () => {
  it('static export under /capcut: the pages, the build files, the typeface, icons, manifest — nothing else', () => {
    const web = tree({
      'out/index.html': 'opening screen',
      'out/editor/index.html': 'editor',
      'out/editor/index.txt': 'rsc payload',
      'out/yap/kes/index.html': 'wizard',
      'out/yap/kes/index.txt': 'rsc payload',
      'out/yap/dikey/index.html': 'wizard',
      'out/yap/__next._tree.txt': 'segment payload',
      'out/gizlilik/index.html': 'privacy',
      'out/gizlilik/en/index.html': 'privacy en',
      'out/404.html': 'not found',
      'out/404/index.html': 'not found',
      'out/_not-found/index.html': 'internal',
      'out/_next/static/chunks/app.js': 'code',
      'out/_next/static/chunks/app.js.map': 'map',
      'out/_next/static/media/exportWorker.ts': 'source',
      'out/_next/static/chunks/style.css': 'css',
      'out/fonts/caption/inter-latin-700-normal.woff2': 'font',
      'out/fonts/caption/OFL.txt': 'licence',
      'out/icons/icon-192.png': 'png',
      'out/icon.svg': 'svg',
      'out/apple-icon.png': 'png',
      'out/manifest.webmanifest': '{}',
      'out/sw.js': 'old worker',
      'out/robots.txt': 'x',
    });
    const list = collectPrecache({ webDir: web, mode: 'export', base: '/capcut' });
    expect(urls(list.pages)).toEqual([
      '/capcut/',
      '/capcut/editor/',
      '/capcut/gizlilik/',
      '/capcut/gizlilik/en/',
      // The task wizards (ADR-034): one page per task, kept for offline use.
      '/capcut/yap/dikey/',
      '/capcut/yap/kes/',
    ]);
    expect(urls(list.assets)).toEqual([
      '/capcut/_next/static/chunks/app.js',
      '/capcut/_next/static/chunks/style.css',
      '/capcut/apple-icon.png',
      '/capcut/fonts/caption/inter-latin-700-normal.woff2',
      '/capcut/icon.svg',
      '/capcut/icons/icon-192.png',
      '/capcut/manifest.webmanifest',
    ]);
  });

  it('server build (next start, root path): prerendered pages, .next/static, public files, metadata routes', () => {
    const web = tree({
      '.next/server/app/index.html': 'opening screen',
      '.next/server/app/editor.html': 'editor',
      '.next/server/app/yap/kes.html': 'wizard',
      '.next/server/app/yap/kes.rsc': 'rsc',
      '.next/server/app/yap/kes.meta': 'meta',
      '.next/server/app/yap/bosluk.html': 'wizard',
      '.next/server/app/gizlilik.html': 'privacy',
      '.next/server/app/gizlilik/en.html': 'privacy en',
      '.next/server/app/_not-found.html': 'internal',
      '.next/server/app/_global-error.html': 'internal',
      '.next/server/app/editor.rsc': 'rsc',
      '.next/server/app/icon.svg.body': 'svg',
      '.next/server/app/manifest.webmanifest.body': '{}',
      '.next/server/app/sw.js.body': 'worker',
      '.next/static/chunks/app.js': 'code',
      '.next/static/media/silenceWorker.ts': 'source',
      'public/fonts/caption/inter-latin-ext-700-normal.woff2': 'font',
      'public/fonts/caption/OFL.txt': 'licence',
      'public/icons/maskable-512.png': 'png',
    });
    const list = collectPrecache({ webDir: web, mode: 'server' });
    expect(urls(list.pages)).toEqual(['/', '/editor', '/gizlilik', '/gizlilik/en', '/yap/bosluk', '/yap/kes']);
    expect(urls(list.assets)).toEqual([
      '/_next/static/chunks/app.js',
      '/fonts/caption/inter-latin-ext-700-normal.woff2',
      '/icon.svg',
      '/icons/maskable-512.png',
      '/manifest.webmanifest',
    ]);
  });

  it('the version follows the bytes: same build, same name; one changed file, a new cache', () => {
    const files = { 'out/index.html': 'a', 'out/_next/static/chunks/app.js': 'code', 'out/fonts/caption/x.woff2': 'f' };
    const one = tree(files);
    const two = tree(files);
    const three = tree({ ...files, 'out/_next/static/chunks/app.js': 'code!' });
    const version = (web: string) => precacheVersion(collectPrecache({ webDir: web, mode: 'export' }), TEMPLATE);
    expect(version(one)).toMatch(/^[0-9a-f]{16}$/);
    expect(version(two)).toBe(version(one));
    expect(version(three)).not.toBe(version(one));
    expect(precacheVersion(collectPrecache({ webDir: one, mode: 'export' }), `${TEMPLATE}\n// changed`)).not.toBe(version(one));
  });

  it('writes the list into the template once, and refuses a template without the marker', () => {
    const config = { version: 'abc', base: '/capcut', pages: ['/capcut/'], assets: ['/capcut/icon.svg'] };
    const source = renderServiceWorker(TEMPLATE, config);
    expect(source).toContain(`/* @clip-sw-config */ ${JSON.stringify(config)} /* @end */`);
    expect(source.match(/@clip-sw-config/g)).toHaveLength(1);
    expect(() => renderServiceWorker('self.x = 1;', config)).toThrow(/marker/);
  });
});

// ------------------------------------------------------------ the worker itself

type Handler = (event: Record<string, unknown>) => void;

/** The worker builds requests from paths; in a worker they resolve against its own address. */
class ScopedRequest {
  url: string;
  cache: string | undefined;
  constructor(input: string, init?: { cache?: string }) {
    this.url = new URL(input, 'https://app.test/capcut/sw.js').href;
    this.cache = init?.cache;
  }
}

/** Runs the generated worker against in-memory stand-ins for its globals. */
function loadWorker(config: { version: string; base: string; pages: string[]; assets: string[] }) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  let skipped = 0;
  const cacheFor = (name: string) => {
    let entries = stores.get(name);
    if (!entries) {
      entries = new Map();
      stores.set(name, entries);
    }
    const map = entries;
    return {
      addAll: async (requests: ScopedRequest[]) => {
        for (const request of requests) {
          const url = new URL(request.url);
          fetched.push(url.pathname);
          const response = new Response(`body of ${url.pathname}`, { status: 200 });
          Object.defineProperty(response, 'url', { value: request.url });
          map.set(url.pathname, response);
        }
      },
      match: async (path: string | { url: string }) => {
        const response = map.get(new URL(typeof path === 'string' ? path : path.url, 'https://app.test').pathname);
        if (!response) return undefined;
        // Like Cache Storage: the stored response keeps the stored address.
        const copy = response.clone();
        Object.defineProperty(copy, 'url', { value: response.url });
        return copy;
      },
      // What the share target's inbox uses (ADR-047).
      put: async (path: string, response: Response) => {
        const body = await response.arrayBuffer();
        map.set(new URL(path, 'https://app.test').pathname, new Response(body, { headers: response.headers }));
      },
      keys: async () => [...map.keys()].map((path) => ({ url: `https://app.test${path}` })),
      delete: async (path: string | { url: string }) => map.delete(new URL(typeof path === 'string' ? path : path.url, 'https://app.test').pathname),
    };
  };
  const scope = {
    location: new URL('https://app.test/capcut/sw.js'),
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    skipWaiting: () => {
      skipped += 1;
    },
  };
  const cachesApi = {
    has: async (name: string) => stores.has(name),
    open: async (name: string) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const fetchStub = async (request: Request) => {
    fetched.push(`network ${new URL(request.url).pathname}`);
    return new Response('from network');
  };
  const source = renderServiceWorker(WORKER, config);
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', 'setTimeout', 'clearTimeout', source)(
    scope,
    cachesApi,
    fetchStub,
    ScopedRequest,
    Response,
    URL,
    setTimeout,
    clearTimeout,
  );

  async function lifecycle(type: 'install' | 'activate') {
    let wait: Promise<unknown> = Promise.resolve();
    handlers[type]?.({ waitUntil: (promise: Promise<unknown>) => (wait = promise) });
    await wait;
  }

  /** What the worker does with one request: null = not handled (the browser's own). */
  async function request(url: string, init: { method?: string; mode?: string; destination?: string; range?: boolean } = {}) {
    let answer: Promise<Response> | null = null;
    const headers = new Headers(init.range ? { range: 'bytes=0-' } : {});
    const fake = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', destination: init.destination ?? '', headers };
    handlers.fetch?.({ request: fake, respondWith: (promise: Promise<Response>) => (answer = promise) });
    if (!answer) return null;
    const response: Response = await answer;
    return { body: await response.text(), url: response.url };
  }

  return { handlers, stores, fetched, lifecycle, request, skippedCount: () => skipped };
}

const CONFIG = {
  version: 'v2',
  base: '/capcut',
  pages: ['/capcut/', '/capcut/editor/', '/capcut/gizlilik/'],
  assets: ['/capcut/_next/static/chunks/app.js', '/capcut/_next/static/chunks/turbopack-worker-x.js', '/capcut/icon.svg'],
};

describe('service worker behaviour (ADR-031)', () => {
  it('install stores exactly the list, in one cache named after the build', async () => {
    const sw = loadWorker(CONFIG);
    await sw.lifecycle('install');
    expect([...sw.stores.keys()]).toEqual(['clip-app-v2']);
    expect([...(sw.stores.get('clip-app-v2')?.keys() ?? [])].sort()).toEqual([...CONFIG.pages, ...CONFIG.assets].sort());
  });

  it('activate deletes only its own older caches', async () => {
    const sw = loadWorker(CONFIG);
    await sw.lifecycle('install');
    sw.stores.set('clip-app-v1', new Map());
    sw.stores.set('another-app-cache', new Map());
    await sw.lifecycle('activate');
    expect([...sw.stores.keys()].sort()).toEqual(['another-app-cache', 'clip-app-v2']);
  });

  it('serves stored build files, leaves everything else to the browser', async () => {
    const sw = loadWorker(CONFIG);
    await sw.lifecycle('install');
    expect((await sw.request('https://app.test/capcut/_next/static/chunks/app.js'))?.body).toBe(
      'body of /capcut/_next/static/chunks/app.js',
    );
    // The icon link's content-hash query still gets the stored icon.
    expect((await sw.request('https://app.test/capcut/icon.svg?icon.123.svg'))?.body).toBe('body of /capcut/icon.svg');
    for (const [url, init] of [
      ['https://app.test/capcut/_next/static/chunks/other.js', {}],
      ['https://app.test/capcut/_next/static/chunks/app.js?v=2', {}],
      ['https://app.test/capcut/_next/static/chunks/app.js', { method: 'POST' }],
      ['https://app.test/capcut/_next/static/chunks/app.js', { range: true }],
      ['https://cdn.example/capcut/_next/static/chunks/app.js', {}],
      ['https://app.test/other-project/_next/static/chunks/app.js', {}],
      ['https://app.test/capcut/video.mp4', { destination: 'video', range: true }],
      ['https://app.test/capcut/nerede', { mode: 'navigate' }],
      ['https://app.test/capcut/editor/index.txt?_rsc=1', {}],
    ] as const) {
      expect(await sw.request(url, init), `${init && 'method' in init ? init.method : 'GET'} ${url}`).toBeNull();
    }
  });

  it('a worker script keeps the address it was asked for (Turbopack reads #params= from it)', async () => {
    const sw = loadWorker(CONFIG);
    await sw.lifecycle('install');
    const url = 'https://app.test/capcut/_next/static/chunks/turbopack-worker-x.js';
    const asWorker = await sw.request(url, { destination: 'worker' });
    expect(asWorker?.body).toBe('body of /capcut/_next/static/chunks/turbopack-worker-x.js');
    // A new Response has no URL of its own: the browser keeps the request's, fragment included.
    expect(asWorker?.url).toBe('');
    expect((await sw.request(url, { destination: 'script' }))?.url).toBe(url);
  });

  it('pages: network first; the stored page when the network fails, under any spelling', async () => {
    const sw = loadWorker(CONFIG);
    await sw.lifecycle('install');
    expect((await sw.request('https://app.test/capcut/editor/', { mode: 'navigate' }))?.body).toBe('from network');
    // The same worker with a network that fails (offline).
    const failing = () => Promise.reject(new TypeError('Failed to fetch'));
    const source = renderServiceWorker(WORKER, CONFIG);
    const handlers: Record<string, Handler> = {};
    new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', 'setTimeout', 'clearTimeout', source)(
      { location: new URL('https://app.test/capcut/sw.js'), addEventListener: (t: string, h: Handler) => (handlers[t] = h) },
      {
        open: async () => ({ match: async (path: string) => new Response(`stored ${path}`) }),
        keys: async () => [],
        delete: async () => true,
      },
      failing,
      ScopedRequest,
      Response,
      URL,
      setTimeout,
      clearTimeout,
    );
    for (const path of ['/capcut/editor', '/capcut/editor/', '/capcut/editor/index.html', '/capcut', '/capcut/gizlilik?x=1']) {
      let answer: Promise<Response> | null = null;
      handlers.fetch?.({
        request: { url: `https://app.test${path}`, method: 'GET', mode: 'navigate', destination: 'document', headers: new Headers() },
        respondWith: (promise: Promise<Response>) => (answer = promise),
      });
      expect(answer, path).not.toBeNull();
      const expected = path.startsWith('/capcut/editor') ? '/capcut/editor/' : path.startsWith('/capcut/gizlilik') ? '/capcut/gizlilik/' : '/capcut/';
      expect(await (await (answer as unknown as Promise<Response>)).text(), path).toBe(`stored ${expected}`);
    }
  });

  it('switches to the new build only when asked, and answers "is this page yours?"', async () => {
    const sw = loadWorker(CONFIG);
    sw.handlers.message?.({ data: { type: 'unknown' }, ports: [] });
    expect(sw.skippedCount()).toBe(0);
    sw.handlers.message?.({ data: { type: 'clip-sw:activate' }, ports: [] });
    expect(sw.skippedCount()).toBe(1);

    const answers: unknown[] = [];
    const port = { postMessage: (value: unknown) => answers.push(value) };
    sw.handlers.message?.({ data: { type: 'clip-sw:owns', paths: ['/capcut/_next/static/chunks/app.js'] }, ports: [port] });
    sw.handlers.message?.({
      data: { type: 'clip-sw:owns', paths: ['/capcut/_next/static/chunks/app.js', '/capcut/_next/static/chunks/old.js'] },
      ports: [port],
    });
    sw.handlers.message?.({ data: { type: 'clip-sw:owns', paths: [] }, ports: [port] });
    expect(answers).toEqual([
      { version: 'v2', owns: true },
      { version: 'v2', owns: false },
      { version: 'v2', owns: false },
    ]);
  });
});

describe('service worker: the share target (ADR-047)', () => {
  /** The share sheet's request: a navigation POST of a multipart form. */
  async function post(sw: ReturnType<typeof loadWorker>, url: string, files: File[], init: { mode?: string } = {}) {
    const data = new FormData();
    for (const file of files) data.append('video', file);
    let answer: Promise<Response> | null = null;
    const fake = { url, method: 'POST', mode: init.mode ?? 'navigate', destination: 'document', headers: new Headers(), formData: async () => data };
    sw.handlers.fetch?.({ request: fake, respondWith: (promise: Promise<Response>) => (answer = promise) });
    if (!answer) return null;
    const response: Response = await answer;
    return { status: response.status, location: response.headers.get('location') };
  }

  it('takes the POST to <base>/paylas/ on the device and answers with the opening screen (303)', async () => {
    const sw = loadWorker(CONFIG);
    await sw.lifecycle('install');
    const clip = new File(['shared bytes'], 'tatil.mp4', { type: 'video/mp4' });
    for (const url of ['https://app.test/capcut/paylas/', 'https://app.test/capcut/paylas']) {
      const answer = await post(sw, url, [clip]);
      expect(answer?.status, url).toBe(303);
      expect(answer?.location).toMatch(/^https:\/\/app\.test\/capcut\/\?paylasim=[a-z0-9]+-[a-z0-9]{6}$/);
    }
    // One shared video at a time, in its own cache; the app's offline copy is untouched.
    const shared = [...(sw.stores.get(SHARE_CACHE)?.keys() ?? [])];
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatch(/^\/capcut\/paylas\/dosya\/[a-z0-9]+-[a-z0-9]{6}$/);
    expect([...sw.stores.keys()].sort()).toEqual(['clip-app-v2', SHARE_CACHE]);
    // Nothing went to the network.
    expect(sw.fetched.filter((entry) => entry.startsWith('network'))).toEqual([]);
  });

  it('a share without a video ends on the opening screen with the reason', async () => {
    const sw = loadWorker(CONFIG);
    const answer = await post(sw, 'https://app.test/capcut/paylas/', [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })]);
    expect(answer).toEqual({ status: 303, location: 'https://app.test/capcut/?paylasim-hata=video-degil' });
    expect(sw.stores.has(SHARE_CACHE)).toBe(false);
  });

  it('leaves every other POST to the browser', async () => {
    const sw = loadWorker(CONFIG);
    const clip = new File(['x'], 'a.mp4', { type: 'video/mp4' });
    expect(await post(sw, 'https://app.test/capcut/editor/', [clip])).toBeNull();
    expect(await post(sw, 'https://app.test/capcut/paylas/', [clip], { mode: 'cors' })).toBeNull();
    expect(await post(sw, 'https://other.test/capcut/paylas/', [clip])).toBeNull();
    expect(await post(sw, 'https://app.test/other-project/paylas/', [clip])).toBeNull();
  });

  it('activation deletes a shared video that waited too long, and keeps a fresh one', async () => {
    const sw = loadWorker(CONFIG);
    await post(sw, 'https://app.test/capcut/paylas/', [new File(['x'], 'fresh.mp4', { type: 'video/mp4' })]);
    const map = sw.stores.get(SHARE_CACHE);
    const stale = new Response('old', {
      headers: { 'x-clip-shared-at': String(Date.now() - SHARE_TTL_MS - 1000), 'x-clip-name': 'old.mp4', 'content-type': 'video/mp4' },
    });
    map?.set('/capcut/paylas/dosya/old-000000', stale);
    expect(readShareEntry(stale.clone())?.name).toBe('old.mp4');
    await sw.lifecycle('activate');
    const left = [...(sw.stores.get(SHARE_CACHE)?.keys() ?? [])];
    expect(left).toHaveLength(1);
    expect(left[0]).not.toContain('old-000000');
  });
});
