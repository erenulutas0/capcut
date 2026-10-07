'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { Icon } from '@/components/Icon';
import {
  activeLineIndex,
  kesitRangesFromLines,
  lineClock,
  type SourceRangeUs,
  type TranscriptLine,
} from '@/domain/transcript';
import type { Micros } from '@/domain/time';
import { WINDOW_FROM_ROWS, nextMatch, rowOffsets, searchLines, visibleRows } from '@/domain/virtualList';
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

/** Space under every row (the stylesheet's `margin-bottom` of `.transcript-row`). */
const ROW_GAP_PX = 2;
/** A row's height before any row has been measured (one line of text). */
const ROW_GUESS_PX = 48;
/** From this many lines the panel offers its own search box. */
const SEARCH_FROM_ROWS = 12;

interface RowProps {
  t: T;
  line: TranscriptLine;
  index: number;
  /** How many lines the whole transcript has: a reader of a windowed list still hears "12 of 2491". */
  total: number;
  active: boolean;
  /** This row holds the list's one Tab stop. */
  current: boolean;
  selectable: boolean;
  selected: boolean;
  editable: boolean;
  editing: boolean;
  editError: string | null;
  /** The search found this line / this is the result the search is on. */
  match: boolean;
  found: boolean;
  /**
   * Set when the row is drawn outside the window (it holds the focus or is
   * being edited and has been scrolled away): its place in the list, in px.
   */
  pinnedTop: number | null;
  onSeek: (index: number) => void;
  onToggle: (index: number, shift: boolean) => void;
  onStartEdit: (index: number) => void;
  onSaveEdit: (index: number, text: string) => void;
  onCancelEdit: () => void;
  onFocusRow: (index: number) => void;
  onMount: (index: number, element: HTMLLIElement | null) => void;
}

