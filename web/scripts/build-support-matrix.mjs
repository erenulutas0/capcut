/**
 * Turns the per-browser matrix JSON into the published support matrix.
 *
 * It only ever reports what is in those files. A browser with no result file
 * is listed as "çalıştırılmadı", never guessed at, and the document states the
 * exact versions and the date the numbers came from.
 *
 * Usage: node scripts/build-support-matrix.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASES } from './lib/matrix-cases.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resultsDir = join(root, 'matrix-results');
const outFile = join(root, '..', 'docs', 'SUPPORT_MATRIX.md');

const BROWSERS = [
  { key: 'chromium', label: 'Chromium (Playwright)', short: 'Chromium' },
  { key: 'chrome', label: 'Google Chrome', short: 'Chrome' },
  { key: 'edge', label: 'Microsoft Edge', short: 'Edge' },
  { key: 'firefox', label: 'Firefox (Playwright)', short: 'Firefox' },
  { key: 'webkit', label: 'WebKit (Playwright)', short: 'WebKit' },
];

const SYMBOL = {
  PASS: '✅',
  UNSUPPORTED: '⛔',
  FAIL: '❌',
  ERROR: '💥',
  NOT_RUN: '—',
};

const loaded = BROWSERS.map((browser) => {
  const path = join(resultsDir, `matrix-${browser.key}.json`);
  if (!existsSync(path)) return { ...browser, missing: true };
  return { ...browser, data: JSON.parse(readFileSync(path, 'utf8')) };
});

const available = loaded.filter((b) => !b.missing);
if (available.length === 0) {
  console.error('matrix-results/ boş. önce: node scripts/run-matrix.mjs --browser=...');
  process.exit(2);
}

function statusFor(browser, caseId) {
  if (browser.missing) return 'NOT_RUN';
  const found = browser.data.results.find((r) => r.id === caseId);
  return found ? found.status : 'NOT_RUN';
}

/** Short version string from the user agent, for the record. */
function versionOf(browser) {
  if (browser.missing) return 'çalıştırılmadı';
  const ua = browser.data.capability?.userAgent ?? '';
  const patterns = [/Edg\/([\d.]+)/, /Chrome\/([\d.]+)/, /Firefox\/([\d.]+)/, /Version\/([\d.]+)/];
  for (const pattern of patterns) {
    const match = pattern.exec(ua);
    if (match) return match[1];
  }
  return 'bilinmiyor';
}

function encoderLine(browser) {
  if (browser.missing) return 'çalıştırılmadı';
  const capability = browser.data.capability ?? {};
  const asText = (value) => (value === true ? 'var' : value === false ? 'yok' : String(value));
  if (capability.videoEncoder !== 'function') return 'WebCodecs yok';
  return `H.264 ${asText(capability.h264)} · AAC ${asText(capability.aac)}`;
}

const lines = [];
lines.push('# Destek matrisi — W2 ölçümleri');
lines.push('');
lines.push(
  '> Bu dosya `web/scripts/build-support-matrix.mjs` tarafından, ' +
    '`web/matrix-results/*.json` içindeki gerçek çalıştırma sonuçlarından üretilir. ' +
    'Elle düzenlenmez.',
);
lines.push('');
lines.push(
  'Her satır `video-editor-blueprint/docs/22_QA_TEST_MATRIX.md` içindeki bir fixture’dır. ' +
    'Sonuçlar gerçek tarayıcıda gerçek dosyalarla alınmış, çıktı ffprobe/ffmpeg ile ölçülmüştür.',
);
lines.push('');
lines.push('## Ne anlama geliyor?');
lines.push('');
lines.push('| Simge | Anlamı |');
lines.push('|---|---|');
lines.push('| ✅ PASS | Beklenen davranış gerçekleşti ve ölçümle doğrulandı. |');
lines.push(
  '| ⛔ UNSUPPORTED | Tarayıcıda gerekli encoder yok. Uygulama bunu **açıkça reddetti**, ' +
    'sessizce başka codec’e düşmedi ve sahte başarı göstermedi. |',
);
lines.push('| ❌ FAIL | Beklenen davranış gerçekleşmedi. |');
lines.push('| 💥 ERROR | Çalıştırma sırasında beklenmeyen hata. |');
lines.push('| — NOT_RUN | Bu ortamda çalıştırılamadı; gerekçesi aşağıda. |');
lines.push('');

lines.push('## Test edilen ortamlar');
lines.push('');
lines.push('| Tarayıcı | Sürüm | Encoder kabiliyeti | Çalıştırma |');
lines.push('|---|---|---|---|');
for (const browser of loaded) {
  const ranAt = browser.missing ? '—' : browser.data.ranAt.replace('T', ' ').slice(0, 16) + ' UTC';
  lines.push(`| ${browser.label} | ${versionOf(browser)} | ${encoderLine(browser)} | ${ranAt} |`);
}
lines.push('');
lines.push(
  `Hepsi ${available[0].data.platform} üzerinde, headless olarak çalıştırıldı. ` +
    '**Gerçek Safari, gerçek telefon ve fiziksel cihaz testi yapılmadı.** ' +
    'Playwright’ın WebKit derlemesi Safari değildir ve Safari sonucu yerine geçmez.',
);
lines.push('');

