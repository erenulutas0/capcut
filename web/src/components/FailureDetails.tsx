'use client';

import { failureDetailLine, type ExportFailureDetail } from '@/domain/exportFailureDetail';
import type { MessageKey } from '@/i18n/messages';
import { useReportProblem } from './ReportProblem';

/**
 * "Ayrıntılar" under a failure nobody planned for (ADR-042): where it broke
 * and with what kind of error, as one line of engineering words, closed
 * until asked for. The sentence above it stays plain. The line is built from
 * checked values only (`ExportFailureDetail`); the error's own text is never
 * here. The same line is in the "Sorun bildir" file, which is one press away.
 */
export function FailureDetails({
  t,
  detail,
  testId,
}: {
  t: (key: MessageKey) => string;
  detail: ExportFailureDetail | null | undefined;
  /** `<testId>-details` is the disclosure, `<testId>-detail` the line, `<testId>-report` the "Sorun bildir" button. */
  testId: string;
}) {
  const report = useReportProblem();
  if (!detail) return null;
  return (
    <details className="dl-details" data-testid={`${testId}-details`}>
      <summary>{t('download.details')}</summary>
      <p className="dl-tech" data-testid={`${testId}-detail`}>
        {failureDetailLine(detail, t('export.failDetail.frame'))}
      </p>
      <p className="hint-small">{t('export.failDetail.note')}</p>
      {report ? (
        <button type="button" className="link-button" onClick={report} data-testid={`${testId}-report`}>
          {t('support.open')}
        </button>
      ) : null}
    </details>
  );
}
