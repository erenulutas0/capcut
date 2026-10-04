/**
 * The handful of figures in the spike report that the summary tables do not
 * print directly: real-speech spans the in-engine guard dropped (spans inside
 * the no-speech gaps of the pause clips are correct drops and left out), the
 * log-probability margin pooled over the part-A runs, audio minutes per run,
 * and how busy the machine was.
 *
 *   node report-facts.mjs [--tag=2026-10-03]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const tag = (process.argv.find((a) => a.startsWith('--tag=')) ?? '--tag=2026-10-03').slice(6);
const summary = JSON.parse(readFileSync(join(webRoot, 'spike-results', `asr-${tag}-summary.json`), 'utf8'));
const gaps = new Map(JSON.parse(readFileSync(join(webRoot, 'tests', 'media', 'speech', 'manifest-en.json'), 'utf8')).clips.map((c) => [c.id, c.gaps ?? []]));

console.log('## guard drops on real speech (shipping runs)');
for (const r of summary.results.filter((x) => x.guard)) {
  const real = [];
  let kept = 0;
  let refWords = 0;
  for (const x of r.rows.filter((y) => !y.error && y.kind === 'speech')) {
    refWords += x.refWords ?? 0;
    for (const w of x.windows) {
      const inGap = (gaps.get(x.id) ?? []).some((g) => (w.start + w.end) / 2 > g.start && (w.start + w.end) / 2 < g.end);
      if (w.dropped && !inGap) real.push({ id: x.id, words: w.droppedWords, s: w.end - w.start });
      else if (!w.dropped) kept += 1;
    }
  }
  const by = {};
  for (const d of real) by[d.id] = (by[d.id] ?? 0) + 1;
  console.log(`${r.key}: kept ${kept}, real spans dropped ${real.length} (${real.reduce((a, d) => a + d.words, 0)} words, ${real.reduce((a, d) => a + d.s, 0).toFixed(1)} s) of ${refWords} reference words; by clip ${JSON.stringify(by)}`);
}

console.log('\n## log-probability margin, part-A Silero runs (no guard, no suffix)');
for (const models of [['base', 'small-fp16', 'turbo', 'base-fp16'], ['base'], ['small-fp16'], ['turbo']]) {
  let speech = 0;
  let minSpeech = Infinity;
  let invented = 0;
  let maxInvented = -Infinity;
  for (const r of summary.results.filter((x) => models.includes(x.model) && x.pre === 'silero' && !x.suffix && x.device === 'webgpu' && x.browser === 'chromium')) {
    for (const x of r.rows.filter((y) => !y.error)) {
      for (const w of x.windows) {
        if (w.avgLogprob === null) continue;
        if (x.kind === 'negative') {
          if (w.text.trim()) {
            invented += 1;
            maxInvented = Math.max(maxInvented, w.avgLogprob);
          }
        } else if (x.lang === 'en' && x.set !== 'pause') {
          speech += 1;
          minSpeech = Math.min(minSpeech, w.avgLogprob);
        }
      }
    }
  }
  console.log(`${models.join('+')}: ${speech} speech windows, lowest ${minSpeech.toFixed(2)}; ${invented} windows with text on negatives, highest ${maxInvented.toFixed(2)}`);
}

console.log('\n## per run: audio minutes, machine CPU busy before / during, VAD share of audio');
for (const r of summary.results) {
  const rows = r.rows.filter((x) => !x.error);
  const audio = rows.reduce((t, x) => t + x.audioS, 0);
  const vad = rows.reduce((t, x) => t + (x.vadMs ?? 0), 0);
  console.log(`${r.key}: ${(audio / 60).toFixed(1)} min, cpu ${r.cpu?.meanBusy ?? '?'}, vad ${((vad / 1000 / audio) * 100).toFixed(1)}%`);
}
