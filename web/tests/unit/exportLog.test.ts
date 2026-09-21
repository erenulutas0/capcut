import { describe, expect, it } from 'vitest';

import { addCaptionCue, addClip, createEmptyProject, setVideoAsset } from '@/application/commands';
import { createExportLog, type ExportLogBackend } from '@/adapters/exportLogStore';
import { EXPORT_LOG_STORE, PROJECTS_STORE, upgradeSchema, type UpgradeTarget } from '@/adapters/localDb';
import {
  EXPORT_LOG_LIMIT,
  exportLogEntry,
  planPrefix,
  sanitizeExportLogEntry,
  type ExportLogEntry,
} from '@/domain/exportLog';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan, type RenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';

const S = US_PER_SECOND;
const CAPTION = 'Kimse görmesin bu satırı';

function plan(): RenderPlan {
  let project = setVideoAsset(createEmptyProject(), {
    assetId: 'a_video_001',
    kind: 'video',
    durationUs: 20 * S,
    displayWidth: 1280,
    displayHeight: 720,
    hasAudio: true,
  });
  const clip = addClip(project, { sourceInUs: 0, sourceOutUs: 3 * S });
  if (!clip.ok) throw new Error(clip.reason);
  project = clip.project;
  const cue = addCaptionCue(project, { startUs: 0, endUs: 2 * S, text: CAPTION });
  if (!cue.ok) throw new Error(cue.reason);
  const compiled = compileRenderPlan(cue.project, WEB_LOCAL_POLICY);
  if (!compiled.ok) throw new Error(compiled.reason);
  return compiled.plan;
}

/** In-memory stand-in for the IndexedDB store: same auto-increment keys. */
function memoryBackend(): ExportLogBackend & { rows: Map<number, unknown> } {
  const rows = new Map<number, unknown>();
  let next = 1;
  return {
    rows,
    async add(entry) {
      rows.set(next, { ...entry, id: next });
      next += 1;
    },
    async keys() {
      return [...rows.keys()].sort((a, b) => a - b);
    },
    async remove(keys) {
      for (const key of keys) rows.delete(key);
    },
    async all() {
      return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
    },
    async clear() {
      rows.clear();
    },
  };
}

function entry(index: number): ExportLogEntry {
  return {
    at: new Date(Date.UTC(2026, 8, 22, 10, index)).toISOString(),
    outcome: 'succeeded',
    failureCode: null,
    outputDurationMs: 3000,
    width: 1280,
    height: 720,
    route: 'opfs',
    elapsedMs: 100 + index,
    planPrefix: 'fp_12ab34',
  };
}

describe('exportLogEntry', () => {
  it('holds numbers and codes from the plan and the outcome, never text', () => {
    const recipe = plan();
    const failed = exportLogEntry(recipe, { outcome: 'failed', code: 'caption_does_not_fit' }, 812.4, new Date(0));
    expect(failed).toEqual({
      at: '1970-01-01T00:00:00.000Z',
      outcome: 'failed',
      failureCode: 'caption_does_not_fit',
      outputDurationMs: Math.round(recipe.expectedDurationUs / 1000),
      width: recipe.width,
      height: recipe.height,
      route: null,
      elapsedMs: 812,
      planPrefix: recipe.fingerprint.slice(0, 9),
    });
    expect(JSON.stringify(failed)).not.toContain(CAPTION);
  });

  it('takes duration, size and route from the produced file when it succeeded', () => {
    const recipe = plan();
    const ok = exportLogEntry(
      recipe,
      { outcome: 'succeeded', measuredDurationUs: 3_033_333, width: 1280, height: 720, route: 'memory' },
      1500,
      new Date(0),
    );
    expect(ok.outputDurationMs).toBe(3033);
    expect(ok.route).toBe('memory');
    expect(ok.failureCode).toBeNull();
  });

  it('keeps only a short fingerprint prefix', () => {
    expect(planPrefix('fp_0123abcd')).toBe('fp_0123ab');
    expect(planPrefix('not a fingerprint')).toBe('fp_');
  });
});

describe('sanitizeExportLogEntry', () => {
  it('copies only known fields and refuses free text in codes', () => {
    const clean = sanitizeExportLogEntry({
      ...entry(1),
      outcome: 'failed',
      failureCode: 'tatil.mp4',
      fileName: 'tatil.mp4',
      id: 7,
    });
    expect(clean).not.toBeNull();
    expect(clean?.failureCode).toBeNull();
    expect(JSON.stringify(clean)).not.toContain('tatil');
    expect(Object.keys(clean ?? {})).not.toContain('id');
  });

  it('rejects rows that are not entries', () => {
    expect(sanitizeExportLogEntry(null)).toBeNull();
    expect(sanitizeExportLogEntry({ ...entry(1), outcome: 'exploded' })).toBeNull();
    expect(sanitizeExportLogEntry({ ...entry(1), at: 'yesterday' })).toBeNull();
    expect(sanitizeExportLogEntry({ ...entry(1), width: '1280' })).toBeNull();
  });
});

describe('export log store', () => {
  it(`keeps at most ${EXPORT_LOG_LIMIT} attempts, dropping the oldest`, async () => {
    const backend = memoryBackend();
    const log = createExportLog(backend);
    for (let index = 0; index < 25; index += 1) {
      expect(await log.append(entry(index))).toBe(true);
    }
    expect(backend.rows.size).toBe(EXPORT_LOG_LIMIT);
    const entries = await log.read();
    expect(entries).toHaveLength(EXPORT_LOG_LIMIT);
    expect(entries[0]?.elapsedMs).toBe(105);
    expect(entries[entries.length - 1]?.elapsedMs).toBe(124);
  });

  it('clears everything', async () => {
    const backend = memoryBackend();
    const log = createExportLog(backend);
    await log.append(entry(1));
    await log.append(entry(2));
    expect(await log.clear()).toBe(true);
    expect(await log.read()).toEqual([]);
    expect(backend.rows.size).toBe(0);
  });

  it('never throws into the export: a refusing backend reports false / empty', async () => {
    const broken: ExportLogBackend = {
      add: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      keys: () => Promise.reject(new Error('x')),
      remove: () => Promise.reject(new Error('x')),
      all: () => Promise.reject(new Error('x')),
      clear: () => Promise.reject(new Error('x')),
    };
    const log = createExportLog(broken);
    expect(await log.append(entry(1))).toBe(false);
    expect(await log.read()).toEqual([]);
    expect(await log.clear()).toBe(false);
  });
});

describe('database upgrade', () => {
  function fakeDb(existing: string[]): UpgradeTarget & { created: string[] } {
    const names = new Set(existing);
    const created: string[] = [];
    return {
      created,
      objectStoreNames: { contains: (name) => names.has(name) },
      createObjectStore: (name) => {
        if (names.has(name)) throw new Error(`ConstraintError: ${name} exists`);
        names.add(name);
        created.push(name);
        return {};
      },
    };
  }

  it('adds the export log to a v1 database without touching projects', () => {
    const db = fakeDb([PROJECTS_STORE]);
    upgradeSchema(db);
    expect(db.created).toEqual([EXPORT_LOG_STORE]);
  });

  it('creates both stores on a fresh database and is safe to run twice', () => {
    const db = fakeDb([]);
    upgradeSchema(db);
    upgradeSchema(db);
    expect(db.created).toEqual([PROJECTS_STORE, EXPORT_LOG_STORE]);
  });
});
