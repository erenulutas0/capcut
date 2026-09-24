'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon, Wordmark } from '@/components/Icon';
import { useHydrated } from '@/components/useHydrated';
import { safeFileName } from '@/adapters/browserMedia';
import { withWholeKesit } from '@/application/commands';
import { DEFAULT_CAPTION_STYLE, captionAtVideoTime, primaryCaptionTrack, videoCues } from '@/domain/captions';
import type { AspectRatio, Project } from '@/domain/edl';
import {
  EMPTY_PENDING,
  formatPosition,
  markPending,
  resolvePending,
  targetKey,
  topDownload,
  downloadRecipe,
  type DownloadTarget,
  type PendingRange,
} from '@/domain/kesit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { formatLength, MIN_CLIP_DURATION_US, type Micros } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import { resolveEdgeTrim, resolvePendingEdge } from '@/domain/timelineEdit';
import { computeSourceView } from '@/domain/transform';
import { frameStepUs, type TrimEdge } from '@/domain/trim';
import { translator, type MessageKey } from '@/i18n/messages';
import { listenForUncaughtErrors, recordError } from '@/adapters/diagnostics';
import { Sheet } from './Dialog';
import { DownloadStatus } from './DownloadStatus';
import { HelpDialog } from './HelpDialog';
import { SettingsPanel, type InspectorTab } from './Inspector';
import { CaptionsPanel } from './CaptionsPanel';
import { KesitList } from './KesitList';
import { MarkBar, type MarkTarget } from './MarkBar';
import { PreviewStage } from './PreviewStage';
import { RelinkPanel } from './RelinkPanel';
import { ReportDialog } from './ReportDialog';
import { SaveStateBadge } from './SaveStateBadge';
import { SilenceDialog } from './SilenceDialog';
import { SourceStrip, type EditableRange } from './SourceStrip';
import type { TrimCommitInfo } from './TrimHandle';
import { useCaptionFont } from './useCaptionFont';
import { canPickSaveFile, entryIsCurrent, useDownloads } from './useDownloads';
import { useEditorState } from './useEditorState';
import { useLayoutMode } from './useLayoutMode';
import { usePlayback } from './usePlayback';
import { useProjectPersistence } from './useProjectPersistence';
import { useSilenceAnalysis } from './useSilenceAnalysis';
import { useThumbnails } from './useThumbnails';

const t = translator('tr');

const CANVAS_ASPECT_CSS: Record<string, string> = {
  '9:16': '9 / 16',
  '16:9': '16 / 9',
  '1:1': '1 / 1',
};

/** What the import confirmation says about the frame chosen from the video. */
const ASPECT_NOTICE: Record<AspectRatio, MessageKey> = {
  '9:16': 'notice.aspectPortrait',
  '16:9': 'notice.aspectLandscape',
  '1:1': 'notice.aspectSquare',
};

/** Fills `{name}` slots; values are inserted literally (a file name may contain `$&`). */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Inputs that take no typed text: undo/redo still work while they have focus. */
const NON_TEXT_INPUTS = new Set(['radio', 'checkbox', 'range', 'button', 'submit', 'reset', 'color', 'file']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Controls that Space / Enter activate: those keys must not also play or add a kesit. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a[href], summary, input, select, [role="tab"], [role="button"]') !== null;
}

// "I" on an English layout (with or without caps) and on Turkish Q, where the
// capital of i is İ. The dotless ı is a different key and is not a shortcut.
const MARK_IN_KEYS = new Set(['i', 'I', 'İ']);
const MARK_OUT_KEYS = new Set(['o', 'O']);

type SilenceScope =
  | { kind: 'whole'; working: Project }
  | { kind: 'kesit'; clipId: string; working: Project; maxClips: number }
  | { kind: 'all'; working: Project };

/**
 * The editor (ADR-026): watch the video, mark Başlangıç (I) and Bitiş (O) on
 * its own time, press "Kesit ekle"; the kesit drops into the list, where each
 * one plays, downloads or goes away with one press. One clock — the video's.
 */
