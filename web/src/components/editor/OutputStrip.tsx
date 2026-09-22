'use client';

import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import { captionMarks } from '@/domain/captionEditing';
import { outputCues, primaryCaptionTrack } from '@/domain/captions';
import type { Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import {
  formatDurationShort,
  formatSpokenTime,
  formatTimecode,
  US_PER_SECOND,
  type Micros,
} from '@/domain/time';
import { buildTimeline, totalOutputDurationUs } from '@/domain/timeline';
import {
  freezeScale,
  pieceAtOutput,
  pointerToOutputUs,
  resolveEdgeTrim,
  timelineReferenceUs,
  type FrozenScale,
} from '@/domain/timelineEdit';
import { frameStepUs, trimBounds, type TrimEdge } from '@/domain/trim';
import type { MessageKey } from '@/i18n/messages';
import { TrimHandle, type TrimCommitInfo, type TrimDragState } from './TrimHandle';

/** What the empty timeline offers once a video is open. */
export type TimelineEmptyState =
  | { kind: 'no_video' }
  | { kind: 'fits'; lengthUs: Micros }
  | { kind: 'too_long'; durationUs: Micros };

interface Props {
  t: (key: MessageKey) => string;
  project: Project;
  audio: MediaHandle | null;
  selectedClipId: string | null;
  /** Keyboard selection of a piece: select it and move the playhead to its start. */
  onSelect: (clipId: string) => void;
  onPickAudio: () => void;
  /** The one playhead, in output time. */
  outputTimeUs: Micros;
  /** A click, drag or key on the timeline: select the piece there (if any) and seek. */
  onSeek: (outputUs: Micros, selectClipId: string | null) => void;
  /** Why "Böl" cannot cut under the playhead right now, or null if it can. */
  splitBlocked: MessageKey | null;
  onSplit: () => void;
  /** Why "Sil" cannot delete right now, or null if it can. */
  deleteBlocked: MessageKey | null;
  onDelete: () => void;
  /** Strip-level error (split, trim, add), shown with the inline error pattern. */
  error: MessageKey | null;
  /** The last confirmation ("Parça 03 kısaltıldı: …"), read politely. */
  notice: string | null;
  onDismissNotice: () => void;
  /** Output length the strip keeps after edits (see `timelineReferenceUs`). */
  scaleFloorUs: Micros;
  onFit: () => void;
  empty: TimelineEmptyState;
  onAddWhole: () => void;
  onAddFirst: () => void;
  onAddRange: () => void;
  onTrimStart: () => void;
  onTrimPreview: (edge: TrimEdge, us: Micros) => void;
  onTrimCancel: () => void;
  onTrimCommit: (clipId: string, edge: TrimEdge, us: Micros, info: TrimCommitInfo) => void;
}

const TRIM_HINT_ID = 'trim-hint';
const TIMELINE_HINT_ID = 'timeline-hint';

interface ScrubSession {
  pointerId: number;
  scale: FrozenScale;
}

/**
 * The single timeline (ADR-019): the pieces of the output in order, one
 * playhead in output time, and the edit actions next to them.
 *
 * - Pointer down anywhere on the ruler or a piece moves the playhead there
 *   and selects that piece; dragging scrubs.
 * - The playhead itself is a slider: arrows move one frame, Shift a second,
 *   Home/End jump to the ends.
 * - The strip keeps its scale after edits, so a trim or delete shows up as
 *   empty track instead of the rest stretching back to full width.
 */
export function OutputStrip({
  t,
  project,
  audio,
  selectedClipId,
  onSelect,
  onPickAudio,
  outputTimeUs,
  onSeek,
  splitBlocked,
  onSplit,
  deleteBlocked,
  onDelete,
  error,
  notice,
  onDismissNotice,
  scaleFloorUs,
  onFit,
  empty,
  onAddWhole,
  onAddFirst,
  onAddRange,
  onTrimStart,
  onTrimPreview,
  onTrimCancel,
  onTrimCommit,
}: Props) {
  const timeline = buildTimeline(project);
  const totalUs = totalOutputDurationUs(project);
  const referenceUs = timelineReferenceUs(totalUs, scaleFloorUs);
  const frameUs = frameStepUs(project.export);
  const hasSelection = timeline.some((entry) => entry.clipId === selectedClipId);
  const hasCaptions = (primaryCaptionTrack(project)?.cues.length ?? 0) > 0;
  // Always the OUTPUT view: a source-anchored line sits wherever its picture
  // plays now, once per appearance, and not at all if no piece shows it.
  const marks = captionMarks(outputCues(project), totalUs);
  const pct = (us: Micros) => `${(us / referenceUs) * 100}%`;
  const playheadUs = Math.max(0, Math.min(outputTimeUs, totalUs));

  const [drag, setDrag] = useState<(TrimDragState & { clipId: string }) | null>(null);
  const scrubRef = useRef<ScrubSession | null>(null);

  const spoken = (us: Micros) =>
    formatSpokenTime(us, {
      minute: t('time.minute'),
      second: t('time.second'),
      decimalMark: t('time.decimalMark'),
    });

  const pieceLabel = (index: number) => `${t('moments.item')} ${String(index + 1).padStart(2, '0')}`;

  // ------------------------------------------------------------- scrubbing

  const seekFromPointer = (session: ScrubSession, clientX: number, select: boolean) => {
    const us = pointerToOutputUs(session.scale, clientX, Math.max(0, totalUs - 1));
    const entry = select ? pieceAtOutput(project, us) : null;
    onSeek(us, entry?.clipId ?? null);
  };

  const onTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (timeline.length === 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const session: ScrubSession = {
      pointerId: event.pointerId,
      // The scale is frozen for the whole scrub, like a trim drag.
      scale: freezeScale(rect.left, rect.width, referenceUs),
    };
    scrubRef.current = session;
    element.setPointerCapture(event.pointerId);
    seekFromPointer(session, event.clientX, true);
  };

  const onTrackPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = scrubRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    seekFromPointer(session, event.clientX, false);
  };

  const endScrub = (event: PointerEvent<HTMLDivElement>) => {
    const session = scrubRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPlayheadKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? US_PER_SECOND : frameUs;
    const last = Math.max(0, totalUs - 1);
    let next: Micros;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = playheadUs - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = playheadUs + step;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSeek(Math.max(0, Math.min(last, Math.round(next))), null);
  };

  // --------------------------------------------------------------- trimming

  const handleFor = (clipId: string, index: number, edge: TrimEdge) => {
    const bounds = trimBounds(project, clipId, edge, WEB_LOCAL_POLICY);
    const clip = project.clips[index];
    if (!bounds || !clip) return null;
    const label = `${pieceLabel(index)} ${t(edge === 'in' ? 'trim.startOf' : 'trim.endOf')}`;
    return (
      <TrimHandle
        t={t}
        edge={edge}
        label={label}
        valueUs={bounds.valueUs}
        otherEdgeUs={edge === 'in' ? clip.sourceOutUs : clip.sourceInUs}
        minUs={bounds.minUs}
        maxUs={bounds.maxUs}
        frameUs={frameUs}
        referenceUs={referenceUs}
        describedBy={TRIM_HINT_ID}
        resolve={(rawUs) => resolveEdgeTrim(project, clipId, edge, rawUs, WEB_LOCAL_POLICY)}
        onStart={onTrimStart}
        onPreview={onTrimPreview}
        onDrag={(state) => setDrag(state ? { ...state, clipId } : null)}
        onCancel={onTrimCancel}
        onCommit={(us, info) => onTrimCommit(clipId, edge, us, info)}
      />
    );
  };

  /** The part a drag in progress removes (faded) or adds (outlined), in frozen pixels. */
  const ghostFor = (clipId: string) => {
    if (!drag || drag.clipId !== clipId) return null;
    const deltaPx = (drag.valueUs - drag.startUs) / drag.usPerPx;
    if (deltaPx === 0) return null;
    const widthPx = Math.abs(deltaPx);
    const removes = drag.edge === 'in' ? deltaPx > 0 : deltaPx < 0;
    const style =
      drag.edge === 'in'
        ? { left: removes ? 0 : deltaPx, width: widthPx }
        : { right: removes ? 0 : -deltaPx, width: widthPx };
    return (
      <span
        className="tl-ghost"
        data-kind={removes ? 'remove' : 'add'}
        style={style}
        aria-hidden="true"
        data-testid="trim-ghost"
      />
    );
  };

  // ----------------------------------------------------------------- render

  const onPieceClick = (event: MouseEvent<HTMLButtonElement>, clipId: string) => {
    // A pointer press was already handled by the track (seek to the exact
    // spot). Only a keyboard "click" (Enter/Space, detail 0) lands here.
    if (event.detail === 0) onSelect(clipId);
  };

  const emptyLane = () => {
    if (empty.kind === 'too_long') {
      return (
        <div className="tl-empty" data-testid="timeline-too-long">
          <p className="tl-empty-title">
            {t('timeline.tooLongTitle').replace('{duration}', formatDurationShort(empty.durationUs))}
          </p>
          <p className="tl-empty-body">{t('timeline.tooLongBody')}</p>
          <div className="tl-empty-actions">
            <button type="button" className="btn btn-accent btn-compact" onClick={onAddFirst} data-testid="timeline-add-first">
              <Icon name="plus" size={16} />
              {t('timeline.addFirst')}
            </button>
            <button type="button" className="btn btn-compact" onClick={onAddRange} data-testid="timeline-add-range">
              {t('timeline.addRange')}
            </button>
          </div>
        </div>
      );
    }
    if (empty.kind === 'fits') {
      return (
        <div className="tl-empty" data-testid="timeline-empty">
          <p className="tl-empty-body">{t('timeline.emptyBody')}</p>
          <div className="tl-empty-actions">
            <button type="button" className="btn btn-accent btn-compact" onClick={onAddWhole} data-testid="timeline-add-whole">
              <Icon name="plus" size={16} />
              {t('timeline.addWhole')}
            </button>
            <button type="button" className="btn btn-compact" onClick={onAddRange} data-testid="timeline-add-range">
              {t('timeline.addRange')}
            </button>
          </div>
        </div>
      );
    }
    return <span className="strip-empty">{t('output.empty')}</span>;
  };

  return (
    <section className="output-strip" aria-label={t('output.title')}>
      <div className="strip-head">
        <h2>{t('output.title')}</h2>
        <span className="strip-sub" data-testid="output-summary">
          {project.clips.length} {t('output.totalMoments')} · {formatDurationShort(totalUs)}
        </span>
        {timeline.length > 0 ? (
          <div className="tl-actions">
            <button
              type="button"
              className="btn btn-compact"
              // aria-disabled, not disabled: the button stays focusable and a
              // press explains why nothing happened (doc 06).
              aria-disabled={splitBlocked !== null}
              title={splitBlocked ? t(splitBlocked) : t('split.ready')}
              onClick={onSplit}
              data-testid="split-selected"
            >
              <Icon name="scissors" size={16} />
              {t('split.action')}
              {splitBlocked ? <span className="visually-hidden">{`: ${t(splitBlocked)}`}</span> : null}
            </button>
            <button
              type="button"
              className="btn btn-compact"
              aria-disabled={deleteBlocked !== null}
              title={deleteBlocked ? t(deleteBlocked) : t('timeline.deleteReady')}
              onClick={onDelete}
              data-testid="delete-selected"
            >
              <Icon name="trash" size={16} />
              {t('timeline.delete')}
              {deleteBlocked ? <span className="visually-hidden">{`: ${t(deleteBlocked)}`}</span> : null}
            </button>
            {referenceUs > totalUs ? (
              <button
                type="button"
                className="btn btn-compact"
                onClick={onFit}
                aria-label={t('timeline.fitLabel')}
                data-testid="timeline-fit"
              >
                {t('timeline.fit')}
              </button>
            ) : null}
          </div>
        ) : null}
        <span className="strip-note">{t('output.note')}</span>
      </div>

      {error ? (
        <p className="inline-error strip-error" role="alert" data-testid="strip-error">
          <Icon name="alert" />
          {t(error)}
        </p>
      ) : null}

      {/* Always in the page, so a screen reader is already listening when a
          confirmation arrives. */}
      <div className="tl-notice-row" data-empty={notice === null}>
        <p className="tl-notice" role="status" aria-live="polite" data-testid="timeline-notice">
          {notice ?? ''}
        </p>
        {notice ? (
          <button
            type="button"
            className="icon-btn tl-notice-close"
            onClick={onDismissNotice}
            aria-label={t('timeline.notice.dismiss')}
          >
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>

      <div className="strip-row">
        <span className="strip-row-label">
          <Icon name="film" size={15} />
          {t('output.video')}
        </span>
        {timeline.length === 0 ? (
          <div className="strip-track">{emptyLane()}</div>
        ) : (
          <div
            className="tl-track"
            data-testid="timeline-track"
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
          >
            <div className="tl-ruler" aria-hidden="true">
              <span className="tl-ruler-time">{formatTimecode(playheadUs)}</span>
            </div>
            <div className="tl-lane" data-testid="timeline-lane">
              {/* The output length the strip keeps after edits: what was cut
                  away shows as empty track until "Sığdır". */}
              {referenceUs > totalUs ? (
                <span
                  className="tl-cut-space"
                  style={{ left: pct(totalUs), width: pct(referenceUs - totalUs) }}
                  aria-hidden="true"
                />
              ) : null}
              {timeline.map((entry, index) => {
                const selected = entry.clipId === selectedClipId;
                return (
                  <div
                    key={entry.clipId}
                    className="strip-clip"
                    data-selected={selected}
                    style={{ left: pct(entry.startUs), width: pct(entry.durationUs) }}
                    data-testid="strip-clip"
                  >
                    <button
                      type="button"
                      className="strip-clip-select"
                      onClick={(event) => onPieceClick(event, entry.clipId)}
                      aria-pressed={selected}
                      aria-label={`${pieceLabel(index)} · ${formatDurationShort(entry.durationUs)}`}
                      // A short piece is a narrow block, so its label may be cut
                      // with an ellipsis on purpose. Nothing is lost: the full
                      // text stays the button's name, and the piece list shows
                      // number, duration and range.
                      data-truncates=""
                      title={`${formatTimecode(entry.startUs)} → ${formatTimecode(entry.endUs)}`}
                    >
                      {String(index + 1).padStart(2, '0')} · {formatDurationShort(entry.durationUs)}
                    </button>
                    {ghostFor(entry.clipId)}
                    {selected ? (
                      <>
                        {handleFor(entry.clipId, index, 'in')}
                        {handleFor(entry.clipId, index, 'out')}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div
              role="slider"
              tabIndex={0}
              className="tl-playhead"
              style={{ left: pct(playheadUs) }}
              aria-label={t('timeline.playhead')}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={totalUs / US_PER_SECOND}
              aria-valuenow={playheadUs / US_PER_SECOND}
              aria-valuetext={t('timeline.playheadValue')
                .replace('{now}', spoken(playheadUs))
                .replace('{total}', spoken(totalUs))}
              aria-describedby={TIMELINE_HINT_ID}
              onKeyDown={onPlayheadKeyDown}
              data-testid="timeline-playhead"
            >
              <span className="tl-playhead-knob" aria-hidden="true" />
              <span className="tl-playhead-line" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
      <p id={TIMELINE_HINT_ID} className="strip-hint" hidden={timeline.length === 0}>
        {t('timeline.hint')}
      </p>
      <p id={TRIM_HINT_ID} className="strip-hint" hidden={!hasSelection}>
        {t('trim.hint')}
      </p>

      {hasCaptions ? (
        // Read-only overview of where the lines are; they are edited in the
        // caption panel, which also lists them as text for screen readers.
        <div className="strip-row strip-row-thin">
          <span className="strip-row-label">
            <Icon name="captions" size={15} />
            {t('captions.strip')}
          </span>
          <div className="strip-captions" aria-hidden="true" data-testid="strip-captions">
            {/* Same scale as the pieces above. */}
            <div className="strip-captions-inner" style={{ width: pct(totalUs) }}>
              {marks.map((mark) => (
                <span
                  // Appearances never overlap, so the start is unique.
                  key={`${mark.cueId}-${mark.startUs}`}
                  className="strip-caption-mark"
                  data-visibility={mark.visibility}
                  data-cue-id={mark.cueId}
                  style={{ left: `${mark.leftPct}%`, width: `${mark.widthPct}%` }}
                  title={`${formatTimecode(mark.startUs)} → ${formatTimecode(mark.endUs)} · ${mark.text}`}
                  data-testid="strip-caption-mark"
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="strip-row">
        <span className="strip-row-label">
          <Icon name="music" size={15} />
          {t('output.music')}
        </span>
        {project.music && audio ? (
          <div className="strip-music">
            <Icon name="music" size={15} />
            <span className="strip-music-name">{safeFileName(audio.fileName, 48)}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-time)', fontSize: 12 }}>
              {formatTimecode(project.music.timelineStartUs)} →{' '}
              {formatDurationShort(project.music.sourceOutUs - project.music.sourceInUs)}
            </span>
          </div>
        ) : (
          <button type="button" className="strip-music" onClick={onPickAudio} data-testid="strip-add-music">
            <Icon name="plus" size={15} />
            {t('audio.pickMusic')}
          </button>
        )}
      </div>
    </section>
  );
}
