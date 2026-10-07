import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVEL } from '@/domain/levelNormalise';
import { CONVERSATION_VAD, DEFAULT_VAD } from '@/domain/speechSpans';
import { COVERAGE_NOTE_FROM, transcriptCoverage } from '@/domain/transcript';
import { RECOMMENDED_MODEL, downloadBytes, preselectedModel } from '@/domain/transcriptModels';
import { ENGINE_SETTINGS, ENGINE_SETTINGS_2026_10_05, settingsFromProbe } from '@/domain/transcriptSettings';

const S = 1_000_000;

describe('how much of the found speech was written', () => {
  it('says nothing when everything, or all but a little, was written', () => {
    expect(transcriptCoverage({ speechUs: 600 * S, unclearUs: 0, unclearSpans: 0 })).toEqual({ writtenPercent: 100, unclearCount: 0, worthSaying: false });
    // 5 % left out: counted, not announced.
    expect(transcriptCoverage({ speechUs: 600 * S, unclearUs: 30 * S, unclearSpans: 4 })).toEqual({ writtenPercent: 95, unclearCount: 4, worthSaying: false });
  });

  it('says so plainly from a tenth of the speech left unwritten', () => {
    expect(COVERAGE_NOTE_FROM).toBe(0.1);
    expect(transcriptCoverage({ speechUs: 600 * S, unclearUs: 60 * S, unclearSpans: 7 })).toEqual({ writtenPercent: 90, unclearCount: 7, worthSaying: true });
    expect(transcriptCoverage({ speechUs: 1000 * S, unclearUs: 437 * S, unclearSpans: 95 })).toEqual({ writtenPercent: 56, unclearCount: 95, worthSaying: true });
  });

  it('rounds down: never "100" with something missing, never more than was written', () => {
    expect(transcriptCoverage({ speechUs: 1000 * S, unclearUs: 1, unclearSpans: 1 }).writtenPercent).toBe(99);
    expect(transcriptCoverage({ speechUs: 3 * S, unclearUs: 1 * S, unclearSpans: 1 })).toEqual({ writtenPercent: 66, unclearCount: 1, worthSaying: true });
  });

  it('is nothing but zeros for a run that found no speech, and survives odd numbers', () => {
    expect(transcriptCoverage({ speechUs: 0, unclearUs: 0, unclearSpans: 0 })).toEqual({ writtenPercent: 0, unclearCount: 0, worthSaying: false });
    expect(transcriptCoverage({ speechUs: 10 * S, unclearUs: 50 * S, unclearSpans: 2 })).toEqual({ writtenPercent: 0, unclearCount: 2, worthSaying: true });
    expect(transcriptCoverage({ speechUs: 10 * S, unclearUs: -5, unclearSpans: 0 }).writtenPercent).toBe(100);
  });
});

describe('which model is selected to begin with', () => {
  it('recommends the large model, whose real download is about 596 MB', () => {
    expect(RECOMMENDED_MODEL).toBe('turbo');
    expect(downloadBytes('turbo')).toBe(595_564_916);
    expect(downloadBytes('base')).toBe(108_845_826);
  });

  it('is the small model wherever the large one cannot run, whatever is stored', () => {
    for (const baseReady of [false, true]) {
      for (const turboReady of [false, true]) {
        expect(preselectedModel({ largeSupported: false, baseReady, turboReady })).toBe('base');
      }
    }
  });

  it('is the large model where it can run and nothing is here yet, or it is here already', () => {
    expect(preselectedModel({ largeSupported: true, baseReady: false, turboReady: false })).toBe('turbo');
    expect(preselectedModel({ largeSupported: true, baseReady: false, turboReady: true })).toBe('turbo');
    expect(preselectedModel({ largeSupported: true, baseReady: true, turboReady: true })).toBe('turbo');
  });

  it('stays on the small model when only that one is in this browser: no 596 MB download behind the first button', () => {
    expect(preselectedModel({ largeSupported: true, baseReady: true, turboReady: false })).toBe('base');
  });
});

describe('the recogniser\'s settings: what shipped on 5 Oct, and today', () => {
  it('keeps the 5 Oct set exactly as it shipped (the "before" of every before/after table)', () => {
    expect(ENGINE_SETTINGS_2026_10_05).toEqual({ level: null, vad: DEFAULT_VAD, secondLook: null });
  });

  it('runs today what was frozen on the development set on 7 Oct (a change here needs a new measurement)', () => {
    expect(ENGINE_SETTINGS).toEqual({
      level: { blockS: 0.05, backS: 0.3, aheadS: 1.5, targetDb: -20, maxGainDb: 40, minContrastDb: 20 },
      vad: { threshold: 0.5, negThreshold: 0.35, minSpeechS: 0.25, minSilenceS: 1.2, padS: 0.4 },
      secondLook: { splitMinS: 2, maxDepth: 2 },
    });
    expect(ENGINE_SETTINGS.level).toEqual(DEFAULT_LEVEL);
    expect(ENGINE_SETTINGS.vad).toEqual(CONVERSATION_VAD);
  });

  it('runs the shipped set unless a measuring script asks otherwise, and ignores anything malformed', () => {
    expect(settingsFromProbe(undefined)).toBe(ENGINE_SETTINGS);
    expect(settingsFromProbe({})).toEqual(ENGINE_SETTINGS);
    expect(settingsFromProbe({ base: '2026-10-05' })).toEqual(ENGINE_SETTINGS_2026_10_05);
    expect(settingsFromProbe({ base: 'nonsense' as never })).toEqual(ENGINE_SETTINGS);
    expect(settingsFromProbe('x' as never)).toBe(ENGINE_SETTINGS);
    expect(settingsFromProbe({ settings: 7 as never })).toEqual(ENGINE_SETTINGS);
  });

  it('lets a measurement change one thing at a time over a named set', () => {
    const levelOnly = settingsFromProbe({ base: '2026-10-05', settings: { level: { ...DEFAULT_LEVEL, maxGainDb: 30 } } });
    expect(levelOnly.level).toEqual({ ...DEFAULT_LEVEL, maxGainDb: 30 });
    expect(levelOnly.vad).toEqual(DEFAULT_VAD);
    expect(levelOnly.secondLook).toBeNull();
    const noLevel = settingsFromProbe({ settings: { level: null } });
    expect(noLevel.level).toBeNull();
    expect(noLevel.vad).toEqual(ENGINE_SETTINGS.vad);
    const wider = settingsFromProbe({ base: '2026-10-05', settings: { vad: { ...DEFAULT_VAD, padS: 0.4 } } });
    expect(wider.vad).toEqual({ ...DEFAULT_VAD, padS: 0.4 });
    expect(wider.level).toBeNull();
  });
});
