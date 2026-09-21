'use client';

import { useEffect, useMemo, useRef } from 'react';

import { Icon } from '@/components/Icon';
import { Dialog } from './Dialog';
import { useExport, type ExportUiState } from './useExport';
import type { CapabilityReportV1 } from '@/adapters/exportCapability';
import { environmentPasses } from '@/adapters/exportCapability';
import type { Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY, formatBytes } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { formatDurationShort, formatTimecode } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import type { MessageKey } from '@/i18n/messages';

interface Props {
  t: (key: MessageKey) => string;
  open: boolean;
  onClose: () => void;
  project: Project;
  videoFile: File | null;
  audioFile: File | null;
  onShortEdgeChange: (shortEdge: number) => void;
}

type GateState = true | false | null;

function GateRow({
  label,
  state,
  t,
  testId,
}: {
  label: string;
  state: GateState;
  t: (key: MessageKey) => string;
  testId?: string;
}) {
  const text =
    state === true ? t('export.gate.pass') : state === false ? t('export.gate.fail') : t('export.gate.pending');
  const color = state === true ? 'var(--success)' : state === false ? 'var(--danger)' : 'var(--muted)';
  return (
    <li>
      <span className="meta-key">{label}</span>
      <span className="meta-value" style={{ color }} data-testid={testId}>
        {state === true ? '✓ ' : state === false ? '✕ ' : '· '}
        {text}
      </span>
    </li>
  );
}

function CapabilityGate({
  t,
  report,
}: {
  t: (key: MessageKey) => string;
  report: CapabilityReportV1;
}) {
  const encoder = report.encoder;
  return (
    <>
      <p className="field-label">{t('export.gate')}</p>
      <ul className="meta-list" data-testid="capability-gate">
        <GateRow
          t={t}
          label={t('export.gate.environment')}
          state={environmentPasses(report.environment)}
          testId="gate-environment"
        />
        <GateRow
          t={t}
          label={t('export.gate.encoderConfig')}
          state={encoder ? encoder.videoConfigSupported && encoder.audioConfigSupported : null}
          testId="gate-encoder"
        />
        <GateRow
          t={t}
          label={t('export.gate.selfTest')}
          state={encoder ? encoder.selfTestPassed : null}
          testId="gate-selftest"
        />
        <GateRow
          t={t}
          label={t('export.gate.source')}
          state={report.source ? report.source.videoDecodable : null}
          testId="gate-source"
        />
      </ul>
    </>
  );
}

function RunningPanel({
  t,
  state,
  onCancel,
}: {
  t: (key: MessageKey) => string;
  state: Extract<ExportUiState, { phase: 'running' }>;
  onCancel: () => void;
}) {
  const percent = state.progress === null ? null : Math.round(state.progress * 100);
  const stepKey = `export.running.${state.step}` as MessageKey;

  return (
    <div data-testid="export-running">
      <div className="slider-head">
        <span className="field-label" style={{ margin: 0 }}>
          {t(stepKey)}
        </span>
        <span className="slider-value" data-testid="export-progress">
          {percent === null
            ? '—'
            : `%${percent} · ${state.framesDone}/${state.totalFrames} ${t('export.running.frames')}`}
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === null ? {} : { 'aria-valuenow': percent })}
      >
        <div
          className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <button
        type="button"
        className="btn btn-block"
        style={{ marginTop: 14 }}
        onClick={onCancel}
        data-testid="export-cancel"
      >
        {t('export.cancel')}
      </button>
    </div>
  );
}

