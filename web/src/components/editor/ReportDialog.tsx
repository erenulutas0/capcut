'use client';

import { useCallback, useEffect, useState } from 'react';

import { withBasePath } from '@/basePath';
import { Icon } from '@/components/Icon';
import { ExportLogPanel } from '@/components/ExportLogPanel';
import { SUPPORT_CONTACT, collectDiagnostics } from '@/adapters/diagnostics';
import { diagnosticsFileName, type DiagnosticsReport } from '@/domain/diagnostics';
import type { Project } from '@/domain/edl';
import type { MessageKey } from '@/i18n/messages';
import { Dialog } from './Dialog';

/** Only an https address becomes a link; anything else stays plain text. */
const SUPPORT_IS_URL = /^https:\/\/[^\s]+$/.test(SUPPORT_CONTACT);
/**
 * GitHub issues are world-readable. The user must hear that before writing
 * anything, not discover it afterwards.
 */
const SUPPORT_IS_PUBLIC = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues/.test(SUPPORT_CONTACT);

const CONTAINS: MessageKey[] = [
  'support.contains.app',
  'support.contains.browser',
  'support.contains.features',
  'support.contains.project',
  'support.contains.log',
];

/**
 * "Sorun bildir": shows the whole diagnostics file before the user decides to
 * download it (doc 28: "kullanıcı gönderilen alanları görür"). The dialog
 * never sends anything; there is no network code on this path at all. The
 * user downloads the file and sends it themselves, to the address the build
 * was given — or, while none is decided, to whoever invited them.
 *
 * Mounted only while open, so every opening reads fresh values.
 */
export function ReportDialog({
  t,
  onClose,
  project,
}: {
  t: (key: MessageKey) => string;
  onClose: () => void;
  project: Project;
}) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  // Bumped when the log is cleared, so the preview matches what is stored.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void collectDiagnostics(project).then((next) => {
      if (!cancelled) setReport(next);
    });
    return () => {
      cancelled = true;
    };
  }, [project, revision]);

  const json = report ? JSON.stringify(report, null, 2) : '';

  const download = useCallback(() => {
    if (!report) return;
    // Exactly the text shown in the preview; nothing is added on the way out.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = diagnosticsFileName(new Date(report.createdAt));
    anchor.click();
    // Revoked on the next task: some browsers start the download after click returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [json, report]);

  return (
    <Dialog open onClose={onClose} labelledBy="report-title" stacked>
      <div className="dialog-head">
        <div>
          <h2 id="report-title">{t('support.title')}</h2>
          <p className="dialog-sub">{t('support.intro')}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('support.close')}>
          <Icon name="close" />
        </button>
      </div>

      <h3 className="report-heading">{t('support.contains')}</h3>
      <ul className="report-list">
        {CONTAINS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <p className="dialog-text" data-testid="report-excludes">
        <b>{t('support.excludes')}</b>
      </p>

      <h3 className="report-heading" id="report-preview-label">
        {t('support.preview')}
      </h3>
      {/* Focusable so keyboard users can scroll it; labelled for screen readers. */}
      <pre
        className="diag-preview"
        tabIndex={0}
        role="region"
        aria-labelledby="report-preview-label"
        aria-busy={report === null}
        data-testid="diag-preview"
      >
        {report ? json : t('support.previewLoading')}
      </pre>

      <button
        type="button"
        className="btn btn-accent btn-block"
        style={{ marginTop: 12 }}
        onClick={download}
        disabled={report === null}
        data-testid="diag-download"
      >
        <Icon name="download" />
        {t('support.download')}
      </button>

      <h3 className="report-heading">{t('support.where')}</h3>
      <p className="dialog-text" data-testid="support-contact">
        {SUPPORT_CONTACT
          ? t('support.contact').replace('{contact}', () => SUPPORT_CONTACT)
          : t('support.contactMissing')}
      </p>
      {SUPPORT_IS_URL ? (
        <p className="dialog-text">
          {/* A new tab: leaving the editor would close the files opened in it. */}
          <a className="btn" href={SUPPORT_CONTACT} target="_blank" rel="noopener noreferrer" data-testid="support-open-issue">
            {t('support.openIssue')}
          </a>
        </p>
      ) : null}
      {SUPPORT_IS_PUBLIC ? (
        <div className="notice notice-warning" role="note" data-testid="support-public-warning">
          {t('support.publicWarning')}
        </div>
      ) : null}
      <p className="hint-small">{t('support.also')}</p>

      <hr className="divider" />

      <h3 className="report-heading">{t('support.log.title')}</h3>
      <ExportLogPanel locale="tr" buttonClassName="btn" onChanged={() => setRevision((value) => value + 1)} />

      <div className="dialog-actions">
        <a className="btn" href={withBasePath('/gizlilik')} target="_blank" rel="noopener" data-testid="report-privacy-link">
          {t('privacy.linkNewTab')}
        </a>
        <button type="button" className="btn" onClick={onClose}>
          {t('support.close')}
        </button>
      </div>
    </Dialog>
  );
}
