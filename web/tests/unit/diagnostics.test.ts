import { describe, expect, it } from 'vitest';

import { addCaptionCue, addClip, createEmptyProject, setVideoAsset } from '@/application/commands';
import {
  DIAGNOSTICS_KIND,
  buildDiagnostics,
  diagnosticsFileName,
  type DiagnosticsInput,
} from '@/domain/diagnostics';
import type { AssetV1, Project } from '@/domain/edl';
import { bindingFor, createRecord } from '@/domain/projectRecord';
import { US_PER_SECOND } from '@/domain/time';

const S = US_PER_SECOND;

/** Things that must never appear in a diagnostics file. */
const FILE_NAME = 'aile-tatili-antalya-2025.mp4';
const MUSIC_NAME = 'dugun-sarkisi.m4a';
const TITLE = 'Ayşe ile gizli proje';
const CAPTION_A = 'Doğum günün kutlu olsun Mehmet';
const CAPTION_B = 'Adresimiz Bağdat Caddesi 12';

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 20 * S,
  displayWidth: 1280,
  displayHeight: 720,
  hasAudio: true,
};

function projectWithPrivateContent(): Project {
  let current = setVideoAsset(createEmptyProject(), video);
  for (const [from, to] of [
    [0, 4],
    [8, 14],
  ] as const) {
    const added = addClip(current, { sourceInUs: from * S, sourceOutUs: to * S });
    if (!added.ok) throw new Error(added.reason);
    current = added.project;
  }
  for (const [from, to, text] of [
    [0.5, 2.5, CAPTION_A],
    [3.5, 7, CAPTION_B],
  ] as const) {
    const added = addCaptionCue(current, { startUs: from * S, endUs: to * S, text });
    if (!added.ok) throw new Error(added.reason);
    current = added.project;
  }
  return current;
}

function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  const project = projectWithPrivateContent();
  // A full record, as the editor holds it: title and file names included.
  // The builder is handed MORE than it may use, on purpose.
  const record = createRecord(project.projectId, TITLE, project, [
    bindingFor('a_video_001', 'video', { name: FILE_NAME, size: 1234, lastModified: 1, type: 'video/mp4' }, {
      durationUs: 20 * S,
    }),
  ]);
  const smuggled = { ...record.edl, title: TITLE, fileName: FILE_NAME, bindings: record.bindings } as Project;

  return {
    now: new Date('2026-09-22T10:15:00Z'),
    app: { version: '0.1.0', commit: 'abc123def456' },
    browser: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140',
      platform: 'Windows',
      language: 'tr-TR',
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      // Not part of the contract: must be dropped.
      ...({ lastOpenedFile: FILE_NAME } as object),
    },
    screen: { width: 1920, height: 1080, devicePixelRatio: 1, viewportWidth: 1440, viewportHeight: 900 },
    features: {
      secureContext: true,
      crossOriginIsolated: false,
      worker: true,
      offscreenCanvas: true,
      videoEncoder: true,
      audioEncoder: true,
      videoDecoder: true,
      audioDecoder: true,
      opfs: true,
      webGpu: false,
      indexedDb: true,
    },
    storage: { quotaBytes: 10 * 1024 * 1024 * 1024, usageBytes: 5 * 1024 * 1024 },
    capability: {
      at: '2026-09-22T10:10:00Z',
      environmentPassed: true,
      videoConfigSupported: true,
      audioConfigSupported: true,
      selfTestPassed: true,
      captionFont: 'loaded',
      sourceVideoDecodable: true,
      sourceAudioDecodable: true,
      sourceVideoCodec: 'avc',
      sourceAudioCodec: 'aac',
      sourceIsHdr: false,
      blockers: ['caption_does_not_fit', FILE_NAME],
    },
    project: smuggled,
    exportLog: [
      {
        at: '2026-09-22T10:12:00Z',
        outcome: 'failed',
        failureCode: 'caption_does_not_fit',
        outputDurationMs: 10_000,
        width: 1280,
        height: 720,
        route: null,
        elapsedMs: 900,
        planPrefix: 'fp_1a2b3c',
        // A row written by some other build must not carry these through.
        fileName: FILE_NAME,
        captionText: CAPTION_A,
      },
    ],
    sessionErrors: [
      { at: '2026-09-22T10:11:00Z', area: 'media', code: 'unsupported_preview' },
      { at: '2026-09-22T10:11:30Z', area: 'media', code: FILE_NAME },
      { at: '2026-09-22T10:11:40Z', area: 'export', code: CAPTION_B },
      { at: '2026-09-22T10:11:50Z', area: 'not_an_area', code: 'internal_error' },
    ],
    ...overrides,
  };
}

describe('buildDiagnostics', () => {
  it('never carries file names, the project title or caption text', () => {
    const json = JSON.stringify(buildDiagnostics(input()));
    for (const secret of [FILE_NAME, MUSIC_NAME, TITLE, CAPTION_A, CAPTION_B, 'Mehmet', 'Bağdat', 'antalya']) {
      expect(json).not.toContain(secret);
    }
    // Nor the ids that link the file to a backup or a recipe.
    expect(json).not.toContain('p_local_001');
    expect(json).not.toContain('a_video_001');
  });

  it('keeps only the allowed fields, as numbers, booleans and codes', () => {
    const report = buildDiagnostics(input());
    expect(report.kind).toBe(DIAGNOSTICS_KIND);
    expect(report.createdAt).toBe('2026-09-22T10:15:00.000Z');
    expect(report.app).toEqual({ version: '0.1.0', commit: 'abc123def456' });
    expect(Object.keys(report.browser).sort()).toEqual(
      ['deviceMemoryGb', 'hardwareConcurrency', 'language', 'platform', 'userAgent'].sort(),
    );
    expect(report.project).toEqual({
      clipCount: 2,
      captionLineCount: 2,
      hasMusic: false,
      aspect: '16:9',
      shortEdge: 1080,
      outputDurationMs: 10_000,
    });
    expect(report.storage).toEqual({ quotaMb: 10_240, usageMb: 5 });
    expect(report.capabilityGate?.blockers).toEqual(['caption_does_not_fit']);
    expect(report.exportLog).toHaveLength(1);
    expect(Object.keys(report.exportLog[0] ?? {}).sort()).toEqual(
      ['at', 'elapsedMs', 'failureCode', 'height', 'outcome', 'outputDurationMs', 'planPrefix', 'route', 'width'].sort(),
    );
    expect(report.sessionErrors).toEqual([
      { at: '2026-09-22T10:11:00.000Z', area: 'media', code: 'unsupported_preview' },
    ]);
  });

  it('reports "not run" honestly instead of inventing a gate result', () => {
    const report = buildDiagnostics(input({ capability: null, project: null, storage: null }));
    expect(report.capabilityGate).toBeNull();
    expect(report.project).toBeNull();
    expect(report.storage).toBeNull();
  });

  it('bounds browser strings so an odd user agent cannot bloat the file', () => {
    const base = input();
    const report = buildDiagnostics({ ...base, browser: { ...base.browser, userAgent: 'x'.repeat(5000) } });
    expect(report.browser.userAgent.length).toBe(300);
  });
});

describe('diagnosticsFileName', () => {
  it('names the file by date only', () => {
    const name = diagnosticsFileName(new Date(2026, 8, 22, 9, 5));
    expect(name).toBe('clip-tani-20260922-0905.json');
  });
});
