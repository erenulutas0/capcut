import { describe, expect, it } from 'vitest';

import { searchTasks } from '@/domain/taskSearch';
import { TASKS, taskById } from '@/domain/tasks';

/**
 * A fourth table (10 Oct 2026), for four more requests the app cannot serve:
 * text laid over the picture ("videoya yazı ekle"), hiding a face or a number
 * plate ("yüzleri bulanıklaştır"), another language ("Türkçeye çevir",
 * dubbing) and cleaning the SOUND of noise ("rüzgar sesini sil"). 60 phrases,
 * written BEFORE the word lists of those entries. Three measurements, all
 * really run (`BEFORE`, `FIRST_RUN`, and the floors below):
 *
 * - With the registry as it was (53b831e): **16 of 60** — exactly the 16
 *   phrases of entries that existed. Of the 44 new requests, **26 were offered
 *   a card with a "Başla" button that does another job** ("videoya yazı ekle"
 *   found "Yazıya dök", which writes the SPEECH down; "blur faces" found
 *   "İyileştir"; "türkçeye çevir" found "Her yerde açılsın"; "rüzgar sesini
 *   sil" found "Sesi kapat"); the other 18 found another "cannot do yet"
 *   entry or "Bunu bulamadım".
 * - First run with the new entries, before any list was changed for this
 *   table: **55 of 60**; 4 of the 44 still offered a wrong card ("plakayı
 *   kapat" → Sesi kapat, "ses çok cızırtılı" and "clean up the audio" →
 *   Sesini al, "add my name on the video" → Müzik ekle), 1 found nothing
 *   ("videoya not düş").
 * - After those five were fixed in the lists: 60 of 60, no wrong card. From
 *   then on this is a seen table; the floors keep a later change from undoing
 *   it and are not an accuracy claim.
 *
 * The earlier tables did not move: 69 of 70 and 92 of 95 before and after
 * (each of them checks that none of its phrases is answered by a new entry).
 *
 * The same caveat as table 2: one author, one sitting — "unseen" means the
 * lists were written without looking back at the table, not "blind".
 */
export const HELD_OUT_3: ReadonlyArray<readonly [string, string]> = [
  // Yazı ekle: words ON the picture, typed by the user
  ['videoya yazı ekle', 'yaziekle'],
  ['videonun üstüne yazı yaz', 'yaziekle'],
  ['başlık ekle', 'yaziekle'],
  ['videoya isim yazmak istiyorum', 'yaziekle'],
  ['üstüne metin koy', 'yaziekle'],
  ['emoji ekle', 'yaziekle'],
  ['videoya not düş', 'yaziekle'],
  ['add text to video', 'yaziekle'],
  ['put a title on it', 'yaziekle'],
  ['text overlay', 'yaziekle'],
  ['write on video', 'yaziekle'],
  ['add my name on the video', 'yaziekle'],
  // Yüzü gizle: a face, a plate, a part of the picture
  ['yüzleri bulanıklaştır', 'yuz'],
  ['yüzümü gizle', 'yuz'],
  ['yüzü sansürle', 'yuz'],
  ['plakayı kapat', 'yuz'],
  ['çocuğun yüzü görünmesin', 'yuz'],
  ['mozaik ekle', 'yuz'],
  ['bir yeri buzla', 'yuz'],
  ['yüzleri pikselle', 'yuz'],
  ['blur faces', 'yuz'],
  ['hide my face', 'yuz'],
  ['censor the license plate', 'yuz'],
  ['pixelate face', 'yuz'],
  // Başka dile çevir: translation, dubbing
  ['türkçeye çevir', 'tercume'],
  ['altyazıyı türkçe yap', 'tercume'],
  ['videoyu ingilizceye çevir', 'tercume'],
  ['tercüme et', 'tercume'],
  ['dublaj yap', 'tercume'],
  ['başka dile çevir', 'tercume'],
  ['translate to english', 'tercume'],
  ['translate subtitles', 'tercume'],
  ['dub the video', 'tercume'],
  ['türkçe seslendirme', 'tercume'],
  // Gürültüyü temizle: the SOUND, not the picture's grain
  ['arkadaki gürültüyü sil', 'gurultu'],
  ['rüzgar sesini sil', 'gurultu'],
  ['dip sesi temizle', 'gurultu'],
  ['uğultuyu gider', 'gurultu'],
  ['ses çok cızırtılı', 'gurultu'],
  ['sesi temizle', 'gurultu'],
  ['remove background noise', 'gurultu'],
  ['noise reduction', 'gurultu'],
  ['wind noise', 'gurultu'],
  ['clean up the audio', 'gurultu'],
  // What already had an entry must keep it
  ['altyazı ekle', 'yazi'],
  ['konuşmayı yazıya dök', 'yazi'],
  ['add subtitles', 'yazi'],
  ['mp4 e çevir', 'cevir'],
  ['bulanık görüntüyü düzelt', 'iyilestir'],
  ['video çok kumlu', 'iyilestir'],
  ['arka planı bulanıklaştır', 'arkaplan'],
  ['köşedeki yazıyı sil', 'filigran'],
  ['sessiz yerleri at', 'bosluk'],
  ['videonun sesini kapat', 'sustur'],
  ['müzik ekle', 'muzik'],
  ['sesini mp3 yap', 'ses'],
  ['ters çevir', 'dondur'],
  ['siyah beyaz filtre', 'efekt'],
  ['whatsapp için küçült', 'kucult'],
  ['başını kes', 'kes'],
];

