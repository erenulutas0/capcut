'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import type { AspectRatio, FitMode, MusicV1, Project } from '@/domain/edl';
import { formatTimecode, parseTimecode, US_PER_SECOND } from '@/domain/time';
import { MAX_ZOOM, MIN_ZOOM } from '@/domain/transform';
import type { MessageKey } from '@/i18n/messages';
import { onTablistKeyDown } from './tablist';

export type InspectorTab = 'frame' | 'audio' | 'captions';

interface Props {
  t: (key: MessageKey) => string;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  project: Project;
  audio: MediaHandle | null;
  framing: { fit: FitMode; zoom: number };
  onFraming: (framing: { aspect?: AspectRatio; fit?: FitMode; zoom?: number }) => void;
  /** Output resolution (short edge), for every download. */
  onShortEdge: (shortEdge: number) => void;
  /** The video's own sound, the same for every kesit (ADR-026). */
  videoSound: { gainDb: number; muted: boolean };
  onVideoGain: (gainDb: number) => void;
  onVideoMuted: (muted: boolean) => void;
  onMusicChange: (patch: Partial<Omit<MusicV1, 'assetId'>>) => boolean;
  onPickAudio: () => void;
  onRemoveAudio: () => void;
  /** Shown instead of the music controls when its file needs re-linking. */
  relinkNode?: React.ReactNode;
  /** The caption panel, built by the editor (it needs playback and history). */
  captionsNode: React.ReactNode;
}

const ASPECT_CHOICES: Array<{ value: AspectRatio; labelKey: MessageKey; w: number; h: number }> = [
  { value: '9:16', labelKey: 'frame.portrait', w: 16, h: 28 },
  { value: '16:9', labelKey: 'frame.landscape', w: 30, h: 17 },
  { value: '1:1', labelKey: 'frame.square', w: 22, h: 22 },
];

export function FramePanel({
  t,
  project,
  framing,
  onFraming,
  onShortEdge,
}: Pick<Props, 't' | 'project' | 'framing' | 'onFraming' | 'onShortEdge'>) {
  return (
    <>
      <div className="section-head">
        <h2>{t('frame.title')}</h2>
      </div>

      <div className="choice-grid" role="group" aria-label={t('frame.title')}>
        {ASPECT_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="choice"
            aria-pressed={project.canvas.aspect === choice.value}
            onClick={() => onFraming({ aspect: choice.value })}
            data-testid={`aspect-${choice.value.replace(':', '-')}`}
          >
            <span
              className="choice-shape"
              style={{ width: choice.w, height: choice.h }}
              aria-hidden="true"
            />
            {t(choice.labelKey)}
          </button>
        ))}
      </div>

      <hr className="divider" />

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">{t('frame.layout')}</legend>
        <label className="radio-row">
          <input
            type="radio"
            name="fit"
            checked={framing.fit === 'cover'}
            onChange={() => onFraming({ fit: 'cover' })}
            data-testid="fit-cover"
          />
          <span>
            {t('frame.cover')}
            <small>{t('frame.coverHint')}</small>
          </span>
        </label>
        <label className="radio-row">
          <input
            type="radio"
            name="fit"
            checked={framing.fit === 'contain'}
            onChange={() => onFraming({ fit: 'contain' })}
            data-testid="fit-contain"
          />
          <span>
            {t('frame.contain')}
            <small>{t('frame.containHint')}</small>
          </span>
        </label>
      </fieldset>

      <hr className="divider" />

      <div className="slider-head">
        <label className="field-label" htmlFor="zoom" style={{ margin: 0 }}>
          {t('frame.zoom')}
        </label>
        <span className="slider-value">{Math.round(framing.zoom * 100)}%</span>
      </div>
      <input
        id="zoom"
        type="range"
        min={MIN_ZOOM * 100}
        max={MAX_ZOOM * 100}
        step={5}
        value={Math.round(framing.zoom * 100)}
        onChange={(event) => onFraming({ zoom: Number(event.target.value) / 100 })}
        style={{
          ['--range-pct' as string]: `${((framing.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`,
        }}
        data-testid="zoom-slider"
      />

      <hr className="divider" />

      <label className="field-label" htmlFor="export-quality">
        {t('export.quality')}
      </label>
      <select
        id="export-quality"
        className="select"
        value={project.export.shortEdge}
        onChange={(event) => onShortEdge(Number(event.target.value))}
        data-testid="export-quality"
      >
        <option value={1080}>1080p · H.264 / AAC</option>
        <option value={720}>720p · H.264 / AAC</option>
      </select>

      <p className="hint-small">{t('frame.appliesToAll')}</p>
      <p className="hint">{t('frame.note')}</p>
    </>
  );
}

