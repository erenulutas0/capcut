import { describe, expect, it } from 'vitest';

import { editDistance, foldText, searchTasks, searchTokens, MAX_RESULTS } from '@/domain/taskSearch';
import { TASKS, TASK_EXAMPLES, availableTasks, taskById, type TaskId } from '@/domain/tasks';
import { en, tr } from '@/i18n/messages';

/** The first result's id, or the kind when there is none. */
function top(query: string): TaskId | 'empty' | 'none' {
  const result = searchTasks(query);
  return result.kind === 'results' ? (result.matches[0]?.task.id ?? 'none') : result.kind;
}

function ids(query: string): TaskId[] {
  const result = searchTasks(query);
  return result.kind === 'results' ? result.matches.map((match) => match.task.id) : [];
}

/**
 * What a person who has never edited a video types, Turkish and English.
 * Exported so the report can count it: every row must put its task FIRST.
 */
export const PHRASES: ReadonlyArray<readonly [string, TaskId]> = [
  // Kes
  ['başını kes', 'kes'],
  ['videonun sonunu kesmek istiyorum', 'kes'],
  ['kırp', 'kes'],
  ['videoyu kısalt', 'kes'],
  ['ortasından bir parça al', 'kes'],
  ['istediğim yeri ayır', 'kes'],
  ['videoyu ikiye böl', 'kes'],
  ['trim my video', 'kes'],
  ['cut the beginning', 'kes'],
  ['shorten', 'kes'],
  ['KES', 'kes'],
  // Boşlukları at
  ['sessiz yerleri sil', 'bosluk'],
  ['boşlukları at', 'bosluk'],
  ['sessizlikleri çıkar', 'bosluk'],
  ['konuşmadığım yerleri kes', 'bosluk'],
  ['duraklamaları sil', 'bosluk'],
  ['boş yerleri çıkar', 'bosluk'],
  ['remove silence', 'bosluk'],
  ['cut the pauses', 'bosluk'],
  ['dead air', 'bosluk'],
  ['sesiz yerleri sil', 'bosluk'],
  // Dikey yap
  ['tiktok için dikey', 'dikey'],
  ['TikTok için dikey', 'dikey'],
  ['reels yap', 'dikey'],
  ['instagram hikayesi', 'dikey'],
  ['youtube shorts', 'dikey'],
  ['yatay videoyu dikey yap', 'dikey'],
  ['make it vertical', 'dikey'],
  ['9:16', 'dikey'],
  ['dikye yap', 'dikey'],
  ['titok', 'dikey'],
  ['İNSTAGRAM', 'dikey'],
  // Müzik ekle
  ['müzik koy', 'muzik'],
  ['müzik ekle', 'muzik'],
  ['arkaya şarkı koy', 'muzik'],
  ['fon müziği', 'muzik'],
  ['add music', 'muzik'],
  ['background song', 'muzik'],
  ['muzık ekle', 'muzik'],
  // Her yerde açılsın
  ['iphone videosu açılmıyor', 'cevir'],
  ['video açılmıyor', 'cevir'],
  ['televizyonda oynatmıyor', 'cevir'],
  ['mp4 yap', 'cevir'],
  ['mov dosyasını çevir', 'cevir'],
  ['formatını değiştir', 'cevir'],
  ['her yerde açılsın', 'cevir'],
  ['hevc', 'cevir'],
  ['convert to mp4', 'cevir'],
  ['video won’t open', 'cevir'],
  ['windows’ta çalışmıyor', 'cevir'],
  // Küçült (available since ADR-035).
  ['videom whatsapp’a sığmıyor', 'kucult'],
  ["videom whatsapp'a sığmıyor", 'kucult'],
  ['WhatsApp’a sığmıyor', 'kucult'],
  ['dosya çok büyük', 'kucult'],
  ['boyutunu küçült', 'kucult'],
  ['sıkıştır', 'kucult'],
  ['mail ile gönderemiyorum', 'kucult'],
  ['compress video', 'kucult'],
  ['make it smaller', 'kucult'],
  ['too big for email', 'kucult'],
  ['whatsap', 'kucult'],
  // Sesini al (available since ADR-035).
  ['sesini mp3 yap', 'ses'],
  ['videonun sesini al', 'ses'],
  ['sadece ses', 'ses'],
  ['mp3', 'ses'],
  ['extract audio', 'ses'],
  ['podcast yap', 'ses'],
  // Yazıya dök — not available yet.
  ['altyazı ekle', 'yazi'],
  ['yazıya dök', 'yazi'],
  ['konuşmayı metne çevir', 'yazi'],
  ['transkript', 'yazi'],
  ['add subtitles', 'yazi'],
  ['captions', 'yazi'],
  ['transcribe', 'yazi'],
  // İyileştir (ADR-037) — including what it cannot do: those words lead to the card and its honest line.
  ['videoyu iyileştir', 'iyilestir'],
  ['görüntüyü netleştir', 'iyilestir'],
  ['video çok karanlık', 'iyilestir'],
  ['karanlık videoyu aydınlat', 'iyilestir'],
  ['renkleri düzelt', 'iyilestir'],
  ['bulanık çıkmış', 'iyilestir'],
  ['kaliteyi yükselt', 'iyilestir'],
  ['4K yap', 'iyilestir'],
  ['bulanıklığı sil', 'iyilestir'],
  ['enhance my video', 'iyilestir'],
  ['sharpen', 'iyilestir'],
  ['brighten the video', 'iyilestir'],
  ['improve quality', 'iyilestir'],
  ['upscale to 4k', 'iyilestir'],
];