export function EditorApp() {
  const hydrated = useHydrated();
  const layout = useLayoutMode();
  const phone = layout === 'phone';
  const state = useEditorState();
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const musicElementRef = useRef<HTMLAudioElement | null>(null);
  const playback = usePlayback({
    videoRef: videoElementRef,
    musicRef: musicElementRef,
    project: state.project,
    hasVideo: state.video !== null,
    hasMusicFile: state.audio !== null,
  });

  const persistence = useProjectPersistence({
    project: state.project,
    title: state.title,
    bindings: state.bindings,
    onRestore: state.restoreFromRecord,
  });

  const downloads = useDownloads({
    project: state.project,
    settings: state.settings,
    videoFile: state.video?.file ?? null,
    audioFile: state.audio?.file ?? null,
    videoName: state.video?.fileName ?? null,
  });

  const [pending, setPending] = useState<PendingRange>(EMPTY_PENDING);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<InspectorTab>('frame');
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [silenceScope, setSilenceScope] = useState<SilenceScope | null>(null);
  const [backupMessage, setBackupMessage] = useState<MessageKey | null>(null);
  const [fullscreenRequest, setFullscreenRequest] = useState(0);
  const silence = useSilenceAnalysis();
  const captionFont = useCaptionFont();
  /** Where the playhead was when an edge drag started, so Esc can put it back. */
  const edgeRestoreRef = useRef<Micros | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const { project, video } = state;
  const durationUs = video?.durationUs ?? state.asset?.durationUs ?? 0;
  const frameUs = frameStepUs(project.export);
  const selected = state.selectedClip;
  const selectedIndex = selected ? project.clips.findIndex((clip) => clip.clipId === selected.clipId) : -1;

  // Error CODES seen in this tab, for the diagnostics file the user may
  // choose to download ("Sorun bildir"). Only the enum reaches the record.
  useEffect(() => listenForUncaughtErrors(), []);
  const mediaErrorReason = state.mediaError?.reason ?? null;
  useEffect(() => {
    if (mediaErrorReason) recordError('media', mediaErrorReason);
  }, [mediaErrorReason]);
  const editError = state.actionError;
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

  const lengthText = (us: Micros) =>
    formatLength(us, {
      minute: t('time.minuteShort'),
      second: t('time.secondShort'),
      decimalMark: t('time.decimalMark'),
    });
  const rangeText = (inUs: Micros, outUs: Micros) => `${formatPosition(inUs)} → ${formatPosition(outUs)}`;

  // ------------------------------------------------------------ files

  const pickVideo = useCallback(() => {
    if (state.project.clips.length > 0 && !window.confirm(t('sources.replaceWarning'))) return;
    setMoreOpen(false);
    videoInputRef.current?.click();
  }, [state.project.clips.length]);

  const pickAudio = useCallback(() => audioInputRef.current?.click(), []);

  const openVideo = async (file: File) => {
    playback.stop();
    const outcome = await state.importVideo(file);
    if (outcome.kind === 'rejected') return;
    setPending(EMPTY_PENDING);
    playback.seek(0);
    const aspectNote = outcome.aspect ? t(ASPECT_NOTICE[outcome.aspect]) : null;
    const opened = fill(t('notice.opened'), { length: lengthText(outcome.lengthUs) });
    setNotice(aspectNote ? `${aspectNote}. ${opened}` : opened);
  };

  // ------------------------------------------------------------ kesitler

  const selectKesit = (clipId: string) => {
    if (state.selectedClipId === clipId) {
      state.setSelectedClipId(null);
      return;
    }
    state.setSelectedClipId(clipId);
    state.setActionError(null);
    const clip = project.clips.find((item) => item.clipId === clipId);
    if (clip) {
      playback.stop();
      playback.seek(clip.sourceInUs);
    }
  };

  const leaveKesit = () => {
    state.setSelectedClipId(null);
    state.setActionError(null);
  };

  const addKesit = () => {
    if (!video) {
      state.setActionError('error.no_source');
      return;
    }
    const range = resolvePending(pending, durationUs);
    const result = state.addKesit(range);
    if (!result.ok) return;
    setPending(EMPTY_PENDING);
    const number = project.clips.length + 1;
    setNotice(
      fill(t('notice.added'), {
        n: String(number),
        range: rangeText(range.sourceInUs, range.sourceOutUs),
      }),
    );
  };

  const deleteKesit = (clipId: string) => {
    const index = project.clips.findIndex((clip) => clip.clipId === clipId);
    if (index < 0) return;
    if (playback.range?.clipId === clipId) playback.stop();
    const after = state.deleteKesit(clipId);
    if (!after) return;
    setNotice(fill(t('notice.deleted'), { n: String(index + 1) }));
    // The deleted card's button had focus; continue from the list.
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        const cards = document.querySelectorAll<HTMLElement>('[data-testid="kesit-select"]');
        (cards[Math.min(index, cards.length - 1)] ?? document.querySelector<HTMLElement>('[data-testid="add-moment"]'))?.focus();
      }
    });
  };

  const playKesit = (clipId: string) => {
    if (playback.range?.clipId === clipId && playback.playing) {
      playback.stop();
      return;
    }
    const clip = project.clips.find((item) => item.clipId === clipId);
    if (!clip) return;
    playback.playRange({ clipId, inUs: clip.sourceInUs, outUs: clip.sourceOutUs });
  };

  /** I / O (keys and buttons): the pending range, or the selected kesit's edge. */
  const markAt = (edge: 'in' | 'out', atUs: Micros) => {
    if (!video) return;
    if (selected) {
      const range =
        edge === 'in'
          ? { sourceInUs: Math.round(atUs), sourceOutUs: selected.sourceOutUs }
          : { sourceInUs: selected.sourceInUs, sourceOutUs: Math.round(atUs) };
      if (range.sourceOutUs - range.sourceInUs < MIN_CLIP_DURATION_US) {
        state.setActionError(range.sourceOutUs <= range.sourceInUs ? 'error.range_reversed' : 'error.clip_too_short');
        return;
      }
      state.editKesit(selected.clipId, range);
      return;
    }
    state.setActionError(null);
    setPending((current) => markPending(current, edge, Math.min(atUs, durationUs)));
  };

  /**
   * A typed time is taken as typed: unlike I / O at the playhead it neither
   * clamps to the video nor drops the other edge, so "Kesit ekle" (or the
   * kesit update) refuses a reversed or out-of-video range and says why.
   */
  const typeAt = (edge: 'in' | 'out', us: Micros) => {
    if (!video) return;
    if (selected) {
      const range =
        edge === 'in'
          ? { sourceInUs: Math.round(us), sourceOutUs: selected.sourceOutUs }
          : { sourceInUs: selected.sourceInUs, sourceOutUs: Math.round(us) };
      state.editKesit(selected.clipId, range);
      return;
    }
    state.setActionError(null);
    setPending((current) => (edge === 'in' ? { ...current, inUs: Math.round(us) } : { ...current, outUs: Math.round(us) }));
  };

  // ------------------------------------------------------------ strip edges

  const pendingRange = pending.inUs !== null || pending.outUs !== null ? resolvePending(pending, durationUs) : null;
  const editable: EditableRange | null = selected
    ? {
        kind: 'kesit',
        inUs: selected.sourceInUs,
        outUs: selected.sourceOutUs,
        startLabel: fill(t('strip.kesitStart'), { n: String(selectedIndex + 1) }),
        endLabel: fill(t('strip.kesitEnd'), { n: String(selectedIndex + 1) }),
      }
    : pendingRange
      ? {
          kind: 'pending',
          inUs: pendingRange.sourceInUs,
          outUs: pendingRange.sourceOutUs,
          startLabel: t('strip.pendingStart'),
          endLabel: t('strip.pendingEnd'),
        }
      : null;

  const resolveEdge = (edge: TrimEdge, rawUs: number) => {
    if (selected) return resolveEdgeTrim(project, selected.clipId, edge, rawUs, WEB_LOCAL_POLICY);
    if (!pendingRange) return null;
    return resolvePendingEdge(pendingRange, edge, rawUs, durationUs, project.export);
  };

  const edgeStart = () => {
    playback.stop();
    edgeRestoreRef.current = playback.timeUs;
  };
  // Ranges are half-open: the end itself is the first frame NOT kept, so the
  // end handle shows the last kept frame.
  const edgePreview = (edge: TrimEdge, us: Micros) => playback.peek(edge === 'out' ? Math.max(0, us - 1) : us);
  const edgeCancel = () => {
    const saved = edgeRestoreRef.current;
    edgeRestoreRef.current = null;
    if (saved !== null) playback.seek(saved);
  };
  const edgeCommit = (edge: TrimEdge, us: Micros, info: TrimCommitInfo) => {
    edgeRestoreRef.current = null;
    if (selected) {
      const range =
        edge === 'in'
          ? { sourceInUs: us, sourceOutUs: selected.sourceOutUs }
          : { sourceInUs: selected.sourceInUs, sourceOutUs: us };
      const after = state.editKesit(selected.clipId, range, info.coalesce);
      if (!after) {
        edgeCancel();
        return;
      }
      if (info.heldAtMinimum && info.pointer) {
        setNotice(fill(t('notice.heldAtMin'), { n: String(selectedIndex + 1), min: lengthText(500_000) }));
      }
    } else {
      setPending((current) => (edge === 'in' ? { ...current, inUs: us } : { ...current, outUs: us }));
    }
    // The playhead goes to the new edge: the first kept frame, or the last.
    playback.seek(edge === 'in' ? us : Math.max(0, us - frameUs));
  };

  // ------------------------------------------------------------ downloads

  const top = topDownload(project);
  const startDownload = (target: DownloadTarget) => {
    playback.stop();
    downloads.start(target);
  };
  const downloadTop = () => startDownload(top.kind === 'single' ? { kind: 'kesit', clipId: top.clipId } : { kind: 'all' });

  const planFingerprint = useCallback(
    (target: DownloadTarget): string | null => {
      const recipe = downloadRecipe(project, target, state.settings);
      if (!recipe) return null;
      const compiled = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
      return compiled.ok ? compiled.plan.fingerprint : null;
    },
    [project, state.settings],
  );

  const statusNode = (target: DownloadTarget) => {
    const key = targetKey(target);
    const entry = downloads.entries[key];
    if (!entry || !entryIsCurrent(entry, planFingerprint(target), project.revision)) return null;
    return (
      <DownloadStatus
        t={t}
        entry={entry}
        kind={entry.kind}
        onCancel={downloads.cancel}
        onDismiss={() => downloads.dismiss(key)}
        onReportProblem={() => setReportOpen(true)}
      />
    );
  };

  // With one kesit the top button IS its card's button: one status, on the card.
  const topStatus = top.kind === 'single' ? null : statusNode({ kind: 'all' });

  // ------------------------------------------------------------ silences

  const openSilence = () => {
    if (!video) return;
    playback.stop();
    setMoreOpen(false);
    let scope: SilenceScope;
    if (selected) {
      scope = {
        kind: 'kesit',
        clipId: selected.clipId,
        working: { ...project, clips: [selected] },
        maxClips: WEB_LOCAL_POLICY.maxClips - (project.clips.length - 1),
      };
    } else if (project.clips.length === 0) {
      const whole = withWholeKesit(project, state.settings, WEB_LOCAL_POLICY);
      if (!whole.ok) return;
      scope = { kind: 'whole', working: whole.project };
    } else {
      scope = { kind: 'all', working: project };
    }
    setSilenceScope(scope);
    silence.start(video.file, scope.working.clips);
  };

  /**
   * Help and the silence dialog are opened from Diğer, which closes as they
   * open; when they close, the keyboard continues from the ⋯ button.
   */
  const returnFocusToMore = () =>
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        document.querySelector<HTMLElement>('[data-testid="open-more"]')?.focus();
      }
    });

  const closeSilence = () => {
    silence.reset();
    setSilenceScope(null);
    returnFocusToMore();
  };

  const silencePolicy = useMemo(
    () =>
      silenceScope?.kind === 'kesit' ? { ...WEB_LOCAL_POLICY, maxClips: Math.max(1, silenceScope.maxClips) } : WEB_LOCAL_POLICY,
    [silenceScope],
  );

  // ------------------------------------------------------------ history

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

  // ------------------------------------------------------------ keyboard

  // The latest handlers for the window listener, which subscribes once.
  const keyActionsRef = useRef({ undo, redo, markAt, addKesit, leaveKesit, deleteKesit });
  useEffect(() => {
    keyActionsRef.current = { undo, redo, markAt, addKesit, leaveKesit, deleteKesit };
  });
  const hasVideo = video !== null;
  const timeRef = useRef(playback.timeUs);
  useEffect(() => {
    timeRef.current = playback.timeUs;
  }, [playback.timeUs]);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = state.selectedClipId;
  }, [state.selectedClipId]);
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
      // Inside a dialog or sheet the keys belong to the focused control.
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return;
      if (!hasVideo) return;
      if (event.key === ' ' || event.code === 'Space') {
        if (isActivatable(event.target)) return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (meta || event.altKey || event.repeat) return;
      if (MARK_IN_KEYS.has(event.key)) {
        event.preventDefault();
        actions.markAt('in', timeRef.current);
      } else if (MARK_OUT_KEYS.has(event.key)) {
        event.preventDefault();
        actions.markAt('out', timeRef.current);
      } else if (event.key === 'Enter') {
        if (isActivatable(event.target) || selectedIdRef.current) return;
        event.preventDefault();
        actions.addKesit();
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        setFullscreenRequest((count) => count + 1);
      } else if (event.key === 'Escape') {
        if (document.fullscreenElement) return;
        if (selectedIdRef.current) actions.leaveKesit();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIdRef.current) {
        event.preventDefault();
        actions.deleteKesit(selectedIdRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasVideo, togglePlay]);

  // ------------------------------------------------------------ views

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

  const view =
    project.clips[0]?.view ??
    computeSourceView(
      video?.displayWidth ?? 0,
      video?.displayHeight ?? 0,
      project.canvas.aspect,
      state.settings.fit,
      state.settings.zoom,
    );

  const captionTrack = primaryCaptionTrack(project);
  const captionStyle = captionTrack?.style ?? DEFAULT_CAPTION_STYLE;
  const activeCaption =
    captionFont === 'ready' && video
      ? captionAtVideoTime(project, playback.timeUs, playback.range?.clipId ?? state.selectedClipId)
      : undefined;
  const captionMarks = useMemo(() => videoCues(project), [project]);

  const thumbs = useThumbnails(
    video?.objectUrl ?? null,
    project.clips.map((clip) => clip.sourceInUs),
  );

  const markTarget: MarkTarget = selected
    ? { kind: 'kesit', number: selectedIndex + 1, inUs: selected.sourceInUs, outUs: selected.sourceOutUs }
    : { kind: 'pending', inUs: pending.inUs, outUs: pending.outUs, durationUs };

  const captionsNode = (
    <CaptionsPanel
      t={t}
      project={project}
      title={state.title}
      outputDurationUs={totalOutputDurationUs(project)}
      videoTimeUs={playback.timeUs}
      preferClipId={playback.range?.clipId ?? state.selectedClipId}
      fontStatus={captionFont}
      onAdd={state.addCaption}
      onUpdate={state.updateCaption}
      onRemove={state.removeCaption}
      onStyle={state.changeCaptionStyle}
      onLanguage={state.changeCaptionLanguage}
      onConvert={state.convertCaptions}
      onShift={state.shiftAllCaptions}
      onImport={state.importCaptions}
      onSeek={(us) => {
        playback.stop();
        playback.seek(us);
      }}
    />
  );

  const relinkAudioNode = state.missingAudioBinding ? (
    <RelinkPanel
      t={t}
      binding={state.missingAudioBinding}
      onPick={state.relinkAudio}
      onUseAsNew={(file) => void state.importAudio(file)}
    />
  ) : null;

  const topLabel =
    top.kind === 'merged'
      ? t(phone ? 'download.allShort' : 'download.all')
      : top.kind === 'single'
        ? t('download.one')
        : t('download.whole');

  const emptyText = video ? t('kesit.emptyWithVideo') : t('kesit.emptyNoVideo');
  const silenceScopeText = silenceScope
    ? silenceScope.kind === 'kesit'
      ? fill(t('silence.scope.kesit'), {
          n: String(project.clips.findIndex((clip) => clip.clipId === silenceScope.clipId) + 1),
        })
      : t(silenceScope.kind === 'whole' ? 'silence.scope.whole' : 'silence.scope.all')
    : '';
  const silenceMenuText = selected
    ? fill(t('more.silence.kesit'), { n: String(selectedIndex + 1) })
    : project.clips.length === 0
      ? t('more.silence.whole')
      : t('more.silence.all');

  return (
    <div
      className="editor-root"
      data-mode={layout}
      style={{ ['--canvas-aspect' as string]: CANVAS_ASPECT_CSS[project.canvas.aspect] ?? '16 / 9' }}
    >
      <aside className="prototype-banner" aria-label={t('a11y.prototypeNotice')}>
        <span>{t('banner.prototype')}</span>
        <Link href="/" style={{ color: 'inherit' }}>
          {t('app.name')}
        </Link>
      </aside>

      <header className="topbar">
        <Wordmark />
        <div className="topbar-title">
          {phone ? null : (
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
              <SaveStateBadge t={t} state={persistence.saveState} onDownloadBackup={persistence.downloadBackup} />
            </>
          )}
        </div>

        <div className="topbar-actions">
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
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMoreOpen(true)}
            aria-label={t('more.open')}
            aria-haspopup="dialog"
            data-testid="open-more"
          >
            <Icon name="more" />
          </button>
          <button
            type="button"
            className={phone ? 'icon-btn' : 'btn topbar-settings'}
            onClick={() => setSettingsOpen(true)}
            aria-label={phone ? t('settings.open') : undefined}
            aria-haspopup="dialog"
            data-testid="open-settings"
          >
            <Icon name="settings" />
            {phone ? null : t('settings.open')}
          </button>
          <button
            type="button"
            className="btn btn-accent topbar-download"
            onClick={downloadTop}
            disabled={!video || downloads.activeKey !== null}
            aria-label={top.kind === 'merged' ? t('download.all') : undefined}
            data-testid="download-all"
          >
            <Icon name="download" />
            {topLabel}
          </button>
        </div>
      </header>

      <main className="editor-body" data-mode={layout}>
        <h1 className="visually-hidden">{t('a11y.editorHeading')}</h1>
        {/* The joined length in µs, for tests and scripts; not read out. */}
        <span className="visually-hidden" aria-hidden="true" data-testid="output-duration-us">
          {totalOutputDurationUs(project)}
        </span>

        <div className="work">
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
              project={project}
              video={video}
              view={view}
              videoRef={videoElementRef}
              playing={playback.playing}
              playbackError={playback.playbackError}
              timeUs={playback.timeUs}
              onTogglePlay={playback.togglePlay}
              onSeek={playback.seek}
              onPickVideo={pickVideo}
              importing={state.importing === 'video'}
              caption={activeCaption ? { cueId: activeCaption.cueId, text: activeCaption.text } : null}
              captionStyle={captionStyle}
              fullscreenRequest={fullscreenRequest}
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
            </PreviewStage>
          )}

          <SourceStrip
            t={t}
            durationUs={durationUs}
            timeUs={playback.timeUs}
            frameUs={frameUs}
            kesitler={project.clips.map((clip, index) => ({
              clipId: clip.clipId,
              index,
              inUs: clip.sourceInUs,
              outUs: clip.sourceOutUs,
            }))}
            selectedClipId={state.selectedClipId}
            playingClipId={playback.range?.clipId ?? null}
            pending={selected || !pendingRange ? null : { inUs: pendingRange.sourceInUs, outUs: pendingRange.sourceOutUs }}
            editable={video ? editable : null}
            resolveEdge={resolveEdge}
            captionMarks={captionMarks}
            disabled={!video}
            onSeek={(us) => {
              playback.seek(us);
            }}
            onSelectKesit={selectKesit}
            onEdgeStart={edgeStart}
            onEdgePreview={edgePreview}
            onEdgeCancel={edgeCancel}
            onEdgeCommit={edgeCommit}
          />

          <MarkBar
            t={t}
            disabled={!video}
            target={markTarget}
            onMark={(edge) => markAt(edge, playback.timeUs)}
            onType={typeAt}
            onAdd={addKesit}
            onInvalid={() => state.setActionError('error.invalid_time')}
            onDone={leaveKesit}
          />

          {/* One line under the marks, always in the page: a screen reader is
              already listening, and a message appearing or going never moves
              the buttons above it (the preview takes the free height). A
              refusal shows instead of the last confirmation. */}
          <div className="notice-row" data-empty={notice === null && state.actionError === null}>
            {state.actionError ? (
              <p className="inline-error notice-error" role="alert" data-testid="range-error">
                <Icon name="alert" />
                {t(state.actionError)}
              </p>
            ) : null}
            <p
              className="notice-text"
              role="status"
              aria-live="polite"
              hidden={state.actionError !== null}
              data-testid="timeline-notice"
            >
              {notice ?? ''}
            </p>
            {notice && !state.actionError ? (
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => setNotice(null)}
                aria-label={t('notice.dismiss')}
              >
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <KesitList
          t={t}
          project={project}
          selectedClipId={state.selectedClipId}
          playingClipId={playback.playing ? (playback.range?.clipId ?? null) : null}
          thumbs={thumbs}
          downloading={downloads.activeKey !== null}
          statusFor={(clipId) => statusNode({ kind: 'kesit', clipId })}
          topStatus={topStatus}
          onSelect={selectKesit}
          onPlay={playKesit}
          onDownload={(clipId) => startDownload({ kind: 'kesit', clipId })}
          onDelete={deleteKesit}
          onMove={state.moveKesit}
          emptyText={emptyText}
          saveNote={hydrated && state.video !== null && canPickSaveFile() ? t('download.overwriteNote') : null}
        />
      </main>

      {phone ? null : (
        <footer className="status-bar">
          <span>{t('footer.local')}</span>
          <span className="shortcut-hints">Space · I / O · Enter · F · Ctrl/Cmd+Z</span>
        </footer>
      )}

      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('settings.title')}
        id="sheet-settings"
        side={phone ? 'bottom' : 'right'}
        closeLabel={t('help.close')}
      >
        <SettingsPanel
          t={t}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          project={project}
          audio={state.audio}
          framing={state.framing}
          onFraming={state.changeFraming}
          onShortEdge={state.changeShortEdge}
          videoSound={{ gainDb: state.settings.sourceGainDb, muted: state.settings.muted }}
          onVideoGain={state.changeVideoGain}
          onVideoMuted={state.changeVideoMuted}
          onMusicChange={state.changeMusic}
          onPickAudio={pickAudio}
          onRemoveAudio={state.dropAudio}
          relinkNode={relinkAudioNode}
          captionsNode={captionsNode}
        />
      </Sheet>

      <Sheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={t('more.title')}
        id="sheet-more"
        side={phone ? 'bottom' : 'right'}
        closeLabel={t('help.close')}
      >
        {phone ? (
          <>
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
          </>
        ) : null}
        <div className="more-list">
          <button type="button" className="btn btn-block" onClick={pickVideo} data-testid="more-open-video">
            <Icon name="folder" />
            {video ? t('more.otherVideo') : t('preview.pickVideo')}
          </button>
          <button
            type="button"
            className="btn btn-block"
            onClick={openSilence}
            disabled={!video}
            data-testid="find-silences"
          >
            <Icon name="scissors" />
            {silenceMenuText}
          </button>
          <p className="hint-small">{t('more.silence.hint')}</p>
          <hr className="divider" />
          <div data-testid="backup-panel">
            <p className="field-label">{t('backup.title')}</p>
            <p className="hint-small" style={{ marginBottom: 10 }}>
              {t('backup.body')}
            </p>
            <button type="button" className="btn btn-block" onClick={persistence.downloadBackup} data-testid="backup-download">
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
          <hr className="divider" />
          <button
            type="button"
            className="btn btn-block"
            onClick={() => {
              setMoreOpen(false);
              setHelpOpen(true);
            }}
            data-testid="open-help"
          >
            <Icon name="help" />
            {t('topbar.help')}
          </button>
        </div>
      </Sheet>

      <HelpDialog
        t={t}
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          returnFocusToMore();
        }}
        onReportProblem={() => setReportOpen(true)}
      />
      {reportOpen ? <ReportDialog t={t} project={project} onClose={() => setReportOpen(false)} /> : null}
      {silenceScope && video ? (
        <SilenceDialog
          t={t}
          project={silenceScope.working}
          policy={silencePolicy}
          scopeText={silenceScopeText}
          numberOf={(clipId, index) => {
            if (silenceScope.kind !== 'kesit') return index + 1;
            return project.clips.findIndex((clip) => clip.clipId === clipId) + 1 || index + 1;
          }}
          videoUrl={video.objectUrl}
          run={silence.run}
          envelopeFor={silence.envelopeFor}
          onRetry={() => silence.start(video.file, silenceScope.working.clips)}
          onCancel={silence.cancel}
          onApply={(removals) => {
            const result = state.cutSilences(removals, silenceScope.kind === 'whole');
            // The dialog shows its report for the recipe it was opened with.
            return result.ok ? { ...result, project: silenceScope.working } : result;
          }}
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
      {state.audio && project.music ? (
        <audio ref={musicElementRef} src={state.audio.objectUrl} preload="metadata" className="visually-hidden" />
      ) : null}
    </div>
  );
}
