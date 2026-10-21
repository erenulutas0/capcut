/**
 * Tables and the pre-registered rule of round 2 (ADR-046 addendum 2), from
 * `.scratch/gif-eval/r2-<phase>.jsonl`.
 *
 *   node scripts/gif-eval/round2-summarize.mjs --phase=resample|transparency|sizes
 *
 * The rule is applied exactly as written in the ADR, step by step; every
 * number it looks at is printed next to its verdict.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '.scratch', 'gif-eval');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const phase = args.phase ?? 'resample';
const rows = readdirSync(outDir)
  .filter((f) => f === `r2-${phase}${args.tag ? `-${args.tag}` : ''}.jsonl`)
  .flatMap((f) => readFileSync(join(outDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const max = (values) => Math.max(...values.filter(Number.isFinite));
const min = (values) => Math.min(...values.filter(Number.isFinite));
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const sel = (q) => rows.filter((r) => !r.check && Object.entries(q).every(([k, v]) => r[k] === v));
const by = (list, key) => new Map(list.map((r) => [key(r), r]));

if (phase === 'resample' || phase === 'resample2' || phase === 'resample3') {
  const sizes = [320, 480, 640];
  const variants = [...new Set(rows.map((r) => r.variant))];
  for (const kind of ['gercek', 'yapay']) {
    console.log(`\n### ${kind}\n`);
    console.log('| aday | boyut | n | VMAF-tel | VMAF-tel-NEG | SSIM-tel | ΔCAMBI-tel | bayt MB ortanca / en çok | çizme ms/kare ortanca | kodlama ms |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const v of variants) {
      for (const e of sizes) {
        const g = sel({ kind, variant: v, longEdge: e });
        console.log(
          `| ${v} | ${e} | ${g.length} | ${f(median(g.map((r) => r.vmafTel)), 1)} | ${f(median(g.map((r) => r.negTel)), 1)} | ${f(median(g.map((r) => r.ssimTel)), 4)} | ` +
            `${f(median(g.map((r) => r.dCambiTel)))} | ${f(median(g.map((r) => r.bytes / 1e6)))} / ${f(max(g.map((r) => r.bytes / 1e6)))} | ${f(median(g.map((r) => r.captureMsPerFrame)), 1)} | ${f(median(g.map((r) => r.encodeMs)), 0)} |`,
        );
      }
    }
  }
  // The rule, step 1.
  const score = (kind, v) => sizes.reduce((s, e) => s + median(sel({ kind, variant: v, longEdge: e }).map((r) => r.negTel)), 0) / sizes.length;
  const high = 'high';
  console.log('\n### Kural, adım 1\n');
  const eligible = [];
  for (const v of variants) {
    const notes = [];
    let ok = true;
    // (a) drawing time at Büyük (640), real set.
    const hv = by(sel({ kind: 'gercek', variant: high, longEdge: 640 }), (r) => r.clip);
    const diffs = sel({ kind: 'gercek', variant: v, longEdge: 640 }).map((r) => r.captureMsPerFrame - (hv.get(r.clip)?.captureMsPerFrame ?? NaN));
    const medDiff = median(sel({ kind: 'gercek', variant: v, longEdge: 640 }).map((r) => r.captureMsPerFrame)) - median([...hv.values()].map((r) => r.captureMsPerFrame));
    const worst = max(diffs);
    if (!(medDiff <= 15 && worst <= 40)) ok = false;
    notes.push(`(a) süre +${f(medDiff, 1)} ms ortanca, en kötü kayıt +${f(worst, 1)} ms`);
    // (b) bytes per size, real set.
    for (const e of sizes) {
      const ratio = median(sel({ kind: 'gercek', variant: v, longEdge: e }).map((r) => r.bytes)) / median(sel({ kind: 'gercek', variant: high, longEdge: e }).map((r) => r.bytes));
      if (!(ratio <= 1.05)) ok = false;
      notes.push(`(b) ${e}: bayt ×${f(ratio, 3)}`);
    }
    // (c) SSIM-tel per size, real and synthetic; sharpened: NEG not below its unsharpened self.
    for (const kind of ['gercek', 'yapay']) {
      for (const e of sizes) {
        const d = median(sel({ kind, variant: v, longEdge: e }).map((r) => r.ssimTel)) - median(sel({ kind, variant: high, longEdge: e }).map((r) => r.ssimTel));
        if (!(d >= -0.002)) ok = false;
        notes.push(`(c) ${kind} ${e}: SSIM-tel ${d >= 0 ? '+' : ''}${f(d, 4)}`);
      }
    }
    if (v.includes('+s')) {
      const base = v.split('+')[0];
      for (const e of sizes) {
        const d = median(sel({ kind: 'gercek', variant: v, longEdge: e }).map((r) => r.negTel)) - median(sel({ kind: 'gercek', variant: base, longEdge: e }).map((r) => r.negTel));
        if (!(d >= 0)) ok = false;
        notes.push(`(c) NEG ${e} − ${base}: ${f(d, 2)}`);
      }
    }
    const s = score('gercek', v);
    const sy = score('yapay', v);
    console.log(`- **${v}** puan ${f(s)} (yapay ${f(sy)}) — ${ok ? 'UYGUN' : 'uygun değil'}: ${notes.join('; ')}`);
    if (ok) eligible.push({ v, s, sy, bytes480: median(sel({ kind: 'gercek', variant: v, longEdge: 480 }).map((r) => r.bytes)) });
  }
  const best = Math.max(...eligible.map((e) => e.s));
  const near = eligible.filter((e) => e.s >= best - 0.3).sort((a, b) => a.bytes480 - b.bytes480);
  const winner = near[0];
  const h = eligible.find((e) => e.v === high) ?? { s: score('gercek', high), sy: score('yapay', high), bytes480: median(sel({ kind: 'gercek', variant: high, longEdge: 480 }).map((r) => r.bytes)) };
  console.log(`\nKazanan: ${winner?.v} (puan ${f(winner?.s)}; high ${f(h.s)}; fark ${f(winner?.s - h.s)}; Orta bayt ×${f(winner?.bytes480 / h.bytes480, 3)}; yapay fark ${f(winner?.sy - h.sy)})`);
  if (winner && winner.v !== high) {
    const gain = winner.s - h.s;
    const passes = (gain >= 2.0 || (gain >= 1.0 && winner.bytes480 / h.bytes480 <= 0.95)) && winner.sy - h.sy >= -1.0;
    console.log(passes ? `GEÇER: ${winner.v} bugünkünün yerine` : 'GEÇMEZ: bugünkü (high) kalır');
  }
  // Per clip, NEG at each size, for the table in the ADR.
  console.log('\n| kayıt | ' + variants.map((v) => v).join(' | ') + ' |');
  for (const e of sizes) {
    for (const clip of [...new Set(rows.map((r) => r.clip))]) {
      const cells = variants.map((v) => f(sel({ clip, variant: v, longEdge: e })[0]?.negTel, 1));
      console.log(`| ${clip} ${e} | ${cells.join(' | ')} |`);
    }
  }
}

if (phase === 'transparency') {
  const ts = ['T0', 'T2', 'T3', 'T4', 'T0c', 'T3c'];
  for (const kind of ['gercek', 'yapay']) {
    for (const seconds of [4, 10]) {
      console.log(`\n### ${kind} · ${seconds} sn\n`);
      console.log('| aday | boyut | n | VMAF-tel-NEG | VMAF-tel | SSIM-tel | ΔCAMBI-tel | SSIM | SSIM 5. yüzdelik | VMAF | bayt MB ortanca / en çok | > 10 MB | kodlama ms |');
      console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const t of ts) {
        for (const e of [480, 640]) {
          const g = sel({ kind, cand: t, longEdge: e, seconds });
          if (g.length === 0) continue;
          console.log(
            `| ${t} | ${e} | ${g.length} | ${f(median(g.map((r) => r.negTel)), 1)} | ${f(median(g.map((r) => r.vmafTel)), 1)} | ${f(median(g.map((r) => r.ssimTel)), 4)} | ${f(median(g.map((r) => r.dCambiTel)))} | ` +
              `${f(median(g.map((r) => r.ssim)), 4)} | ${f(median(g.map((r) => r.ssimP5)), 4)} | ${f(median(g.map((r) => r.vmaf)), 1)} | ${f(median(g.map((r) => r.bytes / 1e6)))} / ${f(max(g.map((r) => r.bytes / 1e6)))} | ` +
              `${g.filter((r) => r.bytes > 10_000_000).length} | ${f(median(g.map((r) => r.encodeMs)), 0)} |`,
          );
        }
      }
    }
  }
  console.log('\n### Kural, adım 2\n');
  const paired = (kind, t, e, seconds, key) => {
    const base = by(sel({ kind, cand: 'T0', longEdge: e, seconds }), (r) => r.clip);
    return sel({ kind, cand: t, longEdge: e, seconds }).map((r) => r[key] - (base.get(r.clip)?.[key] ?? NaN));
  };
  const okTs = [];
  for (const t of ['T2', 'T3', 'T4']) {
    let ok = true;
    const notes = [];
    for (const e of [480, 640]) {
      const dNeg = median(sel({ kind: 'gercek', cand: t, longEdge: e, seconds: 4 }).map((r) => r.negTel)) - median(sel({ kind: 'gercek', cand: 'T0', longEdge: e, seconds: 4 }).map((r) => r.negTel));
      const worst = min(paired('gercek', t, e, 4, 'negTel'));
      const dNegY = median(sel({ kind: 'yapay', cand: t, longEdge: e, seconds: 4 }).map((r) => r.negTel)) - median(sel({ kind: 'yapay', cand: 'T0', longEdge: e, seconds: 4 }).map((r) => r.negTel));
      if (!(dNeg >= -1.0 && worst >= -2.5 && dNegY >= -1.0)) ok = false;
      notes.push(`(a) ${e}: NEG ${f(dNeg)} (en kötü kayıt ${f(worst)}; yapay ${f(dNegY)})`);
      for (const kind of ['gercek', 'yapay']) {
        const dS = median(sel({ kind, cand: t, longEdge: e, seconds: 4 }).map((r) => r.ssim)) - median(sel({ kind, cand: 'T0', longEdge: e, seconds: 4 }).map((r) => r.ssim));
        const dP = median(sel({ kind, cand: t, longEdge: e, seconds: 4 }).map((r) => r.ssimP5)) - median(sel({ kind, cand: 'T0', longEdge: e, seconds: 4 }).map((r) => r.ssimP5));
        if (!(dS >= -0.004 && dP >= -0.01)) ok = false;
        notes.push(`(b) ${kind} ${e}: SSIM ${f(dS, 4)}, 5. yüzdelik ${f(dP, 4)}`);
      }
      const dC = median(sel({ kind: 'gercek', cand: t, longEdge: e, seconds: 4 }).map((r) => r.dCambiTel)) - median(sel({ kind: 'gercek', cand: 'T0', longEdge: e, seconds: 4 }).map((r) => r.dCambiTel));
      if (!(dC <= 0.3)) ok = false;
      notes.push(`(c) ${e}: ΔCAMBI-tel +${f(dC)}`);
    }
    const shrink = [480, 640].map((e) => median(sel({ kind: 'gercek', cand: t, longEdge: e, seconds: 10 }).map((r) => r.bytes)) / median(sel({ kind: 'gercek', cand: 'T0', longEdge: e, seconds: 10 }).map((r) => r.bytes)));
    notes.push(`10 sn bayt Orta ×${f(shrink[0], 3)}, Büyük ×${f(shrink[1], 3)}`);
    console.log(`- **${t}** ${ok ? 'UYGUN' : 'uygun değil'}: ${notes.join('; ')}`);
    if (ok) okTs.push({ t, shrink });
  }
  const win = okTs[okTs.length - 1];
  if (win) console.log(`Kazanan ${win.t}: ${win.shrink.every((s) => s <= 0.9) ? 'GEÇER' : 'GEÇMEZ (10 sn küçülme %10 değil)'}`);
  else console.log('Uygun T yok: T = 0 kalır');
  console.log('\n### Kural, adım 3 (kırpma)\n');
  const checks = rows.filter((r) => r.check === 'crop-lossless');
  console.log(`kayıpsız: ${checks.filter((c) => c.same).length} / ${checks.length}`);
  for (const [c, of] of [['T0c', 'T0'], ['T3c', 'T3']]) {
    const ratio = median(sel({ kind: 'gercek', cand: c, longEdge: 480, seconds: 10 }).map((r) => r.bytes)) / median(sel({ kind: 'gercek', cand: of, longEdge: 480, seconds: 10 }).map((r) => r.bytes));
    const paired10 = (() => {
      const base = by(sel({ kind: 'gercek', cand: of, longEdge: 480, seconds: 10 }), (r) => r.clip);
      return median(sel({ kind: 'gercek', cand: c, longEdge: 480, seconds: 10 }).map((r) => r.bytes / (base.get(r.clip)?.bytes ?? NaN)));
    })();
    console.log(`${c} / ${of}, 10 sn Orta: ortanca bayt ×${f(ratio, 4)} (eşli ortanca ×${f(paired10, 4)})`);
  }
}

if (phase === 'sizes') {
  const sizes = [640, 960, 1280, 1920];
  const clipsAt = (e) => [...new Set(sel({ kind: 'gercek', longEdge: e, seconds: 4 }).map((r) => r.clip))];
  console.log('\n| boyut | n (gerçek) | VMAF-tel-NEG | VMAF-tel | SSIM-tel | 4 sn MB ortanca / en çok | 10 sn MB ortanca / en çok | 10 sn kodlama sn (Node) | 10 sn kareler bellekte (MB, en çok) |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const kind of ['gercek', 'yapay']) {
    for (const e of sizes) {
      const g4 = sel({ kind, longEdge: e, seconds: 4 });
      const g10 = sel({ kind, longEdge: e, seconds: 10 });
      if (g4.length === 0) continue;
      console.log(
        `| ${kind} ${e} | ${g4.length} | ${f(median(g4.map((r) => r.negTel)), 1)} | ${f(median(g4.map((r) => r.vmafTel)), 1)} | ${f(median(g4.map((r) => r.ssimTel)), 4)} | ${f(median(g4.map((r) => r.bytes / 1e6)))} / ${f(max(g4.map((r) => r.bytes / 1e6)))} | ` +
          `${f(median(g10.map((r) => r.bytes / 1e6)))} / ${f(max(g10.map((r) => r.bytes / 1e6)))} | ${f(median(g10.map((r) => r.encodeMs / 1000)), 1)} | ${f(max(g4.map((r) => (r.width * r.height * 4 * 125) / 1e6)), 0)} |`,
      );
    }
  }
  console.log('\n### Kural, adım 4 (a, b, d; c ve e uygulamada ölçülür)\n');
  let previous = 640;
  for (const e of [960, 1280, 1920]) {
    const clips = clipsAt(e);
    const lower = by(sel({ kind: 'gercek', longEdge: previous, seconds: 4 }), (r) => r.clip);
    const here4 = sel({ kind: 'gercek', longEdge: e, seconds: 4 });
    const dNeg = median(here4.map((r) => r.negTel)) - median(clips.map((c) => lower.get(c)?.negTel));
    const mb = median(here4.map((r) => r.bytes / 1e6));
    const top = max(here4.map((r) => r.bytes));
    const mem = max(here4.map((r) => r.width * r.height * 4 * 125)) / 1e6;
    const a = dNeg >= 3;
    const b = mb <= 15 && top <= 52_428_800;
    const d = mem <= 300;
    console.log(`- ${e} (${clips.length} kayıt; alt boyut ${previous}): (a) NEG +${f(dNeg)} ${a ? '✓' : '✗'}; (b) 4 sn ortanca ${f(mb)} MB, en çok ${f(top / 1e6)} MB ${b ? '✓' : '✗'}; (d) bellek ${f(mem, 0)} MB ${d ? '✓' : '✗ (iki geçişli yol gerekir)'}`);
    if (a && b) previous = e;
  }
}
