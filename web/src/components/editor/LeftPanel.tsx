'use client';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import type { ProjectV1 } from '@/domain/edl';
import { formatBytes } from '@/domain/policy';
import { formatDurationShort, formatTimecode } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

export type LeftTab = 'moments' | 'sources';

interface Props {
  t: (key: MessageKey) => string;
  tab: LeftTab;
  onTabChange: (tab: LeftTab) => void;
  project: ProjectV1;
  video: MediaHandle | null;
  audio: MediaHandle | null;
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
  onEdit: (clipId: string) => void;
  onMove: (clipId: string, delta: -1 | 1) => void;
  onRemove: (clipId: string) => void;
  onPickVideo: () => void;
  onPickAudio: () => void;
}

function hasAudioLabel(t: (key: MessageKey) => string, hasAudio: boolean | undefined): string {
  if (hasAudio === true) return t('sources.hasAudio.yes');
  if (hasAudio === false) return t('sources.hasAudio.no');
  return t('sources.hasAudio.unknown');
}

export function MomentsList({
  t,
  project,
  selectedClipId,
  onSelect,
  onEdit,
  onMove,
  onRemove,
}: Pick<Props, 't' | 'project' | 'selectedClipId' | 'onSelect' | 'onEdit' | 'onMove' | 'onRemove'>) {
  return (
    <>
      <div className="section-head">
        <h2>{t('moments.title')}</h2>
        <span className="pill" data-testid="moment-count">
          {project.clips.length} {t('moments.count')}
        </span>
      </div>

      {project.clips.length === 0 ? (
        <p className="empty-state">{t('moments.empty')}</p>
      ) : (
        <ul className="moment-list" data-testid="moment-list">
          {project.clips.map((clip, index) => (
            <li
              key={clip.clipId}
              className="moment-card"
              data-selected={clip.clipId === selectedClipId}
              data-testid="moment-card"
            >
              <button
                type="button"
                className="moment-main"
                onClick={() => onSelect(clip.clipId)}
                onDoubleClick={() => onEdit(clip.clipId)}
                aria-current={clip.clipId === selectedClipId}
              >
                <span className="moment-thumb" aria-hidden="true">
                  <Icon name="film" size={16} />
                </span>
                <span className="moment-text">
                  <b>
                    {t('moments.item')} {String(index + 1).padStart(2, '0')}
                  </b>
                  <span className="moment-range">
                    {formatTimecode(clip.sourceInUs)} — {formatTimecode(clip.sourceOutUs)}
                  </span>
                </span>
              </button>
              <div className="moment-actions">
                <span className="moment-duration">
                  {formatDurationShort(clip.sourceOutUs - clip.sourceInUs)}
                </span>
                <div className="moment-buttons">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${t('moments.edit')} ${index + 1}`}
                    onClick={() => onEdit(clip.clipId)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${t('moments.moveUp')} ${index + 1}`}
                    disabled={index === 0}
                    onClick={() => onMove(clip.clipId, -1)}
                    data-testid="move-up"
                  >
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${t('moments.moveDown')} ${index + 1}`}
                    disabled={index === project.clips.length - 1}
                    onClick={() => onMove(clip.clipId, 1)}
                    data-testid="move-down"
                  >
                    <Icon name="down" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${t('moments.remove')} ${index + 1}`}
                    onClick={() => onRemove(clip.clipId)}
                    data-testid="remove-moment"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">{t('moments.hint')}</p>
    </>
  );
}

export function SourcesList({
  t,
  video,
  audio,
  onPickVideo,
  onPickAudio,
}: Pick<Props, 't' | 'video' | 'audio' | 'onPickVideo' | 'onPickAudio'>) {
  return (
    <>
      <div className="section-head">
        <h2>{t('sources.video')}</h2>
      </div>

      {video ? (
        <>
          <p className="file-name" data-testid="video-file-name">
            {safeFileName(video.fileName)}
          </p>
          <ul className="meta-list">
            <li>
              <span className="meta-key">{t('sources.duration')}</span>
              <span className="meta-value">{formatTimecode(video.durationUs)}</span>
            </li>
            <li>
              <span className="meta-key">{t('sources.resolution')}</span>
              <span className="meta-value">
                {video.displayWidth && video.displayHeight
                  ? `${video.displayWidth}×${video.displayHeight}`
                  : '—'}
              </span>
            </li>
            <li>
              <span className="meta-key">{t('sources.size')}</span>
              <span className="meta-value">{formatBytes(video.sizeBytes)}</span>
            </li>
            <li>
              <span className="meta-key">{t('sources.type')}</span>
              <span className="meta-value">{video.mimeType}</span>
            </li>
            <li>
              <span className="meta-key">{t('sources.hasAudio')}</span>
              <span className="meta-value">{hasAudioLabel(t, video.hasAudio)}</span>
            </li>
          </ul>
          <button type="button" className="btn btn-block" style={{ marginTop: 14 }} onClick={onPickVideo}>
            <Icon name="folder" />
            {t('sources.replace')}
          </button>
        </>
      ) : (
        <>
          <p className="empty-state">{t('sources.none')}</p>
          <button type="button" className="btn btn-accent btn-block" style={{ marginTop: 12 }} onClick={onPickVideo}>
            <Icon name="folder" />
            {t('preview.pickVideo')}
          </button>
        </>
      )}

      <hr className="divider" />

      <div className="section-head">
        <h2>{t('sources.audio')}</h2>
      </div>
      {audio ? (
        <>
          <p className="file-name" data-testid="audio-file-name">
            {safeFileName(audio.fileName)}
          </p>
          <ul className="meta-list">
            <li>
              <span className="meta-key">{t('sources.duration')}</span>
              <span className="meta-value">{formatTimecode(audio.durationUs)}</span>
            </li>
            <li>
              <span className="meta-key">{t('sources.size')}</span>
              <span className="meta-value">{formatBytes(audio.sizeBytes)}</span>
            </li>
            <li>
              <span className="meta-key">{t('sources.type')}</span>
              <span className="meta-value">{audio.mimeType}</span>
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="empty-state">{t('audio.none')}</p>
          <button type="button" className="btn btn-block" style={{ marginTop: 12 }} onClick={onPickAudio}>
            <Icon name="music" />
            {t('audio.pickMusic')}
          </button>
        </>
      )}

      <div className="notice" style={{ marginTop: 16 }}>
        <Icon name="shield" size={16} />
        <span>{t('sources.localOnly')}</span>
      </div>
    </>
  );
}

export function LeftPanel(props: Props) {
  const { t, tab, onTabChange } = props;
  return (
    <aside className="panel panel-left" aria-label={t('tabs.moments')}>
      <div className="segmented" role="tablist" aria-label={t('tabs.moments')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'moments'}
          onClick={() => onTabChange('moments')}
        >
          {t('tabs.moments')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sources'}
          onClick={() => onTabChange('sources')}
        >
          {t('tabs.sources')}
        </button>
      </div>
      <div className="panel-scroll">
        {tab === 'moments' ? <MomentsList {...props} /> : <SourcesList {...props} />}
      </div>
    </aside>
  );
}
