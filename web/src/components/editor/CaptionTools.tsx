'use client';

import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '@/components/Icon';
import { readSubtitleFile, type SubtitleEncoding } from '@/adapters/subtitleFile';
import type {
  CaptionConversionResult,
  CaptionImportReport,
  CaptionImportResult,
  ImportedCueInput,
  ShiftCaptionsResult,
} from '@/application/commands';
import {
  SHIFT_STEPS_US,
  cueBlockNumbers,
  formatShiftSeconds,
  outputIsWholeSource,
  parseShiftSeconds,
  subtitleFileName,
} from '@/domain/captionFiles';
import {
  outputCuesForExport,
  primaryCaptionTrack,
  sortCues,
  suggestTimeBase,
  type TimeBaseHint,
} from '@/domain/captions';
import type { CaptionTrackV2, Project } from '@/domain/edl';
import {
  parseSubtitles,
  serializeSubtitles,
  type ParsedSubtitles,
  type SubtitleFormat,
} from '@/domain/subtitleFormats';
import type { Micros } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import type { MessageKey } from '@/i18n/messages';
import { Dialog } from './Dialog';

type T = (key: MessageKey) => string;
type TimeBase = CaptionTrackV2['timeBase'];

/**
 * Fills `{name}` slots. A replacer function is used so "$" in file-provided
 * text is never read as a replacement pattern.
 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * A message tied to the recipe revision it describes. It disappears as soon
 * as the recipe changes again (another edit, undo), so a report never lingers
 * next to lines it no longer describes; no effect is needed to clear it.
 */
interface Stamped<V> {
  revision: number;
  value: V;
}

function current<V>(stamped: Stamped<V> | null, project: Project): V | null {
  return stamped && stamped.revision === project.revision ? stamped.value : null;
}

/** "Satır 2 ve Satır 3": lines are named by their place in the list. */
function lineNames(t: T, project: Project, cueIds: readonly string[]): string {
  const cues = sortCues(primaryCaptionTrack(project)?.cues ?? []);
  const names = cueIds.map((cueId) => {
    const index = cues.findIndex((cue) => cue.cueId === cueId);
    return `${t('captions.line')} ${index >= 0 ? index + 1 : '?'}`;
  });
  return names.join(` ${t('captions.and')} `);
}

/**
 * Confirmation dialogs are portalled to <body>: on a phone the caption panel
 * lives inside a bottom sheet, and a fixed dialog nested in it would be
 * clipped by the sheet's scroll box.
 */
