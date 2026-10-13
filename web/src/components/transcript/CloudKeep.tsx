'use client';

import { useEffect, useRef, useState } from 'react';

import { safeFileName } from '@/adapters/browserMedia';
import { createIndexedDbStore } from '@/adapters/projectStore';
import { Icon } from '@/components/Icon';
import { Dialog } from '@/components/editor/Dialog';
import { handoffAction, storedProjectName, type StoredProbe } from '@/domain/wizardHandoff';
import { cloudTranslator } from '@/i18n/cloudMessages';

const ct = cloudTranslator('tr');

export interface CloudKeepProps {
  /** The id the browser's one stored project is kept under (the recipe's own). */
  projectId: string;
  /** The editor opens: `stored` true makes this work the stored project, false leaves the store alone. */
  onDecide: (stored: boolean) => void;
  /** "Vazgeç": back to the result screen, nothing changed. */
  onClose: () => void;
}

/**
 * "Daha fazla ayar → editörde aç" over a transcript written on the internet
 * (ADR-034 addendum, 13 Oct 2026): the work becomes the browser's stored
 * project, so a reload does not lose what the user spent minutes on.
 *
 * The store holds one project (ADR-012). This part looks first:
 * - nothing stored, or only a video that was opened and not worked on: the
 *   editor opens as the stored project, with no question;
 * - a project with work in it: nothing is replaced until the user says which
 *   one stays — two buttons, each saying what it costs, and "Vazgeç";
 * - a store that cannot be read: the editor opens and its own header says
 *   what happened to the saving (`domain/wizardHandoff.ts`).
 *
 * It exists only in a build that has the cloud route (loaded by `YaziWizard`
 * behind the same build literal as the route itself).
 */
export default function CloudKeep({ projectId, onDecide, onClose }: CloudKeepProps) {
  const [existing, setExisting] = useState<{ name: string } | null>(null);
  const decide = useRef(onDecide);
  useEffect(() => {
    decide.current = onDecide;
  }, [onDecide]);

  useEffect(() => {
    let current = true;
    void createIndexedDbStore()
      .load(projectId)
      .then((result) => {
        if (!current) return;
        const probe: StoredProbe = !result.ok
          ? { kind: 'unreadable', reason: result.reason }
          : result.record
            ? { kind: 'project', record: result.record }
            : { kind: 'empty' };
        if (handoffAction(true, probe) === 'ask' && probe.kind === 'project') setExisting({ name: storedProjectName(probe.record) });
        else decide.current(true);
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  // While the store is asked (a few milliseconds) nothing is shown: the result screen stays as it is.
  if (!existing) return null;

  return (
    <Dialog open onClose={onClose} labelledBy="cloud-keep-title">
      <div className="dialog-head">
        <h2 id="cloud-keep-title">{ct('cloud.keep.title')}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={ct('cloud.keep.cancel')} data-testid="cloud-keep-cancel">
          <Icon name="close" />
        </button>
      </div>
      <div data-testid="cloud-keep">
        {existing.name ? (
          <p className="field-label" data-testid="cloud-keep-name">
            {ct('cloud.keep.named').replace('{name}', safeFileName(existing.name, 48))}
          </p>
        ) : null}
        <p>{ct('cloud.keep.body')}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => onDecide(false)} data-testid="cloud-keep-old">
            {ct('cloud.keep.old')}
          </button>
          <button type="button" className="btn btn-accent" onClick={() => onDecide(true)} data-testid="cloud-keep-new">
            {ct('cloud.keep.new')}
          </button>
        </div>
        <p className="hint-small">{ct('cloud.keep.hint')}</p>
      </div>
    </Dialog>
  );
}
