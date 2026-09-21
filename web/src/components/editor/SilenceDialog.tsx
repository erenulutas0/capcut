'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import type { SilenceCutReport, SilenceCutResult } from '@/application/commands';
import {
  previewSilenceCuts,
  reviewSilences,
  type ClipReview,
  type ReviewedSuggestion,
} from '@/application/silenceReview';
import { primaryCaptionTrack } from '@/domain/captions';
import type { Project } from '@/domain/edl';
import {
  DEFAULT_SILENCE_PARAMS,
  SILENCE_PARAM_LIMITS,
  type ClipSilence,
  type LoudnessEnvelope,
  type SilenceParams,
} from '@/domain/silence';
import { US_PER_SECOND, formatDurationShort, formatTimecode, secondsToUs, type Micros } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';
import { Dialog } from './Dialog';
import type { SilenceRun } from './useSilenceAnalysis';

type T = (key: MessageKey) => string;

/** How much source is played on each side of a cut by "Dinle". */
const LISTEN_CONTEXT_US: Micros = 1_000_000;
/** Envelope frames are 10 ms; progress is shown in seconds of audio. */
const FRAMES_PER_SECOND = 100;

/** Fills `{name}` slots; a replacer function keeps "$" literal. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

function rangeLabel(item: { startUs: Micros; endUs: Micros }): string {
  return `${formatTimecode(item.startUs)} — ${formatTimecode(item.endUs)}`;
}

interface Props {
  t: T;
  project: Project;
  /** Object URL of the linked video, used only to play the audio around a cut. */
  videoUrl: string;
  run: SilenceRun;
  envelopeFor: (range: { sourceInUs: Micros; sourceOutUs: Micros }) => LoudnessEnvelope | undefined;
  onRetry: () => void;
  onCancel: () => void;
  onApply: (removals: readonly ClipSilence[]) => SilenceCutResult;
  onClose: () => void;
  /** Pauses the main preview so two players never talk over each other. */
  onBeforeListen: () => void;
}

type Listening = { id: string; mode: 'plain' | 'cut' };

/**
 * Review dialog for silence-cut suggestions (ADR-018, doc 31 "AI önerisi
 * veri, komut değil"): the suggestions are data the user inspects, listens
 * to and toggles; only "Uygula" runs the domain command, as one undo step.
 */
