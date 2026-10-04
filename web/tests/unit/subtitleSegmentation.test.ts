import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyTranscriptTrack, createEmptyProject, setVideoAsset } from '@/application/commands';
import { preflightCaptions } from '@/domain/captionBurnIn';
import { ALL_CAPTION_FRAMES, fitsEveryFrame } from '@/domain/captionFrames';
import type { MeasureText } from '@/domain/captionLayout';
import { CAPTION_LIMITS, DEFAULT_CAPTION_STYLE, captionTextProblem, normalizeCaptionText } from '@/domain/captions';
import type { AssetV1 } from '@/domain/edl';
import { CUE_RULES, cuesForWords, glued, layoutLines, transcriptToCues, type SegmentedCue } from '@/domain/subtitleSegmentation';
import type { TranscriptSegment, TranscriptWord } from '@/domain/transcript';
import { US_PER_SECOND } from '@/domain/time';

const S = US_PER_SECOND;
const LF = '\n';

interface Sample {
  clip: string;
  spans: { start: number; end: number }[];
  words: { text: string; start: number; end: number }[];
}
/** Real recogniser output from the October spike (see the fixture's note). */
const samples = (JSON.parse(readFileSync(join(__dirname, 'fixtures', 'transcript-words.json'), 'utf8')) as { samples: Sample[] }).samples;

const us = (seconds: number) => Math.round(seconds * S);
const wordsOf = (sample: Sample): TranscriptWord[] => sample.words.map((word) => ({ text: word.text, startUs: us(word.start), endUs: us(word.end) }));

/**
 * The sample as the engine hands it over: one segment per speech span. A word
 * belongs to the last span that started before it (the recogniser's times
 * can run a little past the end of the span it was given).
 */
function segmentsOf(sample: Sample): TranscriptSegment[] {
  const segments: TranscriptSegment[] = sample.spans.map((span) => ({ startUs: us(span.start), endUs: us(span.end), state: 'ok', words: [] }));
  for (const word of wordsOf(sample)) {
    let owner = segments[0];
    for (const segment of segments) if (segment.startUs <= word.startUs) owner = segment;
    owner?.words.push(word);
  }
  return segments.filter((segment) => segment.words.length > 0);
}

/**
 * A stand-in for the caption typeface's widths (Inter Bold): narrow letters
 * narrow, wide letters wide, capitals wider. Deliberately a little wider than
 * the real font, so a line that fits here fits there.
 */
const measure: MeasureText = (text, fontPx) => {
  let em = 0;
  for (const char of Array.from(text)) {
    if (char === ' ') em += 0.3;
    else if ('iljtfI.,;:!\'|'.includes(char)) em += 0.36;
    else if ('mwMW'.includes(char)) em += 0.95;
    else if (char >= 'A' && char <= 'Z') em += 0.74;
    else em += 0.62;
  }
  return em * fontPx;
};
const fits = (text: string) => fitsEveryFrame(text, DEFAULT_CAPTION_STYLE, measure);

function word(text: string, start: number, end: number): TranscriptWord {
  return { text, startUs: us(start), endUs: us(end) };
}
/** Words spoken back to back, `each` seconds a word, from `from`. */
function spoken(text: string, from = 0, each = 0.3): TranscriptWord[] {
  return text.split(' ').map((item, index) => word(item, from + index * each, from + (index + 1) * each - 0.02));
}
const lineLengths = (cue: SegmentedCue) => cue.text.split(LF).map((line) => Array.from(line).length);

