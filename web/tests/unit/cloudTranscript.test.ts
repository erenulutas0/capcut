import { describe, expect, it } from 'vitest';

import { tidyInvite } from '@/adapters/cloud/inviteStore';
import { addClip, applyTranscriptTrack, createEmptyProject, setVideoAsset } from '@/application/commands';
import { primaryCaptionTrack } from '@/domain/captions';
import {
  CLOUD_SEGMENT_GAP_US,
  CLOUD_TIME_MODEL,
  MAX_SPEAKERS,
  captionLanguage,
  cloudCues,
  cloudEstimateMinutes,
  cloudGiveUpMs,
  cloudSegments,
  failureFromAnswer,
  minutesCharged,
  minutesVerdict,
  parseCloudResult,
  parseQuota,
  type CloudFailure,
} from '@/domain/cloudTranscript';
import { EDL_SCHEMA_VERSION, type AssetV1 } from '@/domain/edl';
import { speakerTurns, transcriptLines, transcriptText } from '@/domain/transcript';
import { validateProject } from '@/domain/validation';
import { cloudTr, type CloudMessageKey } from '@/i18n/cloudMessages';

/**
 * The cloud transcript route (ADR-039), the part that needs no browser: what
 * the proxy's answers mean, how the provider's words become the app's lines,
 * and the numbers the choice screen shows.
 */

const S = 1_000_000;
const MIN = 60 * S;
const w = (text: string, startMs: number, endMs: number, speaker: string | null = 'A') => ({ text, start: startMs, end: endMs, confidence: 0.9, speaker });
const result = (words: unknown, extra: Record<string, unknown> = {}) => ({ id: 't-1', status: 'completed', text: '', words, utterances: null, language_code: 'tr', audio_duration: 24, ...extra });

describe('what the proxy\'s refusals mean', () => {
  it('every code the Worker can answer is one of the failures the screen has a sentence for', () => {
    const cases: [number, string, CloudFailure][] = [
      [401, 'invite_required', 'invite_invalid'],
      [401, 'invite_invalid', 'invite_invalid'],
      [402, 'invite_minutes_used_up', 'minutes_used_up'],
      [503, 'cloud_off', 'off'],
      [503, 'monthly_cap_reached', 'off'],
      [413, 'too_long', 'too_long'],
      [409, 'job_in_progress', 'busy'],
      [429, 'rate_limited', 'rate_limited'],
      [502, 'provider_error', 'provider_error'],
      [409, 'job_id_taken', 'upload_interrupted'],
      // What the site never causes when it works (a wrong type, no length, a bad header): our bug, said as such.
      [415, 'not_audio', 'internal_error'],
      [411, 'length_required', 'internal_error'],
      [400, 'duration_required', 'internal_error'],
      [413, 'too_large', 'internal_error'],
      [400, 'bad_language', 'internal_error'],
      [400, 'bad_job_id', 'internal_error'],
      [403, 'origin_not_allowed', 'internal_error'],
      [404, 'job_not_found', 'internal_error'],
      [500, 'internal_error', 'internal_error'],
    ];
    for (const [status, code, expected] of cases) expect(failureFromAnswer(status, code), `${status} ${code}`).toBe(expected);
  });

  it('an answer without a known code is judged by its status', () => {
    expect(failureFromAnswer(401, undefined)).toBe('invite_invalid');
    expect(failureFromAnswer(402, null)).toBe('minutes_used_up');
    expect(failureFromAnswer(429, '')).toBe('rate_limited');
    expect(failureFromAnswer(503, 42)).toBe('off');
    expect(failureFromAnswer(502, undefined)).toBe('provider_error');
    expect(failureFromAnswer(504, undefined)).toBe('provider_error');
    expect(failureFromAnswer(418, 'teapot')).toBe('internal_error');
  });

  it('every failure has its own Turkish sentence, and every one of them names the on-device way', () => {
    const failures: CloudFailure[] = ['unreachable', 'off', 'invite_invalid', 'minutes_used_up', 'too_long', 'busy', 'rate_limited', 'upload_interrupted', 'provider_error', 'empty', 'timeout', 'audio_unavailable', 'audio_unreadable', 'internal_error'];
    const sentences = failures.map((reason) => cloudTr[`cloud.failed.${reason}` as CloudMessageKey]);
    expect(sentences.every((text) => typeof text === 'string' && text.length > 20)).toBe(true);
    expect(new Set(sentences).size).toBe(failures.length - 0);
    for (const text of sentences) expect(text, text).toMatch(/cihazında/i);
    // And the table has no failure sentence the code cannot produce.
    const keys = Object.keys(cloudTr).filter((key) => key.startsWith('cloud.failed.'));
    expect(keys.sort()).toEqual(failures.map((reason) => `cloud.failed.${reason}`).sort());
  });
});

