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
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
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
  // The former 8-bit H.264 file "with PQ signalling" (a mislabelled SDR
  // pattern) is gone: M10-hdr now uses real 10-bit HDR content, below.
}

// M10-hdr-pq / M10-hdr-hlg — real 10-bit HDR content that every Chromium can
// decode (VP9 profile 2, software libvpx), so the HDR -> SDR path of ADR-022
// is testable without phone files or an HEVC decoder. A moving SDR pattern is
// placed in HDR the standard way (SDR white = 203 cd/m², ITU-R BT.2408), plus
// a neutral 1000 cd/m² box, so a clipping or non-tone-mapping conversion
// shows. The HLG clip is coded landscape with a 90° display matrix.
const hdrClip = (transfer, name, rotate) => {
  const toHdr = (npl) =>
    `format=gbrpf32le,zscale=tin=iec61966-2-1:pin=bt709:min=gbr:rin=pc:t=linear:p=bt709:m=gbr:r=pc:npl=${npl},` +
    `zscale=p=bt2020:t=${transfer}:m=2020_ncl:r=limited:npl=${npl},format=yuv420p10le`;
  const graph =
    `[0:v]${toHdr(203)}[base];` +
    `color=c=white:size=288x160:rate=30:duration=4,${toHdr(1000)}[box];` +
    '[base][box]overlay=x=W*0.72:y=H*0.08:format=yuv420p10,' +
    // libvpx takes the colour tags from the frames, not from -color_trc.
    `setparams=color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc:range=tv[v]`;
  const tmp = p(`${name}.tmp.mp4`);
  ff([...videoIn('1280x720', 30, 4, 'testsrc2'), ...toneIn(440, 4),
      '-filter_complex', graph, '-map', '[v]', '-map', '1:a',
      '-c:v', 'libvpx-vp9', '-profile:v', '2', '-pix_fmt', 'yuv420p10le', '-b:v', '0', '-crf', '30',
      '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-g', '30',
      '-color_primaries', 'bt2020', '-color_trc', transfer, '-colorspace', 'bt2020nc', '-color_range', 'tv',
      ...AAC, '-shortest', rotate ? tmp : p(name)], `M10 ${transfer}`);
  if (rotate) {
    ff(['-display_rotation', '90', '-i', tmp, '-c', 'copy', p(name)], `M10 ${transfer} remux`);
    rmSync(tmp, { force: true });
  }
};
if (wanted('M10-hdr')) {
  hdrClip('smpte2084', 'm10-hdr-pq-vp9.mp4', false);
  record('M10', 'm10-hdr-pq-vp9.mp4', '1280x720 VP9 profile 2, 10-bit bt2020 / PQ, 4 s, 1000 cd/m² box');
  hdrClip('arib-std-b67', 'm10-hdr-hlg-vp9-rot90.mp4', true);
  record('M10', 'm10-hdr-hlg-vp9-rot90.mp4', 'coded 1280x720 VP9 profile 2, 10-bit bt2020 / HLG, 90° display matrix');
}

// M11 — a real file cut in half: the header is valid, the data is not complete.
if (wanted('M11')) {
  const source = p('m01-portrait-20s.mp4');
  const bytes = readFileSync(source);
  writeFileSync(p('m11-truncated.mp4'), bytes.subarray(0, Math.floor(bytes.length * 0.4)));
  record('M11', 'm11-truncated.mp4', 'first 40% of M01; moov is missing');
}

// M13 — over the 2 GiB policy limit (doc 15 v2), but still a valid, readable
// file. Encoding 2 GiB of real frames would take minutes, so a short clip is
// followed by a top-level `free` box: ISO BMFF readers skip it, the file stays
// playable, and only its size crosses the limit.
if (wanted('M13')) {
  const clip = p('m13-clip.tmp.mp4');
  ff([...videoIn('1280x720', 30, 4), ...toneIn(440, 4), ...H264, ...AAC, '-shortest', clip], 'M13');
  const target = 2048 * 1048576 + 16 * 1048576;
  const clipBytes = readFileSync(clip);
  const freeSize = target - clipBytes.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(freeSize, 0);
  header.write('free', 4, 'ascii');
  const fd = openSync(p('m13-oversize.mp4'), 'w');
  writeSync(fd, clipBytes);
  writeSync(fd, header);
  const zeros = Buffer.alloc(64 * 1048576);
  let left = freeSize - header.length;
  while (left > 0) {
    const n = Math.min(left, zeros.length);
    writeSync(fd, zeros, 0, n);
    left -= n;
  }
  closeSync(fd);
  rmSync(clip, { force: true });
  record('M13', 'm13-oversize.mp4', '4 s 720p clip + free box, intentionally over 2 GiB');
}

// L01 — dense 1080p content for memory measurements.
// The test pattern above compresses so well that the encoder never spends its
// bitrate budget, which hid the real cost of holding the output in memory.
// Moving pattern + temporal noise makes every frame expensive, the way real
// camera footage is. Kept far under the input limit.
if (wanted('L01')) {
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=20,noise=alls=28:allf=t+u',
      ...toneIn(440, 20),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '30',
      ...AAC, '-shortest', p('l01-dense-1080p.mp4')], 'L01');
  record('L01', 'l01-dense-1080p.mp4', '1080p moving pattern + temporal noise, for realistic bitrate');
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
