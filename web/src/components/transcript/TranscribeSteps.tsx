'use client';

import { useEffect, useState } from 'react';

import { activeManifest } from '@/adapters/transcript/transcriptClient';
import { Icon } from '@/components/Icon';
import { formatBytes } from '@/domain/policy';
import { lineClock } from '@/domain/transcript';
import { RECOMMENDED_MODEL, downloadBytes } from '@/domain/transcriptModels';
import type { MessageKey } from '@/i18n/messages';
import type { Transcription } from './useTranscription';

type T = (key: MessageKey) => string;

export function fillText(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Seconds since `startedAt`, ticking once a second while mounted. */
function useElapsedSeconds(startedAt: number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (startedAt === null) return undefined;
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [startedAt]);
  return startedAt === null ? 0 : seconds;
}

/**
 * The steps before there is a transcript (ADR-036), shared by the wizard and
 * the editor's dialog:
 *
 * - what it does and what it does not (English only, on this device);
 * - the model: an explicit download with its real size and real progress,
 *   never started by itself; a stopped download continues where it was;
 * - "Yazıya dök" with real numbers — source time searched, speech spans
 *   written of spans found — and a way to stop.
 *
 * Every figure shown is a count the worker reported. There is no percentage
 * that was not measured.
 */
export function TranscribeSteps({
  t,
  transcription,
  canStart,
  onStart,
  replaceNote,
}: {
  t: T;
  transcription: Transcription;
  /** A video with sound is open. */
  canStart: boolean;
  onStart: () => void;
  /** Said above the start button when lines exist that the transcript would replace. */
  replaceNote?: string | null;
}) {
  const { job, status, model, largeOffered } = transcription;
  const mark = t('time.decimalMark');
  const manifest = activeManifest();
  const size = (bytes: number) => formatBytes(bytes, mark);
  const elapsed = useElapsedSeconds(job.kind === 'transcribing' ? job.startedAt : null);
  const busy = job.kind === 'downloading' || job.kind === 'transcribing';

  const ready = status?.ready === true;
  const partial = status !== null && !status.ready && status.missingBytes < status.totalBytes;

  return (
    <div
      className="transcribe"
      data-testid="transcribe-steps"
      data-job={job.kind}
      data-model-ready={ready}
      // Present only in the e2e build (CLIP_TEST_HOOKS=1): lets a test tell which build it is driving.
      data-test-hooks={process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1' ? '1' : undefined}
    >
      <p className="wizard-note" data-testid="transcribe-english">
        <Icon name="info" />
        <span>
          {t('transcript.english')} {t('transcript.onDevice')}
        </span>
      </p>

      {largeOffered && !busy ? (
        <fieldset className="wizard-choice" data-testid="transcribe-quality">
          <legend>{t('transcript.model.quality')}</legend>
          {/* The recommended model first; the small one stays, as the smaller download. */}
          {([RECOMMENDED_MODEL, 'base'] as const).map((id) => (
            <label className="wizard-option" data-checked={model === id} data-recommended={id === RECOMMENDED_MODEL || undefined} key={id}>
              <input
                type="radio"
                name="transcript-model"
                value={id}
                checked={model === id}
                onChange={() => transcription.chooseModel(id)}
                data-testid={`option-model-${id}`}
              />
              <span className="wizard-option-text">
                <span className="wizard-option-label">
                  {fillText(t(`transcript.model.${id}` as MessageKey), { size: size(downloadBytes(id, manifest)) })}
                </span>
                <span className="wizard-option-hint">{t(`transcript.model.${id}Hint` as MessageKey)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {job.kind === 'downloading' ? (
        <div className="wizard-panel" data-testid="model-downloading">
          <p className="wizard-panel-title" role="status">
            {t(job.progress?.phase === 'checking' ? 'transcript.model.checking' : 'transcript.model.downloading')}
          </p>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={t('transcript.model.downloading')}
            aria-valuemin={0}
            aria-valuemax={job.progress?.bytesTotal ?? 0}
            {...(job.progress ? { 'aria-valuenow': job.progress.bytesDone } : {})}
            aria-valuetext={
              job.progress
                ? fillText(t('transcript.model.progress'), {
                    done: size(job.progress.bytesDone),
                    total: size(job.progress.bytesTotal),
                  })
                : undefined
            }
          >
            <div
              className={job.progress ? 'progress-fill' : 'progress-fill progress-indeterminate'}
              style={
                job.progress && job.progress.bytesTotal > 0
                  ? { width: `${(job.progress.bytesDone / job.progress.bytesTotal) * 100}%` }
                  : undefined
              }
            />
          </div>
          <p className="wizard-panel-big" data-testid="model-progress" aria-hidden="true">
            {job.progress
              ? fillText(t('transcript.model.progress'), {
                  done: size(job.progress.bytesDone),
                  total: size(job.progress.bytesTotal),
                })
              : '…'}
          </p>
          <p className="wizard-hint">{t('transcript.model.stopHint')}</p>
          <button type="button" className="btn" onClick={transcription.cancel} data-testid="model-stop">
            {t('transcript.model.stop')}
          </button>
        </div>
      ) : null}

      {job.kind === 'download-failed' ? (
        <p className="wizard-blocked" role="alert" data-testid="model-failed" data-reason={job.reason}>
          {fillText(t(`transcript.model.failed.${job.reason}` as MessageKey), {
            size: size(status?.missingBytes ?? downloadBytes(model, manifest)),
          })}
        </p>
      ) : null}

      {!busy && status !== null && !ready ? (
        <div className="wizard-panel" data-testid="model-needed">
          <p className="wizard-panel-title">{t('transcript.model.need')}</p>
          <button
            type="button"
            className="btn btn-accent wizard-go"
            onClick={() => void transcription.download()}
            data-testid="model-download"
          >
            <Icon name="download" />
            {fillText(t(partial ? 'transcript.model.resume' : 'transcript.model.download'), {
              size: size(status.missingBytes),
            })}
          </button>
        </div>
      ) : null}

      {job.kind === 'transcribing' ? (
        <div className="wizard-panel" data-testid="transcribe-running" data-phase={job.progress?.phase ?? 'starting'}>
          <p className="wizard-panel-title" role="status" data-testid="transcribe-phase">
            {job.progress === null || job.progress.phase === 'loading'
              ? t('transcript.loading')
              : job.progress.phase === 'listening'
                ? fillText(t('transcript.listening'), {
                    done: lineClock(job.progress.doneUs),
                    total: lineClock(job.progress.totalUs),
                  })
                : fillText(t('transcript.writing'), {
                    done: String(job.progress.spansDone),
                    total: String(job.progress.spansTotal),
                  })}
          </p>
          {(() => {
            const progress = job.progress;
            const [now, max] =
              progress?.phase === 'listening'
                ? [progress.doneUs, progress.totalUs]
                : progress?.phase === 'writing'
                  ? [progress.spansDone, progress.spansTotal]
                  : [null, 0];
            return (
              <div
                className="progress-track"
                role="progressbar"
                aria-label={t('transcript.start')}
                aria-valuemin={0}
                aria-valuemax={max}
                {...(now === null ? {} : { 'aria-valuenow': now })}
              >
                <div
                  className={now === null || max <= 0 ? 'progress-fill progress-indeterminate' : 'progress-fill'}
                  style={now === null || max <= 0 ? undefined : { width: `${(now / max) * 100}%` }}
                />
              </div>
            );
          })()}
          <p className="wizard-hint" data-testid="transcribe-elapsed">
            {fillText(t('transcript.elapsed'), { time: lineClock(elapsed * 1_000_000) })} {t('transcript.keepOpen')}
          </p>
          <button type="button" className="btn" onClick={transcription.cancel} data-testid="transcribe-stop">
            {t('transcript.stop')}
          </button>
        </div>
      ) : null}

      {job.kind === 'failed' ? (
        <p className="wizard-blocked" role="alert" data-testid="transcribe-failed" data-reason={job.reason}>
          {t(`transcript.failed.${job.reason}` as MessageKey)}
        </p>
      ) : null}

      {!busy && ready && job.kind !== 'done' ? (
        <div className="wizard-actions">
          {replaceNote ? (
            <p className="wizard-hint" data-testid="transcribe-replace-note">
              {replaceNote}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-accent wizard-go"
            onClick={onStart}
            disabled={!canStart}
            data-testid="transcribe-start"
          >
            <Icon name="taskText" />
            {t(job.kind === 'failed' ? 'transcript.retry' : 'transcript.start')}
          </button>
          <p className="wizard-hint">{t('transcript.startHint')}</p>
        </div>
      ) : null}
    </div>
  );
}
