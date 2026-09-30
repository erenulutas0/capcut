/*
 * Clip service worker (ADR-031). Written to `<base>/sw.js` by
 * scripts/build-sw.mjs after every build, with CONFIG filled in: the build's
 * own files, and nothing else. Edit this template, not the output.
 *
 * What it does:
 * - install: stores this build's pages, its hashed files (/_next/static/),
 *   the caption typeface, the icons and the manifest in one cache named
 *   after the build ("clip-app-<version>"). All or nothing (Cache.addAll).
 * - activate: deletes the app's older caches ("clip-app-*" only).
 * - fetch: pages network first, the stored page when the network fails or
 *   hangs; the stored build files cache first. Everything else is not
 *   touched: other origins, POST, range requests (video), blob:/OPFS data
 *   (never reach a service worker), files outside the list.
 *
 * It never stores what the network returns at runtime, so the cache holds
 * exactly the list below: no user media, no exported file, no other site.
 * It makes no request of its own except the list, on the app's origin.
 */
'use strict';

const CONFIG = /* @clip-sw-config */ { version: 'dev', base: '', pages: [], assets: [] } /* @end */;

const PREFIX = 'clip-app-';
const CACHE = PREFIX + CONFIG.version;
const STATIC = CONFIG.base + '/_next/static/';
/** A page request waits this long for the network before the stored copy is used. */
const PAGE_TIMEOUT_MS = 4000;

/** "/capcut/editor/", "/capcut/editor", "/capcut/editor/index.html" → one key. */
function pageKey(pathname) {
  const trimmed = pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

const PAGES = new Map(CONFIG.pages.map((path) => [pageKey(path), path]));
const ASSETS = new Set(CONFIG.assets);

function inScope(url) {
  if (url.origin !== self.location.origin) return false;
  return CONFIG.base === '' || url.pathname === CONFIG.base || url.pathname.startsWith(CONFIG.base + '/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([
        // Pages and unhashed files are revalidated (the host may cache them
        // for minutes); hashed build files never change under their name.
        ...CONFIG.pages.map((path) => new Request(path, { cache: 'no-cache' })),
        ...CONFIG.assets.map((path) => new Request(path, { cache: path.startsWith(STATIC) ? 'default' : 'no-cache' })),
      ]),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)))),
  );
});

function stored(path) {
  return caches.open(CACHE).then((cache) => cache.match(path));
}

async function page(request, path) {
  const network = fetch(request);
  network.catch(() => undefined);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS);
      network.then(
        (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  } catch {
    const copy = await stored(path);
    if (copy) return copy;
    // Nothing stored (the cache was cleared): wait for the network after all.
    return network;
  }
}

async function asset(request, url) {
  const copy = await stored(url.pathname);
  if (!copy) return fetch(request);
  // A worker reads its start-up settings from its own address (Turbopack:
  // "…/turbopack-worker-….js#params=…"). A stored response carries the
  // stored address, without that part, and the worker would stop with
  // "Missing worker bootstrap config"; a new Response keeps the requested one.
  if (request.destination === 'worker' || request.destination === 'sharedworker') {
    return new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers: copy.headers });
  }
  return copy;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (!inScope(url)) return;
  if (request.mode === 'navigate') {
    // Only the app's own pages; any other address is the browser's business.
    const path = PAGES.get(pageKey(url.pathname));
    if (path) event.respondWith(page(request, path));
    return;
  }
  // Build files by their exact name. The icons' links carry a content hash
  // as a query ("/icon.svg?icon.2qx….svg"); the stored copy is that build's.
  if (ASSETS.has(url.pathname) && (url.search === '' || !url.pathname.startsWith(STATIC))) {
    event.respondWith(asset(request, url));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'clip-sw:activate') {
    self.skipWaiting();
    return;
  }
  // "Is this page from your build?": the page lists its own build files.
  if (data.type === 'clip-sw:owns' && Array.isArray(data.paths) && event.ports[0]) {
    const owns = data.paths.length > 0 && data.paths.every((path) => ASSETS.has(path));
    event.ports[0].postMessage({ version: CONFIG.version, owns });
  }
});
