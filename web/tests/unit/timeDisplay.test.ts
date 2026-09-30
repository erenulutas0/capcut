import { describe, expect, it } from 'vitest';

import { formatLengthShort, formatPosition, formatTimecode, parseTimecode, US_PER_SECOND } from '@/domain/time';

/**
 * ADR-030: outside fine-tuning, times read without milliseconds.
 * Positions round DOWN to the second they fall in; lengths round DOWN to a
 * tenth under a minute and to a second from a minute on. Fine-tuning (the
 * start/end fields) keeps the milliseconds and round-trips exactly.
 */

const S = US_PER_SECOND;
const tr = { second: 'sn', decimalMark: ',' };
const en = { second: 's', decimalMark: '.' };

describe('positions (cards, strip, playback clock, notices)', () => {
  it('whole seconds, rounded down, MM:SS under an hour', () => {
    expect(formatPosition(0)).toBe('00:00');
    expect(formatPosition(999_999)).toBe('00:00');
    expect(formatPosition(7 * S)).toBe('00:07');
    expect(formatPosition(7.2 * S)).toBe('00:07');
    expect(formatPosition(7.999_999 * S)).toBe('00:07');
    expect(formatPosition(59 * 60 * S + 59.9 * S)).toBe('59:59');
  });

  it('H:MM:SS from one hour', () => {
    expect(formatPosition(3600 * S)).toBe('1:00:00');
    expect(formatPosition(3600 * S - 1)).toBe('59:59');
    expect(formatPosition((3600 + 2 * 60 + 7) * S + 500_000)).toBe('1:02:07');
    expect(formatPosition(2 * 3600 * S)).toBe('2:00:00');
  });

  it('never negative', () => {
    expect(formatPosition(-5 * S)).toBe('00:00');
  });

  it('the playhead at the very end reads the same as the total', () => {
    const total = 24_023_000;
    expect(formatPosition(total)).toBe(formatPosition(total - 1));
  });
});

describe('lengths (cards, notices, the file line)', () => {
  it('tenths under a minute, rounded down, with the language’s decimal mark', () => {
    expect(formatLengthShort(4.6 * S, tr)).toBe('4,6 sn');
    expect(formatLengthShort(4.6 * S, en)).toBe('4.6 s');
    expect(formatLengthShort(4.69 * S, tr)).toBe('4,6 sn');
    expect(formatLengthShort(24 * S, tr)).toBe('24,0 sn');
    expect(formatLengthShort(59.99 * S, tr)).toBe('59,9 sn');
  });

  it('a clock from one minute, to whole seconds, rounded down', () => {
    expect(formatLengthShort(60 * S, tr)).toBe('1:00');
    expect(formatLengthShort(64.9 * S, tr)).toBe('1:04');
    expect(formatLengthShort(3727.5 * S, tr)).toBe('1:02:07');
    expect(formatLengthShort(90 * 60 * S, en)).toBe('1:30:00');
  });

  it('a real range never reads as nothing', () => {
    expect(formatLengthShort(1, tr)).toBe('0,1 sn');
    expect(formatLengthShort(0, tr)).toBe('0,0 sn');
  });

  it('never overstates a range whose ends are shown rounded down', () => {
    // For ranges across the first two minutes in 1/30 s steps: the length
    // read is at most the real length, and less than 0.1 s (or 1 s) below it.
    for (let inFrame = 0; inFrame < 90; inFrame += 7) {
      for (let outFrame = inFrame + 3; outFrame < 3600; outFrame += 61) {
        const inUs = Math.round((inFrame * S) / 30);
        const outUs = Math.round((outFrame * S) / 30);
        const length = outUs - inUs;
        const text = formatLengthShort(length, en);
        const readUs = text.endsWith(' s')
          ? Math.round(Number(text.slice(0, -2)) * S)
          : text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * S;
        expect(readUs).toBeLessThanOrEqual(length);
        expect(length - readUs).toBeLessThan(text.endsWith(' s') ? S / 10 : S);
      }
    }
  });
});

describe('fine-tuning keeps milliseconds', () => {
  it('the fields show and read back the exact time', () => {
    for (const us of [0, 2_600_000, 7_200_000, 3_725_500_000]) {
      expect(parseTimecode(formatTimecode(us))).toBe(us);
    }
    expect(formatTimecode(2_600_000)).toBe('00:02.600');
    expect(formatTimecode(3_725_500_000)).toBe('01:02:05.500');
  });
});
