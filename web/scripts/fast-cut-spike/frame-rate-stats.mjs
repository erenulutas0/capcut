/**
 * Frame timing of recordings, for the "at most 30 fps" rule (ADR-027, policy
 * v6): how a variable-rate phone file should be judged. Reads packet
 * timestamps only (ffprobe); nothing is decoded.
 *
 * For every video: mean rate, median and shortest frame interval (as a rate),
 * and the most frame starts in any 1 s window (sliding, half-open) — the
 * candidates for the rule.
 *
 *   node scripts/fast-cut-spike/frame-rate-stats.mjs [dir]   (default tests/media/real)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? join(root, 'tests', 'media', 'real'));

const names = readdirSync(dir).filter((n) => /\.(mp4|mov|m4v|webm|mkv|3gp|vid)$/i.test(n)).sort();
for (const [index, name] of names.entries()) {
  const out = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,time_base:packet=pts', '-of', 'json', join(dir, name)],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 },
  );
  const json = JSON.parse(out.stdout);
  const [num, den] = json.streams[0].time_base.split('/').map(Number);
  const tb = num / den;
  const pts = json.packets.map((p) => Number(p.pts) * tb).sort((a, b) => a - b);
  const deltas = pts.slice(1).map((t, i) => t - pts[i]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  let windowMax = 0;
  let j = 0;
  for (let i = 0; i < pts.length; i += 1) {
    while (pts[j] < pts[i] - 1 + 1e-9) j += 1;
    windowMax = Math.max(windowMax, i - j + 1);
  }
  const span = pts[pts.length - 1] - pts[0];
  const over = deltas.filter((d) => d < 1 / 30 - 0.0015).length;
  console.log(
    `R${String(index + 1).padStart(2, '0')} ${json.streams[0].codec_name.padEnd(5)} ` +
      `ortalama ${((pts.length - 1) / span).toFixed(3)} fps, medyan ${(1 / q(0.5)).toFixed(2)}, ` +
      `%1 ${(1 / q(0.01)).toFixed(2)}, en kısa ${(1 / sorted[0]).toFixed(1)} fps; ` +
      `1 s pencerede en çok ${windowMax} kare; 1/30 s'den kısa aralık ${over}/${deltas.length}`,
  );
}
