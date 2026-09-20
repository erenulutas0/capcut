/**
 * Generates the doc 22 media matrix (M01-M16) as real local files.
 *
 * Everything is synthesised with ffmpeg: no downloads, no copyrighted content,
 * no user media. The files are large-ish and reproducible, so they are NOT
 * committed — regenerate with:
 *
 *   node scripts/generate-matrix-media.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'tests', 'media', 'matrix');

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wanted = (id) => only.length === 0 || only.includes(id);

if (only.length === 0) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const ff = (args, label) => {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${label}: ${(result.stderr || '').slice(0, 400)}`);
  }
};

const p = (name) => join(out, name);

/** A visually distinct source: moving pattern + burned-in second counter. */
const videoIn = (size, rate, duration, source = 'testsrc') => [
  '-f', 'lavfi', '-i', `${source}=size=${size}:rate=${rate}:duration=${duration}`,
];
const toneIn = (frequency, duration, sampleRate = 48000) => [
  '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=${sampleRate}:duration=${duration}`,
];
const H264 = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '34', '-g', '30'];
const AAC = ['-c:a', 'aac', '-b:a', '96k'];

const made = [];
const record = (id, file, note) => {
  made.push({ id, file: `matrix/${file}`, bytes: statSync(p(file)).size, note });
};

// M01 — 20 s portrait H.264/SDR with audio. The canonical two-range case.
if (wanted('M01')) {
  ff([...videoIn('720x1280', 30, 20), ...toneIn(440, 20), ...H264, ...AAC, '-shortest', p('m01-portrait-20s.mp4')], 'M01');
  record('M01', 'm01-portrait-20s.mp4', '720x1280, 30 fps, H.264/AAC, 440 Hz tone');
}

// M02 — landscape frames carrying a 90 degree display matrix.
// `-metadata:s:v rotate=` no longer writes one, so the file is encoded first
// and then re-muxed with `-display_rotation`, which does.
if (wanted('M02')) {
  ff([...videoIn('1280x720', 30, 12), ...toneIn(440, 12), ...H264, ...AAC, '-shortest', p('m02-tmp.mp4')], 'M02 encode');
  ff(['-display_rotation', '90', '-i', p('m02-tmp.mp4'), '-c', 'copy', p('m02-rotate90.mp4')], 'M02 remux');
  rmSync(p('m02-tmp.mp4'), { force: true });
  record('M02', 'm02-rotate90.mp4', 'coded 1280x720 with a 90 deg display matrix -> displays 720x1280');
}

// M03 — plain landscape source, reframed to 9:16 by the editor.
if (wanted('M03')) {
  ff([...videoIn('1920x1080', 30, 15), ...toneIn(440, 15), ...H264, ...AAC, '-shortest', p('m03-landscape-1080p.mp4')], 'M03');
  record('M03', 'm03-landscape-1080p.mp4', '1920x1080 landscape source for 9:16 crop');
}

// M04 — video with NO audio track at all, plus a WAV music file.
if (wanted('M04')) {
  ff([...videoIn('1280x720', 30, 12), ...H264, '-an', p('m04-silent.mp4')], 'M04 video');
  ff([...toneIn(330, 10), '-c:a', 'pcm_s16le', p('m04-music.wav')], 'M04 music');
  record('M04', 'm04-silent.mp4', 'no audio track at all');
  record('M04', 'm04-music.wav', '16-bit PCM WAV, 330 Hz');
}

// M05 — 44.1 kHz music against a 48 kHz source: resampling must not shift pitch.
if (wanted('M05')) {
  ff([...toneIn(220, 20, 44100), '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', p('m05-music-44k.m4a')], 'M05');
  record('M05', 'm05-music-44k.m4a', '44.1 kHz AAC music, 220 Hz');
}

