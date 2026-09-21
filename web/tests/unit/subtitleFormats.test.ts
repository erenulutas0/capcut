import { describe, expect, it } from 'vitest';

import { decodeSubtitleBytes } from '@/adapters/subtitleFile';
import {
  detectSubtitleFormat,
  formatSubtitleTimestamp,
  parseSubtitles,
  serializeSubtitles,
  stripSubtitleMarkup,
} from '@/domain/subtitleFormats';

const S = 1_000_000;
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const lines = (...parts: string[]) => parts.join(LF);

function parsed(text: string) {
  const result = parseSubtitles(text);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('SRT', () => {
  it('reads numbered blocks with CRLF, a BOM and Turkish text', () => {
    const file =
      String.fromCharCode(0xfeff) +
      ['1', '00:00:01,000 --> 00:00:02,500', 'Günaydın İstanbul', '', '2', '00:00:03,000 --> 00:00:04,250', 'Işıl ışıl', 'deniz', ''].join(CRLF);
    const value = parsed(file);
    expect(value.format).toBe('srt');
    expect(value.cues).toEqual([
      { startUs: 1 * S, endUs: 2.5 * S, text: 'Günaydın İstanbul' },
      { startUs: 3 * S, endUs: 4.25 * S, text: `Işıl ışıl${LF}deniz` },
    ]);
    expect(value.problems).toEqual([]);
  });

  it('strips markup and override blocks, and decodes entities to plain text', () => {
    const backslash = String.fromCharCode(92);
    const value = parsed(
      lines('1', '00:00:01,000 --> 00:00:02,000', `{${backslash}an8}<i>eğik</i> <font color="red">kırmızı</font> &amp; &lt;b&gt;`),
    );
    expect(value.cues[0]?.text).toBe('eğik kırmızı & <b>');
  });

  it('reports broken blocks by number and keeps the good ones', () => {
    const value = parsed(
      lines(
        '1', '00:00:01,000 --> 00:00:02,000', 'iyi', '',
        '2', '00:00:0X,000 --> 00:00:03,000', 'bozuk zaman', '',
        '3', '00:00:04,000 --> 00:00:05,000', '', '',
        '4', '00:00:06,000 --> 00:00:07,000', 'yine iyi',
      ),
    );
    expect(value.cues.map((cue) => cue.text)).toEqual(['iyi', 'yine iyi']);
    expect(value.problems).toEqual([
      { block: 2, reason: 'bad_timing' },
      { block: 3, reason: 'no_text' },
    ]);
  });

  it('joins a third line into the second and counts it', () => {
    const value = parsed(lines('1', '00:00:01,000 --> 00:00:02,000', 'bir', 'iki', 'üç'));
    expect(value.cues[0]?.text).toBe(`bir${LF}iki üç`);
    expect(value.joinedLines).toBe(1);
  });

  it('accepts long hours and short fractions', () => {
    const value = parsed(lines('1', '100:00:01,5 --> 100:00:02,05', 'uzun'));
    expect(value.cues[0]).toMatchObject({ startUs: (360_000 + 1.5) * S, endUs: (360_000 + 2.05) * S });
  });
});

describe('WebVTT', () => {
  it('ignores header text, NOTE/STYLE/REGION blocks, cue ids and cue settings', () => {
    const value = parsed(
      lines(
        'WEBVTT - başlık', '',
        'NOTE bu bir not', 'ikinci satır', '',
        'STYLE', '::cue { color: red }', '',
        'giris', '00:01.000 --> 00:02.000 align:start position:10%', '<v Ayşe>Merhaba</v> <c.sari>dünya</c>', '',
        '00:00:03.000 --> 00:00:04.000', 'saatli <00:00:03.500>zaman',
      ),
    );
    expect(value.format).toBe('vtt');
    expect(value.cues).toEqual([
      { startUs: 1 * S, endUs: 2 * S, text: 'Merhaba dünya' },
      { startUs: 3 * S, endUs: 4 * S, text: 'saatli zaman' },
    ]);
    expect(value.problems).toEqual([]);
  });

  it('refuses files that are not subtitles at all', () => {
    expect(parseSubtitles('bir alışveriş listesi\nsüt\nekmek')).toEqual({ ok: false, reason: 'not_subtitles' });
    expect(detectSubtitleFormat('<html><script>alert(1)</script>')).toBeNull();
  });
});

describe('writing', () => {
  const cues = [
    { startUs: 1 * S, endUs: 2.5 * S, text: 'Günaydın' },
    { startUs: 61.0015 * S, endUs: 3725.25 * S, text: `iki${LF}satır < & >` },
  ];

  it('formats timestamps to the millisecond, past one hour', () => {
    expect(formatSubtitleTimestamp(3725.25 * S, 'srt')).toBe('01:02:05,250');
    expect(formatSubtitleTimestamp(1.0004 * S, 'vtt')).toBe('00:00:01.000');
  });

  it('writes SRT with CRLF and reads it back to the same cues (to the ms)', () => {
    const srt = serializeSubtitles(cues, 'srt');
    expect(srt.startsWith(`1${CRLF}00:00:01,000 --> 00:00:02,500${CRLF}Günaydın${CRLF}`)).toBe(true);
    const back = parsed(srt).cues;
    expect(back.map((cue) => cue.text)).toEqual(['Günaydın', `iki${LF}satır < & >`]);
    expect(back[1]?.startUs).toBe(61.002 * S);
  });

  it('writes VTT with escaped markup characters and reads it back', () => {
    const vtt = serializeSubtitles(cues, 'vtt');
    expect(vtt.startsWith(`WEBVTT${LF}${LF}`)).toBe(true);
    expect(vtt).toContain('satır &lt; &amp; &gt;');
    expect(parsed(vtt).cues[1]?.text).toBe(`iki${LF}satır < & >`);
  });

  it('never lets text become markup', () => {
    expect(stripSubtitleMarkup('<img src=x onerror=alert(1)>merhaba')).toBe('merhaba');
    expect(stripSubtitleMarkup('&#0;&#x1;ok&#65;')).toBe('&#0;&#x1;okA');
  });
});

describe('decoding bytes', () => {
  it('reads UTF-8 as UTF-8', () => {
    const bytes = new TextEncoder().encode('ğüşiöçı');
    expect(decodeSubtitleBytes(bytes)).toEqual({ text: 'ğüşiöçı', encoding: 'utf-8' });
  });

  it('falls back to Windows-1254 for Turkish files that are not UTF-8', () => {
    // "ğüş" in Windows-1254: F0 FC FE.
    expect(decodeSubtitleBytes(new Uint8Array([0xf0, 0xfc, 0xfe]))).toEqual({
      text: 'ğüş',
      encoding: 'windows-1254',
    });
  });

  it('honours a UTF-16 byte order mark', () => {
    expect(decodeSubtitleBytes(new Uint8Array([0xff, 0xfe, 0x31, 0x01])).text).toBe('ı');
  });
});
