/**
 * How far apart real speech and invented text sit on the two figures Whisper's
 * own guard uses, per run: the lowest mean log-probability and the highest
 * no-speech probability among windows of real speech, against every window
 * that produced text on a negative clip or inside a gap.
 *
 *   node guard-margins.mjs [--tag=2026-10-03]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(dirname(dirname(here)), 'spike-results');
const tag = (process.argv.find((a) => a.startsWith('--tag=')) ?? '--tag=2026-10-03').slice(6);
const summary = JSON.parse(readFileSync(join(outDir, `asr-${tag}-summary.json`), 'utf8'));

console.log('| Run | Speech windows | lowest log-prob. (clip) | 2nd lowest | highest no-speech prob. (clip) | Windows with text on negatives: clip log-prob. / no-speech prob. |');
console.log('|---|---|---|---|---|---|');
for (const r of summary.results) {
  if (r.guard) continue;
  const speech = [];
  const invented = [];
  for (const x of r.rows) {
    if (x.error) continue;
    for (const w of x.windows ?? []) {
      if (w.avgLogprob === null || w.noSpeechProb === null) continue;
      if (x.kind === 'negative') {
        if (w.text.trim()) invented.push({ id: x.id, ...w });
      } else if (x.lang === 'en' && x.set !== 'pause') speech.push({ id: x.id, ...w });
    }
  }
  if (speech.length === 0) continue;
  const byLp = [...speech].sort((a, b) => a.avgLogprob - b.avgLogprob);
  const byNsp = [...speech].sort((a, b) => b.noSpeechProb - a.noSpeechProb);
  console.log(
    `| ${r.key} | ${speech.length} | ${byLp[0].avgLogprob.toFixed(2)} (${byLp[0].id}) | ${byLp[1]?.avgLogprob.toFixed(2)} (${byLp[1]?.id}) | ${byNsp[0].noSpeechProb.toFixed(2)} (${byNsp[0].id}) | ${invented.map((w) => `${w.id} ${w.avgLogprob.toFixed(2)} / ${w.noSpeechProb.toFixed(2)} "${w.text.trim().slice(0, 24)}"`).join('; ') || '—'} |`,
  );
}
