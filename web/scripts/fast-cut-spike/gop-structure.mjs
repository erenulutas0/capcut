/**
 * GOP structure of H.264 recordings, for the fast-cut spike (ADR-027): how
 * often a copy can start (IDR pictures), whether key frames that are NOT IDR
 * exist (open GOP / recovery points), reordering depth, in-band parameter
 * sets. Reads headers only (`-c copy`, trace_headers); nothing is decoded.
 *
 *   node scripts/fast-cut-spike/gop-structure.mjs [dir]   (default tests/media/real)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? join(root, 'tests', 'media', 'real'));

// Same ids as run-real-media.mjs: the sorted list of video files.
const names = readdirSync(dir).filter((n) => /\.(mp4|mov|m4v|webm|mkv|3gp|vid)$/i.test(n)).sort();
for (const [index, name] of names.entries()) {
  const path = join(dir, name);
  const info = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name:packet=pts_time,flags', '-of', 'json', path], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const json = JSON.parse(info.stdout);
  if (json.streams?.[0]?.codec_name !== 'h264') continue;
  const packets = json.packets;
  const keys = packets.filter((p) => p.flags.startsWith('K')).map((p) => Number(p.pts_time));
  const gaps = keys.slice(1).map((t, i) => t - keys[i]);
  // Headers of the first 900 access units: which slice types the key frames are.
  const trace = spawnSync('ffmpeg', ['-hide_banner', '-i', path, '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'trace_headers', '-frames:v', '900', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const nal = [...trace.stderr.matchAll(/nal_unit_type\s+\d+\s+=\s+(\d+)/g)].map((m) => Number(m[1]));
  const idr = nal.filter((t) => t === 5).length;
  const sps = nal.filter((t) => t === 7).length;
  const sei = nal.filter((t) => t === 6).length;
  const pts = packets.slice(0, 600).map((p) => Number(p.pts_time));
  let reordered = 0;
  for (let i = 1; i < pts.length; i += 1) if (pts[i] < pts[i - 1]) reordered += 1;
  console.log(
    `R${String(index + 1).padStart(2, '0')} ${name.slice(0, 28).padEnd(28)} key ${String(keys.length).padStart(4)}, ` +
      `anahtar arası ${gaps.length ? `${Math.min(...gaps).toFixed(2)}–${Math.max(...gaps).toFixed(2)} s` : '—'}; ` +
      `ilk 900 AU: IDR dilim NAL ${idr}, SPS ${sps} (1'den çoksa paket içinde), SEI ${sei}; ` +
      `ilk 600 pakette geri giden pts ${reordered}`,
  );
}
