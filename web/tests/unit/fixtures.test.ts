import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadProject } from '@/domain/migration';
import { issueCodes, validateProject } from '@/domain/validation';

const FIXTURE_ROOT = join(process.cwd(), 'fixtures', 'edl');

interface Manifest {
  valid: Array<{ file: string }>;
  invalid: Array<{ file: string; expectedIssueCodes: string[] }>;
  legacy: Array<{ file: string; expect: 'valid' | 'invalid' }>;
}

const manifest: Manifest = JSON.parse(
  readFileSync(join(FIXTURE_ROOT, 'manifest.json'), 'utf8'),
);

function load(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, file), 'utf8'));
}

describe('EDL v2 shared fixtures', () => {
  it('manifest covers every file on disk', () => {
    const onDisk = [
      ...readdirSync(join(FIXTURE_ROOT, 'valid')).map((f) => `valid/${f}`),
      ...readdirSync(join(FIXTURE_ROOT, 'invalid')).map((f) => `invalid/${f}`),
      ...readdirSync(join(FIXTURE_ROOT, 'legacy-v1')).map((f) => `legacy-v1/${f}`),
    ].sort();
    const listed = [
      ...manifest.valid.map((entry) => entry.file),
      ...manifest.invalid.map((entry) => entry.file),
      ...manifest.legacy.map((entry) => entry.file),
    ].sort();
    expect(listed).toEqual(onDisk);
  });

  it.each(manifest.valid.map((entry) => entry.file))('accepts %s', (file) => {
    const result = validateProject(load(file));
    if (!result.ok) {
      throw new Error(`${file} should be valid, got: ${JSON.stringify(result.issues)}`);
    }
    expect(result.ok).toBe(true);
  });

  it.each(manifest.invalid.map((entry) => [entry.file, entry.expectedIssueCodes] as const))(
    'rejects %s',
    (file, expectedCodes) => {
      const result = validateProject(load(file));
      expect(result.ok).toBe(false);
      const codes = issueCodes(result);
      for (const expected of expectedCodes) {
        expect(codes).toContain(expected);
      }
    },
  );

  // v1 recipes from older builds: the validator refuses them as they are,
  // and the loader upgrades them without losing anything.
  it.each(manifest.legacy.map((entry) => [entry.file, entry.expect] as const))(
    'migrates %s -> %s',
    (file, verdict) => {
      const raw = load(file);
      expect(validateProject(raw).ok).toBe(false);
      const result = loadProject(raw);
      expect(result.ok).toBe(verdict === 'valid');
      if (result.ok) {
        expect(result.project.schemaVersion).toBe(2);
        expect(result.project.captionTracks).toEqual([]);
        const { schemaVersion: _a, captionTracks: _b, ...before } = raw as Record<string, unknown>;
        const { schemaVersion: _c, captionTracks: _d, ...after } = result.project as unknown as Record<string, unknown>;
        expect(after).toEqual(before);
      }
    },
  );
});
