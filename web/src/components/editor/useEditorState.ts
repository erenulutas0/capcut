'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  probeAudioFile,
  probeVideoFile,
  type MediaHandle,
  type ProbeFailure,
} from '@/adapters/browserMedia';
import {
  addCaptionCue,
  addClip,
  addLeadingSource,
  addWholeSource,
  applySilenceCuts,
  convertCaptionTimeBase,
  createEmptyProject,
  importCaptionTrack,
  shiftCaptions,
  currentFraming,
  moveClip,
  nextAssetId,
  primaryVideoAsset,
  removeCaptionCue,
  removeClip,
  removeMusic,
  setCaptionLanguage,
  setCaptionStyle,
  setClipGain,
  setClipMuted,
  setExportShortEdge,
  setFraming,
  setMusicAsset,
  setVideoAsset,
  splitAtTimelinePlayhead,
  updateCaptionCue,
  updateClipRange,
  updateMusic,
  type AddClipRejection,
  type CaptionConversionResult,
  type CaptionCueInput,
  type CaptionImportResult,
  type CaptionResult,
  type ImportedCueInput,
  type ShiftCaptionsResult,
  type SilenceCutResult,
  type MusicRejection,
  type TimelineSplitResult,
} from '@/application/commands';
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit,
  initHistory,
  redo as historyRedo,
  replace as historyReplace,
  undo as historyUndo,
  type History,
} from '@/application/history';
import type { AspectRatio, CaptionStyleV2, FitMode, MusicV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY, exceedsTotalSourceBytes } from '@/domain/policy';
import {
  bindingFor,
  compareBinding,
  type AssetBinding,
  type BindingMatch,
  type ProjectRecord,
} from '@/domain/projectRecord';
import { totalOutputDurationUs } from '@/domain/timeline';
import type { ClipSilence } from '@/domain/silence';
import type { Micros } from '@/domain/time';
import type { SplitRejection } from '@/domain/trim';
import { initialPlacement, type TimelineSplitRejection } from '@/domain/timelineEdit';
import type { MessageKey } from '@/i18n/messages';

export type PreviewMode = 'source' | 'output';

export interface MediaError {
  scope: 'video' | 'audio';
  reason: ProbeFailure;
  /** The rejected file's name as picked; shown through `safeFileName`. */
  fileName: string;
  /** True when another file of the same kind was open and stays open. */
  keptOpen: boolean;
}

/** What opening a video did, so the editor can say it and set up the preview. */
export type VideoImportOutcome =
  | { kind: 'rejected' }
  /** The whole video went onto the timeline as one piece. */
  | { kind: 'whole'; lengthUs: Micros }
  /** Longer than the output limit: the timeline stays empty until the user chooses. */
  | { kind: 'too_long'; durationUs: Micros }
  | { kind: 'too_short' };

const VIDEO_LIMITS = {
  maxBytes: WEB_LOCAL_POLICY.maxTotalSourceBytes,
  maxDurationUs: WEB_LOCAL_POLICY.maxTotalSourceDurationUs,
};

const AUDIO_LIMITS = {
  maxBytes: WEB_LOCAL_POLICY.maxMusicBytes,
  maxDurationUs: WEB_LOCAL_POLICY.maxMusicDurationUs,
};

/** The shape every caption or timeline command returns: a new recipe, or a refusal. */
type CommandOutcome = { ok: true; project: Project } | { ok: false };

/** The recipe to commit, or null when the command refused or changed nothing. */
function changedProject(result: CommandOutcome, base: Project): Project | null {
  return result.ok && result.project !== base ? result.project : null;
}

function rejectionKey(
  reason: AddClipRejection | MusicRejection | SplitRejection | TimelineSplitRejection,
): MessageKey {
  return `error.${reason}` as MessageKey;
}

