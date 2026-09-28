import { useSyncExternalStore, type ReactElement } from 'react';
import { clearNotice, currentNotice, subscribeToNotices } from '../notices.js';

/**
 * What the last successful write did, for the writes whose own screen has
 * nothing left to show afterwards.
 *
 * `status="polite"` rather than `alert`: this is a confirmation, and an
 * `alert` interrupts whatever a screen reader is in the middle of saying. It
 * clears itself on a timer, unlike the failure banner, because a confirmation
 * that outlives the moment it confirmed stops being information.
 */
export function NoticeBanner(): ReactElement | null {
  const notice = useSyncExternalStore(subscribeToNotices, currentNotice, currentNotice);
  if (!notice) return null;

  return (
    <div className="notice-banner" role="status">
      <span>{notice.message}</span>
      <button type="button" onClick={clearNotice} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}
