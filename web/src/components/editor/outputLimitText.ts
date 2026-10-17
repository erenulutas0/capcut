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

/**
 * The "not enough space" sentence (17 Oct 2026). With a suggested length
 * (`StorageShortfall.suggestedDurationUs`, worked out from the free space the
 * disk really gave and this download's own bitrate) it says it: "en fazla 20
 * dakikalık bir kesit indir" — whole minutes from one minute on, whole seconds
 * under it, both already rounded down. Without one it gives no number.
 */
export function storageRefusalText(
  t: (key: MessageKey) => string,
  suggestedDurationUs: number | null | undefined,
): string {
  const us = suggestedDurationUs ?? null;
  if (us === null || !Number.isFinite(us) || us < US_PER_SECOND) return t('export.fail.output_storage_insufficient');
  const minutes = Math.floor(us / (60 * US_PER_SECOND));
  const seconds = Math.floor(us / US_PER_SECOND);
  const length =
    minutes >= 1
      ? minutes === 1
        ? t('export.fail.fitMinutesOne')
        : t('export.fail.fitMinutes').replace('{n}', String(minutes))
      : seconds === 1
        ? t('export.fail.fitSecondsOne')
        : t('export.fail.fitSeconds').replace('{n}', String(seconds));
  return t('export.fail.output_storage_insufficient_fit').replace('{length}', length);
}
