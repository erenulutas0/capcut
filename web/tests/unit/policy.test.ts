import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEB_LOCAL_POLICY, exceedsTotalSourceBytes, outputRouteRefusal } from '@/domain/policy';
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
    // v3 row: "60 dakika çıktı (diske yazamayan tarayıcıda 5 dakika) / 60 dakika video girdi / 2 GiB toplam"
    const output = Number(/\| (\d+) dakika çıktı \(/.exec(row!)?.[1]);
    const memoryRoute = Number(/\(diske yazamayan tarayıcıda (\d+) dakika\)/.exec(row!)?.[1]);
    const input = Number(/\/ (\d+) dakika video girdi \//.exec(row!)?.[1]);
    const total = Number(/\/ (\d+) GiB toplam \|/.exec(row!)?.[1]);

    expect(WEB_LOCAL_POLICY.maxOutputDurationUs).toBe(output * 60 * US_PER_SECOND);
    expect(WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs).toBe(memoryRoute * 60 * US_PER_SECOND);
    expect(WEB_LOCAL_POLICY.maxTotalSourceDurationUs).toBe(input * 60 * US_PER_SECOND);
    expect(WEB_LOCAL_POLICY.maxTotalSourceBytes).toBe(total * GIB);
    // Every number parsed: a reworded row must fail here, not pass as NaN.
    for (const value of [output, memoryRoute, input, total]) expect(Number.isInteger(value)).toBe(true);
    // The memory route is the tighter one, never the other way round.
    expect(WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs).toBeLessThan(WEB_LOCAL_POLICY.maxOutputDurationUs);
  });

  it('records the v3 change with its evidence in doc 15', () => {
    const [docId] = WEB_LOCAL_POLICY.policyId.split('/');
    const note = doc15.split(/\r?\n/).find((line) => line.startsWith(`**Değişiklik \`${docId}\``));
    expect(note).toBeDefined();
    expect(note).toContain('ADR-020');
    expect(note).toContain('yalnızca genişleme');
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
    const outputMin = String(WEB_LOCAL_POLICY.maxOutputDurationUs / (60 * US_PER_SECOND));
    const memoryMin = String(WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs / (60 * US_PER_SECOND));
    for (const [locale, minutes] of [
      [tr, 'dakika'],
      [en, 'minutes'],
    ] as const) {
      for (const key of [
        'error.output_duration_exceeds_policy',
        'export.plan.output_duration_exceeds_policy',
        'timeline.addFirst',
        'timeline.tooLongTitle',
        'timeline.notice.addedFirst',
      ] as const) {
        expect(locale[key]).toContain(`${outputMin} ${minutes}`);
      }
      expect(locale['export.fail.output_too_long_for_memory']).toContain(` ${memoryMin} `);
      expect(locale['export.fail.output_storage_insufficient']).toContain(` ${memoryMin} `);
      expect(locale['help.limit.length']).toContain(`${outputMin} ${minutes}`);
      expect(locale['help.limit.length']).toContain(` ${memoryMin} `);
    }
    // The founder's wording for the refusal on the memory route.
    expect(tr['export.fail.output_too_long_for_memory']).toContain(
      'Bu tarayıcı videoyu diske yazamıyor; burada en fazla 5 dakikalık video indirilebilir.',
    );
  });

  it('memory route: up to 5 minutes, longer outputs refused with the reason', () => {
    const cap = WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs;
    expect(cap).toBe(5 * 60 * US_PER_SECOND);
    // The disk route is never limited here; the 60-minute plan limit applies.
    expect(outputRouteRefusal(WEB_LOCAL_POLICY, 'opfs', WEB_LOCAL_POLICY.maxOutputDurationUs)).toBeNull();
    // Short outputs keep the proven memory fallback.
    expect(outputRouteRefusal(WEB_LOCAL_POLICY, 'no_disk_access', cap)).toBeNull();
    expect(outputRouteRefusal(WEB_LOCAL_POLICY, 'not_enough_space', cap)).toBeNull();
    // One microsecond over: refused, with the reason the user can act on.
    expect(outputRouteRefusal(WEB_LOCAL_POLICY, 'no_disk_access', cap + 1)).toBe('output_too_long_for_memory');
    expect(outputRouteRefusal(WEB_LOCAL_POLICY, 'not_enough_space', cap + 1)).toBe('output_storage_insufficient');
  });

  it('counts video and music together against the total', () => {
    const limit = WEB_LOCAL_POLICY.maxTotalSourceBytes;
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit, 0)).toBe(false);
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit, 1)).toBe(true);
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit - 50 * MIB, 50 * MIB)).toBe(false);
    expect(exceedsTotalSourceBytes(WEB_LOCAL_POLICY, limit - 50 * MIB, 50 * MIB + 1)).toBe(true);
  });
});
