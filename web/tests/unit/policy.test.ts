import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  WEB_LOCAL_POLICY,
  exceedsTotalSourceBytes,
  maxTimelineDurationUs,
  outputOverrun,
  outputRouteRefusal,
} from '@/domain/policy';
import { formatClock, US_PER_SECOND } from '@/domain/time';
import { overLimitText } from '@/components/editor/outputLimitText';
import { en, tr, type MessageKey } from '@/i18n/messages';

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
    // v4 row: "60 dakika çıktı (diske yazamayan tarayıcıda 5 dakika) / 120 dakika video girdi / 2 GiB toplam"
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
    // v4 (founder decision 2026-09-23): 120 minutes in, 60 minutes out, 2 GiB unchanged.
    expect(input).toBe(120);
    expect(output).toBe(60);
    expect(total).toBe(2);
  });

  it('records the v4 change with its evidence in doc 15, and keeps the v3 and v2 notes', () => {
    const [docId] = WEB_LOCAL_POLICY.policyId.split('/');
    expect(docId).toBe('2026-09-23.v4');
    const lines = doc15.split(/\r?\n/);
    const note = lines.find((line) => line.startsWith(`**Değişiklik \`${docId}\``));
    expect(note).toBeDefined();
    expect(note).toContain('ADR-021');
    expect(note).toContain('yalnızca genişleme');
    expect(note).toContain('ölçülmedi');
    for (const older of ['2026-09-22.v3', '2026-09-21.v2']) {
      expect(lines.some((line) => line.startsWith(`**Değişiklik \`${older}\``))).toBe(true);
    }
  });

  it('ADR-021: the timeline may be as long as the input limit, the output limit is a gate', () => {
    // An openable video always fits the timeline whole.
    expect(maxTimelineDurationUs(WEB_LOCAL_POLICY)).toBe(WEB_LOCAL_POLICY.maxTotalSourceDurationUs);
    expect(maxTimelineDurationUs(WEB_LOCAL_POLICY)).toBeGreaterThan(WEB_LOCAL_POLICY.maxOutputDurationUs);
    const limit = WEB_LOCAL_POLICY.maxOutputDurationUs;
    expect(outputOverrun(limit, limit)).toBeNull();
    expect(outputOverrun(limit - 1, limit)).toBeNull();
    expect(outputOverrun(limit + 1, limit)).toEqual({ totalUs: limit + 1, limitUs: limit, excessUs: 1 });
  });

  it('says how much to delete, rounded up, on both routes', () => {
    const minute = 60 * US_PER_SECOND;
    const over = outputOverrun(72.5 * minute, WEB_LOCAL_POLICY.maxOutputDurationUs);
    expect(over).not.toBeNull();
    const t = (key: MessageKey) => tr[key];
    const e = (key: MessageKey) => en[key];
    expect(overLimitText(t, over!)).toBe('Sonuç 1:12:30. İndirmek için en az 12:30 sil — sınır 60 dakika.');
    expect(overLimitText(e, over!)).toBe(
      'The result is 1:12:30. To download it, delete at least 12:30 — the limit is 60 minutes.',
    );
    // Half a second over: "delete at least 0:01", never "0:00".
    const hair = outputOverrun(60 * minute + 500_000, WEB_LOCAL_POLICY.maxOutputDurationUs);
    expect(overLimitText(t, hair!)).toBe('Sonuç 1:00:01. İndirmek için en az 0:01 sil — sınır 60 dakika.');
    // The memory route (5 minutes), same sentence.
    const memory = outputOverrun(7.5 * minute, WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs);
    expect(overLimitText(t, memory!)).toBe('Sonuç 7:30. İndirmek için en az 2:30 sil — sınır 5 dakika.');
    expect(formatClock(2 * 60 * minute)).toBe('2:00:00');
  });

  it('tells the user the same numbers it enforces', () => {
    for (const locale of [tr, en]) {
      expect(locale['error.file_too_large']).toContain('2 GiB');
      expect(locale['error.total_too_large']).toContain('2 GiB');
      expect(locale['error.source_too_long']).toContain(
        String(WEB_LOCAL_POLICY.maxTotalSourceDurationUs / (60 * US_PER_SECOND)),
      );
      expect(locale['error.timeline_duration_exceeds_policy']).toContain(
        String(maxTimelineDurationUs(WEB_LOCAL_POLICY) / (60 * US_PER_SECOND)),
      );
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
      for (const key of ['export.plan.output_duration_exceeds_policy'] as const) {
        expect(locale[key]).toContain(`${outputMin} ${minutes}`);
      }
      const inputMin = String(WEB_LOCAL_POLICY.maxTotalSourceDurationUs / (60 * US_PER_SECOND));
      expect(locale['help.limit.length']).toContain(`${inputMin} ${minutes}`);
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
