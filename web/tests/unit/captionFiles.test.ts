import { describe, expect, it } from 'vitest';

import {
  cueBlockNumbers,
  formatShiftSeconds,
  outputIsWholeSource,
  parseShiftSeconds,
  subtitleFileName,
} from '@/domain/captionFiles';
import type { Project } from '@/domain/edl';
import { createEmptyProject, addClip, setVideoAsset } from '@/application/commands';
import { parseSubtitles } from '@/domain/subtitleFormats';
import { US_PER_SECOND } from '@/domain/time';

const S = US_PER_SECOND;
const NL = String.fromCharCode(10);

describe('subtitleFileName', () => {
  it('folds Turkish letters to ASCII and keeps a readable name', () => {
    expect(subtitleFileName('Günaydın İstanbul — Işık Şöleni', 'srt')).toBe(
      'Gunaydin-Istanbul-Isik-Soleni.srt',
    );
    expect(subtitleFileName('çğıöşü ÇĞİÖŞÜ', 'vtt')).toBe('cgiosu-CGIOSU.vtt');
  });

  it('strips path and reserved characters', () => {
    expect(subtitleFileName('../../etc/passwd', 'srt')).toBe('etc-passwd.srt');
    expect(subtitleFileName('a:b*c?"d<e>f|g', 'srt')).toBe('a-b-c-d-e-f-g.srt');
    expect(subtitleFileName('Café crème', 'vtt')).toBe('Cafe-creme.vtt');
  });

  it('falls back to "altyazi" when nothing usable is left', () => {
    expect(subtitleFileName('', 'srt')).toBe('altyazi.srt');
    expect(subtitleFileName('   ', 'vtt')).toBe('altyazi.vtt');
    expect(subtitleFileName('日本語', 'srt')).toBe('altyazi.srt');
    expect(subtitleFileName('///', 'srt')).toBe('altyazi.srt');
  });

  it('caps the length without a trailing dash', () => {
    const name = subtitleFileName(`${'a'.repeat(59)} bbbbbb`, 'srt');
    expect(name).toBe(`${'a'.repeat(59)}.srt`);
    expect(subtitleFileName('x'.repeat(200), 'vtt')).toBe(`${'x'.repeat(60)}.vtt`);
  });
});

describe('cueBlockNumbers', () => {
  it('gives each parsed cue the block number a person counts in the file', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'Bir',
      '',
      '2',
      'bozuk --> zaman',
      'İki',
      '',
      '3',
      '00:00:03,000 --> 00:00:04,000',
      'Üç',
      '',
      '4',
      '00:00:05,000 --> 00:00:06,000',
      '',
      '5',
      '00:00:07,000 --> 00:00:08,000',
      'Beş',
      '',
    ].join(NL);
    const parsed = parseSubtitles(srt);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.value.cues.map((cue) => cue.text)).toEqual(['Bir', 'Üç', 'Beş']);
    expect(cueBlockNumbers(parsed.value)).toEqual([1, 3, 5]);
  });

  it('is the plain sequence when nothing failed', () => {
    expect(
      cueBlockNumbers({
        cues: [
          { startUs: 0, endUs: 1, text: 'a' },
          { startUs: 1, endUs: 2, text: 'b' },
        ],
        problems: [],
      }),
    ).toEqual([1, 2]);
  });
});

function withVideo(durationUs = 20 * S): Project {
  return setVideoAsset(createEmptyProject(), {
    assetId: 'a_video_001',
    kind: 'video',
    durationUs,
    displayWidth: 1920,
    displayHeight: 1080,
    hasAudio: true,
  });
}

function withClips(ranges: [number, number][]): Project {
  let project = withVideo();
  for (const [from, to] of ranges) {
    const result = addClip(project, { sourceInUs: from * S, sourceOutUs: to * S });
    if (!result.ok) throw new Error(result.reason);
    project = result.project;
  }
  return project;
}

describe('outputIsWholeSource', () => {
  it('is true only for the whole video, in order, uncut', () => {
    expect(outputIsWholeSource(withClips([[0, 20]]))).toBe(true);
    // Split in two but contiguous and in order: still the whole video.
    expect(
      outputIsWholeSource(
        withClips([
          [0, 8],
          [8, 20],
        ]),
      ),
    ).toBe(true);
  });

  it('is false for cuts, reordering, repeats or no moments', () => {
    expect(outputIsWholeSource(withVideo())).toBe(false);
    expect(outputIsWholeSource(withClips([[0, 19]]))).toBe(false);
    expect(
      outputIsWholeSource(
        withClips([
          [8, 20],
          [0, 8],
        ]),
      ),
    ).toBe(false);
    expect(
      outputIsWholeSource(
        withClips([
          [0, 20],
          [0, 4],
        ]),
      ),
    ).toBe(false);
  });
});

describe('parseShiftSeconds', () => {
  it('reads comma or dot decimals and signs', () => {
    expect(parseShiftSeconds('0,5')).toBe(500_000);
    expect(parseShiftSeconds('-1.25')).toBe(-1_250_000);
    expect(parseShiftSeconds('+2')).toBe(2 * S);
    expect(parseShiftSeconds(' ,1 ')).toBe(100_000);
    expect(parseShiftSeconds(`${String.fromCharCode(0x2212)}0,1`)).toBe(-100_000);
  });

  it('refuses anything else', () => {
    for (const bad of ['', '-', 'abc', '1,2,3', '0.0001', '1e3', '99999999', '--1']) {
      expect(parseShiftSeconds(bad)).toBeNull();
    }
  });
});

describe('formatShiftSeconds', () => {
  it('writes the sign and trims trailing zeros', () => {
    expect(formatShiftSeconds(100_000)).toBe('+0,1');
    expect(formatShiftSeconds(-S)).toBe(`${String.fromCharCode(0x2212)}1`);
    expect(formatShiftSeconds(1_250_000, '.')).toBe('+1.25');
  });
});
