/**
 * Serves the static export (`out/`) under a sub-path, the way GitHub Pages
 * serves the repository site (`https://<user>.github.io/capcut/`). Used by the
 * Pages smoke test so a broken base path is caught before it is published.
 * No dependencies; not a production server.
 *
 *   node scripts/serve-static.mjs --dir=out --base=/capcut --port=3104
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const root = resolve(arg('dir', 'out'));
const base = arg('base', '/capcut').replace(/\/+$/, '');
const port = Number(arg('port', '3104'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
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
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}${base}/`);
});
