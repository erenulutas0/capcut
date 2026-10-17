import { describe, expect, it } from 'vitest';

import { confidenceOf, searchTasks, type SearchEvidence } from '@/domain/taskSearch';
import { TASK_EXAMPLES, availableTasks } from '@/domain/tasks';
import { tr } from '@/i18n/messages';

/**
 * Rule 12 (ADR-034, "Güncelleme — 11 Ekim 2026"): is the best match THE
 * answer (`sure`: highlighted, started by Enter) or one of a few guesses
 * (`ask`: "Bunu mu demek istedin?", nothing started until one is picked)?
 *
 * The phrases here are from tables and sets that had already been seen; the
 * measurement is in tests/quality (search-eval-fresh3.ts, measured once).
 */

function found(query: string) {
  const result = searchTasks(query);
  if (result.kind !== 'results') throw new Error(`"${query}": ${result.kind}`);
  return result;
}

const evidence = (over: Partial<SearchEvidence>): SearchEvidence => ({
  words: 1,
  covered: 1,
  rival: 0,
  unknown: 0,
  best: 3,
  second: 0,
  specific: true,
  combined: false,
  ...over,
});

describe('confidence: the facts', () => {
  it('counts the words behind the best match, the ones another task knows and the ones nobody knows', () => {
    // "sessiz yerleri": the pair; "sil": Kes knows it, Boşlukları at does not need it.
    expect(found('sessiz yerleri sil').evidence).toMatchObject({ words: 3, covered: 2, rival: 1, unknown: 0, combined: true });
    // "güzel" is İyileştir's; nobody knows "bugün" and "hava" ("çok" carries no intent).
    expect(found('bugün hava çok güzel').evidence).toMatchObject({ words: 3, covered: 1, rival: 0, unknown: 2 });
    // One word each for two tasks.
    expect(found('tiktok için kes').evidence).toMatchObject({ words: 2, covered: 1, rival: 1, best: 3, second: 3 });
    // A phrase covers each of its words that carries intent.
    expect(found('her yerde açılsın').evidence.covered).toBe(2);
  });
});

describe('confidence: the rule', () => {
  it('two words or more behind the match: sure unless the next task is close', () => {
    expect(confidenceOf(evidence({ words: 2, covered: 2, best: 7, second: 3 }))).toBe('sure');
    expect(confidenceOf(evidence({ words: 3, covered: 2, rival: 1, best: 7, second: 5.5 }))).toBe('sure');
    expect(confidenceOf(evidence({ words: 2, covered: 2, best: 3, second: 3 }))).toBe('ask');
    // Two or more words left over: the next task has to stay under half.
    expect(confidenceOf(evidence({ words: 5, covered: 2, unknown: 3, best: 4, second: 1.5 }))).toBe('sure');
    expect(confidenceOf(evidence({ words: 5, covered: 2, unknown: 3, best: 4, second: 2 }))).toBe('ask');
  });

  it('one word behind the match: sure only when it is the whole request, or the task named outright with one word to spare', () => {
    expect(confidenceOf(evidence({ words: 1, covered: 1, best: 3 }))).toBe('sure');
    expect(confidenceOf(evidence({ words: 1, covered: 1, best: 2 }))).toBe('sure');
    // A supporting word alone ("sil"): not an answer.
    expect(confidenceOf(evidence({ words: 1, covered: 1, best: 1, specific: false }))).toBe('ask');
    expect(confidenceOf(evidence({ words: 2, covered: 1, unknown: 1, best: 3 }))).toBe('sure');
    expect(confidenceOf(evidence({ words: 2, covered: 1, unknown: 1, best: 2 }))).toBe('ask');
    expect(confidenceOf(evidence({ words: 2, covered: 1, rival: 1, best: 3, second: 1.5 }))).toBe('ask');
    // Two or more words left unexplained: whatever the word, it is a guess.
    expect(confidenceOf(evidence({ words: 3, covered: 1, unknown: 2, best: 3 }))).toBe('ask');
  });
});

