/**
 * Independent checks of a fast-cut output against its source, with ffmpeg
 * and ffprobe only (they know nothing about our muxer or our encoder).
 *
 * - frames: ffprobe packet count and presentation times of the output;
 * - identity: `framemd5` of every output frame against the source frames it
 *   must show — copied frames must be bit-exact, re-encoded seam frames are
 *   scored with SSIM against the same source frames;
 * - barcode (synthetic sources): the frame number burned into every output
 *   frame must be exactly the source frame the plan asked for;
 * - clicks (synthetic sources): audio click onsets against the output time of
 *   the frame that starts at the same source second.
 *
 * `-noautorotate` everywhere: frames are compared in coded orientation.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(cmd, args, { binary = false } = {}) {
  const result = spawnSync(cmd, args, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 8).join(' ')}…: ${String(result.stderr).slice(-600)}`);
  }
  return result;
}

/** Presentation times (s) of every video packet, ascending, plus the container duration. */
export function probeVideo(file) {
  const out = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,flags:format=duration:stream=nb_frames,codec_tag_string,profile,width,height',
    '-of', 'json', file,
  ]).stdout;
  const json = JSON.parse(out);
  const times = json.packets.map((p) => Number(p.pts_time)).sort((a, b) => a - b);
  const keys = json.packets.filter((p) => p.flags.startsWith('K')).length;
  return {
    packets: times.length,
    keys,
    times,
    duration: Number(json.format.duration),
    stream: json.streams[0],
  };
}

/** md5 of every decoded frame of `file` whose time lies in [fromS, toS] (all when omitted). */
export function frameMd5(file, fromS = null, toS = null) {
  const args = ['-hide_banner', '-loglevel', 'error', '-noautorotate'];
  if (fromS !== null) args.push('-ss', String(Math.max(0, fromS - 4)), '-copyts');
  args.push('-i', file, '-map', '0:v:0');
  if (fromS !== null) {
    args.push('-vf', `select='between(t\\,${(fromS - 0.0005).toFixed(6)}\\,${(toS + 0.0005).toFixed(6)})'`);
  }
  args.push('-fps_mode', 'passthrough', '-f', 'framemd5', '-');
  const out = run('ffmpeg', args).stdout;
  return out
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(',').map((x) => x.trim());
      return parts[parts.length - 1];
    });
}

/** Per-frame SSIM (luma+chroma "All") of output frames [a, b) against source frames at times [fromS, toS]. */
export function seamSsim(outputFile, a, b, sourceFile, fromS, toS) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-ssim-'));
  const stats = join(dir, 'ssim.txt');
  try {
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-noautorotate',
      '-i', outputFile,
      '-noautorotate', '-ss', String(Math.max(0, fromS - 4)), '-copyts', '-i', sourceFile,
      '-filter_complex',
      `[0:v]select='between(n\\,${a}\\,${b - 1})',setpts=N[o];` +
        `[1:v]select='between(t\\,${(fromS - 0.0005).toFixed(6)}\\,${(toS + 0.0005).toFixed(6)})',setpts=N[s];` +
        `[o][s]ssim=stats_file='${stats.replace(/\\/g, '/').replace(':', '\\:')}'`,
      '-fps_mode', 'passthrough', '-f', 'null', '-',
    ]);
    const values = readFileSync(stats, 'utf8')
      .split('\n')
      .map((line) => /All:([0-9.]+)/.exec(line)?.[1])
      .filter(Boolean)
      .map(Number);
    return values;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Frame numbers from the burned barcode of every output frame (coded orientation). */
