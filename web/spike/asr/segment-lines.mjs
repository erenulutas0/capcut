/**
 * Word-timed transcript → (a) subtitle cues, (b) transcript-panel lines.
 * A sketch of the rules proposed in the spike report, run on real model
 * output so the report can show real examples; not app code.
 *
 *   node segment-lines.mjs <result.json> <clipId> [fromSeconds] [toSeconds]
 *
 * Subtitle cue rules (`toCues`):
 *  - at most 2 lines of 32 characters (a 9:16 frame; well inside the app's
 *    120 characters / 2 lines, ADR-015);
 *  - a cue ends at a sentence end (. ? !), at a pause of 0.5 s or more, or
 *    when the next word would not fit / the cue would pass 6 s; when it is
 *    more than half full it also ends at a comma;
 *  - a cue is shown until 0.15 s after its last word, never into the next
 *    cue, and for at least 0.8 s when the gap to the next cue allows it;
 *  - the line break goes where the two lines are most even, with a
 *    preference for breaking after punctuation.
 *
 * Transcript lines (`toLines`): one line per sentence, cut early at a pause
 * of 0.8 s or at 90 characters; the line's time is its first word's start.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CUE_RULES = { maxLineChars: 32, maxLines: 2, pauseS: 0.5, maxDurationS: 6, lingerS: 0.15, minDurationS: 0.8 };
export const LINE_RULES = { pauseS: 0.8, maxChars: 90 };

/** Engine chunks → words with both times (words without a time are skipped). */
export function wordsOf(chunks) {
  return chunks
    .map((c) => ({ text: c.text.trim(), start: c.start, end: c.end }))
    .filter((w) => w.text && w.start !== null && w.end !== null);
}

function splitLines(words, maxLineChars) {
  const text = words.map((w) => w.text).join(' ');
  if (text.length <= maxLineChars) return [text];
  let best = null;
  for (let k = 1; k < words.length; k += 1) {
    const a = words.slice(0, k).map((w) => w.text).join(' ');
    const b = words.slice(k).map((w) => w.text).join(' ');
    if (a.length > maxLineChars || b.length > maxLineChars) continue;
    const score = Math.abs(a.length - b.length) - (/[,;:.?!]$/.test(a) ? 6 : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best ? best.lines : [text];
}

export function toCues(words, rules = CUE_RULES) {
  const capacity = rules.maxLineChars * rules.maxLines;
  const groups = [];
  let cur = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const text = cur.map((x) => x.text).join(' ');
    if (cur.length) {
      const pause = w.start - cur[cur.length - 1].end;
      const fits = splitLines([...cur, w], rules.maxLineChars).length <= rules.maxLines && `${text} ${w.text}`.length <= capacity && splitLines([...cur, w], rules.maxLineChars).every((l) => l.length <= rules.maxLineChars);
      if (pause >= rules.pauseS || !fits || w.end - cur[0].start > rules.maxDurationS) flush();
    }
    cur.push(w);
    const now = cur.map((x) => x.text).join(' ');
    if (/[.?!]["')\]]?$/.test(w.text) || (/[,;:]$/.test(w.text) && now.length > capacity / 2)) flush();
  }
  flush();
  return groups.map((g, k) => {
    const start = g[0].start;
    const nextStart = k < groups.length - 1 ? groups[k + 1][0].start : Infinity;
    const lastEnd = g[g.length - 1].end;
    const end = Math.min(nextStart, Math.max(lastEnd + rules.lingerS, start + rules.minDurationS));
    return { start, end: Math.max(end, Math.min(lastEnd, nextStart)), lines: splitLines(g, rules.maxLineChars) };
  });
}

export function toLines(words, rules = LINE_RULES) {
  const lines = [];
  let cur = [];
  const flush = () => {
    if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (w.start - cur[cur.length - 1].end >= rules.pauseS || `${cur.map((x) => x.text).join(' ')} ${w.text}`.length > rules.maxChars)) flush();
    cur.push(w);
    if (/[.?!]["')\]]?$/.test(w.text)) flush();
  }
  flush();
  return lines;
}

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, clipId, from = '0', to = '40'] = process.argv.slice(2);
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const row = result.clips.find((c) => c.id === clipId);
  if (!row) throw new Error(`no clip ${clipId} in ${file}`);
  const all = wordsOf(row.chunks);
  const cues = toCues(all);
  const lines = toLines(all);
  const inRange = (x) => x.start >= Number(from) && x.start < Number(to);
  console.log(`# ${result.model}/${result.device}/${result.pre} — ${clipId}, ${from}–${to} s`);
  console.log('\nSubtitle cues:');
  for (const c of cues.filter(inRange)) console.log(`${clock(c.start)} → ${clock(c.end)}  ${c.lines.join(' / ')}`);
  console.log('\nTranscript lines:');
  for (const l of lines.filter(inRange)) console.log(`${clock(l.start)}  ${l.text}`);
  const durations = cues.map((c) => c.end - c.start);
  const sorted = [...durations].sort((a, b) => a - b);
  const longest = Math.max(...cues.flatMap((c) => c.lines.map((l) => l.length)));
  console.log(`\nWhole clip: ${all.length} words → ${cues.length} cues (${(cues.length / (row.audioS / 60)).toFixed(1)} per minute), duration min ${sorted[0].toFixed(2)} s / median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} s / max ${sorted.at(-1).toFixed(2)} s, cues under 0.8 s: ${durations.filter((d) => d < 0.8).length}, longest line ${longest} chars, cues with a line over ${CUE_RULES.maxLineChars}: ${cues.filter((c) => c.lines.some((l) => l.length > CUE_RULES.maxLineChars)).length}; ${lines.length} transcript lines.`);
}
