'use client';

import Link from 'next/link';
import { useEffect, useState, type ComponentType } from 'react';

import { useEditorState } from '@/components/editor/useEditorState';
import { PartFailed, lazyPart } from '@/components/LazyPart';
import { taskById, type TaskId } from '@/domain/tasks';
import { translator } from '@/i18n/messages';
import type { WizardHostProps } from './WizardFlow';
import { WIZARDS } from './wizards';

const t = translator('tr');

/** The editor's own chunk: asked for when it is about to be shown, never by a wizard's first screen. */
const loadEditor = () => import('@/components/editor/EditorApp');

/**
 * The editor, over the wizard's state. Its code is not part of a wizard page (10 Oct 2026: every
 * wizard page downloaded the whole editor — 422 KB of script against the opening screen's 193 KB —
 * although nine of the ten wizards show it only after "Daha fazla ayar → editörde aç"). It is loaded
 * when it is first wanted; the service worker holds the chunk like every other file of the build, so
 * this works offline too. While it arrives the screen says so; when it does not arrive the screen says
 * that, with "Tekrar dene" — the wizard's state (the open video, the choice) stays as it is (ADR-044).
 */
const EditorView = lazyPart(() => loadEditor().then((module) => module.EditorView), {
  loading: () => (
    <div className="wizard" data-testid="editor-loading">
      <main className="wizard-main">
        <p className="wizard-panel-title" role="status">
          {t('wizard.editorLoading')}
        </p>
      </main>
    </div>
  ),
  failed: (retry) => (
    <div className="wizard" data-testid="editor-failed">
      <main className="wizard-main">
        <PartFailed t={t} variant="inline" onRetry={retry} />
      </main>
    </div>
  ),
});

/**
 * One task's wizard (`/yap/<id>/`, ADR-034).
 *
 * It owns the recipe and the open files — the editor's own state hook, with
 * no project storage — and shows the task's wizard over it. "Daha fazla ayar
 * → editörde aç" (and "Kes", right after the video is picked) swaps the
 * wizard for the editor over that very state, in place: the same `File`, the
 * same settings, no second file dialog, no navigation that could lose them
 * (a page load cannot carry a `File`, and offline there is no soft
 * navigation to rely on).
 */
export function TaskWizard({ taskId }: { taskId: TaskId }) {
  const state = useEditorState();
  const [inEditor, setInEditor] = useState(false);
  const task = taskById(taskId);
  const Wizard = (WIZARDS as Partial<Record<TaskId, ComponentType<WizardHostProps>>>)[taskId];

  // "Kes" IS the editor (its wizard only picks the video): its chunk is fetched while the user is
  // still choosing a file, after the first screen has been drawn — so the editor opens at once.
  const opensEditor = task?.steps.includes('editor') === true;
  useEffect(() => {
    if (!opensEditor) return undefined;
    const idle = window.setTimeout(() => void loadEditor().catch(() => undefined), 300);
    return () => window.clearTimeout(idle);
  }, [opensEditor]);

  if (!task || !task.available || !Wizard) {
    // Not reachable from the app (no card, no route is built); an honest page all the same.
    return (
      <div className="wizard" data-testid="wizard-unavailable">
        <main className="wizard-main">
          <h1 className="wizard-title">{t('home.results.unavailable')}</h1>
          <Link href="/" prefetch={false} className="btn">
            {t('wizard.backHome')}
          </Link>
        </main>
      </div>
    );
  }

  if (inEditor) return <EditorView state={state} stored={false} />;
  return <Wizard task={task} state={state} onOpenEditor={() => setInEditor(true)} />;
}