export function barcodes(file, { from = 0, count = null } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-noautorotate', '-i', file, '-map', '0:v:0'];
  const select = count !== null ? `select='between(n\\,${from}\\,${from + count - 1})',` : '';
  args.push('-vf', `${select}crop=1280:48:0:0,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1');
  const buffer = run('ffmpeg', args, { binary: true }).stdout;
  const frameSize = 1280 * 48;
  const frames = [];
  for (let offset = 0; offset + frameSize <= buffer.length; offset += frameSize) {
    let value = 0;
    let weakest = 255;
    for (let bit = 0; bit < 20; bit += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          sum += buffer[offset + (24 + dy) * 1280 + bit * 64 + 32 + dx];
          n += 1;
        }
      }
      const lum = sum / n;
      weakest = Math.min(weakest, Math.abs(lum - 128));
      if (lum > 128) value += 2 ** bit;
    }
    frames.push({ frame: value, confidence: weakest });
  }
  return frames;
}

/** Click onsets (s) in the output's audio: first sample above `threshold` after 0.3 s of quiet. */
export function clickOnsets(file, threshold = 0.2) {
  const pcm = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { binary: true }).stdout;
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  const onsets = [];
  let last = -Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > threshold && i - last > 0.3 * 48000) {
      onsets.push(i / 48000);
      last = i;
    } else if (Math.abs(samples[i]) > threshold) {
      last = i;
    }
  }
  return onsets;
}

/**
 * Full check of one fast-cut output. `result` is what the spike page (or the
 * app's measurement) reported: per moment the first/last source frame time
 * and how many frames were re-encoded before and after the copied run.
 */
export function verifyCut({ outputFile, sourceFile, result, fps = null, barcode = false, clicks = false, full = true }) {
  const report = { checks: [] };
  const check = (label, ok, detail = '') => report.checks.push({ label, ok, detail });
  const out = probeVideo(outputFile);
  report.output = { packets: out.packets, keys: out.keys, duration: out.duration, codecTag: out.stream.codec_tag_string };
  const expectedFrames = result.segments.reduce((sum, s) => sum + s.frames, 0);
  check('ffprobe: kare sayısı planla aynı', out.packets === expectedFrames, `${out.packets} / ${expectedFrames}`);
  const expectedDuration = result.plan.expectedDurationUs / 1e6;
  check(
    'ffprobe: süre planla aynı (±1 kare)',
    Math.abs(out.duration - expectedDuration) <= 1 / (fps ?? 30) + 0.002,
    `${out.duration.toFixed(4)} s / ${expectedDuration.toFixed(4)} s`,
  );
  const expectedTimes = result.segments.flatMap((s) => s.outputTimesS);
  let worstPts = 0;
  for (let i = 0; i < Math.min(out.times.length, expectedTimes.length); i += 1) {
    worstPts = Math.max(worstPts, Math.abs(out.times[i] - expectedTimes[i]));
  }
  check('ffprobe: her karenin zamanı plandaki gibi', worstPts < 0.0015, `en kötü ${(worstPts * 1000).toFixed(3)} ms`);

  // Frame identity, segment by segment.
  const identity = { copied: 0, copiedExact: 0, seamFrames: 0, seamSsim: [] };
  const outMd5 = full ? frameMd5(outputFile) : null;
  let outIndex = 0;
  for (const segment of result.segments) {
    if (full) {
      const src = frameMd5(sourceFile, segment.firstSourceS, segment.lastSourceS);
      check(`kaynakta aralığın kare sayısı (${segment.firstSourceS.toFixed(3)}–${segment.lastSourceS.toFixed(3)} s)`, src.length === segment.frames, `${src.length} / ${segment.frames}`);
      for (let k = segment.head; k < segment.head + segment.copied; k += 1) {
        identity.copied += 1;
        if (outMd5[outIndex + k] === src[k]) identity.copiedExact += 1;
      }
    }
    const runs = [];
    if (segment.head > 0) runs.push([0, segment.head]);
    if (segment.tail > 0) runs.push([segment.frames - segment.tail, segment.frames]);
    for (const [a, b] of runs) {
      const times = segment.sourceTimesS ?? null;
      const fromS = times ? times[a] : segment.firstSourceS + a / (fps ?? 30);
      const toS = times ? times[b - 1] : segment.firstSourceS + (b - 1) / (fps ?? 30);
      const values = seamSsim(outputFile, outIndex + a, outIndex + b, sourceFile, fromS, toS);
      identity.seamFrames += values.length;
      identity.seamSsim.push(...values);
      if (values.length !== b - a) check(`dikiş karesi eşleşmesi ${a}–${b}`, false, `${values.length} / ${b - a}`);
    }
    outIndex += segment.frames;
  }
  if (full) {
    check('kopyalanan kareler kaynakla bit bit aynı (framemd5)', identity.copied > 0 && identity.copied === identity.copiedExact, `${identity.copiedExact} / ${identity.copied}`);
  }
  if (identity.seamSsim.length > 0) {
    const min = Math.min(...identity.seamSsim);
    const mean = identity.seamSsim.reduce((a, b) => a + b, 0) / identity.seamSsim.length;
    identity.seamSsimMin = Number(min.toFixed(4));
    identity.seamSsimMean = Number(mean.toFixed(4));
    check('yeniden kodlanan dikiş kareleri SSIM ≥ 0.85', min >= 0.85, `en düşük ${min.toFixed(4)}, ort. ${mean.toFixed(4)} (${identity.seamSsim.length} kare)`);
  }
  delete identity.seamSsim;
  report.identity = identity;

  if (barcode && fps) {
    const codes = barcodes(outputFile);
    let wrong = 0;
    let i = 0;
    const firstWrong = [];
    for (const segment of result.segments) {
      const first = Math.round(segment.firstSourceS * fps);
      for (let k = 0; k < segment.frames; k += 1, i += 1) {
        if (codes[i]?.frame !== first + k) {
          wrong += 1;
          if (firstWrong.length < 5) firstWrong.push(`${i}:${codes[i]?.frame}≠${first + k}`);
        }
      }
    }
    check('barkod: her çıktı karesi işaretlenen kaynak karesi', wrong === 0 && codes.length === i, `${i - wrong}/${i} doğru ${firstWrong.join(' ')}`);
  }

  if (clicks && fps) {
    // Output time of the frame that starts each whole source second.
    const onsets = clickOnsets(outputFile);
    const errors = [];
    let offset = 0;
    for (const segment of result.segments) {
      for (let k = 0; k < segment.frames; k += 1) {
        const sourceTime = segment.firstSourceS + k / fps;
        const second = Math.round(sourceTime);
        if (Math.abs(sourceTime - second) < 0.5 / fps && k > 0) {
          const expected = segment.outputTimesS[k];
          const nearest = onsets.reduce((best, t) => (Math.abs(t - expected) < Math.abs(best - expected) ? t : best), Infinity);
          errors.push(nearest - expected);
        }
      }
      offset += segment.frames;
    }
    const worst = errors.reduce((m, e) => Math.max(m, Math.abs(e)), 0);
    report.audioSync = { clicks: errors.length, worstMs: Number((worst * 1000).toFixed(2)), errorsMs: errors.map((e) => Number((e * 1000).toFixed(2))) };
    check('ses: tıklar karelerle hizalı (≤ 1 AAC karesi, 21,3 ms)', errors.length > 0 && worst <= 1024 / 48000, `${errors.length} tık, en kötü ${(worst * 1000).toFixed(2)} ms`);
  }
  report.ok = report.checks.every((c) => c.ok);
  return report;
}
