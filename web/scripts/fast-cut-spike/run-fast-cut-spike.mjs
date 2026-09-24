/**
 * Fast-cut spike (ADR-027): cuts synthetic and real H.264 sources with the
 * app's own fast-cut module in a real browser, then checks every output with
 * ffmpeg (frame identity, seam SSIM, barcodes, audio clicks) and plays it in
 * a `<video>` element (seeks across the seams, play-through).
 *
 *   node scripts/fast-cut-spike/run-fast-cut-spike.mjs --browser=chrome
 *   options: --browser=chromium|chrome|msedge  --cases=name1,name2  --real
 *            --sw-decode (no GPU video decoder)  --keep (keep outputs)
 *
 * Everything is local: the page is served from 127.0.0.1, outputs are POSTed
 * back to this process and written under the gitignored
 * `fastcut-spike-results/`. Real recordings are read from
 * `tests/media/real/` (or --real-dir) and never leave the machine.
 */
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

import { CLIP_DIR, makeClips } from './make-clips.mjs';
import { probeVideo, verifyCut } from './verify-cut.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const browserName = arg('browser', 'chromium');
const swDecode = args.includes('--sw-decode');
const label = `${browserName}${swDecode ? '-swdecode' : ''}`;
const outDir = resolve(arg('out', join(webRoot, 'fastcut-spike-results', label)));
const realDir = resolve(arg('real-dir', join(webRoot, 'tests', 'media', 'real')));
const port = Number(arg('port', '3171'));
const only = arg('cases', '').split(',').filter(Boolean);
const keep = args.includes('--keep');
mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ cases */

const f = (frame, fps = 30) => frame / fps;
/** Synthetic cases: ranges in seconds, all on frame boundaries, none on a keyframe unless said. */
const SYNTHETIC = [
  { name: 'bframes-one', clip: 'fc-1080p30-bframes.mp4', ranges: [[f(93), f(285)]], fps: 30 },
  { name: 'bframes-joined', clip: 'fc-1080p30-bframes.mp4', ranges: [[f(37), f(149)], [f(220), f(361)], [f(465), f(544)]], fps: 30 },
  { name: 'bframes-keyaligned', clip: 'fc-1080p30-bframes.mp4', ranges: [[f(120), f(300)]], fps: 30 },
  { name: 'bframes-short-in-gop', clip: 'fc-1080p30-bframes.mp4', ranges: [[f(65), f(100)]], fps: 30 },
  { name: 'bframes-avc3', clip: 'fc-1080p30-bframes.mp4', ranges: [[f(93), f(285)]], fps: 30, variant: { sampleEntry: 'avc3' } },
  { name: 'noB-one', clip: 'fc-1080p30-noB.mp4', ranges: [[f(47), f(403)]], fps: 30 },
  { name: 'noB-joined', clip: 'fc-1080p30-noB.mp4', ranges: [[f(10), f(100)], [f(200), f(333)]], fps: 30 },
  // Open GOP at 29.97 fps: the app encodes it (30 fps grid rule); the technique is measured anyway.
  { name: 'opengop-app', clip: 'fc-720p2997-opengop.mp4', ranges: [[3.1, 9.5]], fps: 30 },
  { name: 'opengop', clip: 'fc-720p2997-opengop.mp4', ranges: [[3.1, 9.5]], fps: 30, sourceFps: 30000 / 1001, variant: { anyFrameRate: true } },
  { name: 'rot90', clip: 'fc-1080x1920-rot90.mp4', ranges: [[f(71), f(299)], [f(350), f(410)]], fps: 30 },
  { name: 'pyramid-longgop', clip: 'fc-1080p30-pyramid-longgop.mp4', ranges: [[f(50), f(500)]], fps: 30 },
  { name: 'inband', clip: 'fc-1080p30-inband.mp4', ranges: [[f(93), f(285)]], fps: 30 },
  // 25 fps: the app encodes it (30 fps grid rule); the technique is measured anyway.
  { name: 'p25-app', clip: 'fc-720p25.mp4', ranges: [[3.12, 11.48]], fps: 30, sourceFps: 25 },
  { name: 'p25', clip: 'fc-720p25.mp4', ranges: [[3.12, 11.48]], fps: 30, sourceFps: 25, variant: { anyFrameRate: true } },
];
/** Edit-list variant (b): one range from a non-keyframe to the next IDR. */
const EDITLIST = [{ name: 'editlist', clip: 'fc-1080p30-bframes.mp4', inS: f(93), outS: f(300), fps: 30 }];

