'use client';

import { Icon } from '@/components/Icon';
import { environmentPasses } from '@/adapters/exportCapability';
import type { DownloadKind } from '@/domain/kesit';
import type { TargetSizeShortfall } from '@/domain/exportEvents';
import { formatStorageBytes } from '@/domain/outputStorage';
import { formatByteLimit, formatBytes, formatBytesAgainstLimit } from '@/domain/policy';
import { CHROMIUM_SHARE_MAX_BYTES } from '@/domain/share';
import { formatTimecode } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';
import { overLimitText } from './outputLimitText';
import type { DownloadEntry } from './useDownloads';

type T = (key: MessageKey) => string;

interface Props {
  t: T;
  entry: DownloadEntry;
  /** What the download is, for the gate sentence ("Kesit …", "Birleşik video …"). */
  kind: DownloadKind;
  onCancel: () => void;
  onDismiss: () => void;
  onReportProblem: () => void;
  /** "Paylaş": must open the share sheet synchronously (useDownloads.share). */
  onShare: () => void;
  /** A phone or tablet: "Kaydet", not "Bilgisayara kaydet" (ADR-031). */
  device: boolean;
}

/**
 * "Paylaş" (Web Share API, ADR-031), next to the save button or under
 * "Kaydedildi". Not drawn where the browser cannot share files; a file the
 * browser would refuse (Chromium, over 50 MiB) gets the reason instead of a
 * button that cannot work; a refused attempt is said under it.
 */
function ShareButton({ t, entry, onShare }: { t: T; entry: Extract<DownloadEntry, { phase: 'saved' | 'ready' }>; onShare: () => void }) {
  if (entry.share?.verdict !== 'share') return null;
  return (
    <button
      type="button"
      className="btn dl-share"
      onClick={onShare}
      aria-label={`${t('download.share')}: ${entry.fileName}`}
      aria-describedby={`share-hint-${entry.key}`}
      data-testid="download-share"
    >
      <Icon name="share" />
      {t('download.share')}
    </button>
  );
}

function ShareNotes({ t, entry }: { t: T; entry: Extract<DownloadEntry, { phase: 'saved' | 'ready' }> }) {
  const share = entry.share;
  if (!share) return null;
  const saved = entry.phase === 'saved';
  if (share.verdict === 'too_large') {
    return (
      <p className="hint-small" data-testid="share-too-large">
        {t(saved ? 'download.shareTooLargeSaved' : 'download.shareTooLarge')
          .replace('{size}', formatStorageBytes(share.file.size, 'up', t('time.decimalMark')))
          .replace('{limit}', formatStorageBytes(CHROMIUM_SHARE_MAX_BYTES, 'down', t('time.decimalMark')))}
      </p>
    );
  }
  return (
    <>
      <p className="hint-small" id={`share-hint-${entry.key}`}>
        {t('download.shareHint')}
      </p>
      {share.failed ? (
        <p className="hint-small dl-share-failed" role="status" data-testid="share-failed">
          {t(saved ? 'download.shareFailedSaved' : 'download.shareFailed')}
        </p>
      ) : null}
    </>
  );
}

type Finished = Extract<DownloadEntry, { phase: 'saved' | 'ready' }>;

/** ADR-035: a sound-only (M4A) result. */
function isAudio(entry: Finished): boolean {
  return entry.result.output === 'audio';
}

/** "Kaydedildi: …" — "Ses dosyası kaydedildi: …" for a sound-only download. */
function savedText(t: T, entry: Extract<DownloadEntry, { phase: 'saved' }>): string {
  return t(isAudio(entry) ? 'download.audioSaved' : 'download.saved').replace('{name}', entry.fileName);
}

/**
 * ADR-035: the result of a target-size download — the real size against the
 * target, both read from the file. "Under the target" only when it is.
 */
