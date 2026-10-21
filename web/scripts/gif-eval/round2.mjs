/**
 * GIF quality, round 2 (ADR-046 addendum 2, 21 October 2026).
 *
 *   node scripts/gif-eval/round2.mjs --clips=<local.json> --phase=resample|transparency|sizes [--only=R1,S2] [--variant=mip] [--sharpen=0.25] [--t=3] [--tag=x]
 *
 * Unlike `evaluate.mjs` (round 1, frames drawn by ffmpeg's Lanczos), the
 * frames here are drawn by the BROWSER: Google Chrome via Playwright opens a
 * local page (`capture-page.ts`, served by this script on port 3193; nothing
 * leaves the machine) that decodes the video the GIF worker's way and draws
 * every size with every downscaling candidate. The phone-view reference is the
 * browser's own 1:1 frames, Lanczos-scaled by ffmpeg to a 1080-pixel short edge.
 *
 * `--clips` is a LOCAL file (never committed): [{ "id": "R1", "path": "..." }, …].
 * Recordings are read for measurement only; everything derived from them stays
 * in `web/.scratch/gif-eval/` (gitignored) and is deleted clip by clip; they are
 * named by their ids only. S1–S5 come from `evaluate.mjs`'s recipes (generated
 * there; run it once with `--set=method --cand=A` or let this script make them).
 *
 * Phases (the rule's steps):
 * - `resample`: 4 s, long edges 320 / 480 / 640, candidates high, medium, low, mip, box,
 *   and mip / box sharpened (0.25, 0.5); method A. Phone view (VMAF, VMAF NEG, SSIM, CAMBI), bytes, times.
 * - `transparency`: the chosen downscale (`--variant`, `--sharpen`), 480 / 640, 4 s (phone view and
 *   GIF-size metrics against the GIF's own input frames) and 10 s (bytes); T = 0, 2, 3, 4 and crop.
 * - `sizes`: the chosen method (`--variant`, `--sharpen`, `--t`, `--crop`), long edges 640 / 960 / 1280 / 1920,
 *   4 s (phone view, bytes) and 10 s (bytes, encode time); a size only for videos that reach it.
 */
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, appendFileSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..');
const outDir = join(webRoot, '.scratch', 'gif-eval');
const capDir = join(outDir, 'r2-cap');
const work = join(outDir, 'r2-work');
mkdirSync(capDir, { recursive: true });
mkdirSync(work, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const phase = args.phase ?? 'resample';
const only = args.only ? new Set(args.only.split(',')) : null;
const PORT = 3193;

// ------------------------------------------------------------------ bundles

const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [join(here, 'capture-page.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: join(work, 'capture.js'),
  tsconfig: join(webRoot, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
const nodeBundle = join(work, 'node.mjs');
await esbuild.build({
  stdin: {
    contents: "export * from './candidates.ts'; export { sharpen } from './resample.ts';",
    resolveDir: here,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: nodeBundle,
  tsconfig: join(webRoot, 'tsconfig.json'),
  logLevel: 'error',
});
const C = await import(pathToFileURL(nodeBundle).href + `?t=${Date.now()}`);

// ------------------------------------------------------------------ clips

const local = args.clips ? JSON.parse(readFileSync(args.clips, 'utf8')) : [];
const clips = [];
for (const id of ['S1', 'S2', 'S3', 'S4', 'S5']) {
  const path = join(outDir, 'media', `${id}.mp4`);
  if (!existsSync(path)) throw new Error(`${id}: run evaluate.mjs once to generate the synthetic sources`);
  clips.push({ id, kind: 'yapay', path, start: Number(args.synthStart ?? 0) });
}
for (const r of local) clips.push({ id: r.id, kind: r.kind ?? 'gercek', path: r.path, start: r.start ?? 0 });

// ------------------------------------------------------------------ server

const served = new Map();
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><title>gif-eval</title><script src="/capture.js"></script>');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/capture.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    createReadStream(join(work, 'capture.js')).pipe(res);
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const path = served.get(url.pathname.slice(7));
    if (!path) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': statSync(path).size });
    createReadStream(path).pipe(res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/put') {
    const name = url.searchParams.get('file') ?? '';
    if (!/^[\w.-]+$/.test(name)) return void res.writeHead(400).end();
    const out = createWriteStream(join(capDir, `${name}.rgba`), { flags: 'a' });
    req.pipe(out);
    out.on('finish', () => res.writeHead(204).end());
    out.on('error', () => res.writeHead(500).end());
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 300)));
await page.goto(`http://localhost:${PORT}/`);

async function capture(clip, job) {
  served.set(clip.id, clip.path);
  for (const f of listCaps(clip.id)) rmSync(f, { force: true });
  return page.evaluate((j) => globalThis.capture(j), { url: `/media/${clip.id}`, name: clip.id, startS: clip.start ?? 0, ...job });
}

function listCaps(id) {
  // Only files this script wrote for this clip.
  return ['full', ...[320, 480, 640, 960, 1280, 1920].flatMap((e) => ['high', 'medium', 'low', 'mip', 'mip2', 'box'].map((v) => `${e}-${v}`))]
    .map((k) => join(capDir, `${id}-${k}.rgba`))
    .filter((f) => existsSync(f));
}

function readFrames(file, width, height) {
  const frameBytes = width * height * 4;
  const size = statSync(file).size;
  const count = Math.floor(size / frameBytes);
  const fd = openSync(file, 'r');
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const f = new Uint8Array(frameBytes);
    readSync(fd, f, 0, frameBytes, i * frameBytes);
    frames.push(f);
  }
  closeSync(fd);
  return frames;
}

// ------------------------------------------------------------------ metrics

const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
const rawIn = (file, w, h, fmt = 'rgba') => ['-f', 'rawvideo', '-pix_fmt', fmt, '-s', `${w}x${h}`, '-framerate', '25', '-i', file];

function phoneSize(dw, dh) {
  const portrait = dh > dw;
  return portrait
    ? { pw: 1080, ph: Math.round((1080 * dh) / dw / 2) * 2 }
    : { pw: Math.round((1080 * dw) / dh / 2) * 2, ph: 1080 };
}

/** The phone-view reference: the browser's 1:1 frames, Lanczos to a 1080 short edge, yuv420p. */
async function makePhoneRef(clip, dw, dh) {
  const { pw, ph } = phoneSize(dw, dh);
  const ref = join(work, `${clip.id}-phone-${pw}x${ph}.yuv`);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...rawIn(join(capDir, `${clip.id}-full.rgba`), dw, dh), '-vf', `scale=${pw}:${ph}:flags=lanczos,format=yuv420p`, '-f', 'rawvideo', ref], { maxBuffer: 1 << 26 });
  const log = join(work, `${clip.id}-refcambi.json`);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...rawIn(ref, pw, ph, 'yuv420p'), ...rawIn(ref, pw, ph, 'yuv420p'), '-lavfi', `[0:v][1:v]libvmaf=feature='name=cambi':log_fmt=json:log_path='${esc(log)}':n_threads=8`, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const cambiRef = JSON.parse(readFileSync(log, 'utf8')).pooled_metrics.cambi.mean;
  rmSync(log, { force: true });
  return { ref, pw, ph, cambiRef };
}

