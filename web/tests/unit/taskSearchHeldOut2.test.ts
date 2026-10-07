import { describe, expect, it } from 'vitest';

import { searchTasks } from '@/domain/taskSearch';
import { TASKS, taskById } from '@/domain/tasks';

/**
 * A third table (7 Oct 2026), for "Sesi kapat" and for the requests the app
 * cannot serve yet: 95 phrases, written BEFORE the word lists of those
 * entries. Three measurements, all really run:
 *
 * - With the registry as it was (no "Sesi kapat", no "cannot do yet"
 *   entries): 13 of 95 — exactly the 13 phrases of tasks that existed. Of the
 *   other 82, 44 found a card with a "Başla" button that does something else
 *   (13 of the 14 mute requests went to "Sesini al" / "Boşlukları at" /
 *   "Müzik ekle"; 31 of the 68 requests that cannot be served went to Kes,
 *   Müzik ekle, Her yerde açılsın…) and 38 got "Bunu bulamadım".
 * - First run with the new entries, their lists holding only what the tuned
 *   table (taskSearch.test.ts) and plain synonyms asked for: **69 of 95
 *   (73 %)**; "Sesi kapat" 5 of 14; 12 of the 68 requests that cannot be
 *   served were still offered a wrong card. That is the honest estimate for
 *   wordings nobody has listed (`FIRST_RUN`).
 * - After the misses were fixed in the lists (the table is a seen table from
 *   then on): 95 of 95, no wrong card. The floors below keep a later change
 *   from undoing it; they are not an accuracy claim.
 *
 * A caveat the first table of ADR-034 did not have: this table and the lists
 * were written by the same author in one sitting, so "unseen" means "the
 * lists were written without looking back at it", not "blind".
 *
 * For "cannot do yet" rows it matters less WHICH entry answers (they all say
 * the same sentence) than that no card with a "Başla" button is first:
 * offering a task that does not do the job is the failure.
 */
export const HELD_OUT_2: ReadonlyArray<readonly [string, string]> = [
  // Sesi kapat (new, available)
  ['videonun sesini kapat', 'sustur'],
  ['sesi kaldır', 'sustur'],
  ['sessiz video yap', 'sustur'],
  ['sesini sil', 'sustur'],
  ['videoyu sessize al', 'sustur'],
  ['ses olmasın', 'sustur'],
  ['sesi tamamen kıs', 'sustur'],
  ['arkadaki sesleri sil', 'sustur'],
  ['sesi yok et', 'sustur'],
  ['mute video', 'sustur'],
  ['remove audio from video', 'sustur'],
  ['video without sound', 'sustur'],
  ['turn off the sound', 'sustur'],
  ['delete the audio track', 'sustur'],
  // Sesini al must stay Sesini al
  ['sesini ayrı kaydet', 'ses'],
  ['sadece sesi lazım', 'ses'],
  ['videodan ses al', 'ses'],
  ['save the audio only', 'ses'],
  ['get the sound from video', 'ses'],
  ['sesi mp3 olarak indir', 'ses'],
  // Tasks that already existed: the new entries must not take them
  ['videonun başındaki 5 saniyeyi at', 'kes'],
  ['boş kısımları otomatik sil', 'bosluk'],
  ['dikey formata getir', 'dikey'],
  ['whatsapp için küçült', 'kucult'],
  ['şarkı koymak istiyorum', 'muzik'],
  ['altyazı oluştur', 'yazi'],
  ['bu video telefonda açılmıyor', 'cevir'],
  // Döndür
  ['videoyu döndür', 'dondur'],
  ['video ters duruyor', 'dondur'],
  ['yan çekmişim düzelt', 'dondur'],
  ['90 derece çevir', 'dondur'],
  ['rotate video', 'dondur'],
  ['flip video', 'dondur'],
  ['baş aşağı olmuş', 'dondur'],
  ['aynala', 'dondur'],
  // Hızlandır / yavaşlat
  ['videoyu hızlandır', 'hiz'],
  ['yavaşlat', 'hiz'],
  ['ağır çekim yap', 'hiz'],
  ['2x hız', 'hiz'],
  ['speed up video', 'hiz'],
  ['slow motion', 'hiz'],
  ['hızlı oynat', 'hiz'],
  ['timelapse', 'hiz'],
  // Birleştir
  ['iki videoyu birleştir', 'birlestir'],
  ['videoları arka arkaya ekle', 'birlestir'],
  ['videoları tek video yap', 'birlestir'],
  ['merge videos', 'birlestir'],
  ['join two clips', 'birlestir'],
  ['combine videos', 'birlestir'],
  ['başka video ekle', 'birlestir'],
  // GIF
  ['gif yap', 'gif'],
  ['videodan gif', 'gif'],
  ['gife çevir', 'gif'],
  ['make a gif', 'gif'],
  ['video to gif', 'gif'],
  ['hareketli resim yap', 'gif'],
  // Filigran / logo sil
  ['filigranı sil', 'filigran'],
  ['tiktok logosunu kaldır', 'filigran'],
  ['köşedeki yazıyı kaldır', 'filigran'],
  ['remove watermark', 'filigran'],
  ['logo sil', 'filigran'],
  ['watermark kaldır', 'filigran'],
  ['damgayı sil', 'filigran'],
  // Filtre / efekt / renk
  ['filtre ekle', 'efekt'],
  ['efekt koy', 'efekt'],
  ['renkleri düzelt', 'efekt'],
  ['siyah beyaz yap', 'efekt'],
  ['add filter', 'efekt'],
  ['make it black and white', 'efekt'],
  ['parlaklığı artır', 'efekt'],
  ['color correction', 'efekt'],
  // Arka plan
  ['arka planı sil', 'arkaplan'],
  ['arka planı bulanıklaştır', 'arkaplan'],
  ['arkayı değiştir', 'arkaplan'],
  ['yeşil perde', 'arkaplan'],
  ['remove background', 'arkaplan'],
  ['blur background', 'arkaplan'],
  ['green screen', 'arkaplan'],
  // Tersten oynat
  ['tersten oynat', 'ters'],
  ['videoyu geri sar', 'ters'],
  ['sondan başa oynat', 'ters'],
  ['reverse video', 'ters'],
  ['play it backwards', 'ters'],
  // Kare / fotoğraf al
  ['videodan fotoğraf al', 'foto'],
  ['kare yakala', 'foto'],
  ['ekran görüntüsü al', 'foto'],
  ['resim olarak kaydet', 'foto'],
  ['take a screenshot', 'foto'],
  ['extract a frame', 'foto'],
  // Titremeyi düzelt
  ['titremeyi düzelt', 'stabil'],
  ['sarsıntıyı gider', 'stabil'],
  ['video çok sallanıyor', 'stabil'],
  ['stabilize', 'stabil'],
  ['shaky video', 'stabil'],
  ['stabilizasyon', 'stabil'],
];