function realCases() {
  if (!existsSync(realDir)) return [];
  const names = readdirSync(realDir).filter((n) => /\.(mp4|mov|vid)$/i.test(n)).sort();
  const cases = [];
  for (const [index, name] of names.entries()) {
    const probe = probeVideo(join(realDir, name));
    if (!/avc1|avc3/.test(probe.stream.codec_tag_string ?? '')) continue;
    const d = probe.duration;
    const len = Math.min(d * 0.3, 60);
    // Two moments; cut points off the keyframes on purpose.
    const a = d * 0.08 + 0.137;
    const b = d * 0.55 + 0.211;
    const fast = probe.times.length / d > 31;
    const id = `R${String(index + 1).padStart(2, '0')}`;
    const ranges = [[a, a + len], [b, Math.min(d - 0.1, b + len)]];
    // What the app decides for this file at its own size (30 fps grid rule)...
    cases.push({ name: `${id}-app`, file: name, real: true, ranges, fps: 30 });
    // ...and the technique itself at the file's own rate (50/60 fps sources
    // on a 60 fps grid): measurement only, the app encodes those.
    cases.push({ name: id, file: name, real: true, ranges, fps: fast ? 60 : 30, variant: { anyFrameRate: true } });
  }
  return cases;
}

const cases = [
  ...SYNTHETIC.map((c) => ({ ...c, kind: 'fast' })),
  ...EDITLIST.map((c) => ({ ...c, kind: 'editlist' })),
  ...(args.includes('--real') ? realCases().map((c) => ({ ...c, kind: 'fast' })) : []),
].filter((c) => only.length === 0 || only.includes(c.name));

/* -------------------------------------------------------------- bundle+serve */

makeClips();
const bundle = await build({
  entryPoints: [join(here, 'spike-entry.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  tsconfig: join(webRoot, 'tsconfig.json'),
  logLevel: 'warning',
});
const bundleText = bundle.outputFiles[0].text;
const PAGE = '<!doctype html><meta charset="utf-8"><title>fast cut spike</title><script type="module" src="/spike.js"></script>';

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname.startsWith('/upload/')) {
    const name = basename(decodeURIComponent(url.pathname.slice('/upload/'.length)));
    const chunks = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const target = join(outDir, name);
      if (offset === 0) writeFileSync(target, Buffer.concat(chunks));
      else appendFileSync(target, Buffer.concat(chunks));
      response.writeHead(200).end('ok');
    });
    return;
  }
  if (url.pathname === '/favicon.ico') return void response.writeHead(204).end();
  if (url.pathname === '/') return void response.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);
  if (url.pathname === '/spike.js') return void response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundleText);
  let path = null;
  if (url.pathname.startsWith('/clip/')) path = join(CLIP_DIR, basename(decodeURIComponent(url.pathname.slice(6))));
  else if (url.pathname.startsWith('/real/')) path = join(realDir, basename(decodeURIComponent(url.pathname.slice(6))));
  else if (url.pathname.startsWith('/out/')) path = join(outDir, basename(decodeURIComponent(url.pathname.slice(5))));
  if (!path || !existsSync(path)) return void response.writeHead(404).end();
  // Range support: <video> seeks with byte ranges.
  const size = statSync(path).size;
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    response.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    createReadStream(path, { start, end }).pipe(response);
  } else {
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size });
    createReadStream(path).pipe(response);
  }
});
await new Promise((ok) => server.listen(port, '127.0.0.1', ok));

