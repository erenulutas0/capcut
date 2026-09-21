'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';

/**
 * Open modals, innermost last. A dialog can open on top of a phone sheet (the
 * caption import dialog); only the top one may react to Escape and Tab,
 * otherwise one Escape would close both and two focus traps would fight.
 */
const openModals: HTMLElement[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  panelClassName: string;
  overlayClassName: string;
}

/**
 * Shared modal behaviour for the export dialog, the help dialog and the mobile
 * sheets: Escape closes, focus moves inside and is trapped, and focus returns
 * to whatever opened it.
 */
function ModalShell({
  open,
  onClose,
  labelledBy,
  children,
  panelClassName,
  overlayClassName,
}: ModalShellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Callers pass inline close handlers, which are new on every render. If the
  // focus effect depended on that identity it would re-run on each parent
  // render, sending focus back to the opener and then to the first control,
  // i.e. out of whatever field the user is typing in.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const first = container?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container)?.focus();

    if (container) openModals.push(container);

    const onKeyDown = (event: KeyboardEvent) => {
      if (container && openModals[openModals.length - 1] !== container) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const at = container ? openModals.lastIndexOf(container) : -1;
      if (at >= 0) openModals.splice(at, 1);
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className={overlayClassName} role="presentation" onClick={onClose} />
      <div
        ref={containerRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}

export function Dialog({
  open,
  onClose,
  labelledBy,
  wide = false,
  stacked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  /** For review lists (silence suggestions) that need more than a form's width. */
  wide?: boolean;
  /**
   * Opened on top of another dialog ("Sorun bildir" from help or export). Its
   * overlay must cover the dialog beneath, which equal z-indexes would not.
   */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      labelledBy={labelledBy}
      overlayClassName={stacked ? 'overlay overlay-stacked' : 'overlay'}
      panelClassName={['dialog', wide ? 'dialog-wide' : '', stacked ? 'dialog-stacked' : ''].filter(Boolean).join(' ')}
    >
      {children}
    </ModalShell>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  id,
  side = 'bottom',
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  id: string;
  side?: 'bottom' | 'right';
  closeLabel: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      labelledBy={headingId}
      overlayClassName="sheet-overlay"
      panelClassName={`sheet ${side === 'bottom' ? 'sheet-bottom' : 'sheet-side'}`}
    >
      <div className="sheet-head">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
    </ModalShell>
  );
}
