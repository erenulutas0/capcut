/**
 * HDR spike analysis (docs/spikes/2026-09-23-hdr-tonemap.md).
 *
 *   node scripts/hdr-spike/analyze.mjs --stage=calibrate
 *       ffmpeg only: the primary reference, other legitimate tone-mapping
 *       operators and deliberately broken conversions, all measured against
 *       the primary reference. The thresholds are chosen from this table,
 *       before any browser frame is measured.
 *   node scripts/hdr-spike/analyze.mjs --stage=browsers --browsers=chrome,edge,chromium
 *       Measures the frames written by run-hdr-spike.mjs.
 *
 * Nothing here leaves the machine.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareRgb, meanLuma } from '../lib/color-metrics.mjs';
import { THRESHOLDS, round, summarize, verdict } from '../lib/hdr-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const stage = arg('stage', 'calibrate');
const mediaDir = resolve(arg('dir', join(webRoot, 'tests', 'media', 'real')));
const resultsRoot = resolve(arg('results', join(webRoot, 'hdr-spike-results')));
const refDir = join(resultsRoot, 'ref');
mkdirSync(refDir, { recursive: true });

export const FILES = {
  pq: { file: 'web-android-hevc-hdr10plus-pq-4k.mp4', times: [0.1, 0.5, 1.0], width: 960, height: 540 },
  hlg: { file: 'web-iphone12pro-hevc-hlg-dv-rot90.mov', times: [2, 6, 10, 14, 18], width: 540, height: 960 },
};
const onlyTags = arg('tags', null)?.split(',') ?? Object.keys(FILES);

/** Tone-map chains from the decoded source frame to bt709/tv yuv420p. */
const TONEMAP = (npl, op, extra = '') =>
  `zscale=t=linear:npl=${npl},format=gbrpf32le,zscale=p=bt709,tonemap=${op}:desat=0${extra},` +
  'zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

const TO_RGB_709 = (w, h) =>
  `scale=${w}:${h}:flags=bicubic:in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24`;
const TO_RGB_2020 = (w, h) =>
  `scale=${w}:${h}:flags=bicubic:in_color_matrix=bt2020:in_range=tv:out_range=pc,format=rgb24`;

/**
 * kind: 'primary' is the reference everything is measured against; 'legit'
 * are other standard operators (their spread is what a correct browser may
 * differ by); 'broken' are the failures the thresholds must reject.
 */
