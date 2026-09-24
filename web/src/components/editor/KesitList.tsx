'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';
import type { Project } from '@/domain/edl';
import { formatKesitLength, formatPosition } from '@/domain/kesit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/**
 * Turkish accusative ending after a numeral as it is read aloud: "Kesit 2'yi",
 * "Kesit 3'ü", "Kesit 10'u". Only the endings up to the kesit limit (20).
 */
export function accusativeSuffix(n: number): string {
  if (n === 10) return "'u";
  if (n === 20) return "'yi";
  const endings = ['', "'i", "'yi", "'ü", "'ü", "'i", "'yı", "'yi", "'i", "'u"];
  return endings[n % 10] ?? '';
}

/** "Kesit 2'yi indir, 10:05–12:30" — the name a screen reader gives each button. */
export function kesitActionLabel(
  t: T,
  key: MessageKey,
  number: number,
  range: { sourceInUs: number; sourceOutUs: number },
): string {
  return t(key)
    .replace('{n}', String(number))
    .replace('{acc}', accusativeSuffix(number))
    .replace('{range}', `${formatPosition(range.sourceInUs)}–${formatPosition(range.sourceOutUs)}`);
}

interface Props {
  t: T;
  project: Project;
  selectedClipId: string | null;
  playingClipId: string | null;
  /** Start-frame pictures by the kesit's start time (µs, as a string). */
  thumbs: Record<string, string>;
  /** A download is running: the other ⬇ buttons wait. */
  downloading: boolean;
  /** The status under each card (progress, "Kaydedildi: …", a refusal). */
  statusFor: (clipId: string) => ReactNode;
  /** The top button's status, shown under the heading. */
  topStatus: ReactNode;
  onSelect: (clipId: string) => void;
  onPlay: (clipId: string) => void;
  onDownload: (clipId: string) => void;
  onDelete: (clipId: string) => void;
  onMove: (clipId: string, toIndex: number) => void;
  /** What to say when there is no kesit (depends on whether a video is open). */
  emptyText: string;
  /**
   * Shown under the list where ⬇ opens the save dialog: the browser empties a
   * file the user chooses to replace as soon as they confirm (ADR-026).
   */
  saveNote: string | null;
}

interface DragState {
  clipId: string;
  pointerId: number;
  startY: number;
  dy: number;
  from: number;
  target: number;
  /** Card middles at press time, so the layout cannot shift under the finger. */
  middles: number[];
}

/**
 * The kesit list (ADR-026): what the user marked, as a proper list of cards.
 * Each card plays its range (▶), downloads just that kesit (⬇) or deletes it
 * (✕); pressing the card selects it for fine-tuning its start and end. The
 * order only matters for the joined download; the grip reorders by pointer
 * drag or by the arrow keys.
 */
