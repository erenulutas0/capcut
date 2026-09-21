/**
 * Synthetic media for the silence-suggestion tests (ADR-018), made with
 * ffmpeg on first use into a gitignored folder. Black picture, generated
 * audio: nothing here is real footage or speech.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

export const SILENCE_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'silence');

/** 440 Hz at 0.25 amplitude (−15 dBFS RMS). */
const TONE = '0.25*sin(2*PI*440*t)';

/**
 * Tone bursts with a 1.2 s gap (1.0–2.2 s) and a 0.3 s gap (3.2–3.5 s).
 * With the default settings only the long gap is suggested, shrunk by the
 * 150 ms word margin on both sides: 1.150–2.050 s.
 */
const BURSTS = `(lt(t,1)+gte(t,2.2)*lt(t,3.2)+gte(t,3.5)*lt(t,4.5))`;

export interface SilenceFixture {
  file: string;
  durationS: number;
}

interface Spec {
  name: string;
  durationS: number;
  /** aevalsrc expression, one per channel ("|"-separated). */
  expr: string;
  channels?: number;
  audioBitrate?: string;
  fps?: number;
  sampleRate?: number;
}

const SPECS = {
  bursts: { name: 'bursts.mp4', durationS: 4.5, expr: `${TONE}*${BURSTS}` },
  // Same bursts over −55 dBFS room noise: still a clear silence.
  noisy: {
    name: 'bursts-noisy.mp4',
    durationS: 4.5,
    expr: `${TONE}*${BURSTS}+0.003*(2*random(0)-1)`,
  },
  // Bursts under continuous loud noise: loud and quiet are within a few dB.
  lowContrast: {
    name: 'low-contrast.mp4',
    durationS: 4.5,
    expr: `${TONE}*${BURSTS}+0.2*(2*random(0)-1)`,
  },
  // Several moments' worth of pauses of different lengths, for screenshots.
  showcase: {
    name: 'showcase.mp4',
    durationS: 12,
    expr: `${TONE}*(lt(t,1.6)+gte(t,2.6)*lt(t,4.1)+gte(t,4.4)*lt(t,6)+gte(t,6.5)*lt(t,7.8)+gte(t,9.3)*lt(t,12))`,
  },
  // 1 s tone, 1 s silence, 41 s: 20 inner pauses in one moment, one more
  // cut than the 20-moment limit allows.
  many: { name: 'many-gaps.mp4', durationS: 41, expr: `${TONE}*lt(mod(t,2),1)` },
  // Long, many-channel, 96 kHz audio: enough decoding work (seconds) that the
  // cancel test can press "Durdur" mid-run. Also covers a non-48 kHz rate.
  long: {
    name: 'long-6ch-96k.mp4',
    durationS: 295,
    expr: Array.from({ length: 6 }, () => `${TONE}*lt(mod(t,3),2)`).join('|'),
    channels: 6,
    audioBitrate: '384k',
    fps: 1,
    sampleRate: 96_000,
  },
} satisfies Record<string, Spec>;

export type FixtureName = keyof typeof SPECS;

/** Commas inside a filter argument must be escaped for the filter parser. */
function escapeFilterArg(value: string): string {
  return value.replace(/,/g, '\\,');
}

export function silenceFixture(name: FixtureName): SilenceFixture {
  const spec: Spec = SPECS[name];
  const file = join(SILENCE_MEDIA_DIR, spec.name);
  if (existsSync(file)) return { file, durationS: spec.durationS };
  mkdirSync(SILENCE_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  const channels = spec.channels ?? 1;
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=160x120:r=${spec.fps ?? 30}:d=${spec.durationS}`,
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=exprs=${escapeFilterArg(spec.expr)}:s=${spec.sampleRate ?? 48000}:d=${spec.durationS}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      spec.audioBitrate ?? '128k',
      '-ac',
      String(channels),
      '-ar',
      String(spec.sampleRate ?? 48000),
      '-shortest',
      '-movflags',
      '+faststart',
      partial,
    ],
    { stdio: 'pipe' },
  );
  // Rename only when complete, so an interrupted run never leaves a
  // half-written fixture that later runs would trust.
  renameSync(partial, file);
  return { file, durationS: spec.durationS };
}

/**
 * ffmpeg's own loudness per 10 ms frame of a MONO file's audio (RMS, dBFS):
 * the independent reference the browser envelope is compared with.
 * `-inf` (digital silence) is returned as −Infinity.
 */
export function ffmpegEnvelope(file: string): number[] {
  const name = `${basename(file)}.astats.txt`;
  const out = join(SILENCE_MEDIA_DIR, name);
  rmSync(out, { force: true });
  // Run inside the fixture folder so the metadata file name needs no path
  // escaping in the filter graph (a Windows drive colon would).
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vn',
      '-af',
      `asetnsamples=n=480:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=${name}`,
      '-f',
      'null',
      '-',
    ],
    { stdio: 'pipe', cwd: SILENCE_MEDIA_DIR },
  );
  const values: number[] = [];
  for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
    const match = /^lavfi\.astats\.Overall\.RMS_level=(.+)$/.exec(line.trim());
    if (!match || match[1] === undefined) continue;
    const raw = match[1];
    values.push(raw === '-inf' ? Number.NEGATIVE_INFINITY : Number(raw));
  }
  return values;
}
