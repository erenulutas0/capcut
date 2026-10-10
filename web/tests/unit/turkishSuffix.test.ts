import { describe, expect, it } from 'vitest';

import { foldText } from '@/domain/taskSearch';
import { isFormOf, isNegativeFormOf, isTurkishEnding } from '@/domain/turkishSuffix';

const form = (token: string, word: string) => isFormOf(foldText(token), foldText(word));
const negative = (token: string, stem: string) => isNegativeFormOf(foldText(token), foldText(stem));

describe('Turkish endings for the search', () => {
  it('a noun with its endings is a form of the noun', () => {
    for (const token of ['ses', 'sesi', 'sesini', 'sesinden', 'sesler', 'sesleri', 'sesimi', 'sesiyle', 'seste', 'sesteki']) {
      expect(form(token, 'ses'), token).toBe(true);
    }
    for (const [token, word] of [
      ['videomu', 'video'],
      ['videolarımdan', 'video'],
      ['whatsapptan', 'whatsapp'],
      ['tiktoka', 'tiktok'],
      ['youtubedan', 'youtube'],
      ['instagramda', 'instagram'],
      ['boyutunu', 'boyut'],
      ['dosyayı', 'dosya'],
      ['şarkıyı', 'şarkı'],
      ['altyazıları', 'altyazı'],
      ['mp3e', 'mp3'],
    ] as const) {
      expect(form(token, word), token).toBe(true);
    }
  });

  it('a final k, p or t softens in front of a vowel: müzik → müziği, kitap → kitabı, renk → rengi', () => {
    expect(form('müziği', 'müzik')).toBe(true);
    expect(form('müziğini', 'müzik')).toBe(true);
    expect(form('rengi', 'renk')).toBe(true);
    expect(form('renginden', 'renk')).toBe(true);
    expect(form('kitabı', 'kitap')).toBe(true);
    // Only in front of a vowel, and only that one letter.
    expect(form('müzigler', 'müzik')).toBe(false);
    expect(form('müzisi', 'müzik')).toBe(false);
  });

  it('a verb with its endings is a form of the verb — as people type it, too', () => {
    for (const token of [
      'kes', 'kesmek', 'kesme', 'kesiyorum', 'kesiyor', 'kestim', 'kesecek', 'keseceğim', 'kesicem', 'kesiyom', 'keser',
      'kesebilir', 'kesebilirim', 'kessin', 'kesin', 'keselim', 'keseyim', 'kessene', 'kesip', 'keserek', 'kesince',
      'kesilsin', 'kestir', 'kesmem', 'kesmeliyim', 'kesmiş', 'kesemiyorum', 'kestiğim', 'kesen',
    ]) {
      expect(form(token, 'kes'), token).toBe(true);
    }
    for (const [token, stem] of [
      ['küçültmek', 'küçült'],
      ['küçültebilir', 'küçült'],
      ['küçültmem', 'küçült'],
      ['kısaltmam', 'kısalt'],
      ['almak', 'al'],
      ['alayım', 'al'],
      ['atmak', 'at'],
      ['atıcam', 'at'],
      ['silmek', 'sil'],
      ['indirmek', 'indir'],
      ['kapatabilir', 'kapat'],
      ['kaldırmak', 'kaldır'],
      ['eklemek', 'ekle'],
      ['eklicem', 'ekle'],
      ['ekliyorum', 'ekle'],
      ['izliyorum', 'izle'],
      ['oynuyor', 'oyna'],
      ['çalsın', 'çal'],
      ['dökmek', 'dök'],
      ['yazsın', 'yaz'],
      ['döndürmek', 'döndür'],
      ['birleştirmek', 'birleştir'],
    ] as const) {
      expect(form(token, stem), token).toBe(true);
    }
  });

  it('another word that merely starts the same way is NOT a form', () => {
    for (const [token, word] of [
      ['kesinlikle', 'kes'],
      ['keşke', 'kes'],
      ['dikkat', 'dik'],
      ['dikiş', 'dik'],
      ['netflix', 'net'],
      ['sesli', 'ses'],
      ['sessizce', 'ses'],
      ['boşver', 'boş'],
      ['hizmet', 'hız'],
      ['sonra', 'son'],
      ['başka', 'baş'],
      ['müzikal', 'müzik'],
      ['fotoğrafçı', 'fotoğraf'],
      ['tiktokçu', 'tiktok'],
      ['gifts', 'gif'],
      ['cutting', 'cut'],
    ] as const) {
      expect(form(token, word), `${token} ← ${word}`).toBe(false);
    }
  });

  it('“cannot” and “does not”: the negative forms of a verb', () => {
    for (const [token, stem] of [
      ['açamıyorum', 'aç'],
      ['açılmıyor', 'aç'],
      ['açılmadı', 'aç'],
      ['açmıyor', 'aç'],
      ['gönderemiyorum', 'gönder'],
      ['gönderemedim', 'gönder'],
      ['gönderilmiyor', 'gönder'],
      ['atamıyorum', 'at'],
      ['yollayamıyorum', 'yolla'],
      ['sığmıyor', 'sığ'],
      ['sığmadı', 'sığ'],
      ['sığmaz', 'sığ'],
      ['oynamıyor', 'oyna'],
      ['oynatamıyorum', 'oynat'],
      ['izleyemiyorum', 'izle'],
      ['çalışmıyor', 'çalış'],
      ['gitmiyor', 'git'],
    ] as const) {
      expect(negative(token, stem), token).toBe(true);
    }
    // The same verbs when they are NOT negative.
    for (const [token, stem] of [
      ['açmak', 'aç'],
      ['açıyorum', 'aç'],
      ['açılsın', 'aç'],
      ['gönder', 'gönder'],
      ['göndermek', 'gönder'],
      ['gönderiyorum', 'gönder'],
      ['atmak', 'at'],
      ['atıcam', 'at'],
      ['sığdır', 'sığ'],
      ['sığsın', 'sığ'],
      ['oynat', 'oyna'],
      ['izlemek', 'izle'],
    ] as const) {
      expect(negative(token, stem), token).toBe(false);
    }
  });

  it('the empty ending is an ending; nonsense is not', () => {
    expect(isTurkishEnding('')).toBe(true);
    expect(isTurkishEnding('xyz')).toBe(false);
    expect(isTurkishEnding('flix')).toBe(false);
    expect(isTurkishEnding('yamayacaklarindanmis')).toBe(false);
  });
});
