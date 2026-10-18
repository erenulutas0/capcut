'use client';

import { PageCrash } from '@/components/PageCrash';

/** A page that stops with an error: the app's own screen, inside the root layout (components/PageCrash.tsx, ADR-044). */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  return <PageCrash error={error} />;
}
