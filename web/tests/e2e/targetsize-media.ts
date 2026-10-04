/**
 * Synthetic sources for the target-size and sound-only e2e tests (ADR-035),
 * made with ffmpeg on first use into a gitignored folder. No real footage.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const TARGETSIZE_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'targetsize');

function make(name: string, args: string[]): string {
  const file = join(TARGETSIZE_MEDIA_DIR, name);
  if (existsSync(file)) return file;
  mkdirSync(TARGETSIZE_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, partial], { stdio: 'pipe' });
  renameSync(partial, file);
  return file;
}

/**
 * 8 s of 1280x720 moving noise over a test pattern: far more detail than any
 * encoder can keep at a small size, so a small target forces the software
 * encoder over its bitrate and the correction path has to run.
 */
export function noisyFixture(): string {
  return make('noisy-720p30-8s.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
    '-filter_complex', '[0:v]noise=alls=60:allf=t+u[v]', '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '12M',
    '-c:a', 'aac', '-b:a', '128k',
  ]);
}

/**
 * 14 s of the same noisy picture: about 21 MB, over WhatsApp's 16 MB and under
 * the e-mail and share limits — "Küçült" has one size to really shrink to.
 */
export function noisyLongFixture(): string {
  return make('noisy-720p30-14s.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=14',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=14',
    '-filter_complex', '[0:v]noise=alls=60:allf=t+u[v]', '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '12M',
    '-c:a', 'aac', '-b:a', '128k',
  ]);
}

/**
 * 5 minutes of noisy 640x360 at about 1 Mbit/s (~38 MB): too long for 16 MB
 * with the software encoder's floor, so "Küçült → WhatsApp" has to say no.
 */
export function longNoisyFixture(): string {
  return make('noisy-360p30-300s.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=300',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=300',
    '-filter_complex', '[0:v]noise=alls=40:allf=t+u[v]', '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-b:v', '900k', '-maxrate', '1200k', '-bufsize', '2M',
    '-c:a', 'aac', '-b:a', '96k',
  ]);
}

/** 6 s of 640x360 video with NO audio track. */
export function silentFixture(): string {
  return make('no-audio-360p-6s.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an',
  ]);
}

/**
 * 12 s of 1280x720 video whose sound is a click every second on the second
 * (one sample-accurate impulse train), so where the exported sound starts and
 * ends can be read to the sample.
 */
export function clickFixture(): string {
  return make('clicks-720p30-12s.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12',
    '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,1),0.002),0.8*sin(2*PI*1000*t),0)':s=48000:d=12",
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'aac', '-b:a', '160k',
  ]);
}

export function fileBytes(file: string): number {
  return statSync(file).size;
}

export interface ProbedStreams {
  streams: { type: string; codec: string; durationS: number; sampleRate: number | null }[];
  durationS: number;
  formatName: string;
}

export function probeStreams(file: string): ProbedStreams {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(raw) as {
    streams: { codec_type: string; codec_name: string; duration?: string; sample_rate?: string }[];
    format: { duration: string; format_name: string };
  };
  return {
    streams: parsed.streams.map((stream) => ({
      type: stream.codec_type,
      codec: stream.codec_name,
      durationS: Number(stream.duration),
      sampleRate: stream.sample_rate ? Number(stream.sample_rate) : null,
    })),
    durationS: Number(parsed.format.duration),
    formatName: parsed.format.format_name,
  };
}

/** The decoded sound of `file`, mono 48 kHz float, read from the start (ADR-032: never `-ss` before `-i`). */
export function decodeMono(file: string): Float32Array {
  const raw = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}

/** Sample positions where a click starts: the first loud sample after at least 0.5 s of quiet. */
export function clickPositions(samples: Float32Array, threshold = 0.1): number[] {
  const positions: number[] = [];
  let quietSince = -48_000;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i] ?? 0) >= threshold) {
      if (i - quietSince >= 24_000) positions.push(i);
      quietSince = i;
    }
  }
  return positions;
}
