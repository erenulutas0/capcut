import { test } from '@playwright/test';

import { tr } from '../../src/i18n/messages';
import { strongJargon } from './lib/jargon';
import { median, round, writeResult } from './lib/record';

/**
 * Section 9 (second half) — how hard the app's Turkish is to read.
 *
 * Every string of the Turkish message table gets an Ateşman score (1997;
 * the Turkish adaptation of Flesch's reading ease):
 *
 *   198.825 − 40.175 × (syllables per word) − 2.610 × (words per sentence)
 *
 *   90–100 very easy · 70–89 easy · 50–69 medium · 30–49 hard · below 30 very hard
 *
 * A Turkish syllable has exactly one vowel, so syllables are counted as
 * vowels. It is a rough ruler: it knows nothing about whether a word is
 * familiar. That is why the jargon list is reported next to it, and why the
 * twenty hardest strings are printed in full for a person to judge.
 *
 * "Default path" = what a first-time user meets without opening the editor's
 * settings: the opening screen, the cards, the wizards, transcript, download
 * and error texts.
 */

const DEFAULT_PATH = /^(home|task|wizard|transcript|download|error|export\.fail|export\.save|silence\.failed|enhance|landing|preview\.pickVideo)\b/;

const VOWELS = /[aeıioöuüâîû]/giu;

function measure(raw: string) {
  // Placeholders are filled with short values in the app: they are not words to read.
  const text = raw.replace(/\{\w+\}/g, '').replace(/\s+/g, ' ').trim();
  const words = text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)?/gu) ?? [];
  const sentences = text.split(/[.!?…;:]+(?:\s+|$)/u).filter((part) => /[\p{L}\p{N}]/u.test(part));
  const syllables = words.reduce((sum, word) => sum + Math.max(1, (word.match(VOWELS) ?? []).length), 0);
  const sentenceCount = Math.max(1, sentences.length);
  const longestSentence = sentences.reduce((most, part) => Math.max(most, (part.match(/[\p{L}\p{N}]+/gu) ?? []).length), 0);
  const longestWord = words.reduce((longest, word) => (word.length > longest.length ? word : longest), '');
  const score = words.length === 0 ? null : 198.825 - 40.175 * (syllables / words.length) - 2.61 * (words.length / sentenceCount);
  return {
    words: words.length,
    sentences: sentenceCount,
    wordsPerSentence: words.length / sentenceCount,
    syllablesPerWord: words.length === 0 ? 0 : syllables / words.length,
    longestSentence,
    longestWord,
    score,
  };
}

const band = (score: number): string =>
  score >= 90 ? 'çok kolay' : score >= 70 ? 'kolay' : score >= 50 ? 'orta' : score >= 30 ? 'zor' : 'çok zor';

test('text: readability of the Turkish strings', async ({}, testInfo) => {
  const all = Object.entries(tr as Record<string, string>).map(([key, text]) => ({ key, text, defaultPath: DEFAULT_PATH.test(key), ...measure(text) }));
  const summarize = (rows: typeof all) => {
    // A score needs a sentence to stand on: strings of five words or more.
    const scored = rows.filter((row) => row.score !== null && row.words >= 5);
    const scores = scored.map((row) => row.score as number);
    const bands: Record<string, number> = { 'çok kolay': 0, kolay: 0, orta: 0, zor: 0, 'çok zor': 0 };
    for (const score of scores) bands[band(score)] = (bands[band(score)] ?? 0) + 1;
    return {
      strings: rows.length,
      words: rows.reduce((sum, row) => sum + row.words, 0),
      scoredStrings: scored.length,
      medianScore: scores.length > 0 ? round(median(scores) ?? 0, 1) : null,
      hardPercent: scores.length > 0 ? round((scores.filter((score) => score < 50).length / scores.length) * 100, 1) : null,
      veryHard: scores.filter((score) => score < 30).length,
      bands,
      longestSentenceWords: rows.reduce((most, row) => Math.max(most, row.longestSentence), 0),
      sentencesOver20Words: rows.filter((row) => row.longestSentence > 20).length,
      longestWord: rows.reduce((longest, row) => (row.longestWord.length > longest.length ? row.longestWord : longest), ''),
      medianWordsPerSentence: round(median(scored.map((row) => row.wordsPerSentence)) ?? 0, 1),
    };
  };
  const hardest = (rows: typeof all) =>
    rows
      .filter((row) => row.score !== null && row.words >= 5)
      .sort((a, b) => (a.score as number) - (b.score as number))
      .slice(0, 20)
      .map((row) => ({
        key: row.key,
        score: round(row.score as number, 1),
        band: band(row.score as number),
        words: row.words,
        wordsPerSentence: round(row.wordsPerSentence, 1),
        syllablesPerWord: round(row.syllablesPerWord, 2),
        longestWord: row.longestWord,
        text: row.text,
      }));
  const defaultPath = all.filter((row) => row.defaultPath);
  const jargon = defaultPath
    .flatMap((row) => strongJargon(row.text).map((hit) => ({ key: row.key, term: hit.term, text: row.text.length > 160 ? `${row.text.slice(0, 157)}…` : row.text })))
    .filter((item, index, list) => list.findIndex((other) => other.key === item.key && other.term === item.term) === index);
  writeResult('text', testInfo.project.name, {
    all: summarize(all),
    defaultPath: summarize(defaultPath),
    hardestDefaultPath: hardest(defaultPath),
    hardestAll: hardest(all),
    jargonDefaultPath: { strings: new Set(jargon.map((item) => item.key)).size, list: jargon },
  });
});