const VARIANTS = [
  { id: 'ref-hable', kind: 'primary', chain: (w, h) => `${TONEMAP(100, 'hable')},${TO_RGB_709(w, h)}` },
  { id: 'hable-npl203', kind: 'legit', chain: (w, h) => `${TONEMAP(203, 'hable')},${TO_RGB_709(w, h)}` },
  { id: 'mobius', kind: 'legit', chain: (w, h) => `${TONEMAP(100, 'mobius')},${TO_RGB_709(w, h)}` },
  { id: 'reinhard', kind: 'legit', chain: (w, h) => `${TONEMAP(100, 'reinhard')},${TO_RGB_709(w, h)}` },
  { id: 'mobius-npl203', kind: 'legit', chain: (w, h) => `${TONEMAP(203, 'mobius')},${TO_RGB_709(w, h)}` },
  {
    id: 'placebo-bt2390',
    kind: 'legit',
    vulkan: true,
    chain: (w, h) =>
      'libplacebo=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:' +
      `tonemapping=bt.2390:apply_dolbyvision=0:format=yuv420p,${TO_RGB_709(w, h)}`,
  },
  {
    id: 'placebo-spline',
    kind: 'legit',
    vulkan: true,
    chain: (w, h) =>
      'libplacebo=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:' +
      `tonemapping=spline:apply_dolbyvision=0:format=yuv420p,${TO_RGB_709(w, h)}`,
  },
  // Broken on purpose.
  // Decoded with the right matrix but no transfer or gamut conversion: what a
  // pipeline that ignores HDR signalling produces (washed out, desaturated).
  { id: 'broken-no-tonemap', kind: 'broken', chain: (w, h) => TO_RGB_2020(w, h) },
  // Tone-mapped correctly but the bt2020 primaries are never converted.
  {
    id: 'broken-no-gamut',
    kind: 'broken',
    chain: (w, h) =>
      'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable:desat=0,' +
      `zscale=t=bt709:m=bt709:r=tv,format=yuv420p,${TO_RGB_709(w, h)}`,
  },
  // Hard clip at SDR reference white instead of a roll-off.
  { id: 'broken-clip', kind: 'broken', chain: (w, h) => `${TONEMAP(203, 'clip')},${TO_RGB_709(w, h)}` },
  // Linear light shown without any transfer: very dark.
  { id: 'broken-linear', kind: 'broken', chain: (w, h) => `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=linear:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,lutyuv=y=16+(val-16)*0.35,${TO_RGB_709(w, h)}` },
  // Chroma offsets: a green and a purple cast of ~10 8-bit code values.
  {
    id: 'broken-green-cast',
    kind: 'broken',
    chain: (w, h) => `lutyuv=u=val-40:v=val-40,${TONEMAP(100, 'hable')},${TO_RGB_709(w, h)}`,
  },
  {
    id: 'broken-purple-cast',
    kind: 'broken',
    chain: (w, h) => `lutyuv=u=val+40:v=val+40,${TONEMAP(100, 'hable')},${TO_RGB_709(w, h)}`,
  },
  // The same casts at ~4 8-bit code values: the faintest one a viewer notices
  // on grey.
  {
    id: 'broken-green-cast-mild',
    kind: 'broken',
    chain: (w, h) => `lutyuv=u=val-16:v=val-16,${TONEMAP(100, 'hable')},${TO_RGB_709(w, h)}`,
  },
  {
    id: 'broken-purple-cast-mild',
    kind: 'broken',
    chain: (w, h) => `lutyuv=u=val+16:v=val+16,${TONEMAP(100, 'hable')},${TO_RGB_709(w, h)}`,
  },
  // Chroma planes swapped.
  {
    id: 'broken-uv-swap',
    kind: 'broken',
    chain: (w, h) => `shuffleplanes=0:2:1,${TONEMAP(100, 'hable')},${TO_RGB_709(w, h)}`,
  },
];

function ffmpeg(argv, { binary = false } = {}) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...argv], {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${argv.join(' ')}\n${binary ? result.stderr.toString() : result.stderr}`);
  }
  return result.stdout;
}

/** Presentation timestamps of every video frame, in presentation order. */
const ptsCache = new Map();
function framePts(file) {
  if (ptsCache.has(file)) return ptsCache.get(file);
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  const pts = result.stdout
    .split(/\r?\n/)
    .map((l) => Number.parseFloat(l))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  ptsCache.set(file, pts);
  return pts;
}

/** Index (presentation order) of the frame on screen at `t`. */
export function frameIndexAt(pts, t) {
  let index = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (pts[i] <= t + 1e-4) index = i;
    else break;
  }
  return index;
}

function renderVariant(tag, spec, t, index, variant) {
  const out = join(refDir, `${tag}-t${t}-${variant.id}.png`);
  if (existsSync(out)) return out;
  const src = join(mediaDir, spec.file);
  const pts = framePts(src)[index];
  const pre = variant.vulkan ? ['-init_hw_device', 'vulkan'] : [];
  // Seek a little before the frame and keep the original timestamps, then
  // pick exactly the frame with that presentation time.
  ffmpeg([
    '-y',
    ...pre,
    '-ss', String(Math.max(0, pts - 1)),
    '-copyts',
    '-i', src,
    '-an',
    '-vf', `select=gte(t\\,${(pts - 0.0005).toFixed(6)}),${variant.chain(spec.width, spec.height)}`,
    '-frames:v', '1',
    '-update', '1',
    out,
  ]);
  return out;
}

/** PNG (any size) -> packed rgb24 at w x h; cached per file and size. */
const rgbCache = new Map();
function readRgb(png, w, h) {
  const key = `${png}|${w}x${h}`;
  if (!rgbCache.has(key)) {
    rgbCache.set(
      key,
      ffmpeg(
        ['-i', png, '-vf', `scale=${w}:${h}:flags=bicubic,format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { binary: true },
      ),
    );
  }
  return rgbCache.get(key);
}

