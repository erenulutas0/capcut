/**
 * Runs the export pipeline against a folder of the user's own recordings.
 *
 * Synthetic fixtures cannot stand in for real phone footage: real VFR, real
 * rotation metadata, HEVC, 4K and long recordings behave differently. This
 * runner takes whatever is in the folder, builds two moments per file, exports
 * through the real editor and checks the result against an independent ffmpeg
 * reference, exactly like the doc 22 matrix does.
 *
 * Privacy: files are read locally and never uploaded. Result files record an
 * anonymous id and technical properties only — never the file name, which is
 * printed to the console so the person running it can map ids back locally.
 *
 *   node scripts/run-real-media.mjs                       # tests/media/real
 *   node scripts/run-real-media.mjs --dir=D:/telefon-videolari --browser=chrome
 *   node scripts/run-real-media.mjs --browser=chrome --sw-decode   # no GPU decoder
 *   node scripts/run-real-media.mjs --browser=chrome --native      # frame = the file's own shape/size
 *
 * `--native` (ADR-027): instead of the fixed 9:16 720p frame, each file is
 * exported in the frame that matches its own display shape, at 1080p when its
 * short edge is at least 1080 and 720p otherwise. A file whose size then IS
 * the download's size takes the fast cut; for those the result also records
 * which frames were copied bit for bit and the SSIM of the re-encoded ones.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

import { fastCutIdentity } from './lib/fast-cut-check.mjs';
import { createDriver } from './lib/matrix-driver.mjs';
import { ffprobeJson, runFfmpeg } from './lib/media-measure.mjs';

const COVER_9_16 = "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)',scale=720:1280";
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const MIN_SSIM = 0.85;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'matrix-results');
/**
 * Finds a running editor instead of assuming one port: the production server
 * used by the other scripts (:3100) or `npm run dev` (:3000). Without this,
 * every file failed with the same connection error and no hint why.
 */