function TimeField({
  id,
  label,
  valueUs,
  onCommit,
  disabled,
  testId,
}: {
  id: string;
  label: string;
  valueUs: number;
  onCommit: (us: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  // Remounted whenever the committed value changes (see the `key` below), so
  // the field never needs to sync a prop into state.
  const [text, setText] = useState(() => formatTimecode(valueUs));
  const [invalid, setInvalid] = useState(false);

  return (
    <div style={{ marginBottom: 12 }}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="time-input"
        value={text}
        inputMode="decimal"
        disabled={disabled}
        aria-invalid={invalid}
        data-testid={testId}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const parsed = parseTimecode(text);
          if (parsed === null) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onCommit(parsed);
        }}
      />
    </div>
  );
}

export function AudioPanel({
  t,
  project,
  audio,
  videoSound,
  onVideoGain,
  onVideoMuted,
  onMusicChange,
  onPickAudio,
  onRemoveAudio,
  relinkNode,
}: Pick<
  Props,
  | 't'
  | 'project'
  | 'audio'
  | 'videoSound'
  | 'onVideoGain'
  | 'onVideoMuted'
  | 'onMusicChange'
  | 'onPickAudio'
  | 'onRemoveAudio'
  | 'relinkNode'
>) {
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const music = project.music;

  useEffect(
    () => () => {
      previewRef.current?.pause();
    },
    [],
  );

  const toggleMusicPreview = () => {
    const element = previewRef.current;
    if (!element || !music) return;
    if (previewing) {
      element.pause();
      setPreviewing(false);
      return;
    }
    element.currentTime = music.sourceInUs / US_PER_SECOND;
    element.volume = 1;
    void element
      .play()
      .then(() => setPreviewing(true))
      .catch(() => setPreviewing(false));
  };

  return (
    <>
      <div className="section-head">
        <h2>{t('audio.sourceTitle')}</h2>
      </div>

      <div className="slider-head">
        <label className="field-label" htmlFor="clip-gain" style={{ margin: 0 }}>
          {t('audio.sourceLevel')}
        </label>
        <span className="slider-value">{videoSound.muted ? '—' : `${videoSound.gainDb} dB`}</span>
      </div>
      <input
        id="clip-gain"
        type="range"
        min={-60}
        max={0}
        step={1}
        value={videoSound.gainDb}
        disabled={videoSound.muted}
        onChange={(event) => onVideoGain(Number(event.target.value))}
        style={{ ['--range-pct' as string]: `${((videoSound.gainDb + 60) / 60) * 100}%` }}
        data-testid="clip-gain"
      />
      <button
        type="button"
        className="btn btn-block"
        style={{ marginTop: 10 }}
        onClick={() => onVideoMuted(!videoSound.muted)}
        aria-pressed={videoSound.muted}
        data-testid="clip-mute"
      >
        {videoSound.muted ? t('audio.unmute') : t('audio.mute')}
      </button>
      <p className="hint-small">{t('audio.appliesToAll')}</p>

      <hr className="divider" />

      <div className="section-head">
        <h2>{t('audio.musicTitle')}</h2>
      </div>

      {music && !audio && relinkNode ? (
        relinkNode
      ) : music && audio ? (
        <>
          <p className="file-name" data-testid="music-file-name">
            {safeFileName(audio.fileName)}
          </p>
          <ul className="meta-list" style={{ marginBottom: 14 }}>
            <li>
              <span className="meta-key">{t('sources.duration')}</span>
              <span className="meta-value">{formatTimecode(audio.durationUs)}</span>
            </li>
          </ul>

          <p className="field-label">{t('audio.segment')}</p>
          <TimeField
            key={`music-in-${music.sourceInUs}`}
            id="music-in"
            label={t('range.start')}
            valueUs={music.sourceInUs}
            onCommit={(us) => onMusicChange({ sourceInUs: us })}
            testId="music-in"
          />
          <TimeField
            key={`music-out-${music.sourceOutUs}`}
            id="music-out"
            label={t('range.end')}
            valueUs={music.sourceOutUs}
            onCommit={(us) => onMusicChange({ sourceOutUs: us })}
            testId="music-out"
          />
          <TimeField
            key={`music-start-${music.timelineStartUs}`}
            id="music-start"
            label={t('audio.timelineStart')}
            valueUs={music.timelineStartUs}
            onCommit={(us) => onMusicChange({ timelineStartUs: us })}
            testId="music-start"
          />

          <div className="slider-head">
            <label className="field-label" htmlFor="music-gain" style={{ margin: 0 }}>
              {t('audio.level')}
            </label>
            <span className="slider-value">{music.gainDb} dB</span>
          </div>
          <input
            id="music-gain"
            type="range"
            min={-60}
            max={0}
            step={1}
            value={music.gainDb}
            onChange={(event) => onMusicChange({ gainDb: Number(event.target.value) })}
            style={{ ['--range-pct' as string]: `${((music.gainDb + 60) / 60) * 100}%` }}
            data-testid="music-gain"
          />

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <TimeFieldInline
              id="fade-in"
              label={t('audio.fadeIn')}
              valueUs={music.fadeInUs}
              onCommit={(us) => onMusicChange({ fadeInUs: us })}
            />
            <TimeFieldInline
              id="fade-out"
              label={t('audio.fadeOut')}
              valueUs={music.fadeOutUs}
              onCommit={(us) => onMusicChange({ fadeOutUs: us })}
            />
          </div>

          <audio ref={previewRef} src={audio.objectUrl} preload="metadata" onEnded={() => setPreviewing(false)} />
          <button
            type="button"
            className="btn btn-block"
            style={{ marginTop: 14 }}
            onClick={toggleMusicPreview}
            data-testid="music-preview"
          >
            <Icon name={previewing ? 'pause' : 'play'} />
            {previewing ? t('audio.stopMusic') : t('audio.previewMusic')}
          </button>
          <button type="button" className="btn btn-block" style={{ marginTop: 8 }} onClick={onPickAudio}>
            <Icon name="folder" />
            {t('audio.replaceMusic')}
          </button>
          <button
            type="button"
            className="btn btn-block btn-danger"
            style={{ marginTop: 8 }}
            onClick={onRemoveAudio}
            data-testid="remove-music"
          >
            <Icon name="trash" />
            {t('audio.removeMusic')}
          </button>

          <div className="notice notice-warning" style={{ marginTop: 16 }}>
            <Icon name="alert" size={16} />
            <span>{t('audio.mixNote')}</span>
          </div>
        </>
      ) : (
        <>
          <p className="empty-state">{t('audio.none')}</p>
          <button
            type="button"
            className="btn btn-block"
            style={{ marginTop: 12 }}
            onClick={onPickAudio}
            data-testid="pick-music"
          >
            <Icon name="music" />
            {t('audio.pickMusic')}
          </button>
        </>
      )}
    </>
  );
}

