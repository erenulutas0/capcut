import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { pageTitle } from '@/appIdentity';
import { TaskWizard } from '@/components/wizard/TaskWizard';
import { availableTasks, taskById } from '@/domain/tasks';
import { translator } from '@/i18n/messages';

import '../../editor.css';
import '../../wizard.css';

const t = translator('tr');

/**
 * `/yap/<id>/`: one page per task that works today (ADR-034). Built ahead of
 * time for exactly those ids — the static export has no server to ask — and
 * kept for offline use by the service worker like every other page. A task
 * that is not available has no page: the opening screen says "Bu henüz yok".
 *
 * Any other id (`/yap/dondur`, `/yap/nope`) is answered by `notFound()` below.
 * There is deliberately no `dynamicParams = false` here: with it, a server
 * (`next start`: the e2e suite, local checks) answers the same 404 but only
 * after throwing — and logging — "Error: Internal: NoFallbackError" for every
 * such request. Without it the unknown id reaches the page, which says 404
 * itself. The static export is the same either way: it holds exactly the
 * pages of `generateStaticParams`, and the host answers 404 for the rest.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return availableTasks().map((task) => ({ id: task.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const task = taskById((await params).id);
  // A task without a page gets the plain name, not its label: the 404 page is not that task.
  return { title: pageTitle(task?.available ? t(task.labelKey) : undefined) };
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const task = taskById((await params).id);
  if (!task || !task.available) notFound();
  return <TaskWizard taskId={task.id} />;
}