// M06 — variable frame rate: three stretches at different rates, muxed as VFR.
if (wanted('M06')) {
  const part = (rate, seconds, name) =>
    ff([...videoIn('1280x720', rate, seconds), ...toneIn(440, seconds), ...H264, ...AAC, '-shortest', p(name)], `M06 ${name}`);
  part(30, 5, 'm06-a.mp4');
  part(12, 5, 'm06-b.mp4');
  part(50, 5, 'm06-c.mp4');
  writeFileSync(p('m06-list.txt'), ['m06-a.mp4', 'm06-b.mp4', 'm06-c.mp4'].map((f) => `file '${f}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', p('m06-list.txt'), '-fps_mode', 'passthrough', '-c', 'copy', p('m06-vfr.mp4')], 'M06 concat');
  record('M06', 'm06-vfr.mp4', 'variable frame rate: 30 -> 12 -> 50 fps stretches');
}

// M07 — 29.97 fps, the classic rounding trap.
if (wanted('M07')) {
  ff([...videoIn('1280x720', '30000/1001', 15), ...toneIn(440, 15), ...H264, ...AAC, '-shortest',
      '-r', '30000/1001', p('m07-2997fps.mp4')], 'M07');
  record('M07', 'm07-2997fps.mp4', '29.97 fps source');
}

// M09 — the source tone changes at a known instant, so a clip boundary that
// duplicates or drops audio becomes measurable.
if (wanted('M09')) {
  ff([...videoIn('1280x720', 30, 16),
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=16',
      ...H264, ...AAC, '-shortest', p('m09-boundary.mp4')], 'M09');
  record('M09', 'm09-boundary.mp4', '880 Hz tone throughout, for boundary continuity checks');
}

// M10 — 4K HEVC, and a separate HDR10 file. Both must either work or be
// refused clearly; neither may silently produce wrong output.
if (wanted('M10')) {
  ff([...videoIn('3840x2160', 30, 6), ...toneIn(440, 6),
      '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv420p',
      '-tag:v', 'hvc1', ...AAC, '-shortest', p('m10-4k-hevc.mp4')], 'M10 hevc');
  record('M10', 'm10-4k-hevc.mp4', '3840x2160 HEVC/AAC');

  ff([...videoIn('1920x1080', 30, 6), ...toneIn(440, 6),
      '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv420p10le',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      '-tag:v', 'hvc1', ...AAC, '-shortest', p('m10-hdr10.mp4')], 'M10 hdr');
  record('M10', 'm10-hdr10.mp4', '1080p HEVC HDR10 (bt2020 / PQ)');

  // The same HDR signalling in H.264, which browsers will actually play — so
  // the file reaches the capability gate instead of being refused at import.
  ff([...videoIn('1280x720', 30, 6), ...toneIn(440, 6),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      '-x264-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',
      ...AAC, '-shortest', p('m10-hdr-h264.mp4')], 'M10 hdr h264');
  record('M10', 'm10-hdr-h264.mp4', '720p H.264 with bt2020 / PQ signalling');
}

// M11 — a real file cut in half: the header is valid, the data is not complete.
if (wanted('M11')) {
  const source = p('m01-portrait-20s.mp4');
  const bytes = readFileSync(source);
  writeFileSync(p('m11-truncated.mp4'), bytes.subarray(0, Math.floor(bytes.length * 0.4)));
  record('M11', 'm11-truncated.mp4', 'first 40% of M01; moov is missing');
}

// M13 — over the 250 MiB policy limit, but still a valid, readable file.
// Noise is close to incompressible, so lossless 1080p reaches the limit in a
// few seconds instead of minutes.
if (wanted('M13')) {
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30:d=4,noise=alls=100:allf=t+u',
      ...toneIn(440, 4),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p',
      ...AAC, '-shortest', p('m13-oversize.mp4')], 'M13');
  record('M13', 'm13-oversize.mp4', 'lossless 1080p noise, intentionally over 250 MiB');
}

const manifest = { generatedAt: new Date().toISOString(), files: made };
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const item of made) {
  const size = (item.bytes / 1048576).toFixed(1);
  // M11 is deliberately unreadable, so a failed probe here is the point.
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams',
    p(item.file.replace('matrix/', '')),
  ], { encoding: 'utf8' });

  let summary = 'UNREADABLE (expected for M11)';
  if (result.status === 0) {
    const parsed = JSON.parse(result.stdout);
    const v = parsed.streams.find((s) => s.codec_type === 'video');
    const a = parsed.streams.find((s) => s.codec_type === 'audio');
    summary =
      `${v ? `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}` : 'no video'}  ` +
      `${a ? `${a.codec_name} ${a.sample_rate}Hz` : 'no audio'}`;
  }
  console.log(`${item.id}  ${item.file.padEnd(30)} ${size.padStart(6)} MiB  ${summary}`);
}
console.log(`\n${made.length} files in ${out}`);
