/**
 * Static server for the spike page. Serves this folder at `/` (page, worker,
 * node_modules, mirrored models) and the speech fixtures at `/speech/`.
 * Sends COOP/COEP so SharedArrayBuffer (multi-threaded WASM) is available,
 * exactly as the shipping app would have to.
 *
 *   node serve.mjs            # http://127.0.0.1:3103
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const speechDir = join(dirname(dirname(here)), 'tests', 'media', 'speech');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.onnx_data': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.css': 'text/css; charset=utf-8',
};

/** `/models/<repo>/resolve/main/…` → the pinned revision the mirror holds. */
function pinnedRevisions() {
  const manifest = join(here, 'models', 'manifest.json');
  if (!existsSync(manifest)) return new Map();
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  return new Map(Object.values(json.models).map((m) => [m.id, m.revision]));
}

export function startServer(port = 3103) {
  const pinned = pinnedRevisions();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let pathname = decodeURIComponent(url.pathname);
    let base = here;
    if (pathname.startsWith('/speech/')) {
      base = speechDir;
      pathname = pathname.slice('/speech'.length);
    } else if (pathname.startsWith('/models/')) {
      const m = /^\/models\/([^/]+\/[^/]+)\/resolve\/main\/(.*)$/.exec(pathname);
      if (m && pinned.has(m[1])) pathname = `/models/${m[1]}/resolve/${pinned.get(m[1])}/${m[2]}`;
    }
    const file = normalize(join(base, pathname));
    if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
      server.notFound.push(url.pathname);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const size = statSync(file).size;
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  server.notFound = [];
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3103);
  await startServer(port);
  console.log(`spike server: http://127.0.0.1:${port}/index.html`);
}
