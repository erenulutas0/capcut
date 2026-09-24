import { describe, expect, it } from 'vitest';

import { addCaptionCue, addClip, createEmptyProject, setVideoAsset } from '@/application/commands';
import { buildReport, type EnvironmentStage, type SourceStage } from '@/adapters/exportCapability';
import type { CapabilityStageResult } from '@/adapters/export/protocol';
import { cueIndexAtFrame, preflightCaptions } from '@/domain/captionBurnIn';
import type { MeasureText } from '@/domain/captionLayout';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan, type RenderCaption, type RenderCaptionPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';

const S = US_PER_SECOND;
const LF = String.fromCharCode(10);

/** Monospace stand-in for a font: every code point is 0.5 em wide. */
const mono: MeasureText = (text, fontPx) => Array.from(text).length * fontPx * 0.5;

function cue(cueId: string, startFrame: number, endFrame: number, text = 'metin'): RenderCaption {
  return { cueId, startFrame, endFrame, text };
}

describe('cueIndexAtFrame', () => {
  const cues = [cue('a', 15, 75), cue('b', 75, 90), cue('c', 105, 210)];

  it('finds the covering cue with half-open ranges', () => {
    expect(cueIndexAtFrame(cues, 14)).toBe(-1);
    expect(cueIndexAtFrame(cues, 15)).toBe(0);
    expect(cueIndexAtFrame(cues, 74)).toBe(0);
    // A cue ending where the next starts hands the frame over, never both.
    expect(cueIndexAtFrame(cues, 75)).toBe(1);
    expect(cueIndexAtFrame(cues, 89)).toBe(1);
    expect(cueIndexAtFrame(cues, 90)).toBe(-1);
    expect(cueIndexAtFrame(cues, 104)).toBe(-1);
    expect(cueIndexAtFrame(cues, 105)).toBe(2);
    expect(cueIndexAtFrame(cues, 209)).toBe(2);
    expect(cueIndexAtFrame(cues, 210)).toBe(-1);
  });

  it('agrees with a linear scan on every frame, and handles no cues', () => {
    const many = Array.from({ length: 50 }, (_, i) => cue(`q${i}`, i * 7, i * 7 + 1 + (i % 5)));
    for (let frame = -2; frame < 400; frame += 1) {
      const linear = many.findIndex((item) => item.startFrame <= frame && frame < item.endFrame);
      expect(cueIndexAtFrame(many, frame)).toBe(linear);
    }
    expect(cueIndexAtFrame([], 0)).toBe(-1);
  });
});

describe('preflightCaptions', () => {
  const frame = { width: 720, height: 1280, aspect: '9:16' as const };
  const plan = (cues: RenderCaption[]): RenderCaptionPlan => ({
    language: 'tr',
    style: { preset: 'box', position: 'bottom', size: 'medium' },
    cues,
  });

  it('lays out every cue exactly once, in cue order', () => {
    const result = preflightCaptions(
      plan([cue('a', 0, 10, 'Günaydın İstanbul'), cue('b', 20, 30, `Dağlar ışıl ışıl${LF}Şimdi başlıyoruz`)]),
      frame,
      mono,
    );
    if (!result.ok) throw new Error('did not fit');
    expect(result.layouts).toHaveLength(2);
    expect(result.layouts[0]?.lines.map((line) => line.text)).toEqual(['Günaydın İstanbul']);
    expect(result.layouts[1]?.lines.map((line) => line.text)).toEqual(['Dağlar ışıl ışıl', 'Şimdi başlıyoruz']);
  });

  it('names the first cue that would need a third line', () => {
    const long = 'kelime '.repeat(40).trim();
    const result = preflightCaptions(
      plan([cue('ok', 0, 10, 'kısa'), cue('too_long', 20, 30, long), cue('later', 40, 50, long)]),
      frame,
      mono,
    );
    expect(result).toEqual({ ok: false, reason: 'caption_does_not_fit', cueId: 'too_long', cueIndex: 1 });
  });
});

