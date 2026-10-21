'use client';

import { FailureDetails } from '@/components/FailureDetails';
import { Icon } from '@/components/Icon';
import { formatStorageBytes } from '@/domain/outputStorage';
import { formatBytes } from '@/domain/policy';
import { CHROMIUM_SHARE_MAX_BYTES } from '@/domain/share';
import { formatDecimal, formatLengthShort } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';
import { gifPercent, type GifDownloadState, type GifFailureCode, type GifResult } from './useGif';

type T = (key: MessageKey) => string;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** The words of a failure: the download card's own sentences, and a few of the GIF's. */
export function gifFailureText(t: T, code: GifFailureCode | 'worker_unavailable'): string {
  if (code === 'text_font_unavailable') return t('gif.fail.font');
  // The GIF's own way out: its size and its part, not "a shorter output".
  if (code === 'out_of_memory') return t('gif.fail.memory');
  return t(`export.fail.${code}` as MessageKey);
}

/** "3,1 MB · 4,0 sn · durmadan döner": what the saved GIF is, read from the file itself. */
function resultLine(t: T, result: GifResult): string {
  const mark = t('time.decimalMark');
  return fill(t(result.loopsForever ? 'gif.result.line' : 'gif.result.lineOnce'), {
    size: formatBytes(result.sizeBytes, mark),
    length: formatLengthShort(result.durationCs * 10_000, { second: t('time.secondShort'), decimalMark: mark }),
  });
}

function Details({ t, result }: { t: T; result: GifResult }) {
  const mark = t('time.decimalMark');
  return (
    <details className="dl-details">
      <summary>{t('download.details')}</summary>
      <ul className="meta-list">
        <li>
          <span className="meta-key">{t('export.measuredResolution')}</span>
          <span className="meta-value" data-testid="gif-measured-resolution">
            {result.width}×{result.height}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('gif.details.frames')}</span>
          <span className="meta-value" data-testid="gif-measured-frames">
            {result.frames}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.measuredSize')}</span>
          <span className="meta-value" data-testid="gif-measured-size">
            {formatBytes(result.sizeBytes, mark)}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.elapsed')}</span>
          <span className="meta-value" data-testid="gif-measured-elapsed">
            {formatDecimal(result.elapsedMs / 1000, 1, mark)} {t('time.secondShort')}
          </span>
        </li>
      </ul>
    </details>
  );
}

/** "Kaydet" (no save dialog in this browser) and "Paylaş" (where the browser can share a file). */
function Actions({
  t,
  state,
  device,
  onShare,
}: {
  t: T;
  state: Extract<GifDownloadState, { phase: 'saved' | 'ready' }>;
  device: boolean;
  onShare: () => void;
}) {
  const share = state.share;
  const canShare = share?.verdict === 'share';
  return (
    <>
      {state.phase === 'ready' || canShare ? (
        <div className="dl-actions">
          {state.phase === 'ready' ? (
            <a className="btn btn-accent btn-block" href={state.url} download={state.fileName} data-testid="export-download">
              <Icon name="download" />
              {t(device ? 'export.saveDevice' : 'export.save')}
            </a>
          ) : null}
          {canShare ? (
            <button
              type="button"
              className="btn dl-share"
              onClick={onShare}
              aria-label={`${t('download.share')}: ${state.fileName}`}
              data-testid="download-share"
            >
              <Icon name="share" />
              {t('download.share')}
            </button>
          ) : null}
        </div>
      ) : null}
      {share?.verdict === 'too_large' ? (
        <p className="hint-small" data-testid="share-too-large">
          {t(state.phase === 'saved' ? 'download.shareTooLargeSaved' : 'download.shareTooLarge')
            .replace('{size}', formatStorageBytes(share.file.size, 'up', t('time.decimalMark')))
            .replace('{limit}', formatStorageBytes(CHROMIUM_SHARE_MAX_BYTES, 'down', t('time.decimalMark')))}
        </p>
      ) : null}
      {share?.failed ? (
        <p className="hint-small dl-share-failed" role="status" data-testid="share-failed">
          {t(state.phase === 'saved' ? 'download.shareFailedSaved' : 'download.shareFailed')}
        </p>
      ) : null}
    </>
  );
}

/**
 * The result card of "GIF yap" (ADR-046), in the download card's own shape
 * and words (`DownloadStatus`): real progress (frames done of all), "İptal
 * et", "Kaydedildi" with what the GIF really is, "Paylaş" where the browser
 * can share a file, a failure in plain words with "Ayrıntılar" for one nobody
 * planned for.
 */
