/**
 * ADR-035: what plays a sound-only M4A the app produced.
 *
 *   node scripts/check-audio-playback.mjs <file.m4a> [more files...]
 *
 * For every file:
 * - ffprobe: container, tracks, codec, the stated duration;
 * - ffmpeg: the decoded sound (the reference: how many samples it holds);
 * - Windows Media Foundation (`mf-audio.ps1`, headless): decodes it to WAV;
 *   its length and where its sound sits against ffmpeg's decode;
 * - Chrome and Edge: an `<audio>` element (duration, plays, no error) and
 *   `decodeAudioData` (sample count, position against ffmpeg's decode).
 *
 * Nothing is uploaded: the browsers get the file through a file input on a
 * blank page.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = process.argv.slice(2).map((file) => resolve(file));
if (files.length === 0) {
  console.error('usage: node scripts/check-audio-playback.mjs <file.m4a> ...');
  process.exit(2);
}
const RATE = 48_000;
const workDir = join(root, 'matrix-results', 'target-size', 'playback-work');
mkdirSync(workDir, { recursive: true });

function decode(file) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  return new Float32Array(result.stdout.buffer, result.stdout.byteOffset, Math.floor(result.stdout.byteLength / 4));
}

/** Lag of `other` against `reference` in samples (positive: `other` is late), over ±4096 samples of 2 s of sound. */
function lagSamples(reference, other) {
  const from = Math.min(RATE, Math.max(0, Math.floor(reference.length / 4)));
  const length = Math.min(2 * RATE, reference.length - from - 4096, other.length - from - 4096);
  if (length < RATE / 2) return null;
  let best = { lag: 0, score: -Infinity };
  for (let lag = -4096; lag <= 4096; lag += 1) {
    let dot = 0;
    for (let i = 0; i < length; i += 4) dot += reference[from + i] * (other[from + lag + i] ?? 0);
    if (dot > best.score) best = { lag, score: dot };
  }
  return best.lag;
}

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  const json = JSON.parse(result.stdout || '{}');
  return {
    format: json.format?.format_name ?? null,
    brand: json.format?.tags?.major_brand ?? null,
    durationS: Number(json.format?.duration),
    tracks: (json.streams ?? []).map((stream) => `${stream.codec_type}:${stream.codec_name}/${stream.profile ?? ''}`),
    sampleRate: Number(json.streams?.[0]?.sample_rate),
    channels: json.streams?.[0]?.channels ?? null,
    bitRate: Number(json.streams?.[0]?.bit_rate),
  };
}

function mediaFoundation(file, reference) {
  const wav = join(workDir, `${basename(file)}.mf.wav`);
  rmSync(wav, { force: true });
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'mf-audio.ps1'), '-In', file, '-Out', wav],
    { encoding: 'utf8' },
  );
  const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split(/\r?\n/).pop() ?? '';
  if (result.status !== 0 || !existsSync(wav)) return { ok: false, said: said.slice(0, 200) };
  const decoded = decode(wav);
  rmSync(wav, { force: true });
  if (!decoded) return { ok: false, said: 'WAV could not be read back' };
  return {
    ok: true,
    samples: decoded.length,
    deltaSamples: decoded.length - reference.length,
    lagSamples: lagSamples(reference, decoded),
  };
}

async function inBrowser(channel, file, reference) {
  const browser = await chromium.launch({ channel, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><input type="file" id="f"><audio id="a" controls></audio>');
    await page.locator('#f').setInputFiles(file);
    const answer = await page.evaluate(async (rate) => {
      const file = document.getElementById('f').files[0];
      const audio = document.getElementById('a');
      const out = { type: file.type, canPlayType: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"') };
      audio.src = URL.createObjectURL(file);
      await new Promise((resolve) => {
        audio.addEventListener('loadedmetadata', resolve, { once: true });
        audio.addEventListener('error', resolve, { once: true });
      });
      out.error = audio.error ? audio.error.code : null;
      out.duration = audio.duration;
      if (!audio.error) {
        audio.muted = true;
        await audio.play().catch((error) => {
          out.playError = error.name;
        });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        out.currentTimeAfter1s = audio.currentTime;
        audio.pause();
        // To the end: the element must reach `ended` at its stated duration.
        audio.currentTime = Math.max(0, audio.duration - 0.3);
        await audio.play().catch(() => undefined);
        await new Promise((resolve) => {
          audio.addEventListener('ended', resolve, { once: true });
          setTimeout(resolve, 3000);
        });
        out.ended = audio.ended;
        out.endTime = audio.currentTime;
      }
      const context = new OfflineAudioContext(1, rate, rate);
      try {
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        out.decoded = { sampleRate: buffer.sampleRate, length: buffer.length, channels: buffer.numberOfChannels };
        const data = buffer.getChannelData(0);
        const other = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data;
        // Mono mix of 3 s from 1 s in, for the position check (as numbers, not bytes).
        const from = Math.min(rate, Math.floor(buffer.length / 4));
        const slice = [];
        for (let i = Math.max(0, from - 4096); i < Math.min(buffer.length, from + 2 * rate + 4096); i += 1) {
          slice.push((data[i] + other[i]) / 2);
        }
        out.slice = { start: Math.max(0, from - 4096), samples: slice };
      } catch (error) {
        out.decodeError = error.name;
      }
      return out;
    }, RATE);
    if (answer.slice && answer.decoded?.sampleRate === RATE) {
      // Rebuild a sparse array aligned to absolute positions, then compare with ffmpeg's decode.
      const browserDecoded = new Float32Array(reference.length + 8192);
      browserDecoded.set(answer.slice.samples.slice(0, browserDecoded.length - answer.slice.start), answer.slice.start);
      answer.lagSamples = lagSamples(reference, browserDecoded);
      answer.deltaSamples = answer.decoded.length - reference.length;
    }
    delete answer.slice;
    return { version: browser.version(), ...answer };
  } finally {
    await browser.close();
  }
}

for (const file of files) {
  const reference = decode(file);
  const row = { file: basename(file), ffprobe: probe(file), ffmpegSamples: reference?.length ?? null };
  if (reference) {
    row.ffmpegDurationS = reference.length / RATE;
    row.mediaFoundation = mediaFoundation(file, reference);
    row.chrome = await inBrowser('chrome', file, reference);
    row.edge = await inBrowser('msedge', file, reference);
  }
  console.log(JSON.stringify(row, null, 1));
}
rmSync(workDir, { recursive: true, force: true });
