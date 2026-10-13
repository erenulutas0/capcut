/**
 * The "Firefox ve WebKit motor derlemeleri" section of docs/SUPPORT_MATRIX.md.
 *
 * A section of its own, from a source of its own: NOT the export matrix
 * (matrix-results/*.json, the harness cases) but the card walk of
 * `npm run browsers`, read from the committed docs/quality/browsers-latest.json.
 * build-support-matrix.mjs pushes these lines; this file can also replace
 * just this section in the document, between its two markers, without the
 * matrix result files being on the machine:
 *
 *   node scripts/lib/engine-walk-section.mjs --patch
 *
 * It reports only what is in that file; a missing cell is "koşulmadı".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = join(root, '..', 'docs', 'quality', 'browsers-latest.json');
const matrixDoc = join(root, '..', 'docs', 'SUPPORT_MATRIX.md');

export const START = '<!-- engine-walk:start (web/scripts/lib/engine-walk-section.mjs yazar) -->';
export const END = '<!-- engine-walk:end -->';

const ENGINES = [
  ['firefox-desktop', 'Firefox derlemesi, masaüstü'],
  ['firefox-phone', 'Firefox derlemesi, telefon boyu'],
  ['webkit-desktop', 'WebKit derlemesi, masaüstü'],
  ['webkit-phone', 'WebKit derlemesi, telefon boyu'],
];
const CARDS = [
  ['kes', 'Kes'],
  ['bosluk', 'Boşlukları at'],
  ['dikey', 'Dikey yap'],
  ['kucult', 'Küçült'],
  ['yazi', 'Yazıya dök'],
  ['muzik', 'Müzik ekle'],
  ['ses', 'Sesini al'],
  ['sustur', 'Sesi kapat'],
  ['cevir', 'Her yerde açılsın'],
  ['iyilestir', 'İyileştir'],
];
const SYMBOL = { works: '✅ çalışıyor', refusal: '🚫 dürüst ret', broken: '❌ BOZUK', absent: '— yok', 'not-run': '· koşulmadı' };

export function engineWalkSection() {
  const lines = [START, '## Firefox ve WebKit motor derlemeleri (kart yürüyüşü)', ''];
  if (!existsSync(source)) {
    lines.push('Çalıştırılmadı (`docs/quality/browsers-latest.json` yok). `cd web && npm run browsers`.', '', END);
    return lines;
  }
  const data = JSON.parse(readFileSync(source, 'utf8'));
  const cells = data.cells ?? [];
  const find = (project, area, id) => cells.find((cell) => cell.project === project && cell.area === area && cell.id === id);
  const agent = (project) => {
    const text = String(find(project, 'platform', 'ortam')?.facts?.userAgent ?? '');
    return /Firefox\/[\d.]+/.exec(text)?.[0] ?? (/Version\/[\d.]+/.exec(text)?.[0]?.replace('Version', 'WebKit (Safari sürüm dizgisi)') ?? 'bilinmiyor');
  };
  lines.push(
    `> Ölçüm: **${String(data.measuredTo ?? '').slice(0, 10)}**, commit \`${data.commit}\`, ${data.build}; win32 x64, headless. ` +
      'Kaynak: `npm run browsers` (`web/tests/browsers/`), ayrıntı ve ret metinleri [quality/browsers-latest.md](quality/browsers-latest.md), ' +
      'yorum [quality/browsers-2026-10-13.md](quality/browsers-2026-10-13.md).',
    '>',
    '> **Bunlar motor derlemeleridir.** Playwright’ın Windows WebKit derlemesi Safari değildir (bu derlemede WebCodecs ve H.264 oynatma hiç yok; ' +
      'gerçek Safari’de var) ve Safari sonucu yerine geçmez. Playwright’ın Firefox’u yamalı masaüstü Firefox’tur; Android’deki Firefox değildir. ' +
      '“Telefon boyu” bir telefon değil, aynı motorun 390 × 844 dokunmatik görünümüdür. Yukarıdaki dışa aktarma matrisi (D01…) bu motorlarda koşulmadı.',
    '',
    `| Kart | ${ENGINES.map(([project, label]) => `${label} (${agent(project)})`).join(' | ')} |`,
    `|---|${ENGINES.map(() => '---').join('|')}|`,
  );
  for (const [id, label] of CARDS) {
    lines.push(`| ${label} | ${ENGINES.map(([project]) => SYMBOL[find(project, 'card', id)?.verdict] ?? '· koşulmadı').join(' | ')} |`);
  }
  const count = (project, verdict) => cells.filter((cell) => cell.project === project && cell.area === 'card' && cell.verdict === verdict).length;
  lines.push(
    `| **Toplam** | ${ENGINES.map(([project]) => `${count(project, 'works')} çalışıyor, ${count(project, 'refusal')} dürüst ret, ${count(project, 'broken')} bozuk, ${count(project, 'not-run')} koşulmadı`).join(' | ')} |`,
    '',
    '“Dürüst ret”: uygulama dosya üretmedi, bunu söyledi ve ne yapılacağını yazdı (metinler `quality/browsers-latest.md` içinde, kelimesi kelimesine). ' +
      '“Yazıya dök” Firefox derlemesinde model adımına kadar yürüdü (model dosyaları bu makinede olmadığı için yazıya dökmenin kendisi koşulmadı); ' +
      'WebKit derlemesinde video açılamadığı için oraya gelinmedi.',
    '',
    END,
  );
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--patch')) {
  const doc = readFileSync(matrixDoc, 'utf8');
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  const section = engineWalkSection().join(eol);
  const from = doc.indexOf(START);
  const to = doc.indexOf(END);
  let next;
  if (from >= 0 && to > from) next = doc.slice(0, from) + section + doc.slice(to + END.length);
  else {
    // First time: before "Gerçek telefon", the other hand-kept section.
    const anchor = doc.indexOf('## Gerçek telefon');
    if (anchor < 0) throw new Error('docs/SUPPORT_MATRIX.md: "## Gerçek telefon" not found; cannot place the section');
    next = doc.slice(0, anchor) + section + eol + eol + doc.slice(anchor);
  }
  writeFileSync(matrixDoc, next);
  console.log(`engine-walk: ${matrixDoc} güncellendi`);
}
