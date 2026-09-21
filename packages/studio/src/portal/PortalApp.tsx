import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSyncExternalStore, type ReactElement } from 'react';
import { api, ApiError, type Client } from '../api.js';
import { sessionHasLapsed, subscribeToLapse } from '../lapsed.js';
import { PortalShell } from './PortalShell.js';

/**
 * The client-facing portal, entered from a link the studio issued.
 *
 * One call redeems the token into an ordinary portal session — the same
 * session, the same cookie, the same `ScopedStore` boundary the studio's own
 * screens go through. Everything past this point is the real API, not a
 * client-only preview of it.
 */

export default function PortalApp({ token }: { token: string }): ReactElement {
  const session: UseQueryResult<{ client?: Client; role: string }> = useQuery({
    queryKey: ['portal-session', token],
    queryFn: () => api.portalSession(token),
    retry: false,
    staleTime: Infinity,
  });

  // A link can lapse mid-visit, and every section fetches on its own — so
  // the answer belongs here, once, rather than seven times in the API's own
  // words further down.
  const lapsed = useSyncExternalStore(subscribeToLapse, sessionHasLapsed, sessionHasLapsed);

  if (session.isPending) {
    return <div className="portal-entry"><p className="muted">Opening your portal…</p></div>;
  }

  if (lapsed) {
    return (
      <div className="portal-entry">
        <div className="portal-entry-card">
          <p className="editorial">This link has lapsed.</p>
          <p className="muted">
            Links expire so that one that goes astray does not stay open forever. Ask the
            studio for a fresh one and everything here will be where you left it.
          </p>
        </div>
      </div>
    );
  }

  if (session.error || !session.data?.client) {
    // The server's refusals are written for a client to read ("That link has
    // expired or been revoked"). Anything else — a 500, a dropped connection
    // — is not, so it does not get repeated verbatim.
    const refused = session.error instanceof ApiError && session.error.status === 401;
    return (
      <div className="portal-entry">
        <div className="portal-entry-card">
          <p className="editorial">This link is not open.</p>
          <p className="muted">
            {refused
              ? (session.error as ApiError).message
              : 'Something went wrong reaching the studio. Try again in a moment, or ask '
                + 'them for a fresh link.'}
          </p>
        </div>
      </div>
    );
  }

  return <PortalShell client={session.data.client} role={session.data.role} />;
}
