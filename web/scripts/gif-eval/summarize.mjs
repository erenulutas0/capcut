/**
 * Tables of the GIF quality evaluation (ADR-046 addendum): medians per
 * candidate and footage kind, from `.scratch/gif-eval/<set>*.jsonl`.
 *
 *   node scripts/gif-eval/summarize.mjs --set=method [--base=A]
 *
 * ΔCAMBI = CAMBI of the GIF − CAMBI of the source frames (the banding the GIF adds).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '.scratch', 'gif-eval');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const set = args.set ?? 'method';
const baseId = args.base ?? 'A';

const rows = readdirSync(outDir)
  .filter((f) => f.startsWith(set) && f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(join(outDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

const median = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const max = (values) => Math.max(...values.filter((x) => Number.isFinite(x)));

const groups = new Map();
for (const r of rows) {
  const key = `${r.kind}|${r.longEdge}|${r.fps}|${r.seconds >= 9 ? 10 : 4}|${r.cand}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const lines = [];
const keys = [...groups.keys()].sort();
let lastHead = '';
for (const key of keys) {
  const [kind, longEdge, fps, secs, cand] = key.split('|');
  const head = `${kind} · ${longEdge} px · ${fps} fps · ${secs} s`;
  if (head !== lastHead) {
    lines.push('', `### ${head}`, '', '| aday | n | SSIM | VMAF | ΔCAMBI | bulanık PSNR | VMAF-tel | ΔCAMBI-tel | boyut MB (ortanca / en çok) | süre ms (ortanca / en çok) | ΔSSIM eşli | ΔVMAF eşli | değişen piksel |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    lastHead = head;
  }
  const g = groups.get(key);
  const base = groups.get(`${kind}|${longEdge}|${fps}|${secs}|${baseId}`) ?? [];
  const byClip = new Map(base.map((r) => [r.clip, r]));
  const pairedSsim = median(g.map((r) => r.ssim - (byClip.get(r.clip)?.ssim ?? NaN)));
  const pairedVmaf = median(g.map((r) => r.vmaf - (byClip.get(r.clip)?.vmaf ?? NaN)));
  lines.push(
    `| ${cand} | ${g.length} | ${fmt(median(g.map((r) => r.ssim)), 4)} | ${fmt(median(g.map((r) => r.vmaf)), 2)} | ` +
      `${fmt(median(g.map((r) => r.cambi - r.cambiRef)), 2)} | ${fmt(median(g.map((r) => r.bpsnr)), 1)} | ${fmt(median(g.map((r) => r.vmafPhone)), 1)} | ${fmt(median(g.map((r) => r.cambiPhone - r.cambiPhoneRef)), 2)} | ` +
      `${fmt(median(g.map((r) => r.bytes / 1e6)), 2)} / ${fmt(max(g.map((r) => r.bytes / 1e6)), 2)} | ` +
      `${fmt(median(g.map((r) => r.ms)), 0)} / ${fmt(max(g.map((r) => r.ms)), 0)} | ${fmt(pairedSsim, 4)} | ${fmt(pairedVmaf, 2)} | ${fmt(median(g.map((r) => r.changed)), 2)} |`,
  );
}
console.log(lines.join('\n'));

if (args.clips) {
  // Per clip, one metric: --clips=cambi|bytes|ssim
  const metric = args.clips;
  const value = (r) => (metric === 'cambi' ? r.cambi - r.cambiRef : metric === 'bytes' ? r.bytes / 1e6 : r[metric]);
  const cands = [...new Set(rows.map((r) => r.cand))];
  const clipIds = [...new Set(rows.map((r) => `${r.clip}|${r.longEdge}|${r.seconds}`))];
  console.log(`\n| clip | ${cands.join(' | ')} |\n|---|${cands.map(() => '---').join('|')}|`);
  for (const id of clipIds) {
    const [clip, le, s] = id.split('|');
    const cells = cands.map((c) => {
      const r = rows.find((x) => x.clip === clip && String(x.longEdge) === le && String(x.seconds) === s && x.cand === c);
      return r ? fmt(value(r), metric === 'ssim' ? 4 : 2) : '–';
    });
    console.log(`| ${clip} ${le} ${s}s | ${cells.join(' | ')} |`);
  }
}
