/**
 * What each page of a static export makes the browser load up front, and
 * what the service worker stores (ADR-036 "Paket boyutu"): the scripts and
 * stylesheets the page's HTML names, raw and gzip (GitHub Pages serves gzip),
 * and the worker's whole list. Run on two exports — before and after a
 * change — to show what the change costs a page that does not use it.
 *
 *   node scripts/transcript/bundle-sizes.mjs --out=<export dir> [--pages=/,/editor/,/yap/kes/,/yap/yazi/]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const out = resolve(arg('out', 'out'));
const pages = arg('pages', '/,/editor/,/yap/kes/,/yap/yazi/').split(',');
const base = '/capcut';

const size = (file) => {
  const body = readFileSync(file);
  return { raw: body.length, gzip: gzipSync(body).length };
};
const result = { out, pages: {}, serviceWorker: null, chunks: null };

for (const page of pages) {
  const html = join(out, page, 'index.html');
  if (!existsSync(html)) {
    result.pages[page] = null;
    continue;
  }
  const text = readFileSync(html, 'utf8');
  const refs = new Set([...text.matchAll(/<script[^>]+src="([^"]+)"/g), ...text.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1].split('?')[0]));
  let js = { files: 0, raw: 0, gzip: 0 };
  let css = { files: 0, raw: 0, gzip: 0 };
  for (const ref of refs) {
    const file = join(out, ref.startsWith(base) ? ref.slice(base.length) : ref);
    if (!existsSync(file)) continue;
    const s = size(file);
    const bucket = ref.endsWith('.css') ? css : js;
    bucket.files += 1;
    bucket.raw += s.raw;
    bucket.gzip += s.gzip;
  }
  result.pages[page] = { html: size(html), js, css };
}

const sw = join(out, 'sw.js');
if (existsSync(sw)) {
  const config = JSON.parse(/\/\* @clip-sw-config \*\/ (\{.*?\}) \/\* @end \*\//s.exec(readFileSync(sw, 'utf8'))[1]);
  let raw = 0;
  let gzip = 0;
  for (const url of [...config.pages, ...config.assets]) {
    const rel = url.slice(base.length);
    const file = rel.endsWith('/') || rel === '' ? join(out, rel, 'index.html') : join(out, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) continue;
    const s = size(file);
    raw += s.raw;
    gzip += s.gzip;
  }
  result.serviceWorker = { pages: config.pages.length, assets: config.assets.length, raw, gzip };
}

const chunkDir = join(out, '_next', 'static', 'chunks');
if (existsSync(chunkDir)) {
  const all = readdirSync(chunkDir).filter((name) => name.endsWith('.js')).map((name) => ({ name, ...size(join(chunkDir, name)), text: readFileSync(join(chunkDir, name), 'utf8') }));
  const engine = all.filter((chunk) => chunk.text.includes('onnxruntime') && chunk.text.includes('WhisperForConditionalGeneration'));
  result.chunks = {
    files: all.length,
    raw: all.reduce((sum, chunk) => sum + chunk.raw, 0),
    gzip: all.reduce((sum, chunk) => sum + chunk.gzip, 0),
    recogniser: engine.map(({ name, raw, gzip }) => ({ name, raw, gzip })),
  };
}
console.log(JSON.stringify(result, null, 1));
