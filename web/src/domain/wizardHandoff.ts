/**
 * What becomes of a wizard's work when the editor opens over it (ADR-034, addendum of 13 Oct 2026).
 *
 * A wizard never stores a project, and neither does the editor it opens — with ONE exception: a
 * transcript ("Yazıya dök", ADR-036 on this device, ADR-039 on the internet). The user waited minutes
 * for it — and for the internet one spent invited minutes and sent the sound of their video to another
 * company; losing it to a reload is not a small loss. So that hand-over makes the work the browser's
 * stored project (the cloud one since the morning of 13 Oct 2026, the on-device one since that evening).
 *
 * The store holds one project (ADR-012). What is already there is never written over without the user
 * saying so — this file is that rule, kept pure so it can be tested without a browser.
 */

import type { ProjectRecord } from './projectRecord';

/** What the browser's store answered when it was asked for the stored project. */
export type StoredProbe =
  /** The store answered, and holds nothing. */
  | { kind: 'empty' }
  /** A project that opens in this build. */
  | { kind: 'project'; record: ProjectRecord }
  /**
   * The store did not give a project this build can open: it could not be reached, the row is not a
   * project, or it is a newer build's. `reason` is the store's own word for it.
   */
  | { kind: 'unreadable'; reason: string };

export type HandoffAction =
  /** As every other wizard: the editor opens, nothing is read from or written to the store. */
  | 'unsaved'
  /** The editor opens as the stored project; nothing of the user's is replaced by that. */
  | 'store'
  /** A project with work in it is stored already: the user chooses, in words, which one is kept. */
  | 'ask';

/**
 * True when the stored project holds something the user made: a kesit, subtitle or transcript lines,
 * music, or a name. The editor asks before a new video replaces kesitler or subtitles
 * (`sources.replaceWarning`); music and the name survive that step there, but would not survive being
 * replaced by another project, so they count here too.
 *
 * A video that was only opened (ADR-012's record with no kesit) is not work: `/editor` itself replaces
 * such a record without asking when another video is opened.
 */
export function storedProjectHasWork(record: ProjectRecord): boolean {
  const { edl } = record;
  return edl.clips.length > 0 || edl.captionTracks.length > 0 || edl.music !== undefined || record.title.trim() !== '';
}

/** The stored project in the user's own words: the name they gave it, else its video's file name, else nothing. */
export function storedProjectName(record: ProjectRecord): string {
  const title = record.title.trim();
  if (title !== '') return title;
  const video = record.bindings.find((binding) => binding.kind === 'video');
  return typeof video?.fileName === 'string' ? video.fileName : '';
}

/**
 * The rule. `keep`: the recipe carries something worth storing (today: a transcript with lines in it,
 * whichever way it was written). Every other hand-over stays unsaved, whatever the store holds.
 *
 * An unreadable store is not asked about: the editor's own saving meets it and tells the truth in its
 * header — "Düzenleme saklanamadı" with the reason when the store cannot be written, and for a NEWER
 * build's project it neither opens nor writes over it (ADR-043). A row that is not a project is
 * replaced, as `/editor` does today.
 */
export function handoffAction(keep: boolean, probe: StoredProbe): HandoffAction {
  if (!keep) return 'unsaved';
  if (probe.kind === 'project' && storedProjectHasWork(probe.record)) return 'ask';
  return 'store';
}
