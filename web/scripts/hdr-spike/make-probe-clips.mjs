/**
 * Encodes the app's synthetic HDR check frame (src/domain/hdr.ts) as real
 * video, so the SAME patches can be decoded by a browser's hardware decoder
 * (HEVC Main 10) and its software decoder (VP9 profile 2), with and without
 * HDR10 metadata. Answers: does a decoded frame go through the same
 * conversion as the constructed `VideoFrame` of the runtime check?
 *
 *   node scripts/hdr-spike/make-probe-clips.mjs [--out=hdr-spike-results/probe-clips]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='));
const out = resolve(outArg ? outArg.slice(6) : join(webRoot, 'hdr-spike-results', 'probe-clips'));
mkdirSync(out, { recursive: true });

const ts = (await import('typescript')).default;
const js = ts.transpileModule(readFileSync(join(webRoot, 'src', 'domain', 'hdr.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
writeFileSync(join(out, 'hdr.mjs'), js);
const hdr = await import(pathToFileURL(join(out, 'hdr.mjs')).href);

/** Upscales the 16 px patch row to `scale` x, as planar yuv420p10le. */
function frameYuv(transfer, scale) {
  const f = hdr.buildProbeFrame(transfer);
  const w = f.width * scale;
  const h = f.height * scale;
  const y = new Uint16Array(w * h);
  const cw = f.width / 2;
  const ch = f.height / 2;
  const u = new Uint16Array((w / 2) * (h / 2));
  const v = new Uint16Array((w / 2) * (h / 2));
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      y[row * w + col] = f.data[Math.floor(row / scale) * f.width + Math.floor(col / scale)];
    }
  }
  const cbOffset = f.width * f.height;
  const crOffset = cbOffset + cw * ch;
  for (let row = 0; row < h / 2; row += 1) {
    for (let col = 0; col < w / 2; col += 1) {
      const src = Math.floor(row / scale) * cw + Math.floor(col / scale);
      u[row * (w / 2) + col] = f.data[cbOffset + src];
      v[row * (w / 2) + col] = f.data[crOffset + src];
    }
  }
  return { w, h, bytes: Buffer.concat([Buffer.from(y.buffer), Buffer.from(u.buffer), Buffer.from(v.buffer)]) };
}

const SCALE = Number(process.argv.slice(2).find((a) => a.startsWith('--scale='))?.slice(8) ?? 16);
const FRAMES = 30;
for (const transfer of ['pq', 'hlg']) {
  const { w, h, bytes } = frameYuv(transfer, SCALE);
  const raw = join(out, `${transfer}.yuv`);
  writeFileSync(raw, Buffer.concat(Array.from({ length: FRAMES }, () => bytes)));
  const trc = transfer === 'pq' ? 'smpte2084' : 'arib-std-b67';
  const input = ['-f', 'rawvideo', '-pix_fmt', 'yuv420p10le', '-s', `${w}x${h}`, '-r', '30', '-i', raw];
  // setparams, not -color_trc: libvpx only carries the tags from the frames.
  const tags = ['-vf', `setparams=color_primaries=bt2020:color_trc=${trc}:colorspace=bt2020nc:range=tv`];
  const x265 = (extra) =>
    `colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc:range=limited${extra}`;
  const variants = [
    { name: `${transfer}-hevc.mp4`, args: ['-c:v', 'libx265', '-preset', 'fast', '-crf', '4', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', x265('')] },
    ...(transfer === 'pq'
      ? [{
          name: 'pq-hevc-hdr10meta.mp4',
          args: ['-c:v', 'libx265', '-preset', 'fast', '-crf', '4', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
            '-x265-params', x265(':hdr10=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,200')],
        }]
      : []),
    { name: `${transfer}-vp9.mp4`, args: ['-c:v', 'libvpx-vp9', '-profile:v', '2', '-pix_fmt', 'yuv420p10le', '-crf', '4', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4'] },
  ];
  for (const variant of variants) {
    const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-v', 'error', ...input, ...variant.args, ...tags, join(out, variant.name)], { encoding: 'utf8' });
    console.log(variant.name, result.status === 0 ? 'ok' : result.stderr.slice(0, 300), `${w}x${h}`);
  }
}