describe('render plan to burn-in frames', () => {
  const video: AssetV1 = {
    assetId: 'a_video_001',
    kind: 'video',
    durationUs: 20 * S,
    displayWidth: 720,
    displayHeight: 1280,
    hasAudio: true,
  };

  function project(): Project {
    let current = setVideoAsset(createEmptyProject(), video);
    for (const [from, to] of [
      [0, 4],
      [8, 14],
    ] as const) {
      const added = addClip(current, { sourceInUs: from * S, sourceOutUs: to * S });
      if (!added.ok) throw new Error(added.reason);
      current = added.project;
    }
    // Output lines (the joined download's clock): the frames follow the output.
    current = {
      ...current,
      captionTracks: [
        { trackId: 't_001', origin: 'manual', timeBase: 'output', language: 'tr', style: { preset: 'box', position: 'bottom', size: 'medium' }, cues: [] },
      ],
    };
    for (const [from, to, text] of [
      [0.5, 2.5, 'Günaydın İstanbul'],
      [3.5, 7, `Dağlar ışıl ışıl${LF}Şimdi başlıyoruz`],
    ] as const) {
      const added = addCaptionCue(current, { startUs: from * S, endUs: to * S, text });
      if (!added.ok) throw new Error(added.reason);
      current = added.project;
    }
    return current;
  }

  it('shows each cue on exactly the planned frames, across a moment boundary', () => {
    const compiled = compileRenderPlan(project(), WEB_LOCAL_POLICY);
    if (!compiled.ok || !compiled.plan.captions) throw new Error('no caption plan');
    const { cues } = compiled.plan.captions;
    // 30 fps grid: 0.5 s -> 15, 2.5 s -> 75, 3.5 s -> 105, 7 s -> 210.
    expect(cues.map((item) => [item.startFrame, item.endFrame])).toEqual([
      [15, 75],
      [105, 210],
    ]);
    const shown = Array.from({ length: compiled.plan.totalFrames }, (_, frame) => cueIndexAtFrame(cues, frame));
    expect(shown.filter((index) => index === 0)).toHaveLength(60);
    expect(shown.filter((index) => index === 1)).toHaveLength(105);
    expect(shown.indexOf(1)).toBe(105);
    expect(shown.lastIndexOf(1)).toBe(209);
  });
});

describe('capability gate and the caption font', () => {
  const environment: EnvironmentStage = {
    secureContext: true,
    worker: true,
    videoEncoder: true,
    audioEncoder: true,
    videoDecoder: true,
    audioDecoder: true,
    offscreenCanvas: true,
  };
  const source: SourceStage = {
    videoDecodable: true,
    audioDecodable: true,
    sourceVideoCodec: 'avc',
    sourceAudioCodec: 'aac',
    codedWidth: 720,
    codedHeight: 1280,
    rotation: 0,
    transfer: null,
    primaries: null,
    isHdr: false,
    hdrTransfer: null,
  };
  const encoder = (captionFont: CapabilityStageResult['captionFont']): CapabilityStageResult => ({
    videoConfigSupported: true,
    audioConfigSupported: true,
    selfTestPassed: true,
    selfTestDurationUs: 1_000_000,
    selfTestHasAudio: true,
    captionFont,
    hdrToneMap: null,
    failure: null,
  });

  it('passes when captions are not needed or the font loaded in the worker', () => {
    expect(buildReport(environment, encoder(null), source).canExport).toBe(true);
    expect(buildReport(environment, encoder('loaded'), source).canExport).toBe(true);
  });

  it('refuses clearly when the worker cannot load or lacks the font API', () => {
    for (const status of ['load_failed', 'api_missing'] as const) {
      const report = buildReport(environment, encoder(status), source);
      expect(report.canExport).toBe(false);
      expect(report.blockers).toEqual(['caption_font_unavailable']);
    }
  });
});
