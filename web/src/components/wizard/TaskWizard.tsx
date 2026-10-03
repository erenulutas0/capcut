'use client';

import Link from 'next/link';
import { useState, type ComponentType } from 'react';

import { EditorView } from '@/components/editor/EditorApp';
import { useEditorState } from '@/components/editor/useEditorState';
import { taskById, type TaskId } from '@/domain/tasks';
import { translator } from '@/i18n/messages';
import type { WizardHostProps } from './WizardFlow';
import { WIZARDS } from './wizards';

const t = translator('tr');

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
