/**
 * Post-build step of `npm run build`, after apply-csp.mjs (the pages are
 * stored as they are served, policy included): writes the service worker
 * with this build's file list (ADR-031, scripts/lib/precache.mjs).
 *
 * - Static export (STATIC_EXPORT=1, GitHub Pages): `out/sw.js`.
 * - Server build (`next start`, e2e): the prerendered body of the `/sw.js`
 *   route (`.next/server/app/sw.js.body`), which `next start` serves as is.
 *
 * The page registers the worker only in production builds, never in
 * `next dev` (src/adapters/pwa/serviceWorker.ts).
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { collectPrecache, precacheVersion, renderServiceWorker } from './lib/precache.mjs';

const webDir = process.cwd();
const mode = process.env.STATIC_EXPORT === '1' ? 'export' : 'server';
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const target = mode === 'export' ? join(webDir, 'out', 'sw.js') : join(webDir, '.next', 'server', 'app', 'sw.js.body');

if (!existsSync(target)) {
  console.error(`build-sw: ${relative(webDir, target)} is missing (the /sw.js route did not build)`);
  process.exit(1);
}

const template = readFileSync(join(webDir, 'scripts', 'lib', 'service-worker.js'), 'utf8');
const list = collectPrecache({ webDir, mode, base });
const pageUrls = list.pages.map((entry) => entry.url);
for (const needed of ['/', '/editor', '/gizlilik']) {
  const found = pageUrls.some((url) => url.replace(/\/$/, '') === `${base}${needed}`.replace(/\/$/, ''));
  if (!found) {
    console.error(`build-sw: page ${base}${needed} not found in the build (${pageUrls.join(', ')})`);
    process.exit(1);
  }
}
if (!list.assets.some((entry) => entry.url.endsWith('.woff2'))) {
  console.error('build-sw: the caption typeface is missing from the list');
  process.exit(1);
}

const version = precacheVersion(list, template);
const source = renderServiceWorker(template, {
  version,
  base,
  pages: pageUrls,
  assets: list.assets.map((entry) => entry.url),
});
writeFileSync(target, source);

// `next start` copies a prerendered route's body into .next/server/route-cache/
// on its first request and serves that copy from then on, across restarts.
// A fresh `next build` has none; when this step runs again on an already
// served build, the stale copy must go or the old worker keeps being served.
if (mode === 'server') {
  const metaFile = join(webDir, '.next', 'server', 'app', 'sw.js.meta');
  const key = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8'))?.routeCache?.key : null;
  if (typeof key === 'string' && key.startsWith('/route-cache/')) {
    for (const suffix of ['.body', '.meta']) {
      const stale = join(webDir, '.next', 'server', ...key.split('/').filter(Boolean)) + suffix;
      if (existsSync(stale)) {
        rmSync(stale);
        console.log(`build-sw: removed the served copy ${relative(webDir, stale)}`);
      }
    }
  }
}

const bytes = [...list.pages, ...list.assets].reduce((sum, entry) => sum + statSync(entry.file).size, 0);
console.log(
  `build-sw: ${relative(webDir, target)} — cache clip-app-${version}: ${list.pages.length} pages, ` +
    `${list.assets.length} files, ${(bytes / 1_000_000).toFixed(2)} MB`,
);
