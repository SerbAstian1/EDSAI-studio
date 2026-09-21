/**
 * Whether the session behind this page has stopped being accepted.
 *
 * A portal link is a capability with an expiry, and it can lapse in the
 * middle of a visit. Every portal section fetches independently, so a lapse
 * used to surface as seven simultaneous copies of the API's own words —
 * "This endpoint needs a session. Sign in at POST /api/session." — to a
 * client who has no account and no idea what an endpoint is.
 *
 * One 401 anywhere sets this, and the portal answers it once, as a whole
 * screen. Same external-store shape as `failures.ts`, and for the same
 * reason: the `QueryCache` callback that sets it runs outside React.
 */

let lapsed = false;
const listeners = new Set<() => void>();

export function reportLapsedSession(): void {
  if (lapsed) return;
  lapsed = true;
  for (const listener of listeners) listener();
}

export function subscribeToLapse(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function sessionHasLapsed(): boolean {
  return lapsed;
}
