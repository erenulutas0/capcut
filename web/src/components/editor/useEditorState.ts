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
  createEmptyProject,
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
  splitClip,
  updateCaptionCue,
  updateClipRange,
  updateMusic,
  type AddClipRejection,
  type CaptionCueInput,
  type CaptionResult,
  type MusicRejection,
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
import type { Micros } from '@/domain/time';
import { splitPointAt, type Playhead, type SplitRejection } from '@/domain/trim';
import type { MessageKey } from '@/i18n/messages';

export type PreviewMode = 'source' | 'output';

export interface MediaError {
  scope: 'video' | 'audio';
  reason: ProbeFailure;
}

const VIDEO_LIMITS = {
  maxBytes: WEB_LOCAL_POLICY.maxTotalSourceBytes,
  maxDurationUs: WEB_LOCAL_POLICY.maxTotalSourceDurationUs,
};

const AUDIO_LIMITS = {
  maxBytes: WEB_LOCAL_POLICY.maxMusicBytes,
  maxDurationUs: WEB_LOCAL_POLICY.maxMusicDurationUs,
};

function rejectionKey(reason: AddClipRejection | MusicRejection | SplitRejection): MessageKey {
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
    async (file: File) => {
      setMediaError(null);
      setActionError(null);
      const musicBytes = liveHandles.current.audio?.file.size ?? 0;
      if (
        file.size <= VIDEO_LIMITS.maxBytes &&
        exceedsTotalSourceBytes(WEB_LOCAL_POLICY, file.size, musicBytes)
      ) {
        setMediaError({ scope: 'video', reason: 'total_too_large' });
        return;
      }
      setImporting('video');
      const outcome = await probeVideoFile(file, VIDEO_LIMITS);
      setImporting(null);

      if (!outcome.ok) {
        setMediaError({ scope: 'video', reason: outcome.reason });
        return;
      }

      setVideo((previous) => {
        previous?.release();
        return outcome.handle;
      });
      setSelectedClipId(null);
      setPreviewMode('source');
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
        return commit(
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
      });
    },
    [],
  );

  const importAudio = useCallback(async (file: File) => {
    setMediaError(null);
    setActionError(null);
    const videoBytes = liveHandles.current.video?.file.size ?? 0;
    if (
      file.size <= AUDIO_LIMITS.maxBytes &&
      exceedsTotalSourceBytes(WEB_LOCAL_POLICY, file.size, videoBytes)
    ) {
      setMediaError({ scope: 'audio', reason: 'total_too_large' });
      return;
    }
    setImporting('audio');
    const outcome = await probeAudioFile(file, AUDIO_LIMITS);
    setImporting(null);

    if (!outcome.ok) {
      setMediaError({ scope: 'audio', reason: outcome.reason });
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
        setMediaError({ scope: 'video', reason: outcome.reason });
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
        setMediaError({ scope: 'audio', reason: outcome.reason });
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

  const dropMoment = useCallback(
    (clipId: string) => {
      setActionError(null);
      setSelectedClipId((selected) => (selected === clipId ? null : selected));
      setHistory((current) => commit(current, removeClip(current.present, clipId)));
    },
    [],
  );

  /**
   * Splits a moment where the preview's playhead is. The playhead is passed
   * with its clock (source or output) and mapped in the domain, so the result
   * mode never cuts at a source second that belongs to another occurrence.
   */
  const splitMoment = useCallback((clipId: string | null, playhead: Playhead) => {
    setActionError(null);
    setHistory((current) => {
      const point = splitPointAt(current.present, clipId, playhead, WEB_LOCAL_POLICY);
      if (!point.ok || !clipId) {
        setTimelineError(rejectionKey(point.ok ? 'no_selection' : point.reason));
        return current;
      }
      const result = splitClip(current.present, clipId, point.sourceUs, WEB_LOCAL_POLICY);
      if (!result.ok) {
        setTimelineError(rejectionKey(result.reason));
        return current;
      }
      setTimelineError(null);
      return commit(current, result.project);
    });
  }, []);

  /**
   * Stores a trimmed range from the strip handles. `coalesce` folds the change
   * into the undo step that is already on top — used for a held arrow key, so
   * one long press is one undo, not thirty.
   */
  const trimMoment = useCallback(
    (clipId: string, range: { sourceInUs: Micros; sourceOutUs: Micros }, coalesce = false) => {
      setActionError(null);
      setHistory((current) => {
        const clip = current.present.clips.find((item) => item.clipId === clipId);
        if (
          clip &&
          clip.sourceInUs === range.sourceInUs &&
          clip.sourceOutUs === range.sourceOutUs
        ) {
          return current;
        }
        const result = updateClipRange(current.present, clipId, range, WEB_LOCAL_POLICY);
        if (!result.ok) {
          setTimelineError(rejectionKey(result.reason));
          return current;
        }
        setTimelineError(null);
        return coalesce ? historyReplace(current, result.project) : commit(current, result.project);
      });
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
   * Runs a caption command and commits it as one undo step.
   *
   * Unlike the moment commands, the caller needs the outcome right away (the
   * new cue id to focus, or the reason to show under the line), so the command
   * runs against the rendered project first. The updater re-runs it only if
   * another update landed in between, so nothing is committed on top of a
   * stale recipe.
   */
  const runCaption = useCallback(
    (run: (base: Project) => CaptionResult): CaptionResult => {
      const result = run(project);
      if (result.ok) {
        setHistory((current) => {
          const again = current.present === project ? result : run(current.present);
          return again.ok ? commit(current, again.project) : current;
        });
      }
      return result;
    },
    [project],
  );

  const addCaption = useCallback(
    (input: CaptionCueInput) => runCaption((base) => addCaptionCue(base, input)),
    [runCaption],
  );

  const updateCaption = useCallback(
    (cueId: string, patch: Partial<CaptionCueInput>) =>
      runCaption((base) => updateCaptionCue(base, cueId, patch)),
    [runCaption],
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
    dropMoment,
    splitMoment,
    trimMoment,
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
  };
}

export type EditorState = ReturnType<typeof useEditorState>;