describe('confidence: what the user gets', () => {
  it('every card name and every example chip is answered directly', () => {
    const names = availableTasks().map((task) => tr[task.labelKey]);
    for (const phrase of [...names, ...TASK_EXAMPLES]) {
      const result = found(phrase);
      expect(result.confidence, phrase).toBe('sure');
      expect(result.matches[0]?.task.available, phrase).toBe(true);
    }
  });

  it('plain requests stay direct answers', () => {
    for (const [phrase, id] of [
      ['videoyu kes', 'kes'],
      ['sessiz yerleri sil', 'bosluk'],
      ['tiktok için dikey', 'dikey'],
      ['videom whatsapp’a sığmıyor', 'kucult'],
      ['altyazı ekle', 'yazi'],
      ['müzik koy', 'muzik'],
      ['sesini mp3 yap', 'ses'],
      ['sesini kapat', 'sustur'],
      ['make it vertical', 'dikey'],
      ['extract audio', 'ses'],
    ] as const) {
      const result = found(phrase);
      expect(result.confidence, phrase).toBe('sure');
      expect(result.matches[0]?.task.id, phrase).toBe(id);
    }
  });

  it('asks when two tasks have a word each — and offers both', () => {
    for (const [phrase, ids] of [
      ['tiktok için kes', ['dikey', 'kes']],
      ['altyazı kes', ['yazi', 'kes']],
      ['sesi kes', ['kes', 'ses']],
    ] as const) {
      const result = found(phrase);
      expect(result.confidence, phrase).toBe('ask');
      expect(result.matches.map((match) => match.task.id), phrase).toEqual(ids);
    }
  });

  it('asks instead of answering small talk and out-of-list requests that share one word with a task', () => {
    // Each of these used to be ONE card with "Başla", started by Enter (seen sets, 10–11 Oct 2026).
    for (const phrase of ['bugün hava çok güzel', 'kesinlikle çok güzel olmuş', 'videoyu instagramda paylaş', 'oyun oyna', 'dvd ye yaz', 'bu şarkının adı ne']) {
      expect(found(phrase).confidence, phrase).toBe('ask');
    }
  });

  it('among choices a weaker task that works gets a row; a "not yet" row needs the usual share', () => {
    // "sesi kes": Kes 3, Sesini al 2 — and the noise entry ("ses") stays out, as before.
    expect(found('sesi kes').matches.map((match) => match.task.id)).toEqual(['kes', 'ses']);
    // A row that cannot start may still be one of the choices when the words point at it as much.
    const shared = found('videoyu instagramda paylaş');
    expect(shared.matches.map((match) => [match.task.id, match.task.available])).toEqual([
      ['dikey', true],
      ['yukle', false],
    ]);
  });

  it('“Bunu henüz yapamıyoruz.” is never turned into a question', () => {
    for (const phrase of ['whatsapp çıkartması yap', 'videoyu döndür', 'tiktok logosunu kaldır', 'youtubedan video indir']) {
      const result = found(phrase);
      expect(result.matches[0]?.task.available, phrase).toBe(false);
      expect(result.confidence, phrase).toBe('sure');
    }
  });

  it('"GIF yap" (ADR-046) is answered as the card it now is, not asked about', () => {
    for (const phrase of ['gife çevir', 'gif yap', 'make a gif', 'videodan gif']) {
      const result = found(phrase);
      expect(result.matches[0]?.task.id, phrase).toBe('gif');
      expect(result.matches[0]?.task.available, phrase).toBe(true);
      expect(result.confidence, phrase).toBe('sure');
    }
  });

  it('half-typed words: one task → direct; several tasks start that way → choices', () => {
    expect(found('dike').confidence).toBe('sure');
    expect(found('sess').confidence).toBe('sure');
    // "di" begins dikey, dik, dinle…: nothing is highlighted until the word says more.
    expect(found('di').confidence).toBe('ask');
  });
});