export function ExportDialog({
  t,
  open,
  onClose,
  project,
  videoFile,
  audioFile,
  onShortEdgeChange,
}: Props) {
  const { state, check, start, cancel, reset, isRunning } = useExport(project, videoFile, audioFile);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);
  const checkedFor = useRef<string | null>(null);

  const compiled = useMemo(() => compileRenderPlan(project, WEB_LOCAL_POLICY), [project]);
  const totalUs = totalOutputDurationUs(project);
  const planKey = compiled.ok ? `${compiled.plan.fingerprint}:${videoFile?.name ?? ''}` : 'invalid';

  // Run the gate once per dialog opening / recipe change, never on every render.
  useEffect(() => {
    if (!open) {
      checkedFor.current = null;
      return;
    }
    if (checkedFor.current === planKey) return;
    checkedFor.current = planKey;
    void check();
  }, [open, planKey, check]);

  const closeDialog = () => {
    if (isRunning) return;
    reset();
    onClose();
  };

  const settingsDisabled = isRunning || state.phase === 'succeeded';

  return (
    <Dialog open={open} onClose={closeDialog} labelledBy="export-title">
      <div className="dialog-head">
        <div>
          <p className="dialog-eyebrow">{t('export.eyebrow')}</p>
          <h2 id="export-title">{t('export.title')}</h2>
          <p className="dialog-sub">
            {state.phase === 'ready' ? t('export.subtitleReady') : t('export.subtitle')}
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={closeDialog}
          disabled={isRunning}
          aria-label={t('export.close')}
        >
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
          <b>{compiled.ok ? `${compiled.plan.width}×${compiled.plan.height}` : 'MP4'}</b>
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
        disabled={settingsDisabled}
        onChange={(event) => onShortEdgeChange(Number(event.target.value))}
        data-testid="export-quality"
      >
        <option value={1080}>1080p · H.264 / AAC</option>
        <option value={720}>720p · H.264 / AAC</option>
      </select>

      <hr className="divider" />

      {state.phase === 'checking' ? (
        <p className="hint" data-testid="export-checking">
          {t('export.checking')}
        </p>
      ) : null}

      {state.phase === 'ready' ? (
        <>
          <div className="notice" style={{ borderColor: '#3f5a42' }}>
            <Icon name="check" size={16} />
            <span data-testid="export-ready">{t('export.ready')}</span>
          </div>
          <div style={{ marginTop: 16 }}>
            <CapabilityGate t={t} report={state.report} />
          </div>
        </>
      ) : null}

      {state.phase === 'blocked' ? (
        <>
          <div className="notice notice-warning" data-testid="export-blocked">
            <Icon name="alert" size={16} />
            <span>
              <b>{t('export.blockedTitle')}</b>
              {state.planRejection
                ? t(`export.plan.${state.planRejection}` as MessageKey)
                : t('export.blockedBody')}
            </span>
          </div>
          {state.report ? (
            <div style={{ marginTop: 16 }}>
              <CapabilityGate t={t} report={state.report} />
              {state.report.blockers.length > 0 ? (
                <ul className="meta-list" style={{ marginTop: 12 }} data-testid="export-blockers">
                  {state.report.blockers.map((code) => (
                    <li key={code}>
                      <span className="meta-key">{t(`export.fail.${code}` as MessageKey)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {state.phase === 'running' ? <RunningPanel t={t} state={state} onCancel={cancel} /> : null}

      {state.phase === 'canceled' ? (
        <div className="notice" data-testid="export-canceled">
          <Icon name="info" size={16} />
          <span>
            <b>{t('export.canceledTitle')}</b>
            {t('export.canceledBody')}
          </span>
        </div>
      ) : null}

      {state.phase === 'failed' ? (
        <div className="notice notice-warning" data-testid="export-failed">
          <Icon name="alert" size={16} />
          <span>
            <b>{t('export.failedTitle')}</b>
            {t(`export.fail.${state.code}` as MessageKey)}
          </span>
        </div>
      ) : null}

      {state.phase === 'succeeded' ? (
        <div data-testid="export-succeeded">
          <div className="notice" style={{ borderColor: '#3f5a42' }}>
            <Icon name="check" size={16} />
            <span>
              <b>{t('export.succeededTitle')}</b>
              {t('export.succeededBody')}
            </span>
          </div>

          <p className="field-label" style={{ marginTop: 16 }}>
            {t('export.measured')}
          </p>
          <ul className="meta-list">
            <li>
              <span className="meta-key">{t('export.measuredDuration')}</span>
              <span className="meta-value" data-testid="measured-duration">
                {formatTimecode(state.result.probe.durationUs)}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('export.measuredResolution')}</span>
              <span className="meta-value" data-testid="measured-resolution">
                {state.result.probe.width}×{state.result.probe.height}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('export.measuredCodecs')}</span>
              <span className="meta-value" data-testid="measured-codecs">
                {state.result.probe.videoCodec ?? '—'} ·{' '}
                {state.result.probe.audioCodec ?? t('export.noAudioTrack')}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('export.measuredSize')}</span>
              <span className="meta-value">{formatBytes(state.result.sizeBytes)}</span>
            </li>
            <li>
              <span className="meta-key">{t('export.measuredDelta')}</span>
              <span className="meta-value" data-testid="measured-delta">
                {state.result.durationDeltaUs > 0 ? '+' : ''}
                {state.result.durationDeltaUs} µs
              </span>
            </li>
            <li>
              <span className="meta-key">{t('export.route')}</span>
              <span className="meta-value" data-testid="measured-route">
                {state.result.route === 'opfs' ? t('export.route.opfs') : t('export.route.memory')}
              </span>
            </li>
            {state.result.framesMissing > 0 ? (
              <li>
                <span className="meta-key">{t('export.framesMissing')}</span>
                <span className="meta-value" data-testid="measured-frames-missing">
                  {t('export.framesMissing.value').replace('{count}', String(state.result.framesMissing))}
                </span>
              </li>
            ) : null}
            <li>
              <span className="meta-key">{t('export.elapsed')}</span>
              <span className="meta-value">{(state.result.elapsedMs / 1000).toFixed(1)} s</span>
            </li>
          </ul>

          {/* The browser saves the file only when the user asks for it. */}
          <a
            ref={downloadRef}
            className="btn btn-accent btn-block"
            style={{ marginTop: 16, textDecoration: 'none' }}
            href={state.url}
            download={state.fileName}
            data-testid="export-download"
          >
            <Icon name="download" />
            {t('export.save')}
          </a>
          <button
            type="button"
            className="btn btn-block"
            style={{ marginTop: 8 }}
            onClick={() => void check()}
            data-testid="export-again"
          >
            {t('export.again')}
          </button>
        </div>
      ) : null}

      <div className="notice" style={{ marginTop: 16 }}>
        <Icon name="shield" size={16} />
        <span>{t('export.localNote')}</span>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={closeDialog} disabled={isRunning}>
          {t('export.close')}
        </button>
        {state.phase === 'blocked' || state.phase === 'failed' || state.phase === 'canceled' ? (
          <button type="button" className="btn" onClick={() => void check()} data-testid="export-recheck">
            {t('export.recheck')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-accent"
          disabled={state.phase !== 'ready'}
          aria-disabled={state.phase !== 'ready'}
          title={state.phase === 'ready' ? undefined : t('export.createDisabled')}
          onClick={() => void start()}
          data-testid="export-create"
        >
          {t('export.run')}
        </button>
      </div>
    </Dialog>
  );
}