export function KesitList({
  t,
  project,
  selectedClipId,
  playingClipId,
  thumbs,
  downloading,
  statusFor,
  topStatus,
  onSelect,
  onPlay,
  onDownload,
  onDelete,
  onMove,
  emptyText,
  saveNote,
}: Props) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [moveNote, setMoveNote] = useState('');
  const count = project.clips.length;
  const limitUs = WEB_LOCAL_POLICY.maxOutputDurationUs;

  const announceMove = (clipId: string, toIndex: number) => {
    const from = project.clips.findIndex((clip) => clip.clipId === clipId);
    if (from < 0 || toIndex === from) return;
    setMoveNote(
      t('kesit.moved')
        .replace('{n}', String(from + 1))
        .replace('{place}', String(toIndex + 1)),
    );
    onMove(clipId, toIndex);
  };

  const onGripKeyDown = (event: KeyboardEvent<HTMLButtonElement>, clipId: string, index: number) => {
    let target: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = index - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = index + 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = count - 1;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (target < 0 || target >= count || target === index) return;
    announceMove(clipId, target);
    // The card moved in the DOM; keep the keyboard on its grip.
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-grip-for="${clipId}"]`)?.focus();
    });
  };

  const onGripPointerDown = (event: PointerEvent<HTMLButtonElement>, clipId: string, index: number) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>(':scope > li') ?? []);
    const middles = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ clipId, pointerId: event.pointerId, startY: event.clientY, dy: 0, from: index, target: index, middles });
  };

  const onGripPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dy = event.clientY - drag.startY;
    const centre = (drag.middles[drag.from] ?? event.clientY) + dy;
    // The new place is the number of other cards whose middle it has passed.
    const target = drag.middles.filter((middle, i) => i !== drag.from && middle < centre).length;
    setDrag({ ...drag, dy, target: Math.max(0, Math.min(count - 1, target)) });
  };

  const onGripPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { clipId, target, from } = drag;
    setDrag(null);
    if (target !== from) announceMove(clipId, target);
  };

  return (
    <section className="kesits" aria-labelledby="kesits-title" data-testid="kesit-panel">
      <div className="kesits-head">
        <h2 id="kesits-title">
          {t('kesit.title')} <span className="kesits-count" data-testid="moment-count">({count})</span>
        </h2>
      </div>

      {topStatus}

      {count === 0 ? (
        <p className="kesits-empty" data-testid="kesit-empty">
          {emptyText}
        </p>
      ) : (
        <ol className="kesit-list" ref={listRef} aria-labelledby="kesits-title">
          {project.clips.map((clip, index) => {
            const number = index + 1;
            const range = { sourceInUs: clip.sourceInUs, sourceOutUs: clip.sourceOutUs };
            const lengthUs = clip.sourceOutUs - clip.sourceInUs;
            const selected = clip.clipId === selectedClipId;
            const dragging = drag?.clipId === clip.clipId;
            const thumb = thumbs[String(clip.sourceInUs)];
            const dropBefore = drag && !dragging && drag.target === index && drag.target < drag.from;
            const dropAfter = drag && !dragging && drag.target === index && drag.target > drag.from;
            return (
              <li
                key={clip.clipId}
                className="kesit-card"
                data-selected={selected}
                data-playing={clip.clipId === playingClipId}
                data-dragging={dragging}
                data-drop={dropBefore ? 'before' : dropAfter ? 'after' : undefined}
                style={dragging && drag ? { transform: `translateY(${drag.dy}px)` } : undefined}
                data-testid="kesit-card"
                data-clip-id={clip.clipId}
              >
                <div className="kesit-row">
                  <button
                    type="button"
                    className="kesit-grip"
                    aria-label={kesitActionLabel(t, 'kesit.moveLabel', number, range)}
                    aria-describedby="kesit-move-hint"
                    disabled={count < 2}
                    onKeyDown={(event) => onGripKeyDown(event, clip.clipId, index)}
                    onPointerDown={(event) => onGripPointerDown(event, clip.clipId, index)}
                    onPointerMove={onGripPointerMove}
                    onPointerUp={onGripPointerUp}
                    onPointerCancel={() => setDrag(null)}
                    data-grip-for={clip.clipId}
                    data-testid="kesit-grip"
                  >
                    <Icon name="grip" size={18} />
                  </button>
                  <button
                    type="button"
                    className="kesit-main"
                    aria-pressed={selected}
                    aria-label={kesitActionLabel(t, 'kesit.selectLabel', number, range)}
                    onClick={() => onSelect(clip.clipId)}
                    data-testid="kesit-select"
                  >
                    <span className="kesit-thumb" data-color={index % 6} aria-hidden="true">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not a remote asset
                        <img src={thumb} alt="" />
                      ) : null}
                      <span className="kesit-num">{number}</span>
                    </span>
                    <span className="kesit-range" aria-hidden="true" data-testid="kesit-range">
                      {formatPosition(clip.sourceInUs)} → {formatPosition(clip.sourceOutUs)}
                    </span>
                  </button>
                  <div className="kesit-tools">
                    <span className="kesit-length" data-testid="kesit-length">
                      <span className="visually-hidden">{t('kesit.lengthLabel')} </span>
                      {formatKesitLength(lengthUs)}
                    </span>
                  <div className="kesit-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onPlay(clip.clipId)}
                      aria-label={kesitActionLabel(t, 'kesit.playLabel', number, range)}
                      data-testid="kesit-play"
                    >
                      <Icon name={clip.clipId === playingClipId ? 'pause' : 'play'} size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn kesit-download"
                      onClick={() => onDownload(clip.clipId)}
                      disabled={downloading}
                      aria-label={kesitActionLabel(t, 'kesit.downloadLabel', number, range)}
                      data-testid="kesit-download"
                    >
                      <Icon name="download" size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onDelete(clip.clipId)}
                      aria-label={kesitActionLabel(t, 'kesit.deleteLabel', number, range)}
                      data-testid="kesit-delete"
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  </div>
                </div>
                {lengthUs > limitUs ? (
                  <p className="kesit-warning" data-testid="kesit-over-limit">
                    <Icon name="alert" size={14} />
                    {t('kesit.overLimit').replace('{limit}', String(Math.round(limitUs / 60_000_000)))}
                  </p>
                ) : null}
                {statusFor(clip.clipId)}
              </li>
            );
          })}
        </ol>
      )}
      {saveNote ? (
        <p className="kesits-note" data-testid="save-overwrite-note">
          {saveNote}
        </p>
      ) : null}
      <p id="kesit-move-hint" className="visually-hidden">
        {t('kesit.moveHint')}
      </p>
      <p className="visually-hidden" role="status" data-testid="kesit-move-status">
        {moveNote}
      </p>
    </section>
  );
}
