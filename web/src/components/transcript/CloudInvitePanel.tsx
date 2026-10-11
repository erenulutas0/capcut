'use client';

import { useState, useSyncExternalStore } from 'react';

import { readInvite, removeInvite, subscribeInvite } from '@/adapters/cloud/inviteStore';

export interface CloudInviteWords {
  present: string;
  absent: string;
  remove: string;
  removed: string;
}

/**
 * The privacy page's control over the saved invite code (ADR-039): whether
 * one is kept in this browser, and the button that removes it. The words
 * come from the page (it knows its language); the code itself is never shown.
 */
export default function CloudInvitePanel({ words, buttonClassName }: { words: CloudInviteWords; buttonClassName: string }) {
  const invite = useSyncExternalStore(subscribeInvite, readInvite, () => null);
  const [removed, setRemoved] = useState(false);
  return (
    <div className="help-model" data-testid="invite-storage">
      <p className="export-log-note" role="status" data-testid="invite-storage-status" data-saved={invite !== null}>
        {invite !== null ? words.present : removed ? words.removed : words.absent}
      </p>
      {invite !== null ? (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => {
            removeInvite();
            setRemoved(true);
          }}
          data-testid="invite-storage-remove"
        >
          {words.remove}
        </button>
      ) : null}
    </div>
  );
}