async function decodeGif(gif) {
  const dec = gif.replace(/\.gif$/, '.dec.rgba');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', gif, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', dec], { maxBuffer: 1 << 26 });
  return dec;
}

async function phoneMetrics(dec, w, h, phone) {
  const log = `${dec}.tel.json`;
  const graph =
    `[0:v]scale=${phone.pw}:${phone.ph}:flags=bicubic,format=yuv420p,setpts=N/(25*TB),split[d1][d2];[1:v]setpts=N/(25*TB),split[r1][r2];` +
    `[d1][r1]ssim;[d2][r2]libvmaf=model='version=vmaf_v0.6.1\\:name=vmaf|version=vmaf_v0.6.1neg\\:name=neg':feature='name=cambi':log_fmt=json:log_path='${esc(log)}':n_threads=8`;
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', ...rawIn(dec, w, h), ...rawIn(phone.ref, phone.pw, phone.ph, 'yuv420p'), '-lavfi', graph, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const j = JSON.parse(readFileSync(log, 'utf8'));
  rmSync(log, { force: true });
  return {
    ssimTel: Number(/All:([0-9.]+)/.exec(stderr)?.[1] ?? NaN),
    vmafTel: j.pooled_metrics.vmaf.mean,
    negTel: j.pooled_metrics.neg.mean,
    dCambiTel: j.pooled_metrics.cambi.mean - phone.cambiRef,
  };
}

