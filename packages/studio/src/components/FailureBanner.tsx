import { useSyncExternalStore, type ReactElement } from 'react';
import { clearFailure, currentFailure, subscribeToFailures } from '../failures.js';

/**
 * What the last failed write said, for the writes whose own screen says
 * nothing. Dismissed by hand rather than on a timer: a message that removes
 * itself is a message the person who stepped away never sees.
 */
export function FailureBanner(): ReactElement | null {
  const failure = useSyncExternalStore(subscribeToFailures, currentFailure, currentFailure);
  if (!failure) return null;

  return (
    <div className="failure-banner" role="alert">
      <span>{failure.message}</span>
      <button type="button" onClick={clearFailure} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}
