import { describe, expect, it } from 'vitest';

import { buildReport, type EnvironmentStage, type SourceStage } from '@/adapters/exportCapability';
import type { CapabilityStageResult } from '@/adapters/export/protocol';

/** ADR-022: an HDR source is exported only where the browser's conversion was verified. */
describe('capability gate: HDR sources', () => {
  const environment: EnvironmentStage = {
    secureContext: true,
    worker: true,
    videoEncoder: true,
    audioEncoder: true,
    videoDecoder: true,
    audioDecoder: true,
    offscreenCanvas: true,
  };
  const source = (transfer: 'pq' | 'hlg' | null): SourceStage => ({
    videoDecodable: true,
    audioDecodable: true,
    sourceVideoCodec: 'hevc',
    sourceAudioCodec: 'aac',
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 0,
    transfer: transfer === 'pq' ? 'pq' : transfer === 'hlg' ? 'hlg' : 'bt709',
    primaries: transfer ? 'bt2020' : 'bt709',
    isHdr: transfer !== null,
    hdrTransfer: transfer,
  });
  const encoder = (hdrToneMap: CapabilityStageResult['hdrToneMap']): CapabilityStageResult => ({
    videoConfigSupported: true,
    audioConfigSupported: true,
    selfTestPassed: true,
    selfTestDurationUs: 1_000_000,
    selfTestHasAudio: true,
    captionFont: null,
    hdrToneMap,
    failure: null,
  });

  it('exports an HDR source when the tone-mapping check was verified', () => {
    for (const transfer of ['pq', 'hlg'] as const) {
      const report = buildReport(environment, encoder('verified'), source(transfer));
      expect(report.canExport).toBe(true);
      expect(report.blockers).toEqual([]);
    }
  });

  it('refuses an HDR source when the check failed, had no API, or never ran', () => {
    for (const status of ['failed', 'api_missing', null] as const) {
      const report = buildReport(environment, encoder(status), source('pq'));
      expect(report.canExport).toBe(false);
      expect(report.blockers).toEqual(['hdr_source_unsupported']);
    }
  });

  it('ignores the check for an SDR source', () => {
    expect(buildReport(environment, encoder(null), source(null)).canExport).toBe(true);
    expect(buildReport(environment, encoder('failed'), source(null)).canExport).toBe(true);
  });
});