async function findServer() {
  const candidates = process.env.SHOT_URL
    ? [process.env.SHOT_URL]
    : ['http://127.0.0.1:3100', 'http://127.0.0.1:3000'];
  for (const url of candidates) {
    try {
      const response = await fetch(`${url}/editor`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return url;
    } catch {
      // Not running here; try the next one.
    }
  }
  return null;
}

const baseURL = await findServer();
if (!baseURL) {
  console.error(
    'Editör sunucusu bulunamadı (3100 ve 3000 portlarına bakıldı).\n' +
      'Ayrı bir terminalde şunlardan birini çalıştırıp açık bırak, sonra bu komutu tekrarla:\n' +
      '  cd E:\\capcut_better\\web && npm run dev\n' +
      '  cd E:\\capcut_better\\web && npm run build && npx next start -p 3100',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const dirArg = argValue('dir', join(root, 'tests', 'media', 'real'));
const mediaDir = isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg);
const browserName = argValue('browser', 'chromium');
/** Keep the exported pieces of the user's footage for inspection. Off by default. */
const keepArtefacts = args.includes('--keep');
/**
 * Launch Chromium-family browsers without the GPU video decoder. A user
 * without hardware decoding gets FFmpeg's software H.264 decoder, which
 * behaved differently on real camera footage (ADR-014 §3).
 */
const swDecode = args.includes('--sw-decode');
const native = args.includes('--native');
/** Re-run a subset (file name substrings) into its own result file, e.g. --files=hdr --label=hdr. */
const fileFilter = argValue('files', '').split(',').filter(Boolean);
const extraLabel = argValue('label', '');
const runLabel = `${swDecode ? `${browserName}-swdecode` : browserName}${native ? '-native' : ''}${extraLabel ? `-${extraLabel}` : ''}`;
const chromiumArgs = swDecode ? ['--disable-accelerated-video-decode'] : [];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.3gp']);
const LAUNCHERS = {
  chromium: () => chromium.launch({ args: chromiumArgs }),
  chrome: () => chromium.launch({ channel: 'chrome', args: chromiumArgs }),
  edge: () => chromium.launch({ channel: 'msedge', args: chromiumArgs }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

mkdirSync(outDir, { recursive: true });

if (!existsSync(mediaDir)) {
  mkdirSync(mediaDir, { recursive: true });
}
/**
 * Extensions lie: phones and download tools write perfectly ordinary MP4s as
 * `.vid`, `.dat` or no extension at all. A file is included when it has a
 * known video extension OR when ffprobe finds a video stream in it.
 */
function hasVideoStream(path) {
  const probe = ffprobeJson(path);
  return Boolean(probe?.streams?.some((s) => s.codec_type === 'video'));
}

const skipped = [];
const files = readdirSync(mediaDir)
  .filter((name) => {
    const path = join(mediaDir, name);
    if (!statSync(path).isFile()) return false;
    if (VIDEO_EXTENSIONS.has(extname(name).toLowerCase())) return true;
    if (hasVideoStream(path)) return true;
    skipped.push(name);
    return false;
  })
  .sort();
// Ids stay those of the full, sorted folder listing, so R09 is R09 in every run.
const selectedFiles = new Set(files.filter((name) => fileFilter.length === 0 || fileFilter.some((f) => name.includes(f))));
if (skipped.length > 0) {
  console.log(`video içermediği için atlandı: ${skipped.length} dosya`);
}

if (files.length === 0) {
  console.log(
    `NOT_RUN: ${mediaDir} içinde video yok.\n` +
      'Kendi telefon/kamera kayıtlarını bu klasöre kopyala (klasör git dışında tutulur) ve tekrar çalıştır.\n' +
      'Farklı telefonlardan, dikey ve yatay, kısa ve uzun, mümkünse HEVC ve 4K kayıtlar en çok şeyi ortaya çıkarır.',
  );
  process.exit(0);
}

/** `MM:SS.mmm`, which is what the editor's time fields accept. */
function timecode(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** What ffprobe says about a file, reduced to what matters for the pipeline. */
function describe(path) {
  const probe = ffprobeJson(path);
  if (!probe) return null;
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const rotation =
    video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
    (video?.tags?.rotate ? Number(video.tags.rotate) : 0);
  const [rn, rd] = String(video?.r_frame_rate ?? '0/1').split('/').map(Number);
  const [an, ad] = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const rFps = rd ? rn / rd : 0;
  const avgFps = ad ? an / ad : 0;
  return {
    durationSeconds: Number(probe.format.duration),
    sizeMib: Number((Number(probe.format.size) / 1048576).toFixed(1)),
    container: probe.format.format_name,
    videoCodec: video?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    rotation: Number(rotation) || 0,
    fps: Number(avgFps.toFixed(3)),
    // A real VFR recording reports an average rate that differs from its
    // nominal rate; this is a hint, not proof.
    likelyVfr: rFps > 0 && avgFps > 0 && Math.abs(rFps - avgFps) / rFps > 0.01,
    colorTransfer: video?.color_transfer ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: audio ? Number(audio.sample_rate) : null,
  };
}

/** Two moments well inside the recording, so edges do not dominate. */
function momentsFor(duration) {
  if (!Number.isFinite(duration) || duration < 1.5) {
    const end = Math.max(0.3, (duration || 1) * 0.9);
    return [[0, end]];
  }
  const length = Math.max(0.5, Math.min(4, duration * 0.2));
  const first = duration * 0.1;
  const second = duration * 0.55;
  return [
    [first, first + length],
    [second, Math.min(duration - 0.05, second + length)],
  ];
}

/** Source audio RMS over the chosen ranges, measured independently. */
function sourceRangesRmsDb(path, trims) {
  const parts = trims
    .map(([a, b], i) => `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS[a${i}]`)
    .join(';');
  const labels = trims.map((_, i) => `[a${i}]`).join('');
  const graph = `${parts};${labels}concat=n=${trims.length}:v=0:a=1,astats=metadata=1:reset=0`;
  const output = runFfmpeg(['-i', path, '-filter_complex', graph, '-f', 'null', '-']);
  const values = [...output.matchAll(/RMS level dB:\s*(-?[0-9.]+|-inf)/g)].map((m) =>
    m[1] === '-inf' ? -Infinity : Number(m[1]),
  );
  return values.length > 0 ? Math.max(...values) : NaN;
}

function outputRmsDb(path) {
  const output = runFfmpeg(['-i', path, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-']);
  const values = [...output.matchAll(/RMS level dB:\s*(-?[0-9.]+|-inf)/g)].map((m) =>
    m[1] === '-inf' ? -Infinity : Number(m[1]),
  );
  return values.length > 0 ? Math.max(...values) : NaN;
}

const { drive, assess } = createDriver({ mediaDir, outDir, baseURL });

const browser = await LAUNCHERS[browserName]();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const results = [];

console.log(`${files.length} kayıt, tarayıcı: ${runLabel}, sunucu: ${baseURL}\n`);

for (const [index, fileName] of files.entries()) {
  if (!selectedFiles.has(fileName)) continue;
  const id = `R${String(index + 1).padStart(2, '0')}`;
  const path = join(mediaDir, fileName);
  const properties = describe(path);
  // The file name goes to the console only, never into a result file.
  console.log(`${id} = ${fileName}`);

  const trims = momentsFor(properties?.durationSeconds ?? NaN);
  const expectedSeconds = trims.reduce((sum, [a, b]) => sum + (b - a), 0);
  const hdr = HDR_TRANSFERS.has(properties?.colorTransfer ?? '');

  // --native: the frame that matches the file (display orientation), 1080p or 720p.
  let frame = { aspect: '9-16', quality: '720', size: [720, 1280], filter: COVER_9_16 };
  if (native && properties?.width && properties?.height) {
    const quarter = Math.abs(properties.rotation) % 180 === 90;
    const dw = quarter ? properties.height : properties.width;
    const dh = quarter ? properties.width : properties.height;
    const q = Math.min(dw, dh) >= 1080 ? 1080 : 720;
    const long = Math.round((q * 16) / 9 / 2) * 2;
    if (dw > dh * 1.05) {
      frame = { aspect: '16-9', quality: String(q), size: [long, q], filter: `crop=w='min(iw,ih*16/9)':h='min(ih,iw*9/16)',scale=${long}:${q}` };
    } else if (dh > dw * 1.05) {
      frame = { aspect: '9-16', quality: String(q), size: [q, long], filter: `crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)',scale=${q}:${long}` };
    } else {
      frame = { aspect: '1-1', quality: String(q), size: [q, q], filter: `crop=w='min(iw,ih)':h='min(iw,ih)',scale=${q}:${q}` };
    }
  }

  const testCase = {
    id,
    title: 'gerçek kayıt',
    expectation: 'Doğru çıktı veya açık ret; sessiz yanlış başarı yok',
    setup: {
      video: fileName,
      moments: trims.map(([a, b]) => [timecode(a), timecode(b)]),
      aspect: frame.aspect,
      quality: frame.quality,
    },
    expect: {
      // Import refusal (policy or unplayable) and gate refusal are acceptable
      // outcomes; they are recorded as such, not as passes of the export.
      exportsOrBlocks: true,
      durationSeconds: Number(expectedSeconds.toFixed(3)),
      size: frame.size,
      videoCodec: 'h264',
      ...(properties?.audioCodec ? { audioCodec: 'aac' } : {}),
      // Cover-crop to 9:16 from whatever orientation ffmpeg decodes to. An HDR
      // source gets its reference below instead: tone mapped by the standard
      // operator nearest to the output (ADR-022), never raw PQ/HLG.
      ...(hdr ? { hdrColors: { filter: frame.filter, trims } } : { reference: { filter: frame.filter, trims } }),
      // Real footage with motion goes through two lossy encodes; a wrong range
      // or a wrong crop lands far below this.
      minSsim: MIN_SSIM,
    },
  };

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const artefactPath = join(outDir, `${id}-${runLabel}.mp4`);

  let record;
  try {
    const driveResult = await drive(page, testCase, artefactPath);
    const { checks, measured } = assess(testCase, driveResult, artefactPath);

    // Real content has no known tone, so compare loudness against the source
    // over the same ranges: dropped or wildly wrong audio shows up here.
    if (driveResult.exported && properties?.audioCodec) {
      const source = sourceRangesRmsDb(path, trims);
      const produced = outputRmsDb(artefactPath);
      measured.audioRmsDb = { source: Number(source.toFixed(1)), output: Number(produced.toFixed(1)) };
      // A track can exist and still be digital silence in the chosen ranges
      // (found on a real recording). Then the right result is silence too;
      // comparing -Infinity with -Infinity would otherwise yield NaN.
      const SILENT_DB = -90;
      const sourceSilent = !Number.isFinite(source) || source < SILENT_DB;
      const outputSilent = !Number.isFinite(produced) || produced < SILENT_DB;
      checks.push(
        sourceSilent
          ? {
              label: 'kaynak bu aralıklarda sessiz; çıktı da sessiz',
              ok: outputSilent,
              detail: `kaynak ${source.toFixed(1)} dB, çıktı ${produced.toFixed(1)} dB`,
            }
          : {
              label: 'ses seviyesi kaynağa yakın (±3 dB, güvenlik kazancı dahil)',
              ok: Number.isFinite(produced) && Math.abs(produced - source) <= 3,
              detail: `kaynak ${source.toFixed(1)} dB, çıktı ${produced.toFixed(1)} dB`,
            },
      );
    }
    // ADR-027: a fast cut must copy every frame it did not re-encode bit for
    // bit, at the cut offset, and re-encode the rest well.
    if (driveResult.exported && (measured.method === 'copy' || measured.method === 'smart')) {
      const identity = fastCutIdentity({ outputFile: artefactPath, sourceFile: path, moments: trims });
      const encoded = driveResult.reported?.framesEncoded ?? NaN;
      measured.fastCut = {
        method: measured.method,
        frames: identity.frames,
        identical: identity.identical,
        differing: identity.differing,
        framesEncodedReported: encoded,
        seamSsimMin: identity.ssimMin === null ? null : Number(identity.ssimMin.toFixed(4)),
        seamSsimMean: identity.ssimMean === null ? null : Number(identity.ssimMean.toFixed(4)),
        offsetSpreadMs: identity.offsetSpreadMs,
      };
      checks.push({
        label: 'hızlı kesim: kodlanmayan her kare kaynakla bit bit aynı (framemd5)',
        ok: identity.differing <= encoded && identity.identical === identity.frames - identity.differing,
        detail: `${identity.identical}/${identity.frames} aynı, farklı ${identity.differing}, bildirilen kodlanan ${encoded}`,
      });
      checks.push({
        // One tick of a phone's 1/600 s clock is 1.67 ms.
        label: 'hızlı kesim: kopyalanan karelerin zamanı kaynakla aynı kaymada (≤ 1,7 ms)',
        ok: identity.offsetSpreadMs !== null && identity.offsetSpreadMs <= 1.7,
        detail: `yayılım ${identity.offsetSpreadMs} ms`,
      });
      if (identity.ssimMin !== null) {
        checks.push({
          label: `hızlı kesim: yeniden kodlanan kareler SSIM ≥ ${MIN_SSIM}`,
          ok: identity.ssimMin >= MIN_SSIM && identity.ssim.length === identity.differing,
          detail: `en düşük ${identity.ssimMin.toFixed(4)}, ort. ${identity.ssimMean.toFixed(4)} (${identity.ssim.length} kare)`,
        });
      }
    }
    checks.push({ label: 'sayfada JS hatası yok', ok: pageErrors.length === 0, detail: pageErrors.join(' | ') });

    const ok = checks.every((c) => c.ok);
    // A controlled stop during export (e.g. the decoder lost frames) is an honest
    // result, but it is not a working export — never report it as PASS.
    const refused =
      measured.outcome === 'import_rejected' ||
      measured.outcome === 'gate_blocked' ||
      measured.outcome === 'failed';
    record = {
      id,
      status: ok ? (refused ? 'REFUSED' : 'PASS') : 'FAIL',
      properties,
      moments: trims.map(([a, b]) => [Number(a.toFixed(3)), Number(b.toFixed(3))]),
      measured,
      // Refusal reasons are app copy, which never contains the file name.
      checks,
    };
  } catch (error) {
    record = { id, status: 'ERROR', properties, error: String(error).split('\n')[0].slice(0, 200), checks: [] };
  } finally {
    await page.close();
    // The exported piece and the ffmpeg reference are copies of the user's own
    // footage. They are only needed for the checks above, so they do not stay
    // on disk unless explicitly asked for.
    if (!keepArtefacts) {
      rmSync(artefactPath, { force: true });
      rmSync(join(outDir, `${id}-reference.mp4`), { force: true });
      // HDR sources: one tone-mapped reference per operator (ADR-022).
      for (const name of readdirSync(outDir)) {
        if (name.startsWith(`${id}-hdrref-`)) rmSync(join(outDir, name), { force: true });
      }
    }
  }

  results.push(record);
  const p = record.properties;
  console.log(
    `${record.status.padEnd(8)} ${id}  ` +
      (p
        ? `${p.videoCodec} ${p.width}x${p.height} rot${p.rotation} ${p.fps}fps${p.likelyVfr ? ' VFR?' : ''} ` +
          `${p.durationSeconds.toFixed(1)}s ${p.sizeMib}MiB ${p.colorTransfer ?? ''} ${p.audioCodec ?? 'sessiz'}`
        : 'ffprobe açamadı') +
      (record.measured?.method
        ? `  → ${record.measured.method}${record.measured.fallbackReason ? ` (${record.measured.fallbackReason})` : ''}`
        : ''),
  );
  for (const check of record.checks ?? []) {
    console.log(`         ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  if (record.error) console.log(`         ! ${record.error}`);
}

await context.close();
await browser.close();

const summary = {
  browser: browserName,
  softwareDecodeOnly: swDecode,
  ranAt: new Date().toISOString(),
  files: results.length,
  totals: {
    pass: results.filter((r) => r.status === 'PASS').length,
    refused: results.filter((r) => r.status === 'REFUSED').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    error: results.filter((r) => r.status === 'ERROR').length,
  },
  results,
};
writeFileSync(join(outDir, `real-media-${runLabel}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `\n${runLabel}: ${summary.totals.pass} PASS,${summary.totals.refused} REFUSED, ` +
    `${summary.totals.fail} FAIL, ${summary.totals.error} ERROR`,
);
process.exit(summary.totals.fail + summary.totals.error === 0 ? 0 : 1);