export function useEditorState() {
  const [title, setTitle] = useState('');
  const [history, setHistory] = useState<History<Project>>(() =>
    initHistory(createEmptyProject()),
  );
  const [video, setVideo] = useState<MediaHandle | null>(null);
  const [audio, setAudio] = useState<MediaHandle | null>(null);
  /**
   * What we know about the user's files, kept so a restored project can
   * recognise them again. Small metadata only — never media bytes.
   */
  const [bindings, setBindings] = useState<AssetBinding[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('source');
  const [importing, setImporting] = useState<'video' | 'audio' | null>(null);
  const [mediaError, setMediaError] = useState<MediaError | null>(null);
  const [actionError, setActionError] = useState<MessageKey | null>(null);
  /**
   * Errors from the output strip (split, trim). Kept apart from `actionError`
   * because that one is shown by the range form, which result mode hides.
   */
  const [timelineError, setTimelineError] = useState<MessageKey | null>(null);

  const project = history.present;
  const liveHandles = useRef<{ video: MediaHandle | null; audio: MediaHandle | null }>({
    video: null,
    audio: null,
  });

  useEffect(() => {
    liveHandles.current = { video, audio };
  }, [video, audio]);

  // One owner per object URL: replacement releases the old one above, and the
  // last surviving handles are released when the editor unmounts.
  useEffect(
    () => () => {
      liveHandles.current.video?.release();
      liveHandles.current.audio?.release();
    },
    [],
  );

  const importVideo = useCallback(
    async (file: File): Promise<VideoImportOutcome> => {
      setMediaError(null);
      setActionError(null);
      setTimelineError(null);
      const keptOpen = liveHandles.current.video !== null;
      const musicBytes = liveHandles.current.audio?.file.size ?? 0;
      if (
        file.size <= VIDEO_LIMITS.maxBytes &&
        exceedsTotalSourceBytes(WEB_LOCAL_POLICY, file.size, musicBytes)
      ) {
        setMediaError({ scope: 'video', reason: 'total_too_large', fileName: file.name, keptOpen });
        return { kind: 'rejected' };
      }
      setImporting('video');
      const outcome = await probeVideoFile(file, VIDEO_LIMITS);
      setImporting(null);

      if (!outcome.ok) {
        setMediaError({ scope: 'video', reason: outcome.reason, fileName: file.name, keptOpen });
        return { kind: 'rejected' };
      }

      // ADR-019: a video that fits the output limit goes onto the timeline
      // whole, as one piece. A longer one is not truncated silently.
      const placement = initialPlacement(outcome.handle.durationUs, WEB_LOCAL_POLICY);

      setVideo((previous) => {
        previous?.release();
        return outcome.handle;
      });
      setSelectedClipId(null);
      setPreviewMode(placement.kind === 'whole' ? 'output' : 'source');
      setHistory((current) => {
        const assetId = nextAssetId(current.present, 'video');
        setBindings((previous) => [
          ...previous.filter((binding) => binding.kind !== 'video'),
          bindingFor(assetId, 'video', file, {
            durationUs: outcome.handle.durationUs,
            displayWidth: outcome.handle.displayWidth,
            displayHeight: outcome.handle.displayHeight,
          }),
        ]);
        const withVideo = commit(
          current,
          setVideoAsset(current.present, {
            assetId,
            kind: 'video',
            durationUs: outcome.handle.durationUs,
            ...(outcome.handle.displayWidth
              ? { displayWidth: outcome.handle.displayWidth }
              : {}),
            ...(outcome.handle.displayHeight
              ? { displayHeight: outcome.handle.displayHeight }
              : {}),
            ...(outcome.handle.hasAudio === undefined
              ? {}
              : { hasAudio: outcome.handle.hasAudio }),
          }),
        );
        if (placement.kind !== 'whole') return withVideo;
        // Its own undo step on top of the import: the first Ctrl+Z empties
        // the timeline and keeps the video open (the secondary range flow).
        const whole = addWholeSource(withVideo.present, WEB_LOCAL_POLICY);
        return whole.ok ? commit(withVideo, whole.project) : withVideo;
      });
      if (placement.kind === 'whole') {
        return { kind: 'whole', lengthUs: placement.sourceOutUs - placement.sourceInUs };
      }
      return placement.kind === 'too_long'
        ? { kind: 'too_long', durationUs: placement.durationUs }
        : { kind: 'too_short' };
    },
    [],
  );

  const importAudio = useCallback(async (file: File) => {
    setMediaError(null);
    setActionError(null);
    const keptOpen = liveHandles.current.audio !== null;
    const videoBytes = liveHandles.current.video?.file.size ?? 0;
    if (
      file.size <= AUDIO_LIMITS.maxBytes &&
      exceedsTotalSourceBytes(WEB_LOCAL_POLICY, file.size, videoBytes)
    ) {
      setMediaError({ scope: 'audio', reason: 'total_too_large', fileName: file.name, keptOpen });
      return;
    }
    setImporting('audio');
    const outcome = await probeAudioFile(file, AUDIO_LIMITS);
    setImporting(null);

    if (!outcome.ok) {
      setMediaError({ scope: 'audio', reason: outcome.reason, fileName: file.name, keptOpen });
      return;
    }

    setAudio((previous) => {
      previous?.release();
      return outcome.handle;
    });
    setHistory((current) => {
      const assetId = nextAssetId(current.present, 'audio');
      setBindings((previous) => [
        ...previous.filter((binding) => binding.kind !== 'audio'),
        bindingFor(assetId, 'audio', file, { durationUs: outcome.handle.durationUs }),
      ]);
      return commit(
        current,
        setMusicAsset(current.present, {
          assetId,
          kind: 'audio',
          durationUs: outcome.handle.durationUs,
        }),
      );
    });
  }, []);

  const dropAudio = useCallback(() => {
    setAudio((previous) => {
      previous?.release();
      return null;
    });
    setBindings((previous) => previous.filter((binding) => binding.kind !== 'audio'));
    setHistory((current) => commit(current, removeMusic(current.present)));
  }, []);

  /**
   * Re-opens a project that was stored locally.
   *
   * The recipe comes back; the files do not, because a browser cannot hold a
   * `File` across sessions. History starts fresh — undoing into a previous
   * session's state would be meaningless.
   */
  const restoreFromRecord = useCallback((record: ProjectRecord) => {
    setHistory(initHistory(record.edl));
    setTitle(record.title);
    setBindings(record.bindings);
    setSelectedClipId(null);
    setPreviewMode('source');
    setActionError(null);
    setMediaError(null);
  }, []);

  /**
   * Points a restored project back at a file the user picks again.
   *
   * A file that does not match the stored binding is NOT accepted silently:
   * re-pointing existing ranges at different footage would produce a video the
   * user never asked for (doc 11). The caller is told and decides.
   */
  const relinkVideo = useCallback(
    async (file: File): Promise<{ ok: true; match: BindingMatch } | { ok: false; reason: ProbeFailure | 'mismatch' | 'no_binding' }> => {
      const binding = bindings.find((item) => item.kind === 'video');
      if (!binding) return { ok: false, reason: 'no_binding' };

      setMediaError(null);
      setImporting('video');
      const outcome = await probeVideoFile(file, VIDEO_LIMITS);
      setImporting(null);
      if (!outcome.ok) {
        setMediaError({ scope: 'video', reason: outcome.reason, fileName: file.name, keptOpen: false });
        return { ok: false, reason: outcome.reason };
      }

      const match = compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified,
        durationUs: outcome.handle.durationUs,
        displayWidth: outcome.handle.displayWidth,
        displayHeight: outcome.handle.displayHeight,
      });

      if (match === 'mismatch') {
        outcome.handle.release();
        return { ok: false, reason: 'mismatch' };
      }

      setVideo((previous) => {
        previous?.release();
        return outcome.handle;
      });
      // Re-linking restores access; it does not change the recipe, so it must
      // not create an undo step or bump the revision.
      setBindings((previous) =>
        previous.map((item) =>
          item.kind === 'video'
            ? { ...item, fileName: file.name, lastSeenAt: new Date().toISOString() }
            : item,
        ),
      );
      return { ok: true, match };
    },
    [bindings],
  );

  const relinkAudio = useCallback(
    async (file: File): Promise<{ ok: true; match: BindingMatch } | { ok: false; reason: ProbeFailure | 'mismatch' | 'no_binding' }> => {
      const binding = bindings.find((item) => item.kind === 'audio');
      if (!binding) return { ok: false, reason: 'no_binding' };

      setMediaError(null);
      setImporting('audio');
      const outcome = await probeAudioFile(file, AUDIO_LIMITS);
      setImporting(null);
      if (!outcome.ok) {
        setMediaError({ scope: 'audio', reason: outcome.reason, fileName: file.name, keptOpen: false });
        return { ok: false, reason: outcome.reason };
      }

      const match = compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified,
        durationUs: outcome.handle.durationUs,
      });
      if (match === 'mismatch') {
        outcome.handle.release();
        return { ok: false, reason: 'mismatch' };
      }

      setAudio((previous) => {
        previous?.release();
        return outcome.handle;
      });
      setBindings((previous) =>
        previous.map((item) =>
          item.kind === 'audio'
            ? { ...item, fileName: file.name, lastSeenAt: new Date().toISOString() }
            : item,
        ),
      );
      return { ok: true, match };
    },
    [bindings],
  );

  const addMoment = useCallback(
    (sourceInUs: Micros, sourceOutUs: Micros): boolean => {
      let added = false;
      setHistory((current) => {
        const result = addClip(current.present, { sourceInUs, sourceOutUs }, WEB_LOCAL_POLICY);
        if (!result.ok) {
          setActionError(rejectionKey(result.reason));
          return current;
        }
        added = true;
        setActionError(null);
        const newest = result.project.clips[result.project.clips.length - 1];
        if (newest) setSelectedClipId(newest.clipId);
        return commit(current, result.project);
      });
      return added;
    },
    [],
  );

  const editMomentRange = useCallback(
    (clipId: string, sourceInUs: Micros, sourceOutUs: Micros): boolean => {
      let ok = false;
      setHistory((current) => {
        const result = updateClipRange(
          current.present,
          clipId,
          { sourceInUs, sourceOutUs },
          WEB_LOCAL_POLICY,
        );
        if (!result.ok) {
          setActionError(rejectionKey(result.reason));
          return current;
        }
        ok = true;
        setActionError(null);
        return commit(current, result.project);
      });
      return ok;
    },
    [],
  );

  const shiftMoment = useCallback((clipId: string, delta: -1 | 1) => {
    setActionError(null);
    setHistory((current) => {
      const next = moveClip(current.present, clipId, delta);
      return next === current.present ? current : commit(current, next);
    });
  }, []);

  const changeFraming = useCallback(
    (framing: { aspect?: AspectRatio; fit?: FitMode; zoom?: number }) => {
      setHistory((current) => commit(current, setFraming(current.present, framing)));
    },
    [],
  );

  const changeClipGain = useCallback((clipId: string, gainDb: number) => {
    setHistory((current) => commit(current, setClipGain(current.present, clipId, gainDb)));
  }, []);

  const changeClipMuted = useCallback((clipId: string, muted: boolean) => {
    setHistory((current) => commit(current, setClipMuted(current.present, clipId, muted)));
  }, []);

  const changeMusic = useCallback((patch: Partial<Omit<MusicV1, 'assetId'>>): boolean => {
    let ok = false;
    setHistory((current) => {
      const result = updateMusic(current.present, patch);
      if (!result.ok) {
        setActionError(rejectionKey(result.reason));
        return current;
      }
      ok = true;
      setActionError(null);
      return commit(current, result.project);
    });
    return ok;
  }, []);

  const changeShortEdge = useCallback((shortEdge: number) => {
    setHistory((current) => {
      const next = setExportShortEdge(current.present, shortEdge);
      return next === current.present ? current : commit(current, next);
    });
  }, []);

  /**
   * Runs a command (captions, silence cuts, the timeline actions) and commits
   * it as one undo step — or, with `coalesce`, folds it into the step on top
   * (a held arrow key on a trim edge is one undo, not thirty).
   *
   * The caller needs the outcome right away (the new cue id to focus, the
   * piece to announce, the reason to show), so the command runs against the
   * rendered project first. The updater re-runs it only if another update
   * landed in between, so nothing is committed on top of a stale recipe.
   * A successful edit also clears a stale file-rejection message.
   */
  const runCommand = useCallback(
    <R extends CommandOutcome>(run: (base: Project) => R, coalesce = false): R => {
      const result = run(project);
      const changed = changedProject(result, project);
      if (changed) {
        const store = (history: History<Project>, next: Project) =>
          coalesce ? historyReplace(history, next) : commit(history, next);
        setMediaError(null);
        setHistory((current) => {
          if (current.present === project) return store(current, changed);
          const again = changedProject(run(current.present), current.present);
          return again ? store(current, again) : current;
        });
      }
      return result;
    },
    [project],
  );

  /** Deletes a piece; the pieces after it close up. One undo step. Returns the new recipe. */
  const deletePiece = useCallback(
    (clipId: string): Project | null => {
      setActionError(null);
      setTimelineError(null);
      const result = runCommand((base): CommandOutcome => {
        const next = removeClip(base, clipId);
        return next === base ? { ok: false } : { ok: true, project: next };
      });
      if (!result.ok) return null;
      setSelectedClipId((selected) => (selected === clipId ? null : selected));
      return result.project;
    },
    [runCommand],
  );

  /**
   * "Böl": cuts the piece under the playhead (ADR-019). The piece now under
   * the playhead — the second half — becomes the selection, so "Sil" right
   * after a split removes what follows the cut.
   */
  const splitPiece = useCallback(
    (playhead: Parameters<typeof splitAtTimelinePlayhead>[1]): TimelineSplitResult => {
      setActionError(null);
      const result = runCommand((base) => splitAtTimelinePlayhead(base, playhead, WEB_LOCAL_POLICY));
      if (!result.ok) {
        setTimelineError(rejectionKey(result.reason));
        return result;
      }
      setTimelineError(null);
      setSelectedClipId(result.newClipId);
      return result;
    },
    [runCommand],
  );

  /**
   * Stores a trimmed range from an edge of a piece. `coalesce` folds the
   * change into the undo step on top (held arrow key). Returns the new
   * recipe, or null when nothing changed.
   */
  const trimPiece = useCallback(
    (
      clipId: string,
      range: { sourceInUs: Micros; sourceOutUs: Micros },
      coalesce = false,
    ): Project | null => {
      setActionError(null);
      const result = runCommand((base) => {
        const clip = base.clips.find((item) => item.clipId === clipId);
        if (clip && clip.sourceInUs === range.sourceInUs && clip.sourceOutUs === range.sourceOutUs) {
          return { ok: false as const, reason: null };
        }
        return updateClipRange(base, clipId, range, WEB_LOCAL_POLICY);
      }, coalesce);
      if (result.ok) {
        setTimelineError(null);
        return result.project;
      }
      if (result.reason) setTimelineError(rejectionKey(result.reason));
      return null;
    },
    [runCommand],
  );

  /** "Tüm videoyu ekle" on an empty timeline. */
  const addWholeVideo = useCallback((): Project | null => {
    setActionError(null);
    const result = runCommand((base) => addWholeSource(base, WEB_LOCAL_POLICY));
    if (!result.ok) {
      setTimelineError(
        rejectionKey(
          result.reason === 'source_longer_than_output' ? 'output_duration_exceeds_policy' : result.reason,
        ),
      );
      return null;
    }
    setTimelineError(null);
    return result.project;
  }, [runCommand]);

  /** "İlk 5 dakikayı ekle" for a video longer than the output limit. */
  const addLeadingMinutes = useCallback((): Project | null => {
    setActionError(null);
    const result = runCommand((base) => addLeadingSource(base, WEB_LOCAL_POLICY));
    if (!result.ok) {
      setTimelineError(rejectionKey(result.reason));
      return null;
    }
    setTimelineError(null);
    return result.project;
  }, [runCommand]);

  const addCaption = useCallback(
    (input: CaptionCueInput) => runCommand((base) => addCaptionCue(base, input)),
    [runCommand],
  );

  const updateCaption = useCallback(
    (cueId: string, patch: Partial<CaptionCueInput>) =>
      runCommand((base) => updateCaptionCue(base, cueId, patch)),
    [runCommand],
  );

  /** Re-anchors the track to the other clock (ADR-016). One undo step. */
  const convertCaptions = useCallback(
    (target: 'output' | 'source'): CaptionConversionResult =>
      runCommand((base) => convertCaptionTimeBase(base, target)),
    [runCommand],
  );

  const shiftAllCaptions = useCallback(
    (deltaUs: Micros): ShiftCaptionsResult => runCommand((base) => shiftCaptions(base, deltaUs)),
    [runCommand],
  );

  /** Replaces the track with lines from a subtitle file. One undo step. */
  const importCaptions = useCallback(
    (cues: readonly ImportedCueInput[], timeBase: 'output' | 'source'): CaptionImportResult =>
      runCommand((base) => importCaptionTrack(base, cues, timeBase)),
    [runCommand],
  );

  /**
   * Removes the silences the user approved in the dialog (ADR-018). One undo
   * step; the dialog shows the report, so the result is returned directly.
   */
  const cutSilences = useCallback(
    (removals: readonly ClipSilence[]): SilenceCutResult =>
      runCommand((base) => applySilenceCuts(base, removals, WEB_LOCAL_POLICY)),
    [runCommand],
  );

  const removeCaption = useCallback((cueId: string) => {
    setHistory((current) => commit(current, removeCaptionCue(current.present, cueId)));
  }, []);

  const changeCaptionStyle = useCallback((patch: Partial<CaptionStyleV2>) => {
    setHistory((current) => commit(current, setCaptionStyle(current.present, patch)));
  }, []);

  const changeCaptionLanguage = useCallback((language: string) => {
    setHistory((current) => commit(current, setCaptionLanguage(current.present, language)));
  }, []);

  const undo = useCallback(() => {
    setActionError(null);
    setTimelineError(null);
    setHistory((current) => historyUndo(current));
  }, []);

  const redo = useCallback(() => {
    setActionError(null);
    setTimelineError(null);
    setHistory((current) => historyRedo(current));
  }, []);

  const asset = primaryVideoAsset(project);
  const framing = useMemo(() => currentFraming(project), [project]);
  const outputDurationUs = useMemo(() => totalOutputDurationUs(project), [project]);
  const selectedClip = useMemo(
    () => project.clips.find((clip) => clip.clipId === selectedClipId) ?? null,
    [project.clips, selectedClipId],
  );

  const totalSourceBytes = (video?.sizeBytes ?? 0) + (audio?.sizeBytes ?? 0);
  const dirty = history.past.length > 0;
  // The unload warning moved to the persistence hook: now that edits are saved
  // automatically, warning on every edit would cry wolf. Only work that is
  // still being written, or that failed to write, is actually at risk.

  // A restored project knows which files it needs but has none of them open.
  const referencedAssetIds = useMemo(
    () => new Set(project.assets.map((item) => item.assetId)),
    [project.assets],
  );
  const missingVideoBinding = useMemo(() => {
    if (video) return null;
    return (
      bindings.find((item) => item.kind === 'video' && referencedAssetIds.has(item.assetId)) ?? null
    );
  }, [bindings, referencedAssetIds, video]);
  const missingAudioBinding = useMemo(() => {
    if (audio) return null;
    return (
      bindings.find((item) => item.kind === 'audio' && referencedAssetIds.has(item.assetId)) ?? null
    );
  }, [audio, bindings, referencedAssetIds]);

  return {
    title,
    setTitle,
    project,
    asset,
    framing,
    outputDurationUs,
    video,
    audio,
    bindings,
    missingVideoBinding,
    missingAudioBinding,
    restoreFromRecord,
    relinkVideo,
    relinkAudio,
    totalSourceBytes,
    selectedClipId,
    selectedClip,
    setSelectedClipId,
    previewMode,
    setPreviewMode,
    importing,
    mediaError,
    clearMediaError: () => setMediaError(null),
    actionError,
    setActionError,
    timelineError,
    setTimelineError,
    dirty,
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    undo,
    redo,
    importVideo,
    importAudio,
    dropAudio,
    addMoment,
    editMomentRange,
    deletePiece,
    splitPiece,
    trimPiece,
    addWholeVideo,
    addLeadingMinutes,
    shiftMoment,
    changeFraming,
    changeClipGain,
    changeClipMuted,
    changeMusic,
    changeShortEdge,
    addCaption,
    updateCaption,
    removeCaption,
    changeCaptionStyle,
    changeCaptionLanguage,
    convertCaptions,
    shiftAllCaptions,
    importCaptions,
    cutSilences,
  };
}

export type EditorState = ReturnType<typeof useEditorState>;
