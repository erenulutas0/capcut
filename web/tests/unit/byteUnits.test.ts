import { describe, expect, it } from 'vitest';

import { MAX_SUBTITLE_BYTES } from '@/adapters/subtitleFile';
import { limitFor, refusedFileText } from '@/components/editor/mediaErrorText';
import {
  WEB_LOCAL_POLICY,
  exceedsTotalSourceBytes,
  formatByteLimit,
  formatBytes,
  formatBytesAgainstLimit,
  shownBytes,
} from '@/domain/policy';
import { en, tr, type MessageKey } from '@/i18n/messages';

/**
 * ADR-030: sizes read in decimal GB/MB, while the checks stay in bytes and
 * the limits keep their byte values (doc 15 v5). Doc 15's units rule — the
 * unit shown is the unit checked — becomes: comparing the two shown numbers
 * gives the same answer as the byte check, at every byte around each limit.
 */

const GIB = 1_073_741_824;
const MIB = 1_048_576;

/** The number a shown size stands for, read back from its text ("4,29 GB" → 4 290 000 000). */
function readBack(text: string): number {
  const match = /^(\d+(?:[.,]\d+)?) (B|KB|MB|GB)$/.exec(text);
  if (!match) throw new Error(`not a size: ${text}`);
  const unit = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[match[2] as 'B' | 'KB' | 'MB' | 'GB'];
  return Math.round(Number((match[1] as string).replace(',', '.')) * unit);
}

/** Bytes around a limit: the limit itself, its neighbours and the rounding steps of its shown grid. */
function boundaryBytes(limit: number): number[] {
  const shownLimit = shownBytes(limit, 'down');
  const around = [limit - 1, limit, limit + 1, shownLimit - 1, shownLimit, shownLimit + 1];
  for (const step of [1_000, 100_000, 5_000_000, 10_000_000]) {
    around.push(shownLimit + step, shownLimit - step, limit + step, limit - step, shownLimit + step / 2);
  }
  return around.filter((bytes) => bytes >= 0);
}

describe('limits read rounded down, in the unit the UI shows', () => {
  it('4 GiB (video and music together) reads 4,29 GB; 100 MiB music 104,8 MB; 2 MiB subtitles 2 MB', () => {
    expect(WEB_LOCAL_POLICY.maxTotalSourceBytes).toBe(4_294_967_296);
    expect(formatByteLimit(WEB_LOCAL_POLICY.maxTotalSourceBytes, ',')).toBe('4,29 GB');
    expect(formatByteLimit(WEB_LOCAL_POLICY.maxTotalSourceBytes, '.')).toBe('4.29 GB');
    expect(WEB_LOCAL_POLICY.maxMusicBytes).toBe(104_857_600);
    expect(formatByteLimit(WEB_LOCAL_POLICY.maxMusicBytes, ',')).toBe('104,8 MB');
    expect(MAX_SUBTITLE_BYTES).toBe(2 * MIB);
    expect(formatByteLimit(MAX_SUBTITLE_BYTES, ',')).toBe('2 MB');
    // Rounded down: the shown limit is never more than the real one.
    for (const limit of [WEB_LOCAL_POLICY.maxTotalSourceBytes, WEB_LOCAL_POLICY.maxMusicBytes, MAX_SUBTITLE_BYTES]) {
      expect(readBack(formatByteLimit(limit, ','))).toBeLessThanOrEqual(limit);
      expect(readBack(formatByteLimit(limit, ','))).toBe(shownBytes(limit, 'down'));
    }
  });

  it('the subtitle import message names the same limit it checks', () => {
    const limit = formatByteLimit(MAX_SUBTITLE_BYTES, ',');
    expect(tr['captions.import.error.too_large']).toContain(limit);
    expect(en['captions.import.error.too_large']).toContain(formatByteLimit(MAX_SUBTITLE_BYTES, '.'));
  });
});