const Row = memo(function Row({
  t,
  line,
  index,
  total,
  active,
  current,
  selectable,
  selected,
  editable,
  editing,
  editError,
  match,
  found,
  pinnedTop,
  onSeek,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onFocusRow,
  onMount,
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

  const mount = useCallback((element: HTMLLIElement | null) => onMount(index, element), [index, onMount]);

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

  const pinned: CSSProperties | undefined = pinnedTop === null ? undefined : { position: 'absolute', top: pinnedTop, left: 0, right: 0 };

  return (
    <li
      ref={mount}
      className="transcript-row"
      style={pinned}
      // The list may hold only a window of its rows: its size and this row's place are said outright.
      aria-setsize={total}
      aria-posinset={index + 1}
      data-active={active}
      data-selected={selected}
      data-kind={line.kind}
      data-index={index}
      data-key={line.key}
      data-match={match || undefined}
      data-found={found || undefined}
      data-pinned={pinnedTop === null ? undefined : 'true'}
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
 *
 * A LONG transcript (more than `WINDOW_FROM_ROWS` lines; two hours are about
 * 2500) is drawn a window at a time: only the rows near what is visible are
 * in the page, between two spacers that stand for the rest. Everything above
 * works the same on a row that is not drawn — it is drawn first:
 * - every row says its place (`aria-posinset` of `aria-setsize`), so a screen
 *   reader announces "12 of 2491", not "12 of 40";
 * - the row that holds the focus, and a row being edited, stay in the page
 *   when they are scrolled away (focus is never lost to the page);
 * - the browser's own find-in-page only sees drawn rows, so the panel has
 *   its own search box over ALL lines ("Yazıda ara").
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
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<number | null>(null);

  // ---- the window: which rows are in the page
  const windowed = lines.length > WINDOW_FROM_ROWS;
  /** Measured row heights by line key (a line keeps its height when lines are added or removed around it). */
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** Height assumed for a row not measured yet: the mean of the first rows that were. Fixed once known, so spacers do not drift. */
  const [guess, setGuess] = useState<number | null>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const rowElements = useRef(new Map<number, HTMLLIElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  /** A control to focus once its row is in the page: [row, control]. */
  const pendingFocus = useRef<{ index: number; control: string } | null>(null);

  const offsets = useMemo(
    () => (windowed ? rowOffsets(lines.length, (index) => heights.get((lines[index] as TranscriptLine).key) ?? guess ?? ROW_GUESS_PX, ROW_GAP_PX) : null),
    [windowed, lines, heights, guess],
  );
  const range = useMemo(
    () => (offsets ? visibleRows(offsets, view.top, view.height > 0 ? view.height : 800) : { first: 0, last: lines.length - 1 }),
    [offsets, view, lines.length],
  );

  const active = useMemo(() => activeLineIndex(lines, timeUs), [lines, timeUs]);
  const selectable = onMakeKesitler !== undefined;
  const currentRow = Math.min(Math.max(0, focusRow), Math.max(0, lines.length - 1));
  // Ticks of lines that are no longer there (an undo, a new transcript) do not count.
  const liveSelected = useMemo(() => {
    const keys = new Set(lines.map((line) => line.key));
    return new Set([...selected].filter((key) => keys.has(key)));
  }, [lines, selected]);
  const editingIndex = useMemo(() => (editing ? lines.findIndex((line) => line.key === editing.key) : -1), [editing, lines]);
  const unclearCount = useMemo(() => lines.filter((line) => line.kind === 'unclear').length, [lines]);

  // ---- the search over every line, drawn or not
  const unclearLabel = t('transcript.unclear');
  const texts = useMemo(() => lines.map((line) => (line.kind === 'cue' ? flat(line.text) : unclearLabel)), [lines, unclearLabel]);
  const matches = useMemo(() => searchLines(texts, query), [texts, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const foundRow = found !== null && matchSet.has(found) ? found : null;

  /** Where a row is, from the page when it is drawn, from the arithmetic when it is not. */
  const rowBox = useCallback(
    (index: number): { top: number; height: number } | null => {
      const element = rowElements.current.get(index);
      if (element) return { top: element.offsetTop, height: element.offsetHeight };
      if (!offsets || index < 0 || index >= lines.length) return null;
      return { top: offsets[index] as number, height: (offsets[index + 1] as number) - (offsets[index] as number) - ROW_GAP_PX };
    },
    [offsets, lines.length],
  );

  /** Brings a row into the list's view (the LIST scrolls, never the page; focus does not move). */
  const reveal = useCallback(
    (index: number, smooth: boolean) => {
      const list = listRef.current;
      const box = rowBox(index);
      if (!list || !box) return;
      if (box.top >= list.scrollTop && box.top + box.height <= list.scrollTop + list.clientHeight) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      list.scrollTo({ top: Math.max(0, box.top - list.clientHeight / 3), behavior: smooth && !reduce ? 'smooth' : 'auto' });
    },
    [rowBox],
  );

  // `reveal` and the heights change whenever a row is measured; the effects below read the latest through these.
  const revealRef = useRef(reveal);
  const heightsRef = useRef(heights);
  useEffect(() => {
    revealRef.current = reveal;
    heightsRef.current = heights;
  }, [reveal, heights]);

  // Keep the spoken line in view: scroll the LIST (never the page), never move focus.
  useEffect(() => {
    if (!following || active < 0 || editing) return;
    revealRef.current(active, true);
  }, [active, following, editing]);

  // ---- measuring: the list's own height, and every drawn row
  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setView((previous) => (previous.top === list.scrollTop && previous.height === list.clientHeight ? previous : { top: list.scrollTop, height: list.clientHeight }));
  }, []);

  useEffect(() => {
    if (!windowed) return undefined;
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const changed: [string, number][] = [];
      let shift = 0;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (element === list) continue;
        const key = element.dataset.key;
        if (!key || !element.isConnected) continue;
        const height = element.offsetHeight;
        // The room this row was given: its last measured height, or the guess for a row never seen.
        const room = heightsRef.current.get(key) ?? Number(list.dataset.guess ?? ROW_GUESS_PX);
        if (Math.abs(room - height) < 0.5) {
          if (!heightsRef.current.has(key)) changed.push([key, height]);
          continue;
        }
        // A row ABOVE what is visible took a different height than it was given room for:
        // what the reader is looking at must not move.
        if (!element.dataset.pinned && element.offsetTop < list.scrollTop) shift += height - room;
        changed.push([key, height]);
      }
      if (shift !== 0) list.scrollTop += shift;
      if (changed.length > 0) {
        const next = new Map(heightsRef.current);
        for (const [key, height] of changed) next.set(key, height);
        // Kept here at once: the observer may report again before the next render.
        heightsRef.current = next;
        setHeights(next);
        setGuess((previous) => previous ?? Math.round(changed.reduce((sum, [, height]) => sum + height, 0) / changed.length));
      }
      setView((previous) => (previous.top === list.scrollTop && previous.height === list.clientHeight ? previous : { top: list.scrollTop, height: list.clientHeight }));
    });
    observerRef.current = observer;
    observer.observe(list);
    for (const element of rowElements.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [windowed]);

  const mountRow = useCallback((index: number, element: HTMLLIElement | null) => {
    const previous = rowElements.current.get(index);
    if (previous && previous !== element) observerRef.current?.unobserve(previous);
    if (element) {
      rowElements.current.set(index, element);
      observerRef.current?.observe(element);
    } else {
      rowElements.current.delete(index);
    }
  }, []);

  const focusControl = useCallback((index: number, control: string): boolean => {
    const row = rowElements.current.get(index);
    const target =
      row?.querySelector<HTMLElement>(`[data-row-control="${control}"]`) ??
      row?.querySelector<HTMLElement>('[data-row-control="line"]');
    if (!target) return false;
    // Focusing scrolls the row into view (the browser's own behaviour), also when it was drawn out of the window.
    target.focus();
    return true;
  }, []);

  /** Focus a control of a row that may not be drawn yet: it is drawn (as the focus row) first. */
  const focusWhenDrawn = useCallback(
    (index: number, control: string) => {
      if (focusControl(index, control)) return;
      pendingFocus.current = { index, control };
      setFocusRow(index);
    },
    [focusControl],
  );

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (focusControl(pending.index, pending.control)) pendingFocus.current = null;
  });

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
      window.requestAnimationFrame(() => focusWhenDrawn(index, 'line'));
    },
    [lines, onEdit, onWriteUnclear, focusWhenDrawn],
  );

  const cancelEdit = useCallback(() => {
    const key = editing?.key;
    setEditing(null);
    const index = lines.findIndex((line) => line.key === key);
    if (index >= 0) window.requestAnimationFrame(() => focusWhenDrawn(index, 'edit'));
  }, [editing, lines, focusWhenDrawn]);

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
    focusWhenDrawn(next, control);
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

  /** To the next (or previous) line the search found: shown in the list and made the list's Tab stop. Focus stays in the box. */
  const goToMatch = (step: 1 | -1) => {
    const target = nextMatch(matches, foundRow ?? (step === 1 ? -1 : lines.length), step);
    if (target < 0) return;
    setFound(target);
    setFocusRow(target);
    setFollowing(false);
    reveal(target, false);
  };

  const searchStatus = (() => {
    if (!query.trim()) return '';
    if (matches.length === 0) return t('transcript.search.none');
    if (foundRow === null) return fillText(t('transcript.search.count'), { n: String(matches.length) });
    const line = lines[foundRow] as TranscriptLine;
    return fillText(t('transcript.search.at'), {
      k: String(matches.indexOf(foundRow) + 1),
      n: String(matches.length),
      time: lineClock(line.startUs),
      text: texts[foundRow] ?? '',
    });
  })();

  // The rows in the page: the window, plus (drawn at their own place) the focus row and a row being edited.
  const drawn: number[] = [];
  for (let index = range.first; index <= range.last; index += 1) drawn.push(index);
  const outside = (index: number) => index >= 0 && index < lines.length && (index < range.first || index > range.last);
  if (windowed) {
    const extra = [...new Set([currentRow, editingIndex])].filter(outside).sort((a, b) => a - b);
    for (const index of extra) {
      if (index < range.first) drawn.splice(extra.filter((other) => other < index).length, 0, index);
      else drawn.push(index);
    }
  }
  const spacers: CSSProperties | undefined = offsets
    ? ({
        '--rows-before': `${offsets[Math.min(range.first, lines.length)] as number}px`,
        '--rows-after': `${Math.max(0, (offsets[lines.length] as number) - (offsets[Math.min(range.last + 1, lines.length)] as number))}px`,
      } as CSSProperties)
    : undefined;

  return (
    <section className="transcript" aria-labelledby={headingId} data-testid="transcript-panel" data-windowed={windowed || undefined}>
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

      {lines.length >= SEARCH_FROM_ROWS ? (
        <div className="transcript-search" role="search" aria-label={t('transcript.search.label')} data-testid="transcript-search">
          <label className="transcript-search-field">
            <Icon name="search" size={16} />
            <span className="visually-hidden">{t('transcript.search.label')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('transcript.search.label')}
              onChange={(event) => {
                setQuery(event.target.value);
                setFound(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                goToMatch(event.shiftKey ? -1 : 1);
              }}
              aria-describedby={`${headingId}-search-status`}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              data-testid="transcript-search-input"
            />
          </label>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => goToMatch(-1)}
            disabled={matches.length === 0}
            aria-label={t('transcript.search.previous')}
            title={t('transcript.search.previous')}
            data-testid="transcript-search-previous"
          >
            <Icon name="up" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => goToMatch(1)}
            disabled={matches.length === 0}
            aria-label={t('transcript.search.next')}
            title={t('transcript.search.next')}
            data-testid="transcript-search-next"
          >
            <Icon name="down" size={16} />
          </button>
          <p className="transcript-search-status" id={`${headingId}-search-status`} role="status" data-testid="transcript-search-status">
            {searchStatus}
          </p>
          {windowed ? (
            <p className="transcript-search-hint" data-testid="transcript-search-hint">
              {t('transcript.search.windowHint')}
            </p>
          ) : null}
        </div>
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
          style={spacers}
          aria-labelledby={headingId}
          onKeyDown={onListKeyDown}
          onWheel={stopFollowing}
          onTouchMove={stopFollowing}
          onScroll={windowed ? onScroll : undefined}
          data-guess={guess ?? ROW_GUESS_PX}
          data-testid="transcript-list"
        >
          {drawn.map((index) => {
            const line = lines[index] as TranscriptLine;
            return (
              <Row
                key={line.key}
                t={t}
                line={line}
                index={index}
                total={lines.length}
                active={index === active}
                current={index === currentRow}
                selectable={selectable}
                selected={liveSelected.has(line.key)}
                editable={line.kind === 'cue' ? onEdit !== undefined : onWriteUnclear !== undefined}
                editing={editing?.key === line.key}
                editError={editing?.key === line.key ? editing.error : null}
                match={matchSet.has(index)}
                found={foundRow === index}
                pinnedTop={offsets && outside(index) ? (offsets[index] as number) : null}
                onSeek={seekRow}
                onToggle={toggleRow}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={cancelEdit}
                onFocusRow={setFocusRow}
                onMount={mountRow}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
