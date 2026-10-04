/**
 * Serves the static export (`out/`) under a sub-path, the way GitHub Pages
 * serves the repository site (`https://<user>.github.io/capcut/`). Used by the
 * Pages smoke test so a broken base path is caught before it is published.
 * No dependencies; not a production server.
 *
 *   node scripts/serve-static.mjs --dir=out --base=/capcut --port=3104 [--gzip]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';

const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const root = resolve(arg('dir', 'out'));
const base = arg('base', '/capcut').replace(/\/+$/, '');
const port = Number(arg('port', '3104'));
const gzip = process.argv.includes('--gzip');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(`${base}/`) && url.pathname !== base) {
    response.writeHead(404).end('outside base path');
    return;
  }
  // Like GitHub Pages: /capcut/editor redirects to /capcut/editor/.
  let relative = decodeURIComponent(url.pathname.slice(base.length)) || '/';
  const target = normalize(join(root, relative));
  if (!target.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  let file = target;
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!relative.endsWith('/')) {
      response.writeHead(301, { Location: `${url.pathname}/` }).end();
      return;
    }
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) {
    response.writeHead(404, { 'Content-Type': TYPES['.html'] });
    const notFound = join(root, '404.html');
    if (existsSync(notFound)) createReadStream(notFound).pipe(response);
    else response.end('not found');
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  // --gzip: compress text like GitHub Pages does, for load measurements
  // (scripts/measure-load.mjs, Lighthouse). Off by default.
  if (gzip && /^(text\/|application\/json)/.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
    response.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    createReadStream(file).pipe(createGzip()).pipe(response);
    return;
  }
  // Byte ranges, as GitHub Pages serves them: the speech model's large files
  // are fetched (and resumed) in parts (ADR-036).
  const size = statSync(file).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] === '' ? size - 1 : Math.min(size - 1, Number(range[2]));
    if (start >= size || end < start) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    response.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}${base}/`);
});
