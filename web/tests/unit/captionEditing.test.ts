import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CUE_LENGTH_US,
  captionMarks,
  captionFits,
  suggestNewCueRange,
} from '@/domain/captionEditing';
import type { MeasureText } from '@/domain/captionLayout';
import { DEFAULT_CAPTION_STYLE } from '@/domain/captions';
import type { CaptionCueV2 } from '@/domain/edl';
import { US_PER_SECOND } from '@/domain/time';

const S = US_PER_SECOND;

function cue(cueId: string, startS: number, endS: number, text = 'Merhaba'): CaptionCueV2 {
  return { cueId, startUs: startS * S, endUs: endS * S, text };
}

/** Every character is half the font size wide: predictable wrapping. */
const monoMeasure: MeasureText = (text, fontPx) => Array.from(text).length * fontPx * 0.5;

describe('suggestNewCueRange', () => {
  it('starts at the playhead and lasts the default length', () => {
    expect(suggestNewCueRange([], 3 * S, 10 * S)).toEqual({
      ok: true,
      startUs: 3 * S,
      endUs: 3 * S + DEFAULT_CUE_LENGTH_US,
    });
  });

  it('rounds the start to a whole millisecond so the shown time is the stored time', () => {
    const result = suggestNewCueRange([], 1_234_567, 10 * S);
    expect(result).toMatchObject({ ok: true, startUs: 1_235_000 });
  });

  it('starts after the line under the playhead, following back-to-back lines', () => {
    const cues = [cue('q_002', 3, 5), cue('q_001', 1, 3)];
    expect(suggestNewCueRange(cues, 1.5 * S, 20 * S)).toEqual({
      ok: true,
      startUs: 5 * S,
      endUs: 7 * S,
    });
  });

  it('stops where the next line starts instead of overlapping it', () => {
    const cues = [cue('q_001', 4, 6)];
    expect(suggestNewCueRange(cues, 3 * S, 20 * S)).toEqual({ ok: true, startUs: 3 * S, endUs: 4 * S });
  });

  it('is cut at the output end', () => {
    expect(suggestNewCueRange([], 9 * S, 10 * S)).toEqual({ ok: true, startUs: 9 * S, endUs: 10 * S });
  });

  it('refuses at or after the output end', () => {
    expect(suggestNewCueRange([], 10 * S, 10 * S)).toEqual({ ok: false, reason: 'caption_outside_output' });
    expect(suggestNewCueRange([cue('q_001', 8, 10)], 9 * S, 10 * S)).toEqual({
      ok: false,
      reason: 'caption_outside_output',
    });
  });

  it('says when the gap before the next line is too short for a readable line', () => {
    const cues = [cue('q_001', 1, 2), cue('q_002', 2.1, 4)];
    expect(suggestNewCueRange(cues, 1.5 * S, 20 * S)).toEqual({ ok: false, reason: 'caption_no_room' });
  });
});

describe('captionFits', () => {
  const frame = { width: 1080, height: 1920, aspect: '9:16' as const };

  it('accepts a short line and refuses one that needs a third line', () => {
    expect(captionFits('Kısa bir satır', DEFAULT_CAPTION_STYLE, frame, monoMeasure)).toBe(true);
    expect(captionFits('uzun '.repeat(20), DEFAULT_CAPTION_STYLE, frame, monoMeasure)).toBe(false);
  });

  it('depends on the size preset', () => {
    // Five 10-letter words: two lines at small size, three at large.
    const text = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee';
    expect(captionFits(text, { ...DEFAULT_CAPTION_STYLE, size: 'small' }, frame, monoMeasure)).toBe(true);
    expect(captionFits(text, { ...DEFAULT_CAPTION_STYLE, size: 'large' }, frame, monoMeasure)).toBe(false);
  });

  it('judges the text as it will be stored: extra spaces do not count', () => {
    const padded = `aaaaaaaaaa${' '.repeat(80)}bbbbbbbbbb`;
    expect(captionFits(padded, DEFAULT_CAPTION_STYLE, frame, monoMeasure)).toBe(true);
    expect(captionFits('   ', DEFAULT_CAPTION_STYLE, frame, monoMeasure)).toBe(true);
  });
});

describe('captionMarks', () => {
  it('places lines in percent of the output and cuts or drops what is past the end', () => {
    const marks = captionMarks([cue('q_003', 9, 12), cue('q_001', 0, 2), cue('q_004', 11, 12)], 10 * S);
    expect(marks).toEqual([
      { cueId: 'q_001', leftPct: 0, widthPct: 20, visibility: 'visible' },
      { cueId: 'q_003', leftPct: 90, widthPct: 10, visibility: 'clipped' },
    ]);
  });

  it('is empty for an empty output', () => {
    expect(captionMarks([cue('q_001', 0, 2)], 0)).toEqual([]);
  });
});
