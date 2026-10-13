import { describe, expect, it } from 'vitest';

import { addClip, createEmptyProject, setMusicAsset, setVideoAsset } from '@/application/commands';
import { buildReport, probeConfigFromPlan, type EnvironmentStage, type SourceStage } from '@/adapters/exportCapability';
import type { CapabilityStageResult } from '@/adapters/export/protocol';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';

/**
 * A download without any sound does not need an audio encoder (13 Oct 2026:
 * Firefox has no AAC encoder, and "Sesi kapat" — whose file has no sound —
 * was refused with "AAC kodlama desteklenmiyor"). The gate asks for the audio
 * encoder only when the file will contain sound; everything else is as strict
 * as before.
 */
describe('capability gate: a download without sound', () => {
  const video: AssetV1 = { assetId: 'a_video_001', kind: 'video', durationUs: 24 * US_PER_SECOND, displayWidth: 1280, displayHeight: 720, hasAudio: true };
  const music: AssetV1 = { assetId: 'a_music_001', kind: 'audio', durationUs: 30 * US_PER_SECOND };

  function plan(project: Project) {
    const result = compileRenderPlan(project, WEB_LOCAL_POLICY);
    if (!result.ok) throw new Error(result.reason);
    return result.plan;
  }
  function withClip(muted: boolean): Project {
    const added = addClip(setVideoAsset(createEmptyProject(), video), { sourceInUs: 0, sourceOutUs: 4 * US_PER_SECOND });
    if (!added.ok) throw new Error(added.reason);
    const project = added.project;
    return { ...project, clips: project.clips.map((clip) => ({ ...clip, muted })) };
  }

  it('asks for the audio encoder exactly when the file will have sound', () => {
    expect(probeConfigFromPlan(plan(withClip(false))).audioRequired).toBe(true);
    expect(probeConfigFromPlan(plan(withClip(true))).audioRequired).toBe(false);
    // Muted video, but music is laid under it: sound again.
    expect(probeConfigFromPlan(plan(setMusicAsset(withClip(true), music))).audioRequired).toBe(true);
  });

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
    codedWidth: 1280,
    codedHeight: 720,
    rotation: 0,
    transfer: 'bt709',
    primaries: 'bt709',
    isHdr: false,
    hdrTransfer: null,
  };
  /** What a browser without an AAC encoder answers (Firefox, measured). */
  const noAac = (extra: Partial<CapabilityStageResult>): CapabilityStageResult => ({
    videoConfigSupported: true,
    audioConfigSupported: false,
    selfTestPassed: false,
    selfTestDurationUs: null,
    selfTestHasAudio: false,
    captionFont: null,
    hdrToneMap: null,
    failure: 'audio_encoder_unsupported',
    ...extra,
  });

  it('no audio encoder + a file with sound: refused, as before', () => {
    for (const encoder of [noAac({}), noAac({ audioRequired: true })]) {
      const report = buildReport(environment, encoder, source);
      expect(report.canExport).toBe(false);
      expect(report.blockers).toEqual(['audio_encoder_unsupported']);
    }
  });

  it('no audio encoder + a file without sound: allowed once the silent self-test really passed', () => {
    const passed = noAac({ audioRequired: false, selfTestPassed: true, selfTestDurationUs: 1_000_000, failure: null });
    const report = buildReport(environment, passed, source);
    expect(report.blockers).toEqual([]);
    expect(report.canExport).toBe(true);
  });

  it('a silent download is still refused when its own self-test did not pass', () => {
    const failed = noAac({ audioRequired: false, selfTestPassed: false, failure: 'output_probe_failed' });
    const report = buildReport(environment, failed, source);
    expect(report.canExport).toBe(false);
    expect(report.blockers).toEqual(['output_probe_failed']);
  });

  it('a silent download still needs the video encoder', () => {
    const report = buildReport(environment, noAac({ audioRequired: false, videoConfigSupported: false, failure: 'video_encoder_unsupported' }), source);
    expect(report.canExport).toBe(false);
    expect(report.blockers).toEqual(['video_encoder_unsupported']);
  });
});
