/**
 * Measurements of saved files with ffmpeg / ffprobe: tools that know nothing
 * about the app's encoder. Everything here reads files; nothing is sent
 * anywhere.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SOURCES, ensureDir, round, tr } from './record';

export interface StreamInfo {
  type: 'video' | 'audio' | string;
  codec: string;
  profile: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  startS: number | null;
  durationS: number | null;
  frames: number | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface FileInfo {
  bytes: number;
  format: string;
  durationS: number;
  streams: StreamInfo[];
  video: StreamInfo | null;
  audio: StreamInfo | null;
}

const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return value === undefined || value === null || value === 'N/A' || !Number.isFinite(parsed) ? null : parsed;
};

function rate(text: string | undefined): number | null {
  if (!text) return null;
  const [a, b] = text.split('/').map(Number);
  if (!a || !b) return null;
  return a / b;
}

export function probeFile(file: string): FileInfo {
  const result = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`ffprobe: ${String(result.stderr).slice(0, 300)}`);
  const json = JSON.parse(result.stdout) as {
    format: { duration?: string; format_name?: string };
    streams: Array<Record<string, unknown>>;
  };
  const streams: StreamInfo[] = json.streams.map((stream) => ({
    type: String(stream.codec_type),
    codec: String(stream.codec_name),
    profile: stream.profile === undefined ? null : String(stream.profile),
    pixFmt: stream.pix_fmt === undefined ? null : String(stream.pix_fmt),
    width: num(stream.width),
    height: num(stream.height),
    fps: rate(stream.avg_frame_rate as string | undefined),
    startS: num(stream.start_time),
    durationS: num(stream.duration),
    frames: num(stream.nb_frames),
    sampleRate: num(stream.sample_rate),
    channels: num(stream.channels),
  }));
  return {
    bytes: statSync(file).size,
    format: json.format.format_name ?? '',
    durationS: Number(json.format.duration ?? 0),
    streams,
    video: streams.find((stream) => stream.type === 'video') ?? null,
    audio: streams.find((stream) => stream.type === 'audio') ?? null,
  };
}

/** Order of the top-level boxes of an MP4: `moov` before `mdat` is "fast start" (plays while it downloads). */
export function topLevelBoxes(file: string): string[] {
  const size = statSync(file).size;
  const handle = openSync(file, 'r');
  const boxes: string[] = [];
  try {
    let at = 0;
    const header = Buffer.alloc(16);
    while (at + 8 <= size && boxes.length < 32) {
      readSync(handle, header, 0, 16, at);
      let length = header.readUInt32BE(0);
      const name = header.toString('latin1', 4, 8);
      if (length === 1) length = Number(header.readBigUInt64BE(8));
      if (length === 0) length = size - at;
      if (length < 8) break;
      boxes.push(name);
      at += length;
    }
  } finally {
    closeSync(handle);
  }
  return boxes;
}

export interface TimestampCheck {
  packets: number;
  firstPtsS: number | null;
  /** Packets whose decode time is earlier than the packet before. */
  dtsBackwards: number;
  /** Two packets with the same presentation time. */
  duplicatePts: number;
  /** The longest distance between two presentation times in a row, in seconds. */
  maxGapS: number | null;
}

export function packetTimes(file: string, stream: 'v:0' | 'a:0'): TimestampCheck {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=pts_time,dts_time', '-of', 'csv=p=0', file],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffprobe: ${String(result.stderr).slice(0, 300)}`);
  const rows = result.stdout
    .split(/\r?\n/)
    .map((line) => line.split(',').map(Number))
    .filter((row) => row.length >= 2 && Number.isFinite(row[0]));
  let dtsBackwards = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const now = rows[i]?.[1];
    const before = rows[i - 1]?.[1];
    if (Number.isFinite(now) && Number.isFinite(before) && (now as number) < (before as number)) dtsBackwards += 1;
  }
  const pts = rows.map((row) => row[0] as number).sort((a, b) => a - b);
  let duplicatePts = 0;
  let maxGap = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const gap = (pts[i] as number) - (pts[i - 1] as number);
    if (gap === 0) duplicatePts += 1;
    if (gap > maxGap) maxGap = gap;
  }
  return {
    packets: rows.length,
    firstPtsS: pts[0] ?? null,
    dtsBackwards,
    duplicatePts,
    maxGapS: pts.length > 1 ? round(maxGap, 4) : null,
  };
}

