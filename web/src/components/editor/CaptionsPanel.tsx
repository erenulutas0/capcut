'use client';

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent } from 'react';

import { Icon } from '@/components/Icon';
import { canvasMeasure } from '@/adapters/captionRender';
import type {
  CaptionConversionResult,
  CaptionCueInput,
  CaptionImportResult,
  CaptionRejection,
  CaptionResult,
  ImportedCueInput,
  ShiftCaptionsResult,
} from '@/application/commands';
import { captionFits, suggestNewCueRange } from '@/domain/captionEditing';
import type { MeasureText } from '@/domain/captionLayout';
import {
  CAPTION_LIMITS,
  CAPTION_POSITIONS,
  CAPTION_PRESETS,
  CAPTION_SIZES,
  DEFAULT_CAPTION_STYLE,
  captionCharCount,
  cueVisibility,
  normalizeCaptionText,
  outputCues,
  primaryCaptionTrack,
  sortCues,
  sourceCueUsage,
  trackTimeAtOutput,
} from '@/domain/captions';
import {
  outputPixelSize,
  type CaptionCueV2,
  type CaptionStyleV2,
  type CaptionTrackV2,
  type Project,
} from '@/domain/edl';
import { formatTimecode, parseTimecode, type Micros } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';
import {
  CaptionClockSection,
  CaptionExportSection,
  CaptionImport,
  CaptionShiftSection,
} from './CaptionTools';
import type { CaptionFontStatus } from './useCaptionFont';
import type { PreviewMode } from './useEditorState';

type CaptionUiError = CaptionRejection | 'caption_no_room' | 'invalid_time' | 'caption_playhead_off_video';

/** A word badge on a line; warnings carry an icon, never colour alone (doc 06). */
interface CueBadge {
  kind: 'warning' | 'info';
  testId: string;
  text: string;
}

/** Refusals about the words themselves; the rest are about the time range. */
const TEXT_ERRORS: ReadonlySet<CaptionUiError> = new Set([
  'caption_text_empty',
  'caption_text_too_long',
  'caption_too_many_lines',
]);

function errorKey(error: CaptionUiError): MessageKey {
  return `captions.error.${error}` as const satisfies MessageKey;
}

interface Props {
  t: (key: MessageKey) => string;
  project: Project;
  /** Project title, for the name of a downloaded SRT/VTT file. */
  title: string;
  outputDurationUs: Micros;
  outputTimeUs: Micros;
  sourceTimeUs: Micros;
  previewMode: PreviewMode;
  fontStatus: CaptionFontStatus;
  onAdd: (input: CaptionCueInput) => CaptionResult;
  onUpdate: (cueId: string, patch: Partial<CaptionCueInput>) => CaptionResult;
  onRemove: (cueId: string) => void;
  onStyle: (patch: Partial<CaptionStyleV2>) => void;
  onLanguage: (language: string) => void;
  onConvert: (target: CaptionTrackV2['timeBase']) => CaptionConversionResult;
  onShift: (deltaUs: Micros) => ShiftCaptionsResult;
  onImport: (cues: readonly ImportedCueInput[], timeBase: CaptionTrackV2['timeBase']) => CaptionImportResult;
  onShowResult: () => void;
  /** Moves the OUTPUT playhead, switching the preview to result mode first. */
  onSeek: (outputUs: Micros) => void;
  /** Moves the SOURCE playhead, switching the preview to source mode first. */
  onSeekSource: (sourceUs: Micros) => void;
}

interface Draft {
  startUs: Micros;
  endUs: Micros;
  text: string;
}

/** A field commit reports a problem to show, or null when it was accepted. */
type Commit<T> = (value: T, leavingEditor: boolean) => CaptionUiError | null;

/**
 * True when focus is moving out of the whole line editor (not just from its
 * text to its time field). A new line is added only then, so the user can
 * type the text and adjust the times before it becomes a recipe change.
 */
function leavesEditor(event: FocusEvent<HTMLElement>): boolean {
  const editor = event.currentTarget.closest('[data-cue-editor]');
  const next = event.relatedTarget;
  return !(editor && next instanceof Node && editor.contains(next));
}

