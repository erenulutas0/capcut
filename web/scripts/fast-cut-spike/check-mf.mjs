/**
 * Reads the barcodes of files that Windows Media Foundation decoded
 * (`mf-transcode.ps1`) and compares them with the frames the fast cut was
 * asked for (from the spike result JSON). MF re-times its output to a fixed
 * rate, so the check is on the SEQUENCE of distinct frame numbers: every
 * marked frame present, in order, none missing, none extra.
 *
 *   node scripts/fast-cut-spike/check-mf.mjs fastcut-spike-results/chrome/spike-chrome.json fastcut-spike-results/mf
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { barcodes } from './verify-cut.mjs';

const [summaryPath, mfDir] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
for (const r of summary.results) {
  const file = join(mfDir, `${r.case}-mf.mp4`);
  if (!existsSync(file)) continue;
  // MF applies the rotation: the barcode strip is then no longer at the top-left.
  let codes;
  try {
    codes = barcodes(file).map((c) => c.frame);
  } catch {
    console.log(`${r.case.padEnd(18)} MF: barkod okunamadı (döndürülmüş çıktı, şerit sol üstte değil)`);
    continue;
  }
  const distinct = codes.filter((v, i) => i === 0 || v !== codes[i - 1]);
  let expected;
  if (r.kind === 'editlist') {
    const first = Math.round(r.ranges[0][0] * 30);
    expected = Array.from({ length: r.cut.shown }, (_, i) => first + i);
  } else {
    expected = r.cut.segments.flatMap((s) => Array.from({ length: s.frames }, (_, i) => Math.round(s.firstSourceS * 30) + i));
  }
  const same = distinct.length === expected.length && distinct.every((v, i) => v === expected[i]);
  const firstBad = distinct.findIndex((v, i) => v !== expected[i]);
  console.log(
    `${r.case.padEnd(18)} MF: ${distinct.length} farklı kare / beklenen ${expected.length} — ${same ? 'AYNI SIRA' : `FARKLI (ilk fark #${firstBad}: ${distinct[firstBad]} ≠ ${expected[firstBad]}; ilk kare ${distinct[0]})`}`,
  );
}