describe('subtitle lines from real recogniser output', () => {
  it.each(samples.map((sample) => [sample.clip, sample] as const))('%s: every line obeys the rules', (_clip, sample) => {
    const { cues } = transcriptToCues(segmentsOf(sample), us(600), CUE_RULES, fits);
    expect(cues.length).toBeGreaterThan(5);
    // Every word is in exactly one line, in order: nothing dropped, nothing invented.
    expect(cues.map((cue) => cue.text.split(LF).join(' ')).join(' ')).toBe(sample.words.map((item) => item.text).join(' '));
    cues.forEach((cue, index) => {
      const lines = cue.text.split(LF);
      expect(lines.length, cue.text).toBeLessThanOrEqual(2);
      for (const length of lineLengths(cue)) expect(length, cue.text).toBeLessThanOrEqual(32);
      // Canonical caption text, acceptable to the app's own rules.
      expect(normalizeCaptionText(cue.text)).toBe(cue.text);
      expect(captionTextProblem(cue.text)).toBeNull();
      expect(cue.endUs - cue.startUs, cue.text).toBeGreaterThanOrEqual(CAPTION_LIMITS.minCueDurationUs);
      expect(cue.endUs - cue.startUs, cue.text).toBeLessThanOrEqual(CUE_RULES.maxDurationUs + CUE_RULES.minDurationUs);
      const next = cues[index + 1];
      if (next) expect(cue.endUs, cue.text).toBeLessThanOrEqual(next.startUs);
      expect(fits(cue.text), cue.text).toBe(true);
    });
  });

  it.each(samples.map((sample) => [sample.clip, sample] as const))(
    '%s: the lines pass the export preflight in 9:16, 16:9 and 1:1',
    (_clip, sample) => {
      const { cues } = transcriptToCues(segmentsOf(sample), us(600), CUE_RULES, fits);
      const renderCues = cues.map((cue, index) => ({ cueId: `q_${index}`, startFrame: index * 10, endFrame: index * 10 + 5, text: cue.text }));
      for (const frame of ALL_CAPTION_FRAMES) {
        const preflight = preflightCaptions({ style: DEFAULT_CAPTION_STYLE, cues: renderCues } as never, frame, measure);
        expect(preflight.ok, `${frame.aspect} ${frame.width}x${frame.height}`).toBe(true);
        if (preflight.ok) for (const layout of preflight.layouts) expect(layout.lines.length).toBeLessThanOrEqual(2);
      }
    },
  );

  it.each(samples.map((sample) => [sample.clip, sample] as const))('%s: the track is accepted whole by the app', (_clip, sample) => {
    const video: AssetV1 = { assetId: 'a_video_001', kind: 'video', durationUs: us(600), hasAudio: true };
    const made = transcriptToCues(segmentsOf(sample), us(600), CUE_RULES, fits);
    const result = applyTranscriptTrack(setVideoAsset(createEmptyProject(), video), made.cues, made.unclear);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report).toEqual({ imported: made.cues.length, skipped: [] });
  });

  it('long-fleurs: the examples the spike report printed, with its two faults put right', () => {
    const sample = samples.find((item) => item.clip === 'long-fleurs')!;
    const texts = transcriptToCues(segmentsOf(sample), us(600), CUE_RULES).cues.map((cue) => cue.text);
    expect(texts[0]).toBe(`However, due to the slow${LF}communication channels,`);
    // The spike's sketch broke "25 / -30 years."; a number range stays on one line now.
    const range = texts.find((text) => text.includes('25'))!;
    expect(range).toContain('25 -30');
    expect(range.split(LF).some((line) => line.includes('25 -30'))).toBe(true);
    // …and left "recorded by Lord Byron." as a line of its own after a full one; no three-letter orphans here.
    for (const text of texts) expect(Array.from(text.split(LF).join(' ')).length, text).toBeGreaterThan(3);
  });
});