/** SSIM of the luma planes (ffmpeg's ssim filter on gray). */
function ssimY(refPng, outPng, w, h) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-i', refPng, '-i', outPng, '-lavfi',
      `[0]scale=${w}:${h}:flags=bicubic,format=gray[a];[1]scale=${w}:${h}:flags=bicubic,format=gray[b];[a][b]ssim`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  const match = `${result.stderr}`.match(/All:([0-9.]+)/);
  return match ? Number(match[1]) : NaN;
}

function measure(refPng, outPng, spec) {
  const ref = readRgb(refPng, spec.width, spec.height);
  const out = readRgb(outPng, spec.width, spec.height);
  return {
    ssimY: ssimY(refPng, outPng, spec.width, spec.height),
    ...compareRgb(ref, out),
    meanLuma: meanLuma(out),
  };
}

const LEGIT = VARIANTS.filter((v) => v.kind !== 'broken' && !(args.includes('--cpu-only') && v.vulkan));

/**
 * Measures `candidate` (t -> png) against the legitimate reference closest to
 * it over the whole file. `exclude` leaves one operator out (calibration).
 */
function againstNearest(tag, spec, candidate, exclude = null) {
  const pts = framePts(join(mediaDir, spec.file));
  let best = null;
  for (const ref of LEGIT) {
    if (ref.id === exclude) continue;
    let sum = 0;
    for (const t of spec.times) {
      const refPng = renderVariant(tag, spec, t, frameIndexAt(pts, t), ref);
      sum += compareRgb(readRgb(refPng, spec.width, spec.height), readRgb(candidate[t], spec.width, spec.height))
        .meanDeltaE00;
    }
    const mean = sum / spec.times.length;
    if (!best || mean < best.mean) best = { id: ref.id, mean };
  }
  const ref = LEGIT.find((v) => v.id === best.id);
  const rows = spec.times.map((t) => ({
    t,
    metrics: measure(renderVariant(tag, spec, t, frameIndexAt(pts, t), ref), candidate[t], spec),
  }));
  return { nearest: best.id, rows, worst: summarize(rows) };
}

const HEADER =
  'candidate | nearest | ssimY | ΔE00 | ΔE00 p95 | ΔL* | cast | sat min..max | vivid sat min..max | hue° | clipΔ | luma(min) | verdict';
function line(id, result) {
  const w = result.worst;
  const v = verdict(w);
  return (
    `${id} | ${result.nearest} | ${w.ssimY} | ${w.meanDeltaE00} | ${w.p95DeltaE00} | ${w.meanDeltaL} | ${w.cast} | ` +
    `${w.saturationRatioMin}..${w.saturationRatioMax} | ${w.vividSaturationRatioMin}..${w.vividSaturationRatioMax} | ${w.hueError} | ${w.clipDelta} | ${w.meanLuma} | ` +
    `${v.pass === null ? '—' : v.pass ? 'PASS' : `FAIL (${v.failures.join('; ')})`}`
  );
}

