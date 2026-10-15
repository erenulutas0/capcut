/**
 * The fuzz corpus: every kind of file a real user may drop on a task card or
 * the editor (docs/quality/2026-10-15-fuzz.md). Made with ffmpeg / ffprobe
 * and byte-level mutations into a gitignored folder; the media is never
 * committed, this generator is.
 *
 *   node scripts/fuzz/make-corpus.mjs                 writes web/.scratch/fuzz/corpus/ + manifest.json
 *   node scripts/fuzz/make-corpus.mjs --out=<dir>     elsewhere
 *   node scripts/fuzz/make-corpus.mjs --only=a,b      some items (by id)
 *   node scripts/fuzz/make-corpus.mjs --force         remake what is there
 *
 * Deterministic: lavfi test sources with fixed seeds, `-bitexact` muxing, a
 * seeded generator for every random byte. Nothing here is real footage or
 * speech. ffmpeg and ffprobe must be on the path.
 *
 * Each manifest item says what a careful app should do with the file:
 *   expect: 'open'    a valid file this browser decodes — it must open and the default path must save a sane file
 *                     (or the card must say, in plain words, that there is nothing to do);
 *           'refuse'  a file that cannot be worked on — it must be refused when picked, or the download must
 *                     fail honestly; a "Kaydedildi" is a fake success;
 *           'any'     either is acceptable (another browser might decode it, a tolerance applies…) —
 *                     but a saved file must be sane and a refusal must be plain.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const flag = (name) => args.includes(`--${name}`);

export const DEFAULT_CORPUS_DIR = join(webDir, '.scratch', 'fuzz', 'corpus');
const outDir = option('out') ? resolve(option('out')) : DEFAULT_CORPUS_DIR;
const only = option('only')?.split(',').filter(Boolean) ?? null;
const force = flag('force');

// ------------------------------------------------------------ helpers

const BITEXACT = ['-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact'];

function ffmpeg(ffArgs, out) {
  const partial = `${out}.part${out.slice(out.lastIndexOf('.'))}`;
  rmSync(partial, { force: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...ffArgs, ...BITEXACT, partial], { stdio: 'pipe' });
  // Renamed only when complete: an interrupted run never leaves half a corpus file.
  rmSync(out, { force: true });
  writeFileSync(out, readFileSync(partial));
  rmSync(partial, { force: true });
}

/** Seeded bytes (an LCG): the same "random" file every time. */
function noise(length, seed) {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

/** The dim, grainy test pattern every variant shares (seeded noise: deterministic). */
const PICTURE = 'lutyuv=y=val*0.4,noise=alls=18:allf=t,format=yuv420p';
/** A tone that stops for a second every three seconds, so "Boşlukları at" has gaps to find. */
const TONE = '0.25*sin(2*PI*440*t)*lt(mod(t,3),2)'.replace(/,/g, '\\,');

function picture(width, height, rate, seconds) {
  return ['-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${rate}:duration=${seconds}`];
}
function tone(seconds, sampleRate = 48000) {
  return ['-f', 'lavfi', '-i', `aevalsrc=exprs=${TONE}:s=${sampleRate}:d=${seconds}`];
}
const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '30'];
/** About 0.45 bit per pixel: bytes for "Küçült" to lose. */
const rateOf = (width, height, fps) => `${Math.round((width * height * fps * 0.45) / 1000)}k`;
function h264At(width, height, fps) {
  const rate = rateOf(width, height, fps);
  // One thread: x264's rate control with a buffer (VBV) is not bit-exact across runs when it is threaded.
  return [...H264, '-threads', '1', '-b:v', rate, '-minrate', rate, '-maxrate', rate, '-bufsize', rate];
}
const AAC = ['-c:a', 'aac', '-b:a', '96k'];

/** Picture + sound, H.264 + AAC, in one call. */
function clip(out, { width = 640, height = 360, fps = 30, seconds = 6, audio = true, channels = 2, sampleRate = 48000, container = [], video = null, extra = [] }) {
  ffmpeg(
    [
      ...picture(width, height, fps, seconds),
      ...(audio ? tone(seconds, sampleRate) : []),
      '-vf', PICTURE,
      ...(video ?? h264At(width, height, fps)),
      ...(audio ? [...AAC, '-ac', String(channels), '-ar', String(sampleRate)] : ['-an']),
      ...extra,
      '-shortest',
      ...container,
    ],
    out,
  );
}

// ------------------------------------------------------------ MP4 boxes

function* boxes(buffer, start = 0, end = buffer.length) {
  let at = start;
  while (at + 8 <= end) {
    let size = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) return;
    yield { at, size, type, header };
    at += size;
  }
}