const launchArgs = ['--autoplay-policy=no-user-gesture-required', ...(swDecode ? ['--disable-accelerated-video-decode'] : [])];
const browser = await chromium.launch({
  ...(browserName === 'chromium' ? {} : { channel: browserName }),
  args: launchArgs,
});
const pageErrors = [];
/** No page call may hang the run: 10 minutes, then the case is an ERROR. */
const within = (promise, ms = 600_000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms} ms`)), ms))]);
async function freshPage() {
  const p = await browser.newPage();
  p.on('pageerror', (e) => pageErrors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
    else if (m.text().startsWith('[spike]')) console.log(`  ${m.text()}`);
  });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForFunction(() => Boolean(window.spike));
  return p;
}
let page = await freshPage();

/* ------------------------------------------------------------------- run */

const results = [];
for (const c of cases) {
  const sourcePath = c.real ? join(realDir, c.file) : join(CLIP_DIR, c.clip);
  const sourceUrl = c.real ? `/real/${encodeURIComponent(c.file)}` : `/clip/${c.clip}`;
  const outName = `${c.name}.mp4`;
  const record = { case: c.name, kind: c.kind, real: Boolean(c.real), ranges: c.ranges ?? [[c.inS, c.outS]] };
  console.log(`\n== ${c.name}${c.real ? ` (${c.file})` : ''}`);
  try {
    if (c.kind === 'editlist') {
      const r = await within(page.evaluate((o) => window.spike.editListCut(o), { url: sourceUrl, name: outName, inS: c.inS, outS: c.outS }));
      record.cut = r;
      const out = join(outDir, outName);
      const probe = probeVideo(out);
      record.ffprobe = { packets: probe.packets, duration: probe.duration, firstPts: probe.times[0] };
      // What each consumer shows as the first picture / how many frames it gives.
      const { barcodes } = await import('./verify-cut.mjs');
      const codes = barcodes(out);
      record.ffmpegDecoded = { frames: codes.length, first: codes[0]?.frame, expectedFirst: Math.round(c.inS * c.fps) };
      const decoded = await within(page.evaluate((o) => window.spike.decodeAll(o), { url: `/out/${outName}` }));
      record.webcodecs = { frames: decoded.length, first: decoded[0] };
      const play = await within(page.evaluate((o) => window.spike.playCheck(o), {
        url: `/out/${outName}`,
        times: [0, 0.5 / c.fps, 1.5 / c.fps],
        codedWidth: 1920,
        codedHeight: 1080,
        rotation: 0,
        play: true,
      }));
      record.video = {
        duration: play.duration,
        seeks: play.seeks,
        playedFirst: play.played?.frames.slice(0, 5),
        presented: play.played?.presented,
        ended: play.played?.ended,
        errors: play.errors,
      };
      console.log(JSON.stringify(record, null, 1));
      results.push(record);
      continue;
    }

    const r = await within(page.evaluate((o) => window.spike.fastCut(o), {
      url: sourceUrl,
      name: outName,
      ranges: c.ranges,
      fps: c.fps,
      variant: c.variant,
    }));
    record.cut = { ...r, segments: r.segments?.map(({ sourceTimesS, outputTimesS, ...rest }) => rest) };
    if (!r.ok) {
      console.log(`fallback: ${r.reason}`);
      results.push(record);
      continue;
    }
    console.log(
      `${r.method}: ${r.totalFrames} kare (kopya ${r.framesCopied}, kodlanan ${r.framesEncoded}), doğrulama ${r.verify}, ` +
        `${(r.ms.written / 1000).toFixed(2)} s yazma, ${(r.ms.verified / 1000).toFixed(2)} s toplam`,
    );
    const outPath = join(outDir, outName);
    const report = verifyCut({
      outputFile: outPath,
      sourceFile: sourcePath,
      result: r,
      fps: c.sourceFps ?? (c.real ? null : c.fps),
      barcode: !c.real,
      clicks: !c.real,
    });
    record.verify = report;
    for (const check of report.checks) console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.label} — ${check.detail}`);

    // <video>: seek to the first frame, both sides of every seam, the last frame.
    const times = [];
    const expected = [];
    const sourceFps = c.sourceFps ?? c.fps;
    for (const s of r.segments) {
      const marks = new Set([0, s.head - 1, s.head, s.head + s.copied - 1, s.head + s.copied, s.frames - 1]);
      for (const k of [...marks].filter((k) => k >= 0 && k < s.frames).sort((a, b) => a - b)) {
        const t0 = s.outputTimesS[k];
        const t1 = s.outputTimesS[k + 1] ?? t0 + 1 / sourceFps;
        times.push((t0 + t1) / 2);
        expected.push(Math.round(s.sourceTimesS[k] * sourceFps));
      }
    }
    const [w, h] = r.rotation % 180 === 0 ? [r.plan.segments[0].crop.width, r.plan.segments[0].crop.height] : [r.plan.segments[0].crop.height, r.plan.segments[0].crop.width];
    const play = await within(page.evaluate((o) => window.spike.playCheck(o), {
      url: `/out/${outName}`,
      times,
      codedWidth: w,
      codedHeight: h,
      rotation: r.rotation,
      play: true,
      // Real outputs are up to 2 minutes: played at 2x (still start to end).
      rate: c.real ? 2 : 1,
    }));
    const seekOk = c.real ? null : play.seeks.every((s, i) => s.frame === expected[i]);
    const playedFrames = play.played?.frames ?? [];
    record.video = {
      duration: play.duration,
      seeks: c.real ? play.seeks.length : play.seeks.map((s, i) => `${s.frame}${s.frame === expected[i] ? '' : `≠${expected[i]}`}`),
      seekOk,
      ended: play.played?.ended,
      presented: play.played?.presented,
      quality: play.played?.quality,
      // Played in order: every presented frame number is larger than the one before (synthetic only).
      monotonic: c.real ? null : playedFrames.every((v, i) => i === 0 || v >= playedFrames[i - 1]),
      errors: play.errors,
    };
    console.log(
      `  <video>: süre ${play.duration?.toFixed(3)} s, atlamalar ${seekOk === null ? `${play.seeks.length} (gerçek kayıt)` : seekOk ? 'doğru' : 'YANLIŞ'}, ` +
        `oynatma ${play.played?.ended ? 'sona vardı' : 'SONA VARMADI'} (${play.played?.presented} kare), hatalar ${play.errors.length}`,
    );
    if (!seekOk && seekOk !== null) console.log(`  seeks: ${record.video.seeks.join(' ')}`);
  } catch (error) {
    record.error = String(error).split('\n').slice(0, 3).join(' | ');
    console.log(`ERROR ${record.error}`);
    // A stuck page must not take the next case with it.
    await page.close().catch(() => undefined);
    page = await freshPage();
  } finally {
    if (!keep && record.real) rmSync(join(outDir, outName), { force: true });
  }
  results.push(record);
  // Written after every case, so a hang or crash keeps what was measured.
  writeFileSync(join(outDir, `spike-${label}.json`), `${JSON.stringify({ browser: label, ranAt: new Date().toISOString(), pageErrors, results }, null, 1)}\n`);
}

await browser.close();
server.close();
const summary = { browser: label, ranAt: new Date().toISOString(), pageErrors, results };
writeFileSync(join(outDir, `spike-${label}.json`), `${JSON.stringify(summary, null, 1)}\n`);
console.log(`\nsonuç: ${join(outDir, `spike-${label}.json`)}; sayfa hataları: ${pageErrors.length}`);
// Keep-alive connections from the browser would hold the server (and this process) open.
process.exit(0);
