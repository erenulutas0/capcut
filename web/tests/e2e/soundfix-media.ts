/**
 * Sources for "Sesi düzelt" (ADR-049), made with ffmpeg on first use into a
 * gitignored folder: synthetic speech (ffmpeg's own `flite` voice — no real
 * person), generated music-like sound, silence, a clipped recording, and the
 * A/V sync clip of scripts/lib/av-sync.mjs. Nothing here is real footage.
 *
 * Every video is a 640 × 360, 30 fps H.264 test picture with a key frame
 * every second, at its own size: the download copies its pictures (ADR-027).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const SOUNDFIX_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'soundfix');

/**
 * The two spoken lines, recorded once with ffmpeg's `flite` voice (slt, 48 kHz mono, its own level —
 * about −17 LUFS) and committed: the ffmpeg on CI runners has no `flite`. Made with
 *   ffmpeg -f lavfi -i "flite=text='<line>':voice=slt" -af aresample=48000 -ac 1 -c:a flac line-a.flac
 * from "Hello and welcome. Today I will show you how to make a small paper boat. First take a square
 * sheet of paper and fold it in half." and "Now fold the corners down to the middle and open the bottom.
 * That is all. Thank you for watching and see you next time."
 */
const VOICE_DIR = join(process.cwd(), 'tests', 'media', 'soundfix-voice');
const LINES = ['-i', join(VOICE_DIR, 'line-a.flac'), '-i', join(VOICE_DIR, 'line-b.flac')];
const LINE_A = 1;
const LINE_B = 2;

/** One spoken line (input 1 or 2), at 48 kHz, `gainDb` from the voice's own level. */
const voice = (input: number, gainDb: number, label: string) =>
  `[${input}:a]aresample=48000,volume=${gainDb}dB[${label}]`;
const pause = (seconds: number, label: string) => `anullsrc=r=48000:cl=mono:d=${seconds}[${label}]`;
/** Two lines with pauses around them, as stereo. */
const speech = (gainA: number, gainB: number) =>
  `${pause(0.8, 'p0')};${voice(LINE_A, gainA, 'a')};${pause(0.9, 'p1')};${voice(LINE_B, gainB, 'b')};${pause(0.8, 'p2')};` +
  `[p0][a][p1][b][p2]concat=n=5:v=0:a=1,pan=stereo|c0=c0|c1=c0[out]`;

const PICTURE = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=18'];
const ENCODE = ['-map', '0:v', '-map', '[out]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart'];

const SPECS = {
  /** Speech recorded far too quietly: about −38 LUFS. */
  quiet: { name: 'kisik-konusma.mp4', audio: speech(-24, -24) },
  /** One line at an ordinary level, the next 22 dB quieter (a second speaker far from the phone). */
  uneven: { name: 'dengesiz-konusma.mp4', audio: speech(-4, -26) },
  /** Speech already at −16 LUFS with room under the peaks: nothing to do. */
  good: { name: 'iyi-konusma.mp4', audio: speech(-1.6, -1.6) },
  /** Speech recorded so loud that it was cut off at full scale (clipped). */
  clipped: { name: 'patlamis-konusma.mp4', audio: speech(20, 20).replace('[out]', ',aeval=exprs=clip(val(0)\\,-0.99\\,0.99)|clip(val(1)\\,-0.99\\,0.99),aformat=channel_layouts=stereo[out]') },
  /** Dense, loud music-like sound with no pauses (about −8 LUFS). */
  loud: {
    name: 'yuksek-muzik.mp4',
    audio:
      'aevalsrc=exprs=0.42*sin(2*PI*110*t)+0.29*sin(2*PI*277*t)*(0.6+0.4*sin(2*PI*2*t))+0.18*sin(2*PI*659*t):s=48000:d=18[tone];' +
      'anoisesrc=color=pink:amplitude=0.33:r=48000:d=18[hiss];[tone][hiss]amix=inputs=2:normalize=0,pan=stereo|c0=c0|c1=c0[out]',
  },
  /** A sound track that is digital silence. */
  silence: { name: 'sessiz-ses.mp4', audio: 'anullsrc=r=48000:cl=stereo:d=18[out]' },
} as const;

export type SoundFixFixture = keyof typeof SPECS;

export function soundFixFixture(name: SoundFixFixture): string {
  const spec = SPECS[name];
  const file = join(SOUNDFIX_MEDIA_DIR, spec.name);
  if (existsSync(file)) return file;
  mkdirSync(SOUNDFIX_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  const inputs = spec.audio.includes('[1:a]') ? [...PICTURE, ...LINES] : PICTURE;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', spec.audio, ...ENCODE, partial], {
    stdio: 'pipe',
  });
  // Rename only when complete: an interrupted run never leaves half a fixture.
  renameSync(partial, file);
  return file;
}

export interface Loudness {
  integratedLufs: number;
  lraLu: number;
  truePeakDbtp: number;
}

/** ffmpeg's own EBU R128 meter over the whole sound of a file (true peak 4× oversampled). */
export function loudness(file: string): Loudness {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const summary = result.stderr.slice(result.stderr.lastIndexOf('Summary:'));
  const number = (pattern: RegExp) => {
    const match = pattern.exec(summary);
    return match ? Number(match[1]) : Number.NaN;
  };
  return {
    integratedLufs: number(/I:\s+(-?[\d.]+|-inf) LUFS/),
    lraLu: number(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDbtp: number(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

/** The MD5 of every video packet, in order, as stored (no decoding): equal lists mean the same pictures, byte for byte. */
export function videoPacketHashes(file: string): string[] {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'framemd5', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').pop()?.trim() ?? '');
}

/** The first video packet as stored (length-prefixed NAL units), no decoding. */
export function firstVideoPacket(file: string): Buffer {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-f', 'data', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}

/** The NAL unit types of a length-prefixed (4-byte) H.264 packet, in order. */
export function nalTypes(packet: Buffer): number[] {
  const types: number[] = [];
  for (let at = 0; at + 4 < packet.length; ) {
    const size = packet.readUInt32BE(at);
    types.push((packet[at + 4] ?? 0) & 0x1f);
    at += 4 + size;
  }
  return types;
}

/** The MD5 of every DECODED picture, in order: equal lists mean the same pixels. */
export function decodedFrameHashes(file: string): string[] {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').pop()?.trim() ?? '');
}

/** Duration of each stream and of the container, seconds (ffprobe). */
export function durations(file: string): { format: number; video: number | null; audio: number | null } {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(result.stdout) as { format: { duration: string }; streams: { codec_type: string; duration?: string }[] };
  const of = (type: string) => {
    const stream = parsed.streams.find((item) => item.codec_type === type);
    return stream?.duration ? Number(stream.duration) : null;
  };
  return { format: Number(parsed.format.duration), video: of('video'), audio: of('audio') };
}