/** GIF against its own input frames (the encoding loss alone): SSIM, its 5th percentile per frame, VMAF. */
async function selfMetrics(dec, inputFile, w, h) {
  const log = `${dec}.self.json`;
  const stats = `${dec}.ssim.txt`;
  const graph =
    `[0:v]format=yuv444p,setpts=N/(25*TB),split[d1][d2];[1:v]format=yuv444p,setpts=N/(25*TB),split[r1][r2];` +
    `[d1][r1]ssim=stats_file='${esc(stats)}';[d2][r2]libvmaf=log_fmt=json:log_path='${esc(log)}':n_threads=8`;
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', ...rawIn(dec, w, h), ...rawIn(inputFile, w, h), '-lavfi', graph, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const perFrame = readFileSync(stats, 'utf8').split('\n').map((l) => Number(/All:([0-9.]+)/.exec(l)?.[1])).filter(Number.isFinite).sort((a, b) => a - b);
  const j = JSON.parse(readFileSync(log, 'utf8'));
  rmSync(log, { force: true });
  rmSync(stats, { force: true });
  return {
    ssim: Number(/All:([0-9.]+)/.exec(stderr)?.[1] ?? NaN),
    ssimP5: perFrame[Math.floor(perFrame.length * 0.05)] ?? NaN,
    vmaf: j.pooled_metrics.vmaf.mean,
  };
}

const D0 = { kind: 'none' };
const cand = (id, extra = {}) => ({ id, palette: 'global', dither: D0, tolerance: 0, delaysCs: [8], ...extra });

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const results = join(outDir, `r2-${phase}${args.tag ? `-${args.tag}` : ''}.jsonl`);
if (args.fresh) writeFileSync(results, '');

/**
 * Encodes `frames` with every candidate, measures, appends rows. `inputFile` = the frames' own file
 * (for GIF-size metrics). Sharpening, when asked, is applied here (and timed).
 */
async function measureSet({ clip, seconds, longEdge, variant, sharpenAmount, frames, width, height, captureMs, phone, self, cands, extra }) {
  let input = frames;
  let sharpenMs = 0;
  let inputFile = join(capDir, `${clip.id}-${longEdge}-${variant}.rgba`);
  if (sharpenAmount) {
    const t0 = performance.now();
    input = frames.map((f) => new Uint8Array(C.sharpen(f, width, height, sharpenAmount).buffer));
    sharpenMs = (performance.now() - t0) / frames.length;
    if (self) {
      inputFile = join(work, `${clip.id}-${longEdge}-${variant}-s.rgba`);
      writeFileSync(inputFile, Buffer.concat(input.map((f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength))));
    }
  }
  const decoded = new Map();
  for (const c of cands) {
    const encoded = C.encodeCandidate(input, width, height, c);
    const gif = join(work, `${clip.id}-${longEdge}-${variant}${sharpenAmount ? `-s${sharpenAmount}` : ''}-${seconds}-${c.id}.gif`);
    writeFileSync(gif, encoded.bytes);
    const row = {
      phase, clip: clip.id, kind: clip.kind, seconds, longEdge, width, height,
      variant: sharpenAmount ? `${variant}+s${sharpenAmount}` : variant, cand: c.id,
      bytes: encoded.bytes.length, encodeMs: Math.round(encoded.ms), captureMsPerFrame: captureMs + sharpenMs,
      frames: input.length, ...extra,
    };
    if (phone || self || c.crop || args.lossless) {
      const dec = await decodeGif(gif);
      const decFrames = Math.floor(statSync(dec).size / (width * height * 4));
      row.decodedFrames = decFrames;
      if (phone) Object.assign(row, await phoneMetrics(dec, width, height, phone));
      if (self) Object.assign(row, await selfMetrics(dec, inputFile, width, height));
      decoded.set(c.id, dec);
    }
    rmSync(gif, { force: true });
    appendFileSync(results, `${JSON.stringify(row)}\n`);
    console.log(
      `${clip.id} ${width}x${height} ${seconds}s ${row.variant.padEnd(10)} ${c.id.padEnd(8)} ${(row.bytes / 1e6).toFixed(2)} MB enc ${row.encodeMs} ms cap ${row.captureMsPerFrame.toFixed(1)} ms/f` +
        (row.negTel !== undefined ? ` tel ${row.vmafTel.toFixed(1)} neg ${row.negTel.toFixed(1)} ssimTel ${row.ssimTel.toFixed(4)} dCambi ${row.dCambiTel.toFixed(2)}` : '') +
        (row.ssim !== undefined ? ` self ssim ${row.ssim.toFixed(4)} p5 ${row.ssimP5.toFixed(4)} vmaf ${row.vmaf.toFixed(1)}` : '') +
        (row.decodedFrames !== undefined && row.decodedFrames !== input.length ? ` FRAMES ${row.decodedFrames}/${input.length}` : ''),
    );
  }
  // Crop must be lossless: its decoded frames equal those of the same T without crop.
  for (const c of cands) {
    if (!c.crop || !c.cropOf) continue;
    const a = decoded.get(c.id);
    const b = decoded.get(c.cropOf);
    if (a && b) {
      const same = Buffer.compare(readFileSync(a), readFileSync(b)) === 0;
      appendFileSync(results, `${JSON.stringify({ phase, clip: clip.id, seconds, longEdge, check: 'crop-lossless', cand: c.id, of: c.cropOf, same })}\n`);
      console.log(`${clip.id} ${longEdge} ${seconds}s crop ${c.id} lossless vs ${c.cropOf}: ${same}`);
    }
  }
  for (const dec of decoded.values()) rmSync(dec, { force: true });
  if (sharpenAmount && self) rmSync(inputFile, { force: true });
}

