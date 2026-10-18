import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TaskWizard } from '@/components/wizard/TaskWizard';
import { taskMetadata, taskStaticParams } from '@/components/wizard/taskPage';
import { taskById } from '@/domain/tasks';
import '@/i18n/messages.en';

import '../../../../editor.css';
import '../../../../wizard.css';

/** `/en/yap/<id>/`: a task's wizard in English (ADR-048); the Turkish route explains the rest. */
export function generateStaticParams(): Array<{ id: string }> {
  return taskStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return taskMetadata(params, 'en');
}

export default async function EnglishTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const task = taskById((await params).id);
  if (!task || !task.available) notFound();
  return <TaskWizard taskId={task.id} />;
}
