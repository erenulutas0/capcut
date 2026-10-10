import { describe, expect, it } from 'vitest';

import { searchTasks } from '@/domain/taskSearch';
import { TASKS, type TaskId } from '@/domain/tasks';

/**
 * The rules added on 10 Oct 2026 (quality report: one request in ten was
 * offered a card that does another job). Each test names the rule; the
 * phrases are the ones the rules were written for (the DEV set of
 * tests/quality/data/search-eval.ts), not a measurement.
 */

function answer(query: string): { first: TaskId | 'none' | 'empty'; start: boolean; ids: TaskId[] } {
  const result = searchTasks(query);
  if (result.kind !== 'results') return { first: result.kind, start: false, ids: [] };
  const first = result.matches[0];
  return { first: first?.task.id ?? 'none', start: first?.task.available === true, ids: result.matches.map((match) => match.task.id) };
}
const top = (query: string) => answer(query).first;

describe('a word is its forms, not everything that starts like it', () => {
  it('Turkish endings are understood', () => {
    expect(top('kesmek istiyorum')).toBe('kes');
    expect(top('videoyu kesebilir miyim')).toBe('kes');
    expect(top('küçültmek istiyorum')).toBe('kucult');
    expect(top('küçültebilir miyim')).toBe('kucult');
    expect(top('dikey yapmak istiyorum')).toBe('dikey');
    expect(top('yazıya dökmek istiyorum')).toBe('yazi');
    expect(top('müziğini')).toBe('muzik');
  });

  it('another word is not a task: "kesinlikle" is not Kes, "dikkat" is not Dikey, "netflix" is not İyileştir', () => {
    expect(answer('dikkat et').start).toBe(false);
    expect(answer('netflix').start).toBe(false);
    expect(answer('kesinlikle').ids).not.toContain('kes');
    expect(answer('sesli harfler').ids).not.toContain('ses');
  });

  it('only the last word can be half typed', () => {
    expect(top('sess')).toBe('bosluk');
    expect(top('whats')).toBe('kucult');
    // "güzel" in the middle of a sentence is a word, not the beginning of "güzelleştir".
    expect(answer('güzel bir gün geçirdik bugün').start).toBe(false);
    // Two letters start a search only while nothing else was typed.
    expect(answer('di').ids).toContain('dikey');
    expect(answer('bir bölümünü al').ids).toEqual(['kes']);
  });
});

describe('what is done to the sound', () => {
  it('a word for the sound next to "off / gone / not wanted" is Sesi kapat — never Sesini al', () => {
    for (const phrase of [
      'sesi kapa',
      'videoda ses olmasın',
      'ses hiç çıkmasın',
      'sesini istemiyorum',
      'sesi tamamen kaldırmak istiyorum',
      'sesleri yok et',
      'sesi kapatabilir miyim',
      'sesi olmadan kaydet',
      'i dont want any sound in my video',
      'get rid of the audio',
    ]) {
      expect(top(phrase), phrase).toBe('sustur');
    }
  });

  it('the sound or the music next to "take / save / download" is Sesini al — never Müzik ekle', () => {
    for (const phrase of [
      'müziğini almak istiyorum',
      'videodaki şarkıyı indirmek istiyorum',
      'sesini kaydet',
      'ses kaydı olarak indir',
      'rip the song from the video',
      'save just the audio',
    ]) {
      expect(top(phrase), phrase).toBe('ses');
    }
  });

  it('music next to "add / put / play" is Müzik ekle', () => {
    for (const phrase of ['videoya şarkı eklemek istiyorum', 'arkada müzik çalsın', 'müzik koymak istiyorum', 'put a song on my video']) {
      expect(top(phrase), phrase).toBe('muzik');
    }
  });

  it('the negation belongs to the word next to it: "only the sound, no picture" is not "no sound"', () => {
    expect(top('sadece sesi lazım görüntü olmasın')).toBe('ses');
  });

  it('a silent PLACE is Boşlukları at, whatever is done to it', () => {
    expect(top('sessiz kısımları kırp')).toBe('bosluk');
    expect(top('konuşmadığım yerler gitsin')).toBe('bosluk');
    expect(answer('sessiz yerleri sil').ids).toEqual(['bosluk']);
  });
});

