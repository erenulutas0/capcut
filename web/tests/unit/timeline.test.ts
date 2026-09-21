import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ProjectV1 } from '@/domain/edl';
import {
  buildTimeline,
  mapOutputToMusic,
  mapOutputToSource,
  mapSourceToOutput,
  mixSafetyGain,
  totalOutputDurationUs,
} from '@/domain/timeline';
import { US_PER_SECOND, formatTimecode, parseTimecode, secondsToUs } from '@/domain/time';

const docExample: ProjectV1 = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'edl', 'valid', 'doc10-example.json'), 'utf8'),
);

const repeated: ProjectV1 = JSON.parse(
  readFileSync(
    join(process.cwd(), 'fixtures', 'edl', 'valid', 'repeated-source-range.json'),
    'utf8',
  ),
);

describe('output timeline', () => {
  it('doc 10 example produces exactly 10 seconds', () => {
    expect(totalOutputDurationUs(docExample)).toBe(10 * US_PER_SECOND);
  });

  it('lays clips out back to back with no gaps', () => {
    const timeline = buildTimeline(docExample);
    expect(timeline.map((entry) => [entry.startUs, entry.endUs])).toEqual([
      [0, 4 * US_PER_SECOND],
      [4 * US_PER_SECOND, 10 * US_PER_SECOND],
    ]);
  });

  it('maps output 5 s to source 9 s across the clip boundary', () => {
    const position = mapOutputToSource(docExample, 5 * US_PER_SECOND);
    expect(position?.entry.clipId).toBe('c_002');
    expect(position?.sourceUs).toBe(9 * US_PER_SECOND);
  });

  it('treats the output range as half-open', () => {
    expect(mapOutputToSource(docExample, 4 * US_PER_SECOND - 1)?.entry.clipId).toBe('c_001');
    expect(mapOutputToSource(docExample, 4 * US_PER_SECOND)?.entry.clipId).toBe('c_002');
    expect(mapOutputToSource(docExample, 10 * US_PER_SECOND)).toBeNull();
  });

  it('keeps two uses of the same source range distinguishable', () => {
    expect(totalOutputDurationUs(repeated)).toBe(10 * US_PER_SECOND);
    const first = mapSourceToOutput(repeated, 0, 3 * US_PER_SECOND);
    const second = mapSourceToOutput(repeated, 1, 3 * US_PER_SECOND);
    expect(first).toBe(1 * US_PER_SECOND);
    expect(second).toBe(5 * US_PER_SECOND);
  });
});

describe('music mapping', () => {
  const music = docExample.music!;

  it('applies musicSourceTime = sourceIn + (outputTime - timelineStart)', () => {
    expect(mapOutputToMusic(music, 0).sourceUs).toBe(5 * US_PER_SECOND);
    expect(mapOutputToMusic(music, 3 * US_PER_SECOND).sourceUs).toBe(8 * US_PER_SECOND);
  });

  it('is silent before the timeline start and after the selection', () => {
    const delayed = { ...music, timelineStartUs: 2 * US_PER_SECOND };
    expect(mapOutputToMusic(delayed, 1 * US_PER_SECOND).sourceUs).toBeNull();
    expect(mapOutputToMusic(delayed, 2 * US_PER_SECOND).sourceUs).toBe(5 * US_PER_SECOND);
    expect(mapOutputToMusic(music, 10 * US_PER_SECOND).sourceUs).toBeNull();
  });

  it('ramps the fade envelope between 0 and 1', () => {
    expect(mapOutputToMusic(music, 0).fadeGain).toBe(0);
    expect(mapOutputToMusic(music, 125_000).fadeGain).toBeCloseTo(0.5, 5);
    expect(mapOutputToMusic(music, 5 * US_PER_SECOND).fadeGain).toBe(1);
    expect(mapOutputToMusic(music, 9_750_000).fadeGain).toBeCloseTo(0.5, 5);
  });

  it('keeps the mix headroom formula from doc 09', () => {
    expect(mixSafetyGain([1])).toBeCloseTo(Math.pow(10, -1 / 20), 6);
    expect(mixSafetyGain([1, 1])).toBeCloseTo(Math.pow(10, -1 / 20) / 2, 6);
  });
});

describe('time helpers', () => {
  it('round-trips seconds through integer microseconds', () => {
    expect(secondsToUs(4.000001)).toBe(4_000_001);
    expect(secondsToUs(0.1)).toBe(100_000);
  });

  it('formats and parses timecodes', () => {
    expect(formatTimecode(8_000_000)).toBe('00:08.000');
    expect(formatTimecode(3_725_500_000)).toBe('01:02:05.500');
    expect(parseTimecode('00:08.000')).toBe(8_000_000);
    expect(parseTimecode('8')).toBe(8_000_000);
    expect(parseTimecode('1:02:05.5')).toBe(3_725_500_000);
  });

  it('rejects junk instead of coercing it', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
    expect(parseTimecode('-4')).toBeNull();
    // A minute or second field past 59 is a typo, not a time.
    expect(parseTimecode('00:75.000')).toBeNull();
    expect(parseTimecode('1:60')).toBeNull();
  });

  it('accepts what people actually type', () => {
    // An extra leading zero, as when editing "00:04.000" into "00:015.000".
    expect(parseTimecode('00:015.000')).toBe(15_000_000);
    // Plain seconds beyond two digits.
    expect(parseTimecode('150')).toBe(150_000_000);
    expect(parseTimecode('15,5')).toBe(15_500_000);
    expect(parseTimecode('2:05')).toBe(125_000_000);
  });
});