/** The registry of 53b831e, before the four entries existed (their ids could not be answered at all). */
export const BEFORE = { right: 16, of: 60, newRequestsOfferedAStart: 26, newRequestsAsked: 44 };
/** What the first run found, before any list was changed for this table. */
export const FIRST_RUN = { right: 55, of: 60, newRequestsOfferedAStart: 4, newRequestsAsked: 44 };

const NEW_IDS = ['yaziekle', 'yuz', 'tercume', 'gurultu'];

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

describe('searchTasks: the third held-out table (text on the picture, faces, another language, noise)', () => {
  const outcomes = HELD_OUT_3.map(([phrase, expected]) => outcome(phrase, expected));
  const hits = outcomes.filter((item) => item.got === item.expected);
  const misses = outcomes.filter((item) => item.got !== item.expected);
  const asked = outcomes.filter((item) => NEW_IDS.includes(item.expected));
  /** The failure this table exists for: a request the app cannot serve is offered a task that does something else. */
  const wrongCard = asked.filter((item) => item.startable);

  it('reports what it found (see the list in the test output)', () => {
    console.log(
      `held-out 3: ${hits.length} of ${outcomes.length} first; ` +
        `${wrongCard.length} of ${asked.length} new "cannot do yet" requests offered a task with a Başla button\n${misses
          .map((miss) => `  miss: “${miss.phrase}” → ${miss.got}${miss.startable ? ' (Başla)' : ''} (wanted ${miss.expected})`)
          .join('\n')}`,
    );
    expect(HELD_OUT_3).toHaveLength(FIRST_RUN.of);
    expect(asked).toHaveLength(FIRST_RUN.newRequestsAsked);
  });

  it('every expected id is a registry entry, and the four new ones cannot be done yet', () => {
    for (const [, expected] of HELD_OUT_3) expect(TASKS.some((task) => task.id === expected), expected).toBe(true);
    for (const id of NEW_IDS) expect(taskById(id)?.available, id).toBe(false);
  });

  it('puts the right entry first for at least nine phrases in ten', () => {
    expect(hits.length / outcomes.length).toBeGreaterThanOrEqual(0.9);
  });

  it('no new request is offered a card that does another job', () => {
    expect(wrongCard.map((item) => `${item.phrase} → ${item.got}`)).toEqual([]);
  });

  it('what already had an entry keeps it', () => {
    const kept = outcomes.filter((item) => !NEW_IDS.includes(item.expected));
    expect(kept.filter((item) => item.got !== item.expected).map((item) => `${item.phrase} → ${item.got}`)).toEqual([]);
  });

  it('is better than the registry it was written against, and than its own first run', () => {
    expect(BEFORE.right).toBeLessThan(FIRST_RUN.right);
    expect(hits.length).toBeGreaterThanOrEqual(FIRST_RUN.right);
    expect(wrongCard.length).toBeLessThanOrEqual(FIRST_RUN.newRequestsOfferedAStart);
  });
});