function targetSizeText(t: T, entry: Finished): string | null {
  const outcome = entry.result.targetSize;
  if (!outcome) return null;
  const mark = t('time.decimalMark');
  const head = t(outcome.fits ? 'download.targetFits' : 'download.targetOver')
    .replace('{size}', formatBytesAgainstLimit(outcome.actualBytes, outcome.targetBytes, mark))
    .replace('{target}', formatByteLimit(outcome.targetBytes, mark));
  const notes: string[] = [];
  if (outcome.mode === 'copy') notes.push(t('download.targetCopy'));
  else if (outcome.mode === 'normal') notes.push(t('download.targetNormal'));
  else notes.push(t('download.targetResolution').replace('{height}', String(outcome.shortEdge)));
  if (outcome.attempts > 1) notes.push(t('download.targetAttempts').replace('{count}', String(outcome.attempts)));
  return `${head}. ${notes.join('; ')}.`;
}

/** The target-size line, with the numbers tests and the matrix read back. */
function TargetSizeLine({ t, entry }: { t: T; entry: Finished }) {
  const outcome = entry.result.targetSize;
  const text = targetSizeText(t, entry);
  if (!outcome || !text) return null;
  return (
    <span
      className="dl-sub"
      data-testid="target-size-result"
      data-fits={outcome.fits ? 'true' : 'false'}
      data-target-bytes={outcome.targetBytes}
      data-planned-bytes={outcome.firstPlannedBytes}
      data-actual-bytes={outcome.actualBytes}
      data-attempts={outcome.attempts}
      data-short-edge={outcome.shortEdge}
      data-video-bitrate={outcome.videoBitrate}
      data-audio-bitrate={outcome.audioBitrate}
      data-encoder={outcome.encoderKind}
      data-mode={outcome.mode}
    >
      {text}
    </span>
  );
}

/** ADR-035: why a target size was refused, in numbers the user can act on. */
function targetShortfallText(t: T, shortfall: TargetSizeShortfall): string {
  const mark = t('time.decimalMark');
  return t(shortfall.maxDurationUs >= 1_000_000 ? 'download.targetTooSmall' : 'download.targetTooSmallNoFit')
    .replace('{target}', formatByteLimit(shortfall.targetBytes, mark))
    .replace('{min}', formatStorageBytes(shortfall.minBytes, 'up', mark))
    .replace('{duration}', formatTimecode(shortfall.maxDurationUs));
}

/** The step a running download is in, as text. */
function runningStep(t: T, entry: Extract<DownloadEntry, { phase: 'running' }>): string {
  if (entry.step === 'waiting') return t('download.running.waiting');
  if (entry.step === 'encoding' && entry.pass > 1) return t('export.running.pass').replace('{pass}', String(entry.pass));
  if (entry.step === 'encoding' && entry.output === 'audio') return t('export.running.audio');
  return t(`export.running.${entry.step}` as MessageKey);
}

/** The one sentence a screen reader hears per phase (the percentage is left out). */
function announcement(t: T, entry: DownloadEntry, device: boolean): string {
  switch (entry.phase) {
    case 'running':
      return runningStep(t, entry);
    case 'saved': {
      const target = targetSizeText(t, entry);
      return `${savedText(t, entry)}. ${t('download.savedWhere')}${target ? ` ${target}` : ''}`;
    }
    case 'ready':
      return readyTitle(t, entry, device);
    case 'blocked':
      return entry.overrun ? t('export.overLimitTitle') : t('export.blockedTitle');
    case 'failed':
      return t('export.failedTitle');
    case 'canceled':
      return t('download.canceled');
  }
}

/** The ready sentence: a computer saves; a phone saves, or saves or shares (ADR-031). */
function readyTitle(t: T, entry: Extract<DownloadEntry, { phase: 'ready' }>, device: boolean): string {
  if (isAudio(entry)) {
    if (!device) return t('download.audioReadyTitle');
    return entry.share?.verdict === 'share' ? t('download.audioReadyTitleShare') : t('download.audioReadyTitleDevice');
  }
  if (!device) return t('download.readyTitle');
  return entry.share?.verdict === 'share' ? t('download.readyTitleShare') : t('download.readyTitleDevice');
}

/**
 * How the file was made (ADR-027): the source's pictures kept (`copy`), kept
 * except the frames next to the cuts (`smart`), or every frame encoded — then
 * with the reason the fast cut was not used, when there was one.
 */
