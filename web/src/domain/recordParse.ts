/**
 * Reading a stored project back (doc 10): out of this browser's database or out of a backup file.
 *
 * Kept apart from projectRecord.ts because it carries the whole recipe validation (validation.ts,
 * migration.ts); the editor's first load does not need it, only a stored project or a backup does,
 * and both are read asynchronously (adapters/projectStore.ts, useProjectPersistence.ts).
 */

import { loadStoredProject } from './migration';
import { PROJECT_RECORD_VERSION, isNewerRecipe, type AssetBinding, type ProjectRecord } from './projectRecord';

export type RecordRejection =
  | 'not_an_object'
  | 'version_unsupported'
  /**
   * The recipe was written by a NEWER build than this one (a higher schema
   * number). Nothing is wrong with it and nothing in it is read: this build
   * must leave it alone — not load it, and not write over it (ADR-043).
   */
  | 'edl_newer'
  | 'edl_invalid'
  | 'bindings_invalid';

export type RecordResult =
  | { ok: true; record: ProjectRecord }
  | { ok: false; reason: RecordRejection };

/**
 * Validates anything coming back out of storage or out of a backup file.
 *
 * Stored data is input like any other: it may be from an older build, a
 * hand-edited backup, or corrupted. A record whose EDL does not validate is
 * rejected rather than loaded into the editor.
 *
 * A record with no kesit is not one of those: a video that was opened and
 * not cut yet is saved like any other project, so it has to open again
 * (`validateStoredProject`). Every other rule is the export's rule.
 */
export function parseRecord(input: unknown): RecordResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'not_an_object' };
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.recordVersion !== PROJECT_RECORD_VERSION) {
    return { ok: false, reason: 'version_unsupported' };
  }

  if (isNewerRecipe(candidate.edl)) return { ok: false, reason: 'edl_newer' };

  // Older builds stored v1 recipes; they are upgraded here, never refused.
  const validation = loadStoredProject(candidate.edl);
  if (!validation.ok) return { ok: false, reason: 'edl_invalid' };

  if (!Array.isArray(candidate.bindings)) return { ok: false, reason: 'bindings_invalid' };
  for (const binding of candidate.bindings) {
    if (typeof binding !== 'object' || binding === null) {
      return { ok: false, reason: 'bindings_invalid' };
    }
    const item = binding as Record<string, unknown>;
    if (
      typeof item.assetId !== 'string' ||
      (item.kind !== 'video' && item.kind !== 'audio') ||
      typeof item.sizeBytes !== 'number' ||
      typeof item.durationUs !== 'number'
    ) {
      return { ok: false, reason: 'bindings_invalid' };
    }
  }

  return {
    ok: true,
    record: {
      recordVersion: PROJECT_RECORD_VERSION,
      projectId: typeof candidate.projectId === 'string' ? candidate.projectId : validation.project.projectId,
      title: typeof candidate.title === 'string' ? candidate.title : '',
      edl: validation.project,
      bindings: candidate.bindings as AssetBinding[],
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    },
  };
}
