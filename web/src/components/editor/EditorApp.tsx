'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, Wordmark } from '@/components/Icon';
import { useHydrated } from '@/components/useHydrated';
import { safeFileName } from '@/adapters/browserMedia';
import { DEFAULT_CAPTION_STYLE, activeCueAt, primaryCaptionTrack } from '@/domain/captions';
import type { AspectRatio, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { formatLength, US_PER_SECOND, type Micros } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import {
  dragMinimumUs,
  floorAfterEdit,
  outputStartOf,
  playheadAfterRemoval,
  splitAtPlayhead,
} from '@/domain/timelineEdit';
import type { TrimEdge } from '@/domain/trim';
import { translator, type MessageKey } from '@/i18n/messages';
import { listenForUncaughtErrors, recordError } from '@/adapters/diagnostics';
import { ExportDialog } from './ExportDialog';
import { HelpDialog } from './HelpDialog';
import { ReportDialog } from './ReportDialog';
import { Sheet } from './Dialog';
import { CaptionsPanel } from './CaptionsPanel';
import { AudioPanel, FramePanel, Inspector, type InspectorTab } from './Inspector';
import { LeftPanel, MomentsList, SourcesList, type LeftTab } from './LeftPanel';
import { OutputStrip, type TimelineEmptyState } from './OutputStrip';
import { PreviewStage } from './PreviewStage';
import { RangeEditor } from './RangeEditor';
import { RelinkPanel } from './RelinkPanel';
import { SaveStateBadge } from './SaveStateBadge';
import { SilenceDialog } from './SilenceDialog';
import type { TrimCommitInfo } from './TrimHandle';
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

/** What the import confirmation says about the frame chosen from the video. */
const ASPECT_NOTICE: Record<AspectRatio, MessageKey> = {
  '9:16': 'timeline.notice.aspectPortrait',
  '16:9': 'timeline.notice.aspectLandscape',
  '1:1': 'timeline.notice.aspectSquare',
};

/** Fills `{name}` slots; values are inserted literally (a file name may contain `$&`). */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function EditorApp() {
  const hydrated = useHydrated();
  const layout = useLayoutMode();
  const state = useEditorState();
  // An empty timeline has no result to show (for example after undoing the
  // piece an opened video arrived with): the preview is then the source, and
  // the range form is right there.
  const previewMode: PreviewMode = state.project.clips.length === 0 ? 'source' : state.previewMode;
  // The component owns the media elements; the playback hook only drives them.
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const musicElementRef = useRef<HTMLAudioElement | null>(null);
  const playback = usePlayback({
    videoRef: videoElementRef,
    musicRef: musicElementRef,
    project: state.project,
    mode: previewMode,
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
  /**
   * The output length the timeline keeps after edits (ADR-019): a trim or a
   * delete never stretches what is left back to full width. "Sığdır" and a
   * newly opened video reset it.
   */
  const [scaleFloorUs, setScaleFloorUs] = useState<Micros>(0);
  /** The last confirmation on the timeline, read politely. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Where the preview was when an edge drag started, so Esc can put it back. */
  const trimRestoreRef = useRef<{ mode: PreviewMode; outputUs: Micros; sourceUs: Micros } | null>(
    null,
  );

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
    if (editError) recordError('edit', editError.replace(/^(error|timeline)\./, ''));
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

  const lengthText = (us: Micros) =>
    formatLength(us, {
      minute: t('time.minuteShort'),
      second: t('time.secondShort'),
      decimalMark: t('time.decimalMark'),
    });
  const pieceNumber = (index: number) => String(index + 1).padStart(2, '0');

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
   * Opening a video (ADR-019, ADR-021): it is already on the timeline as one
   * piece — also when it is longer than the output limit — and the preview
   * shows the result.
   */
  const openVideo = async (file: File) => {
    playback.stop();
    const outcome = await state.importVideo(file);
    if (outcome.kind === 'rejected') return;
    setEditingClipId(null);
    setScaleFloorUs(0);
    // The frame was chosen from the video's orientation; say which, and why.
    const aspectNote = outcome.aspect ? t(ASPECT_NOTICE[outcome.aspect]) : null;
    if (outcome.kind === 'whole') {
      playback.prepareMode('output');
      // Longer than can be downloaded: say so right away, with the limit.
      const over = outcome.lengthUs > WEB_LOCAL_POLICY.maxOutputDurationUs;
      const imported = fill(t(over ? 'timeline.notice.importedOverLimit' : 'timeline.notice.imported'), {
        length: lengthText(outcome.lengthUs),
        limit: String(WEB_LOCAL_POLICY.maxOutputDurationUs / (60 * US_PER_SECOND)),
      });
      setNotice(aspectNote ? `${aspectNote}. ${imported}` : imported);
    } else {
      playback.prepareMode('source');
      setNotice(aspectNote);
    }
  };

  /**
   * Captions sit on the output timeline, so moving to a line (or adding one)
   * always shows the result preview and parks playback there.
   */
  const seekCaption = useCallback(
    (outputUs: Micros) => {
      if (previewMode !== 'output') changeMode('output');
      playback.stop();
      playback.seekOutput(outputUs);
    },
    [changeMode, playback, previewMode],
  );

  /**
   * A source-anchored line that no piece shows has no place on the output
   * timeline; "Buraya git" then shows its picture in the source preview.
   */
  const seekCaptionSource = useCallback(
    (sourceUs: Micros) => {
      if (previewMode !== 'source') changeMode('source');
      playback.stop();
      playback.seekSource(sourceUs);
    },
    [changeMode, playback, previewMode],
  );

  /** The one playhead: every timeline click, drag or key lands here. */
  const seekTimeline = (outputUs: Micros, selectClipId: string | null) => {
    if (previewMode !== 'output') changeMode('output');
    playback.seekOutput(outputUs);
    if (selectClipId) state.setSelectedClipId(selectClipId);
  };

  /** Selecting a piece from the keyboard or the piece list also moves the playhead to it. */
  const selectPiece = (clipId: string) => {
    state.setSelectedClipId(clipId);
    const startUs = outputStartOf(state.project, clipId);
    if (startUs !== null && state.video) {
      if (previewMode !== 'output') changeMode('output');
      playback.seekOutput(startUs);
    }
  };

  /** Deletes a piece (button, Delete key, or the piece list); the rest closes up. */
  const deletePiece = (clipId: string) => {
    const before = state.project;
    const index = before.clips.findIndex((clip) => clip.clipId === clipId);
    const clip = before.clips[index];
    if (!clip) return;
    const totalBefore = totalOutputDurationUs(before);
    const playheadUs = playheadAfterRemoval(before, clipId);
    // Leaving result mode with nothing to show is handled here, at the event,
    // rather than by correcting state in an effect afterwards.
    if (before.clips.length <= 1) {
      playback.prepareMode('source');
      state.setPreviewMode('source');
    } else {
      playback.stop();
    }
    if (editingClipId === clipId) setEditingClipId(null);
    const after = state.deletePiece(clipId);
    if (!after) return;
    setScaleFloorUs((floor) => floorAfterEdit(floor, totalBefore));
    if (after.clips.length > 0 && previewMode === 'output') {
      playback.seekOutput(playheadUs, after);
    }
    if (after.clips.length > 0) {
      // The deleted piece's button (or its edge) may have had focus; a
      // keyboard user continues from the playhead instead of the page top.
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) {
          document.querySelector<HTMLElement>('.tl-playhead')?.focus();
        }
      });
    }
    setNotice(
      fill(t('timeline.notice.deleted'), {
        index: pieceNumber(index),
        length: lengthText(clip.sourceOutUs - clip.sourceInUs),
      }),
    );
  };

  const deleteSelected = () => {
    const selected = state.selectedClip;
    if (!selected) {
      state.setTimelineError('timeline.deleteBlocked');
      return;
    }
    deletePiece(selected.clipId);
  };

  const handleAdd = useCallback(
    (inUs: number, outUs: number) => {
      playback.stop();
      // The range form lives in the source preview; adding from it keeps the
      // user there even when the stored mode was the result (the timeline
      // was empty, so the result could not be shown).
      if (state.previewMode !== 'source') state.setPreviewMode('source');
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
      // Editing a piece's range by typing is the secondary, source-side flow.
      if (previewMode !== 'source') {
        playback.prepareMode('source');
        state.setPreviewMode('source');
      }
      const clip = state.project.clips.find((item) => item.clipId === clipId);
      if (clip) playback.seekSource(clip.sourceInUs);
    },
    [playback, previewMode, state],
  );

  /** Puts a newly added first piece on screen: result preview, playhead at 0. */
  const showNewTimeline = (after: Project, message: string) => {
    setScaleFloorUs(0);
    state.setPreviewMode('output');
    playback.prepareMode('output');
    playback.seekOutput(0, after);
    setNotice(message);
  };

  const addWholeVideo = () => {
    const after = state.addWholeVideo();
    if (after) {
      showNewTimeline(
        after,
        fill(t('timeline.notice.addedWhole'), { length: lengthText(totalOutputDurationUs(after)) }),
      );
    }
  };

  /** "Aralık seçerek ekle": the secondary flow, the range form in the source preview. */
  const addByRange = () => {
    setEditingClipId(null);
    if (previewMode !== 'source') changeMode('source');
    setMobileSheet(null);
    window.requestAnimationFrame(() => document.getElementById('range-start')?.focus());
  };

  // The playhead on the clock the preview is showing. The timeline's clock is
  // the output; the source preview is the secondary range-picking view.
  const splitPlayhead = (): Parameters<typeof state.splitPiece>[0] =>
    previewMode === 'output'
      ? { mode: 'output', outputUs: playback.outputTimeUs }
      : { mode: 'source', sourceUs: playback.sourceTimeUs, preferClipId: state.selectedClipId };

  const splitBlocked: MessageKey | null = (() => {
    if (!state.video) return 'error.no_source';
    const point = splitAtPlayhead(state.project, splitPlayhead(), WEB_LOCAL_POLICY);
    return point.ok ? null : (`error.${point.reason}` as MessageKey);
  })();

  const deleteBlocked: MessageKey | null = state.selectedClip ? null : 'timeline.deleteBlocked';

  /** "Böl" / S: cuts the piece under the playhead, right there. */
  const splitNow = () => {
    if (!state.video) {
      state.setTimelineError('error.no_source');
      return;
    }
    playback.stop();
    const result = state.splitPiece(splitPlayhead());
    if (!result.ok) {
      setNotice(null);
      return;
    }
    const first = result.project.clips[result.index];
    const second = result.project.clips[result.index + 1];
    // The output is unchanged frame for frame, but the piece indices after
    // the cut moved by one: re-seat the clock on the new recipe.
    if (previewMode === 'output') playback.seekOutput(playback.outputTimeUs, result.project);
    if (first && second) {
      setNotice(
        fill(t('timeline.notice.split'), {
          index: pieceNumber(result.index),
          first: lengthText(first.sourceOutUs - first.sourceInUs),
          second: lengthText(second.sourceOutUs - second.sourceInUs),
        }),
      );
    }
  };

  // Edge trims: the preview shows the frame at the dragged edge without
  // switching clocks, and parks back on the output timeline afterwards.
  const startTrim = () => {
    playback.stop();
    trimRestoreRef.current = {
      mode: previewMode,
      outputUs: playback.outputTimeUs,
      sourceUs: playback.sourceTimeUs,
    };
  };

  const previewTrim = (edge: TrimEdge, us: Micros) => {
    // Ranges are half-open: the out-point itself is the first frame NOT kept,
    // so the out handle shows the last kept frame instead.
    playback.peekSource(edge === 'out' ? Math.max(0, us - 1) : us);
  };

  const cancelTrim = () => {
    const saved = trimRestoreRef.current;
    trimRestoreRef.current = null;
    if (!saved) return;
    if (saved.mode === 'output') playback.seekOutput(saved.outputUs);
    else playback.seekSource(saved.sourceUs);
  };

  const commitTrim = (clipId: string, edge: TrimEdge, us: Micros, info: TrimCommitInfo) => {
    const before = state.project;
    const index = before.clips.findIndex((clip) => clip.clipId === clipId);
    const clip = before.clips[index];
    if (!clip) return;
    const range =
      edge === 'in'
        ? { sourceInUs: us, sourceOutUs: clip.sourceOutUs }
        : { sourceInUs: clip.sourceInUs, sourceOutUs: us };
    const totalBefore = totalOutputDurationUs(before);
    const after = state.trimPiece(clipId, range, info.coalesce);
    if (!after) {
      cancelTrim();
      return;
    }
    trimRestoreRef.current = null;
    setScaleFloorUs((floor) => floorAfterEdit(floor, totalBefore));
    const fromUs = clip.sourceOutUs - clip.sourceInUs;
    const toUs = range.sourceOutUs - range.sourceInUs;
    if (previewMode === 'output') {
      // The playhead goes to the new cut: the first kept frame of a trimmed
      // start, or the last kept frame of a trimmed end.
      const startUs = outputStartOf(after, clipId) ?? 0;
      playback.seekOutput(edge === 'in' ? startUs : startUs + toUs - 1, after);
    }
    if (!info.pointer) return;
    const values = {
      index: pieceNumber(index),
      from: lengthText(fromUs),
      to: lengthText(toUs),
      min: lengthText(dragMinimumUs(fromUs)),
    };
    if (info.heldAtMinimum) setNotice(fill(t('timeline.notice.heldAtMin'), values));
    else setNotice(fill(t(toUs < fromUs ? 'timeline.notice.trimmed' : 'timeline.notice.extended'), values));
  };

  const undo = () => {
    setNotice(null);
    playback.stop();
    state.undo();
  };

  const redo = () => {
    setNotice(null);
    playback.stop();
    state.redo();
  };

  // Silences are searched in the pieces of the linked video; the button says
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

  // The latest handlers for the window listener, which subscribes once.
  // Written after render, never during it.
  const keyActionsRef = useRef({ undo, redo, splitNow, deleteSelected });
  useEffect(() => {
    keyActionsRef.current = { undo, redo, splitNow, deleteSelected };
  });

  // Keyboard shortcuts never fire while a text or time field has focus.
  const hasVideo = state.video !== null;
  const hasSelection = state.selectedClip !== null;
  const { togglePlay } = playback;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const meta = event.ctrlKey || event.metaKey;
      const actions = keyActionsRef.current;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        actions.redo();
        return;
      }
      // Inside a dialog or sheet, Space, S and Delete belong to the focused
      // control (a "Dinle" button, a checkbox), not to the editor behind it.
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return;
      if (event.key === ' ' || event.code === 'Space') {
        if (!hasVideo) return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (meta || event.altKey || event.repeat) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        actions.splitNow();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection) {
        event.preventDefault();
        actions.deleteSelected();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasSelection, hasVideo, togglePlay]);

  const mediaErrorText = state.mediaError
    ? (() => {
        const error = state.mediaError;
        const reason = t(`error.${error.reason}` as MessageKey);
        const lowered = `${reason.charAt(0).toLocaleLowerCase('tr-TR')}${reason.slice(1)}`;
        const main = fill(t('error.rejectedFile'), { name: safeFileName(error.fileName, 60), reason: lowered });
        if (!error.keptOpen) return main;
        return `${main} ${t(error.scope === 'video' ? 'error.keptVideo' : 'error.keptAudio')}`;
      })()
    : null;

  const mediaErrorNode = mediaErrorText ? (
    <div className="inline-error media-error" role="alert" data-testid="media-error">
      <Icon name="alert" />
      <span>
        {mediaErrorText}
        {state.mediaError?.hint === 'hevc_decoder_missing' ? (
          // The space keeps the two sentences apart in the text a screen
          // reader or a copy gets; the block display puts the hint on its line.
          <>
            {' '}
            <span className="media-error-hint" data-testid="media-error-hint">
              {t('error.hint.hevc_decoder_missing')}
            </span>
          </>
        ) : null}
      </span>
      <button
        type="button"
        className="icon-btn media-error-close"
        onClick={state.clearMediaError}
        aria-label={t('error.dismiss')}
        data-testid="media-error-dismiss"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  ) : null;

  const timelineEmpty: TimelineEmptyState = !state.video
    ? { kind: 'no_video' }
    : { kind: 'fits', lengthUs: state.video.durationUs };

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
    onSelect: selectPiece,
    onEdit: startEditing,
    onMove: state.shiftMoment,
    onRemove: deletePiece,
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
    previewMode === 'output' &&
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
      previewMode={previewMode}
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
      {/* A landmark of its own, so screen-reader users meet it on purpose
          instead of as stray text before the header. */}
      <aside className="prototype-banner" aria-label={t('a11y.prototypeNotice')}>
        <span>{t('banner.prototype')}</span>
        <Link href="/" style={{ color: 'inherit' }}>
          {t('app.name')}
        </Link>
      </aside>

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
            onClick={undo}
            disabled={!state.canUndo}
            aria-label={t('topbar.undo')}
            data-testid="undo"
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={redo}
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
            className="btn btn-accent topbar-download"
            onClick={() => setExportOpen(true)}
            data-testid="open-export"
          >
            <Icon name="download" />
            {t('topbar.export')}
          </button>
        </div>
      </header>

      <main className="editor-body" data-mode={layout}>
        {/* The page's one h1; the panels below carry the h2s. */}
        <h1 className="visually-hidden">{t('a11y.editorHeading')}</h1>
        {layout === 'wide' || layout === 'narrow' ? <LeftPanel {...leftPanelProps} /> : null}

        {state.missingVideoBinding ? (
          <section className="stage" aria-label={t('relink.title')}>
            <RelinkPanel
              t={t}
              binding={state.missingVideoBinding}
              onPick={state.relinkVideo}
              onUseAsNew={(file) => void openVideo(file)}
              onDiscardProject={() => {
                if (!window.confirm(t('relink.discardConfirm'))) return;
                void persistence.forget().then(() => window.location.reload());
              }}
            />
            {mediaErrorNode}
          </section>
        ) : (
        <PreviewStage
          t={t}
          project={state.project}
          video={state.video}
          mode={previewMode}
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
          {mediaErrorNode}

          {previewMode === 'source' ? (
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
      </main>

      <OutputStrip
        t={t}
        project={state.project}
        audio={state.audio}
        selectedClipId={state.selectedClipId}
        onSelect={selectPiece}
        onPickAudio={pickAudio}
        // In the source preview the output clock is parked; the timeline
        // shows where the result preview will continue.
        outputTimeUs={playback.outputTimeUs}
        onSeek={seekTimeline}
        splitBlocked={splitBlocked}
        onSplit={splitNow}
        deleteBlocked={deleteBlocked}
        onDelete={deleteSelected}
        error={state.timelineError}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        scaleFloorUs={scaleFloorUs}
        onFit={() => setScaleFloorUs(0)}
        empty={timelineEmpty}
        onAddWhole={addWholeVideo}
        onAddRange={addByRange}
        onTrimStart={startTrim}
        onTrimPreview={previewTrim}
        onTrimCancel={cancelTrim}
        onTrimCommit={commitTrim}
      />

      {layout === 'phone' ? null : (
        <footer className="status-bar">
          <span>{t('footer.local')}</span>
          <span className="shortcut-hints">Space · ← → · S · Delete · Ctrl/Cmd+Z</span>
        </footer>
      )}

      {layout === 'phone' ? (
      <nav className="mobile-tabbar" aria-label={t('a11y.toolbar')}>
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
          onSelect={selectPiece}
          onEdit={startEditing}
          onMove={state.shiftMoment}
          onRemove={deletePiece}
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
          onSelect={selectPiece}
          onEdit={startEditing}
          onMove={state.shiftMoment}
          onRemove={deletePiece}
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

      {/*
        Hidden pickers: the user always starts the file dialog explicitly.
        Rendered only after hydration: in the prerendered HTML they would
        accept a file before their change handlers exist, and lose it.
      */}
      {hydrated ? (
        <>
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="visually-hidden"
        // Reached only through the visible buttons, so it is kept out of the
        // tab order and the accessibility tree (an unlabeled second stop).
        tabIndex={-1}
        aria-hidden="true"
        data-testid="video-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openVideo(file);
        }}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
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
        tabIndex={-1}
        aria-hidden="true"
        data-testid="audio-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void state.importAudio(file);
        }}
      />
        </>
      ) : null}
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
