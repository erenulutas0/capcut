/**
 * WER / CER with a small Levenshtein implementation, plus the timing proxies
 * the spike can compute without reference word times.
 */

/**
 * Same normaliser for hypothesis and reference: NFC, locale lowercase
 * (Turkish dotted/dotless i), punctuation → space, hyphen → space, keep
 * apostrophes inside words (Turkish proper-noun suffixes: "USOC'nin").
 */
export function normalizeText(text, lang) {
  let s = (text ?? '').normalize('NFC');
  s = lang === 'tr' ? s.toLocaleLowerCase('tr') : s.toLowerCase();
  // Python's str.lower() turns İ into "i" + U+0307 (FLEURS' normalised column has this); drop the mark.
  s = s.replace(/̇/g, '');
  s = s.replace(/[’‘`´]/g, "'");
  s = s.replace(/[^\p{L}\p{N}\s']/gu, ' ');
  s = s.replace(/(^|\s)'+|'+(\s|$)/g, ' ');
  return s.split(/\s+/).filter(Boolean).join(' ');
}

/** Levenshtein with backtrace; returns distance and op counts. */
export function levenshtein(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const d = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  let i = n;
  let j = m;
  const ops = { sub: 0, ins: 0, del: 0, hit: 0 };
  const alignment = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] === hyp[j - 1]) ops.hit += 1;
      else {
        ops.sub += 1;
        alignment.push({ op: 'sub', ref: ref[i - 1], hyp: hyp[j - 1] });
      }
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.del += 1;
      alignment.push({ op: 'del', ref: ref[i - 1] });
      i -= 1;
    } else {
      ops.ins += 1;
      alignment.push({ op: 'ins', hyp: hyp[j - 1] });
      j -= 1;
    }
  }
  return { distance: d[n][m], ops, alignment: alignment.reverse() };
}

export function wordErrors(reference, hypothesis, lang) {
  const ref = normalizeText(reference, lang).split(' ').filter(Boolean);
  const hyp = normalizeText(hypothesis, lang).split(' ').filter(Boolean);
  const lev = levenshtein(ref, hyp);
  return { refWords: ref.length, hypWords: hyp.length, errors: lev.distance, ops: lev.ops, alignment: lev.alignment };
}

export function charErrors(reference, hypothesis, lang) {
  const ref = [...normalizeText(reference, lang)];
  const hyp = [...normalizeText(hypothesis, lang)];
  const lev = levenshtein(ref, hyp);
  return { refChars: ref.length, errors: lev.distance };
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Timing proxies from ffmpeg silencedetect boundaries (no reference word
 * times exist in FLEURS):
 *  - onsetDevS: |first word start − end of leading silence|
 *  - offsetDevS: |last word end − start of trailing silence|
 *  - pauseDevS: for each internal pause end, distance to the nearest word start
 *  - sane: word times monotonic and inside [0, duration]
 */
export function timingProxies(chunks, clip) {
  const words = chunks.filter((c) => c.start !== null && c.end !== null);
  if (words.length === 0) return { measured: false, reason: 'no timestamps' };
  const dur = clip.durationS;
  let monotonic = true;
  let inRange = true;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].end < words[i].start) monotonic = false;
    if (i > 0 && words[i].start < words[i - 1].start - 1e-6) monotonic = false;
    if (words[i].start < -1e-6 || words[i].end > dur + 0.25) inRange = false;
  }
  // Merge silences separated by a blip shorter than 150 ms (clicks, breaths).
  const sil = [];
  for (const s of (clip.silences ?? []).map((x) => ({ start: x.start, end: x.end ?? dur }))) {
    const last = sil[sil.length - 1];
    if (last && s.start - last.end < 0.15) last.end = Math.max(last.end, s.end);
    else sil.push({ ...s });
  }
  const leading = sil.find((s) => s.start <= 0.3);
  const trailing = sil.find((s) => s !== leading && s.end >= dur - 0.1);
  const onsetDevS = leading ? Math.abs(words[0].start - leading.end) : null;
  const offsetDevS = trailing ? Math.abs(words[words.length - 1].end - trailing.start) : null;
  const internal = sil.filter((s) => s !== leading && s !== trailing && s.end - s.start >= 0.25);
  const pauseDevS = internal.map((s) => Math.min(...words.map((w) => Math.abs(w.start - s.end))));
  return { measured: true, monotonic, inRange, words: words.length, onsetDevS, offsetDevS, pauseDevS };
}