function PortalDialog({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  return createPortal(
    <Dialog open onClose={onClose} labelledBy={labelledBy}>
      {children}
    </Dialog>,
    document.body,
  );
}

/* --------------------------------------------------------------- clock */

type ConversionMessage =
  | { kind: 'done'; split: number; dropped: number }
  | { kind: 'error'; reason: Exclude<CaptionConversionResult, { ok: true }>['reason']; lines: string };

export function CaptionClockSection({
  t,
  project,
  onConvert,
}: {
  t: T;
  project: Project;
  onConvert: (target: TimeBase) => CaptionConversionResult;
}) {
  const uid = useId();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Stamped<ConversionMessage> | null>(null);
  const track = primaryCaptionTrack(project);
  if (!track) return null;

  const clock = track.timeBase;
  const target: TimeBase = clock === 'output' ? 'source' : 'output';
  const shown = current(message, project);

  const convert = () => {
    setConfirming(false);
    const result = onConvert(target);
    if (result.ok) {
      setMessage({
        revision: result.project.revision,
        value: { kind: 'done', split: result.report.split, dropped: result.report.dropped },
      });
    } else {
      setMessage({
        revision: project.revision,
        value: { kind: 'error', reason: result.reason, lines: lineNames(t, project, result.cueIds ?? []) },
      });
    }
  };

  return (
    <section className="caption-section" aria-labelledby={`${uid}-title`} data-testid="caption-clock">
      <h3 className="caption-section-title" id={`${uid}-title`}>
        {t('captions.clock.title')}
      </h3>
      <p className="caption-clock-now" data-testid="caption-clock-now" data-clock={clock}>
        <Icon name={clock === 'source' ? 'film' : 'captions'} size={16} />
        <b>{t(clock === 'source' ? 'captions.clock.source' : 'captions.clock.output')}</b>
      </p>
      <p className="hint-small">
        {t(clock === 'source' ? 'captions.clock.sourceBody' : 'captions.clock.outputBody')}
      </p>
      <button
        type="button"
        className="btn btn-compact caption-clock-switch"
        onClick={() => setConfirming(true)}
        data-testid="caption-clock-switch"
      >
        {t(target === 'source' ? 'captions.clock.toSource' : 'captions.clock.toOutput')}
      </button>
      <div aria-live="polite">
        {shown?.kind === 'done' ? (
          <p className="notice caption-report" role="status" data-testid="caption-clock-report">
            <Icon name="check" size={16} />
            <span>
              {fill(t('captions.clock.done'), { split: shown.split, dropped: shown.dropped })}
            </span>
          </p>
        ) : shown?.kind === 'error' ? (
          <p className="inline-error" role="alert" data-testid="caption-clock-error">
            <Icon name="alert" />
            {fill(t(`captions.clock.error.${shown.reason}`), { lines: shown.lines })}
          </p>
        ) : null}
      </div>

      {confirming ? (
        <PortalDialog onClose={() => setConfirming(false)} labelledBy={`${uid}-confirm`}>
          <div data-testid="caption-clock-dialog">
            <div className="dialog-head">
              <h2 id={`${uid}-confirm`}>
                {t(
                  target === 'source'
                    ? 'captions.clock.confirmTitle.source'
                    : 'captions.clock.confirmTitle.output',
                )}
              </h2>
            </div>
            <p className="dialog-text">
              {t(
                target === 'source'
                  ? 'captions.clock.confirmBody.source'
                  : 'captions.clock.confirmBody.output',
              )}
            </p>
            <p className="hint-small">{t('captions.clock.undoNote')}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                {t('captions.dialogCancel')}
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={convert}
                data-testid="caption-clock-confirm"
              >
                {t('captions.clock.confirm')}
              </button>
            </div>
          </div>
        </PortalDialog>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- shift */

type ShiftMessage =
  | { kind: 'done'; deltaUs: Micros }
  | { kind: 'error'; key: MessageKey };

export function CaptionShiftSection({
  t,
  project,
  onShift,
}: {
  t: T;
  project: Project;
  onShift: (deltaUs: Micros) => ShiftCaptionsResult;
}) {
  const uid = useId();
  const [exact, setExact] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<Stamped<ShiftMessage> | null>(null);
  const track = primaryCaptionTrack(project);
  if (!track || track.cues.length === 0) return null;
  const shown = current(message, project);
  const decimalMark = t('time.decimalMark') === ',' ? ',' : '.';
  const unit = t('captions.shift.unit');

  const shift = (deltaUs: Micros) => {
    const result = onShift(deltaUs);
    if (result.ok) {
      setMessage({ revision: result.project.revision, value: { kind: 'done', deltaUs } });
    } else {
      setMessage({
        revision: project.revision,
        value: { kind: 'error', key: `captions.shift.error.${result.reason}` },
      });
    }
  };

  const applyExact = () => {
    const deltaUs = parseShiftSeconds(exact);
    if (deltaUs === null) {
      setInvalid(true);
      setMessage({ revision: project.revision, value: { kind: 'error', key: 'captions.shift.error.invalid' } });
      return;
    }
    setInvalid(false);
    if (deltaUs !== 0) shift(deltaUs);
  };

  return (
    <section className="caption-section" aria-labelledby={`${uid}-title`} data-testid="caption-shift">
      <h3 className="caption-section-title" id={`${uid}-title`}>
        {t('captions.shift.title')}
      </h3>
      <p className="hint-small" id={`${uid}-hint`}>
        {t('captions.shift.hint')}
      </p>
      <div className="caption-shift-steps" role="group" aria-labelledby={`${uid}-title`}>
        {SHIFT_STEPS_US.map((deltaUs) => {
          const amount = formatShiftSeconds(Math.abs(deltaUs), decimalMark).slice(1);
          return (
            <button
              key={deltaUs}
              type="button"
              className="btn btn-compact"
              aria-label={fill(t(deltaUs < 0 ? 'captions.shift.earlier' : 'captions.shift.later'), {
                amount,
              })}
              onClick={() => shift(deltaUs)}
              data-testid={`caption-shift-${deltaUs < 0 ? 'minus' : 'plus'}-${Math.abs(deltaUs)}`}
            >
              {formatShiftSeconds(deltaUs, decimalMark)} {unit}
            </button>
          );
        })}
      </div>
      <form
        className="caption-shift-exact"
        onSubmit={(event) => {
          event.preventDefault();
          applyExact();
        }}
      >
        <div className="caption-shift-field">
          <label className="field-label" htmlFor={`${uid}-exact`}>
            {t('captions.shift.exactLabel')}
          </label>
          <input
            id={`${uid}-exact`}
            className="time-input"
            inputMode="decimal"
            value={exact}
            aria-invalid={invalid}
            aria-describedby={`${uid}-hint ${uid}-message`}
            onChange={(event) => setExact(event.target.value)}
            data-testid="caption-shift-exact"
          />
        </div>
        <button type="submit" className="btn" data-testid="caption-shift-apply">
          {t('captions.shift.apply')}
        </button>
      </form>
      <div aria-live="polite" id={`${uid}-message`}>
        {shown?.kind === 'done' ? (
          <p className="hint-small" role="status" data-testid="caption-shift-report">
            {fill(t('captions.shift.done'), { amount: formatShiftSeconds(shown.deltaUs, decimalMark) })}
          </p>
        ) : shown?.kind === 'error' ? (
          <p className="inline-error" role="alert" data-testid="caption-shift-error">
            <Icon name="alert" />
            {t(shown.key)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- import */

interface PendingImport {
  fileName: string;
  encoding: SubtitleEncoding;
  parsed: ParsedSubtitles;
  hint: TimeBaseHint;
}

type ImportFailure = Exclude<CaptionImportResult, { ok: true }>;

interface ImportSummary {
  report: CaptionImportReport;
  /** File block number of each parsed cue, to name skipped lines as the file does. */
  blocks: number[];
}

function SkippedList({ t, summary, testId }: { t: T; summary: ImportSummary; testId: string }) {
  if (summary.report.skipped.length === 0) return null;
  return (
    <div className="caption-skipped">
      <p className="field-label">{t('captions.import.skippedTitle')}</p>
      <ul data-testid={testId}>
        {summary.report.skipped.map((item) => (
          <li key={item.index} data-testid="caption-import-skipped-item">
            {fill(t('captions.import.skipped'), {
              block: summary.blocks[item.index] ?? item.index + 1,
              reason: t(`captions.skip.${item.reason}`),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CaptionImport({
  t,
  project,
  onImport,
}: {
  t: T;
  project: Project;
  onImport: (cues: readonly ImportedCueInput[], timeBase: TimeBase) => CaptionImportResult;
}) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [choice, setChoice] = useState<TimeBase | null>(null);
  const [needChoice, setNeedChoice] = useState(false);
  const [failure, setFailure] = useState<{ failure: ImportFailure; summary: ImportSummary | null } | null>(
    null,
  );
  const [readError, setReadError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState<Stamped<ImportSummary> | null>(null);
  const existing = primaryCaptionTrack(project)?.cues.length ?? 0;
  const shownDone = current(done, project);

  const close = () => {
    setPending(null);
    setChoice(null);
    setNeedChoice(false);
    setFailure(null);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again (after fixing it) fires again.
    event.target.value = '';
    if (!file) return;
    setReadError(null);
    setDone(null);
    const read = await readSubtitleFile(file);
    if (!read.ok) {
      setReadError(`captions.import.error.${read.reason}`);
      return;
    }
    const parsed = parseSubtitles(read.text);
    if (!parsed.ok) {
      setReadError(`captions.import.error.${parsed.reason}`);
      return;
    }
    const video = project.assets.find((asset) => asset.kind === 'video');
    const hint = video
      ? suggestTimeBase(
          parsed.value.cues,
          totalOutputDurationUs(project),
          video.durationUs,
          outputIsWholeSource(project),
        )
      : null;
    setChoice(null);
    setNeedChoice(false);
    setFailure(null);
    setPending({ fileName: file.name, encoding: read.encoding, parsed: parsed.value, hint });
  };

  const runImport = () => {
    if (!pending) return;
    if (!choice) {
      setNeedChoice(true);
      document.getElementById(`${uid}-choice-source`)?.focus();
      return;
    }
    const blocks = cueBlockNumbers(pending.parsed);
    const result = onImport(pending.parsed.cues, choice);
    if (result.ok) {
      setDone({ revision: result.project.revision, value: { report: result.report, blocks } });
      close();
      return;
    }
    setFailure({ failure: result, summary: result.report ? { report: result.report, blocks } : null });
  };

  const option = (value: TimeBase) => {
    const suggested = pending?.hint === value;
    return (
      <label className="radio-row caption-import-option" data-suggested={suggested}>
        <input
          id={`${uid}-choice-${value}`}
          type="radio"
          name={`${uid}-choice`}
          checked={choice === value}
          onChange={() => {
            setChoice(value);
            setNeedChoice(false);
            setFailure(null);
          }}
          data-testid={`caption-import-choice-${value}`}
        />
        <span>
          {t(value === 'source' ? 'captions.import.option.source' : 'captions.import.option.output')}
          <small>
            {t(
              value === 'source'
                ? 'captions.import.option.sourceHelp'
                : 'captions.import.option.outputHelp',
            )}
          </small>
          {suggested ? (
            <small className="caption-import-suggest" data-testid={`caption-import-suggest-${value}`}>
              <Icon name="info" size={13} />
              {t(value === 'source' ? 'captions.import.suggest.source' : 'captions.import.suggest.output')}
            </small>
          ) : null}
        </span>
      </label>
    );
  };

  return (
    <div className="caption-import">
      <input
        ref={inputRef}
        type="file"
        // Extensions and the registered types; parsing decides the format.
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void onFile(event)}
        data-testid="caption-file-input"
      />
      <button
        type="button"
        className="btn btn-block"
        aria-describedby={`${uid}-hint`}
        onClick={() => inputRef.current?.click()}
        data-testid="caption-import"
      >
        <Icon name="folder" />
        {t('captions.import.button')}
      </button>
      <p className="hint-small" id={`${uid}-hint`}>
        {t('captions.import.hint')}
      </p>
      <div aria-live="polite">
        {readError ? (
          <p className="inline-error" role="alert" data-testid="caption-import-read-error">
            <Icon name="alert" />
            {t(readError)}
          </p>
        ) : null}
        {shownDone ? (
          <div className="notice caption-report" role="status" data-testid="caption-import-report">
            <Icon name="check" size={16} />
            <div>
              <b data-testid="caption-import-count">
                {fill(t('captions.import.done'), { count: shownDone.report.imported })}
              </b>
              <SkippedList t={t} summary={shownDone} testId="caption-import-skipped" />
            </div>
          </div>
        ) : null}
      </div>

      {pending ? (
        <PortalDialog onClose={close} labelledBy={`${uid}-title`}>
          <div data-testid="caption-import-dialog">
            <div className="dialog-head">
              <div style={{ minWidth: 0 }}>
                <h2 id={`${uid}-title`}>{t('captions.import.title')}</h2>
                {/* File names are user data: a text node, shortened by CSS. */}
                <p className="dialog-sub caption-file-name" data-testid="caption-import-file">
                  {pending.fileName}
                </p>
              </div>
            </div>

            <dl className="caption-import-facts">
              <div>
                <dt>{t('captions.import.format')}</dt>
                <dd data-testid="caption-import-format">{pending.parsed.format.toUpperCase()}</dd>
              </div>
              <div>
                <dt>{t('captions.import.lines')}</dt>
                <dd data-testid="caption-import-lines">{pending.parsed.cues.length}</dd>
              </div>
              <div className="caption-import-fact-wide">
                <dt>{t('captions.import.encoding')}</dt>
                <dd data-testid="caption-import-encoding" data-encoding={pending.encoding}>
                  {t(`captions.import.encoding.${pending.encoding}`)}
                </dd>
              </div>
            </dl>

            {pending.parsed.problems.length > 0 ? (
              <ul className="caption-import-problems" data-testid="caption-import-problems">
                {pending.parsed.problems.map((problem) => (
                  <li key={problem.block}>
                    {fill(t(`captions.import.problem.${problem.reason}`), { block: problem.block })}
                  </li>
                ))}
              </ul>
            ) : null}
            {pending.parsed.joinedLines > 0 ? (
              <p className="hint-small" data-testid="caption-import-joined">
                {fill(t('captions.import.joined'), { count: pending.parsed.joinedLines })}
              </p>
            ) : null}

            <fieldset
              className="caption-import-question"
              aria-required="true"
              aria-invalid={needChoice}
              aria-describedby={needChoice ? `${uid}-need` : undefined}
              data-testid="caption-import-question"
            >
              <legend className="field-label">{t('captions.import.question')}</legend>
              {option('source')}
              {option('output')}
              {pending.hint === 'same' ? (
                <p className="hint-small" data-testid="caption-import-suggest-same">
                  {t('captions.import.suggest.same')}
                </p>
              ) : null}
            </fieldset>

            {existing > 0 ? (
              <div className="notice notice-warning" data-testid="caption-import-replace">
                <Icon name="alert" size={16} />
                <span>{fill(t('captions.import.replaceWarning'), { count: existing })}</span>
              </div>
            ) : null}

            <div aria-live="polite">
              {needChoice ? (
                <p className="inline-error" role="alert" id={`${uid}-need`} data-testid="caption-import-need-choice">
                  <Icon name="alert" />
                  {t('captions.import.chooseFirst')}
                </p>
              ) : null}
              {failure ? (
                <div role="alert" data-testid="caption-import-error">
                  <p className="inline-error">
                    <Icon name="alert" />
                    {t(`captions.import.error.${failure.failure.reason}`)}
                  </p>
                  {failure.summary ? (
                    <SkippedList t={t} summary={failure.summary} testId="caption-import-error-skipped" />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="dialog-actions">
              <button type="button" className="btn" onClick={close} data-testid="caption-import-cancel">
                {t('captions.dialogCancel')}
              </button>
              <button
                type="button"
                className="btn btn-accent"
                // aria-disabled, not disabled: a press explains what is missing.
                aria-disabled={choice === null}
                onClick={runImport}
                data-testid="caption-import-confirm"
              >
                {t('captions.import.confirm')}
              </button>
            </div>
          </div>
        </PortalDialog>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- export */

/** SRT has no registered type; this is the one players and browsers use. */
const MIME: Record<SubtitleFormat, string> = {
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
};

export function CaptionExportSection({ t, project, title }: { t: T; project: Project; title: string }) {
  const uid = useId();
  const cues = outputCuesForExport(project, totalOutputDurationUs(project));
  const empty = cues.length === 0;

  const download = (format: SubtitleFormat) => {
    if (empty) return;
    const blob = new Blob([serializeSubtitles(cues, format)], { type: MIME[format] });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = subtitleFileName(title, format);
    anchor.click();
    // Revoked on the next task: some browsers start the download after click returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className="caption-section" aria-labelledby={`${uid}-title`} data-testid="caption-export">
      <h3 className="caption-section-title" id={`${uid}-title`}>
        {t('captions.export.title')}
      </h3>
      <p className="hint-small" id={`${uid}-body`}>
        {t('captions.export.body')}
      </p>
      <div className="caption-export-buttons">
        {(['srt', 'vtt'] as const).map((format) => (
          <button
            key={format}
            type="button"
            className="btn btn-compact"
            aria-disabled={empty}
            aria-describedby={empty ? `${uid}-none` : `${uid}-body`}
            onClick={() => download(format)}
            data-testid={`caption-export-${format}`}
          >
            <Icon name="download" size={15} />
            {t(format === 'srt' ? 'captions.export.srt' : 'captions.export.vtt')}
          </button>
        ))}
      </div>
      {empty ? (
        <p className="hint-small" id={`${uid}-none`} data-testid="caption-export-none">
          {t('captions.export.none')}
        </p>
      ) : null}
    </section>
  );
}