lines.push('## Sonuçlar');
lines.push('');
lines.push(`| # | Durum | ${loaded.map((b) => b.short).join(' | ')} |`);
lines.push(`|---|---|${loaded.map(() => '---').join('|')}|`);
for (const testCase of CASES) {
  const cells = loaded.map((b) => SYMBOL[statusFor(b, testCase.id)] ?? '?');
  lines.push(`| ${testCase.id} | ${testCase.title} | ${cells.join(' | ')} |`);
}
lines.push('');

const totalsRow = loaded.map((b) => {
  if (b.missing) return '—';
  const t = b.data.totals;
  return `${t.pass}✅ ${t.unsupported ?? 0}⛔ ${t.fail}❌ ${t.error}💥 ${t.notRun}—`;
});
lines.push(`| Toplam | | ${totalsRow.join(' | ')} |`);
lines.push('');

lines.push('## Ölçülen değerler (Chromium)');
lines.push('');
const reference = loaded.find((b) => b.key === 'chromium' && !b.missing);
if (reference) {
  lines.push('| # | Süre | Kare | Çözünürlük | SSIM | Diğer ölçümler |');
  lines.push('|---|---|---|---|---|---|');
  for (const result of reference.data.results) {
    const m = result.measured ?? {};
    if (!m.durationSeconds && !m.outcome) continue;
    const extras = [];
    if (m.momentToneDb) extras.push(`an sesleri ${m.momentToneDb.join(' / ')} dB`);
    if (m.pitch) extras.push(`perde ${m.pitch.right} / ${m.pitch.wrong} dB`);
    if (m.musicWindow) extras.push(`müzik önce ${m.musicWindow.before} → sonra ${m.musicWindow.after} dB`);
    if (m.boundary) extras.push(`sınır ${m.boundary.atBoundary} / genel ${m.boundary.overall} dB`);
    if (m.peakDb !== undefined) extras.push(`tepe ${m.peakDb} dB`);
    if (m.fade) extras.push(`fade ${m.fade.quiet} → ${m.fade.loud} dB`);
    if (m.toneBelow) extras.push(`440 Hz ${m.toneBelow.level} / 330 Hz ${m.toneBelow.reference} dB`);
    if (m.outcome) extras.push(`sonuç: ${m.outcome}`);
    lines.push(
      `| ${result.id} | ${m.durationSeconds ? `${m.durationSeconds} s` : '—'} | ${m.frames ?? '—'} | ` +
        `${m.width ? `${m.width}x${m.height}` : '—'} | ${m.ssim ?? '—'} | ${extras.join('; ') || '—'} |`,
    );
  }
  lines.push('');
}

const untestable = loaded.filter((b) => !b.missing && b.data.notTestable);
if (untestable.length > 0) {
  lines.push('## Matris çalıştırılamayan ortamlar');
  lines.push('');
  for (const browser of untestable) {
    lines.push(`- **${browser.label}:** ${browser.data.notTestable}`);
  }
  lines.push('');
}

// Memory cost of long exports: the two output routes, measured the same way.
const memoryPath = join(resultsDir, 'export-memory-1080-memory-route.json');
const opfsPath = join(resultsDir, 'export-memory-1080-opfs-route.json');
if (existsSync(memoryPath) && existsSync(opfsPath)) {
  const memory = JSON.parse(readFileSync(memoryPath, 'utf8'));
  const opfs = JSON.parse(readFileSync(opfsPath, 'utf8'));
  lines.push('## Uzun çıktı: süre, hız ve bellek');
  lines.push('');
  lines.push(
    `Ortam: ${opfs.browser}, ${opfs.profile === 'persistent' ? 'kalıcı (disk destekli) profil' : 'kalıcı olmayan profil'}, ` +
      `yoğun 1080p kaynak, 1080p çıktı. ${opfs.method}`,
  );
  lines.push('');
  lines.push('| Çıktı | Dosya | Kare | Süren işlem | Bellek yolu: tepe (artış) | OPFS yolu: tepe (artış) |');
  lines.push('|---|---|---|---|---|---|');
  for (const row of opfs.rows) {
    const old = memory.rows.find((r) => r.requestedSeconds === row.requestedSeconds);
    lines.push(
      `| ${row.requestedSeconds} s | ${row.outputMib ?? '—'} MiB (${row.videoBitrateMbps ?? '—'} Mbit/s) | ` +
        `${row.frames ?? '—'} | ${(row.elapsedMs / 1000).toFixed(1)} s | ` +
        `${old ? `${old.peakTotalMib} MiB (+${old.growthMib})` : '—'} | ` +
        `${row.peakTotalMib} MiB (+${row.growthMib}) |`,
    );
  }
  lines.push('');
  lines.push(
    'Bellek yolunda artış çıktı boyutuyla doğrusal büyür (çıktı hem muxer’da hem sayfadaki Blob’da tutulur). ' +
      'OPFS yolunda çıktı tarayıcının özel diskine akar ve artış uzunluktan bağımsız kalır. ' +
      'Uyarı: gizli pencerede Chromium OPFS’i RAM’de tutar; orada bu kazanç yoktur.',
  );
  lines.push('');
}