function methodText(t: T, entry: Extract<DownloadEntry, { phase: 'saved' | 'ready' }>): string {
  const { result } = entry;
  if (result.output === 'audio') return t('export.method.audio');
  switch (result.method) {
    case 'copy':
      return t('export.method.copy');
    case 'smart':
      return t('export.method.smart').replace('{count}', String(result.framesEncoded));
    case 'encode':
      return result.fallbackReason && result.fallbackReason !== 'requested_encode'
        ? t('export.method.encodeWhy').replace('{reason}', t(`export.fallback.${result.fallbackReason}` as MessageKey))
        : t('export.method.encode');
  }
}

/** The method line, with the numbers tests and the matrix read back. */
function MethodLine({ t, entry }: { t: T; entry: Extract<DownloadEntry, { phase: 'saved' | 'ready' }> }) {
  const { result } = entry;
  return (
    <span
      className="dl-sub"
      data-testid="export-method"
      data-output={result.output ?? 'video'}
      data-method={result.method}
      data-fallback={result.fallbackReason ?? ''}
      data-frames-encoded={result.framesEncoded}
      data-frames-copied={result.framesCopied}
    >
      {methodText(t, entry)}
    </span>
  );
}

/** Measured from the produced file, never copied from the plan. */
function Details({ t, entry }: { t: T; entry: Extract<DownloadEntry, { phase: 'saved' | 'ready' }> }) {
  const { result } = entry;
  const route =
    result.route === 'file'
      ? t('download.route.file')
      : result.route === 'opfs'
        ? t('export.route.opfs')
        : t('export.route.memory');
  return (
    <details className="dl-details">
      <summary>{t('download.details')}</summary>
      <ul className="meta-list">
        <li>
          <span className="meta-key">{t('export.measuredDuration')}</span>
          <span className="meta-value" data-testid="measured-duration">
            {formatTimecode(result.probe.durationUs)}
          </span>
        </li>
        {result.output === 'audio' ? null : (
          <li>
            <span className="meta-key">{t('export.measuredResolution')}</span>
            <span className="meta-value" data-testid="measured-resolution">
              {result.probe.width}×{result.probe.height}
            </span>
          </li>
        )}
        <li>
          <span className="meta-key">{t('export.measuredCodecs')}</span>
          <span className="meta-value" data-testid="measured-codecs">
            {result.probe.videoCodec ?? '—'} · {result.probe.audioCodec ?? t('export.noAudioTrack')}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.measuredSize')}</span>
          <span className="meta-value" data-testid="measured-size">
            {formatBytes(result.sizeBytes, t('time.decimalMark'))}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.measuredDelta')}</span>
          <span className="meta-value" data-testid="measured-delta">
            {result.durationDeltaUs > 0 ? '+' : ''}
            {result.durationDeltaUs} µs
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.route')}</span>
          <span className="meta-value" data-testid="measured-route">
            {route}
          </span>
        </li>
        {result.framesMissing > 0 ? (
          <li>
            <span className="meta-key">{t('export.framesMissing')}</span>
            <span className="meta-value" data-testid="measured-frames-missing">
              {t('export.framesMissing.value').replace('{count}', String(result.framesMissing))}
            </span>
          </li>
        ) : null}
        <li>
          <span className="meta-key">{t('export.elapsed')}</span>
          <span className="meta-value">{(result.elapsedMs / 1000).toFixed(1)} s</span>
        </li>
      </ul>
    </details>
  );
}

function DismissButton({ t, onDismiss }: { t: T; onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn icon-btn-sm dl-dismiss"
      onClick={onDismiss}
      aria-label={t('download.dismiss')}
      data-testid="download-dismiss"
    >
      <Icon name="close" size={14} />
    </button>
  );
}

/**
 * A download's progress and outcome, shown right where it was started — on
 * the kesit card, or under the list heading for the top button (ADR-026).
 */