describe('foldText', () => {
  it('lowers with Turkish rules and removes diacritics and punctuation', () => {
    expect(foldText('Videom WhatsApp’a SIĞMIYOR!')).toBe('videom whatsapp a sigmiyor');
    expect(foldText('İNSTAGRAM, Işık; çöğüş')).toBe('instagram isik cogus');
    expect(foldText('  9:16  ')).toBe('9 16');
    expect(foldText('')).toBe('');
  });
});

describe('searchTokens', () => {
  it('drops one-letter tokens and stop words, in both languages', () => {
    expect(searchTokens('videom whatsapp’a sığmıyor')).toEqual(['whatsapp', 'sigmiyor']);
    expect(searchTokens('I want to make my video vertical please')).toEqual(['vertical']);
    expect(searchTokens('bu videoyu ne yapmak lazım')).toEqual([]);
  });
});

describe('editDistance', () => {
  it('counts a swap of neighbours as one edit', () => {
    expect(editDistance('dikye', 'dikey')).toBe(1);
    expect(editDistance('sesiz', 'sessiz')).toBe(1);
    expect(editDistance('whatsap', 'whatsapp')).toBe(1);
    expect(editDistance('kes', 'ses')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('muzik', 'metin', 2)).toBeGreaterThan(1);
  });
});

