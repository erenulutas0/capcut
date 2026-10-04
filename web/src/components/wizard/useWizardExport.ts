'use client';

import { useCallback } from 'react';

import { taggedFileName } from '@/application/taskRecipes';
import type { Project } from '@/domain/edl';
import type { KesitSettings } from '@/domain/kesit';
import {
  useDownloads,
  type DownloadEntry,
  type ExportExtras,
  type TargetSizePreview,
} from '@/components/editor/useDownloads';
import type { TargetSizeRequest } from '@/domain/targetSize';

/** What a wizard asks the export for. */
export interface WizardExportRequest {
  /** The recipe "İndir" encodes: the wizard's choice already applied. */
  project: Project;
  /** Framing and sound while the recipe has no kesit (the whole video). */
  settings: KesitSettings;
  videoFile: File | null;
  videoName: string | null;
  /** The music file, for "Müzik ekle". */
  audioFile: File | null;
  /** The end of the suggested file name: "tatil_dikey.mp4". */
  fileTag: string;
  /**
   * Extra options of the export request (ADR-034). This is the one place a
   * wizard's options reach the export engine: a new option of
   * `ExportWorkerClient.export` (a size target for "Küçült", audio-only
   * output for "Sesini al") is passed here by that wizard and needs no other
   * change on the way.
   */
  extras?: ExportExtras;
}

/** Every wizard download is "the whole recipe": one key. */
const KEY = 'all';

/**
 * The single road from a wizard to the export engine: the editor's own
 * download hook (`useDownloads`: save dialog inside the click, the capability
 * gate, the fallback route, share, storage and limit refusals) with the
 * wizard's recipe, file name and extra options.
 */
export function useWizardExport(request: WizardExportRequest) {
  const downloads = useDownloads({
    project: request.project,
    settings: request.settings,
    videoFile: request.videoFile,
    audioFile: request.audioFile,
    videoName: request.videoName,
    fileName: request.videoName ? taggedFileName(request.videoName, request.fileTag) : null,
    exportExtras: request.extras,
  });

  const { start: startDownload, dismiss: dismissDownload, share: shareDownload, previewTargetSize } = downloads;
  /** ADR-035: what a target-size download of this recipe would be; encodes nothing. */
  const previewSize = useCallback(
    (target: TargetSizeRequest): Promise<TargetSizePreview> => previewTargetSize({ kind: 'all' }, target),
    [previewTargetSize],
  );
  /** MUST be called synchronously from the click (the save dialog opens inside it). */
  const start = useCallback(() => startDownload({ kind: 'all' }), [startDownload]);
  const dismiss = useCallback(() => dismissDownload(KEY), [dismissDownload]);
  const share = useCallback(() => shareDownload(KEY), [shareDownload]);

  const entry: DownloadEntry | null = downloads.entries[KEY] ?? null;
  return {
    entry,
    busy: downloads.activeKey !== null,
    start,
    cancel: downloads.cancel,
    dismiss,
    share,
    /** The capability report of the background check, once it is known. */
    capability: downloads.capability,
    previewSize,
  };
}

export type WizardExport = ReturnType<typeof useWizardExport>;
