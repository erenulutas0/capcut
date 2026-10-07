/**
 * What the lab attempts of a traced run said (ADR-036, 7 Oct 2026):
 * `run-app.mjs --lab={'padS':[1],'split':true}` records, for every span the
 * guard dropped, what a second attempt WOULD have written — the span with
 * context around it, the span cut in two — without using it. This report
 * answers, before any such rule is switched on:
 *
 *  - on speech clips: how much dropped speech time would each rule get
 *    written, and (where the reference has word times) is there really
 *    speech there;
 *  - on negative clips and inside marked gaps: would the rule have written
 *    ANYTHING. One accepted word there disqualifies the rule.
 *
 *   node scripts/transcript/lab-report.mjs <tag>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(webDir, 'transcript-results');
const manifest = JSON.parse(readFileSync(join(webDir, 'tests', 'media', 'transcript', 'manifest.json'), 'utf8'));
const clipById = new Map(manifest.clips.map((clip) => [clip.id, clip]));
const tag = process.argv[2];
if (!tag) {
  console.error('usage: lab-report.mjs <tag>');
  process.exit(2);
}
const rows = readdirSync(outDir)
  .filter((name) => name === `app-${tag}.json` || (name.startsWith(`app-${tag}.part`) && name.endsWith('.json')))
  .flatMap((name) => JSON.parse(readFileSync(join(outDir, name), 'utf8')).rows)
  .filter((row) => row.trace);

const hasContent = (text) => /[\p{L}\p{N}]/u.test(text ?? '');
/** Seconds of reference words inside [from, to). */
function speechIn(clip, from, to) {
  return (clip.words ?? []).filter((w) => w.e > w.s).reduce((sum, w) => sum + Math.max(0, Math.min(to, w.e) - Math.max(from, w.s)), 0);
}
const inGap = (clip, from, to) => (clip.gaps ?? []).some((gap) => from >= gap.start - 0.3 && to <= gap.end + 0.3);

const totals = new Map();
const bump = (set, key, by = 1) => {
  const entry = totals.get(set) ?? {};
  entry[key] = (entry[key] ?? 0) + by;
  totals.set(set, entry);
};
const examples = [];
for (const row of rows) {
  const clip = clipById.get(row.id);
  if (!clip) continue;
  const negative = clip.kind === 'negative';
  for (const span of row.trace.spans) {
    const first = span.attempts.find((attempt) => attempt.kind === 'first');
    if (!first) continue;
    const length = span.endS - span.startS;
    bump(row.set, 'spans');
    bump(row.set, 'spanS', length);
    if (first.verdict === 'ok') continue;
    bump(row.set, 'dropped');
    bump(row.set, 'droppedS', length);
    const nonSpeech = negative || inGap(clip, span.startS, span.endS);
    if (clip.words) bump(row.set, 'droppedRefSpeechS', speechIn(clip, span.startS, span.endS));
    // A real second look (the rule in force).
    const looks = span.attempts.filter((attempt) => attempt.kind.startsWith('look:') && attempt.verdict === 'ok');
    for (const look of looks) {
      bump(row.set, 'lookOkS', look.endS - look.startS);
      if (nonSpeech) {
        bump(row.set, 'lookInvented');
        examples.push(`INVENTED by second look, ${row.id} ${look.startS.toFixed(1)}–${look.endS.toFixed(1)} s (${look.avgLogprob?.toFixed(2)}): "${look.text.trim()}"`);
      }
    }
    // Lab: cut in two.
    const halves = span.attempts.filter((attempt) => attempt.kind.startsWith('lab-split:') && attempt.verdict === 'ok');
    for (const half of halves) {
      bump(row.set, 'splitOkS', half.endS - half.startS);
      if (nonSpeech) {
        bump(row.set, 'splitInvented');
        examples.push(`would be INVENTED by split, ${row.id} ${half.startS.toFixed(1)}–${half.endS.toFixed(1)} s (${half.avgLogprob?.toFixed(2)}): "${half.text.trim()}"`);
      }
    }
    // Lab: the span with context around it, judged as a whole (the first attempt's test) —
    // and what it wrote INSIDE the span.
    for (const wide of span.attempts.filter((attempt) => attempt.kind.startsWith('lab-pad:'))) {
      const inside = wide.words.filter((word) => word.start !== null && wide.startS + word.start >= span.startS - 0.1 && wide.startS + word.start < span.endS);
      const text = inside.map((word) => word.text).join('');
      if (wide.verdict === 'ok' && hasContent(text)) {
        bump(row.set, 'padOkS', length);
        if (nonSpeech) {
          bump(row.set, 'padInvented');
          examples.push(`would be INVENTED by context, ${row.id} ${span.startS.toFixed(1)}–${span.endS.toFixed(1)} s (${wide.avgLogprob?.toFixed(2)}): "${text.trim()}"`);
        }
      }
    }
  }
}
const f = (value) => (value ?? 0).toFixed(0);
console.log(`lab-report ${tag}: ${rows.length} traced clips`);
for (const [set, entry] of totals) {
  console.log(
    `${set.padEnd(7)} spans ${entry.spans ?? 0} (${f(entry.spanS)} s); dropped ${entry.dropped ?? 0} (${f(entry.droppedS)} s${entry.droppedRefSpeechS !== undefined ? `, of which reference speech ${f(entry.droppedRefSpeechS)} s` : ''})` +
      ` | second look wrote ${f(entry.lookOkS)} s, invented ${entry.lookInvented ?? 0}` +
      ` | lab split would write ${f(entry.splitOkS)} s, invent ${entry.splitInvented ?? 0}` +
      ` | lab context would write ${f(entry.padOkS)} s, invent ${entry.padInvented ?? 0}`,
  );
}
for (const line of examples) console.log(line);