describe('searchTasks: the phrase table', () => {
  it.each(PHRASES)('“%s” → %s', (phrase, expected) => {
    expect(top(phrase)).toBe(expected);
  });

  it('covers every task, available or not, in Turkish and in English', () => {
    for (const task of TASKS) {
      expect(PHRASES.filter(([, id]) => id === task.id).length, task.id).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('searchTasks: rules', () => {
  it('keeps the cards while nothing meaningful is typed', () => {
    expect(top('')).toBe('empty');
    expect(top('   ')).toBe('empty');
    expect(top('k')).toBe('empty');
    expect(top('video')).toBe('empty');
    expect(top('my video')).toBe('empty');
  });

  it('says so when no task knows the words', () => {
    expect(top('pizza siparişi')).toBe('none');
    expect(top('qwertyuiop')).toBe('none');
    expect(top('3d efekt')).toBe('none');
  });

  it('finds tasks while the word is still being typed', () => {
    expect(ids('sess')).toEqual(['bosluk']);
    expect(ids('dik')).toEqual(['dikey']);
    expect(top('müz')).toBe('muzik');
    expect(top('whats')).toBe('kucult');
    // Two letters: only for the word being typed, and only strong words.
    expect(ids('di')).toContain('dikey');
    expect(top('di ')).toBe('none');
  });

  it('a longer word wins a token: “sessiz” is not “ses”', () => {
    expect(ids('sessiz')).toEqual(['bosluk']);
    expect(ids('sessizlikleri')).toEqual(['bosluk']);
    expect(ids('sesini')).toEqual(['ses']);
  });

  it('a stray weak word does not add a second row', () => {
    expect(ids('altyazı ekle')).toEqual(['yazi']);
    expect(ids('remove silence')).toEqual(['bosluk']);
    expect(ids('sesini mp3 yap')).toEqual(['ses']);
  });

  it('shows both when the words really point at two tasks', () => {
    expect(ids('tiktok için kes')).toEqual(['dikey', 'kes']);
    expect(ids('sesi kes').sort()).toEqual(['kes', 'ses']);
  });

  it('a tie goes to the more specific task, not to the generic Kes', () => {
    expect(ids('cut the pauses')).toEqual(['bosluk', 'kes']);
    expect(ids('kes')).toEqual(['kes']);
    // "sesiz" is "sessiz" with a letter missing, not "ses" with a suffix.
    expect(ids('sesiz')).toEqual(['bosluk']);
  });

  it('never returns more than three, best first, scores descending', () => {
    const result = searchTasks('kes dikey müzik mp4 sessiz');
    expect(result.kind).toBe('results');
    if (result.kind !== 'results') return;
    expect(result.matches).toHaveLength(MAX_RESULTS);
    const scores = result.matches.map((match) => match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('tolerates one typo only in words of five letters or more', () => {
    expect(top('dikye')).toBe('dikey');
    expect(top('instagrm')).toBe('dikey');
    expect(top('kse')).toBe('none');
    // A different first letter is a different word.
    expect(top('eessiz')).toBe('none');
  });

  it('reports tasks that are not available as such, never hiding them', () => {
    // Every task works today (ADR-036 enabled the last one); the rule is kept
    // for the next task that is announced before it is built.
    const withOneOff = TASKS.map((task) => (task.id === 'yazi' ? { ...task, available: false } : task));
    const result = searchTasks('altyazı ekle', withOneOff);
    expect(result.kind).toBe('results');
    if (result.kind !== 'results') return;
    expect(result.matches[0]?.task.id).toBe('yazi');
    expect(result.matches[0]?.task.available).toBe(false);
    // ADR-035 and ADR-036: "Küçült", "Sesini al" and "Yazıya dök" work, and the search says so.
    for (const [phrase, id] of [
      ['videom whatsapp’a sığmıyor', 'kucult'],
      ['sesini mp3 yap', 'ses'],
      ['altyazı ekle', 'yazi'],
      ['konuşmayı yazıya dök', 'yazi'],
    ] as const) {
      const found = searchTasks(phrase);
      expect(found.kind, phrase).toBe('results');
      if (found.kind !== 'results') continue;
      expect(found.matches[0]?.task.id, phrase).toBe(id);
      expect(found.matches[0]?.task.available, phrase).toBe(true);
    }
  });
});

describe('task registry', () => {
  it('lists the nine tasks in card order with unique ids', () => {
    expect(TASKS.map((task) => task.id)).toEqual(['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'cevir', 'iyilestir']);
    expect(new Set(TASKS.map((task) => task.id)).size).toBe(TASKS.length);
  });

  it('offers exactly the tasks the engine can do today', () => {
    expect(availableTasks().map((task) => task.id)).toEqual(['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'cevir', 'iyilestir']);
    expect(TASKS.filter((task) => !task.available).map((task) => task.id)).toEqual([]);
  });

  it('keeps every word folded, so the search compares like with like', () => {
    for (const task of TASKS) {
      for (const word of [...task.words.strong, ...task.words.weak]) {
        expect(foldText(word), `${task.id}: ${word}`).toBe(word);
        expect(word.includes(' '), `${task.id}: ${word} is a phrase`).toBe(false);
      }
      for (const phrase of task.words.phrases) {
        expect(foldText(phrase), `${task.id}: ${phrase}`).toBe(phrase);
        expect(phrase.split(' ').length, `${task.id}: ${phrase}`).toBeGreaterThanOrEqual(2);
      }
      expect(new Set(task.words.strong).size, `${task.id}: duplicate strong word`).toBe(task.words.strong.length);
      expect(task.words.strong.filter((word) => task.words.weak.includes(word)), task.id).toEqual([]);
    }
  });

  it('has a label and a sub-label in both languages', () => {
    for (const task of TASKS) {
      for (const key of [task.labelKey, task.subKey]) {
        expect(tr[key], key).toBeTruthy();
        expect(en[key], key).toBeTruthy();
      }
    }
  });

  it('every wizard starts with the video, has at most one decision and ends in a download or the editor', () => {
    for (const task of TASKS) {
      expect(task.steps[0], task.id).toBe('pick');
      expect(task.steps.filter((step) => step === 'choose').length, task.id).toBeLessThanOrEqual(1);
      expect(['download', 'editor'], task.id).toContain(task.steps[task.steps.length - 1]);
      expect(task.steps.length, task.id).toBeLessThanOrEqual(3);
    }
  });

  it('the example phrases under the box all lead to a task that exists', () => {
    for (const example of TASK_EXAMPLES) {
      const result = searchTasks(example);
      expect(result.kind, example).toBe('results');
      if (result.kind === 'results') expect(result.matches[0]?.task.available, example).toBe(true);
    }
  });

  it('finds a task by id', () => {
    expect(taskById('dikey')?.labelKey).toBe('task.dikey.label');
    expect(taskById('nope')).toBeUndefined();
  });
});