/** What the first run found, before any list was changed for this table. */
export const FIRST_RUN = { right: 69, of: 95, cannotDoOfferedAStart: 12, cannotDoAsked: 68 };

interface Outcome {
  phrase: string;
  expected: string;
  got: string;
  /** The first row has a "Başla" button. */
  startable: boolean;
}

function outcome(phrase: string, expected: string): Outcome {
  const result = searchTasks(phrase);
  const first = result.kind === 'results' ? result.matches[0]?.task : undefined;
  return { phrase, expected, got: first?.id ?? result.kind, startable: first?.available === true };
}

describe('searchTasks: the second held-out table (Sesi kapat, and what cannot be done yet)', () => {
  const outcomes = HELD_OUT_2.map(([phrase, expected]) => outcome(phrase, expected));
  const cannot = (id: string) => taskById(id)?.available === false;
  const hits = outcomes.filter((item) => item.got === item.expected);
  const misses = outcomes.filter((item) => item.got !== item.expected);
  /** The failure this table exists for: a request the app cannot serve is offered a task that does something else. */
  const wrongCard = outcomes.filter((item) => cannot(item.expected) && item.startable);

  it('reports what it found (see the list in the test output)', () => {
    console.log(
      `held-out 2: ${hits.length} of ${outcomes.length} first; ` +
        `${wrongCard.length} "cannot do yet" requests offered a task with a Başla button\n${misses
          .map((miss) => `  miss: “${miss.phrase}” → ${miss.got}${miss.startable ? ' (Başla)' : ''} (wanted ${miss.expected})`)
          .join('\n')}`,
    );
    expect(outcomes).toHaveLength(HELD_OUT_2.length);
    expect(HELD_OUT_2).toHaveLength(FIRST_RUN.of);
  });

  it('every expected id is a registry entry', () => {
    for (const [, expected] of HELD_OUT_2) expect(TASKS.some((task) => task.id === expected), expected).toBe(true);
  });

  it('puts the right entry first for at least four phrases in five', () => {
    expect(hits.length / outcomes.length).toBeGreaterThanOrEqual(0.8);
  });

  it('"Sesini al" and "Sesi kapat" are never taken for each other', () => {
    const crossed = outcomes.filter(
      (item) => (item.expected === 'ses' && item.got === 'sustur') || (item.expected === 'sustur' && item.got === 'ses'),
    );
    expect(crossed.map((item) => `${item.phrase} → ${item.got}`)).toEqual([]);
  });

  it('a request that cannot be served is offered a wrong card for at most one phrase in ten', () => {
    const asked = outcomes.filter((item) => cannot(item.expected));
    expect(asked.length).toBeGreaterThan(50);
    expect(wrongCard.length / asked.length).toBeLessThanOrEqual(0.1);
  });
});
