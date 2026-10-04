'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { Icon } from '@/components/Icon';
import {
  activeLineIndex,
  kesitRangesFromLines,
  lineClock,
  type SourceRangeUs,
  type TranscriptLine,
} from '@/domain/transcript';
import type { Micros } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';
import { fillText } from './TranscribeSteps';

type T = (key: MessageKey) => string;

/** What saving a line's text answered: nothing to say, or the reason it was refused. */
export type LineEditOutcome = { ok: true } | { ok: false; reason: string };

export type KesitFromLinesOutcome =
  | { ok: true; added: number }
  | { ok: false; reason: 'clip_limit_exceeded'; room: number; wanted: number }
  | { ok: false; reason: 'other' };

interface Props {
  t: T;
  lines: readonly TranscriptLine[];
  /** The video's own time, for the active line. */
  timeUs: Micros;
  videoDurationUs: Micros;
  /** The lines were written by the machine: say so. */
  machineMade: boolean;
  onSeek: (us: Micros) => void;
  /** Fixes a line's text. Absent: the lines cannot be edited here. */
  onEdit?: (cueId: string, text: string) => LineEditOutcome;
  /** Types the text of a span that could not be written. */
  onWriteUnclear?: (range: { startUs: Micros; endUs: Micros }, text: string) => LineEditOutcome;
  /** "Bunlardan kesit yap". Absent (the wizard): no selection. */
  onMakeKesitler?: (ranges: SourceRangeUs[]) => KesitFromLinesOutcome;
  headingId: string;
}

const flat = (text: string) => text.split('\n').join(' ');

interface RowProps {
  t: T;
  line: TranscriptLine;
  index: number;
  active: boolean;
  /** This row holds the list's one Tab stop. */
  current: boolean;
  selectable: boolean;
  selected: boolean;
  editable: boolean;
  editing: boolean;
  editError: string | null;
  onSeek: (index: number) => void;
  onToggle: (index: number, shift: boolean) => void;
  onStartEdit: (index: number) => void;
  onSaveEdit: (index: number, text: string) => void;
  onCancelEdit: () => void;
  onFocusRow: (index: number) => void;
}

const Row = memo(function Row({
  t,
  line,
  index,
  active,
  current,
  selectable,
  selected,
  editable,
  editing,
  editError,
  onSeek,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onFocusRow,
}: RowProps) {
  const unclear = line.kind === 'unclear';
  const text = unclear ? t('transcript.unclear') : flat(line.text);
  const time = lineClock(line.startUs);
  const [draft, setDraft] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const tabIndex = current ? 0 : -1;

  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    // The user asked to edit this line: the field is where they type next.
    field.focus();
    field.select();
  }, [editing]);

  const onEditKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancelEdit();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSaveEdit(index, draft);
    }
  };

  return (
    <li
      className="transcript-row"
      data-active={active}
      data-selected={selected}
      data-kind={line.kind}
      data-index={index}
      data-testid="transcript-row"
    >
      {selectable ? (
        <input
          type="checkbox"
          className="transcript-check"
          checked={selected}
          tabIndex={tabIndex}
          aria-label={fillText(t('transcript.line.select'), { time, text })}
          onChange={() => undefined}
          onClick={(event: MouseEvent<HTMLInputElement>) => onToggle(index, event.shiftKey)}
          onFocus={() => onFocusRow(index)}
          data-row-control="check"
          data-testid="transcript-check"
        />
      ) : null}
      {editing ? (
        <div className="transcript-edit">
          <label className="visually-hidden" htmlFor={`transcript-edit-${line.key}`}>
            {fillText(t('transcript.line.editLabel'), { time })}
          </label>
          <textarea
            id={`transcript-edit-${line.key}`}
            ref={fieldRef}
            className="transcript-field"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onEditKey}
            aria-invalid={editError !== null}
            aria-describedby={editError ? `transcript-edit-error-${line.key}` : undefined}
            data-testid="transcript-field"
          />
          {editError ? (
            <p className="transcript-error" id={`transcript-edit-error-${line.key}`} role="alert" data-testid="transcript-edit-error">
              {editError}
            </p>
          ) : null}
          <div className="transcript-edit-actions">
            <button type="button" className="btn btn-compact btn-accent" onClick={() => onSaveEdit(index, draft)} data-testid="transcript-save">
              {t('transcript.line.save')}
            </button>
            <button type="button" className="btn btn-compact" onClick={onCancelEdit} data-testid="transcript-cancel">
              {t('transcript.line.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="transcript-line"
            tabIndex={tabIndex}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSeek(index)}
            onFocus={() => onFocusRow(index)}
            data-row-control="line"
            data-testid="transcript-line"
          >
            <span className="transcript-time">{time}</span>
            <span className="transcript-text">{text}</span>
          </button>
          {editable ? (
            <button
              type="button"
              className="icon-btn icon-btn-sm transcript-edit-btn"
              tabIndex={tabIndex}
              aria-label={fillText(t(unclear ? 'transcript.line.writeLabel' : 'transcript.line.fixLabel'), { time, text })}
              title={t(unclear ? 'transcript.line.write' : 'transcript.line.fix')}
              onClick={() => {
                setDraft(unclear ? '' : line.text);
                onStartEdit(index);
              }}
              onFocus={() => onFocusRow(index)}
              data-row-control="edit"
              data-testid="transcript-edit"
            >
              <Icon name="edit" size={16} />
            </button>
          ) : null}
        </>
      )}
    </li>
  );
});

