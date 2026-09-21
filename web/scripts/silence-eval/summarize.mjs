/**
 * Prints the Markdown tables of the silence-detector report from the result
 * JSON files (web/spike-results/silence-eval-2026-09-22-<tag>.json).
 *
 *   node scripts/silence-eval/summarize.mjs [--before=before] [--after=after] [--steps=a,b,c]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resultsDir } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const load = (tag) => JSON.parse(readFileSync(join(resultsDir, `silence-eval-2026-09-22-${tag}.json`), 'utf8'));
const before = load(args.before ?? 'before');
const after = load(args.after ?? 'after');

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)}%`);
const ms = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}`);
const NAMES = {
  'a-digital': '(a) dijital sessizlik',
  'b-room': '(b) oda tonu',
  'c-low': '(c) düşük ses (−20 dB)',
  'd-noisy': '(d) gürültü 15 / 5 dB SNR',
  'e-music': '(e) müzik −12 / −20 dB',
  'f-mixed': '(f) TR/EN karışık',
  neg: 'negatif (konuşmasız)',
};
const out = [];
const p = (line = '') => out.push(line);

function conditionTable(r, title) {
  p(`#### ${title}`);
  p();
  p('| Koşul | Dosya | Öneri yok (neden) | Öneri | Konuşma kesilmesi (stem / karışım) | Bulma (≥ min.) | Kısa boşluk önerildi | Kuyruk | Sınır sapması p50 / p95 / en çok (ms) | Doğal duraklama kesimi |');
  p('|---|---|---|---|---|---|---|---|---|---|');
  for (const [c, s] of Object.entries(r.main.perCondition)) {
    p(
      `| ${NAMES[c]} | ${s.files} | ${s.lowContrast} | ${s.suggestions} | **${s.incidents}** / ${s.incidentsMixLevel} | ${s.eligibleGaps ? `${s.recalled}/${s.eligibleGaps} (${pct(s.recall)})` : '—'} | ${s.shortGaps ? `${s.shortGapsSuggested}/${s.shortGaps}` : '—'} | ${s.tails ? `${s.tailsDetected}/${s.tails}` : '—'} | ${ms(s.boundary.p50)} / ${ms(s.boundary.p95)} / ${ms(s.boundary.max)} | ${s.naturalCuts} |`,
    );
  }
  const o = r.main.overall;
  p(
    `| **Toplam** | ${o.files} | ${o.lowContrast} | ${o.suggestions} | **${o.incidents}** / ${o.incidentsMixLevel} | a+b+c: ${r.main.recallABC.recalled}/${r.main.recallABC.eligibleGaps} (${pct(r.main.recallABC.recall)}) | ${o.shortGapsSuggested}/${o.shortGaps} | ${o.tailsDetected}/${o.tails} | a+b+c: ${ms(r.main.recallABC.boundary.p50)} / **${ms(r.main.recallABC.boundary.p95)}** / ${ms(r.main.recallABC.boundary.max)}; hepsi: ${ms(o.boundary.p95)} | ${o.naturalCuts} |`,
  );
  p();
  p(`Müzikli dosyalarda (e + müzik negatifleri) öneri: **${r.main.musicWrongCuts}**. Negatif dosyalarda öneri: **${r.main.negativeCuts}**.`);
  p();
}

conditionTable(before, 'Önce (main 9bc753d, `silence.ts` değişmeden)');
conditionTable(after, 'Sonra (bu dal)');

// Incident anatomy (before).
{
  const cuts = before.main.files.flatMap((f) => f.cuts.filter((c) => c.incident).map((c) => ({ ...c, id: f.id })));
  const byKind = {};
  let overlapOnly = 0;
  let levelOnly = 0;
  let both = 0;
  for (const c of cuts) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    const ov = c.speechOverlapMs > before.rules.OVERLAP_LIMIT_MS;
    const lv = c.stemMaxRelDb >= -before.rules.LEVEL_WITHIN_DB;
    if (ov && lv) both += 1;
    else if (ov) overlapOnly += 1;
    else levelOnly += 1;
  }
  p('#### Önceki kesilme vakalarının dökümü');
  p();
  p(`${cuts.length} vaka: yalnız örtüşme > 20 ms ${overlapOnly}, yalnız seviye (5 ms kare, konuşmaya 20 dB'den yakın) ${levelOnly}, ikisi birden ${both}. Yere göre: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  p();
  p('| Dosya | Kesim (ms) | Tür | Konuşmayla örtüşme (ms) | Kesim içindeki en yüksek 5 ms konuşma seviyesi (dB, konuşmaya göre) |');
  p('|---|---|---|---|---|');
  for (const c of cuts) p(`| ${c.id} | ${Math.round(c.startMs)}–${Math.round(c.endMs)} | ${c.kind} | ${Math.round(c.speechOverlapMs)} | ${c.stemMaxRelDb.toFixed(1)} |`);
  p();
}

// Steps.
if (args.steps) {
  p('#### Ara adımlar (aynı veri, aynı ölçüm; varsayılan ayarlar)');
  p();
  p('| Adım | Kesilme (stem / karışım) | Bulma a+b+c | Sınır p95 a+b+c (ms) | Müzikte öneri | Gürültüde öneri | Doğal duraklama kesimi |');
  p('|---|---|---|---|---|---|---|');
  for (const tag of String(args.steps).split(',')) {
    const file = join(resultsDir, `silence-eval-2026-09-22-${tag}.json`);
    if (!existsSync(file)) continue;
    const r = load(tag);
    p(
      `| ${tag} | ${r.main.overall.incidents} / ${r.main.overall.incidentsMixLevel} | ${r.main.recallABC.recalled}/${r.main.recallABC.eligibleGaps} | ${ms(r.main.recallABC.boundary.p95)} | ${r.main.musicWrongCuts} | ${r.main.perCondition['d-noisy'].suggestions} | ${r.main.overall.naturalCuts} |`,
    );
  }
  p();
}

// Recall by gap length.
p('#### Boşluk uzunluğuna göre bulma (sonra, a+b+c+f)');
p();
p('| Eklenen boşluk (s) | 0.3 | 0.5 | 0.8 | 1.2 | 2.0 | 3.0 |');
p('|---|---|---|---|---|---|---|');
{
  const agg = {};
  for (const c of ['a-digital', 'b-room', 'c-low', 'f-mixed']) {
    for (const [k, v] of Object.entries(after.main.perCondition[c].byNominal)) {
      agg[k] ??= { n: 0, detected: 0 };
      agg[k].n += v.n;
      agg[k].detected += v.detected;
    }
  }
  p(`| önerildi / var | ${['0.3', '0.5', '0.8', '1.2', '2', '3'].map((k) => (agg[k] ? `${agg[k].detected}/${agg[k].n}` : '—')).join(' | ')} |`);
}
p();

function sweepTable(r, title) {
  p(`#### ${title}`);
  p();
  p('| En kısa (s) | Pay (ms) | Duyarlılık (dB) | Kesilme | Bulma a+b+c | Sınır p95 a+b+c (ms) | Müzikte öneri | Gürültüde öneri | Doğal duraklama kesimi | Önerilen toplam (s) |');
  p('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of r.sweep) {
    const def = s.minSilenceS === 0.7 && s.keepMs === 150 && s.sensitivityDb === 0;
    const b = def ? '**' : '';
    p(
      `| ${b}${s.minSilenceS}${b} | ${b}${s.keepMs}${b} | ${b}${s.sensitivityDb > 0 ? '+' : ''}${s.sensitivityDb}${b} | ${s.incidents ? `**${s.incidents}**` : 0} | ${s.recalled}/${s.eligible} (${pct(s.recallABC)}) | ${ms(s.boundaryP95)} | ${s.musicWrongCuts} | ${s.noisySuggestions} | ${s.naturalCuts} | ${s.suggestedSeconds.toFixed(1)} |`,
    );
  }
  p();
}
sweepTable(after, 'Ayar taraması (sonra)');
sweepTable(before, 'Ayar taraması (önce, karşılaştırma için)');

// Natural pauses.
p('#### İç (doğal) duraklamalarda öneri (sonra, varsayılan)');
p();
p('| Dosya | Kesim (ms) | Kesim uzunluğu (ms) | Doğal duraklama uzunluğu (ms) | Kesimdeki en yüksek konuşma seviyesi (dB, konuşmaya göre) |');
p('|---|---|---|---|---|');
for (const f of after.main.files) {
  for (const c of f.cuts.filter((x) => x.kind === 'natural')) {
    p(`| ${f.id} | ${Math.round(c.startMs)}–${Math.round(c.endMs)} | ${Math.round(c.lengthMs)} | ${c.pause ? c.pause.endMs - c.pause.startMs : '—'} | ${c.stemMaxRelDb.toFixed(1)} |`);
  }
}
p();

// Per file.
p('#### Dosya bazında (sonra, varsayılan)');
p();
p('| Dosya | Sonuç | Sessiz (p10) | Yüksek (p95) | Eşik | Öneri | Kaçan boşluk (s) | En yüksek konuşma seviyesi kesimde (dB) |');
p('|---|---|---|---|---|---|---|---|');
for (const f of after.main.files) {
  const missed = f.gaps.filter((g) => g.kind === 'inner' && g.eligible && !g.detected).map((g) => g.nominalS);
  const worst = f.cuts.length ? Math.max(...f.cuts.map((c) => c.stemMaxRelDb ?? -Infinity)) : null;
  p(
    `| ${f.id} | ${f.ok ? 'öneri' : f.reason} | ${f.stats.floorDb.toFixed(1)} | ${f.stats.loudDb.toFixed(1)} | ${f.stats.thresholdDb.toFixed(1)} | ${f.cuts.length} | ${missed.join(', ') || '—'} | ${worst === null || !Number.isFinite(worst) ? '—' : worst.toFixed(1)} |`,
  );
}
p();

// Listen substitute.
p('#### Dinleme yerine: 10 rastgele kesim (sonra, tohum 42)');
p();
p('Seviyeler 10 ms RMS (1 ms adım), dosyanın konuşma seviyesine göre dB. "Kalan önce" = kesimin hemen önündeki 50 ms (kalan ses), "atılan baş/son" = kesimin içindeki ilk/son 50 ms, "kalan sonra" = kesimden sonraki 50 ms. Eğim = kalan 50 ms içinde son − ilk (kesime doğru).');
p();
p('| # | Dosya | Tür | Kesim (ms) | Kalan önce: en yüksek / eğim | Atılan baş en yüksek | Atılan son en yüksek | Kalan sonra: en yüksek / eğim | İşaret |');
p('|---|---|---|---|---|---|---|---|---|');
after.listen.forEach((l, n) => {
  const r = l.relToSpeechDb;
  const f = (v) => (v ? v.max.toFixed(0) : '—');
  const slope = (v, s) => (v ? `${v.max.toFixed(0)} / ${s === null ? '—' : s.toFixed(1)}` : '—');
  p(
    `| ${n + 1} | ${l.file} | ${l.kind} | ${Math.round(l.startMs)}–${Math.round(l.endMs)} | ${slope(r.keptBefore, l.keptSlopeDbPer50ms.beforeCut)} | ${f(r.removedStart)} | ${f(r.removedEnd)} | ${slope(r.keptAfter, l.keptSlopeDbPer50ms.afterCut)} | ${l.flags.join('; ') || 'yok'} |`,
  );
});
p();

console.log(out.join('\n'));
