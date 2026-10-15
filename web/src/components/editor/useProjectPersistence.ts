'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { BACKUP_DEFAULT_BASENAME, BACKUP_FILE_SUFFIX } from '@/appIdentity';
import { createIndexedDbStore, type StoreFailure } from '@/adapters/projectStore';
import type { Project } from '@/domain/edl';
import {
  createRecord,
  type AssetBinding,
  type ProjectRecord,
} from '@/domain/projectRecord';

/** doc 10: "Önerilen debounce 500 ms". */
const SAVE_DEBOUNCE_MS = 500;

export type SaveState =
  /** Nothing worth saving yet. */
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** A save was attempted and refused; the user must be told. */
  | { kind: 'failed'; reason: StoreFailure };

interface Args {
  project: Project;
  title: string;
  bindings: AssetBinding[];
  onRestore: (record: ProjectRecord) => void;
  /**
   * False for work that came from a task wizard (ADR-034: a wizard never
   * stores a project): nothing is read from or written to the browser's
   * store, so the project kept from the editor stays as it was. The backup
   * file still works. Fixed for the component's life.
   */
  enabled?: boolean;
  /**
   * True when this recipe TAKES the stored project's place instead of being
   * replaced by it: the editor opened from "Yazıya dök" over a transcript
   * written on the internet (ADR-034 addendum, 13 Oct 2026). What the store
   * holds is not loaded into the editor; this recipe is written at once. The
   * caller has already made sure nothing of the user's is replaced unasked
   * (`domain/wizardHandoff.ts`). A NEWER build's project is still left alone.
   * Fixed for the component's life.
   */
  adopt?: boolean;
}

/**
 * Autosave and restore for the local project (doc 10, doc 11).
 *
 * Deliberate limits, all of them visible to the user rather than hidden:
 * - only the recipe is stored, never media;
 * - a failed save is surfaced, never retried silently into a "saved" state;
 * - "saved" means a transaction committed in THIS browser, which can still be
 *   cleared or evicted. The UI copy says exactly that.
 */
