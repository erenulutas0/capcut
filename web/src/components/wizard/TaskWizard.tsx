'use client';

import Link from 'next/link';
import { useEffect, useState, type ComponentType } from 'react';

import { BASE_PATH } from '@/basePath';
import { useEditorState } from '@/components/editor/useEditorState';
import { PartFailed, lazyPart } from '@/components/LazyPart';
import { taskById, type TaskId } from '@/domain/tasks';
import { useLocale, useT } from '@/i18n/locale';
import { localizedPath } from '@/i18n/localePath';
import type { Locale } from '@/i18n/translate';
import type { EditorHandoff, WizardHostProps } from './WizardFlow';
import { WIZARDS } from './wizards';

/** The editor's own chunk: asked for when it is about to be shown, never by a wizard's first screen. */
const loadEditor = () => import('@/components/editor/EditorApp');

function EditorLoading() {
  const t = useT();
  return (
    <div className="wizard" data-testid="editor-loading">
      <main className="wizard-main">
        <p className="wizard-panel-title" role="status">
          {t('wizard.editorLoading')}
        </p>
      </main>
    </div>
  );
}

function EditorFailed({ retry }: { retry: () => void }) {
  const t = useT();
  return (
    <div className="wizard" data-testid="editor-failed">
      <main className="wizard-main">
        <PartFailed t={t} variant="inline" onRetry={retry} />
      </main>
    </div>
  );
}

/**
 * The editor, over the wizard's state. Its code is not part of a wizard page (10 Oct 2026: every
 * wizard page downloaded the whole editor — 422 KB of script against the opening screen's 193 KB —
 * although nine of the ten wizards show it only after "Daha fazla ayar → editörde aç"). It is loaded
 * when it is first wanted; the service worker holds the chunk like every other file of the build, so
 * this works offline too. While it arrives the screen says so; when it does not arrive the screen says
 * that, with "Tekrar dene" — the wizard's state (the open video, the choice) stays as it is (ADR-044).
 */
const EditorView = lazyPart(() => loadEditor().then((module) => module.EditorView), {
  loading: () => <EditorLoading />,
  failed: (retry) => <EditorFailed retry={retry} />,
});

/**
 * The address bar says `/editor` from here on, without loading a page (the open `File` cannot survive
 * one). Only the address changes: what is on screen is already the editor. With or without the
 * trailing slash, as the page was served (the static export serves folders).
 */
function showEditorAddress(locale: Locale): void {
  try {
    const slash = window.location.pathname.endsWith('/') ? '/' : '';
    // The editor of the page's language (ADR-048): `/en/editor` from an English wizard.
    window.history.replaceState(null, '', `${BASE_PATH}${localizedPath('/editor', locale)}${slash}`);
  } catch {
    // An address that could not be changed loses nothing now: the project is stored either way, and
    // "Kendim düzenleyeceğim" on the opening screen opens it.
  }
}

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
 *
 * That editor stores nothing — except when the wizard asks for it (`stored`, ADR-034 addendum of
 * 13 Oct 2026: "Yazıya dök" over a transcript, however it was written). Then the recipe becomes the
 * browser's stored project, and the address becomes the editor's own: the stored project lives at
 * `/editor`, so a reload must land there, not on the wizard's "Videonu seç".
 */
export function TaskWizard({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const locale = useLocale();
  const state = useEditorState();
  const [editor, setEditor] = useState<EditorHandoff | null>(null);
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
          <Link href={localizedPath('/', locale)} prefetch={false} className="btn">
            {t('wizard.backHome')}
          </Link>
        </main>
      </div>
    );
  }

  if (editor) return <EditorView state={state} stored={editor.stored} adopt={editor.stored} />;
  return (
    <Wizard
      task={task}
      state={state}
      onOpenEditor={(handoff) => {
        const stored = handoff?.stored === true;
        if (stored) showEditorAddress(locale);
        setEditor({ stored });
      }}
    />
  );
}