function TimeFieldInline({
  id,
  label,
  valueUs,
  onCommit,
}: {
  id: string;
  label: string;
  valueUs: number;
  onCommit: (us: number) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <TimeField key={`${id}-${valueUs}`} id={id} label={label} valueUs={valueUs} onCommit={onCommit} />
    </div>
  );
}

/**
 * "Ayarlar" (ADR-026): what used to be the inspector, behind one button — a
 * drawer on desktop, a sheet on a phone. Görüntü, Ses and Altyazı apply to
 * every download.
 */
export function SettingsPanel(props: Props) {
  const { t, tab, onTabChange } = props;
  return (
    <div className="settings">
      <div
        className="segmented"
        role="tablist"
        aria-label={t('a11y.inspector')}
        onKeyDown={onTablistKeyDown}
      >
        <button
          type="button"
          role="tab"
          id="inspector-tab-frame"
          aria-selected={tab === 'frame'}
          aria-controls="inspector-panel"
          tabIndex={tab === 'frame' ? 0 : -1}
          onClick={() => onTabChange('frame')}
          data-testid="inspector-tab-frame"
        >
          <Icon name="frame" size={16} />
          {t('tabs.frame')}
        </button>
        <button
          type="button"
          role="tab"
          id="inspector-tab-audio"
          aria-selected={tab === 'audio'}
          aria-controls="inspector-panel"
          tabIndex={tab === 'audio' ? 0 : -1}
          onClick={() => onTabChange('audio')}
          data-testid="inspector-tab-audio"
        >
          <Icon name="music" size={16} />
          {t('tabs.audio')}
        </button>
        <button
          type="button"
          role="tab"
          id="inspector-tab-captions"
          aria-selected={tab === 'captions'}
          aria-controls="inspector-panel"
          tabIndex={tab === 'captions' ? 0 : -1}
          onClick={() => onTabChange('captions')}
          data-testid="inspector-tab-captions"
        >
          <Icon name="captions" size={16} />
          {t('captions.tab')}
        </button>
      </div>
      <div className="settings-panel" role="tabpanel" id="inspector-panel" aria-labelledby={`inspector-tab-${tab}`}>
        {tab === 'frame' ? <FramePanel {...props} /> : tab === 'audio' ? <AudioPanel {...props} /> : props.captionsNode}
      </div>
    </div>
  );
}
