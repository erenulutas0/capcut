'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, Wordmark } from '@/components/Icon';
import { DEFAULT_CAPTION_STYLE, activeCueAt, primaryCaptionTrack } from '@/domain/captions';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import type { Micros } from '@/domain/time';
import { splitPointAt, type Playhead, type TrimEdge } from '@/domain/trim';
import { translator, type MessageKey } from '@/i18n/messages';
import { listenForUncaughtErrors, recordError } from '@/adapters/diagnostics';
import { ExportDialog } from './ExportDialog';
import { HelpDialog } from './HelpDialog';
import { ReportDialog } from './ReportDialog';
import { Sheet } from './Dialog';
import { CaptionsPanel } from './CaptionsPanel';
import { AudioPanel, FramePanel, Inspector, type InspectorTab } from './Inspector';
import { LeftPanel, MomentsList, SourcesList, type LeftTab } from './LeftPanel';
import { OutputStrip } from './OutputStrip';
import { PreviewStage } from './PreviewStage';
import { RangeEditor } from './RangeEditor';
import { RelinkPanel } from './RelinkPanel';
import { SaveStateBadge } from './SaveStateBadge';
import { SilenceDialog } from './SilenceDialog';
import { useCaptionFont } from './useCaptionFont';
import { useProjectPersistence } from './useProjectPersistence';
import { useEditorState, type PreviewMode } from './useEditorState';
import { useLayoutMode } from './useLayoutMode';
import { usePlayback } from './usePlayback';
import { useSilenceAnalysis } from './useSilenceAnalysis';

