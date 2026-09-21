'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, Wordmark } from '@/components/Icon';
import { translator, type MessageKey } from '@/i18n/messages';
import { ExportDialog } from './ExportDialog';
import { HelpDialog } from './HelpDialog';
import { Sheet } from './Dialog';
import { AudioPanel, FramePanel, Inspector, type InspectorTab } from './Inspector';
import { LeftPanel, MomentsList, SourcesList, type LeftTab } from './LeftPanel';
import { OutputStrip } from './OutputStrip';
import { PreviewStage } from './PreviewStage';
import { RangeEditor } from './RangeEditor';
import { RelinkPanel } from './RelinkPanel';
import { SaveStateBadge } from './SaveStateBadge';
import { useProjectPersistence } from './useProjectPersistence';
import { useEditorState, type PreviewMode } from './useEditorState';
import { useLayoutMode } from './useLayoutMode';
import { usePlayback } from './usePlayback';

type MobileSheet = 'moments' | 'frame' | 'audio' | 'sources' | null;

const t = translator('tr');

const CANVAS_ASPECT_CSS: Record<string, string> = {
  '9:16': '9 / 16',
  '16:9': '16 / 9',
  '1:1': '1 / 1',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function EditorApp() {
  const layout = useLayoutMode();
  const state = useEditorState();
  // The component owns the media elements; the playback hook only drives them.
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const musicElementRef = useRef<HTMLAudioElement | null>(null);
  const playback = usePlayback({
    videoRef: videoElementRef,
    musicRef: musicElementRef,
    project: state.project,
    mode: state.previewMode,
    hasVideo: state.video !== null,
    hasMusicFile: state.audio !== null,
  });

  const persistence = useProjectPersistence({
    project: state.project,
    title: state.title,
    bindings: state.bindings,
    onRestore: state.restoreFromRecord,
  });

  const [leftTab, setLeftTab] = useState<LeftTab>('moments');
  const [backupMessage, setBackupMessage] = useState<MessageKey | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('frame');
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [momentsDrawerOpen, setMomentsDrawerOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const editingClip =
    state.project.clips.find((clip) => clip.clipId === editingClipId) ?? null;

  const pickVideo = useCallback(() => {
    if (state.project.clips.length > 0 && !window.confirm(t('sources.replaceWarning'))) return;
    videoInputRef.current?.click();
  }, [state.project.clips.length]);

  const pickAudio = useCallback(() => audioInputRef.current?.click(), []);

  const changeMode = useCallback(
    (mode: PreviewMode) => {
      playback.prepareMode(mode);
      state.setPreviewMode(mode);
    },
    [playback, state],
  );

  const removeMoment = useCallback(
    (clipId: string) => {
      // Leaving result mode with nothing to show is handled here, at the event,
      // rather than by correcting state in an effect afterwards.
      if (state.project.clips.length <= 1) {
        playback.prepareMode('source');
        state.setPreviewMode('source');
      }
      if (editingClipId === clipId) setEditingClipId(null);
      state.dropMoment(clipId);
    },
    [editingClipId, playback, state],
  );

  const handleAdd = useCallback(
    (inUs: number, outUs: number) => {
      playback.stop();
      return state.addMoment(inUs, outUs);
    },
    [playback, state],
  );

  const handleUpdate = useCallback(
    (clipId: string, inUs: number, outUs: number) => {
      const ok = state.editMomentRange(clipId, inUs, outUs);
      if (ok) setEditingClipId(null);
      return ok;
    },
    [state],
  );

  const startEditing = useCallback(
    (clipId: string) => {
      setEditingClipId(clipId);
      state.setSelectedClipId(clipId);
      setMobileSheet(null);
      setMomentsDrawerOpen(false);
      const clip = state.project.clips.find((item) => item.clipId === clipId);
      if (clip && state.previewMode === 'source') playback.seekSource(clip.sourceInUs);
    },
    [playback, state],
  );

  // Keyboard shortcuts never fire while a text or time field has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const meta = event.ctrlKey || event.metaKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (!state.video) return;
        event.preventDefault();
        playback.togglePlay();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback, state]);

  const backupPanel = (
    <div data-testid="backup-panel">
      <p className="field-label">{t('backup.title')}</p>
      <p className="hint-small" style={{ marginBottom: 10 }}>
        {t('backup.body')}
      </p>
      <button
        type="button"
        className="btn btn-block"
        onClick={persistence.downloadBackup}
        data-testid="backup-download"
      >
        <Icon name="download" />
        {t('backup.download')}
      </button>
      <button
        type="button"
        className="btn btn-block"
        style={{ marginTop: 8 }}
        onClick={() => backupInputRef.current?.click()}
        data-testid="backup-import"
      >
        <Icon name="folder" />
        {t('backup.import')}
      </button>
      {backupMessage ? (
        <p className="hint-small" role="status" data-testid="backup-message">
          {t(backupMessage)}
        </p>
      ) : null}
    </div>
  );

  const leftPanelProps = {
    t,
    tab: leftTab,
    onTabChange: setLeftTab,
    project: state.project,
    video: state.video,
    audio: state.audio,
    selectedClipId: state.selectedClipId,
    onSelect: state.setSelectedClipId,
    onEdit: startEditing,
    onMove: state.shiftMoment,
    onRemove: removeMoment,
    onPickVideo: pickVideo,
    onPickAudio: pickAudio,
  };

  const relinkAudioNode = state.missingAudioBinding ? (
    <RelinkPanel
      t={t}
      binding={state.missingAudioBinding}
      onPick={state.relinkAudio}
      onUseAsNew={(file) => void state.importAudio(file)}
    />
  ) : null;

  const inspectorProps = {
    t,
    tab: inspectorTab,
    onTabChange: setInspectorTab,
    project: state.project,
    audio: state.audio,
    framing: state.framing,
    selectedClip: state.selectedClip,
    onFraming: state.changeFraming,
    onClipGain: state.changeClipGain,
    onClipMuted: state.changeClipMuted,
    onMusicChange: state.changeMusic,
    onPickAudio: pickAudio,
    onRemoveAudio: state.dropAudio,
    relinkNode: relinkAudioNode,
  };

  return (
    <div
      className="editor-root"
      data-mode={layout}
      style={{
        ['--canvas-aspect' as string]:
          CANVAS_ASPECT_CSS[state.project.canvas.aspect] ?? '16 / 9',
      }}
    >
      <div className="prototype-banner">
        <span>{t('banner.prototype')}</span>
        <Link href="/" style={{ color: 'inherit' }}>
          {t('app.name')}
        </Link>
      </div>

      <header className="topbar">
        <Wordmark />
        <div className="topbar-title">
          {layout === 'phone' ? null : (
            <>
              <label className="visually-hidden" htmlFor="project-title">
                {t('topbar.renameLabel')}
              </label>
              <input
                id="project-title"
                className="title-input"
                value={state.title}
                placeholder={t('topbar.untitled')}
                onChange={(event) => state.setTitle(event.target.value)}
                data-testid="project-title"
              />
            </>
          )}
          {layout === 'phone' ? null : (
            <SaveStateBadge
              t={t}
              state={persistence.saveState}
              onDownloadBackup={persistence.downloadBackup}
            />
          )}
        </div>

        <div className="topbar-actions">
          {layout === 'tablet' ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMomentsDrawerOpen(true)}
              aria-label={t('tabs.moments')}
              data-testid="open-moments-drawer"
            >
              <Icon name="film" />
            </button>
          ) : null}
          {layout === 'narrow' || layout === 'tablet' ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('tabs.frame')}
              data-testid="open-inspector-drawer"
            >
              <Icon name="frame" />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={state.undo}
            disabled={!state.canUndo}
            aria-label={t('topbar.undo')}
            data-testid="undo"
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={state.redo}
            disabled={!state.canRedo}
            aria-label={t('topbar.redo')}
            data-testid="redo"
          >
            <Icon name="redo" />
          </button>
          {layout === 'phone' ? null : (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setHelpOpen(true)}
              aria-label={t('topbar.help')}
              data-testid="open-help"
            >
              <Icon name="help" />
            </button>
          )}
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => setExportOpen(true)}
            data-testid="open-export"
          >
            <Icon name="download" />
            {t('topbar.export')}
          </button>
        </div>
      </header>

      <div className="editor-body" data-mode={layout}>
        {layout === 'wide' || layout === 'narrow' ? <LeftPanel {...leftPanelProps} /> : null}

        {state.missingVideoBinding ? (
          <section className="stage" aria-label={t('relink.title')}>
            <RelinkPanel
              t={t}
              binding={state.missingVideoBinding}
              onPick={state.relinkVideo}
              onUseAsNew={(file) => void state.importVideo(file)}
              onDiscardProject={() => {
                if (!window.confirm(t('relink.discardConfirm'))) return;
                void persistence.forget().then(() => window.location.reload());
              }}
            />
            {state.mediaError ? (
              <p className="inline-error" role="alert" data-testid="media-error">
                <Icon name="alert" />
                {t(`error.${state.mediaError.reason}` as MessageKey)}
              </p>
            ) : null}
          </section>
        ) : (
        <PreviewStage
          t={t}
          project={state.project}
          video={state.video}
          mode={state.previewMode}
          onModeChange={changeMode}
          videoRef={videoElementRef}
          playing={playback.playing}
          playbackError={playback.playbackError}
          sourceTimeUs={playback.sourceTimeUs}
          outputTimeUs={playback.outputTimeUs}
          outputDurationUs={playback.outputDurationUs}
          onTogglePlay={playback.togglePlay}
          onSeekSource={playback.seekSource}
          onSeekOutput={playback.seekOutput}
          onPickVideo={pickVideo}
          importing={state.importing === 'video'}
        >
          {state.mediaError ? (
            <p className="inline-error" role="alert" data-testid="media-error">
              <Icon name="alert" />
              {t(`error.${state.mediaError.reason}` as MessageKey)}
            </p>
          ) : null}

          {state.previewMode === 'source' ? (
            <RangeEditor
              key={`${editingClipId ?? 'new-moment'}:${state.video?.objectUrl ?? ''}`}
              t={t}
              disabled={!state.video}
              sourceTimeUs={playback.sourceTimeUs}
              sourceDurationUs={state.video?.durationUs ?? 0}
              editingClip={editingClip}
              actionError={state.actionError}
              onAdd={handleAdd}
              onUpdate={handleUpdate}
              onCancelEdit={() => setEditingClipId(null)}
              onPreviewRange={playback.seekSource}
            />
          ) : null}
        </PreviewStage>
        )}

        {layout === 'wide' ? <Inspector {...inspectorProps} /> : null}
      </div>

      <OutputStrip
        t={t}
        project={state.project}
        audio={state.audio}
        selectedClipId={state.selectedClipId}
        onSelect={state.setSelectedClipId}
        onPickAudio={pickAudio}
      />

      {layout === 'phone' ? null : (
        <footer className="status-bar">
          <span>{t('footer.local')}</span>
          <span className="shortcut-hints">Space · I · O · Ctrl/Cmd+Z</span>
        </footer>
      )}

      {layout === 'phone' ? (
      <nav className="mobile-tabbar" aria-label={t('tabs.moments')}>
        <button
          type="button"
          onClick={() => setMobileSheet('moments')}
          aria-expanded={mobileSheet === 'moments'}
          data-testid="tab-moments"
        >
          <Icon name="film" size={20} />
          {t('tabs.moments')}
        </button>
        <button
          type="button"
          onClick={() => setMobileSheet('frame')}
          aria-expanded={mobileSheet === 'frame'}
          data-testid="tab-frame"
        >
          <Icon name="frame" size={20} />
          {t('tabs.frame')}
        </button>
        <button
          type="button"
          onClick={() => setMobileSheet('audio')}
          aria-expanded={mobileSheet === 'audio'}
          data-testid="tab-audio"
        >
          <Icon name="music" size={20} />
          {t('tabs.audio')}
        </button>
        <button
          type="button"
          onClick={() => setMobileSheet('sources')}
          aria-expanded={mobileSheet === 'sources'}
          data-testid="tab-file"
        >
          <Icon name="folder" size={20} />
          {t('tabs.file')}
        </button>
      </nav>
      ) : null}

      {/* Drawers for the tablet/narrow shells */}
      <Sheet
        open={layout === 'tablet' && momentsDrawerOpen}
        onClose={() => setMomentsDrawerOpen(false)}
        title={t('tabs.moments')}
        id="drawer-moments"
        side="right"
        closeLabel={t('help.close')}
      >
        <MomentsList
          t={t}
          project={state.project}
          selectedClipId={state.selectedClipId}
          onSelect={state.setSelectedClipId}
          onEdit={startEditing}
          onMove={state.shiftMoment}
          onRemove={removeMoment}
        />
      </Sheet>

      <Sheet
        open={(layout === 'narrow' || layout === 'tablet') && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`${t('tabs.frame')} · ${t('tabs.audio')}`}
        id="drawer-inspector"
        side="right"
        closeLabel={t('help.close')}
      >
        <FramePanel
          t={t}
          project={state.project}
          framing={state.framing}
          onFraming={state.changeFraming}
        />
        <hr className="divider" />
        <AudioPanel
          t={t}
          project={state.project}
          audio={state.audio}
          selectedClip={state.selectedClip}
          onClipGain={state.changeClipGain}
          onClipMuted={state.changeClipMuted}
          onMusicChange={state.changeMusic}
          onPickAudio={pickAudio}
          onRemoveAudio={state.dropAudio}
        />
      </Sheet>

      {/* Phone bottom sheets */}
      <Sheet
        open={layout === 'phone' && mobileSheet === 'moments'}
        onClose={() => setMobileSheet(null)}
        title={t('tabs.moments')}
        id="sheet-moments"
        closeLabel={t('help.close')}
      >
        <MomentsList
          t={t}
          project={state.project}
          selectedClipId={state.selectedClipId}
          onSelect={state.setSelectedClipId}
          onEdit={startEditing}
          onMove={state.shiftMoment}
          onRemove={removeMoment}
        />
      </Sheet>

      <Sheet
        open={layout === 'phone' && mobileSheet === 'frame'}
        onClose={() => setMobileSheet(null)}
        title={t('tabs.frame')}
        id="sheet-frame"
        closeLabel={t('help.close')}
      >
        <FramePanel
          t={t}
          project={state.project}
          framing={state.framing}
          onFraming={state.changeFraming}
        />
      </Sheet>

      <Sheet
        open={layout === 'phone' && mobileSheet === 'audio'}
        onClose={() => setMobileSheet(null)}
        title={t('tabs.audio')}
        id="sheet-audio"
        closeLabel={t('help.close')}
      >
        <AudioPanel
          t={t}
          project={state.project}
          audio={state.audio}
          selectedClip={state.selectedClip}
          onClipGain={state.changeClipGain}
          onClipMuted={state.changeClipMuted}
          onMusicChange={state.changeMusic}
          onPickAudio={pickAudio}
          onRemoveAudio={state.dropAudio}
        />
      </Sheet>

      <Sheet
        open={layout === 'phone' && mobileSheet === 'sources'}
        onClose={() => setMobileSheet(null)}
        title={t('tabs.file')}
        id="sheet-sources"
        closeLabel={t('help.close')}
      >
        <label className="field-label" htmlFor="project-title-mobile">
          {t('topbar.renameLabel')}
        </label>
        <input
          id="project-title-mobile"
          className="time-input"
          style={{ fontFamily: 'var(--font-ui)', marginBottom: 6 }}
          value={state.title}
          placeholder={t('topbar.untitled')}
          onChange={(event) => state.setTitle(event.target.value)}
          data-testid="project-title"
        />
        <p className="hint-small" style={{ marginBottom: 14 }}>
          {t('topbar.saveState.hint')}
        </p>
        <SourcesList
          t={t}
          video={state.video}
          audio={state.audio}
          onPickVideo={pickVideo}
          onPickAudio={pickAudio}
        />
        <hr className="divider" />
        {backupPanel}
        <hr className="divider" />
        <button type="button" className="btn btn-block" onClick={() => setHelpOpen(true)}>
          <Icon name="help" />
          {t('topbar.help')}
        </button>
      </Sheet>

      <ExportDialog
        t={t}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        project={state.project}
        videoFile={state.video?.file ?? null}
        audioFile={state.audio?.file ?? null}
        onShortEdgeChange={state.changeShortEdge}
      />
      <HelpDialog t={t} open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Hidden pickers: the user always starts the file dialog explicitly. */}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="visually-hidden"
        data-testid="video-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void state.importVideo(file);
        }}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        data-testid="backup-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void persistence.importBackup(file).then((result) => {
            setBackupMessage(result.ok ? 'backup.imported' : 'backup.importFailed');
          });
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="visually-hidden"
        data-testid="audio-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void state.importAudio(file);
        }}
      />
      {state.audio && state.project.music ? (
        <audio
          ref={musicElementRef}
          src={state.audio.objectUrl}
          preload="metadata"
          className="visually-hidden"
        />
      ) : null}
    </div>
  );
}