export function SilenceDialog({
  t,
  project,
  videoUrl,
  run,
  envelopeFor,
  onRetry,
  onCancel,
  onApply,
  onClose,
  onBeforeListen,
}: Props) {
  const [params, setParams] = useState<SilenceParams>(DEFAULT_SILENCE_PARAMS);
  // Only the user's explicit toggles are stored; everything else follows the
  // default selection. Ids include the cut's range, so a parameter change
  // (new ranges) naturally falls back to the new defaults.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [applied, setApplied] = useState<{ report: SilenceCutReport; project: Project } | null>(null);
  const [listening, setListening] = useState<Listening | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const reportHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const review = useMemo(() => reviewSilences(project, envelopeFor, params), [project, envelopeFor, params]);
  const isChecked = (item: ReviewedSuggestion) => overrides.get(item.id) ?? review.defaultIds.has(item.id);
  const chosen = review.suggestions.filter(isChecked);
  const preview = previewSilenceCuts(project, chosen);
  const running = run.status === 'running';
  // The report describes the recipe it produced; an undo from inside the
  // dialog brings the list back instead of leaving a stale report.
  const report = applied && applied.project === project ? applied.report : null;

  const stopListening = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    audioRef.current?.pause();
    setListening(null);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      audio?.pause();
    };
  }, []);

  // "Uygula" disappears with the list; focus moves to the report instead of
  // falling back to the page behind the dialog.
  const hasReport = report !== null;
  useEffect(() => {
    if (hasReport) reportHeadingRef.current?.focus();
  }, [hasReport]);

  /**
   * Plays the source from 1 s before to 1 s after the cut, kept inside the
   * moment (what is outside it is not in the output either). "cut" skips the
   * suggested range, so the user hears the join as it would be.
   */
  const listen = (clip: ClipReview, item: ReviewedSuggestion, mode: Listening['mode']) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (listening?.id === item.id && listening.mode === mode) {
      stopListening();
      return;
    }
    stopListening();
    onBeforeListen();
    const fromUs = Math.max(clip.sourceInUs, item.startUs - LISTEN_CONTEXT_US);
    const toUs = Math.min(clip.sourceOutUs, item.endUs + LISTEN_CONTEXT_US);
    audio.currentTime = fromUs / US_PER_SECOND;
    setListening({ id: item.id, mode });
    // Jump once: after the seek the element may report a hair before the
    // target (float seconds), which must not read as "still inside the cut".
    let jumped = false;
    const tick = () => {
      const nowUs = secondsToUs(audio.currentTime);
      if (mode === 'cut' && !jumped && nowUs >= item.startUs) {
        jumped = true;
        audio.currentTime = item.endUs / US_PER_SECOND;
      } else if (nowUs >= toUs || audio.ended) {
        stopListening();
        return;
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    audio
      .play()
      .then(() => {
        frameRef.current = window.requestAnimationFrame(tick);
      })
      .catch(() => setListening(null));
  };

  const toggle = (item: ReviewedSuggestion) => {
    const next = new Map(overrides);
    next.set(item.id, !isChecked(item));
    setOverrides(next);
  };

  const apply = () => {
    if (preview.kind !== 'ok') return;
    stopListening();
    const result = onApply(chosen);
    if (result.ok) setApplied({ report: result.report, project: result.project });
  };

  const setParam = (patch: Partial<SilenceParams>) => setParams((current) => ({ ...current, ...patch }));

  const track = primaryCaptionTrack(project);
  const captionsOn = (track?.cues.length ?? 0) > 0;
  const analysed = review.clips.length - review.pending;
  const percent =
    run.status === 'running' && run.framesTotal > 0
      ? Math.min(100, Math.floor((run.framesDone / run.framesTotal) * 100))
      : null;

  let status = '';
  if (report) status = t('silence.applied.title');
  else if (running) status = t('silence.running');
  else if (run.status === 'failed') status = t(`silence.failed.${run.reason}` as MessageKey);
  else if (run.status === 'canceled') status = t('silence.canceled');
  else if (analysed > 0) {
    status =
      review.suggestions.length > 0
        ? fill(t('silence.found'), { count: review.suggestions.length, checked: chosen.length })
        : t('silence.foundNone');
  }

  return (
    <Dialog open onClose={onClose} labelledBy="silence-title" wide>
      <div className="dialog-head">
        <div>
          <p className="dialog-eyebrow">{t('silence.eyebrow')}</p>
          <h2 id="silence-title">{t('silence.title')}</h2>
          <p className="dialog-sub">{t('silence.intro')}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('silence.close')}>
          <Icon name="close" />
        </button>
      </div>

      <div className="notice" style={{ marginBottom: 14 }}>
        <Icon name="shield" size={16} />
        <span>{t('silence.local')}</span>
      </div>

      {/* Announced politely: phase changes and result counts, not every tick. */}
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="silence-status">
        {status}
      </p>

      {running ? (
        <div className="silence-running" data-testid="silence-running">
          <div className="slider-head">
            <span className="field-label" style={{ margin: 0 }}>
              {t('silence.running')}
            </span>
            <span className="slider-value" data-testid="silence-progress">
              {percent === null
                ? t('silence.progressStarting')
                : fill(t('silence.progressValue'), {
                    percent,
                    done: (run.framesDone / FRAMES_PER_SECOND).toFixed(1),
                    total: (run.framesTotal / FRAMES_PER_SECOND).toFixed(1),
                  })}
            </span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={t('silence.running')}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(percent === null ? {} : { 'aria-valuenow': percent })}
          >
            <div
              className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <div className="dialog-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={onCancel} data-testid="silence-cancel">
              <Icon name="close" />
              {t('silence.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {run.status === 'failed' || run.status === 'canceled' ? (
        <div className="silence-problem" data-testid="silence-problem" data-reason={run.status === 'failed' ? run.reason : 'canceled'}>
          <p className={run.status === 'failed' ? 'inline-error' : 'hint-small'} role={run.status === 'failed' ? 'alert' : undefined}>
            <Icon name={run.status === 'failed' ? 'alert' : 'info'} />
            {run.status === 'failed' ? t(`silence.failed.${run.reason}` as MessageKey) : t('silence.canceled')}
          </p>
          {run.status === 'failed' && run.reason === 'no_audio' ? null : (
            <button type="button" className="btn" style={{ marginTop: 10 }} onClick={onRetry} data-testid="silence-retry">
              {t('silence.retry')}
            </button>
          )}
        </div>
      ) : null}

      {report ? (
        <section className="silence-report" data-testid="silence-report" aria-labelledby="silence-report-title">
          <h3 id="silence-report-title" tabIndex={-1} ref={reportHeadingRef}>
            <Icon name="check" />
            {t('silence.applied.title')}
          </h3>
          <ul className="meta-list">
            <li>
              <span className="meta-key">{t('silence.applied.removed')}</span>
              <span className="meta-value" data-testid="silence-report-removed">
                {formatDurationShort(report.removedUs)}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('silence.applied.moments')}</span>
              <span className="meta-value" data-testid="silence-report-moments">
                {report.clipsBefore} → {report.clipsAfter}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('silence.applied.dropped')}</span>
              <span className="meta-value" data-testid="silence-report-dropped">
                {report.droppedPieces}
              </span>
            </li>
          </ul>
          <p className="hint-small" style={{ marginTop: 10 }}>
            {t('silence.applied.undo')} {t('silence.editAfter')}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-accent" onClick={onClose} data-testid="silence-done">
              {t('silence.close')}
            </button>
          </div>
        </section>
      ) : (
        <>
          {analysed > 0 ? (
            <>
              <fieldset className="silence-params">
                <legend className="field-label">{t('silence.params')}</legend>
                <div className="silence-param">
                  <div className="slider-head">
                    <label className="field-label" htmlFor="silence-min" style={{ margin: 0 }}>
                      {t('silence.param.minSilence')}
                    </label>
                    <span className="slider-value">{(params.minSilenceUs / US_PER_SECOND).toFixed(1)}</span>
                  </div>
                  <input
                    id="silence-min"
                    type="range"
                    min={SILENCE_PARAM_LIMITS.minSilenceUs.min / US_PER_SECOND}
                    max={SILENCE_PARAM_LIMITS.minSilenceUs.max / US_PER_SECOND}
                    step={0.1}
                    value={params.minSilenceUs / US_PER_SECOND}
                    aria-describedby="silence-min-hint"
                    onChange={(event) =>
                      setParam({ minSilenceUs: Math.round(Number(event.target.value) * 10) * 100_000 })
                    }
                    data-testid="silence-min"
                  />
                  <span className="hint-small" id="silence-min-hint">
                    {t('silence.param.minSilence.hint')}
                  </span>
                </div>
                <div className="silence-param">
                  <div className="slider-head">
                    <label className="field-label" htmlFor="silence-keep" style={{ margin: 0 }}>
                      {t('silence.param.keep')}
                    </label>
                    <span className="slider-value">{Math.round(params.keepUs / 1000)}</span>
                  </div>
                  <input
                    id="silence-keep"
                    type="range"
                    min={SILENCE_PARAM_LIMITS.keepUs.min / 1000}
                    max={SILENCE_PARAM_LIMITS.keepUs.max / 1000}
                    step={10}
                    value={params.keepUs / 1000}
                    aria-describedby="silence-keep-hint"
                    onChange={(event) => setParam({ keepUs: Math.round(Number(event.target.value)) * 1000 })}
                    data-testid="silence-keep"
                  />
                  <span className="hint-small" id="silence-keep-hint">
                    {t('silence.param.keep.hint')}
                  </span>
                </div>
                <div className="silence-param">
                  <div className="slider-head">
                    <label className="field-label" htmlFor="silence-sensitivity" style={{ margin: 0 }}>
                      {t('silence.param.sensitivity')}
                    </label>
                    <span className="slider-value">
                      {params.sensitivityDb > 0 ? `+${params.sensitivityDb}` : params.sensitivityDb}
                    </span>
                  </div>
                  <input
                    id="silence-sensitivity"
                    type="range"
                    min={SILENCE_PARAM_LIMITS.sensitivityDb.min}
                    max={SILENCE_PARAM_LIMITS.sensitivityDb.max}
                    step={1}
                    value={params.sensitivityDb}
                    aria-describedby="silence-sensitivity-hint"
                    onChange={(event) => setParam({ sensitivityDb: Math.round(Number(event.target.value)) })}
                    data-testid="silence-sensitivity"
                  />
                  <span className="hint-small" id="silence-sensitivity-hint">
                    {t('silence.param.sensitivity.hint')}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setParams(DEFAULT_SILENCE_PARAMS)}
                  disabled={params === DEFAULT_SILENCE_PARAMS}
                  data-testid="silence-reset"
                >
                  {t('silence.param.reset')}
                </button>
              </fieldset>

              {captionsOn && track?.timeBase === 'output' ? (
                <div className="notice notice-warning" style={{ marginTop: 14 }} data-testid="silence-captions-output">
                  <Icon name="alert" size={16} />
                  <span>{t('silence.captions.output')}</span>
                </div>
              ) : null}
              {captionsOn && track?.timeBase === 'source' ? (
                <p className="hint-small" style={{ marginTop: 14 }} data-testid="silence-captions-source">
                  {t('silence.captions.source')}
                </p>
              ) : null}

              <h3 className="silence-results-title">{t('silence.resultsTitle')}</h3>
              <p className="hint-small">{t('silence.how')}</p>
              <ol className="silence-clips" data-testid="silence-clips">
                {review.clips.map((clip) => (
                  <li key={clip.clipId} className="silence-clip" data-testid="silence-clip" data-status={clip.status}>
                    <p className="silence-clip-head">
                      <b>{fill(t('silence.moment'), { index: String(clip.index + 1).padStart(2, '0') })}</b>
                      <span className="silence-time">{rangeLabel({ startUs: clip.sourceInUs, endUs: clip.sourceOutUs })}</span>
                    </p>
                    {clip.status !== 'ok' ? (
                      <p className="silence-note" data-testid="silence-note">
                        <Icon name="info" size={16} />
                        {t(`silence.note.${clip.status}` as MessageKey)}
                      </p>
                    ) : clip.suggestions.length === 0 ? (
                      <p className="silence-note" data-testid="silence-note">
                        <Icon name="info" size={16} />
                        {t('silence.note.none')}
                      </p>
                    ) : (
                      <ul className="silence-rows">
                        {clip.suggestions.map((item) => {
                          const checkboxId = `silence-${item.id}`;
                          const range = rangeLabel(item);
                          const active = listening?.id === item.id ? listening.mode : undefined;
                          return (
                            <li
                              key={item.id}
                              className="silence-row"
                              data-testid="silence-suggestion"
                              data-start-us={item.startUs}
                              data-end-us={item.endUs}
                              data-listening={active ?? ''}
                            >
                              <label className="silence-check" htmlFor={checkboxId}>
                                <input
                                  id={checkboxId}
                                  type="checkbox"
                                  checked={isChecked(item)}
                                  onChange={() => toggle(item)}
                                  data-testid="silence-check"
                                />
                                <span className="silence-time">{range}</span>
                                <span className="silence-length">{formatDurationShort(item.endUs - item.startUs)}</span>
                              </label>
                              <div className="silence-listen">
                                <button
                                  type="button"
                                  className="btn"
                                  aria-pressed={active === 'plain'}
                                  aria-label={fill(t('silence.listen.label'), { range })}
                                  onClick={() => listen(clip, item, 'plain')}
                                  data-testid="silence-listen"
                                >
                                  <Icon name={active === 'plain' ? 'pause' : 'play'} size={16} />
                                  {active === 'plain' ? t('silence.listenStop') : t('silence.listen')}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  aria-pressed={active === 'cut'}
                                  aria-label={fill(t('silence.listenCut.label'), { range })}
                                  onClick={() => listen(clip, item, 'cut')}
                                  data-testid="silence-listen-cut"
                                >
                                  <Icon name={active === 'cut' ? 'pause' : 'scissors'} size={16} />
                                  {active === 'cut' ? t('silence.listenStop') : t('silence.listenCut')}
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
              {review.suggestions.length > 0 ? <p className="hint-small">{t('silence.listen.hint')}</p> : null}

              {review.leftOut > 0 ? (
                <div className="notice notice-warning" style={{ marginTop: 12 }} data-testid="silence-left-out">
                  <Icon name="alert" size={16} />
                  <span>
                    {fill(t('silence.limit.leftOut'), {
                      selected: review.defaultIds.size,
                      leftOut: review.leftOut,
                    })}
                  </span>
                </div>
              ) : null}

              {/* Not live: every checkbox would re-read the whole summary. The
                  status line above announces the count, and the apply button
                  points here with aria-describedby. */}
              <section className="silence-summary" aria-labelledby="silence-summary-title" id="silence-summary">
                <h3 id="silence-summary-title" className="field-label">
                  {t('silence.summary')}
                </h3>
                {preview.kind === 'ok' ? (
                  <>
                    <div className="silence-summary-grid">
                      <div className="summary-card">
                        <b data-testid="silence-summary-duration">
                          {formatTimecode(preview.outputBeforeUs)} → {formatTimecode(preview.outputAfterUs)}
                        </b>
                        <span>{t('silence.summary.duration')}</span>
                      </div>
                      <div className="summary-card">
                        <b data-testid="silence-summary-moments">
                          {preview.clipsBefore} → {preview.clipsAfter}
                        </b>
                        <span>{t('silence.summary.moments')}</span>
                      </div>
                    </div>
                    {preview.droppedPieces > 0 ? (
                      <p className="hint-small">{fill(t('silence.summary.dropped'), { count: preview.droppedPieces })}</p>
                    ) : null}
                  </>
                ) : preview.kind === 'limit' ? (
                  <p className="inline-error" data-testid="silence-limit-exceeded">
                    <Icon name="alert" />
                    {fill(t('silence.limit.exceeded'), { count: preview.clipsAfter, max: preview.maxClips })}
                  </p>
                ) : (
                  <p className="hint-small" data-testid="silence-summary-nothing">
                    {t('silence.summary.nothing')}
                  </p>
                )}
              </section>
              <p className="hint-small" style={{ marginTop: 10 }}>
                {t('silence.editAfter')}
              </p>
            </>
          ) : null}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose} data-testid="silence-dismiss">
              {t('silence.dismiss')}
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={apply}
              disabled={running || preview.kind !== 'ok'}
              aria-describedby={analysed > 0 ? 'silence-summary' : undefined}
              data-testid="silence-apply"
            >
              <Icon name="scissors" />
              {t('silence.apply')}
            </button>
          </div>
        </>
      )}

      {/* The source's own audio, for "Dinle"; never autoplays. */}
      <audio ref={audioRef} src={videoUrl} preload="auto" className="visually-hidden" data-testid="silence-audio" />
    </Dialog>
  );
}
