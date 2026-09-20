import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { issueCodes, validateProject } from '@/domain/validation';

const FIXTURE_ROOT = join(process.cwd(), 'fixtures', 'edl');

interface Manifest {
  valid: Array<{ file: string }>;
  invalid: Array<{ file: string; expectedIssueCodes: string[] }>;
}

const manifest: Manifest = JSON.parse(
  readFileSync(join(FIXTURE_ROOT, 'manifest.json'), 'utf8'),
);

function load(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, file), 'utf8'));
}

describe('EDL v1 shared fixtures', () => {
  it('manifest covers every file on disk', () => {
    const onDisk = [
      ...readdirSync(join(FIXTURE_ROOT, 'valid')).map((f) => `valid/${f}`),
      ...readdirSync(join(FIXTURE_ROOT, 'invalid')).map((f) => `invalid/${f}`),
    ].sort();
    const listed = [
      ...manifest.valid.map((entry) => entry.file),
      ...manifest.invalid.map((entry) => entry.file),
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
});