// The user's own recordings, if they have been run. Anonymous ids only.
const realFiles = BROWSERS.map((b) => ({ ...b, path: join(resultsDir, `real-media-${b.key}.json`) })).filter(
  (b) => existsSync(b.path),
);
lines.push('## Gerçek kayıtlar');
lines.push('');
if (realFiles.length === 0) {
  lines.push(
    '**NOT_RUN.** Gerçek telefon/kamera kayıtlarıyla çalıştırma henüz yapılmadı. Yukarıdaki bütün satırlar ' +
      'ffmpeg ile üretilmiş sentetik dosyalardan gelir. Çalıştırmak için kayıtları `web/tests/media/real/` ' +
      'klasörüne koyup `node scripts/run-real-media.mjs` komutunu kullanın.',
  );
  lines.push('');
} else {
  for (const entry of realFiles) {
    const data = JSON.parse(readFileSync(entry.path, 'utf8'));
    const t = data.totals;
    lines.push(
      `### ${entry.label} — ${t.pass} PASS, ${t.refused} REFUSED, ${t.fail} FAIL, ${t.error} ERROR ` +
        `(${data.ranAt.replace('T', ' ').slice(0, 16)} UTC)`,
    );
    lines.push('');
    lines.push('| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of data.results) {
      const p = r.properties ?? {};
      lines.push(
        `| ${r.id} | ${r.status} | ${p.videoCodec ?? '—'} | ${p.width ?? '—'}x${p.height ?? '—'} | ` +
          `${p.rotation ?? 0}° | ${p.fps ?? '—'}${p.likelyVfr ? ' (VFR?)' : ''} | ` +
          `${p.durationSeconds ? p.durationSeconds.toFixed(1) : '—'} s | ${p.sizeMib ?? '—'} MiB | ` +
          `${p.colorTransfer ?? '—'} | ${p.audioCodec ?? 'yok'} | ${r.measured?.ssim ?? '—'} |`,
      );
    }
    lines.push('');
  }
}

const notRunCases = CASES.filter((c) => c.notRun);
if (notRunCases.length > 0) {
  lines.push('## Çalıştırılamayanlar');
  lines.push('');
  for (const testCase of notRunCases) {
    lines.push(`- **${testCase.id} — ${testCase.title}:** ${testCase.notRun}`);
  }
  lines.push('');
}

lines.push('## Bu matrisin kapsamadıkları');
lines.push('');
lines.push('- Gerçek Safari (macOS/iOS) ve gerçek fiziksel telefon/tablet.');
lines.push('- Gerçek kamera/telefon kayıtları, “Gerçek kayıtlar” bölümünde çalıştırılmadıysa.');
lines.push('- Bellek ölçümü yalnızca Windows’ta ve Chromium’da yapıldı; macOS/Linux ve diğer tarayıcılar ölçülmedi.');
lines.push('- Düşük bellekli cihazlar ve bellek yetmediğinde davranış.');
lines.push('- Disk dolması, uzun süreli kararlılık ve termal davranış.');
lines.push('- Ekran okuyucu ve erişilebilirlik denetimi.');
lines.push('');
lines.push('## Yeniden üretmek için');
lines.push('');
lines.push('```bash');
lines.push('cd web');
lines.push('node scripts/generate-matrix-media.mjs');
lines.push('npm run build && npx next start -p 3100   # ayrı bir kabukta');
lines.push('node scripts/run-matrix.mjs --browser=chromium');
lines.push('node scripts/build-support-matrix.mjs');
lines.push('```');
lines.push('');

writeFileSync(outFile, `${lines.join('\n')}\n`);
console.log(`destek matrisi yazıldı: ${outFile}`);
for (const browser of loaded) {
  if (browser.missing) {
    console.log(`  ${browser.label.padEnd(24)} çalıştırılmadı`);
    continue;
  }
  const t = browser.data.totals;
  console.log(
    `  ${browser.label.padEnd(24)} ${t.pass} PASS, ${t.unsupported ?? 0} UNSUPPORTED, ` +
      `${t.fail} FAIL, ${t.error} ERROR, ${t.notRun} NOT_RUN`,
  );
}
