/**
 * Turns what the other-engines suite wrote down (web/.scratch/browsers/results)
 * into docs/quality/browsers-latest.md and browsers-latest.json.
 *
 * Tables only, no interpretation: what a row means for real Safari or for
 * Firefox on Android is written by hand in docs/quality/browsers-<date>.md.
 * A cell without a result file is "koşulmadı"; nothing is carried over.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const resultsDir = join(webDir, '.scratch', 'browsers', 'results');
const docsDir = resolve(webDir, '..', 'docs', 'quality');

export const PROJECTS = ['chromium-desktop', 'firefox-desktop', 'firefox-phone', 'webkit-desktop', 'webkit-phone'];
const PROJECT_TITLES = {
  'chromium-desktop': 'Chromium (kontrol), masaüstü',
  'firefox-desktop': 'Firefox, masaüstü',
  'firefox-phone': 'Firefox, telefon boyu',
  'webkit-desktop': 'WebKit, masaüstü',
  'webkit-phone': 'WebKit, telefon boyu',
};

export const CARDS = [
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

export const PLATFORM = [
  ['ana-ekran', 'Ana ekran ve arama'],
  ['cevrimdisi', 'Çevrimdışı kabuk (service worker)'],
  ['editor', 'Editör: video, klavye, kesit listesi'],
  ['tam-ekran', 'Editör: tam ekran (F)'],
  ['kaydetme', 'Dosyanın tarayıcıdan çıkışı'],
  ['paylas', '“Paylaş” düğmesi'],
  ['yukleme', 'Uygulama olarak yükleme'],
  ['yazi-model', 'Yazıya dök: model adımı'],
  ['sessiz-kodlama', 'Sesi kapat, WebM kaynak (tarayıcının H.264 kodlayıcısı)'],
  ['kaynak-hevc', 'HEVC kaynak → Her yerde açılsın'],
  ['kaynak-hdr', 'HDR kaynak → Her yerde açılsın'],
  ['axe', 'axe (ana ekran + bir sihirbaz)'],
  ['editor-hatalar', 'Editörde yakalanmamış hata'],
];

const VERDICT = {
  works: 'çalışıyor',
  refusal: 'dürüst ret',
  broken: 'BOZUK',
  absent: 'yok (sorun değil)',
  'not-run': 'koşulmadı',
};

const FACTS = [
  ['VideoEncoder', 'WebCodecs: VideoEncoder'],
  ['AudioEncoder', 'WebCodecs: AudioEncoder'],
  ['VideoDecoder', 'WebCodecs: VideoDecoder'],
  ['encodeH264', 'H.264 kodlar (1280 × 720)'],
  ['encodeAac', 'AAC kodlar'],
  ['encodeOpus', 'Opus kodlar'],
  ['decodeH264', 'H.264 çözer'],
  ['decodeVp9', 'VP9 çözer'],
  ['decodeHevc', 'HEVC çözer'],
  ['decodeAac', 'AAC çözer'],
  ['OffscreenCanvas', 'OffscreenCanvas'],
  ['webgl2', 'WebGL2'],
  ['opfs', 'Sayfanın özel deposu (OPFS)'],
  ['storageQuotaBytes', 'Depolama kotası (bildirilen)'],
  ['showSaveFilePicker', 'Kaydetme penceresi (File System Access)'],
  ['webShare', 'Web Share (dosya)'],
  ['serviceWorker', 'Service worker'],
  ['fullscreenEnabled', 'Tam ekran'],
  ['playsMp4', '<video> MP4 (H.264 + AAC) oynatır'],
  ['playsWebm', '<video> WebM (VP9 + Opus) oynatır'],
];

const cut = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function fact(value, key) {
  if (value === undefined) return 'ölçülmedi';
  if (value === null) return 'yok (API yok)';
  if (key === 'storageQuotaBytes') return `${(Number(value) / 1_000_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB`;
  if (value === true) return 'var';
  if (value === false) return 'yok';
  return value === '' ? 'hayır' : String(value);
}

function commit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: webDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'bilinmiyor';
  }
}

export function readCells() {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(resultsDir, name), 'utf8')));
}

function table(rows, cells, area, projects) {
  const lines = [`| | ${projects.map((project) => PROJECT_TITLES[project]).join(' | ')} |`, `|---|${projects.map(() => '---').join('|')}|`];
  for (const [id, label] of rows) {
    const row = projects.map((project) => {
      const cell = cells.find((item) => item.area === area && item.id === id && item.project === project);
      if (!cell) return id === 'editor-hatalar' ? 'yok' : 'koşulmadı (sonuç dosyası yok)';
      return `**${VERDICT[cell.verdict]}** — ${escapeCell(cut(cell.summary, 220))}`;
    });
    lines.push(`| ${label} | ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function writeBrowsersReport() {
  const cells = readCells();
  const projects = PROJECTS.filter((project) => cells.some((cell) => cell.project === project));
  const measured = cells.map((cell) => cell.measuredAt).filter(Boolean).sort();
  const broken = cells.filter((cell) => cell.verdict === 'broken');
  const out = [];
  out.push('# Diğer tarayıcı motorları: son koşu');
  out.push('');
  out.push('> Bu dosyayı `npm run browsers` yazar (`web/scripts/browsers/report.mjs`); elle düzeltilmez.');
  out.push(`> Ölçüm: ${measured[0]?.slice(0, 16).replace('T', ' ') ?? 'yok'} – ${measured.at(-1)?.slice(0, 16).replace('T', ' ') ?? 'yok'} (UTC), commit \`${commit()}\`, derleme: düz \`npm run build\` + \`next start\`.`);
  out.push('>');
  out.push('> **Bunlar motor derlemeleridir, tarayıcının kendisi değil.** “WebKit” Playwright’ın Windows için WebKit derlemesidir: Safari değildir, medya katmanı (kodekler, WebCodecs, donanım kodlayıcıları) macOS / iOS’takinden farklıdır. “Firefox” Playwright’ın yamalı masaüstü Firefox’udur: Android’deki Firefox değildir; “telefon boyu” masaüstü motorunun 390 × 844 dokunmatik görünümüdür. Her satırın gerçek Safari’ye ya da Android Firefox’a taşınıp taşınmayacağı elle yazılan yorum dosyasındadır (`browsers-2026-10-13.md`).');
  out.push('');
  out.push(`Satır sayısı: ${cells.length}; bozuk: ${broken.length}.`);
  out.push('');
  out.push('Sınıflar: **çalışıyor** (iş bitti, çıkan dosya ffprobe ile denetlendi) · **dürüst ret** (uygulama durdu ve nedenini söyledi; metin aşağıda) · **BOZUK** (sahte başarı, bitmeyen bekleme, kimseye söylenmeyen hata, açıklamasız duruş) · **yok** (tarayıcıda özellik yok, uygulama da vaat etmiyor) · **koşulmadı** (nedeniyle).');
  out.push('');
  out.push('## Kartlar');
  out.push('');
  out.push(table(CARDS, cells, 'card', projects));
  out.push('');
  out.push('## Kartların dışı');
  out.push('');
  out.push(table(PLATFORM, cells, 'platform', projects));
  out.push('');
  out.push('## Tarayıcının gerçekte nesi var (sayfanın içinde ölçüldü)');
  out.push('');
  out.push(`| | ${projects.map((project) => PROJECT_TITLES[project]).join(' | ')} |`);
  out.push(`|---|${projects.map(() => '---').join('|')}|`);
  for (const [key, label] of FACTS) {
    const row = projects.map((project) => {
      const env = cells.find((cell) => cell.area === 'platform' && cell.id === 'ortam' && cell.project === project);
      return env ? escapeCell(fact(env.facts?.[key], key)) : 'ölçülmedi';
    });
    out.push(`| ${escapeCell(label)} | ${row.join(' | ')} |`);
  }
  out.push('');
  out.push('## Kullanıcının gördüğü metinler: retler ve uyarılar (kelimesi kelimesine)');
  out.push('');
  const texts = new Map();
  for (const cell of cells) {
    // What stopped the task, and what the wizard said before the user pressed anything (the 13 Oct notice).
    const seen = [
      [cell.text, ''],
      [cell.facts?.upfrontNotice, ' (video seçilmeden önce)'],
      [cell.facts?.noticeBeforeDownload, ' (“İndir”e basılmadan önce)'],
    ];
    for (const [text, when] of seen) {
      if (!text) continue;
      const list = texts.get(text) ?? [];
      list.push(`${cell.project} / ${cell.id}${when}`);
      texts.set(text, list);
    }
  }
  if (texts.size === 0) out.push('Yok.');
  for (const [text, where] of texts) {
    out.push(`- “${cut(text, 900)}”`);
    out.push(`  - ${where.join(', ')}`);
  }
  out.push('');
  out.push('## Çıkan dosyalar');
  out.push('');
  out.push('| Motor | Kart | İzler | Süre (sn) | Boyut | Bayt | Yoldan dosyaya (sn) |');
  out.push('|---|---|---|---|---|---|---|');
  for (const project of projects) {
    for (const cell of cells.filter((item) => item.project === project && item.output)) {
      out.push(
        `| ${PROJECT_TITLES[project]} | ${cell.id} | ${cell.output.streams.join(' + ')} | ${String(cell.output.durationS).replace('.', ',')} | ${cell.output.width ? `${cell.output.width} × ${cell.output.height}` : '—'} | ${cell.output.bytes.toLocaleString('tr-TR')} | ${cell.seconds !== undefined ? String(cell.seconds).replace('.', ',') : '—'} |`,
      );
    }
  }
  out.push('');
  out.push('## Konsol hataları ve yakalanmamış hatalar');
  out.push('');
  let any = false;
  for (const cell of cells) {
    const problems = cell.problems;
    if (!problems) continue;
    const all = [
      ...(problems.pageErrors ?? []).map((text) => `sayfa hatası: ${text}`),
      ...(problems.unhandledRejections ?? []).map((text) => `yakalanmamış ret: ${text}`),
      ...(problems.consoleErrors ?? []).map((text) => `konsol: ${text}`),
    ];
    if (all.length === 0) continue;
    any = true;
    out.push(`- ${cell.project} / ${cell.id}: ${[...new Set(all)].map((text) => `\`${cut(text.replace(/`/g, "'"), 240)}\``).join('; ')}`);
  }
  if (!any) out.push('Yok.');
  out.push('');

  const file = join(docsDir, 'browsers-latest.md');
  writeFileSync(file, `${out.join('\n')}\n`);
  writeFileSync(
    join(docsDir, 'browsers-latest.json'),
    `${JSON.stringify({ measuredFrom: measured[0] ?? null, measuredTo: measured.at(-1) ?? null, commit: commit(), build: 'plain npm run build + next start', cells }, null, 2)}\n`,
  );
  return { file, cells: cells.length, broken: broken.length };
}
