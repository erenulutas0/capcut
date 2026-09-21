import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEB_LOCAL_POLICY, exceedsTotalSourceBytes } from '@/domain/policy';
import { US_PER_SECOND } from '@/domain/time';
import { en, tr } from '@/i18n/messages';

const GIB = 1_073_741_824;
const MIB = 1_048_576;

const doc15 = readFileSync(
  join(__dirname, '..', '..', '..', 'video-editor-blueprint', 'docs', '15_PRICING_FREE_PRO.md'),
  'utf8',
);

describe('web local policy', () => {
  it('matches the canonical policy document (doc 15)', () => {
    const [docId] = WEB_LOCAL_POLICY.policyId.split('/');
    expect(doc15).toContain(`Politika kimliği: \`${docId}\``);

    const row = doc15.split(/\r?\n/).find((line) => line.startsWith('| Web yerel limitleri |'));
    expect(row).toBeDefined();
    const output = Number(/(\d+) dakika çıktı/.exec(row!)?.[1]);
    const input = Number(/(\d+) dakika video girdi/.exec(row!)?.[1]);
    const total = Number(/(\d+) GiB toplam/.exec(row!)?.[1]);

    expect(WEB_LOCAL_POLICY.maxOutputDurationUs).toBe(output * 60 * US_PER_SECOND);
    expect(WEB_LOCAL_POLICY.maxTotalSourceDurationUs).toBe(input * 60 * US_PER_SECOND);
    expect(WEB_LOCAL_POLICY.maxTotalSourceBytes).toBe(total * GIB);
  });

  it('tells the user the same numbers it enforces', () => {
    for (const locale of [tr, en]) {
      expect(locale['error.file_too_large']).toContain('2 GiB');
      expect(locale['error.total_too_large']).toContain('2 GiB');
      expect(locale['error.source_too_long']).toContain('60');
      expect(locale['error.music_too_large']).toContain(`${WEB_LOCAL_POLICY.maxMusicBytes / MIB} MiB`);
      expect(locale['error.music_too_long']).toContain(
        String(WEB_LOCAL_POLICY.maxMusicDurationUs / (60 * US_PER_SECOND)),
      );
    }
  });

  it('counts video and music together against the total', () => {
    const limit = WEB_LOCAL_POLICY.maxTotalSourceBytes;
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit, 0)).toBe(false);
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit, 1)).toBe(true);
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit - 50 * MIB, 50 * MIB)).toBe(false);
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit - 50 * MIB, 50 * MIB + 1)).toBe(true);
  });
});
