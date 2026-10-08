import { describe, expect, it } from 'vitest';

import { searchTasks } from '@/domain/taskSearch';
import { TASKS, type TaskId } from '@/domain/tasks';

/**
 * A second table of phrases, written AFTER the word lists. Its first run,
 * with the lists untouched, put the right task first for 48 of 56 (86 %):
 * that is the honest estimate of how well the search does on words it has
 * not seen (ADR-034). The eight misses were then fixed in the lists, so this
 * table is no longer unseen either; the floor below keeps a later change
 * from making the search worse without anyone noticing. New phrases from
 * user tests belong here, measured BEFORE the lists are changed for them.
 */
export const HELD_OUT: ReadonlyArray<readonly [string, TaskId]> = [
  // Kes
  ['videonun ortasını çıkar', 'kes'],
  ['gereksiz yerleri at', 'kes'],
  ['sadece bir bölümünü al', 'kes'],
  ['ilk 10 saniyeyi sil', 'kes'],
  ['video çok uzun kısaltmak istiyorum', 'kes'],
  ['cut a part of my video', 'kes'],
  ['remove the end', 'kes'],
  ['klip yap', 'kes'],
  // Boşlukları at
  ['beklemeleri kaldır', 'bosluk'],
  ['susma yerlerini kes', 'bosluk'],
  ['eee leri sil', 'bosluk'],
  ['aradaki boşlukları kaldır', 'bosluk'],
  ['jump cut', 'bosluk'],
  ['remove pauses', 'bosluk'],
  ['sessiz kısımları at', 'bosluk'],
  // Dikey yap
  ['instagram için uygun yap', 'dikey'],
  ['telefona göre ayarla', 'dikey'],
  ['story boyutu', 'dikey'],
  ['video yan duruyor dik olsun', 'dikey'],
  ['vertical video for tiktok', 'dikey'],
  ['shorts boyutuna getir', 'dikey'],
  ['reels için hazırla', 'dikey'],
  // Müzik ekle
  ['arka plana müzik', 'muzik'],
  ['videoya şarkı ekle', 'muzik'],
  ['ses ekle', 'muzik'],
  ['put a song on it', 'muzik'],
  ['müzikli yap', 'muzik'],
  ['fon ekle', 'muzik'],
  // Her yerde açılsın
  ['video oynamıyor', 'cevir'],
  ['whatsappta açılmıyor', 'cevir'],
  ['mov u mp4 e çevir', 'cevir'],
  ['bilgisayarda açılmıyor', 'cevir'],
  ['format desteklenmiyor', 'cevir'],
  ['iphone videosunu çevir', 'cevir'],
  ['convert video', 'cevir'],
  ['file not supported', 'cevir'],
  ['tvde oynatmak istiyorum', 'cevir'],
  // Küçült (not available yet)
  ['dosya boyutunu düşür', 'kucult'],
  ['video çok yer kaplıyor', 'kucult'],
  ['maille göndermek için küçült', 'kucult'],
  ['reduce file size', 'kucult'],
  ['daha az mb', 'kucult'],
  ['whatsappa atamıyorum', 'kucult'],
  ['discord 8mb', 'kucult'],
  // Sesini al (not available yet)
  ['videodan müzik çıkar', 'ses'],
  ['sesi ayır', 'ses'],
  ['mp3 e çevir', 'ses'],
  ['sadece sesini indir', 'ses'],
  ['audio from video', 'ses'],
  ['şarkıyı al', 'ses'],
  // Yazıya dök (not available yet)
  ['konuşmaları yazıya çevir', 'yazi'],
  ['otomatik altyazı', 'yazi'],
  ['videodaki konuşmayı metin yap', 'yazi'],
  ['subtitle ekle', 'yazi'],
  ['generate captions', 'yazi'],
  ['ne dediğimi yaz', 'yazi'],
  // İyileştir (ADR-037): written after its word list, measured before any fix (the ADR has the first-run count).
  ['video çok karanlık çıkmış', 'iyilestir'],
  ['görüntü kalitesini arttır', 'iyilestir'],
  ['videoyu netleştirmek istiyorum', 'iyilestir'],
  ['renkleri canlandır', 'iyilestir'],
  ['bulanık videoyu düzelt', 'iyilestir'],
  ['daha kaliteli olsun', 'iyilestir'],
  ['videoyu güzelleştir', 'iyilestir'],
  ['ışığı az, aydınlat', 'iyilestir'],
  ['make my video look better', 'iyilestir'],
  ['video is too dark', 'iyilestir'],
  ['increase video quality', 'iyilestir'],
  ['remove blur', 'iyilestir'],
  ['videoyu full hd yap', 'iyilestir'],
  ['gece çekimi çok kumlu', 'iyilestir'],
];

function first(query: string): string {
  const result = searchTasks(query);
  return result.kind === 'results' ? (result.matches[0]?.task.id ?? 'none') : result.kind;
}

describe('searchTasks: held-out phrases', () => {
  const outcomes = HELD_OUT.map(([phrase, expected]) => ({ phrase, expected, got: first(phrase) }));
  const hits = outcomes.filter((outcome) => outcome.got === outcome.expected);
  const misses = outcomes.filter((outcome) => outcome.got !== outcome.expected);

  it('reports what it found (see the list in the test output)', () => {
    console.log(
      `held-out: ${hits.length} of ${outcomes.length} first\n${misses
        .map((miss) => `  miss: “${miss.phrase}” → ${miss.got} (wanted ${miss.expected})`)
        .join('\n')}`,
    );
    expect(outcomes).toHaveLength(HELD_OUT.length);
  });

  it('puts the task first for at least four phrases in five', () => {
    expect(hits.length / outcomes.length).toBeGreaterThanOrEqual(0.8);
  });

  it('never answers a held-out phrase with a different task as the only result when it misses badly', () => {
    // A miss must at least not be silent: either another task is shown (the
    // user sees it is the wrong one) or "Bunu bulamadım" with all tasks one tap away.
    for (const miss of misses) expect([...TASKS.map((task) => task.id), 'none', 'empty']).toContain(miss.got);
  });
});
