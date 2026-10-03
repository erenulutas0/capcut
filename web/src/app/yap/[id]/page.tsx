import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

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
 */
export const dynamicParams = false;

export function generateStaticParams(): Array<{ id: string }> {
  return availableTasks().map((task) => ({ id: task.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const task = taskById((await params).id);
  return { title: task ? `Clip — ${t(task.labelKey)}` : 'Clip' };
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const task = taskById((await params).id);
  if (!task || !task.available) notFound();
  return <TaskWizard taskId={task.id} />;
}
