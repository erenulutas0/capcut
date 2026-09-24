'use client';

import { Icon } from '@/components/Icon';
import { environmentPasses } from '@/adapters/exportCapability';
import type { DownloadKind } from '@/domain/kesit';
import { formatStorageBytes } from '@/domain/outputStorage';
import { formatBytes } from '@/domain/policy';
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
}

/** The one sentence a screen reader hears per phase (the percentage is left out). */
function announcement(t: T, entry: DownloadEntry): string {
  switch (entry.phase) {
    case 'running':
      return entry.step === 'waiting' ? t('download.running.waiting') : t(`export.running.${entry.step}` as MessageKey);
    case 'saved':
      return t('download.saved').replace('{name}', entry.fileName);
    case 'ready':
      return t('download.readyTitle');
    case 'blocked':
      return entry.overrun ? t('export.overLimitTitle') : t('export.blockedTitle');
    case 'failed':
      return t('export.failedTitle');
    case 'canceled':
      return t('download.canceled');
  }
}

/**
 * How the file was made. A result without `method` comes from the encode
 * loop: it is the only path that does not report one (the fast copy / smart
 * cut path added next to it reports `copy` or `smart`).
 */
function methodText(t: T, entry: Extract<DownloadEntry, { phase: 'saved' | 'ready' }>): string {
  switch (entry.result.method ?? 'encode') {
    case 'copy':
      return t('download.method.copy');
    case 'smart':
      return t('download.method.smart');
    case 'encode':
      return t('download.method.encode');
  }
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
        <li>
          <span className="meta-key">{t('export.measuredResolution')}</span>
          <span className="meta-value" data-testid="measured-resolution">
            {result.probe.width}×{result.probe.height}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.measuredCodecs')}</span>
          <span className="meta-value" data-testid="measured-codecs">
            {result.probe.videoCodec ?? '—'} · {result.probe.audioCodec ?? t('export.noAudioTrack')}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('export.measuredSize')}</span>
          <span className="meta-value" data-testid="measured-size">
            {formatBytes(result.sizeBytes)}
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
export function DownloadStatus({ t, entry, kind, onCancel, onDismiss, onReportProblem }: Props) {
  const status = (
    <p className="visually-hidden" role="status" data-testid="download-status">
      {announcement(t, entry)}
    </p>
  );

  if (entry.phase === 'running') {
    const percent = entry.progress === null ? null : Math.round(entry.progress * 100);
    const step = entry.step === 'waiting' ? t('download.running.waiting') : t(`export.running.${entry.step}` as MessageKey);
    return (
      <div className="dl-status" data-phase="running" data-testid="download-running">
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
    const method = methodText(t, entry);
    return (
      <div className="dl-status" data-phase="saved" data-testid="export-succeeded">
        {status}
        <div className="dl-row">
          <Icon name="check" size={16} />
          <span className="dl-text">
            <span data-testid="download-saved">{t('download.saved').replace('{name}', entry.fileName)}</span>
            <span className="dl-sub" data-testid="export-method">
              {method}
            </span>
            {entry.hdr ? (
              <span className="dl-sub" data-testid="export-hdr-note">
                {t('export.hdrNote')}
              </span>
            ) : null}
          </span>
          <DismissButton t={t} onDismiss={onDismiss} />
        </div>
        <Details t={t} entry={entry} />
      </div>
    );
  }

  if (entry.phase === 'ready') {
    const method = methodText(t, entry);
    return (
      <div className="dl-status" data-phase="ready" data-testid="export-succeeded">
        {status}
        <div className="dl-row">
          <Icon name="check" size={16} />
          <span className="dl-text">
            <span>{t('download.readyTitle')}</span>
            <span className="dl-sub" data-testid="export-method">
              {method}
            </span>
            {entry.hdr ? (
              <span className="dl-sub" data-testid="export-hdr-note">
                {t('export.hdrNote')}
              </span>
            ) : null}
          </span>
          <DismissButton t={t} onDismiss={onDismiss} />
        </div>
        {/* The browser saves the file only when the user asks for it. */}
        <a
          className="btn btn-accent btn-block"
          href={entry.url}
          download={entry.fileName}
          data-testid="export-download"
        >
          <Icon name="download" />
          {t('export.save')}
        </a>
        {/* ADR-023: saving copies the finished file into the downloads folder. */}
        <p className="hint-small" data-testid="export-save-space">
          {entry.result.sizeBytes > 0
            ? t('export.saveSpace').replace('{size}', formatStorageBytes(entry.result.sizeBytes, 'up'))
            : t('export.saveSpaceUnknown')}
        </p>
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
          {entry.storage ? (
            <span className="dl-sub" data-testid="export-failed-storage">
              {t(
                entry.storage.reason === 'file_reservation'
                  ? 'export.fail.storageFileReservation'
                  : entry.storage.reason === 'reservation'
                    ? 'export.fail.storageReservation'
                    : 'export.fail.storageNumbers',
              )
                .replace('{required}', formatStorageBytes(entry.storage.requiredBytes, 'up'))
                .replace('{free}', formatStorageBytes(entry.storage.freeBytes, 'down'))}
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