export function GifStatus({
  t,
  state,
  device,
  onCancel,
  onShare,
}: {
  t: T;
  state: GifDownloadState;
  /** A phone or tablet: "Kaydet", not "Bilgisayara kaydet". */
  device: boolean;
  onCancel: () => void;
  onShare: () => void;
}) {
  if (state.phase === 'running') {
    const percent = gifPercent(state);
    const step =
      state.step === 'frames' || state.step === 'encoding'
        ? fill(t(`gif.running.${state.step}`), { done: String(state.done), total: String(state.total) })
        : t(`gif.running.${state.step}`);
    return (
      <div className="dl-status" data-phase="running" data-testid="download-running" data-step={state.step} data-done={state.done} data-total={state.total} data-passes={state.passes ?? 1}>
        <p className="visually-hidden" role="status" data-testid="download-status">
          {t('wizard.result.running')}
        </p>
        <div className="dl-row">
          <span className="dl-text">
            {state.fileName ? (
              <span className="dl-file" data-testid="download-file-name">
                {state.fileName}
              </span>
            ) : null}
            <span className="dl-step" data-testid="gif-step">
              {step}
            </span>
          </span>
          <span className="dl-percent" data-testid="export-progress">
            {percent === null ? '—' : t('number.percent').replace('{n}', String(percent))}
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label={step}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { 'aria-valuenow': percent })}
        >
          <div className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'} style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <button type="button" className="btn btn-compact dl-cancel" onClick={onCancel} disabled={state.step === 'saving'} data-testid="export-cancel">
          {t('export.cancel')}
        </button>
      </div>
    );
  }

  if (state.phase === 'saved' || state.phase === 'ready') {
    const { result } = state;
    const title =
      state.phase === 'saved'
        ? t('download.saved').replace('{name}', state.fileName)
        : t(device ? (state.share?.verdict === 'share' ? 'gif.ready.titleShare' : 'gif.ready.titleDevice') : 'gif.ready.title');
    return (
      <div
        className="dl-status"
        data-phase={state.phase}
        data-testid="export-succeeded"
        data-bytes={result.sizeBytes}
        data-width={result.width}
        data-height={result.height}
        data-frames={result.frames}
      >
        <p className="visually-hidden" role="status" data-testid="download-status">
          {title}
        </p>
        <div className="dl-row">
          <Icon name="check" size={16} />
          <span className="dl-text">
            <span data-testid={state.phase === 'saved' ? 'download-saved' : 'download-ready-title'}>{title}</span>
            {state.phase === 'saved' ? (
              <span className="dl-where" data-testid="download-saved-where">
                {t('download.savedWhere')}
              </span>
            ) : null}
            <span className="dl-sub" data-testid="gif-result-line">
              {resultLine(t, result)}
            </span>
            {result.framesMissing > 0 ? (
              <span className="dl-sub" data-testid="gif-frames-missing">
                {fill(t('gif.result.missing'), { n: String(result.framesMissing) })}
              </span>
            ) : null}
          </span>
        </div>
        <Actions t={t} state={state} device={device} onShare={onShare} />
        {state.phase === 'ready' ? (
          <p className="hint-small" data-testid="export-save-where">
            {t(device ? 'download.readyWhereDevice' : 'download.readyWhere')}
          </p>
        ) : null}
        <Details t={t} result={result} />
      </div>
    );
  }

  if (state.phase === 'canceled') {
    return (
      <div className="dl-status" data-phase="canceled" data-testid="export-canceled">
        <p className="visually-hidden" role="status" data-testid="download-status">
          {t('download.canceled')}
        </p>
        <div className="dl-row">
          <Icon name="info" size={16} />
          <span className="dl-text">{t('download.canceled')}</span>
        </div>
      </div>
    );
  }

  // failed
  const unplanned = state.code === 'internal_error' || state.code === 'worker_unavailable' || state.code === 'out_of_memory';
  return (
    <div className="dl-status dl-problem" data-phase="failed" data-testid="export-failed" data-code={state.code}>
      <p className="visually-hidden" role="status" data-testid="download-status">
        {t('gif.failedTitle')}
      </p>
      <div className="dl-row">
        <Icon name="alert" size={16} />
        <span className="dl-text">
          <b>{t('gif.failedTitle')}</b>
          <span data-testid="export-failed-reason">{gifFailureText(t, state.code)}</span>
        </span>
      </div>
      {unplanned ? <FailureDetails t={t} detail={state.detail} testId="export-failed" /> : null}
    </div>
  );
}
