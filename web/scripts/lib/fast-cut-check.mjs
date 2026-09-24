/**
 * Frame identity of a fast-cut download (ADR-027) against its source, with
 * ffmpeg only: which output frames are bit-for-bit the source's decoded
 * frame (copied), and how close the others (re-encoded at the cuts) are.
 *
 * Frames are compared in coded orientation (`-noautorotate`), in
 * presentation order. Moment k of the output holds consecutive source frames
 * starting with the frame on screen at the moment's start (the full encode's
 * rule), so output frame i of moment k is source frame first_k + i.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function ff(args, { binary = false } = {}) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`ffmpeg: ${String(result.stderr).slice(-400)}`);
  return result.stdout;
}

/** `{ pts (s), md5 }` of every decoded frame of `file` in [fromS, toS] (all when omitted), presentation order. */
export function framesWithMd5(file, fromS = null, toS = null) {
  const args = ['-noautorotate'];
  if (fromS !== null) args.push('-ss', String(Math.max(0, fromS - 5)), '-copyts');
  args.push('-i', file, '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'framemd5', '-');
  const text = ff(args);
  const tb = /#tb 0: (\d+)\/(\d+)/.exec(text);
  const unit = tb ? Number(tb[1]) / Number(tb[2]) : 1;
  const frames = text
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(',').map((x) => x.trim());
      return { pts: Number(parts[2]) * unit, md5: parts[parts.length - 1] };
    })
    .sort((a, b) => a.pts - b.pts);
  if (fromS === null) return frames;
  return frames.filter((f) => f.pts >= fromS - 1e-4 && f.pts <= toS + 1e-4);
}

/** Per-frame SSIM ("All") of output frames [a, b) against source frames with pts in [fromS, toS]. */
export function runSsim(outputFile, a, b, sourceFile, fromS, toS) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-ssim-'));
  const stats = join(dir, 's.txt');
  try {
    ff([
      '-noautorotate', '-i', outputFile,
      '-noautorotate', '-ss', String(Math.max(0, fromS - 5)), '-copyts', '-i', sourceFile,
      '-filter_complex',
      `[0:v]select='between(n\\,${a}\\,${b - 1})',setpts=N[o];` +
        `[1:v]select='between(t\\,${(fromS - 0.0005).toFixed(6)}\\,${(toS + 0.0005).toFixed(6)})',setpts=N[s];` +
        `[o][s]ssim=stats_file='${stats.replace(/\\/g, '/').replace(':', '\\:')}'`,
      '-fps_mode', 'passthrough', '-f', 'null', '-',
    ]);
    return readFileSync(stats, 'utf8')
      .split('\n')
      .map((line) => /All:([0-9.]+)/.exec(line)?.[1])
      .filter(Boolean)
      .map(Number);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `moments`: [[fromS, toS], ...] in source seconds, in output order.
 * `fps`: the download's grid (moment boundaries sit on it).
 * Returns per-moment and total counts; `runs` are the non-identical stretches
 * with their SSIM values.
 */
export function fastCutIdentity({ outputFile, sourceFile, moments, fps = 30 }) {
  const output = framesWithMd5(outputFile);
  const result = { frames: output.length, identical: 0, differing: 0, ssim: [], moments: [], offsetsMs: [] };
  let cumulative = 0;
  let index = 0;
  for (const [fromS, toS] of moments) {
    const startS = Math.round(cumulative * fps) / fps;
    cumulative += toS - fromS;
    const endS = Math.round(cumulative * fps) / fps;
    const out = [];
    while (index < output.length && output[index].pts < endS - 1e-4) out.push({ ...output[index++], i: index - 1 });
    const source = framesWithMd5(sourceFile, fromS - 1, toS + 1);
    // The frame on screen at the moment's start; a first frame a little after
    // it (container start offset) counts as the start too.
    let first = source.findLastIndex((f) => f.pts <= fromS + 0.001);
    if (first < 0) first = 0;
    let identical = 0;
    const differing = [];
    out.forEach((frame, k) => {
      const src = source[first + k];
      if (src && src.md5 === frame.md5) {
        identical += 1;
        // Output time minus source time: constant for a copy (the cut offset).
        result.offsetsMs.push(Number(((frame.pts - startS - (src.pts - fromS)) * 1000).toFixed(3)));
      } else {
        differing.push(k);
      }
    });
    // Contiguous stretches of re-encoded frames, scored against the same source frames.
    const runs = [];
    for (const k of differing) {
      const last = runs[runs.length - 1];
      if (last && last[1] === k) last[1] = k + 1;
      else runs.push([k, k + 1]);
    }
    for (const [a, b] of runs) {
      const from = source[first + a];
      const to = source[first + b - 1];
      if (!from || !to) continue;
      result.ssim.push(...runSsim(outputFile, out[a].i, out[b - 1].i + 1, sourceFile, from.pts, to.pts));
    }
    result.identical += identical;
    result.differing += differing.length;
    result.moments.push({ frames: out.length, identical, differing: differing.length, runs });
  }
  result.ssimMin = result.ssim.length ? Math.min(...result.ssim) : null;
  result.ssimMean = result.ssim.length ? result.ssim.reduce((x, y) => x + y, 0) / result.ssim.length : null;
  const offsets = result.offsetsMs;
  result.offsetSpreadMs = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : null;
  return result;
}