type MobileSheet = 'moments' | 'frame' | 'audio' | 'captions' | 'sources' | null;

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
  const [silenceOpen, setSilenceOpen] = useState(false);
  const silence = useSilenceAnalysis();
  const captionFont = useCaptionFont();
  const [reportOpen, setReportOpen] = useState(false);

  // Error CODES seen in this tab, for the diagnostics file the user may
  // choose to download ("Sorun bildir"). Only the enum reaches the record —
  // never a message, a file name or caption text. Kept in memory only.
  useEffect(() => listenForUncaughtErrors(), []);
  const mediaErrorReason = state.mediaError?.reason ?? null;
  useEffect(() => {
    if (mediaErrorReason) recordError('media', mediaErrorReason);
  }, [mediaErrorReason]);
  const editError = state.actionError ?? state.timelineError;
  useEffect(() => {
    if (editError) recordError('edit', editError.replace(/^error\./, ''));
  }, [editError]);
  const storeFailure =
    persistence.saveState.kind === 'failed' ? persistence.saveState.reason : persistence.loadFailure;
  useEffect(() => {
    if (storeFailure) recordError('storage', storeFailure);
  }, [storeFailure]);
  const silenceFailure = silence.run.status === 'failed' ? silence.run.reason : null;
  useEffect(() => {
    if (silenceFailure) recordError('silence', silenceFailure);
  }, [silenceFailure]);

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

  /**
   * Captions sit on the output timeline, so moving to a line (or adding one)
   * always shows the result preview and parks playback there.
   */
  const seekCaption = useCallback(
    (outputUs: Micros) => {
      if (state.previewMode !== 'output') changeMode('output');
      playback.stop();
      playback.seekOutput(outputUs);
    },
    [changeMode, playback, state.previewMode],
  );

  /**
   * A source-anchored line that no moment shows has no place on the output
   * timeline; "Buraya git" then shows its picture in the source preview.
   */
  const seekCaptionSource = useCallback(
    (sourceUs: Micros) => {
      if (state.previewMode !== 'source') changeMode('source');
      playback.stop();
      playback.seekSource(sourceUs);
    },
    [changeMode, playback, state.previewMode],
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

  // The playhead on the clock the preview is showing. Result mode shows output
  // time; the domain maps it back through the timeline (see splitPointAt).
  const playhead: Playhead =
    state.previewMode === 'output'
      ? { mode: 'output', outputUs: playback.outputTimeUs }
      : { mode: 'source', sourceUs: playback.sourceTimeUs };

  const splitBlockedFor = (clipId: string | null): MessageKey | null => {
    if (!state.video) return 'error.no_source';
    const point = splitPointAt(state.project, clipId, playhead, WEB_LOCAL_POLICY);
    return point.ok ? null : (`error.${point.reason}` as MessageKey);
  };

  const { previewMode, video, setTimelineError, setSelectedClipId, splitMoment } = state;
  const { outputTimeUs, sourceTimeUs, stop: stopPlayback } = playback;
  const splitAtPlayhead = useCallback(
    (clipId: string | null) => {
      if (!video) {
        setTimelineError('error.no_source');
        return;
      }
      stopPlayback();
      if (clipId) setSelectedClipId(clipId);
      splitMoment(
        clipId,
        previewMode === 'output'
          ? { mode: 'output', outputUs: outputTimeUs }
          : { mode: 'source', sourceUs: sourceTimeUs },
      );
    },
    [
      outputTimeUs,
      previewMode,
      setSelectedClipId,
      setTimelineError,
      sourceTimeUs,
      splitMoment,
      stopPlayback,
      video,
    ],
  );

  // Trimming shows source frames, so a drag or key step in result mode drops
  // back to the source preview rather than blurring the two clocks.
  const startTrim = () => {
    playback.stop();
    if (state.previewMode === 'output') changeMode('source');
  };

  // Silences are searched in the moments of the linked video; the button says
  // which of the two is missing instead of just greying out.
  const silenceBlocked: MessageKey | null =
    state.project.clips.length === 0
      ? 'silence.blocked.noMoments'
      : !state.video
        ? 'silence.blocked.noVideo'
        : null;

  const openSilence = () => {
    if (!state.video || state.project.clips.length === 0) return;
    playback.stop();
    // The dialog replaces the phone sheet / tablet drawer it was opened from.
    setMobileSheet(null);
    setMomentsDrawerOpen(false);
    setSilenceOpen(true);
    silence.start(state.video.file, state.project.clips);
  };

  const retrySilence = () => {
    if (state.video) silence.start(state.video.file, state.project.clips);
  };

  const closeSilence = () => {
    silence.reset();
    setSilenceOpen(false);
  };

  const previewTrim = (edge: TrimEdge, us: Micros) => {
    // Ranges are half-open: the out-point itself is the first frame NOT kept,
    // so the out handle shows the last kept frame instead.
    playback.seekSource(edge === 'out' ? Math.max(0, us - 1) : us);
  };

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
      // Inside a dialog or sheet, Space and S belong to the focused control
      // (a "Dinle" button, a checkbox), not to the preview behind it.
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return;
      if (event.key === ' ' || event.code === 'Space') {
        if (!state.video) return;
        event.preventDefault();
        playback.togglePlay();
        return;
      }
      if (!meta && !event.altKey && !event.repeat && event.key.toLowerCase() === 's') {
        event.preventDefault();
        splitAtPlayhead(state.selectedClipId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback, splitAtPlayhead, state]);

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
    splitBlockedFor,
    onSplit: splitAtPlayhead,
    silenceBlocked,
    onFindSilences: openSilence,
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

  const captionTrack = primaryCaptionTrack(state.project);
  const captionStyle = captionTrack?.style ?? DEFAULT_CAPTION_STYLE;
  // Nothing is drawn with a fallback font, and nothing past the output end
  // (the file has no frame there, even for a line that runs over it).
  const activeCaption =
    state.previewMode === 'output' &&
    captionFont === 'ready' &&
    playback.outputTimeUs < playback.outputDurationUs
      ? activeCueAt(state.project, playback.outputTimeUs)
      : undefined;

  const captionsNode = (
    <CaptionsPanel
      t={t}
      project={state.project}
      title={state.title}
      outputDurationUs={playback.outputDurationUs}
      outputTimeUs={playback.outputTimeUs}
      sourceTimeUs={playback.sourceTimeUs}
      previewMode={state.previewMode}
      fontStatus={captionFont}
      onAdd={state.addCaption}
      onUpdate={state.updateCaption}
      onRemove={state.removeCaption}
      onStyle={state.changeCaptionStyle}
      onLanguage={state.changeCaptionLanguage}
      onConvert={state.convertCaptions}
      onShift={state.shiftAllCaptions}
      onImport={state.importCaptions}
      onShowResult={() => changeMode('output')}
      onSeek={seekCaption}
      onSeekSource={seekCaptionSource}
    />
  );

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
    captionsNode,
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
          caption={activeCaption ? { cueId: activeCaption.cueId, text: activeCaption.text } : null}
          captionStyle={captionStyle}
          captionNotice={
            captionFont === 'failed' && (captionTrack?.cues.length ?? 0) > 0 ? (
              <p className="inline-error" role="status" data-testid="preview-caption-font-failed">
                <Icon name="alert" />
                {t('captions.fontFailed')}
              </p>
            ) : null
          }
        >
          {state.mediaError ? (
            <p className="inline-error" role="alert" data-testid="media-error">
              <Icon name="alert" />
              {t(`error.${state.mediaError.reason}` as MessageKey)}
            </p>
          ) : null}

          {state.previewMode === 'source' ? (
            <RangeEditor
              // The edited range is part of the key: a trim or split from the
              // strip remounts the form with the stored values.
              key={`${editingClip ? `${editingClip.clipId}:${editingClip.sourceInUs}:${editingClip.sourceOutUs}` : 'new-moment'}:${state.video?.objectUrl ?? ''}`}
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
        splitBlocked={splitBlockedFor(state.selectedClipId)}
        onSplit={() => splitAtPlayhead(state.selectedClipId)}
        error={state.timelineError}
        playheadSourceUs={playback.sourceTimeUs}
        onTrimStart={startTrim}
        onTrimPreview={previewTrim}
        onTrimCancel={playback.seekSource}
        onTrimCommit={state.trimMoment}
      />

      {layout === 'phone' ? null : (
        <footer className="status-bar">
          <span>{t('footer.local')}</span>
          <span className="shortcut-hints">Space · I · O · S · Ctrl/Cmd+Z</span>
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
          onClick={() => setMobileSheet('captions')}
          aria-expanded={mobileSheet === 'captions'}
          data-testid="tab-captions"
        >
          <Icon name="captions" size={20} />
          {t('captions.tab')}
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
          splitBlockedFor={splitBlockedFor}
          onSplit={splitAtPlayhead}
          silenceBlocked={silenceBlocked}
          onFindSilences={openSilence}
          error={state.timelineError}
        />
      </Sheet>

      <Sheet
        open={(layout === 'narrow' || layout === 'tablet') && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`${t('tabs.frame')} · ${t('tabs.audio')} · ${t('captions.tab')}`}
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
        <hr className="divider" />
        {captionsNode}
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
          splitBlockedFor={splitBlockedFor}
          onSplit={splitAtPlayhead}
          silenceBlocked={silenceBlocked}
          onFindSilences={openSilence}
          error={state.timelineError}
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
        open={layout === 'phone' && mobileSheet === 'captions'}
        onClose={() => setMobileSheet(null)}
        title={t('captions.tab')}
        id="sheet-captions"
        closeLabel={t('help.close')}
      >
        {captionsNode}
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
        onReportProblem={() => setReportOpen(true)}
      />
      <HelpDialog
        t={t}
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onReportProblem={() => setReportOpen(true)}
      />
      {/* Stacked over whichever dialog opened it; mounted only while open. */}
      {reportOpen ? (
        <ReportDialog t={t} project={state.project} onClose={() => setReportOpen(false)} />
      ) : null}
      {/* Mounted only while open, so every opening starts from the defaults. */}
      {silenceOpen && state.video ? (
        <SilenceDialog
          t={t}
          project={state.project}
          videoUrl={state.video.objectUrl}
          run={silence.run}
          envelopeFor={silence.envelopeFor}
          onRetry={retrySilence}
          onCancel={silence.cancel}
          onApply={state.cutSilences}
          onClose={closeSilence}
          onBeforeListen={playback.stop}
        />
      ) : null}

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