function CaptionTextField({
  id,
  label,
  initial,
  autoFocus,
  invalid,
  describedBy,
  fits,
  noFitLabel,
  onCommit,
}: {
  id: string;
  label: string;
  initial: string;
  autoFocus: boolean;
  invalid: boolean;
  describedBy: string;
  fits: (text: string) => boolean;
  noFitLabel: string;
  onCommit: Commit<string>;
}) {
  // Remounted by its parent whenever the stored text changes (undo, a
  // successful commit), so local state never needs syncing from props. On a
  // refusal the key stays and what the user typed stays with it.
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const count = captionCharCount(normalizeCaptionText(text));
  const over = count > CAPTION_LIMITS.maxTextChars;
  const counterId = `${id}-count`;

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div className="cue-text">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="cue-textarea"
        rows={2}
        value={text}
        aria-invalid={invalid}
        aria-describedby={`${counterId} ${describedBy}`}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => {
          const problem = onCommit(text, leavesEditor(event));
          // Accepted: show exactly what is stored (collapsed spaces, trimmed
          // lines), which the user would otherwise only see after a reload.
          if (problem === null) setText(normalizeCaptionText(text));
        }}
        data-testid="cue-text"
      />
      <div className="cue-text-meta">
        {/* Judged live on what would be stored, before the user leaves the field. */}
        {!fits(text) ? (
          <span className="cue-badge" data-kind="warning" data-testid="cue-badge-nofit">
            <Icon name="alert" size={14} />
            {noFitLabel}
          </span>
        ) : null}
        <span className="cue-counter" id={counterId} data-over={over} data-testid="cue-counter">
          {count}/{CAPTION_LIMITS.maxTextChars}
        </span>
      </div>
    </div>
  );
}

function CaptionTimeField({
  id,
  label,
  hiddenPrefix,
  initialUs,
  invalid,
  testId,
  onCommit,
}: {
  id: string;
  label: string;
  hiddenPrefix: string;
  initialUs: Micros;
  invalid: boolean;
  testId: string;
  onCommit: Commit<Micros>;
}) {
  // Same remount-on-stored-value contract as the text field.
  const [text, setText] = useState(() => formatTimecode(initialUs));
  const [unparsable, setUnparsable] = useState(false);

  return (
    <div className="cue-time">
      <label className="field-label" htmlFor={id}>
        <span className="visually-hidden">{hiddenPrefix} </span>
        {label}
      </label>
      <input
        id={id}
        className="time-input"
        value={text}
        inputMode="decimal"
        aria-invalid={invalid || unparsable}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => {
          const parsed = parseTimecode(text);
          const leaving = leavesEditor(event);
          if (parsed === null) {
            setUnparsable(true);
            onCommit(Number.NaN, leaving);
            return;
          }
          setUnparsable(false);
          // Show what was understood, e.g. "3" -> "00:03.000".
          if (onCommit(parsed, leaving) === null) setText(formatTimecode(parsed));
        }}
        data-testid={testId}
      />
    </div>
  );
}

interface EditorProps {
  t: (key: MessageKey) => string;
  idBase: string;
  /** The shared "2 lines, 120 characters" hint above the list. */
  textHintId: string;
  label: string;
  /** Stored id, or null for the new line. */
  cueId: string | null;
  startUs: Micros;
  endUs: Micros;
  /** Which clock the times are on: "videodaki zamanı" or "sonuçtaki zamanı". */
  clockLabel: string;
  text: string;
  draft: boolean;
  autoFocus: boolean;
  badges: readonly CueBadge[];
  fits: (text: string) => boolean;
  error: CaptionUiError | null;
  onText: Commit<string>;
  onStart: Commit<Micros>;
  onEnd: Commit<Micros>;
  onGoTo: () => void;
  onRemove: () => void;
}

