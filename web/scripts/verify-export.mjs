/**
 * End-to-end W1 proof: drive the real editor, run a real export, save the file
 * the browser produced, and measure it with ffprobe.
 *
 * Nothing here trusts the app's own report — every number printed at the end
 * comes from ffprobe reading the produced MP4.
 *
 * Usage (server must be running on :3100):
 *   node scripts/verify-export.mjs              # bundled Chromium
 *   node scripts/verify-export.mjs --chrome     # installed Google Chrome
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'export-proof');
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const music = join(root, 'tests', 'media', 'tone-30s.m4a');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
const useChrome = process.argv.includes('--chrome');

mkdirSync(outDir, { recursive: true });

function ffprobe(file) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  return JSON.parse(raw.toString('utf8'));
}

const browser = await chromium.launch(useChrome ? { channel: 'chrome' } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();

const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));

// Requests that leave the machine would be a privacy failure, not just a bug.
const external = [];
page.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith(baseURL) && !url.startsWith('blob:') && !url.startsWith('data:')) {
    external.push(url);
  }
});

await page.goto(`${baseURL}/editor`);
await page.getByTestId('video-input').setInputFiles(sample);
await page.getByTestId('preview-video').waitFor();

// Two moments, deliberately not adjacent, so a naive "trim" cannot pass.
for (const [start, end] of [['00:00.000', '00:03.000'], ['00:12.000', '00:16.000']]) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}
await page.getByTestId('audio-input').setInputFiles(music);
await page.getByTestId('aspect-9-16').click();
await page.getByTestId('export-quality').waitFor({ state: 'attached' }).catch(() => {});

await page.getByTestId('open-export').click();
await page.getByTestId('export-quality').selectOption('720');

const startedAt = Date.now();
await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });

const gate = {
  environment: await page.getByTestId('gate-environment').textContent(),
  encoder: await page.getByTestId('gate-encoder').textContent(),
  selfTest: await page.getByTestId('gate-selftest').textContent(),
  source: await page.getByTestId('gate-source').textContent(),
};

await page.getByTestId('export-create').click();
await page.getByTestId('export-running').waitFor({ timeout: 20_000 });

// Sample the progress readout until a measured percentage actually appears.
let midProgress = null;
const progressSeen = [];
const pollUntil = Date.now() + 180_000;
while (Date.now() < pollUntil) {
  if ((await page.getByTestId('export-succeeded').count()) > 0) break;
  if ((await page.getByTestId('export-failed').count()) > 0) break;
  const text = await page.getByTestId('export-progress').textContent().catch(() => null);
  if (text && text.includes('%')) {
    progressSeen.push(text);
    midProgress = text;
  }
  await page.waitForTimeout(60);
}

await page.getByTestId('export-succeeded').waitFor({ timeout: 30_000 });
const elapsedMs = Date.now() - startedAt;

const reported = {
  duration: await page.getByTestId('measured-duration').textContent(),
  resolution: await page.getByTestId('measured-resolution').textContent(),
  codecs: await page.getByTestId('measured-codecs').textContent(),
  delta: await page.getByTestId('measured-delta').textContent(),
  route: await page.getByTestId('measured-route').textContent().catch(() => null),
};

const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
await page.getByTestId('export-download').click();
const download = await downloadPromise;
const savedAs = join(outDir, 'w1-export.mp4');
await download.saveAs(savedAs);

await context.close();
await browser.close();

/* ------------------------------------------------------- independent check */

/**
 * Build the same edit with ffmpeg and compare. If the browser had exported the
 * wrong source ranges, the wrong order, or the wrong crop, SSIM would collapse.
 * The crop numbers below are the plan's own: 9:16 cover over a 1280x720 source.
 */
const referencePath = join(outDir, 'reference-ffmpeg.mp4');
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', sample,
  '-filter_complex',
  '[0:v]trim=0:3,setpts=PTS-STARTPTS,crop=406:720:438:0,scale=720:1280,fps=30[v0];' +
  '[0:v]trim=12:16,setpts=PTS-STARTPTS,crop=406:720:438:0,scale=720:1280,fps=30[v1];' +
  '[v0][v1]concat=n=2:v=1:a=0[outv]',
  '-map', '[outv]', '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
  referencePath,
]);

/** ffmpeg reports both SSIM and astats on stderr, so capture it either way. */
function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function ssimAll(file) {
  const output = runFfmpeg([
    '-i', file, '-i', referencePath, '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-',
  ]);
  const match = /SSIM[^\n]*All:\s*([0-9.]+)/.exec(output);
  return match ? Number(match[1]) : NaN;
}

/** RMS level (dB) of one narrow band; used to prove both sources are audible. */
function bandRmsDb(file, frequency) {
  const output = runFfmpeg([
    '-i', file,
    '-af', `bandpass=f=${frequency}:width_type=h:w=25,astats=metadata=1:reset=0`,
    '-f', 'null', '-',
  ]);
  const matches = [...output.matchAll(/RMS level dB:\s*(-?[0-9.]+|-inf)/g)];
  const values = matches.map((m) => (m[1] === '-inf' ? -Infinity : Number(m[1])));
  return values.length > 0 ? Math.max(...values) : NaN;
}