/** Every box at `path` ("moov/trak/tkhd"), in file order. */
function findAll(buffer, path, start = 0, end = buffer.length) {
  const [head, ...rest] = path.split('/');
  const found = [];
  for (const box of boxes(buffer, start, end)) {
    if (box.type !== head) continue;
    if (rest.length === 0) found.push(box);
    else found.push(...findAll(buffer, rest.join('/'), box.at + box.header, box.at + box.size));
  }
  return found;
}

function findOne(buffer, path) {
  const [first] = findAll(buffer, path);
  if (!first) throw new Error(`${path}: not in the file`);
  return first;
}

/** Overwrites the entries of a sample table (after its count) with seeded bytes; the box header stays. */
function scrambleTable(buffer, path, entriesAt, seed) {
  const table = findOne(buffer, path);
  const from = table.at + table.header + entriesAt;
  const to = table.at + table.size;
  if (to <= from) throw new Error(`${path}: no entries to scramble`);
  noise(to - from, seed).copy(buffer, from);
  return buffer;
}

/** mvhd / tkhd / mdhd: where the duration (and the timescale) sit, by version. */
function durationFields(box, buffer) {
  const version = buffer[box.at + box.header];
  const base = box.at + box.header;
  if (box.type === 'mvhd' || box.type === 'mdhd') {
    return version === 1 ? { timescale: base + 20, duration: base + 24, wide: true } : { timescale: base + 12, duration: base + 16, wide: false };
  }
  // tkhd: creation, modification, track id, reserved, duration.
  return version === 1 ? { timescale: null, duration: base + 28, wide: true } : { timescale: null, duration: base + 20, wide: false };
}

function writeDuration(buffer, fields, value) {
  if (fields.wide) buffer.writeBigUInt64BE(BigInt(value), fields.duration);
  else buffer.writeUInt32BE(Math.min(0xffffffff, value), fields.duration);
}

/** The index claims `seconds` of video and sound; the samples stay as they are. */
function claimDuration(buffer, seconds) {
  const mvhd = findOne(buffer, 'moov/mvhd');
  const movie = durationFields(mvhd, buffer);
  const movieScale = buffer.readUInt32BE(movie.timescale);
  writeDuration(buffer, movie, Math.round(seconds * movieScale));
  for (const tkhd of findAll(buffer, 'moov/trak/tkhd')) writeDuration(buffer, durationFields(tkhd, buffer), Math.round(seconds * movieScale));
  for (const mdhd of findAll(buffer, 'moov/trak/mdia/mdhd')) {
    const media = durationFields(mdhd, buffer);
    writeDuration(buffer, media, Math.round(seconds * buffer.readUInt32BE(media.timescale)));
  }
  return buffer;
}

/** The container says the picture is `width` × `height`; the H.264 stream inside is not asked. */
function claimSize(buffer, width, height) {
  const tkhd = findOne(buffer, 'moov/trak/tkhd');
  const version = buffer[tkhd.at + tkhd.header];
  const sizeAt = tkhd.at + tkhd.header + (version === 1 ? 88 : 76);
  buffer.writeUInt32BE(width << 16, sizeAt);
  buffer.writeUInt32BE(height << 16, sizeAt + 4);
  const stsd = findOne(buffer, 'moov/trak/mdia/minf/stbl/stsd');
  // Full box (4) + entry count (4), then the first sample entry: size, type, 6 reserved, data ref (2), 16 predefined, width, height.
  const entry = stsd.at + stsd.header + 8;
  buffer.writeUInt16BE(width, entry + 32);
  buffer.writeUInt16BE(height, entry + 34);
  return buffer;
}