function CueEditor({
  t,
  idBase,
  textHintId,
  label,
  cueId,
  startUs,
  endUs,
  clockLabel,
  text,
  draft,
  autoFocus,
  badges,
  fits,
  error,
  onText,
  onStart,
  onEnd,
  onGoTo,
  onRemove,
}: EditorProps) {
  const errorId = `${idBase}-error`;
  const draftHintId = `${idBase}-hint`;
  return (
    <li
      className="cue-card"
      data-cue-editor=""
      data-draft={draft}
      data-cue-id={cueId ?? ''}
      data-testid={draft ? 'cue-draft' : 'cue-item'}
    >
      <div className="cue-head">
        <b>{label}</b>
        <span className="moment-range" title={clockLabel} data-testid="cue-range">
          {formatTimecode(startUs)} — {formatTimecode(endUs)}
        </span>
      </div>

      {badges.length > 0 ? (
        <p className="cue-badges">
          {badges.map((badge) => (
            <span key={badge.testId} className="cue-badge" data-kind={badge.kind} data-testid={badge.testId}>
              <Icon name={badge.kind === 'warning' ? 'alert' : 'info'} size={14} />
              {badge.text}
            </span>
          ))}
        </p>
      ) : null}

      <CaptionTextField
        // A stored line remounts when its stored text changes (undo, accepted
        // edit). A new line keeps one field for its whole life, so the text
        // the user is typing is never reset and focus is never pulled back.
        key={draft ? 'text-draft' : `text-${text}`}
        id={`${idBase}-text`}
        label={`${label} ${t('captions.textLabel')}`}
        initial={text}
        autoFocus={autoFocus}
        invalid={error !== null && TEXT_ERRORS.has(error)}
        describedBy={draft ? `${textHintId} ${draftHintId} ${errorId}` : `${textHintId} ${errorId}`}
        fits={fits}
        noFitLabel={t('captions.badge.doesNotFit')}
        onCommit={onText}
      />
      {draft ? (
        <p className="hint-small cue-hint" id={draftHintId}>
          {t('captions.draftHint')}
        </p>
      ) : null}

      {/* The legend names the clock, so "00:09.000" is never ambiguous. */}
      <fieldset className="cue-times-group">
        <legend className="cue-clock" data-testid="cue-clock">
          {clockLabel}
        </legend>
        <div className="cue-times">
          <CaptionTimeField
            key={`start-${startUs}`}
            id={`${idBase}-start`}
            label={t('range.start')}
            hiddenPrefix={label}
            initialUs={startUs}
            invalid={error !== null && !TEXT_ERRORS.has(error)}
            testId="cue-start"
            onCommit={onStart}
          />
          <CaptionTimeField
            key={`end-${endUs}`}
            id={`${idBase}-end`}
            label={t('range.end')}
            hiddenPrefix={label}
            initialUs={endUs}
            invalid={error !== null && !TEXT_ERRORS.has(error)}
            testId="cue-end"
            onCommit={onEnd}
          />
        </div>
      </fieldset>

      <div className="cue-actions">
        {draft ? null : (
          <button type="button" className="btn btn-compact" onClick={onGoTo} data-testid="cue-goto">
            <Icon name="play" size={15} />
            {t('captions.goTo')}
            <span className="visually-hidden"> ({label})</span>
          </button>
        )}
        <button
          type="button"
          className={draft ? 'btn btn-compact' : 'icon-btn'}
          onClick={onRemove}
          aria-label={draft ? undefined : `${label}: ${t('captions.remove')}`}
          data-testid={draft ? 'cue-cancel' : 'cue-remove'}
        >
          {draft ? t('captions.cancelDraft') : <Icon name="trash" size={17} />}
        </button>
      </div>

      {/* Always present so screen readers announce a refusal when it appears. */}
      <div aria-live="polite" id={errorId}>
        {error ? (
          <p className="inline-error" role="alert" data-testid="cue-error">
            <Icon name="alert" />
            {t(errorKey(error))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  labelFor,
  onChange,
  testPrefix,
}: {
  legend: string;
  name: string;
  value: T | undefined;
  options: readonly T[];
  labelFor: (option: T) => string;
  onChange: (option: T) => void;
  testPrefix: string;
}) {
  return (
    <fieldset className="caption-choices">
      <legend className="field-label">{legend}</legend>
      <div className="caption-choice-row">
        {options.map((option) => (
          <label key={option} className="radio-row">
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              data-testid={`${testPrefix}-${option}`}
            />
            <span>{labelFor(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const LANGUAGES = ['tr', 'en'] as const;

/** One canvas for measuring; created lazily, only in the browser, only once. */
let measureContext: CanvasRenderingContext2D | null = null;
function fontMeasure(): MeasureText | null {
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
  return measureContext ? canvasMeasure(measureContext) : null;
}

export function CaptionsPanel({
  t,
  project,
  title,
  outputDurationUs,
  outputTimeUs,
  sourceTimeUs,
  previewMode,
  fontStatus,
  onAdd,
  onUpdate,
  onRemove,
  onStyle,
  onLanguage,
  onConvert,
  onShift,
  onImport,
  onShowResult,
  onSeek,
  onSeekSource,
}: Props) {
  const uid = useId();
  const track = primaryCaptionTrack(project);
  const cues = useMemo(() => sortCues(track?.cues ?? []), [track]);
  const style = track?.style ?? DEFAULT_CAPTION_STYLE;
  const canAdd = project.clips.length > 0 && outputDurationUs > 0;
  // Cue times are always on the track's own clock (ADR-016): source time for a
  // source-anchored track, output time otherwise. Everything that shows or
  // edits a stored time below must respect that.
  const isSource = track?.timeBase === 'source';
  const clockEndUs = isSource
    ? (project.assets.find((asset) => asset.assetId === track?.assetId)?.durationUs ?? 0)
    : outputDurationUs;
  const clockLabel = t(isSource ? 'captions.times.source' : 'captions.times.output');
  // Where each line appears in the output now; only needed for source tracks.
  const shown = useMemo(() => (isSource ? outputCues(project) : []), [isSource, project]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<CaptionUiError | null>(null);
  const [draftSerial, setDraftSerial] = useState(0);
  const [addError, setAddError] = useState<CaptionUiError | null>(null);
  const [errors, setErrors] = useState<Record<string, CaptionUiError | null>>({});

  // Fit is judged on the EXPORT frame (the recipe's aspect and resolution) with
  // the real font, so the badge speaks for the file, not for the preview size.
  const measure = useMemo(() => (fontStatus === 'ready' ? fontMeasure() : null), [fontStatus]);
  const { aspect } = project.canvas;
  const { shortEdge } = project.export;
  const exportFrame = { ...outputPixelSize(aspect, shortEdge), aspect };
  const fits = (text: string) =>
    measure === null ? true : captionFits(text, style, exportFrame, measure);

  const setCueError = (cueId: string, error: CaptionUiError | null) =>
    setErrors((previous) => ({ ...previous, [cueId]: error }));

  /**
   * The playhead on the track's clock, for "Satır ekle". Null when a
   * source-anchored track's picture is not what plays at the output playhead.
   */
  const playheadOnTrackClock = (): Micros | null => {
    if (!isSource) {
      // Leaving source mode parks the output playhead at 0 (usePlayback), so
      // that is where a line added from source mode goes.
      return previewMode === 'output' ? outputTimeUs : 0;
    }
    // The source preview already shows the track's own clock.
    if (previewMode === 'source') return sourceTimeUs;
    return trackTimeAtOutput(project, outputTimeUs);
  };

  const addLine = () => {
    setAddError(null);
    if (!canAdd) return;
    if (draft) {
      // One new line at a time: bring the user back to the unfinished one.
      document.getElementById(`${uid}-draft-${draftSerial}-text`)?.focus();
      return;
    }
    const playhead = playheadOnTrackClock();
    if (playhead === null) {
      setAddError('caption_playhead_off_video');
      return;
    }
    const range = suggestNewCueRange(cues, playhead, clockEndUs);
    if (!range.ok) {
      setAddError(isSource && range.reason === 'caption_outside_output' ? 'range_out_of_source' : range.reason);
      return;
    }
    // An output line is added where the result preview can show it; a source
    // line is added at the picture already on screen, so nothing moves.
    if (!isSource) onSeek(range.startUs);
    setDraft({ startUs: range.startUs, endUs: range.endUs, text: '' });
    setDraftError(null);
    setDraftSerial((serial) => serial + 1);
  };

  /** Stores the latest field value in the draft; adds the line when focus leaves it. */
  const commitDraft = (patch: Partial<Draft>, leaving: boolean): CaptionUiError | null => {
    if (!draft) return null;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!leaving) return null;
    const result = onAdd(next);
    if (!result.ok) {
      setDraftError(result.reason);
      return result.reason;
    }
    setDraft(null);
    setDraftError(null);
    return null;
  };

  const commitCue = (cueId: string, patch: Partial<CaptionCueInput>): CaptionUiError | null => {
    const result = onUpdate(cueId, patch);
    setCueError(cueId, result.ok ? null : result.reason);
    return result.ok ? null : result.reason;
  };

  /** Time fields report an unparsable entry as NaN; it is refused here. */
  const timeCommit =
    (
      apply: (us: Micros, leaving: boolean) => CaptionUiError | null,
      onInvalid: (error: CaptionUiError) => void,
    ): Commit<Micros> =>
    (us, leaving) => {
      if (Number.isNaN(us)) {
        onInvalid('invalid_time');
        return 'invalid_time';
      }
      return apply(us, leaving);
    };

  /**
   * A new line's times are on the track's clock, so a change of clock (or a
   * replaced track) would silently reinterpret them: the draft is dropped.
   */
  const convert = (target: CaptionTrackV2['timeBase']) => {
    const result = onConvert(target);
    if (result.ok) {
      setDraft(null);
      setErrors({});
    }
    return result;
  };
  const importLines = (lines: readonly ImportedCueInput[], timeBase: CaptionTrackV2['timeBase']) => {
    const result = onImport(lines, timeBase);
    if (result.ok) {
      setDraft(null);
      setErrors({});
    }
    return result;
  };

  const badgesFor = (cue: CaptionCueV2): CueBadge[] => {
    if (!isSource) {
      const visibility = cueVisibility(cue, outputDurationUs);
      if (visibility === 'visible') return [];
      return [
        {
          kind: 'warning',
          testId: `cue-badge-${visibility}`,
          text: t(visibility === 'clipped' ? 'captions.badge.clipped' : 'captions.badge.outside'),
        },
      ];
    }
    const usage = sourceCueUsage(project, cue);
    if (usage.occurrences === 0) {
      return [{ kind: 'warning', testId: 'cue-badge-unused', text: t('captions.usage.none') }];
    }
    const badges: CueBadge[] = [
      {
        kind: 'info',
        testId: 'cue-badge-usage',
        text: t('captions.usage.count').replace('{count}', String(usage.occurrences)),
      },
    ];
    if (usage.partial) {
      badges.push({ kind: 'warning', testId: 'cue-badge-partial', text: t('captions.usage.partial') });
    }
    return badges;
  };

  /** Output tracks: the stored time. Source tracks: the first appearance, else the picture itself. */
  const goTo = (cue: CaptionCueV2) => {
    if (!isSource) {
      onSeek(cue.startUs);
      return;
    }
    const first = shown.find((item) => item.cueId === cue.cueId);
    if (first) onSeek(first.startUs);
    else onSeekSource(cue.startUs);
  };

  type Row = { kind: 'cue'; startUs: Micros; index: number } | { kind: 'draft'; startUs: Micros };
  const rows: Row[] = cues.map((cue, index) => ({ kind: 'cue', startUs: cue.startUs, index }));
  if (draft) {
    const at = rows.findIndex((row) => row.startUs > draft.startUs);
    rows.splice(at === -1 ? rows.length : at, 0, { kind: 'draft', startUs: draft.startUs });
  }

  return (
    <div className="captions-panel" data-testid="captions-panel">
      <div className="section-head">
        <h2>{t('captions.title')}</h2>
      </div>

      {fontStatus === 'failed' ? (
        <div className="notice notice-warning" role="status" data-testid="caption-font-failed">
          <Icon name="alert" size={16} />
          <span>{t('captions.fontFailed')}</span>
        </div>
      ) : fontStatus === 'loading' ? (
        <p className="hint-small" role="status">
          {t('captions.fontLoading')}
        </p>
      ) : null}

      <CaptionClockSection t={t} project={project} onConvert={convert} />

      {canAdd && previewMode === 'source' ? (
        <div className="caption-source-hint" data-testid="captions-source-hint">
          <p className="hint-small">
            {t(isSource ? 'captions.sourceModeHintSource' : 'captions.sourceModeHint')}
          </p>
          <button type="button" className="link-button" onClick={onShowResult}>
            {t('captions.showResult')}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn-accent btn-block caption-add"
        // aria-disabled keeps the button focusable so the reason is reachable.
        aria-disabled={!canAdd}
        aria-describedby={`${uid}-add-hint`}
        onClick={addLine}
        data-testid="captions-add"
      >
        <Icon name="plus" />
        {t('captions.add')}
      </button>
      <p className="hint-small" id={`${uid}-add-hint`}>
        {canAdd ? t(isSource ? 'captions.addHintSource' : 'captions.addHint') : t('captions.needMoments')}
      </p>
      <div aria-live="polite">
        {addError ? (
          <p className="inline-error" role="alert" data-testid="captions-add-error">
            <Icon name="alert" />
            {t(errorKey(addError))}
          </p>
        ) : null}
      </div>

      <CaptionImport t={t} project={project} onImport={importLines} />

      {rows.length === 0 ? (
        <p className="empty-state" style={{ marginTop: 14 }} data-testid="captions-empty">
          {t('captions.empty')}
        </p>
      ) : (
        <>
          <p className="hint-small" id={`${uid}-text-hint`} style={{ marginTop: 14 }}>
            {t('captions.textHint')}
          </p>
          <ol className="cue-list" aria-label={t('captions.title')}>
            {rows.map((row) => {
              if (row.kind === 'draft') {
                if (!draft) return null;
                const idBase = `${uid}-draft-${draftSerial}`;
                return (
                  <CueEditor
                    key={idBase}
                    t={t}
                    idBase={idBase}
                    textHintId={`${uid}-text-hint`}
                    label={t('captions.newLine')}
                    cueId={null}
                    startUs={draft.startUs}
                    endUs={draft.endUs}
                    clockLabel={clockLabel}
                    text={draft.text}
                    draft
                    autoFocus
                    badges={[]}
                    fits={fits}
                    error={draftError}
                    onText={(text, leaving) => commitDraft({ text }, leaving)}
                    onStart={timeCommit(
                      (us, leaving) => commitDraft({ startUs: us }, leaving),
                      setDraftError,
                    )}
                    onEnd={timeCommit(
                      (us, leaving) => commitDraft({ endUs: us }, leaving),
                      setDraftError,
                    )}
                    onGoTo={() => undefined}
                    onRemove={() => {
                      setDraft(null);
                      setDraftError(null);
                    }}
                  />
                );
              }
              const cue = cues[row.index];
              if (!cue) return null;
              const label = `${t('captions.line')} ${row.index + 1}`;
              return (
                <CueEditor
                  key={cue.cueId}
                  t={t}
                  idBase={`${uid}-${cue.cueId}`}
                  textHintId={`${uid}-text-hint`}
                  label={label}
                  cueId={cue.cueId}
                  startUs={cue.startUs}
                  endUs={cue.endUs}
                  clockLabel={clockLabel}
                  text={cue.text}
                  draft={false}
                  autoFocus={false}
                  badges={badgesFor(cue)}
                  fits={fits}
                  error={errors[cue.cueId] ?? null}
                  onText={(text) =>
                    normalizeCaptionText(text) === cue.text ? null : commitCue(cue.cueId, { text })
                  }
                  onStart={timeCommit(
                    (us) => commitCue(cue.cueId, { startUs: us }),
                    (error) => setCueError(cue.cueId, error),
                  )}
                  onEnd={timeCommit(
                    (us) => commitCue(cue.cueId, { endUs: us }),
                    (error) => setCueError(cue.cueId, error),
                  )}
                  onGoTo={() => goTo(cue)}
                  onRemove={() => {
                    setCueError(cue.cueId, null);
                    onRemove(cue.cueId);
                  }}
                />
              );
            })}
          </ol>
        </>
      )}

      <CaptionShiftSection t={t} project={project} onShift={onShift} />
      <CaptionExportSection t={t} project={project} title={title} />

      <hr className="divider" />

      <div className="section-head">
        <h2>{t('captions.styleTitle')}</h2>
      </div>
      <ChoiceGroup
        legend={t('captions.preset')}
        name={`${uid}-preset`}
        value={style.preset}
        options={CAPTION_PRESETS}
        labelFor={(option) => t(`captions.preset.${option}`)}
        onChange={(preset) => onStyle({ preset })}
        testPrefix="caption-preset"
      />
      <ChoiceGroup
        legend={t('captions.position')}
        name={`${uid}-position`}
        value={style.position}
        options={CAPTION_POSITIONS}
        labelFor={(option) => t(`captions.position.${option}`)}
        onChange={(position) => onStyle({ position })}
        testPrefix="caption-position"
      />
      <ChoiceGroup
        legend={t('captions.size')}
        name={`${uid}-size`}
        value={style.size}
        options={CAPTION_SIZES}
        labelFor={(option) => t(`captions.size.${option}`)}
        onChange={(size) => onStyle({ size })}
        testPrefix="caption-size"
      />
      <ChoiceGroup
        legend={t('captions.language')}
        name={`${uid}-language`}
        value={LANGUAGES.find((language) => language === (track?.language ?? 'tr'))}
        options={LANGUAGES}
        labelFor={(option) => t(`captions.language.${option}`)}
        onChange={onLanguage}
        testPrefix="caption-language"
      />
      <p className="hint-small">{t('captions.languageHint')}</p>
      <p className="hint">{t('captions.styleNote')}</p>
    </div>
  );
}
