import type { OutputOverrun } from '@/domain/policy';
import { formatClock, US_PER_SECOND } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

/**
 * The export gate's sentence (ADR-021), applied to one download (ADR-026):
 * "Kesit 1:12:30. İndirmek için en az 12:30 kısalt — sınır 60 dakika." The
 * subject names what is being downloaded (a kesit, the joined kesitler, the
 * whole video); `output.overLimit` is the memory-route variant ("Sonuç …").
 * Both clocks round up, so removing the amount said is enough.
 */
export function overLimitText(
  t: (key: MessageKey) => string,
  overrun: OutputOverrun,
  key: MessageKey = 'output.overLimit',
): string {
  const values: Record<string, string> = {
    total: formatClock(overrun.totalUs),
    excess: formatClock(overrun.excessUs),
    limit: String(Math.round(overrun.limitUs / (60 * US_PER_SECOND))),
  };
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
