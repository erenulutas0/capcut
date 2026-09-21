'use client';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import { captionMarks } from '@/domain/captionEditing';
import { outputCues, primaryCaptionTrack } from '@/domain/captions';
import type { Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { formatDurationShort, formatTimecode, type Micros } from '@/domain/time';
import { buildTimeline, totalOutputDurationUs } from '@/domain/timeline';
import { frameStepUs, resolveTrimTarget, trimBounds, type TrimEdge } from '@/domain/trim';
import type { MessageKey } from '@/i18n/messages';
import { TrimHandle } from './TrimHandle';

interface Props {
  t: (key: MessageKey) => string;
  project: Project;
  audio: MediaHandle | null;
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
  onPickAudio: () => void;
  /** Why the selected moment cannot be split right now, or null if it can. */
  splitBlocked: MessageKey | null;
  onSplit: () => void;
  /** Strip-level error (split/trim), shown with the inline error pattern. */
  error: MessageKey | null;
  playheadSourceUs: Micros;
  onTrimStart: () => void;
  onTrimPreview: (edge: TrimEdge, us: Micros) => void;
  onTrimCancel: (restoreSourceUs: Micros) => void;
  onTrimCommit: (
    clipId: string,
    range: { sourceInUs: Micros; sourceOutUs: Micros },
    coalesce: boolean,
  ) => void;
}

const HINT_ID = 'trim-hint';

export function OutputStrip({
  t,
  project,
  audio,
  selectedClipId,
  onSelect,
  onPickAudio,
  splitBlocked,
  onSplit,
  error,
  playheadSourceUs,
  onTrimStart,
  onTrimPreview,
  onTrimCancel,
  onTrimCommit,
}: Props) {
  const timeline = buildTimeline(project);
  const totalUs = totalOutputDurationUs(project);
  const frameUs = frameStepUs(project.export);
  const hasSelection = timeline.some((entry) => entry.clipId === selectedClipId);
  const hasCaptions = (primaryCaptionTrack(project)?.cues.length ?? 0) > 0;
  // Always the OUTPUT view: a source-anchored line sits wherever its picture
  // plays now, once per appearance, and not at all if no moment shows it.
  const marks = captionMarks(outputCues(project), totalUs);

  const handleFor = (clipId: string, index: number, edge: TrimEdge) => {
    const bounds = trimBounds(project, clipId, edge, WEB_LOCAL_POLICY);
    const clip = project.clips[index];
    if (!bounds || !clip) return null;
    const label = `${t('moments.item')} ${String(index + 1).padStart(2, '0')} ${t(
      edge === 'in' ? 'trim.startOf' : 'trim.endOf',
    )}`;
    return (
      <TrimHandle
        t={t}
        edge={edge}
        label={label}
        valueUs={bounds.valueUs}
        minUs={bounds.minUs}
        maxUs={bounds.maxUs}
        frameUs={frameUs}
        totalUs={totalUs}
        playheadSourceUs={playheadSourceUs}
        describedBy={HINT_ID}
        resolve={(rawUs) => resolveTrimTarget(project, clipId, edge, rawUs, WEB_LOCAL_POLICY)}
        onStart={onTrimStart}
        onPreview={onTrimPreview}
        onCancel={onTrimCancel}
        onCommit={(us, coalesce) =>
          onTrimCommit(
            clipId,
            edge === 'in'
              ? { sourceInUs: us, sourceOutUs: clip.sourceOutUs }
              : { sourceInUs: clip.sourceInUs, sourceOutUs: us },
            coalesce,
          )
        }
      />
    );
  };

  return (
    <section className="output-strip" aria-label={t('output.title')}>
      <div className="strip-head">
        <h2>{t('output.title')}</h2>
        <span className="strip-sub" data-testid="output-summary">
          {project.clips.length} {t('output.totalMoments')} · {formatDurationShort(totalUs)}
        </span>
        {timeline.length > 0 ? (
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
        ) : null}
        <span className="strip-note">{t('output.note')}</span>
      </div>

      {error ? (
        <p className="inline-error strip-error" role="alert" data-testid="strip-error">
          <Icon name="alert" />
          {t(error)}
        </p>
      ) : null}

      <div className="strip-row">
        <span className="strip-row-label">
          <Icon name="film" size={15} />
          {t('output.video')}
        </span>
        <div className="strip-track">
          {timeline.length === 0 ? (
            <span className="strip-empty">{t('output.empty')}</span>
          ) : (
            timeline.map((entry, index) => {
              const selected = entry.clipId === selectedClipId;
              return (
                <div
                  key={entry.clipId}
                  className="strip-clip"
                  data-selected={selected}
                  style={{ flexGrow: entry.durationUs, flexBasis: 0 }}
                  data-testid="strip-clip"
                >
                  <button
                    type="button"
                    className="strip-clip-select"
                    onClick={() => onSelect(entry.clipId)}
                    aria-pressed={selected}
                    // A short moment is a narrow block, so its label may be cut
                    // with an ellipsis on purpose. Nothing is lost: the full
                    // text stays the button's name, and the moment list shows
                    // number, duration and range.
                    data-truncates=""
                    title={`${formatTimecode(entry.startUs)} → ${formatTimecode(entry.endUs)}`}
                  >
                    {String(index + 1).padStart(2, '0')} · {formatDurationShort(entry.durationUs)}
                  </button>
                  {selected ? (
                    <>
                      {handleFor(entry.clipId, index, 'in')}
                      {handleFor(entry.clipId, index, 'out')}
                    </>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
      <p id={HINT_ID} className="strip-hint" hidden={!hasSelection}>
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