describe('“çevir” says that something is turned into something — the word next to it says into what', () => {
  it('alone, or with a video format, it is Her yerde açılsın', () => {
    expect(top('çevir')).toBe('cevir');
    expect(top('mp4 e çevirmek istiyorum')).toBe('cevir');
    expect(top('mov dosyasını çevir')).toBe('cevir');
  });

  it('with a sound format it is Sesini al; with a language, a direction or a GIF it cannot be done', () => {
    expect(top('mp3e çevir')).toBe('ses');
    expect(top('mp3 e dönüştür')).toBe('ses');
    expect(top('convert to mp3')).toBe('ses');
    expect(top('türkçeye çevir')).toBe('tercume');
    expect(top('videoyu sağa çevir')).toBe('dondur');
    expect(top('videoyu çevir yan duruyor')).toBe('dondur');
    expect(top('gife çevir')).toBe('gif');
    expect(top('konuşmaları yazıya çevirebilir misin')).toBe('yazi');
  });
});

describe('verbs that cannot', () => {
  it('"cannot open / will not play", in any person and tense, is Her yerde açılsın', () => {
    for (const phrase of ['açamıyorum', 'bilgisayarda açılmıyor', 'açılmadı', 'televizyonda oynamıyor', 'videoyu izleyemiyorum', 'telefonum tanımıyor']) {
      expect(top(phrase), phrase).toBe('cevir');
    }
    // The same verb when it is not negative says nothing about a format.
    expect(answer('videoyu açmak istiyorum').ids).not.toContain('cevir');
  });

  it('"cannot send / does not fit" is Küçült', () => {
    for (const phrase of ['whatsapptan yollayamıyorum', 'mailden atamıyorum', 'gönderemedim', 'sığmadı', 'wp den gitmiyor']) {
      expect(top(phrase), phrase).toBe('kucult');
    }
  });
});

describe('requests nobody here can serve get an honest answer, not a card', () => {
  it('a site next to "download" is not Dikey yap', () => {
    for (const phrase of ['youtubedan video indir', 'instagramdan video indirmek istiyorum', 'tiktok videosu indir', 'linkten video indir', 'download from youtube', 'youtube to mp3']) {
      const found = answer(phrase);
      expect(found.first, phrase).toBe('indir');
      expect(found.start, phrase).toBe(false);
      expect(found.ids.filter((id) => TASKS.find((task) => task.id === id)?.available), phrase).toEqual([]);
    }
    // The site's name by itself still means what it meant.
    expect(top('tiktok için dikey')).toBe('dikey');
    expect(top('instagram hikayesi')).toBe('dikey');
    expect(top('mp3 olarak indir')).toBe('ses');
  });

  it('recording, uploading and going live are known, and not offered', () => {
    for (const [phrase, id] of [
      ['canlı yayın yap', 'yayin'],
      ['ekranımı kaydet', 'kayit'],
      ['kameradan video çek', 'kayit'],
      ['youtubea yükle', 'yukle'],
      ['upload to youtube', 'yukle'],
      ['go live', 'yayin'],
    ] as const) {
      const found = answer(phrase);
      expect(found.first, phrase).toBe(id);
      expect(found.start, phrase).toBe(false);
    }
    // "canlı" still supports a request about colours.
    expect(top('renkleri soluk daha canlı olsun')).toBe('iyilestir');
  });

  it('one supporting word in a long sentence is a guess: “Bunu bulamadım”, not a card', () => {
    expect(top('şu videoyu bilgisayara aktarıp oradan telefona yollamak nasıl oluyor acaba')).toBe('none');
    // Short requests keep the answer one supporting word gives.
    expect(top('telefona göre ayarla')).toBe('dikey');
    expect(top('gereksiz yerleri at')).toBe('kes');
    // And a long one with real evidence is answered.
    expect(top('bu videonun ilk on saniyesi gereksiz onu çıkarmak istiyorum')).toBe('kes');
  });

  it('small talk gets no card', () => {
    for (const phrase of ['merhaba nasılsın', 'teşekkürler', 'hello there', 'lütfen yardım et', 'ne yapabilirim']) {
      expect(answer(phrase).start, phrase).toBe(false);
    }
  });
});
