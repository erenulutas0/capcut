'use client';

import { lazyPart } from '@/components/LazyPart';
import type { CloudInviteWords } from './CloudInvitePanel';

/**
 * Where the privacy page shows the saved invite code's control — in a build
 * that has the cloud transcript route (ADR-039). In every other build this
 * renders nothing and the panel's code is not in the build at all (the
 * comparison is written out against the literal the build inlines, so the
 * bundler drops the import with it).
 */
const Panel = process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1'
  ? lazyPart<{ words: CloudInviteWords; buttonClassName: string }>(() => import('./CloudInvitePanel').then((module) => module.default), { variant: 'inline' })
  : null;

export function CloudInviteSlot(props: { words: CloudInviteWords; buttonClassName: string }) {
  return Panel ? <Panel {...props} /> : null;
}
