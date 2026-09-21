import type { KeyboardEvent } from 'react';

/**
 * Arrow-key movement for a `role="tablist"` (WAI-ARIA tabs pattern).
 *
 * Screen-reader users expect a tab list to be one Tab stop whose tabs are
 * walked with the arrow keys; the tabs therefore use a roving tabIndex (only
 * the selected one is 0). Activation is automatic: showing a panel is cheap
 * and changes nothing in the project. Disabled tabs are skipped.
 */
export function onTablistKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
  );
  const index = tabs.findIndex((tab) => tab === document.activeElement);
  if (index < 0 || tabs.length === 0) return;

  let next: number;
  switch (event.key) {
    case 'ArrowLeft':
      next = (index - 1 + tabs.length) % tabs.length;
      break;
    case 'ArrowRight':
      next = (index + 1) % tabs.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  const target = tabs[next];
  if (!target) return;
  target.focus();
  target.click();
}