describe('the rules, one by one', () => {
  it('a sentence end closes the line', () => {
    const cues = cuesForWords(spoken('It was late. We went home.'), us(60));
    expect(cues.map((cue) => cue.text)).toEqual(['It was late.', 'We went home.']);
  });

  it('a pause of half a second closes the line; a shorter one does not', () => {
    const words = [...spoken('one two three', 0), ...spoken('four five', 0.9 + 0.5)];
    expect(cuesForWords(words, us(60)).map((cue) => cue.text)).toEqual(['one two three', 'four five']);
    const close = [...spoken('one two three', 0), ...spoken('four five', 0.9 + 0.3)];
    expect(cuesForWords(close, us(60)).map((cue) => cue.text)).toEqual(['one two three four five']);
  });

  it('a line is at most two lines of 32 characters, split where they are most even', () => {
    const cues = cuesForWords(spoken('the quick brown fox jumps over the lazy dog and runs far away from the farm tonight'), us(60));
    for (const cue of cues) {
      expect(cue.text.split(LF).length).toBeLessThanOrEqual(2);
      for (const length of lineLengths(cue)) expect(length).toBeLessThanOrEqual(32);
    }
    const [first] = cues;
    const [a, b] = lineLengths(first!);
    expect(Math.abs((a as number) - (b as number))).toBeLessThanOrEqual(8);
  });

  it('prefers to break the two lines after punctuation', () => {
    const lines = layoutLines(spoken('When it rained, we stayed in and read'));
    expect(lines).toEqual(['When it rained,', 'we stayed in and read']);
  });

  it('more than half full, a comma closes the line', () => {
    const cues = cuesForWords(spoken('To the north and within easy reach of the old town, there is a lake'), us(60));
    expect(cues[0]!.text.split(LF).join(' ')).toBe('To the north and within easy reach of the old town,');
  });

  it('a line never passes six seconds of speech', () => {
    const slow = spoken('a b c d e f g h i j k l m n', 0, 0.8);
    for (const cue of cuesForWords(slow, us(60))) {
      const text = cue.text.split(LF).join(' ').split(' ');
      expect(text.length * 0.8).toBeLessThanOrEqual(6.01);
    }
  });

  it('stays until 0.15 s after its last word, at least 0.8 s, never into the next line', () => {
    const [alone] = cuesForWords([word('Yes.', 2, 2.2)], us(60));
    expect(alone).toEqual({ startUs: us(2), endUs: us(2.8), text: 'Yes.' });
    const [long] = cuesForWords(spoken('this takes a while to say', 0), us(60));
    expect(long!.endUs).toBe(us(6 * 0.3 - 0.02) + 150_000);
    const tight = cuesForWords([...spoken('First one.', 0), ...spoken('Second one.', 0.62)], us(60));
    expect(tight[0]!.endUs).toBe(tight[1]!.startUs);
    // The last line of a span stops where the next span's first line starts.
    const [capped] = cuesForWords([word('End.', 5, 5.3)], us(5.5));
    expect(capped!.endUs).toBe(us(5.5));
  });

  it('never breaks inside a number range or before a clinging mark', () => {
    expect(glued('25', '-30')).toBe(true);
    expect(glued('10', '%')).toBe(true);
    expect(glued('$', '5')).toBe(true);
    expect(glued('well-', 'known')).toBe(true);
    expect(glued('lag', 'behind')).toBe(false);
    const words = spoken('styles in the West could lag behind by 25 -30 years.');
    const [cue] = cuesForWords(words, us(60));
    expect(cue!.text).toBe(`styles in the West could${LF}lag behind by 25 -30 years.`);
    expect(layoutLines(spoken('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 25 -30'))).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '25 -30']);
  });

  it('a short last word shares the line before it instead of standing alone', () => {
    // 61 characters then "Byron.": the sketch made a line of "Byron." alone.
    const words = spoken('foreigners after a glowing account of its splendours recorded by Byron.');
    const cues = cuesForWords(words, us(60));
    const last = cues[cues.length - 1]!.text.split(LF).join(' ');
    expect(last).not.toBe('Byron.');
    expect(Array.from(last).length).toBeGreaterThan(CUE_RULES.orphanChars);
    expect(cues.map((cue) => cue.text.split(LF).join(' ')).join(' ')).toBe(words.map((item) => item.text).join(' '));
  });

  it('a line that would flash by is joined to its neighbour', () => {
    const words = [word('Oh.', 0, 0.1), word('Right.', 0.12, 0.2), ...spoken('Now we begin.', 0.25)];
    const cues = cuesForWords(words, us(60));
    for (const cue of cues) expect(cue.endUs - cue.startUs).toBeGreaterThanOrEqual(CUE_RULES.hardMinDurationUs);
    expect(cues.map((cue) => cue.text.split(LF).join(' ')).join(' ')).toBe('Oh. Right. Now we begin.');
  });

  it('uses the caller\'s frame test: a line the frame cannot hold is made shorter', () => {
    const wide = spoken('WWWWWWWW MMMMMMMM WWWWWWWW MMMMMMMM WWWWWWWW MMMMMMMM');
    const loose = cuesForWords(wide, us(60));
    const strict = cuesForWords(wide, us(60), CUE_RULES, fits);
    expect(loose.every((cue) => lineLengths(cue).every((length) => length <= 32))).toBe(true);
    expect(loose.some((cue) => !fits(cue.text))).toBe(true);
    expect(strict.every((cue) => fits(cue.text))).toBe(true);
    expect(strict.length).toBeGreaterThan(loose.length);
  });

  it('words of different speech spans never share a line, and unclear spans come back as ranges', () => {
    const segments: TranscriptSegment[] = [
      { startUs: us(0), endUs: us(2), state: 'ok', words: spoken('Hello there', 0.2) },
      { startUs: us(5), endUs: us(8), state: 'unclear', words: [] },
      { startUs: us(8.2), endUs: us(10), state: 'ok', words: spoken('again now', 8.4) },
    ];
    const made = transcriptToCues(segments, us(60));
    expect(made.cues.map((cue) => cue.text)).toEqual(['Hello there', 'again now']);
    expect(made.unclear).toEqual([{ startUs: us(5), endUs: us(8) }]);
    // The first line may linger, but not into the next span's first word.
    expect(made.cues[0]!.endUs).toBeLessThanOrEqual(us(8.4));
  });

  it('an empty transcript gives nothing', () => {
    expect(transcriptToCues([], us(60))).toEqual({ cues: [], unclear: [] });
    expect(cuesForWords([], us(60))).toEqual([]);
  });
});