/**
 * The transcript, YouTube style (ADR-036): time-stamped lines top to bottom.
 *
 * - A line is a button: click (or Enter) jumps the video there.
 * - The line being spoken is marked (`aria-current`) and kept in view while
 *   the video plays — the list scrolls, focus never moves — until the user
 *   scrolls it themselves; "Şimdiye dön" picks the following up again.
 *   With reduced motion the list jumps instead of gliding.
 * - The list is one Tab stop; ↑ ↓ Home End move between lines (the same
 *   control of the next line: the line, its tick box, its pencil).
 * - A tick box per line (Space; Shift for a range) and "Bunlardan kesit yap":
 *   the ticked lines become kesitler, neighbours joined.
 * - The pencil fixes a wrong word in place (Enter saves, Esc leaves).
 * - "(anlaşılamadı)" lines are spans that were heard but not written; they
 *   can be listened to and typed by hand.
 */
export function TranscriptPanel({
  t,
  lines,
  timeUs,
  videoDurationUs,
  machineMade,
  onSeek,
  onEdit,
  onWriteUnclear,
  onMakeKesitler,
  headingId,
}: Props) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [focusRow, setFocusRow] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchorRef = useRef<number | null>(null);
  const [editing, setEditing] = useState<{ key: string; error: string | null } | null>(null);
  const [following, setFollowing] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const active = useMemo(() => activeLineIndex(lines, timeUs), [lines, timeUs]);
  const selectable = onMakeKesitler !== undefined;
  const currentRow = Math.min(Math.max(0, focusRow), Math.max(0, lines.length - 1));
  // Ticks of lines that are no longer there (an undo, a new transcript) do not count.
  const liveSelected = useMemo(() => {
    const keys = new Set(lines.map((line) => line.key));
    return new Set([...selected].filter((key) => keys.has(key)));
  }, [lines, selected]);

  // Keep the spoken line in view: scroll the LIST (never the page), never move focus.
  useEffect(() => {
    if (!following || active < 0 || editing) return;
    const list = listRef.current;
    const row = list?.children[active] as HTMLElement | undefined;
    if (!list || !row) return;
    // The list is the rows' offset parent (`position: relative` in the stylesheet).
    const top = row.offsetTop;
    const visibleTop = list.scrollTop;
    const visibleBottom = visibleTop + list.clientHeight;
    if (top >= visibleTop && top + row.offsetHeight <= visibleBottom) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: reduce ? 'auto' : 'smooth' });
  }, [active, following, editing]);

  /** The user moved the list themselves: stop following until they ask. */
  const stopFollowing = useCallback(() => setFollowing(false), []);

  const seekRow = useCallback(
    (index: number) => {
      const line = lines[index];
      if (!line) return;
      setFollowing(true);
      onSeek(line.startUs);
    },
    [lines, onSeek],
  );

  const toggleRow = useCallback(
    (index: number, shift: boolean) => {
      const line = lines[index];
      if (!line) return;
      setNotice(null);
      setSelected((previous) => {
        const next = new Set(previous);
        const anchor = anchorRef.current;
        if (shift && anchor !== null && anchor !== index) {
          const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
          for (let i = from; i <= to; i += 1) {
            const each = lines[i];
            if (each) next.add(each.key);
          }
        } else if (next.has(line.key)) {
          next.delete(line.key);
        } else {
          next.add(line.key);
        }
        return next;
      });
      anchorRef.current = index;
    },
    [lines],
  );

  const startEdit = useCallback(
    (index: number) => {
      const line = lines[index];
      if (line) setEditing({ key: line.key, error: null });
    },
    [lines],
  );

  const focusControl = (index: number, control: string) => {
    const row = listRef.current?.children[index] as HTMLElement | undefined;
    const target =
      row?.querySelector<HTMLElement>(`[data-row-control="${control}"]`) ??
      row?.querySelector<HTMLElement>('[data-row-control="line"]');
    target?.focus();
  };

  const saveEdit = useCallback(
    (index: number, text: string) => {
      const line = lines[index];
      if (!line) return;
      const outcome =
        line.kind === 'cue'
          ? onEdit?.(line.cueId, text)
          : onWriteUnclear?.({ startUs: line.startUs, endUs: line.endUs }, text);
      if (!outcome) return;
      if (!outcome.ok) {
        setEditing({ key: line.key, error: outcome.reason });
        return;
      }
      setEditing(null);
      // Back to the line that was edited (its key may be new: a written span becomes a line).
      window.requestAnimationFrame(() => focusControl(index, 'line'));
    },
    [lines, onEdit, onWriteUnclear],
  );

  const cancelEdit = useCallback(() => {
    const key = editing?.key;
    setEditing(null);
    const index = lines.findIndex((line) => line.key === key);
    if (index >= 0) window.requestAnimationFrame(() => focusControl(index, 'edit'));
  }, [editing, lines]);

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (editing) return;
    const target = event.target as HTMLElement;
    const control = target.dataset.rowControl;
    if (!control) return;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(lines.length - 1, currentRow + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, currentRow - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = lines.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    // The reader is walking the list: do not pull it away under them.
    setFollowing(false);
    if (event.shiftKey && selectable && control === 'check') toggleRow(next, true);
    setFocusRow(next);
    focusControl(next, control);
  };

  const makeKesitler = () => {
    if (!onMakeKesitler) return;
    const ranges = kesitRangesFromLines(lines, liveSelected, videoDurationUs);
    if (ranges.length === 0) return;
    const outcome = onMakeKesitler(ranges);
    if (outcome.ok) {
      setSelected(new Set());
      anchorRef.current = null;
      setNotice(fillText(t('transcript.kesit.added'), { n: String(outcome.added) }));
    } else if (outcome.reason === 'clip_limit_exceeded') {
      setNotice(fillText(t('transcript.kesit.limit'), { room: String(outcome.room), wanted: String(outcome.wanted) }));
    } else {
      setNotice(t('transcript.kesit.failed'));
    }
  };

  const unclearCount = lines.filter((line) => line.kind === 'unclear').length;

  return (
    <section className="transcript" aria-labelledby={headingId} data-testid="transcript-panel">
      <div className="transcript-head">
        <h2 id={headingId}>
          {t('transcript.panel.title')}{' '}
          <span className="kesits-count" data-testid="transcript-count">
            ({lines.length})
          </span>
        </h2>
        {!following && active >= 0 ? (
          <button type="button" className="btn btn-compact" onClick={() => setFollowing(true)} data-testid="transcript-follow">
            {t('transcript.follow')}
          </button>
        ) : null}
      </div>
      {machineMade ? (
        <p className="transcript-note" data-testid="transcript-machine-note">
          {t('transcript.machine')}
          {unclearCount > 0 ? ` ${fillText(t('transcript.unclearCount'), { n: String(unclearCount) })}` : ''}
        </p>
      ) : null}

      {selectable ? (
        <div className="transcript-selection" data-testid="transcript-selection">
          <span data-testid="transcript-selected-count">
            {liveSelected.size > 0
              ? fillText(t('transcript.kesit.selected'), { n: String(liveSelected.size) })
              : t('transcript.kesit.hint')}
          </span>
          <button
            type="button"
            className="btn btn-compact btn-accent"
            onClick={makeKesitler}
            disabled={liveSelected.size === 0}
            data-testid="transcript-make-kesit"
          >
            <Icon name="scissors" size={16} />
            {t('transcript.kesit.make')}
          </button>
          {liveSelected.size > 0 ? (
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => {
                setSelected(new Set());
                anchorRef.current = null;
              }}
              data-testid="transcript-clear-selection"
            >
              {t('transcript.kesit.clear')}
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="transcript-status" role="status" data-testid="transcript-status">
        {notice ?? ''}
      </p>

      {lines.length === 0 ? (
        <p className="kesits-empty" data-testid="transcript-empty">
          {t('transcript.panel.empty')}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="transcript-list"
          aria-labelledby={headingId}
          onKeyDown={onListKeyDown}
          onWheel={stopFollowing}
          onTouchMove={stopFollowing}
          data-testid="transcript-list"
        >
          {lines.map((line, index) => (
            <Row
              key={line.key}
              t={t}
              line={line}
              index={index}
              active={index === active}
              current={index === currentRow}
              selectable={selectable}
              selected={liveSelected.has(line.key)}
              editable={line.kind === 'cue' ? onEdit !== undefined : onWriteUnclear !== undefined}
              editing={editing?.key === line.key}
              editError={editing?.key === line.key ? editing.error : null}
              onSeek={seekRow}
              onToggle={toggleRow}
              onStartEdit={startEdit}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
              onFocusRow={setFocusRow}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