export function DownloadStatus({ t, entry, kind, onCancel, onDismiss, onReportProblem, onShare, device }: Props) {
  const status = (
    <p className="visually-hidden" role="status" data-testid="download-status">
      {announcement(t, entry, device)}
    </p>
  );

  if (entry.phase === 'running') {
    const percent = entry.progress === null ? null : Math.round(entry.progress * 100);
    const step = runningStep(t, entry);
    return (
      <div className="dl-status" data-phase="running" data-testid="download-running" data-pass={entry.pass}>
        {status}
        <div className="dl-row">
          <span className="dl-text">
            {entry.fileName ? (
              <span className="dl-file" data-testid="download-file-name">
                {entry.fileName}
              </span>
            ) : null}
            <span className="dl-step">{step}</span>
          </span>
          <span className="dl-percent" data-testid="export-progress">
            {percent === null ? '—' : `%${percent}`}
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
          <div
            className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
        <button type="button" className="btn btn-compact dl-cancel" onClick={onCancel} data-testid="export-cancel">
          {t('export.cancel')}
        </button>
      </div>
    );
  }

  if (entry.phase === 'saved') {
    return (
      <div className="dl-status" data-phase="saved" data-testid="export-succeeded">
        {status}
        <div className="dl-row">
          <Icon name="check" size={16} />
          <span className="dl-text">
            <span data-testid="download-saved">{savedText(t, entry)}</span>
            {/* The page cannot know the folder's path; it can say which one. */}
            <span className="dl-where" data-testid="download-saved-where">
              {t('download.savedWhere')}
            </span>
            <TargetSizeLine t={t} entry={entry} />
            <MethodLine t={t} entry={entry} />
            {entry.hdr ? (
              <span className="dl-sub" data-testid="export-hdr-note">
                {t('export.hdrNote')}
              </span>
            ) : null}
          </span>
          <DismissButton t={t} onDismiss={onDismiss} />
        </div>
        {entry.share?.verdict === 'share' ? (
          <div className="dl-actions">
            <ShareButton t={t} entry={entry} onShare={onShare} />
          </div>
        ) : null}
        <ShareNotes t={t} entry={entry} />
        <Details t={t} entry={entry} />
      </div>
    );
  }

  if (entry.phase === 'ready') {
    const title = readyTitle(t, entry, device);
    return (
      <div className="dl-status" data-phase="ready" data-testid="export-succeeded">
        {status}
        <div className="dl-row">
          <Icon name="check" size={16} />
          <span className="dl-text">
            <span data-testid="download-ready-title">{title}</span>
            <TargetSizeLine t={t} entry={entry} />
            <MethodLine t={t} entry={entry} />
            {entry.hdr ? (
              <span className="dl-sub" data-testid="export-hdr-note">
                {t('export.hdrNote')}
              </span>
            ) : null}
          </span>
          <DismissButton t={t} onDismiss={onDismiss} />
        </div>
        {/* The browser saves the file only when the user asks for it. */}
        <div className="dl-actions">
          <a
            className="btn btn-accent btn-block"
            href={entry.url}
            download={entry.fileName}
            data-testid="export-download"
          >
            <Icon name="download" />
            {t(device ? 'export.saveDevice' : 'export.save')}
          </a>
          <ShareButton t={t} entry={entry} onShare={onShare} />
        </div>
        <p className="hint-small" data-testid="export-save-where">
          {t(device ? 'download.readyWhereDevice' : 'download.readyWhere')}
        </p>
        {/* ADR-023: saving copies the finished file into the downloads folder. */}
        <p className="hint-small" data-testid="export-save-space">
          {entry.result.sizeBytes > 0
            ? t(device ? 'export.saveSpaceDevice' : 'export.saveSpace').replace(
                '{size}',
                formatStorageBytes(entry.result.sizeBytes, 'up', t('time.decimalMark')),
              )
            : t(device ? 'export.saveSpaceUnknownDevice' : 'export.saveSpaceUnknown')}
        </p>
        <ShareNotes t={t} entry={entry} />
        <Details t={t} entry={entry} />
      </div>
    );
  }

  if (entry.phase === 'canceled') {
    return (
      <div className="dl-status" data-phase="canceled" data-testid="export-canceled">
        {status}
        <div className="dl-row">
          <Icon name="info" size={16} />
          <span className="dl-text">{t('download.canceled')}</span>
          <DismissButton t={t} onDismiss={onDismiss} />
        </div>
      </div>
    );
  }

  if (entry.phase === 'blocked') {
    const overrunKey: MessageKey =
      kind === 'kesit' ? 'download.overLimit.kesit' : kind === 'merged' ? 'download.overLimit.merged' : 'download.overLimit.whole';
    const report = entry.report;
    return (
      <div className="dl-status dl-problem" data-phase="blocked" data-testid={entry.overrun ? 'export-over-limit' : 'export-blocked'}>
        {status}
        <div className="dl-row">
          <Icon name="alert" size={16} />
          <span className="dl-text">
            {entry.overrun ? (
              <>
                <b>{t('export.overLimitTitle')}</b>
                <span data-testid="export-over-limit-text">{overLimitText(t, entry.overrun, overrunKey)}</span>
              </>
            ) : (
              <>
                <b>{t('export.blockedTitle')}</b>
                <span>
                  {entry.reason === 'capability'
                    ? t('export.blockedBody')
                    : t(`export.plan.${entry.reason}` as MessageKey)}
                </span>
                {entry.targetSize ? (
                  <span className="dl-sub" data-testid="target-size-refusal" data-min-bytes={entry.targetSize.minBytes}>
                    {targetShortfallText(t, entry.targetSize)}
                  </span>
                ) : null}
                {report && !environmentPasses(report.environment) ? (
                  <span className="dl-sub">{t('export.detectedNote')}</span>
                ) : null}
                {report && report.blockers.length > 0 ? (
                  <ul className="dl-blockers" data-testid="export-blockers">
                    {report.blockers.map((code) => (
                      <li key={code}>{t(`export.fail.${code}` as MessageKey)}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </span>
          <DismissButton t={t} onDismiss={onDismiss} />
        </div>
        {/* Too long is not a fault to report: the user shortens the kesit. */}
        {entry.overrun ? null : (
          <button type="button" className="link-button" onClick={onReportProblem} data-testid="export-report">
            {t('support.open')}
          </button>
        )}
      </div>
    );
  }

  // failed
  return (
    <div className="dl-status dl-problem" data-phase="failed" data-testid="export-failed">
      {status}
      <div className="dl-row">
        <Icon name="alert" size={16} />
        <span className="dl-text">
          <b>{t('export.failedTitle')}</b>
          <span data-testid="export-failed-reason">{t(`export.fail.${entry.code}` as MessageKey)}</span>
          {entry.overrun ? (
            <span className="dl-sub" data-testid="export-failed-over-limit">
              {overLimitText(t, entry.overrun, 'output.overLimit')}
            </span>
          ) : null}
          {entry.captionCue ? (
            <span className="dl-sub" data-testid="export-failed-caption">
              {t('export.fail.captionCue')
                .replace('{index}', String(entry.captionCue.index))
                .replace('{text}', () => entry.captionCue?.text ?? '')}
            </span>
          ) : null}
          {entry.targetSize ? (
            <span className="dl-sub" data-testid="target-size-refusal" data-min-bytes={entry.targetSize.minBytes}>
              {targetShortfallText(t, entry.targetSize)}
            </span>
          ) : null}
          {entry.storage ? (
            <span className="dl-sub" data-testid="export-failed-storage">
              {t(
                entry.storage.reason === 'file_reservation'
                  ? 'export.fail.storageFileReservation'
                  : entry.storage.reason === 'reservation'
                    ? 'export.fail.storageReservation'
                    : 'export.fail.storageNumbers',
              )
                .replace('{required}', formatStorageBytes(entry.storage.requiredBytes, 'up', t('time.decimalMark')))
                .replace('{free}', formatStorageBytes(entry.storage.freeBytes, 'down', t('time.decimalMark')))}
            </span>
          ) : null}
        </span>
        <DismissButton t={t} onDismiss={onDismiss} />
      </div>
      <button type="button" className="link-button" onClick={onReportProblem} data-testid="export-report">
        {t('support.open')}
      </button>
    </div>
  );
}
