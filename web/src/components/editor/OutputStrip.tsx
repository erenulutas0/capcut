'use client';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import type { ProjectV1 } from '@/domain/edl';
import { formatDurationShort, formatTimecode } from '@/domain/time';
import { buildTimeline, totalOutputDurationUs } from '@/domain/timeline';
import type { MessageKey } from '@/i18n/messages';

interface Props {
  t: (key: MessageKey) => string;
  project: ProjectV1;
  audio: MediaHandle | null;
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
  onPickAudio: () => void;
}

export function OutputStrip({ t, project, audio, selectedClipId, onSelect, onPickAudio }: Props) {
  const timeline = buildTimeline(project);
  const totalUs = totalOutputDurationUs(project);

  return (
    <section className="output-strip" aria-label={t('output.title')}>
      <div className="strip-head">
        <h2>{t('output.title')}</h2>
        <span className="strip-sub" data-testid="output-summary">
          {project.clips.length} {t('output.totalMoments')} · {formatDurationShort(totalUs)}
        </span>
        <span className="strip-note">{t('output.note')}</span>
      </div>

      <div className="strip-row">
        <span className="strip-row-label">
          <Icon name="film" size={15} />
          {t('output.video')}
        </span>
        <div className="strip-track">
          {timeline.length === 0 ? (
            <span className="strip-empty">{t('output.empty')}</span>
          ) : (
            timeline.map((entry, index) => (
              <button
                key={entry.clipId}
                type="button"
                className="strip-clip"
                data-selected={entry.clipId === selectedClipId}
                style={{ flexGrow: entry.durationUs, flexBasis: 0, minWidth: 54 }}
                onClick={() => onSelect(entry.clipId)}
                title={`${formatTimecode(entry.startUs)} → ${formatTimecode(entry.endUs)}`}
                data-testid="strip-clip"
              >
                {String(index + 1).padStart(2, '0')} · {formatDurationShort(entry.durationUs)}
              </button>
            ))
          )}
        </div>
      </div>

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