describe('minutes', () => {
  it('reads the quota answer and refuses anything else', () => {
    expect(parseQuota({ on: true, remainingMinutes: 59.9, maxJobMinutes: 120 })).toEqual({ on: true, remainingMinutes: 59, maxJobMinutes: 120 });
    for (const bad of [null, 'x', {}, { on: 'yes', remainingMinutes: 1, maxJobMinutes: 1 }, { on: true, remainingMinutes: -1, maxJobMinutes: 120 }, { on: true, remainingMinutes: 1, maxJobMinutes: 0 }, { on: true, remainingMinutes: Number.NaN, maxJobMinutes: 1 }]) {
      expect(parseQuota(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('what a video takes is said in whole minutes, rounded up: never less than is taken', () => {
    expect(minutesCharged(1)).toBe(1);
    expect(minutesCharged(24 * S)).toBe(1);
    expect(minutesCharged(60 * S)).toBe(1);
    expect(minutesCharged(60 * S + 1)).toBe(2);
    expect(minutesCharged(23 * MIN)).toBe(23);
  });

  it('fits, not enough, too long, off', () => {
    const quota = { on: true, remainingMinutes: 60, maxJobMinutes: 120 };
    // The founder's drawing: 23 minutes of sound, 60 left → "23 dakika düşer, 37 dakikan kalır".
    expect(minutesVerdict(quota, 23 * MIN)).toEqual({ kind: 'fits', charged: 23, left: 37 });
    expect(minutesVerdict(quota, 60 * MIN)).toEqual({ kind: 'fits', charged: 60, left: 0 });
    expect(minutesVerdict(quota, 60 * MIN + S)).toEqual({ kind: 'not_enough', charged: 61, remaining: 60 });
    expect(minutesVerdict({ ...quota, remainingMinutes: 600 }, 120 * MIN)).toEqual({ kind: 'fits', charged: 120, left: 480 });
    expect(minutesVerdict({ ...quota, remainingMinutes: 600 }, 120 * MIN + 1)).toEqual({ kind: 'too_long', maxJobMinutes: 120 });
    expect(minutesVerdict({ ...quota, on: false }, S)).toEqual({ kind: 'off' });
  });
});

describe('"Yaklaşık N dakika sürer"', () => {
  // ADR-039, addendum of 11 Oct 2026: minutes of sound → seconds from upload to result, as measured.
  const MEASURED: [number, number][] = [[51, 38.4], [21, 22.0], [14, 15.5], [14, 20.7], [5, 14.6], [5, 10.8], [2, 10.9], [0.17, 4], [0, 11.3], [0, 15.2]];

  it('the model lies above every measured run (the last two: files whose length the table does not give, taken as zero)', () => {
    for (const [minutes, seconds] of MEASURED) {
      expect(CLOUD_TIME_MODEL.baseS + CLOUD_TIME_MODEL.perMinuteS * minutes, `${minutes} min`).toBeGreaterThanOrEqual(seconds);
    }
  });

  it('is said in whole minutes, rounded up, never zero', () => {
    expect(cloudEstimateMinutes(0)).toBe(1);
    expect(cloudEstimateMinutes(24 * S)).toBe(1);
    expect(cloudEstimateMinutes(23 * MIN)).toBe(1);
    expect(cloudEstimateMinutes(51 * MIN)).toBe(1);
    expect(cloudEstimateMinutes(54 * MIN)).toBe(2);
    expect(cloudEstimateMinutes(120 * MIN)).toBe(2);
  });

  it('a job is given up after fifteen minutes, or ten times the estimate when that is longer', () => {
    expect(cloudGiveUpMs(24 * S)).toBe(15 * 60_000);
    expect(cloudGiveUpMs(120 * MIN)).toBe(20 * 60_000);
  });
});

describe('the provider\'s words → the app\'s words', () => {
  it('milliseconds become source microseconds; speakers are numbered as first heard', () => {
    const parsed = parseCloudResult(result([w('Merhaba', 100, 500, 'B'), w('dünya.', 550, 900, 'A'), w('Evet.', 1200, 1500, 'B')]), 24 * S);
    expect(parsed).toEqual({
      words: [
        { text: 'Merhaba', startUs: 100_000, endUs: 500_000, speaker: 1 },
        { text: 'dünya.', startUs: 550_000, endUs: 900_000, speaker: 2 },
        { text: 'Evet.', startUs: 1_200_000, endUs: 1_500_000, speaker: 1 },
      ],
      language: 'tr',
      speakers: 2,
    });
  });

  it('an answer that is not a finished transcript is a failure, not an empty transcript', () => {
    for (const bad of [null, 'text', [], {}, { status: 'processing', words: [] }, { status: 'error' }, result('words')]) expect(parseCloudResult(bad, 24 * S), JSON.stringify(bad)).toBeNull();
    // Silence: finished, no words.
    expect(parseCloudResult(result([]), 24 * S)).toEqual({ words: [], language: 'tr', speakers: 0 });
    expect(parseCloudResult(result(null), 24 * S)?.words).toEqual([]);
  });

  it('nothing is guessed: a word without text or times is left out; times never run backwards or past the video', () => {
    const parsed = parseCloudResult(
      result([
        w('  bir  ', 1000, 1400),
        { text: 'saatsiz' },
        w('', 1500, 1600),
        w('iki', 900, 950), // earlier than the word before it
        w('üç', 2000, 1900), // ends before it starts
        w('son', 23_900, 26_000), // runs past the video
        w('dışarıda', 24_000, 24_500), // starts at the end
        null,
        'x',
      ]),
      24 * S,
    );
    expect(parsed?.words).toEqual([
      { text: 'bir', startUs: 1_000_000, endUs: 1_400_000, speaker: 1 },
      { text: 'iki', startUs: 1_000_000, endUs: 1_001_000, speaker: 1 },
      { text: 'üç', startUs: 2_000_000, endUs: 2_001_000, speaker: 1 },
      { text: 'son', startUs: 23_900_000, endUs: 24_000_000, speaker: 1 },
    ]);
  });

  it('no speakers named, and more voices than can be told apart on screen', () => {
    expect(parseCloudResult(result([w('a', 0, 100, null), w('b', 200, 300, null)]), 24 * S)).toMatchObject({ speakers: 0, words: [{ speaker: null }, { speaker: null }] });
    const many = Array.from({ length: MAX_SPEAKERS + 3 }, (_, index) => w(`s${index}`, index * 1000, index * 1000 + 500, `V${index}`));
    const parsed = parseCloudResult(result(many), 600 * S);
    expect(parsed?.speakers).toBe(MAX_SPEAKERS);
    expect(parsed?.words.at(-1)?.speaker).toBeNull();
  });

  it('the language as the caption track stores it', () => {
    expect(captionLanguage('tr')).toBe('tr');
    expect(captionLanguage('en_us')).toBe('en-US');
    expect(captionLanguage('en-GB')).toBe('en-GB');
    for (const bad of [undefined, null, '', 'english', 'e', 'tr_', 42]) expect(captionLanguage(bad)).toBeNull();
    expect(parseCloudResult(result([w('a', 0, 100)], { language_code: 'en_us' }), S)?.language).toBe('en-US');
    expect(parseCloudResult(result([w('a', 0, 100)], { language_code: 'klingon' }), S)?.language).toBeNull();
  });

  it('a stretch ends where the speaker changes or more than a second passes without a word', () => {
    const words = parseCloudResult(
      result([
        w('Bir', 0, 400, 'A'),
        w('iki.', 450, 900, 'A'),
        w('Üç', 950, 1300, 'B'), // another voice, no pause
        w('dört.', 1350, 1800, 'B'),
        w('Beş.', 1800 + CLOUD_SEGMENT_GAP_US / 1000, 3300, 'B'), // exactly one second later: the same stretch
        w('Altı.', 3300 + CLOUD_SEGMENT_GAP_US / 1000 + 1, 5000, 'B'), // a millisecond more: a new one
      ]),
      24 * S,
    )?.words ?? [];
    expect(cloudSegments(words).map((segment) => [segment.speaker, segment.words.map((word) => word.text).join(' ')])).toEqual([
      [1, 'Bir iki.'],
      [2, 'Üç dört. Beş.'],
      [2, 'Altı.'],
    ]);
  });

  it('the lines are the app\'s own (two lines of 32, sentence ends, pauses), each with one voice; none runs into the next', () => {
    const words = [
      ...'Merhaba, bugün videoyu yazıya döküyoruz.'.split(' ').map((text, index) => w(text, 1000 + index * 350, 1320 + index * 350, 'A')),
      ...'Çok iyi, ben de dinliyorum.'.split(' ').map((text, index) => w(text, 2900 + index * 350, 3220 + index * 350, 'B')),
      ...'Bu cümle bilerek çok uzun tutuldu ki satır kuralları onu birden fazla satıra bölsün ve hiçbir satır taşmasın.'.split(' ').map((text, index) => w(text, 7000 + index * 300, 7270 + index * 300, 'A')),
    ];
    const parsed = parseCloudResult(result(words), 24 * S);
    const cues = cloudCues(parsed ?? { words: [] }, 24 * S);
    expect(cues.map((cue) => [cue.speaker, cue.text])).toEqual([
      // (The break inside a line goes where its two halves are most even: the on-device rule, unchanged.)
      [1, 'Merhaba, bugün videoyu\nyazıya döküyoruz.'],
      [2, 'Çok iyi, ben de dinliyorum.'],
      [1, 'Bu cümle bilerek çok uzun\ntutuldu ki satır kuralları onu'],
      [1, 'birden fazla satıra bölsün\nve hiçbir satır taşmasın.'],
    ]);
    for (const cue of cues) {
      for (const line of cue.text.split('\n')) expect(Array.from(line).length, line).toBeLessThanOrEqual(32);
      expect(cue.text.split('\n').length).toBeLessThanOrEqual(2);
    }
    cues.forEach((cue, index) => {
      expect(cue.endUs).toBeGreaterThan(cue.startUs);
      const next = cues[index + 1];
      if (next) expect(cue.endUs).toBeLessThanOrEqual(next.startUs);
      expect(cue.endUs).toBeLessThanOrEqual(24 * S);
    });
    // The first voice's line ends where the second voice begins, not after it.
    expect(cues[0]?.endUs).toBeLessThanOrEqual(2_900_000);
  });
});

describe('in the recipe: a transcript track whose lines name their voice (EDL v5, ADR-043)', () => {
  const video: AssetV1 = { assetId: 'a_video', kind: 'video', durationUs: 24 * S, displayWidth: 1280, displayHeight: 720, hasAudio: true };
  const opened = () => setVideoAsset(createEmptyProject(), video);
  const words = [...['Merhaba,', 'nasılsın?'].map((text, index) => w(text, 1000 + index * 400, 1350 + index * 400, 'A')), ...['İyiyim,', 'teşekkürler.'].map((text, index) => w(text, 2500 + index * 400, 2850 + index * 400, 'B'))];

  it('the cloud result becomes the same track an on-device transcript makes, in the provider\'s language', () => {
    const parsed = parseCloudResult(result(words), video.durationUs);
    const cues = cloudCues(parsed ?? { words: [] }, video.durationUs);
    const applied = applyTranscriptTrack(opened(), cues, [], parsed?.language ?? undefined);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const track = primaryCaptionTrack(applied.project);
    expect(track).toMatchObject({ origin: 'transcript', timeBase: 'source', assetId: 'a_video', language: 'tr' });
    expect(track?.cues).toEqual([
      // Until 0,15 s after its last word (the on-device rule), well before the other voice begins.
      // Who said the line is ON the line: the first voice heard is 1.
      { cueId: 'q_001', startUs: 1_000_000, endUs: 1_900_000, text: 'Merhaba, nasılsın?', speaker: 1 },
      { cueId: 'q_002', startUs: 2_500_000, endUs: 3_400_000, text: 'İyiyim, teşekkürler.', speaker: 2 },
    ]);
    // The line is the only place the route leaves anything: the track has no new key.
    expect(Object.keys(track ?? {}).sort()).toEqual(['assetId', 'cues', 'language', 'origin', 'style', 'timeBase', 'trackId']);
    expect(applied.project.schemaVersion).toBe(EDL_SCHEMA_VERSION);
    expect(EDL_SCHEMA_VERSION).toBe(6);
    const withKesit = addClip(applied.project, { sourceInUs: 0, sourceOutUs: 5 * S });
    expect(withKesit.ok && validateProject(withKesit.project).ok).toBe(true);
    // The panel reads the voices from the stored lines — nothing lives beside the recipe any more.
    expect([...speakerTurns(transcriptLines(track))]).toEqual([['q_001', 1], ['q_002', 2]]);
  });

  it('one voice, or none named: the lines carry what was heard, and nobody is labelled', () => {
    const one = parseCloudResult(result(words.map((word) => ({ ...word, speaker: 'A' }))), video.durationUs);
    const single = applyTranscriptTrack(opened(), cloudCues(one ?? { words: [] }, video.durationUs), [], 'tr');
    expect(single.ok && primaryCaptionTrack(single.project)?.cues.map((cue) => cue.speaker)).toEqual([1, 1]);
    if (single.ok) expect(speakerTurns(transcriptLines(primaryCaptionTrack(single.project))).size).toBe(0);

    const none = parseCloudResult(result(words.map((word) => ({ ...word, speaker: null }))), video.durationUs);
    const unnamed = applyTranscriptTrack(opened(), cloudCues(none ?? { words: [] }, video.durationUs), [], 'tr');
    expect(unnamed.ok).toBe(true);
    if (!unnamed.ok) return;
    // A line whose voice is not known has NO speaker field (not null, not 0): the recipe is valid.
    expect(JSON.stringify(unnamed.project)).not.toContain('speaker');
    const kesit = addClip(unnamed.project, { sourceInUs: 0, sourceOutUs: 5 * S });
    expect(kesit.ok && validateProject(kesit.project).ok).toBe(true);
  });

  it('the on-device transcript never names a voice, whatever it is handed', () => {
    const cue = [{ startUs: S, endUs: 2 * S, text: 'Hello.' }];
    const plain = applyTranscriptTrack(opened(), cue, []);
    expect(plain.ok && JSON.stringify(plain.project)).not.toContain('speaker');
    // A number the recipe cannot hold is left off, never bent into range.
    for (const speaker of [0, 21, 1.5, -1, Number.NaN, null]) {
      const odd = applyTranscriptTrack(opened(), [{ ...cue[0]!, speaker }], [], 'tr');
      expect(odd.ok && JSON.stringify(odd.project), String(speaker)).not.toContain('speaker');
    }
  });

  it('the on-device transcript still says English unless told otherwise; a language that is not one is not stored', () => {
    const cue = [{ startUs: S, endUs: 2 * S, text: 'Hello.' }];
    const plain = applyTranscriptTrack(opened(), cue, []);
    expect(plain.ok && primaryCaptionTrack(plain.project)?.language).toBe('en');
    const odd = applyTranscriptTrack(opened(), cue, [], 'not a language');
    expect(odd.ok && primaryCaptionTrack(odd.project)?.language).toBe('en');
  });

  it('a line the caption rules refuse is skipped, and the voices still land on the right lines', () => {
    const cues = [
      { startUs: 1 * S, endUs: 2 * S, text: 'Bir.', speaker: 1 },
      { startUs: 2 * S, endUs: 2 * S + 50_000, text: 'Çok kısa.', speaker: 2 }, // shorter than a line may be
      { startUs: 3 * S, endUs: 4 * S, text: 'Üç.', speaker: 2 },
    ];
    const applied = applyTranscriptTrack(opened(), cues, [], 'tr');
    expect(applied.ok && applied.report).toMatchObject({ imported: 2, skipped: [{ index: 1 }] });
    if (!applied.ok) return;
    expect(primaryCaptionTrack(applied.project)?.cues.map((cue) => [cue.cueId, cue.speaker])).toEqual([['q_001', 1], ['q_002', 2]]);
  });
});

describe('who spoke, on the result screen and in the text file', () => {
  const plainCues = [
    { cueId: 'q_001', startUs: 1 * S, endUs: 2 * S, text: 'Merhaba.' },
    { cueId: 'q_002', startUs: 2 * S, endUs: 3 * S, text: 'Nasılsın?' },
    { cueId: 'q_003', startUs: 4 * S, endUs: 5 * S, text: 'İyiyim.' },
    { cueId: 'q_004', startUs: 6 * S, endUs: 7 * S, text: 'Elle yazıldı.' },
    { cueId: 'q_005', startUs: 8 * S, endUs: 9 * S, text: 'Güzel.' },
  ];
  const unclear = [{ startUs: 10 * S, endUs: 11 * S }];
  /** The same lines with the voices the recipe stores on them (q_004 was typed by hand: none). */
  const voiced = (speakers: ReadonlyMap<string, number> | undefined) =>
    transcriptLines({ cues: plainCues.map((cue) => (speakers?.has(cue.cueId) ? { ...cue, speaker: speakers.get(cue.cueId) as number } : cue)), unclear });
  const speakers = new Map([['q_001', 1], ['q_002', 1], ['q_003', 2], ['q_005', 1]]);
  const lines = voiced(speakers);

  it('a voice is named where it changes, not on every line; a line without a voice names none', () => {
    expect([...speakerTurns(lines)]).toEqual([['q_001', 1], ['q_003', 2], ['q_005', 1]]);
  });

  it('one voice only, or none: nobody is named', () => {
    expect(speakerTurns(voiced(new Map([['q_001', 1], ['q_002', 1]]))).size).toBe(0);
    expect(speakerTurns(voiced(new Map())).size).toBe(0);
    expect(speakerTurns(voiced(undefined)).size).toBe(0);
  });

  it('the text file names the voice where it changes, and is unchanged without voices', () => {
    const turns = speakerTurns(lines);
    const label = (line: (typeof lines)[number]) => (turns.has(line.key) ? `${turns.get(line.key)}. kişi` : null);
    expect(transcriptText(lines, '(anlaşılamadı)', 'Başlık', label).split('\r\n')).toEqual([
      'Başlık',
      '',
      '[00:01] 1. kişi: Merhaba.',
      '[00:02] Nasılsın?',
      '[00:04] 2. kişi: İyiyim.',
      '[00:06] Elle yazıldı.',
      '[00:08] 1. kişi: Güzel.',
      '[00:10] (anlaşılamadı)',
      '',
    ]);
    expect(transcriptText(lines, '(anlaşılamadı)', 'Başlık')).toBe(transcriptText(lines, '(anlaşılamadı)', 'Başlık', () => null));
    expect(transcriptText(lines, '(anlaşılamadı)', 'Başlık')).not.toContain('kişi');
  });
});

describe('the invite code as typed', () => {
  it('is tidied into the shape the proxy issues, keeping its capitals; anything else is not a code', () => {
    expect(tidyInvite('ABCDE-FGHJK-MNPQR-STVWX')).toBe('ABCDE-FGHJK-MNPQR-STVWX');
    expect(tidyInvite('  abcde fghjk mnpqr stvwx ')).toBe('abcde-fghjk-mnpqr-stvwx');
    expect(tidyInvite('ABCDEFGHJKMNPQR2345a')).toBe('ABCDE-FGHJK-MNPQR-2345a');
    for (const bad of ['', 'merhaba', 'ABCDE-FGHJK-MNPQR', 'ABCDE-FGHJK-MNPQR-STVWX-YZ234', 'ABCDE-FGHJK-MNPQR-STV?X', '../../admin/spend?x=ABCDE']) expect(tidyInvite(bad), bad).toBeNull();
  });
});