export interface PlayableCheck {
  name: string;
  ok: boolean;
  value: string;
}

/**
 * "Opens everywhere", as far as a file can show it: H.264 in 4:2:0 8-bit,
 * AAC (or no sound when none is expected), an MP4 whose index comes first,
 * and timestamps a player does not have to repair.
 */
export function playableEverywhere(file: string, expectAudio: boolean): PlayableCheck[] {
  const info = probeFile(file);
  const checks: PlayableCheck[] = [];
  const add = (name: string, ok: boolean, value: string) => checks.push({ name, ok, value });
  add('MP4 kabı', /mp4/.test(info.format), info.format);
  add('görüntü H.264', info.video?.codec === 'h264', `${info.video?.codec ?? 'yok'} ${info.video?.profile ?? ''}`.trim());
  add('renk örnekleme yuv420p (8 bit)', info.video?.pixFmt === 'yuv420p' || info.video?.pixFmt === 'yuvj420p', info.video?.pixFmt ?? 'yok');
  if (expectAudio) add('ses AAC', info.audio?.codec === 'aac', info.audio ? `${info.audio.codec} ${info.audio.sampleRate} Hz` : 'yok');
  const boxes = topLevelBoxes(file);
  const moov = boxes.indexOf('moov');
  const mdat = boxes.indexOf('mdat');
  add('faststart (moov, mdat’tan önce)', moov >= 0 && mdat >= 0 && moov < mdat, boxes.join(' '));
  const video = packetTimes(file, 'v:0');
  add('görüntü 0’da başlıyor (≤ 0,05 sn)', video.firstPtsS !== null && Math.abs(video.firstPtsS) <= 0.05, `${video.firstPtsS === null ? '—' : tr(video.firstPtsS, 4)} sn`);
  add('görüntü zaman damgaları sıralı', video.dtsBackwards === 0 && video.duplicatePts === 0, `${video.dtsBackwards} geri, ${video.duplicatePts} çift`);
  const fps = info.video?.fps ?? 30;
  add('kareler arasında boşluk yok (≤ 3 kare)', video.maxGapS !== null && video.maxGapS <= 3 / fps + 0.001, `en uzun ${video.maxGapS === null ? '—' : tr(video.maxGapS, 4)} sn`);
  if (expectAudio && info.audio) {
    const audio = packetTimes(file, 'a:0');
    add('ses zaman damgaları sıralı', audio.dtsBackwards === 0, `${audio.dtsBackwards} geri`);
    const startGap = Math.abs((info.audio.startS ?? 0) - (info.video?.startS ?? 0));
    add('ses ve görüntü birlikte başlıyor (≤ 0,05 sn)', startGap <= 0.05, `${tr(startGap, 4)} sn fark`);
    const lengthGap = Math.abs((info.audio.durationS ?? 0) - (info.video?.durationS ?? 0));
    add('ses ve görüntü birlikte bitiyor (≤ 0,1 sn)', lengthGap <= 0.1, `${tr(lengthGap, 4)} sn fark`);
  }
  return checks;
}

/** Mean volume (dBFS) of the last `seconds` of a file's sound; −Infinity for digital silence. */
export function tailVolumeDb(file: string, seconds: number): number {
  const text = ffmpegText(['-sseof', `-${seconds}`, '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-']);
  const match = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(text);
  if (!match || match[1] === '-inf') return Number.NEGATIVE_INFINITY;
  return Number(match[1]);
}

// ------------------------------------------------------------ picture fidelity

let vmafKnown: boolean | null = null;

/** Whether this machine's ffmpeg was built with libvmaf. Asked, never assumed. */
export function hasVmaf(): boolean {
  if (vmafKnown === null) {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    vmafKnown = /\blibvmaf\b/.test(result.stdout ?? '');
  }
  return vmafKnown;
}

