/**
 * The service worker's list (ADR-031): which files of a finished build are
 * stored for offline use, and the version that names the cache. Read from the
 * build output itself, so the list always matches what is served.
 *
 * Stored:
 * - the pages: `/`, `/editor`, `/gizlilik`, `/gizlilik/en` (whatever the build
 *   prerendered, minus Next's internal `_not-found` / `_global-error`);
 * - every hashed build file under `/_next/static/` (app code, CSS, the export
 *   and silence workers with mediabunny), minus source maps and the
 *   TypeScript sources Turbopack copies next to the workers;
 * - the caption typeface (`/fonts/caption/*.woff2`), the icons and the manifest.
 *
 * Not stored: anything else (OFL.txt, RSC payloads, 404 page, `sw.js` itself).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CONFIG_RE = /\/\* @clip-sw-config \*\/[\s\S]*?\/\* @end \*\//;

function walk(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const posix = (path) => path.split(sep).join('/');

/** A build file, or a public file, the offline app needs (path relative to the site root, no leading slash). */
export function isOfflineAsset(rel) {
  if (rel.startsWith('_next/static/')) return !/\.(map|tsx?)$/.test(rel);
  if (/^fonts\/caption\/[^/]+\.woff2$/.test(rel)) return true;
  if (/^icons\/[^/]+\.png$/.test(rel)) return true;
  return rel === 'icon.svg' || rel === 'apple-icon.png' || rel === 'manifest.webmanifest';
}

/** Internal Next pages (`_not-found`, `_global-error`) are not app pages. */
const internal = (rel) => rel.split('/').some((part) => part.startsWith('_'));

/**
 * Entries `{ url, file }` for one build. `mode` is 'export' (the static
 * export in `out/`, GitHub Pages) or 'server' (`.next/` for `next start`).
 */
export function collectPrecache({ webDir, mode, base = '' }) {
  const pages = [];
  const assets = [];
  if (mode === 'export') {
    const out = join(webDir, 'out');
    for (const file of walk(out)) {
      const rel = posix(relative(out, file));
      if (rel.endsWith('index.html') && (rel === 'index.html' || rel.endsWith('/index.html')) && !internal(rel)) {
        pages.push({ url: `${base}/${rel.slice(0, -'index.html'.length)}`, file });
      } else if (isOfflineAsset(rel)) {
        assets.push({ url: `${base}/${rel}`, file });
      }
    }
  } else {
    const app = join(webDir, '.next', 'server', 'app');
    for (const file of walk(app)) {
      const rel = posix(relative(app, file));
      if (rel.endsWith('.html') && !internal(rel)) {
        const route = rel === 'index.html' ? '' : `/${rel.slice(0, -'.html'.length)}`;
        pages.push({ url: route === '' ? `${base}/` : `${base}${route}`, file });
      } else if (rel.endsWith('.body') && !rel.includes('/')) {
        // Metadata routes Next serves itself: icon.svg, apple-icon.png, the manifest.
        const name = rel.slice(0, -'.body'.length);
        if (isOfflineAsset(name)) assets.push({ url: `${base}/${name}`, file });
      }
    }
    const staticDir = join(webDir, '.next', 'static');
    for (const file of walk(staticDir)) {
      const rel = `_next/static/${posix(relative(staticDir, file))}`;
      if (isOfflineAsset(rel)) assets.push({ url: `${base}/${rel}`, file });
    }
    const publicDir = join(webDir, 'public');
    for (const file of walk(publicDir)) {
      const rel = posix(relative(publicDir, file));
      if (isOfflineAsset(rel)) assets.push({ url: `${base}/${rel}`, file });
    }
  }
  const byUrl = (a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  return { pages: pages.sort(byUrl), assets: assets.sort(byUrl) };
}

/** 16 hex characters over every stored file's bytes and the worker's own code. */
export function precacheVersion({ pages, assets }, template) {
  const hash = createHash('sha256');
  hash.update(template);
  for (const { url, file } of [...pages, ...assets]) {
    hash.update(`\0${url}\0`);
    hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 16);
}

/** The template with its CONFIG filled in. */
export function renderServiceWorker(template, config) {
  if (!CONFIG_RE.test(template)) throw new Error('service worker template: no /* @clip-sw-config */ marker');
  const json = JSON.stringify(config);
  return template.replace(CONFIG_RE, () => `/* @clip-sw-config */ ${json} /* @end */`);
}
