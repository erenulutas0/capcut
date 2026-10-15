import { WEB_LOCAL_POLICY, formatByteLimit, formatBytesAgainstLimit, type ExportPolicy } from '@/domain/policy';
import { formatDurationShort, type Micros } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/** A refused file, as far as the sentence needs it. */
export interface RefusedFile {
  reason: string;
  /** The file's name, already shortened for display. */
  name: string;
  /** For the size refusals: the bytes that were checked (the file, or video and music together). */
  bytes?: number;
  /** For a file that is not all there (ADR-040): the length it declares and how far it really goes. */
  extent?: { declaredUs: Micros; readableUs: Micros };
  /** For a kind of video file this app does not open: its short name ("AVI"). */
  typeName?: string;
}

/** Under this much readable video the sentence does not name an amount: "almost none of it is in the file". */
const NOTHING_READABLE_US: Micros = 1_000_000;

/**
 * The message key of a refusal. A file that is not all there (ADR-040) says
 * how far it goes when that is worth saying, and "almost nothing" otherwise.
 */
function reasonKey(file: RefusedFile): MessageKey {
  const incomplete = file.reason === 'incomplete' || file.reason === 'music_incomplete';
  if (incomplete && (!file.extent || file.extent.readableUs < NOTHING_READABLE_US)) {
    return `error.${file.reason}Start` as MessageKey;
  }
  return `error.${file.reason}` as MessageKey;
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
  const words = { minute: t('time.minuteShort'), second: t('time.secondShort'), decimalMark: mark };
  const values: Record<string, string> = {
    ...(limitBytes === null
      ? {}
      : {
          size: file.bytes === undefined ? '—' : formatBytesAgainstLimit(file.bytes, limitBytes, mark),
          limit: formatByteLimit(limitBytes, mark),
        }),
    ...(file.extent
      ? {
          total: formatDurationShort(file.extent.declaredUs, words),
          // Rounded down by the formatter's tenth: never more than is really there.
          readable: formatDurationShort(Math.max(0, file.extent.readableUs - 50_000), words),
        }
      : {}),
    ...(file.typeName === undefined ? {} : { type: file.typeName }),
  };
  const reason = t(reasonKey(file)).replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  const lowered = `${reason.charAt(0).toLocaleLowerCase('tr-TR')}${reason.slice(1)}`;
  return t('error.rejectedFile').replace(/\{(\w+)\}/g, (match, key: string) =>
    key === 'name' ? file.name : key === 'reason' ? lowered : match,
  );
}
