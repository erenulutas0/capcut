'use client';

import { useMemo } from 'react';

import { Icon } from '@/components/Icon';
import { Dialog } from './Dialog';
import { assessProject } from '@/adapters/w0MediaEngine';
import type { ProjectV1 } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { formatDurationShort } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import type { MessageKey } from '@/i18n/messages';

interface Props {
  t: (key: MessageKey) => string;
  open: boolean;
  onClose: () => void;
  project: ProjectV1;
  totalSourceBytes: number;
  onShortEdgeChange: (shortEdge: number) => void;
}

/**
 * Honest export panel. Numbers come from the real project; the create button is
 * disabled because W0 has no encoder. There is no progress bar, no fake file
 * name and no success state to simulate.
 */
export function ExportDialog({
  t,
  open,
  onClose,
  project,
  totalSourceBytes,
  onShortEdgeChange,
}: Props) {
  const report = useMemo(
    () => (open ? assessProject(project, WEB_LOCAL_POLICY, totalSourceBytes) : null),
    [open, project, totalSourceBytes],
  );

  const totalUs = totalOutputDurationUs(project);
  const policyBlockers = (report?.blockers ?? []).filter(
    (blocker) =>
      blocker === 'no_clips' ||
      blocker === 'output_duration_exceeds_policy' ||
      blocker === 'source_duration_exceeds_policy' ||
      blocker === 'source_bytes_exceed_policy',
  );

  return (
    <Dialog open={open} onClose={onClose} labelledBy="export-title">
      <div className="dialog-head">
        <div>
          <p className="dialog-eyebrow">{t('export.eyebrow')}</p>
          <h2 id="export-title">{t('export.title')}</h2>
          <p className="dialog-sub">{t('export.subtitle')}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('export.close')}>
          <Icon name="close" />
        </button>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <b data-testid="export-duration">{formatDurationShort(totalUs)}</b>
          <span>{t('export.totalDuration')}</span>
        </div>
        <div className="summary-card">
          <b data-testid="export-aspect">{project.canvas.aspect}</b>
          <span>{t('export.aspect')}</span>
        </div>
        <div className="summary-card">
          <b>MP4</b>
          <span>{t('export.format')}</span>
        </div>
      </div>

      <label className="field-label" htmlFor="export-quality">
        {t('export.quality')}
      </label>
      <select
        id="export-quality"
        className="select"
        value={project.export.shortEdge}
        onChange={(event) => onShortEdgeChange(Number(event.target.value))}
        data-testid="export-quality"
      >
        <option value={1080}>1080p · H.264 / AAC</option>
        <option value={720}>720p · H.264 / AAC</option>
      </select>

      <div className="notice notice-warning" style={{ marginTop: 16 }}>
        <Icon name="alert" size={16} />
        <span>
          <b>{t('export.engineTitle')}</b>
          {t('export.engineBody')}
        </span>
      </div>

      {policyBlockers.length > 0 ? (
        <ul className="meta-list" style={{ marginTop: 14 }} data-testid="export-blockers">
          {policyBlockers.map((blocker) => (
            <li key={blocker}>
              <span className="meta-key">{t(`export.blocked.${blocker}` as MessageKey)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {report ? (
        <>
          <hr className="divider" />
          <p className="field-label">{t('export.detected')}</p>
          <ul className="meta-list">
            <li>
              <span className="meta-key">{t('export.videoEncoder')}</span>
              <span className="meta-value" data-testid="detect-video-encoder">
                {report.detected.videoEncoderApi ? t('export.present') : t('export.absent')}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('export.audioEncoder')}</span>
              <span className="meta-value">
                {report.detected.audioEncoderApi ? t('export.present') : t('export.absent')}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('export.secureContext')}</span>
              <span className="meta-value">
                {report.detected.secureContext ? t('export.present') : t('export.absent')}
              </span>
            </li>
          </ul>
          <p className="hint-small">{t('export.detectedNote')}</p>
        </>
      ) : null}

      <div className="notice" style={{ marginTop: 16 }}>
        <Icon name="shield" size={16} />
        <span>{t('export.privacy')}</span>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('export.close')}
        </button>
        <button
          type="button"
          className="btn btn-accent"
          disabled
          aria-disabled="true"
          title={t('export.createDisabled')}
          data-testid="export-create"
        >
          {t('export.create')}
        </button>
      </div>
    </Dialog>
  );
}
