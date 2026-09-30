import { WEB_LOCAL_POLICY, formatByteLimit, formatBytesAgainstLimit, type ExportPolicy } from '@/domain/policy';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/** A refused file, as far as the sentence needs it. */
export interface RefusedFile {
  reason: string;
  /** The file's name, already shortened for display. */
  name: string;
  /** For the size refusals: the bytes that were checked (the file, or video and music together). */
  bytes?: number;
}

/** Which byte limit a size refusal was checked against. */
export function limitFor(reason: string, policy: Pick<ExportPolicy, 'maxTotalSourceBytes' | 'maxMusicBytes'>): number | null {
  if (reason === 'file_too_large' || reason === 'total_too_large') return policy.maxTotalSourceBytes;
  if (reason === 'music_too_large') return policy.maxMusicBytes;
  return null;
}

/**
 * "“tatil.mp4” açılamadı: dosya 4,3 GB; bu sürümün sınırı 4,29 GB." The size
 * refusals name the size and the limit in the same decimal unit, rounded so
 * that the size reads above the limit exactly when the byte check refused it
 * (ADR-030, doc 15's units rule).
 */
export function refusedFileText(t: T, file: RefusedFile, policy = WEB_LOCAL_POLICY): string {
  const mark = t('time.decimalMark');
  const limitBytes = limitFor(file.reason, policy);
  const values: Record<string, string> =
    limitBytes === null
      ? {}
      : {
          size: file.bytes === undefined ? '—' : formatBytesAgainstLimit(file.bytes, limitBytes, mark),
          limit: formatByteLimit(limitBytes, mark),
        };
  const reason = t(`error.${file.reason}` as MessageKey).replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  const lowered = `${reason.charAt(0).toLocaleLowerCase('tr-TR')}${reason.slice(1)}`;
  return t('error.rejectedFile').replace(/\{(\w+)\}/g, (match, key: string) =>
    key === 'name' ? file.name : key === 'reason' ? lowered : match,
  );
}
