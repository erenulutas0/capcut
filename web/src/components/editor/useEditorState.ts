'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  probeAudioFile,
  probeVideoFile,
  type MediaHandle,
  type ProbeFailure,
  type ProbeHint,
} from '@/adapters/browserMedia';
import {
  addCaptionCue,
  addClip,
  applySilenceCuts,
  convertCaptionTimeBase,
  createEmptyProject,
  importCaptionTrack,
  shiftCaptions,
  currentFraming,
  moveClipTo,
  nextAssetId,
  primaryVideoAsset,
  removeCaptionCue,
  removeClip,
  removeMusic,
  setCaptionLanguage,
  setCaptionStyle,
  setExportShortEdge,
  setFraming,
  setMusicAsset,
  setVideoAsset,
  setVideoGain,
  setVideoMuted,
  updateCaptionCue,
  updateClipRange,
  updateMusic,
  withWholeKesit,
  type AddClipRejection,
  type CaptionConversionResult,
  type CaptionCueInput,
  type CaptionImportResult,
  type CaptionResult,
  type ImportedCueInput,
  type ShiftCaptionsResult,
  type SilenceCutResult,
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
import { DEFAULT_KESIT_SETTINGS, type KesitSettings } from '@/domain/kesit';
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
import { aspectForVideo } from '@/domain/timelineEdit';
import type { MessageKey } from '@/i18n/messages';

export interface MediaError {
  scope: 'video' | 'audio';
  reason: ProbeFailure;
  /** The rejected file's name as picked; shown through `safeFileName`. */
  fileName: string;
  /** True when another file of the same kind was open and stays open. */
  keptOpen: boolean;
  /** Extra context the probe found (HEVC without a decoder); shown after the reason. */
  hint?: ProbeHint;
}

/**
 * What opening a video did, so the editor can say it. Since ADR-026 nothing
 * is placed automatically: the kesit list starts empty and the user marks
 * what to keep; "Videoyu indir" downloads the whole video meanwhile.
 */
export type VideoImportOutcome =
  | { kind: 'rejected' }
  | { kind: 'opened'; lengthUs: Micros; aspect: AspectRatio | null };

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

function rejectionKey(reason: AddClipRejection | MusicRejection): MessageKey {
  return `error.${reason}` as MessageKey;
}

/** The settings the first kesit carries: framing and the video's own sound. */
function settingsOf(project: Project): KesitSettings | null {
  const first = project.clips[0];
  if (!first) return null;
  const { fit, zoom } = currentFraming(project);
  return { fit, zoom, sourceGainDb: first.sourceGainDb, muted: first.muted };
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
  const [importing, setImporting] = useState<'video' | 'audio' | null>(null);
  const [mediaError, setMediaError] = useState<MediaError | null>(null);
  /** Refusals of the kesit actions (add, fine-tune), shown under Başlangıç/Bitiş. */
  const [actionError, setActionError] = useState<MessageKey | null>(null);
  /**
   * Framing and video sound while there is no kesit (ADR-026): they are
   * stored per clip in the recipe, so with an empty list the editor holds
   * them, the whole-video download uses them and the first kesit takes them.
   * Not part of undo; the frame's aspect is (it lives on the canvas).
   */
  const [looseSettings, setLooseSettings] = useState<KesitSettings>(DEFAULT_KESIT_SETTINGS);

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
        setMediaError({ scope: 'video', reason: outcome.reason, fileName: file.name, keptOpen, hint: outcome.hint });
        return { kind: 'rejected' };
      }

      // Opening a video always starts an empty kesit list (the new asset keeps
      // no old kesitler), so the frame follows the video's orientation. Part
      // of the import step: undoing the import restores the previous frame
      // too. Restoring a saved project does not come here and keeps its frame.
      const aspect = aspectForVideo(outcome.handle.displayWidth, outcome.handle.displayHeight);

      setVideo((previous) => {
        previous?.release();
        return outcome.handle;
      });
      setSelectedClipId(null);
      setLooseSettings(DEFAULT_KESIT_SETTINGS);
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
        const replaced = setVideoAsset(current.present, {
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
        });
        const framed =
          aspect && replaced.clips.length === 0 && replaced.canvas.aspect !== aspect
            ? setFraming(replaced, { aspect })
            : replaced;
        return commit(current, framed);
      });
      return { kind: 'opened', lengthUs: outcome.handle.durationUs, aspect };
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
    setLooseSettings(DEFAULT_KESIT_SETTINGS);
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
        setMediaError({ scope: 'video', reason: outcome.reason, fileName: file.name, keptOpen: false, hint: outcome.hint });
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

  const changeFraming = useCallback(
    (framing: { aspect?: AspectRatio; fit?: FitMode; zoom?: number }) => {
      setLooseSettings((current) => ({
        ...current,
        ...(framing.fit ? { fit: framing.fit } : {}),
        ...(framing.zoom !== undefined ? { zoom: framing.zoom } : {}),
      }));
      setHistory((current) => {
        const next = setFraming(current.present, framing);
        return next.revision === current.present.revision ? current : commit(current, next);
      });
    },
    [],
  );

  /** The video's own sound, for every kesit (and for the whole-video download). */
  const changeVideoGain = useCallback((gainDb: number) => {
    setLooseSettings((current) => ({ ...current, sourceGainDb: Math.max(-60, Math.min(0, Math.round(gainDb))) }));
    setHistory((current) => {
      const next = setVideoGain(current.present, gainDb);
      return next === current.present ? current : commit(current, next);
    });
  }, []);

  const changeVideoMuted = useCallback((muted: boolean) => {
    setLooseSettings((current) => ({ ...current, muted }));
    setHistory((current) => {
      const next = setVideoMuted(current.present, muted);
      return next === current.present ? current : commit(current, next);
    });
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

  const settings: KesitSettings = useMemo(() => settingsOf(project) ?? looseSettings, [looseSettings, project]);

  /** "Kesit ekle": the marked range becomes the last kesit. One undo step. */
  const addKesit = useCallback(
    (range: { sourceInUs: Micros; sourceOutUs: Micros }): { ok: true; clipId: string } | { ok: false } => {
      const result = runCommand((base) => addClip(base, range, WEB_LOCAL_POLICY, settingsOf(base) ?? looseSettings));
      if (!result.ok) {
        setActionError(rejectionKey(result.reason));
        return { ok: false };
      }
      setActionError(null);
      const newest = result.project.clips[result.project.clips.length - 1];
      return newest ? { ok: true, clipId: newest.clipId } : { ok: false };
    },
    [looseSettings, runCommand],
  );

  /**
   * Fine-tunes a kesit's start or end (typed, I/O, a handle). `coalesce`
   * folds it into the undo step on top (a held arrow key on a handle).
   * Returns the new recipe, or null when it was refused or changed nothing.
   */
  const editKesit = useCallback(
    (clipId: string, range: { sourceInUs: Micros; sourceOutUs: Micros }, coalesce = false): Project | null => {
      const result = runCommand((base) => {
        const clip = base.clips.find((item) => item.clipId === clipId);
        if (clip && clip.sourceInUs === range.sourceInUs && clip.sourceOutUs === range.sourceOutUs) {
          return { ok: false as const, reason: null };
        }
        return updateClipRange(base, clipId, range, WEB_LOCAL_POLICY);
      }, coalesce);
      if (result.ok) {
        setActionError(null);
        return result.project;
      }
      if (result.reason) setActionError(rejectionKey(result.reason));
      return null;
    },
    [runCommand],
  );

  /** Deletes a kesit. One undo step. */
  const deleteKesit = useCallback(
    (clipId: string): Project | null => {
      setActionError(null);
      // The last kesit's framing and sound stay the editor's settings.
      const kept = settingsOf(project);
      const result = runCommand((base): CommandOutcome => {
        const next = removeClip(base, clipId);
        return next === base ? { ok: false } : { ok: true, project: next };
      });
      if (!result.ok) return null;
      if (result.project.clips.length === 0 && kept) setLooseSettings(kept);
      setSelectedClipId((selected) => (selected === clipId ? null : selected));
      return result.project;
    },
    [project, runCommand],
  );

  /** Moves a kesit in the list (drag or keys). One undo step. */
  const moveKesit = useCallback(
    (clipId: string, toIndex: number) => {
      setActionError(null);
      runCommand((base): CommandOutcome => {
        const next = moveClipTo(base, clipId, toIndex);
        return next === base ? { ok: false } : { ok: true, project: next };
      });
    },
    [runCommand],
  );

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
   * `whole`: there was no kesit, the dialog looked at the whole video as one
   * (ADR-026), and the pieces that remain become the kesitler.
   */
  const cutSilences = useCallback(
    (removals: readonly ClipSilence[], whole: boolean): SilenceCutResult =>
      runCommand((base): SilenceCutResult => {
        if (!whole) return applySilenceCuts(base, removals, WEB_LOCAL_POLICY);
        const withWhole = withWholeKesit(base, settingsOf(base) ?? looseSettings, WEB_LOCAL_POLICY);
        if (!withWhole.ok) return { ok: false, reason: 'nothing_to_remove' };
        return applySilenceCuts(withWhole.project, removals, WEB_LOCAL_POLICY);
      }),
    [looseSettings, runCommand],
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
    setHistory((current) => historyUndo(current));
  }, []);

  const redo = useCallback(() => {
    setActionError(null);
    setHistory((current) => historyRedo(current));
  }, []);

  const asset = primaryVideoAsset(project);
  const framing = useMemo(() => ({ fit: settings.fit, zoom: settings.zoom }), [settings]);
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
    settings,
    importing,
    mediaError,
    clearMediaError: () => setMediaError(null),
    actionError,
    setActionError,
    dirty,
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    undo,
    redo,
    importVideo,
    importAudio,
    dropAudio,
    addKesit,
    editKesit,
    deleteKesit,
    moveKesit,
    changeFraming,
    changeVideoGain,
    changeVideoMuted,
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