function calibrate() {
  const table = {};
  for (const tag of onlyTags) {
    const spec = FILES[tag];
    const pts = framePts(join(mediaDir, spec.file));
    table[tag] = {};
    console.log(`\n== ${tag} (leave-one-out: each variant against the nearest OTHER legitimate operator)`);
    console.log(HEADER);
    for (const variant of VARIANTS) {
      const candidate = Object.fromEntries(
        spec.times.map((t) => [t, renderVariant(tag, spec, t, frameIndexAt(pts, t), variant)]),
      );
      const result = againstNearest(tag, spec, candidate, variant.id);
      table[tag][variant.id] = { kind: variant.kind, ...result };
      console.log(line(`${variant.id} (${variant.kind})`, result));
    }
  }
  writeFileSync(join(resultsRoot, 'calibration.json'), JSON.stringify(table, null, 2));
}

/** Browser frames written by run-hdr-spike.mjs. */
function browsers() {
  const names = arg('browsers', 'chrome,edge,chromium').split(',');
  const out = {};
  for (const browser of names) {
    const dir = join(resultsRoot, browser);
    const reportPath = join(dir, 'report.json');
    if (!existsSync(reportPath)) {
      console.log(`\n== ${browser}: no report (${reportPath})`);
      continue;
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    out[browser] = { version: report.version, files: {} };
    console.log(`\n== ${browser} ${report.version}`);
    console.log(HEADER);
    for (const tag of onlyTags) {
      const spec = FILES[tag];
      const fileReport = report.files[spec.file];
      const pts = framePts(join(mediaDir, spec.file));
      const entry = { frameAlignment: [] };
      // The frame the browser decoded must be the frame the reference used.
      for (const f of fileReport?.worker?.frames ?? []) {
        if (typeof f.timestamp !== 'number') continue;
        let nearest = 0;
        for (let i = 0; i < pts.length; i += 1) {
          if (Math.abs(pts[i] - f.timestamp) < Math.abs(pts[nearest] - f.timestamp)) nearest = i;
        }
        entry.frameAlignment.push({
          t: f.requested,
          browserTs: f.timestamp,
          index: nearest,
          expected: frameIndexAt(pts, f.requested),
        });
      }
      for (const path of ['p1-draw', 'p2-preview', 'p3-videodraw', 'p6-softclip']) {
        const candidate = {};
        for (const t of spec.times) {
          const png = join(dir, `${tag}-t${t}-${path}.png`);
          if (existsSync(png)) candidate[t] = png;
        }
        if (Object.keys(candidate).length !== spec.times.length) {
          console.log(`${tag} ${path} | missing frames (${Object.keys(candidate).length}/${spec.times.length})`);
          entry[path] = null;
          continue;
        }
        const result = againstNearest(tag, spec, candidate);
        entry[path] = { ...result, verdict: verdict(result.worst) };
        console.log(line(`${tag} ${path}`, result));
      }
      // Preview (what the user watches) against the export path's own draw.
      // The export path is the float16 + soft clip draw (p6).
      const p1 = spec.times.map((t) => join(dir, `${tag}-t${t}-p6-softclip.png`));
      const p2 = spec.times.map((t) => join(dir, `${tag}-t${t}-p2-preview.png`));
      if ([...p1, ...p2].every((p) => existsSync(p))) {
        const rows = spec.times.map((t, i) => ({ t, metrics: measure(p1[i], p2[i], spec) }));
        entry.previewVsExport = summarize(rows);
        const w = entry.previewVsExport;
        console.log(
          `${tag} preview vs export | — | ${w.ssimY} | ${w.meanDeltaE00} | ${w.p95DeltaE00} | ${w.meanDeltaL} | ` +
            `${w.cast} | ${w.saturationRatioMin}..${w.saturationRatioMax} | ${w.hueError} | ${w.clipDelta} | ${w.meanLuma} |`,
        );
      }
      out[browser].files[tag] = entry;
    }
  }
  writeFileSync(join(resultsRoot, 'browsers.json'), JSON.stringify(out, null, 2));
}

if (stage === 'calibrate') calibrate();
else if (stage === 'browsers') browsers();

export { measure, readRgb, againstNearest, THRESHOLDS, round };

