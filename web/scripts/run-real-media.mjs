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
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

import { createDriver } from './lib/matrix-driver.mjs';
import { ffprobeJson, runFfmpeg } from './lib/media-measure.mjs';

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

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.3gp']);
const LAUNCHERS = {
  chromium: () => chromium.launch(),
  chrome: () => chromium.launch({ channel: 'chrome' }),
  edge: () => chromium.launch({ channel: 'msedge' }),
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

console.log(`${files.length} kayıt, tarayıcı: ${browserName}, sunucu: ${baseURL}\n`);

for (const [index, fileName] of files.entries()) {
  const id = `R${String(index + 1).padStart(2, '0')}`;
  const path = join(mediaDir, fileName);
  const properties = describe(path);
  // The file name goes to the console only, never into a result file.
  console.log(`${id} = ${fileName}`);

  const trims = momentsFor(properties?.durationSeconds ?? NaN);
  const expectedSeconds = trims.reduce((sum, [a, b]) => sum + (b - a), 0);

  const testCase = {
    id,
    title: 'gerçek kayıt',
    expectation: 'Doğru çıktı veya açık ret; sessiz yanlış başarı yok',
    setup: {
      video: fileName,
      moments: trims.map(([a, b]) => [timecode(a), timecode(b)]),
      aspect: '9-16',
      quality: '720',
    },
    expect: {
      // Import refusal (policy or unplayable) and gate refusal are acceptable
      // outcomes; they are recorded as such, not as passes of the export.
      exportsOrBlocks: true,
      durationSeconds: Number(expectedSeconds.toFixed(3)),
      size: [720, 1280],
      videoCodec: 'h264',
      ...(properties?.audioCodec ? { audioCodec: 'aac' } : {}),
      reference: {
        // Cover-crop to 9:16 from whatever orientation ffmpeg decodes to.
        filter: "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)',scale=720:1280",
        trims,
      },
      // Real footage with motion goes through two lossy encodes; a wrong range
      // or a wrong crop lands far below this.
      minSsim: 0.85,
    },
  };

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const artefactPath = join(outDir, `${id}-${browserName}.mp4`);

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
    checks.push({ label: 'sayfada JS hatası yok', ok: pageErrors.length === 0, detail: pageErrors.join(' | ') });

    const ok = checks.every((c) => c.ok);
    const refused = measured.outcome === 'import_rejected' || measured.outcome === 'gate_blocked';
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
    }
  }

  results.push(record);
  const p = record.properties;
  console.log(
    `${record.status.padEnd(8)} ${id}  ` +
      (p
        ? `${p.videoCodec} ${p.width}x${p.height} rot${p.rotation} ${p.fps}fps${p.likelyVfr ? ' VFR?' : ''} ` +
          `${p.durationSeconds.toFixed(1)}s ${p.sizeMib}MiB ${p.colorTransfer ?? ''} ${p.audioCodec ?? 'sessiz'}`
        : 'ffprobe açamadı'),
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
writeFileSync(join(outDir, `real-media-${browserName}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `\n${browserName}: ${summary.totals.pass} PASS, ${summary.totals.refused} REFUSED, ` +
    `${summary.totals.fail} FAIL, ${summary.totals.error} ERROR`,
);
process.exit(summary.totals.fail + summary.totals.error === 0 ? 0 : 1);
