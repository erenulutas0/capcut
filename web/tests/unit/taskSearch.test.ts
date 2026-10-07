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
  // Sesi kapat (7 Oct 2026): the sound is switched off — not taken out as a file ("Sesini al").
  ['sesi kapat', 'sustur'],
  ['sesini kapat', 'sustur'],
  ['sessiz yap', 'sustur'],
  ['sessize al', 'sustur'],
  ['sesi sil', 'sustur'],
  ['mute', 'sustur'],
  ['remove audio', 'sustur'],
  ['no sound', 'sustur'],
  // …and its neighbour stays what it was.
  ['sesini al', 'ses'],
  ['sesini çıkar', 'ses'],
  ['audio only', 'ses'],
  // Asked for, not possible yet: found, so that the answer is "Bunu henüz yapamıyoruz."
  ['döndür', 'dondur'],
  ['sağa döndür', 'dondur'],
  ['ters çevir', 'dondur'],
  ['rotate', 'dondur'],
  ['rotate 90', 'dondur'],
  ['flip horizontally', 'dondur'],
  ['hızlandır', 'hiz'],
  ['videoyu yavaşlat', 'hiz'],
  ['hızını değiştir', 'hiz'],
  ['speed up', 'hiz'],
  ['slow down', 'hiz'],
  ['fast forward', 'hiz'],
  ['birleştir', 'birlestir'],
  ['videoları birleştir', 'birlestir'],
  ['uç uca ekle', 'birlestir'],
  ['merge', 'birlestir'],
  ['combine two videos', 'birlestir'],
  ['join videos', 'birlestir'],
  ['gif', 'gif'],
  ['gif oluştur', 'gif'],
  ['gif e dönüştür', 'gif'],
  ['convert to gif', 'gif'],
  ['animated gif', 'gif'],
  ['filigran', 'filigran'],
  ['filigran sil', 'filigran'],
  ['logoyu kaldır', 'filigran'],
  ['watermark', 'filigran'],
  ['remove logo', 'filigran'],
  ['filtre', 'efekt'],
  ['efekt ekle', 'efekt'],
  ['renk ayarı', 'efekt'],
  ['siyah beyaz', 'efekt'],
  ['filter', 'efekt'],
  ['brightness', 'efekt'],
  ['arka planı kaldır', 'arkaplan'],
  ['arka plan değiştir', 'arkaplan'],
  ['arkaplan sil', 'arkaplan'],
  ['background remove', 'arkaplan'],
  ['blur the background', 'arkaplan'],
  ['tersten', 'ters'],
  ['videoyu ters oynat', 'ters'],
  ['geriye doğru oynat', 'ters'],
  ['reverse', 'ters'],
  ['backwards', 'ters'],
  ['fotoğraf çıkar', 'foto'],
  ['videodan kare al', 'foto'],
  ['ekran görüntüsü', 'foto'],
  ['screenshot', 'foto'],
  ['save a frame', 'foto'],
  ['titreme', 'stabil'],
  ['titreyen video', 'stabil'],
  ['sarsıntı', 'stabil'],
  ['stabilize video', 'stabil'],
  ['shaky', 'stabil'],
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
    expect(top('kahve tarifi')).toBe('none');
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

  it('“Sesini al” and “Sesi kapat” are told apart by what is done to the sound', () => {
    // Taking the sound out as a file…
    for (const phrase of ['sesini al', 'sesini mp3 yap', 'extract audio', 'sadece ses', 'videodan müzik çıkar']) {
      expect(top(phrase), phrase).toBe('ses');
    }
    // …or switching it off in the video.
    for (const phrase of ['sesini kapat', 'sesini sil', 'sessize al', 'remove audio', 'mute', 'no sound']) {
      expect(top(phrase), phrase).toBe('sustur');
    }
    // Where one word is shared ("sesini", "audio"), the other task is still on the list, second.
    expect(ids('sesini sil')).toEqual(['sustur', 'ses']);
    expect(ids('remove audio')).toEqual(['sustur', 'ses']);
    // Typing "sess…" is still about the silent parts, not about muting.
    expect(ids('sess')).toEqual(['bosluk']);
    expect(ids('sessiz')).toEqual(['bosluk']);
    expect(ids('sessiz yerleri sil')).toEqual(['bosluk']);
  });

  it('a request the app cannot serve yet is answered as such, and no card that does another job is offered under it', () => {
    // Until 7 Oct 2026 these found a card with a "Başla" button: Her yerde açılsın, Dikey yap, Kes, Müzik ekle.
    for (const [phrase, id] of [
      ['gife çevir', 'gif'],
      ['tiktok logosunu kaldır', 'filigran'],
      ['logo sil', 'filigran'],
      ['arka planı sil', 'arkaplan'],
      ['hızlı oynat', 'hiz'],
      ['90 derece çevir', 'dondur'],
    ] as const) {
      const result = searchTasks(phrase);
      expect(result.kind, phrase).toBe('results');
      if (result.kind !== 'results') continue;
      expect(result.matches[0]?.task.id, phrase).toBe(id);
      expect(result.matches[0]?.task.available, phrase).toBe(false);
      // Rule 7: nothing startable under it.
      expect(result.matches.filter((match) => match.task.available).map((match) => match.task.id), phrase).toEqual([]);
    }
    // Two wishes in one sentence, one possible: both are shown, the honest one included.
    expect(ids('döndür ve kes').sort()).toEqual(['dondur', 'kes']);
    // A task that works is not pushed out by an entry that only shares a weak word.
    expect(ids('arka plana müzik')).toEqual(['muzik']);
    expect(ids('background song')).toEqual(['muzik']);
    expect(ids('formatını değiştir')).toEqual(['cevir']);
    expect(ids('mov dosyasını çevir')).toEqual(['cevir']);
    expect(ids('video yan duruyor dik olsun')[0]).toBe('dikey');
  });

  it('reports tasks that are not available as such, never hiding them', () => {
    // The mechanism, shown on a task that works: switched off, it is still found and says so.
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
  const CARDS = ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'cevir'];
  const CANNOT_YET = ['dondur', 'hiz', 'birlestir', 'gif', 'filigran', 'efekt', 'arkaplan', 'ters', 'foto', 'stabil'];

  it('lists the nine tasks in card order — Kes first, Sesi kapat next to Sesini al — then what cannot be done yet', () => {
    expect(TASKS.map((task) => task.id)).toEqual([...CARDS, ...CANNOT_YET]);
    expect(new Set(TASKS.map((task) => task.id)).size).toBe(TASKS.length);
  });

  it('offers exactly the tasks the engine can do today', () => {
    expect(availableTasks().map((task) => task.id)).toEqual(CARDS);
    expect(TASKS.filter((task) => !task.available).map((task) => task.id)).toEqual(CANNOT_YET);
  });

  it('what cannot be done yet has one icon, a name to say, and no wizard of its own', () => {
    for (const task of TASKS.filter((item) => !item.available)) {
      expect(task.icon, task.id).toBe('taskLater');
      expect(tr[task.labelKey], task.id).toBeTruthy();
      expect(task.generic, task.id).toBeUndefined();
    }
    expect(tr['home.results.unavailable']).toBe('Bunu henüz yapamıyoruz.');
    expect(en['home.results.unavailable']).toBe('We cannot do this yet.');
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
