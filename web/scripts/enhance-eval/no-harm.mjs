/**
 * "Does no harm" on real recordings (ADR-037).
 *
 *   node scripts/enhance-eval/no-harm.mjs [--tag=name] [--frames=6] [--strengths=auto] [--set=...]
 *        [--only=R05,R07] [--verbose]   (some recordings only; every frame's measurements)
 *
 * Every SDR video in tests/media/real (local only, never committed), at the
 * size the "İyileştir" wizard would export it (720p for a short edge up to
 * 720, else 1080p): frames spread over the video are measured, the plan for
 * the whole video is made exactly as the export makes it (`planEnhancement`),
 * and each frame is rendered by the reference renderer.
 *
 * There is no "clean" version of a real recording, so what is reported is
 * how far the result moves from the input (SSIM, PSNR, mean luma) and what
 * was decided. The guard that is tested: a video the method judges to be
 * fine already must come back unchanged.
 *
 * File names are not printed: recordings are listed as R01..Rnn in the
 * order of their names, with their size and length only.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeFrames, ffprobeVideo, fitShortEdge, laplacianVariance, loadEnhance, mean, meanLuma, parseArgs, psnr, realMediaDir, resultsDir, round, ssim } from './lib.mjs';
import { tuningWith } from './tuning.mjs';

const args = parseArgs();
const TAG = args.tag ?? 'default';
const FRAMES = Number(args.frames ?? 6);
const enhance = await loadEnhance();
const tuning = tuningWith(enhance.ENHANCE_TUNING, args.set);
const strengths = args.strengths ? String(args.strengths).split(',') : enhance.ENHANCE_STRENGTHS;

const dir = realMediaDir();
const files = readdirSync(dir).filter((name) => /\.(mp4|mov|vid|m4v)$/i.test(name)).sort();
const rows = [];
const only = args.only ? new Set(String(args.only).split(',')) : null;
let index = 0;
for (const name of files) {
  index += 1;
  const id = `R${String(index).padStart(2, '0')}`;
  if (only && !only.has(id)) continue;
  const file = join(dir, name);
  let info;
  try {
    info = ffprobeVideo(file);
  } catch {
    continue;
  }
  if (info.transfer === 'smpte2084' || info.transfer === 'arib-std-b67') {
    console.log(`${id}: HDR (${info.transfer}); measured in the browser, not here`);
    continue;
  }
  const shortEdge = Math.min(info.width, info.height) <= 720 ? 720 : 1080;
  const { width, height } = fitShortEdge(info.width, info.height, shortEdge);
  const frames = [];
  for (let i = 0; i < FRAMES; i += 1) {
    const at = (info.duration * (i + 0.5)) / FRAMES;
    const [rgba] = decodeFrames(file, { at, width, height });
    if (rgba) frames.push({ frame: Math.round(at * 30), rgba });
  }
  if (frames.length === 0) continue;
  const points = frames.map(({ frame, rgba }) => ({ frame, stats: enhance.measureFrame(rgba, width, height, undefined, tuning) }));
  const typical = enhance.typicalStats(points.map((point) => point.stats));
  if (args.verbose) {
    for (const { frame, stats } of points) {
      const tone = enhance.chooseTone(stats, 'auto', tuning);
      console.log(
        `    frame ${frame}: flat ${round(stats.flat, 3)} low ${round(stats.low, 3)} med ${round(stats.median, 3)} high ${round(stats.high, 3)} sat ${round(stats.saturation, 3)} noise ${round(stats.noise, 2)} sharp ${stats.sharpness === null ? '—' : round(stats.sharpness, 3)} -> auto black ${round(tone.black, 4)} gain ${round(tone.gain, 3)}`,
      );
    }
  }
  const line = { id, source: `${info.width}x${info.height}`, exported: `${width}x${height}`, seconds: round(info.duration, 1), typical, strengths: {} };
  for (const strength of strengths) {
    const timeline = enhance.planEnhancement(points, strength, 30, tuning);
    const summary = enhance.summarize(timeline);
    const perFrame = frames.map(({ frame, rgba }) => {
      const params = enhance.paramsAtFrame(timeline, frame);
      const { out } = enhance.renderEnhanced(rgba, width, height, params);
      return {
        params,
        ssim: ssim(out, rgba, width, height),
        psnr: psnr(out, rgba),
        luma: meanLuma(out, width, height) - meanLuma(rgba, width, height),
        sharpness: laplacianVariance(out, width, height) / Math.max(1e-6, laplacianVariance(rgba, width, height)),
      };
    });
    line.strengths[strength] = {
      summary,
      look: timeline.look,
      maxGain: Math.max(...perFrame.map((item) => item.params.gain)),
      maxBlack: Math.max(...perFrame.map((item) => item.params.black)),
      minGamma: Math.min(...perFrame.map((item) => item.params.gamma)),
      minSsim: Math.min(...perFrame.map((item) => item.ssim)),
      meanSsim: mean(perFrame.map((item) => item.ssim)),
      minPsnr: Math.min(...perFrame.map((item) => item.psnr)),
      lumaChange: mean(perFrame.map((item) => item.luma)),
      sharpnessRatio: mean(perFrame.map((item) => item.sharpness)),
    };
  }
  rows.push(line);
  const t = typical;
  console.log(
    `${id} ${line.source}→${line.exported} ${line.seconds}s | flat ${round(t.flat, 3)} low ${round(t.low, 3)} med ${round(t.median, 3)} high ${round(t.high, 3)} sat ${round(t.saturation, 3)} noise ${round(t.noise, 2)} sharp ${t.sharpness === null ? '—' : round(t.sharpness, 3)} gw ${t.greyWorld?.map((v) => round(v, 2)) ?? '—'} wp ${t.whitePatch?.map((v) => round(v, 2)) ?? '—'}`,
  );
  for (const strength of strengths) {
    const s = line.strengths[strength];
    const what = s.summary.nothing ? 'UNCHANGED' : [s.summary.light !== 'none' ? `light:${s.summary.light}` : null, s.summary.colour ? 'colour' : null, s.summary.sharpen ? 'sharpen' : null, s.summary.denoise ? 'denoise' : null].filter(Boolean).join('+');
    console.log(
      `    ${strength.padEnd(6)} ${what.padEnd(34)} gain≤${round(s.maxGain, 2)} black≤${round(s.maxBlack, 3)} gamma≥${round(s.minGamma, 2)} wb ${s.look.whiteBalance.map((v) => round(v, 3))} vib ${round(s.look.vibrance, 3)} dn ${round(s.look.denoise * 255, 1)} sh ${round(s.look.sharpen, 2)} | SSIM vs input min ${round(s.minSsim, 4)} mean ${round(s.meanSsim, 4)} PSNR min ${round(s.minPsnr, 1)} luma ${s.lumaChange >= 0 ? '+' : ''}${round(s.lumaChange, 1)} sharpness ×${round(s.sharpnessRatio, 2)}`,
    );
  }
}

mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, `no-harm-${TAG}.json`), `${JSON.stringify({ tag: TAG, tuning, rows }, null, 1)}\n`);