describe('a size next to its limit reads above it exactly when the byte check refuses it', () => {
  const limits = [
    ['video + music, 4 GiB', WEB_LOCAL_POLICY.maxTotalSourceBytes],
    ['music, 100 MiB', WEB_LOCAL_POLICY.maxMusicBytes],
    ['subtitles, 2 MiB', MAX_SUBTITLE_BYTES],
  ] as const;

  for (const [name, limit] of limits) {
    it(`${name}: every boundary byte`, () => {
      const shownLimit = readBack(formatByteLimit(limit, ','));
      for (const bytes of boundaryBytes(limit)) {
        const refused = bytes > limit;
        const text = formatBytesAgainstLimit(bytes, limit, ',');
        const shown = readBack(text);
        // What a person comparing the two numbers concludes …
        const looksOver = shown > shownLimit;
        // … is what the check does.
        expect(looksOver, `${bytes} bytes read "${text}" against "${formatByteLimit(limit, ',')}"`).toBe(refused);
      }
    });
  }

  it('the 4 GiB boundary, byte by byte (the app checks `size > maxTotalSourceBytes`)', () => {
    const limit = WEB_LOCAL_POLICY.maxTotalSourceBytes;
    const cases: Array<[number, string, boolean]> = [
      [4_289_999_999, '4,29 GB', false],
      [4_290_000_000, '4,29 GB', false],
      // Between the shown limit and the real one: allowed, and never shown above "4,29 GB".
      [4_290_000_001, '4,29 GB', false],
      [4_294_967_295, '4,29 GB', false],
      [4_294_967_296, '4,29 GB', false],
      // One byte over: refused, and shown above the limit.
      [4_294_967_297, '4,3 GB', true],
      [4_300_000_000, '4,3 GB', true],
      [5_000_000_000, '5 GB', true],
    ];
    for (const [bytes, text, refused] of cases) {
      expect(formatBytesAgainstLimit(bytes, limit, ',')).toBe(text);
      expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, bytes, 0)).toBe(refused);
    }
  });

  it('the 100 MiB music boundary', () => {
    const limit = WEB_LOCAL_POLICY.maxMusicBytes;
    expect(formatBytesAgainstLimit(104_800_000, limit, ',')).toBe('104,8 MB');
    expect(formatBytesAgainstLimit(104_857_600, limit, ',')).toBe('104,8 MB');
    expect(formatBytesAgainstLimit(104_857_601, limit, ',')).toBe('104,9 MB');
    expect(formatBytesAgainstLimit(3_500_000, limit, '.')).toBe('3.5 MB');
  });

  it('a size far from the limit is simply rounded to the nearest step', () => {
    expect(formatBytesAgainstLimit(1_234_567_890, WEB_LOCAL_POLICY.maxTotalSourceBytes, ',')).toBe('1,23 GB');
    expect(formatBytesAgainstLimit(472_906, WEB_LOCAL_POLICY.maxTotalSourceBytes, ',')).toBe('473 KB');
  });
});

describe('the grid', () => {
  it('moves up a unit instead of "1000 KB" or "1000 MB"', () => {
    expect(formatBytes(999_499, ',')).toBe('999 KB');
    expect(formatBytes(999_960, ',')).toBe('1 MB');
    expect(formatBytes(999_960_000, ',')).toBe('1 GB');
    expect(formatBytes(999_999_999, ',', 'down')).toBe('999,9 MB');
    expect(formatBytes(999_999_999, ',', 'up')).toBe('1 GB');
  });

  it('never shows a binary unit', () => {
    for (const bytes of [1, 1023, 1024, MIB, GIB, 4 * GIB, 16 * GIB]) {
      expect(formatBytes(bytes, ',')).not.toMatch(/iB\b/);
    }
  });
});

describe('the refusal sentence', () => {
  const t = (key: MessageKey) => tr[key];
  const e = (key: MessageKey) => en[key];

  it('names the size and the limit in the same unit', () => {
    expect(refusedFileText(t, { reason: 'file_too_large', name: 'tatil.mp4', bytes: 4_294_967_297 })).toBe(
      '“tatil.mp4” açılamadı: dosya 4,3 GB; bu sürümün sınırı 4,29 GB.',
    );
    expect(refusedFileText(e, { reason: 'file_too_large', name: 'trip.mp4', bytes: 5_000_000_000 })).toBe(
      '“trip.mp4” could not be opened: the file is 5 GB; the limit of this version is 4.29 GB.',
    );
    expect(refusedFileText(t, { reason: 'total_too_large', name: 'muzik.mp3', bytes: 4_294_967_300 })).toBe(
      '“muzik.mp3” açılamadı: video ve müzik birlikte 4,3 GB; bu sürümde ikisinin toplam sınırı 4,29 GB.',
    );
    expect(refusedFileText(t, { reason: 'music_too_large', name: 'uzun.wav', bytes: 104_857_601 })).toBe(
      '“uzun.wav” açılamadı: müzik dosyası 104,9 MB; bu sürümün müzik sınırı 104,8 MB.',
    );
  });

  it('other refusals are unchanged', () => {
    expect(limitFor('unreadable', WEB_LOCAL_POLICY)).toBeNull();
    expect(refusedFileText(t, { reason: 'unreadable', name: 'bozuk.mp4', bytes: 12 })).toBe(
      '“bozuk.mp4” açılamadı: bu dosya okunamadı. Başka bir dosya dene.',
    );
  });
});