// ------------------------------------------------------------------ phases

const variant = args.variant ?? 'high';
const sharpenAmount = args.sharpen ? Number(args.sharpen) : 0;
const tChosen = args.t ? Number(args.t) : 0;
const cropChosen = args.crop === '1';

for (const clip of clips) {
  if (only && !only.has(clip.id)) continue;
  const started = performance.now();
  if (phase === 'resample') {
    const longEdges = [320, 480, 640];
    const r = await capture(clip, { seconds: 4, longEdges, variants: ['high', 'medium', 'low', 'mip', 'box'], full: true });
    const phone = await makePhoneRef(clip, r.display.width, r.display.height);
    for (const longEdge of longEdges) {
      for (const v of ['high', 'medium', 'low', 'mip', 'box']) {
        const o = r.outputs[`${longEdge}-${v}`];
        const frames = readFrames(join(capDir, `${clip.id}-${longEdge}-${v}.rgba`), o.width, o.height);
        const amounts = v === 'mip' || v === 'box' ? [0, 0.25, 0.5] : [0];
        for (const amount of amounts) {
          await measureSet({
            clip, seconds: 4, longEdge, variant: v, sharpenAmount: amount, frames, width: o.width, height: o.height,
            captureMs: median(o.msPerFrame), phone, self: false, cands: [cand('A')],
            extra: { display: r.display, missing: r.missing, captureMsMax: Math.max(...o.msPerFrame) },
          });
        }
      }
    }
    rmSync(phone.ref, { force: true });
  } else if (phase === 'resample2') {
    // Amendment of 21 Oct (ADR-046 addendum 2): sharpening on today's downscale, main and hold-out sets.
    const longEdges = [320, 480, 640];
    const r = await capture(clip, { seconds: 4, longEdges, variants: ['high'], full: true });
    const phone = await makePhoneRef(clip, r.display.width, r.display.height);
    for (const longEdge of longEdges) {
      const o = r.outputs[`${longEdge}-high`];
      const frames = readFrames(join(capDir, `${clip.id}-${longEdge}-high.rgba`), o.width, o.height);
      for (const amount of [0, 0.25, 0.5]) {
        await measureSet({
          clip, seconds: 4, longEdge, variant: 'high', sharpenAmount: amount, frames, width: o.width, height: o.height,
          captureMs: median(o.msPerFrame), phone, self: false, cands: [cand('A')],
          extra: { display: r.display, missing: r.missing, start: clip.start ?? 0 },
        });
      }
    }
    rmSync(phone.ref, { force: true });
  } else if (phase === 'resample3') {
    // Second amendment of 21 Oct (ADR-046 addendum 2): one extra drawing level (mip2), sharpened or not.
    const longEdges = [320, 480, 640];
    const r = await capture(clip, { seconds: 4, longEdges, variants: ['high', 'mip2'], full: true });
    const phone = await makePhoneRef(clip, r.display.width, r.display.height);
    for (const longEdge of longEdges) {
      for (const v of ['high', 'mip2']) {
        const o = r.outputs[`${longEdge}-${v}`];
        const frames = readFrames(join(capDir, `${clip.id}-${longEdge}-${v}.rgba`), o.width, o.height);
        for (const amount of v === 'high' ? [0] : [0, 0.25, 0.5]) {
          await measureSet({
            clip, seconds: 4, longEdge, variant: v, sharpenAmount: amount, frames, width: o.width, height: o.height,
            captureMs: median(o.msPerFrame), phone, self: false, cands: [cand('A')],
            extra: { display: r.display, missing: r.missing, start: clip.start ?? 0 },
          });
        }
      }
    }
    rmSync(phone.ref, { force: true });
  } else if (phase === 'transparency') {
    const longEdges = [480, 640];
    const cands = [
      cand('T0'), cand('T2', { tolerance: 2 }), cand('T3', { tolerance: 3 }), cand('T4', { tolerance: 4 }),
      cand('T0c', { crop: true, cropOf: 'T0' }), cand('T3c', { tolerance: 3, crop: true, cropOf: 'T3' }),
    ];
    for (const seconds of [4, 10]) {
      const r = await capture(clip, { seconds, longEdges, variants: [variant], full: seconds === 4 });
      if (seconds === 10 && r.frames < 120) {
        console.log(`${clip.id}: shorter than 10 s, skipped for 10 s`);
        continue;
      }
      const phone = seconds === 4 ? await makePhoneRef(clip, r.display.width, r.display.height) : null;
      for (const longEdge of longEdges) {
        const o = r.outputs[`${longEdge}-${variant}`];
        const frames = readFrames(join(capDir, `${clip.id}-${longEdge}-${variant}.rgba`), o.width, o.height);
        await measureSet({
          clip, seconds, longEdge, variant, sharpenAmount, frames, width: o.width, height: o.height,
          captureMs: median(o.msPerFrame), phone, self: seconds === 4, cands, extra: { display: r.display },
        });
      }
      if (phone) rmSync(phone.ref, { force: true });
    }
  } else if (phase === 'sizes') {
    const all = [640, 960, 1280, 1920];
    const c = cand(`T${tChosen}${cropChosen ? 'c' : ''}`, { tolerance: tChosen, crop: cropChosen });
    for (const seconds of [4, 10]) {
      // Only the sizes the video reaches (never enlarged), probed from the first capture.
      const probe = await capture(clip, { seconds: 0.2, longEdges: [640], variants: ['high'], full: false });
      const longest = Math.max(probe.display.width, probe.display.height);
      const longEdges = all.filter((e) => e <= longest);
      const r = await capture(clip, { seconds, longEdges, variants: [variant], full: seconds === 4 });
      if (seconds === 10 && r.frames < 120) {
        console.log(`${clip.id}: shorter than 10 s, skipped for 10 s`);
        continue;
      }
      const phone = seconds === 4 ? await makePhoneRef(clip, r.display.width, r.display.height) : null;
      for (const longEdge of longEdges) {
        const o = r.outputs[`${longEdge}-${variant}`];
        const frames = readFrames(join(capDir, `${clip.id}-${longEdge}-${variant}.rgba`), o.width, o.height);
        await measureSet({
          clip, seconds, longEdge, variant, sharpenAmount, frames, width: o.width, height: o.height,
          captureMs: median(o.msPerFrame), phone, self: false, cands: [c], extra: { display: r.display, longest },
        });
      }
      if (phone) rmSync(phone.ref, { force: true });
    }
  }
  for (const f of listCaps(clip.id)) rmSync(f, { force: true });
  console.log(`${clip.id} done in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

await browser.close();
server.close();
