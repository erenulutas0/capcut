/**
 * Turns web/spike-results/asr-<tag>-*.json into Markdown tables and the
 * ADR-017 verdict per model. Every stored hypothesis is re-scored with the
 * current metrics.mjs against the current manifest, so a metric fix never
 * needs a browser re-run. Prints Markdown; writes asr-<tag>-summary.json.
 *
 *   node summarize.mjs --tag=2026-09-21
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregate, rescoreRow } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const outDir = join(webRoot, 'spike-results');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const tag = argValue('tag', '2026-09-21');
const THRESHOLDS = { wer: 0.1, p95S: 0.25 };

const manifest = JSON.parse(readFileSync(join(webRoot, 'tests', 'media', 'speech', 'manifest.json'), 'utf8'));
const clipById = new Map(manifest.clips.map((c) => [c.id, c]));

const files = readdirSync(outDir).filter((f) => f.startsWith(`asr-${tag}-`) && f.endsWith('.json') && !f.endsWith('-summary.json'));
const runs = [];
const skipped = [];
for (const f of files) {
  const json = JSON.parse(readFileSync(join(outDir, f), 'utf8'));
  if (json.skipped || json.error) {
    skipped.push({ file: f, ...json });
    continue;
  }
  if (json.clips?.length) {
    json.clips = json.clips.map((row) => rescoreRow(row, clipById.get(row.id)));
    json.summary = aggregate(json.clips);
    json.complete = json.clips.length === manifest.clips.length && !json.errors?.some((e) => e.stage === 'model');
  }
  runs.push(json);
}
const modelOrder = ['tiny', 'base', 'small', 'turbo', 'tiny-plain', 'base-plain', 'small-plain'];
const browserOrder = ['chromium', 'chrome', 'msedge', 'firefox'];
const deviceOrder = ['webgpu', 'wasm'];
const idx = (list, v) => (list.indexOf(v) === -1 ? 99 : list.indexOf(v));
runs.sort(
  (a, b) => idx(modelOrder, a.model) - idx(modelOrder, b.model) || idx(deviceOrder, a.device) - idx(deviceOrder, b.device) || idx(browserOrder, a.browser) - idx(browserOrder, b.browser),
);

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);
const mb = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(0)} MB` : '—');
const ms = (s) => (s === null || s === undefined ? '—' : `${Math.round(s * 1000)} ms`);
const num = (v, d = 2) => (v === null || v === undefined ? '—' : v.toFixed(d));
const werCell = (g) => (g?.wer == null ? '—' : g.loops ? `${pct(g.wer)} (${pct(g.werCapped)}, ${g.loops} döngü)` : pct(g.wer));

const lines = [];
const p = (s = '') => lines.push(s);

// ---- environment
p('### Ortam (koşulardan)');
p();
p('| Tarayıcı | Sürüm | WebGPU | Adaptör | shader-f16 | crossOriginIsolated | Worker |');
p('|---|---|---|---|---|---|---|');
const seenEnv = new Set();
for (const r of runs) {
  if (seenEnv.has(r.browser)) continue;
  seenEnv.add(r.browser);
  const g = r.env.gpu;
  p(`| ${r.browser} | ${r.version} | ${g.available ? 'evet' : `hayır (${g.reason})`} | ${g.available ? `${g.vendor || '(boş)'} / ${g.architecture || '(boş)'}${g.isFallbackAdapter ? ' (fallback!)' : ''}` : '—'} | ${g.shaderF16 ?? '—'} | ${r.env.crossOriginIsolated} | ${r.useWorker ? 'evet' : 'hayır'} |`);
}
for (const s of skipped) p(`| ${s.browser ?? s.file} | ${s.version ?? '—'} | atlandı: ${s.skipped ?? s.error?.split('\n')[0]} | | | | |`);
p();

// ---- main table
p('### Ana tablo (model × cihaz × tarayıcı)');
p();
p('WER sütunları: ham değer; parantez içinde klip başına %100 ile kesilmiş değer ve tekrar döngüsüne giren klip sayısı (yalnızca döngü varsa). Bellek: tarayıcı süreç ağacının özel baytları, model yüklenmeden önceki taban → klipler işlenirken tepe. Zaman vekili: referans kelime zamanı **yoktur**; ffmpeg sessizlik sınırlarına uzaklık (p50 / p95).');
p();
p('| Model | Cihaz | Tarayıcı | Ağırlık | Yükleme soğuk / sıcak | WER TR temiz | WER EN temiz | CER TR / EN | WER gürültülü | RTF ort. / en kötü | Bellek taban → tepe | Negatif uydurma | Zaman vekili duraklama p50 / p95 | Durum |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of runs) {
  const s = r.summary ?? {};
  const t = s.timingProxy ?? {};
  const mem = r.memory ? `${r.memoryBaseline?.peakTotalMib ?? '?'} → ${r.memory.peakTotalMib} MiB` : '—';
  const neg = s.negatives ? `${s.negatives.hallucinated}/${s.negatives.clips}` : '—';
  const errs = (r.errors ?? []).filter((e) => e.stage !== 'word-timestamps');
  const status = errs.some((e) => e.stage === 'model') ? `BAŞARISIZ: ${errs[0].error.split('\n')[0].slice(0, 60)}` : r.complete ? '' : `eksik (${r.clips?.length ?? 0}/${manifest.clips.length} klip)`;
  p(
    `| ${r.model} | ${r.device} | ${r.browser} | ${mb(r.size?.weightsBytes)} | ${sec(r.load?.cold?.ms)} / ${sec(r.load?.warm?.ms)} | ${werCell(s['clean-tr'])} | ${werCell(s['clean-en'])} | ${pct(s['clean-tr']?.cer)} / ${pct(s['clean-en']?.cer)} | ${werCell(s.noisy)} | ${num(s.all?.rtf)} / ${num(s.all?.rtfMax)} | ${mem} | ${neg} | ${ms(t.pause?.p50)} / ${ms(t.pause?.p95)} | ${status} |`,
  );
}
p();

// ---- cross-browser identity
p('### Tarayıcılar arası çıktı farkı');
p();
const byMD = {};
for (const r of runs) if (r.complete) (byMD[`${r.model}/${r.device}`] ??= []).push(r);
for (const [key, rs] of Object.entries(byMD)) {
  const ref = rs.find((r) => r.browser === 'chromium') ?? rs[0];
  const diffs = rs
    .filter((r) => r !== ref)
    .map((r) => {
      const n = r.clips.filter((c) => (ref.clips.find((x) => x.id === c.id)?.hyp ?? null) !== c.hyp).length;
      return `${r.browser}: ${n} klip farklı`;
    });
  p(`- ${key}: referans ${ref.browser}; ${diffs.join(', ') || 'karşılaştırılacak ikinci tarayıcı yok'}`);
}
p();

// ---- thresholds
p('### ADR-017 eşikleri');
p();
p('WER: klip başına %100 ile kesilmiş değer; "en iyi" = o model için en iyi tarayıcı/cihaz koşusu, eşik en iyi koşuya uygulanır (modelin lehine). Zaman: referans kelime zamanı olmadığından yalnızca vekil; eşik kararına **girmez**.');
p();
p('| Model | WER TR temiz (en iyi–en kötü) | ≤ %10? | WER EN temiz (en iyi–en kötü) | ≤ %10? | Negatiflerde uydurma / koşu×klip | Yok mu? | Zaman vekili p95 duraklama (en iyi koşu) | Sonuç |');
p('|---|---|---|---|---|---|---|---|---|');
const verdicts = {};
for (const model of modelOrder) {
  const rs = runs.filter((r) => r.model === model && r.complete);
  if (rs.length === 0) continue;
  const tr = rs.map((r) => r.summary['clean-tr']?.werCapped).filter((v) => v != null);
  const en = rs.map((r) => r.summary['clean-en']?.werCapped).filter((v) => v != null);
  const halluc = rs.reduce((n, r) => n + (r.summary.negatives?.hallucinated ?? 0), 0);
  const negTotal = rs.reduce((n, r) => n + (r.summary.negatives?.clips ?? 0), 0);
  const pause = rs.map((r) => r.summary.timingProxy?.pause?.p95).filter((v) => v != null);
  const trOk = tr.length > 0 && Math.min(...tr) <= THRESHOLDS.wer;
  const enOk = en.length > 0 && Math.min(...en) <= THRESHOLDS.wer;
  const negOk = halluc === 0;
  const pass = trOk && enOk && negOk;
  verdicts[model] = { trWer: [Math.min(...tr), Math.max(...tr)], enWer: [Math.min(...en), Math.max(...en)], halluc, negTotal, pauseP95Best: pause.length ? Math.min(...pause) : null, trOk, enOk, negOk, pass, runs: rs.length };
  p(
    `| ${model} | ${pct(Math.min(...tr))}–${pct(Math.max(...tr))} | ${trOk ? 'evet' : 'HAYIR'} | ${pct(Math.min(...en))}–${pct(Math.max(...en))} | ${enOk ? 'evet' : 'HAYIR'} | ${halluc}/${negTotal} | ${negOk ? 'evet' : 'HAYIR'} | ${pause.length ? ms(Math.min(...pause)) : 'ölçülmedi'} | ${pass ? 'GEÇTİ' : 'GEÇMEDİ'} |`,
  );
}
p();

// ---- negatives
p('### Negatif kliplerde üretilen metin (tarayıcılar aynı çıktıyı verdiğinde tek satır)');
p();
p('| Model | Cihaz | Tarayıcı(lar) | neg-01 dijital sessizlik | neg-02 oda tonu | neg-03 yalnız müzik |');
p('|---|---|---|---|---|---|');
for (const [key, rs] of Object.entries(byMD)) {
  const groups = new Map();
  for (const r of rs) {
    const cells = ['neg-01', 'neg-02', 'neg-03'].map((id) => {
      const c = r.clips.find((x) => x.id === id);
      if (!c) return '—';
      if (c.error) return `hata: ${c.error.slice(0, 40)}`;
      return c.hallucinated ? `**"${c.hyp.trim().slice(0, 60)}"**` : 'boş';
    });
    const k = cells.join('|');
    (groups.get(k) ?? groups.set(k, { cells, browsers: [] }).get(k)).browsers.push(r.browser);
  }
  const [model, device] = key.split('/');
  for (const g of groups.values()) p(`| ${model} | ${device} | ${g.browsers.join(', ')} | ${g.cells.join(' | ')} |`);
}
p();

// ---- per clip
p('### Klip bazında WER (Chromium koşuları; diğer tarayıcılar için üstteki fark listesine bakın)');
p();
const cols = Object.entries(byMD).map(([key, rs]) => ({ key, run: rs.find((r) => r.browser === 'chromium') ?? rs[0] }));
p(`| Klip | s | ${cols.map((c) => c.key).join(' | ')} |`);
p(`|---|---|${cols.map(() => '---').join('|')}|`);
for (const clip of manifest.clips) {
  if (clip.kind === 'negative') continue;
  p(`| ${clip.id} | ${clip.durationS.toFixed(1)} | ${cols.map((c) => pct(c.run.clips.find((x) => x.id === clip.id)?.wer)).join(' | ')} |`);
}
p();

// ---- Turkish specifics
p('### Türkçe özel isim / sayı / İ-ı-ğ-ş örnekleri (referans → çıktı, temiz TR, Chromium)');
p();
const special = /[0-9]|[çğıöşüİ]|^[A-ZÇĞİÖŞÜ]/;
for (const model of ['small', 'base', 'tiny']) {
  for (const device of ['webgpu', 'wasm']) {
    const r = byMD[`${model}/${device}`]?.find((x) => x.browser === 'chromium') ?? byMD[`${model}/${device}`]?.[0];
    if (!r) continue;
    const trClips = r.clips.filter((x) => x.kind === 'clean' && x.lang === 'tr');
    const errs = trClips.flatMap((c) => (c.alignment ?? []).map((a) => ({ ...a, clip: c.id })));
    const properNouns = ['apia', "samoa'nın", 'upolu', "filistin'in", 'arap', 'israil', 'müttefikler', "fransa'yı", "meşhed'deki", 'goethe', 'fichte', 'schlegel', 'avrupa', "luna'ya", 'romantizm'];
    const pn = properNouns.map((w) => {
      const e = errs.find((a) => a.ref === w);
      return e ? `\`${w}\`→\`${e.hyp ?? '∅'}\`` : `\`${w}\` ✓`;
    });
    const numbers = errs.filter((a) => /\d/.test(a.ref ?? '') || /\d/.test(a.hyp ?? ''));
    const diacritic = errs.filter((a) => a.op === 'sub' && a.ref && a.hyp && a.ref.replace(/[çğıöşü]/g, (m) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[m]) === a.hyp.replace(/[çğıöşü]/g, (m) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[m]));
    p(`**${model} / ${device}** — özel isimler: ${pn.join(', ')}`);
    p();
    p(`- Sayı içeren hata: ${numbers.length} (${numbers.slice(0, 6).map((a) => `${a.clip} \`${a.ref ?? '∅'}\`→\`${a.hyp ?? '∅'}\``).join(', ') || '—'})`);
    p(`- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: ${diacritic.length} (${diacritic.slice(0, 5).map((a) => `\`${a.ref}\`→\`${a.hyp}\``).join(', ') || '—'})`);
    p(`- Toplam kelime hatası: ${errs.length} = ${errs.filter((a) => a.op === 'sub').length} değiştirme + ${errs.filter((a) => a.op === 'del').length} silme + ${errs.filter((a) => a.op === 'ins').length} ekleme`);
    p();
  }
}

// ---- full examples
p('### Tam çıktı örnekleri (small / webgpu / Chromium)');
p();
const best = byMD['small/webgpu']?.find((x) => x.browser === 'chromium') ?? byMD['small/wasm']?.[0];
if (best) {
  for (const id of ['tr-01', 'tr-02', 'tr-05', 'tr-08', 'tr-10', 'en-02', 'en-04', 'noisy-02']) {
    const c = best.clips.find((x) => x.id === id);
    if (!c || c.error) continue;
    p(`- **${id}** (WER ${pct(c.wer)})`);
    p(`  - ref: ${c.ref}`);
    p(`  - hyp: ${c.hyp.trim()}`);
  }
}
p();

// ---- timing detail
p('### Zaman vekili ayrıntısı (temiz klipler, Chromium)');
p();
p('| Model/cihaz | Kelime zamanı olan klip | Monoton | Aralık içinde | Başlangıç p50 / p95 (n) | Bitiş p50 / p95 (n) | Duraklama p50 / p95 (n) |');
p('|---|---|---|---|---|---|---|');
for (const c of cols) {
  const t = c.run.summary.timingProxy;
  p(`| ${c.key} | ${t.clipsWithWordTimes}/18 | ${t.monotonic} | ${t.inRange} | ${ms(t.onset.p50)} / ${ms(t.onset.p95)} (${t.onset.n}) | ${ms(t.offset.p50)} / ${ms(t.offset.p95)} (${t.offset.n}) | ${ms(t.pause.p50)} / ${ms(t.pause.p95)} (${t.pause.n}) |`);
}
p();

const md = lines.join('\n');
process.stdout.write(md);
writeFileSync(
  join(outDir, `asr-${tag}-summary.json`),
  JSON.stringify(
    {
      tag,
      thresholds: THRESHOLDS,
      verdicts,
      runs: runs.map((r) => ({ model: r.model, modelId: r.modelId, revision: r.revision, dtype: r.dtype, device: r.device, browser: r.browser, version: r.version, complete: r.complete, size: r.size, load: { cold: r.load?.cold?.ms, warm: r.load?.warm?.ms }, memoryBaseline: r.memoryBaseline, memory: r.memory, summary: r.summary, errors: r.errors, notFound: r.notFound })),
      skipped,
    },
    null,
    2,
  ),
);