/**
 * The `mdat` header claims more than 4 GiB. ffmpeg's fast-start layout leaves an 8-byte `free` box
 * right before `mdat`: it becomes the 16-byte (64-bit size) header of the same data, so no sample
 * moves and every chunk offset stays right. The old 8-byte header is now the first bytes of the payload.
 */
function lieAboutMdat(buffer) {
  const top = [...boxes(buffer)];
  const mdatIndex = top.findIndex((box) => box.type === 'mdat');
  const before = top[mdatIndex - 1];
  const mdat = top[mdatIndex];
  if (!mdat) throw new Error('no mdat');
  if (before && before.type === 'free' && before.size === 8) {
    buffer.writeUInt32BE(1, before.at);
    buffer.write('mdat', before.at + 4, 'latin1');
    buffer.writeBigUInt64BE(BigInt(4 * 1024 ** 3) + BigInt(mdat.size) + 8n, before.at + 8);
    return buffer;
  }
  // No room for a 64-bit header without moving the samples: the 32-bit size says "4 GiB − 1" instead.
  buffer.writeUInt32BE(0xffffffff, mdat.at);
  return buffer;
}

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) return null;
  try {
    const json = JSON.parse(result.stdout);
    const video = json.streams.find((s) => s.codec_type === 'video');
    const audio = json.streams.find((s) => s.codec_type === 'audio');
    const rate = (text) => {
      const [a, b] = String(text ?? '').split('/').map(Number);
      return a && b ? a / b : null;
    };
    return {
      durationS: Number(json.format?.duration ?? 0) || null,
      format: json.format?.format_name ?? null,
      video: video ? { codec: video.codec_name, width: video.width, height: video.height, fps: rate(video.avg_frame_rate) } : null,
      audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels } : null,
      streams: json.streams.map((s) => `${s.codec_type}:${s.codec_name}`),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ the corpus

const S = 6;
const BASE = { width: 640, height: 360, fps: 30, seconds: S };

/**
 * `make(out, { base })`: writes the file. `derive(fromId)`: another item's file is the input.
 * `name`: the file name the page sees (defaults to `<id>.<ext>`); `mime`: what the browser is told.
 */
const ITEMS = [
  // ---- container layout
  { id: 'temel', group: 'kap', label: 'Olağan MP4 (dizin başta, H.264 + AAC, 640 × 360, 30 kare/sn, 6 sn)', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, container: ['-movflags', '+faststart'] }) },
  { id: 'moov-sonda', group: 'kap', label: 'Dizin (moov) dosyanın sonunda', expect: 'open', ext: 'mp4', make: (out) => clip(out, BASE) },
  { id: 'parcali', group: 'kap', label: 'Parçalı MP4 (fragmented, boş moov + moof)', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof'], out) },
  { id: 'duzenleme-listesi', group: 'kap', label: 'Düzenleme listesi (edit list): 0,7 sn’den kopyalanarak kesilmiş', expect: 'open', ext: 'mp4', durationS: S - 0.7, tolerance: 0.6, make: (out, from) => ffmpeg(['-ss', '0.7', '-i', from('temel'), '-c', 'copy', '-movflags', '+faststart'], out) },
  { id: 'negatif-cts', group: 'kap', label: 'B kareleri, negatif CTS (ctts v1)', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, extra: ['-bf', '2'], container: ['-movflags', 'negative_cts_offsets+faststart'] }) },
  { id: 'b-kareleri', group: 'kap', label: 'B kareleri (3, piramit) ve başlangıç kayması', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, extra: ['-bf', '3', '-x264-params', 'b-pyramid=normal'], container: ['-movflags', '+faststart'] }) },
  { id: 'degisken-kare-hizi', group: 'kap', label: 'Değişken kare hızı (kare zamanları düzensiz)', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, extra: ['-vf', `${PICTURE},setpts=PTS+random(0)*0.02/TB`, '-fps_mode', 'passthrough'], container: ['-movflags', '+faststart'] }) },
  { id: '120-fps', group: 'kap', label: '120 kare/sn, 2 sn', expect: 'open', ext: 'mp4', durationS: 2, make: (out) => clip(out, { ...BASE, fps: 120, seconds: 2, container: ['-movflags', '+faststart'] }) },
  { id: '1-fps', group: 'kap', label: '1 kare/sn, 6 sn', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, fps: 1, container: ['-movflags', '+faststart'] }) },
  { id: 'yarim-saniye', group: 'kap', label: '0,5 saniyelik video', expect: 'open', ext: 'mp4', durationS: 0.5, make: (out) => clip(out, { ...BASE, seconds: 0.5, container: ['-movflags', '+faststart'] }) },
  { id: 'tek-kare', group: 'kap', label: 'Tek kareli video (sessiz)', expect: 'any', ext: 'mp4', durationS: 1 / 30, tolerance: 0.2, make: (out) => clip(out, { ...BASE, seconds: 1, audio: false, extra: ['-frames:v', '1'], container: ['-movflags', '+faststart'] }) },
  { id: 'yalniz-ses-mp4', group: 'kap', label: 'Yalnızca ses, .mp4 uzantılı', expect: 'refuse', ext: 'mp4', make: (out) => ffmpeg([...tone(S), ...AAC, '-ac', '2', '-vn'], out) },
  { id: 'yalniz-goruntu', group: 'kap', label: 'Yalnızca görüntü, ses izi yok', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, audio: false, container: ['-movflags', '+faststart'] }) },
  // ---- sound
  { id: 'ses-5-1', group: 'ses', label: '5.1 ses (6 kanal AAC)', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, channels: 6, container: ['-movflags', '+faststart'] }) },
  { id: 'ses-8khz', group: 'ses', label: '8 kHz ses', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, sampleRate: 8000, container: ['-movflags', '+faststart'] }) },
  { id: 'ses-96khz', group: 'ses', label: '96 kHz ses', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, sampleRate: 96000, container: ['-movflags', '+faststart'] }) },
  { id: 'ses-mono', group: 'ses', label: 'Tek kanal (mono) ses', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, channels: 1, container: ['-movflags', '+faststart'] }) },
  // ---- orientation
  { id: 'dondurme-90', group: 'yon', label: 'Döndürme 90° (üst veri)', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-display_rotation', '90', '-i', from('temel'), '-c', 'copy', '-movflags', '+faststart'], out) },
  { id: 'dondurme-180', group: 'yon', label: 'Döndürme 180° (üst veri)', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-display_rotation', '180', '-i', from('temel'), '-c', 'copy', '-movflags', '+faststart'], out) },
  { id: 'dondurme-270', group: 'yon', label: 'Döndürme 270° (üst veri)', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-display_rotation', '270', '-i', from('temel'), '-c', 'copy', '-movflags', '+faststart'], out) },
  { id: 'yatay-cevrilmis', group: 'yon', label: 'Görüntü matrisi: yatay ayna', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-display_hflip', '-i', from('temel'), '-c', 'copy', '-movflags', '+faststart'], out) },
  { id: 'dikey-cevrilmis', group: 'yon', label: 'Görüntü matrisi: dikey ayna', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-display_vflip', '-i', from('temel'), '-c', 'copy', '-movflags', '+faststart'], out) },
  // ---- size
  { id: 'tek-boyut-vp9', group: 'boyut', label: 'Tek sayılı boyut 641 × 361 (VP9, MP4)', expect: 'open', ext: 'mp4', width: 641, height: 361, make: (out) => clip(out, { ...BASE, width: 642, height: 362, video: ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-g', '30'], extra: ['-vf', `${PICTURE},crop=641:361`], container: ['-movflags', '+faststart'] }) },
  { id: 'tek-boyut-h264-444', group: 'boyut', label: 'Tek sayılı boyut 641 × 361 (H.264 4:4:4)', expect: 'any', ext: 'mp4', width: 641, height: 361, make: (out) => clip(out, { ...BASE, width: 642, height: 362, video: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv444p', '-g', '30'], extra: ['-vf', `lutyuv=y=val*0.4,noise=alls=18:allf=t,format=yuv444p,crop=641:361`], container: ['-movflags', '+faststart'] }) },
  { id: 'kap-boyut-yalani', group: 'boyut', label: 'Kap 641 × 361 diyor, görüntü 642 × 362', expect: 'open', ext: 'mp4', width: 642, height: 362, make: (out) => { clip(out, { ...BASE, width: 642, height: 362, container: ['-movflags', '+faststart'] }); writeFileSync(out, claimSize(readFileSync(out), 641, 361)); } },
  { id: 'minik-16x16', group: 'boyut', label: 'Minik görüntü 16 × 16', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, width: 16, height: 16, video: [...H264, '-crf', '28'], container: ['-movflags', '+faststart'] }) },
  { id: 'dev-7680x4320', group: 'boyut', label: 'Dev görüntü 7680 × 4320, 0,5 sn', expect: 'open', ext: 'mp4', durationS: 0.5, tolerance: 0.3, make: (out) => clip(out, { ...BASE, width: 7680, height: 4320, fps: 30, seconds: 0.5, video: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv420p', '-g', '15'], container: ['-movflags', '+faststart'] }) },
  // ---- codecs
  { id: 'hevc-hvc1', group: 'kodek', label: 'HEVC (H.265), hvc1 etiketi (telefonlar böyle yazar)', expect: 'any', ext: 'mp4', make: (out) => clip(out, { ...BASE, video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', '-tag:v', 'hvc1'], container: ['-movflags', '+faststart'] }) },
  { id: 'hevc-hev1', group: 'kodek', label: 'HEVC (H.265), hev1 etiketi', expect: 'any', ext: 'mp4', make: (out) => clip(out, { ...BASE, video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error'], container: ['-movflags', '+faststart'] }) },
  { id: 'av1', group: 'kodek', label: 'AV1 (MP4)', expect: 'open', ext: 'mp4', make: (out) => clip(out, { ...BASE, video: ['-c:v', 'libsvtav1', '-preset', '12', '-crf', '40', '-pix_fmt', 'yuv420p', '-g', '30'], container: ['-movflags', '+faststart'] }) },
  { id: 'vp9-opus-webm', group: 'kodek', label: 'VP9 + Opus (WebM)', expect: 'open', ext: 'webm', make: (out) => clip(out, { ...BASE, video: ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-g', '30'], extra: ['-c:a', 'libopus', '-b:a', '64k'] }) },
  { id: 'vp8-vorbis-webm', group: 'kodek', label: 'VP8 + Vorbis (WebM)', expect: 'open', ext: 'webm', make: (out) => clip(out, { ...BASE, video: ['-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-g', '30'], extra: ['-c:a', 'libvorbis', '-b:a', '64k'] }) },
  // ---- other containers
  { id: 'mov-zaman-kodu', group: 'kap2', label: 'MOV: zaman kodu izi (tmcd) ve veri izi', expect: 'open', ext: 'mov', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-timecode', '01:00:00:00', '-f', 'mov', '-movflags', '+faststart'], out) },
  { id: 'mkv', group: 'kap2', label: 'MKV (H.264 + AAC)', expect: 'any', ext: 'mkv', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-f', 'matroska'], out) },
  { id: '3gp', group: 'kap2', label: '3GP (H.264 + AAC)', expect: 'any', ext: '3gp', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-f', '3gp'], out) },
  { id: 'avi', group: 'kap2', label: 'AVI (H.264 + AAC)', expect: 'refuse', ext: 'avi', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-f', 'avi'], out) },
  { id: 'mpeg-ts', group: 'kap2', label: 'MPEG-TS (H.264 + AAC)', expect: 'refuse', ext: 'ts', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-f', 'mpegts'], out) },
  { id: 'gif', group: 'kap2', label: 'GIF (hareketli)', expect: 'refuse', ext: 'gif', make: (out, from) => ffmpeg(['-i', from('temel'), '-t', '1', '-vf', 'fps=10,scale=160:-1', '-f', 'gif'], out) },
  { id: 'png-mp4-adli', group: 'kap2', label: 'PNG resmi, adı .mp4', expect: 'refuse', ext: 'mp4', mime: 'video/mp4', make: (out, from) => { const png = `${out}.png`; ffmpeg(['-i', from('temel'), '-frames:v', '1', '-f', 'image2', '-c:v', 'png'], png); writeFileSync(out, readFileSync(png)); rmSync(png); } },
  // ---- damage
  { id: 'sifir-bayt', group: 'bozuk', label: 'Sıfır baytlık .mp4', expect: 'refuse', ext: 'mp4', make: (out) => writeFileSync(out, Buffer.alloc(0)) },
  { id: 'rastgele-bayt', group: 'bozuk', label: 'İçi rastgele bayt olan .mp4 (300 KB)', expect: 'refuse', ext: 'mp4', make: (out) => writeFileSync(out, noise(300_000, 7)) },
  { id: 'stco-bozuk', group: 'bozuk', label: 'Parça yerleri tablosu (stco) bozuk', expect: 'refuse', ext: 'mp4', make: (out, from) => writeFileSync(out, scrambleTable(readFileSync(from('temel')), 'moov/trak/mdia/minf/stbl/stco', 8, 11)) },
  { id: 'stsz-bozuk', group: 'bozuk', label: 'Örnek boyutları tablosu (stsz) bozuk', expect: 'refuse', ext: 'mp4', make: (out, from) => writeFileSync(out, scrambleTable(readFileSync(from('temel')), 'moov/trak/mdia/minf/stbl/stsz', 12, 13)) },
  { id: 'stts-bozuk', group: 'bozuk', label: 'Kare süreleri tablosu (stts) bozuk', expect: 'refuse', ext: 'mp4', make: (out, from) => writeFileSync(out, scrambleTable(readFileSync(from('temel')), 'moov/trak/mdia/minf/stbl/stts', 8, 17)) },
  { id: 'kesik-10', group: 'bozuk', label: 'Yarıda kesilmiş (baytların %10’u, dizin başta)', expect: 'refuse', ext: 'mp4', make: (out, from) => { const b = readFileSync(from('temel')); writeFileSync(out, b.subarray(0, Math.floor(b.length * 0.1))); } },
  { id: 'kesik-55', group: 'bozuk', label: 'Yarıda kesilmiş (baytların %55’i, dizin başta)', expect: 'refuse', ext: 'mp4', make: (out, from) => { const b = readFileSync(from('temel')); writeFileSync(out, b.subarray(0, Math.floor(b.length * 0.55))); } },
  { id: 'kesik-99', group: 'bozuk', label: 'Yarıda kesilmiş (baytların %99’u: son 1 saniyeden azı eksik — ADR-040 bunu geçirir)', expect: 'any', ext: 'mp4', tolerance: 1.1, make: (out, from) => { const b = readFileSync(from('temel')); writeFileSync(out, b.subarray(0, Math.floor(b.length * 0.99))); } },
  { id: 'moov-sonda-kesik', group: 'bozuk', label: 'Yarıda kesilmiş, dizin sonda (dizin hiç yok)', expect: 'refuse', ext: 'mp4', make: (out, from) => { const b = readFileSync(from('moov-sonda')); writeFileSync(out, b.subarray(0, Math.floor(b.length * 0.55))); } },
  // ---- extra tracks and metadata
  { id: 'iki-video-izi', group: 'ek', label: 'İki görüntü izi', expect: 'any', ext: 'mp4', make: (out, from) => ffmpeg(['-i', from('temel'), '-map', '0:v', '-map', '0:v', '-map', '0:a', '-c', 'copy', '-movflags', '+faststart'], out) },
  { id: 'altyazi-izi', group: 'ek', label: 'Altyazı izi (mov_text)', expect: 'open', ext: 'mp4', make: (out, from) => { const srt = `${out}.srt`; writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\nMerhaba\n\n2\n00:00:03,000 --> 00:00:05,000\nDünya\n'); ffmpeg(['-i', from('temel'), '-i', srt, '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-movflags', '+faststart'], out); rmSync(srt); } },
  { id: 'bolumler', group: 'ek', label: 'Bölümler (chapters)', expect: 'open', ext: 'mp4', make: (out, from) => { const meta = `${out}.ffmeta`; writeFileSync(meta, ';FFMETADATA1\ntitle=Bolumlu\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Bir\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=6000\ntitle=Iki\n'); ffmpeg(['-i', from('temel'), '-i', meta, '-map_metadata', '1', '-c', 'copy', '-movflags', '+faststart'], out); rmSync(meta); } },
  { id: 'uzun-baslik', group: 'ek', label: 'Çok uzun başlık üst verisi (20 000 karakter)', expect: 'open', ext: 'mp4', make: (out, from) => ffmpeg(['-i', from('temel'), '-c', 'copy', '-metadata', `title=${'Başlık '.repeat(2858)}`, '-movflags', '+faststart'], out) },
  { id: 'mdat-4gib-yalani', group: 'ek', label: 'mdat başlığı 4 GiB’tan büyük diyor (dosya 2 MB)', expect: 'any', ext: 'mp4', make: (out, from) => writeFileSync(out, lieAboutMdat(readFileSync(from('temel')))) },
  { id: 'ad-ascii-disi', group: 'ad', label: 'ASCII dışı ad: “tatil 🎬 çekim – Ağustos ✓.mp4”', expect: 'open', ext: 'mp4', name: 'tatil 🎬 çekim – Ağustos ✓.mp4', make: (out, from) => writeFileSync(out, readFileSync(from('temel'))) },
  { id: 'ad-cok-uzun', group: 'ad', label: 'Çok uzun ad (230 karakter)', expect: 'open', ext: 'mp4', name: `${'çok-uzun-bir-dosya-adı-'.repeat(10)}sonu.mp4`, make: (out, from) => writeFileSync(out, readFileSync(from('temel'))) },
  { id: 'sure-yalani-3saat', group: 'yalan', label: 'Dizin 3 saat diyor, dosyada 6 sn var', expect: 'refuse', ext: 'mp4', make: (out, from) => writeFileSync(out, claimDuration(readFileSync(from('temel')), 3 * 3600)) },
  { id: 'sure-yalani-30dk', group: 'yalan', label: 'Dizin 30 dakika diyor, dosyada 6 sn var', expect: 'refuse', ext: 'mp4', make: (out, from) => writeFileSync(out, claimDuration(readFileSync(from('temel')), 30 * 60)) },
];

const MIME = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', avi: 'video/x-msvideo', ts: 'video/mp2t', gif: 'image/gif' };

export function corpusIds() {
  return ITEMS.map((item) => item.id);
}

export function makeCorpus() {
  mkdirSync(outDir, { recursive: true });
  const byId = new Map(ITEMS.map((item) => [item.id, item]));
  const fileOf = (id) => join(outDir, `${id}.${byId.get(id).ext}`);
  const made = new Set();
  const ensure = (id) => {
    if (made.has(id)) return fileOf(id);
    const item = byId.get(id);
    if (!item) throw new Error(`unknown corpus item ${id}`);
    const out = fileOf(id);
    if (force || !existsSync(out)) {
      const started = Date.now();
      item.make(out, ensure);
      console.log(`fuzz corpus: ${id} (${(statSync(out).size / 1024).toFixed(0)} KB, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    }
    made.add(id);
    return out;
  };
  const wanted = ITEMS.filter((item) => !only || only.includes(item.id));
  for (const item of wanted) ensure(item.id);

  const manifest = wanted.map((item) => {
    const file = fileOf(item.id);
    const info = probe(file);
    return {
      id: item.id,
      group: item.group,
      label: item.label,
      expect: item.expect,
      file: `${item.id}.${item.ext}`,
      name: item.name ?? `${item.id}.${item.ext}`,
      mime: item.mime ?? MIME[item.ext] ?? 'application/octet-stream',
      bytes: statSync(file).size,
      /** What a sane output should measure like: the source's length (or the item's own say), its tracks. */
      durationS: item.durationS ?? info?.durationS ?? null,
      tolerance: item.tolerance ?? 0.25,
      width: item.width ?? info?.video?.width ?? null,
      height: item.height ?? info?.video?.height ?? null,
      hasVideo: info?.video !== null && info?.video !== undefined,
      hasAudio: info?.audio !== null && info?.audio !== undefined,
      ffprobe: info,
    };
  });
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ madeAt: new Date().toISOString(), dir: outDir, items: manifest }, null, 2)}\n`);
  console.log(`fuzz corpus: ${manifest.length} files in ${outDir}`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeCorpus();
}
