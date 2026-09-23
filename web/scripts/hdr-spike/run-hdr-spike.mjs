/**
 * HDR spike: what does each browser do with an HDR source on its own?
 *
 *   node scripts/hdr-spike/run-hdr-spike.mjs --browser=chrome [--dir=...] [--files=a.mp4,b.mov]
 *
 * For every file it records decoder/playback support, then for sampled
 * frames: the export path's draw into an sRGB 2D canvas (p1), a screenshot of
 * the <video> element — the preview the user sees (p2), drawImage of that
 * element (p3), VideoFrame.copyTo RGBA/srgb (p4) and the raw decoder planes
 * (p5). Everything is served from and written to this machine only.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const browserName = arg('browser', 'chromium');
const mediaDir = resolve(arg('dir', join(webRoot, 'tests', 'media', 'real')));
const outDir = resolve(arg('out', join(webRoot, 'hdr-spike-results', browserName)));
const port = Number(arg('port', '3137'));
const raw = args.includes('--raw');

/** File -> sampled timestamps and the size frames are drawn at (display orientation). */
const DEFAULT_FILES = {
  'web-android-hevc-hdr10plus-pq-4k.mp4': { tag: 'pq', times: [0.1, 0.5, 1.0], width: 960, height: 540 },
  'web-iphone12pro-hevc-hlg-dv-rot90.mov': { tag: 'hlg', times: [2, 6, 10, 14, 18], width: 540, height: 960 },
};
const extra = arg('files', null);
const files = extra
  ? Object.fromEntries(
      extra.split(',').map((spec) => {
        // name:tag:w:h:t1;t2;t3
        const [name, tag, w, h, times] = spec.split(':');
        return [name, { tag, width: Number(w), height: Number(h), times: times.split(';').map(Number) }];
      }),
    )
  : DEFAULT_FILES;

mkdirSync(outDir, { recursive: true });

// The app's own check module, types stripped (it has no runtime imports).
const ts = (await import('typescript')).default;
const hdrModule = ts.transpileModule(readFileSync(join(webRoot, 'src', 'domain', 'hdr.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname.startsWith('/upload/')) {
    const name = basename(decodeURIComponent(url.pathname.slice('/upload/'.length)));
    const chunks = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      writeFileSync(join(outDir, name), Buffer.concat(chunks));
      response.writeHead(200).end('ok');
    });
    return;
  }
  if (url.pathname === '/spike-domain/hdr.mjs') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(hdrModule);
    return;
  }
  let path = null;
  if (url.pathname.startsWith('/spike/')) path = join(here, basename(url.pathname));
  else if (url.pathname === '/mb/mediabunny.mjs') {
    path = join(webRoot, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.mjs');
  } else if (url.pathname.startsWith('/media/')) {
    const name = basename(decodeURIComponent(url.pathname.slice('/media/'.length)));
    if (name in files) path = join(mediaDir, name);
  }
  if (!path || !existsSync(path)) {
    response.writeHead(404).end();
    return;
  }
  const size = statSync(path).size;
  const type = TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream';
  const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    response.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(path, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(path).pipe(response);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const LAUNCH = {
  chromium: () => chromium.launch(),
  chrome: () => chromium.launch({ channel: 'chrome' }),
  edge: () => chromium.launch({ channel: 'msedge' }),
};
const browser = await LAUNCH[browserName]();
const report = { browser: browserName, version: browser.version(), files: {} };

try {
  if (args.includes('--selftest-only')) {
    // Only the synthetic HDR frame check; no media is opened.
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/spike/probe.html`);
    await page.waitForFunction(() => window.spikeReady === true);
    const env = (await page.evaluate(() => window.spike.worker({ file: null }))).env;
    report.selfTest = env?.selfTest;
    report.float16 = env?.float16;
    await page.close();
  }
  for (const [name, spec] of args.includes('--selftest-only') ? [] : Object.entries(files)) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/spike/probe.html`);
    await page.waitForFunction(() => window.spikeReady === true);

    const entry = { spec };
    entry.capabilities = await page.evaluate((f) => window.spike.capabilities(f), name).catch((e) => ({ error: String(e) }));
    entry.worker = await page
      .evaluate(
        (m) => window.spike.worker(m),
        { file: name, tag: spec.tag, times: spec.times, drawWidth: spec.width, drawHeight: spec.height, raw, rgbaCopy: raw },
      )
      .catch((e) => ({ error: String(e) }));

    entry.video = await page.evaluate(([f, w, h]) => window.spike.loadVideo(f, w, h), [name, spec.width, spec.height]);
    entry.preview = [];
    if (entry.video.ok) {
      const frames = entry.worker?.frames ?? [];
      for (const t of spec.times) {
        const decoded = frames.find((f) => f.requested === t);
        // Land inside the frame the worker decoded, not on its edge.
        const seekTo = decoded?.timestamp !== undefined
          ? decoded.timestamp + Math.min(0.25 * (decoded.duration || 0.02), 0.01)
          : t;
        try {
          const drawn = await page.evaluate(
            ([s, n, w, h]) => window.spike.seekAndDraw(s, n, w, h),
            [seekTo, `${spec.tag}-t${t}-p3-videodraw.png`, spec.width, spec.height],
          );
          await page.locator('#v').screenshot({ path: join(outDir, `${spec.tag}-t${t}-p2-preview.png`) });
          entry.preview.push({ t, seekTo, ...drawn });
        } catch (error) {
          entry.preview.push({ t, error: String(error) });
        }
      }
    }
    entry.pageErrors = errors;
    report.files[name] = entry;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, (k, v) => (k === 'rawLayout' ? undefined : v), 2));