export function useProjectPersistence({ project, title, bindings, onRestore, enabled = true, adopt = false }: Args) {
  const storeRef = useRef(createIndexedDbStore());
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [restored, setRestored] = useState(false);
  const [loadFailure, setLoadFailure] = useState<StoreFailure | null>(null);
  /** This browser holds this project now (restored, or a save committed): "Kayıtlı projeyi sil" has something to delete. */
  const [hasStoredRecord, setHasStoredRecord] = useState(false);
  /**
   * The user deleted the stored project in this tab (ADR-012 addendum, 14 Oct 2026): nothing of this tab
   * is written any more, and the header says so ("Bu düzenleme saklanmıyor") until the page is opened again.
   */
  const [forgotten, setForgotten] = useState(false);

  // The save loop reads the latest values through a ref so that typing in the
  // title field does not reschedule the timer on every keystroke.
  const latest = useRef({ project, title, bindings });
  useEffect(() => {
    latest.current = { project, title, bindings };
  }, [project, title, bindings]);

  const createdAtRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  // Set by `forget`: the user deleted the stored project, so neither the
  // autosave timer nor the flush on leaving the page may write it back.
  const forgottenRef = useRef(false);
  // Set when the stored project turned out to be a NEWER build's (ADR-043):
  // this older copy of the app cannot read it and must not write over it.
  const newerRef = useRef(false);

  const persist = useCallback(async (): Promise<void> => {
    if (!enabled || forgottenRef.current) return;
    if (newerRef.current) {
      // Said, not done: the work in this tab is not stored, and the badge offers the backup file.
      setSaveState({ kind: 'failed', reason: 'newer' });
      return;
    }
    const { project: current, title: currentTitle, bindings: currentBindings } = latest.current;
    if (current.clips.length === 0 && currentBindings.length === 0 && currentTitle === '') {
      return;
    }

    setSaveState({ kind: 'saving' });
    const record = createRecord(current.projectId, currentTitle, current, currentBindings);
    if (createdAtRef.current) record.createdAt = createdAtRef.current;
    else createdAtRef.current = record.createdAt;

    const result = await storeRef.current.save(record);
    if (forgottenRef.current) {
      // Deleted while this write was on its way: the delete wins. The write is undone (the store keeps one
      // project under a fixed id, so this is the same record) and nothing says "saved".
      if (result.ok) await storeRef.current.remove(current.projectId);
      setSaveState({ kind: 'idle' });
      return;
    }
    if (result.ok) setHasStoredRecord(true);
    setSaveState(result.ok ? { kind: 'saved', at: Date.now() } : { kind: 'failed', reason: result.reason });
  }, [enabled]);

  // --- restore, once ------------------------------------------------------
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      const result = await storeRef.current.load(project.projectId);
      if (cancelled) return;

      if (!result.ok) {
        if (result.reason === 'newer') {
          newerRef.current = true;
          setSaveState({ kind: 'failed', reason: 'newer' });
        }
        setLoadFailure(result.reason);
        setRestored(true);
        restoredRef.current = true;
        // Adopting: the write is tried now, so the header says at once whether this work is stored
        // (it is not when the store cannot be written, or holds a newer build's project).
        if (adopt) void persist();
        return;
      }
      if (adopt) {
        // This recipe is the project now. Written at once, not after the debounce: the user was just
        // told it would be kept.
        setRestored(true);
        restoredRef.current = true;
        void persist();
        return;
      }
      if (result.record) {
        createdAtRef.current = result.record.createdAt;
        setHasStoredRecord(true);
        onRestore(result.record);
        setSaveState({ kind: 'saved', at: new Date(result.record.updatedAt).getTime() });
      }
      setRestored(true);
      restoredRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // Runs once for the session's project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- debounced autosave -------------------------------------------------
  const revision = project.revision;
  const bindingCount = bindings.length;
  useEffect(() => {
    if (!restored) return undefined;
    const timer = window.setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [restored, revision, title, bindingCount, persist]);

  // --- best-effort flush when the tab goes away ---------------------------
  useEffect(() => {
    const flush = () => {
      if (!restoredRef.current) return;
      // Best effort only: the browser may kill the page before this resolves,
      // which is why the UI never promises zero loss.
      void persist();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist]);

  /**
   * Warns only about work that is really at risk: a write still in flight, or
   * one the browser refused. A saved project needs no warning, and the browser
   * decides whether to show this at all — we never promise recovery.
   */
  // Not for 'newer': there the way out IS reloading the page, and nothing was refused that a retry could save.
  const atRisk = saveState.kind === 'saving' || (saveState.kind === 'failed' && saveState.reason !== 'newer');
  useEffect(() => {
    if (!atRisk) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [atRisk]);

  /** Recovery path required by doc 10 when saving fails. */
  const downloadBackup = useCallback(() => {
    const { project: current, title: currentTitle, bindings: currentBindings } = latest.current;
    const record = createRecord(current.projectId, currentTitle, current, currentBindings);
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const safeTitle = (currentTitle || BACKUP_DEFAULT_BASENAME).replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim();
    anchor.download = `${safeTitle || BACKUP_DEFAULT_BASENAME}${BACKUP_FILE_SUFFIX}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Reads a backup file back in. Validated like any other untrusted input. */
  const importBackup = useCallback(
    async (file: File): Promise<{ ok: true } | { ok: false; reason: string }> => {
      try {
        const text = await file.text();
        const { parseRecord } = await import('@/domain/recordParse');
        const parsed = parseRecord(JSON.parse(text));
        if (!parsed.ok) return { ok: false, reason: parsed.reason };
        createdAtRef.current = parsed.record.createdAt;
        onRestore(parsed.record);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'not_an_object' };
      }
    },
    [onRestore],
  );

  /**
   * "Kayıtlı projeyi sil": deletes the stored project. True when it is gone. From then on this tab writes
   * nothing — not the 500 ms timer, not the flush on leaving (ADR-012 addendum: a deleted project is not
   * written back); the work on screen stays until the page closes. Not deleted: saving goes on as before.
   */
  const forget = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    forgottenRef.current = true;
    const result = await storeRef.current.remove(latest.current.project.projectId);
    // Not deleted: saving goes on, so the header keeps telling the truth.
    if (!result.ok) {
      forgottenRef.current = false;
      return false;
    }
    // The user deleted the stored project themselves: there is nothing newer left to protect.
    newerRef.current = false;
    setSaveState({ kind: 'idle' });
    setHasStoredRecord(false);
    setForgotten(true);
    return true;
  }, [enabled]);

  return { saveState, restored, loadFailure, hasStoredRecord, forgotten, downloadBackup, importBackup, forget, persist };
}