function ffmpegText(args: string[]): string {
  const result = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

/**
 * The same edit made by ffmpeg alone: `startS`…`startS + lengthS` of the
 * source, through `filter`, at the output's size, 30 fps, without loss
 * (x264 at qp 0). What the app's file is compared against.
 */
export function buildReference(
  source: string,
  out: string,
  options: { startS: number; lengthS: number; filter: string; width: number; height: number; fps?: number },
): string {
  const fps = options.fps ?? 30;
  const graph =
    `[0:v]trim=start=${options.startS}:end=${options.startS + options.lengthS},setpts=PTS-STARTPTS,` +
    `fps=${fps}:round=up:start_time=0,${options.filter},scale=${options.width}:${options.height}:flags=bicubic,format=yuv420p[v]`;
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', out],
    { stdio: 'pipe' },
  );
  return out;
}

export interface Fidelity {
  ssim: number | null;
  psnrDb: number | null;
  /** null when this ffmpeg has no libvmaf (see `vmafNote`). */
  vmaf: number | null;
  vmafNote: string | null;
  frames: number | null;
}

/**
 * SSIM, PSNR and (where the local ffmpeg can) VMAF of `output` against
 * `reference`. Both are put on the same frame grid and size first: a file
 * that keeps the source's own frame times would otherwise be paired wrongly.
 */
export function fidelity(output: string, reference: string, size: { width: number; height: number }, fps = 30): Fidelity {
  const prepare = (input: number, label: string) =>
    `[${input}:v]fps=${fps}:round=up:start_time=0,scale=${size.width}:${size.height}:flags=bicubic,format=yuv420p,setpts=PTS-STARTPTS[${label}]`;
  const run = (metric: string) =>
    ffmpegText(['-i', output, '-i', reference, '-lavfi', `${prepare(0, 'a')};${prepare(1, 'b')};[a][b]${metric}`, '-f', 'null', '-']);
  const ssimText = run('ssim');
  const psnrText = run('psnr');
  const ssim = /SSIM[^\n]*All:\s*([0-9.]+)/.exec(ssimText);
  const psnr = /PSNR[^\n]*average:\s*([0-9.]+|inf)/.exec(psnrText);
  const frames = /frame=\s*(\d+)/g;
  let lastFrames: number | null = null;
  for (let match = frames.exec(ssimText); match; match = frames.exec(ssimText)) lastFrames = Number(match[1]);
  let vmaf: number | null = null;
  let vmafNote: string | null = null;
  if (hasVmaf()) {
    const text = run('libvmaf=n_threads=4');
    const found = /VMAF score:\s*([0-9.]+)/.exec(text);
    if (found) vmaf = round(Number(found[1]), 2);
    else vmafNote = 'libvmaf çalıştı ama puan vermedi';
  } else {
    vmafNote = 'bu makinedeki ffmpeg libvmaf içermiyor';
  }
  return {
    ssim: ssim ? round(Number(ssim[1]), 4) : null,
    psnrDb: psnr ? (psnr[1] === 'inf' ? 99 : round(Number(psnr[1]), 2)) : null,
    vmaf,
    vmafNote,
    frames: lastFrames,
  };
}

// ------------------------------------------------------------ sources

function make(name: string, args: string[]): string {
  const file = join(ensureDir(SOURCES), name);
  if (existsSync(file)) return file;
  const extension = name.slice(name.lastIndexOf('.'));
  const partial = `${file}.part${extension}`;
  rmSync(partial, { force: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, partial], { stdio: 'pipe' });
  renameSync(partial, file);
  return file;
}

/**
 * A picture that measures like something a camera filmed (the recipe of
 * tests/e2e/enhance-media.ts: fractal noise over soft colour gradients, a
 * grid, two boxes, a little grain), 1920 × 1080, 30 fps, 12 s, about 24 MB:
 * larger than WhatsApp's 16 MB, so "Küçült" has real work. Generated; not
 * footage.
 */
