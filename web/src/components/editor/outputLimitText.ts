import type { OutputOverrun } from '@/domain/policy';
import { formatClock, US_PER_SECOND } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

/**
 * The export gate's sentence (ADR-021), the same on the timeline and in the
 * download dialog: "Sonuç 1:12:30. İndirmek için en az 12:30 sil — sınır 60
 * dakika." Both clocks round up, so deleting the amount said is enough.
 */
export function overLimitText(t: (key: MessageKey) => string, overrun: OutputOverrun): string {
  const values: Record<string, string> = {
    total: formatClock(overrun.totalUs),
    excess: formatClock(overrun.excessUs),
    limit: String(Math.round(overrun.limitUs / (60 * US_PER_SECOND))),
  };
  return t('output.overLimit').replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