/**
 * Per-moment audio check. A single whole-file measurement can hide a moment
 * that exported silently, because the other moment's tone dominates the RMS.
 */
function sliceAudio(file, args, outName) {
  const target = join(outDir, outName);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, ...args, '-vn', target]);
  return target;
}

const firstMomentWav = sliceAudio(savedAs, ['-t', '2.8'], 'moment-1.wav');
const secondMomentWav = sliceAudio(savedAs, ['-ss', '3.2'], 'moment-2.wav');
const firstMomentDb = bandRmsDb(firstMomentWav, 440);
const secondMomentDb = bandRmsDb(secondMomentWav, 440);

const ssim = ssimAll(savedAs);
const sourceToneDb = bandRmsDb(savedAs, 440); // the sample video's own 440 Hz tone
const musicToneDb = bandRmsDb(savedAs, 220); // the added 220 Hz music
const controlBandDb = bandRmsDb(savedAs, 3000); // neither source has energy here

const probe = ffprobe(savedAs);
const videoStream = probe.streams.find((s) => s.codec_type === 'video');
const audioStream = probe.streams.find((s) => s.codec_type === 'audio');
const sizeBytes = statSync(savedAs).size;
const durationSeconds = Number(probe.format.duration);

const expectedSeconds = 7; // [0,3) + [12,16)
const frameTolerance = 1 / 30 + 0.001;

const checks = [
  ['file is non-empty', sizeBytes > 10_000],
  ['container is mp4', String(probe.format.format_name).includes('mp4')],
  ['video codec is h264', videoStream?.codec_name === 'h264'],
  ['audio codec is aac', audioStream?.codec_name === 'aac'],
  ['resolution is 720x1280 (9:16)', videoStream?.width === 720 && videoStream?.height === 1280],
  [
    `duration is ${expectedSeconds}s within one frame`,
    Math.abs(durationSeconds - expectedSeconds) <= frameTolerance,
  ],
  ['has exactly one video and one audio stream', probe.streams.length === 2],
  ['frame count is 210 (7 s x 30 fps)', Number(videoStream?.nb_frames) === 210],
  [`picture matches the same edit built by ffmpeg (SSIM ${ssim.toFixed(4)} >= 0.90)`, ssim >= 0.9],
  [
    `source audio present at 440 Hz (${sourceToneDb.toFixed(1)} dB > control ${controlBandDb.toFixed(1)} dB)`,
    sourceToneDb - controlBandDb > 20,
  ],
  [
    `added music present at 220 Hz (${musicToneDb.toFixed(1)} dB > control ${controlBandDb.toFixed(1)} dB)`,
    musicToneDb - controlBandDb > 20,
  ],
  [
    `both moments carry source audio (${firstMomentDb.toFixed(1)} dB vs ${secondMomentDb.toFixed(1)} dB, within 6 dB)`,
    Math.abs(firstMomentDb - secondMomentDb) < 6,
  ],
  ['a measured progress percentage was shown', progressSeen.length > 0],
  ['no page errors', consoleErrors.length === 0],
  ['nothing left the machine', external.length === 0],
];

console.log('\n=== W1 export verification ===');
console.log(`browser        : ${useChrome ? 'Google Chrome (channel=chrome)' : 'Playwright Chromium'}`);
console.log(`capability gate: ${JSON.stringify(gate)}`);
console.log(`progress seen  : ${midProgress ?? '(none captured)'}`);
console.log(`app reported   : ${JSON.stringify(reported)}`);
console.log(`saved file     : ${savedAs}`);
console.log(`\n--- ffprobe (independent) ---`);
console.log(`format         : ${probe.format.format_name}`);
console.log(`duration       : ${durationSeconds.toFixed(6)} s`);
console.log(`size           : ${sizeBytes} bytes`);
console.log(`video          : ${videoStream?.codec_name} ${videoStream?.width}x${videoStream?.height} ` +
  `${videoStream?.r_frame_rate} fps, ${videoStream?.nb_frames ?? '?'} frames, profile ${videoStream?.profile}`);
console.log(`audio          : ${audioStream?.codec_name} ${audioStream?.sample_rate} Hz ` +
  `${audioStream?.channels} ch, ${audioStream?.nb_frames ?? '?'} packets`);
console.log(`wall clock     : ${(elapsedMs / 1000).toFixed(1)} s`);
console.log(`SSIM vs ffmpeg : ${ssim.toFixed(4)}`);
console.log(`440 Hz / 220 Hz / 3 kHz RMS: ${sourceToneDb.toFixed(1)} / ${musicToneDb.toFixed(1)} / ${controlBandDb.toFixed(1)} dB`);
console.log(`per-moment 440 Hz: ${firstMomentDb.toFixed(1)} dB | ${secondMomentDb.toFixed(1)} dB`);

console.log(`\n--- checks ---`);
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
}
if (consoleErrors.length > 0) console.log(`page errors: ${consoleErrors.join(' | ')}`);
if (external.length > 0) console.log(`external requests: ${external.join(' | ')}`);

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