export function cameraLikeSource(): string {
  const size = '1920x1080';
  return make('kamera-benzeri-1080p-12s.mp4', [
    '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', `perlin=s=${size}:r=30:octaves=6:persistence=0.65:xscale=6:yscale=6:tscale=0.4:random_mode=seed:random_seed=11`,
    '-f', 'lavfi', '-i', `gradients=s=${size}:r=30:c0=0x5a6f8f:c1=0xc9b89a:c2=0x6f8f6a:c3=0x9a7070:n=4:speed=0.01:seed=5`,
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12',
    '-filter_complex',
    '[0:v]format=gbrp[n];[1:v]format=gbrp[g];[n][g]blend=all_mode=overlay,eq=contrast=1.3,' +
      'drawgrid=w=480:h=360:t=3:c=white@0.55,drawbox=x=180:y=150:w=270:h=180:c=black@0.75:t=fill,' +
      'drawbox=x=1260:y=630:w=360:h=240:c=white@0.8:t=fill,noise=alls=6:allf=t,' +
      'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
    '-map', '[v]', '-map', '2:a', '-t', '12',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '16M', '-minrate', '16M', '-maxrate', '16M', '-bufsize', '16M',
    '-pix_fmt', 'yuv420p', '-g', '30',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
  ]);
}

/** The same picture at 1280 × 720 as VP9 + Opus in WebM: what "Her yerde açılsın" has to convert. */
export function cameraLikeWebm(): string {
  const source = cameraLikeSource();
  return make('kamera-benzeri-720p-6s.webm', [
    '-i', source, '-t', '6', '-vf', 'scale=1280:720:flags=bicubic',
    '-c:v', 'libvpx-vp9', '-b:v', '4M', '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'libopus', '-b:a', '96k',
  ]);
}

/** A copy of `source` (an MP4 with its index first) cut off at `share` of its bytes: a download that stopped half way. */
export function truncatedCopy(source: string, name: string, share: number): Buffer {
  const fast = make(`${name}-faststart.mp4`, ['-i', source, '-c', 'copy', '-movflags', '+faststart']);
  const size = statSync(fast).size;
  const handle = openSync(fast, 'r');
  try {
    const out = Buffer.alloc(Math.floor(size * share));
    readSync(handle, out, 0, out.length, 0);
    return out;
  } finally {
    closeSync(handle);
  }
}

/** The sync clip of scripts/lib/av-sync.mjs as VP9 + Opus: every task has to re-encode it. */
export function syncWebm(syncMp4: string): string {
  return make('senkron-vp9.webm', [
    '-i', syncMp4,
    '-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'libopus', '-b:a', '128k',
  ]);
}

/**
 * The sync clip made heavy: the same flashes and chirps under moving noise at a constant 22 Mbit/s
 * (about 33 MB for its 12 s), so "Küçült" has to shrink it and the sound-against-picture offset of a
 * target-size encode can be measured. (The plain sync clip weighs a few hundred KB: since 10 Oct 2026
 * "Küçült" rightly says there is nothing to shrink there.) The sound is copied untouched.
 */
export function syncHeavy(syncMp4: string): string {
  return make('senkron-agir.mp4', [
    '-i', syncMp4,
    '-vf', 'noise=alls=40:allf=t+u',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '22M', '-minrate', '22M', '-maxrate', '22M', '-bufsize', '22M',
    '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'copy',
  ]);
}

/** The A/V measurement of scripts/lib/av-sync.mjs (typed here: its .d.mts lists only what the unit tests use). */
export interface AvSyncModule {
  writeSyncClip(path: string, options?: { fps?: number }): string;
  avSync(file: string): { flashes: number; onsets: number; paired: number; medianMs: number | null; minMs: number | null; maxMs: number | null };
}

export async function loadAvSync(): Promise<AvSyncModule> {
  return (await import('../../../scripts/lib/av-sync.mjs')) as unknown as AvSyncModule;
}

export async function syncSource(): Promise<string> {
  const file = join(ensureDir(SOURCES), 'senkron-h264.mp4');
  if (!existsSync(file)) (await loadAvSync()).writeSyncClip(file);
  return file;
}
