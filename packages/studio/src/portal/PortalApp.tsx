import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, type Client } from '../api.js';
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

  if (session.isPending) {
    return <div className="portal-entry"><p className="muted">Opening your portal…</p></div>;
  }

  if (session.error || !session.data?.client) {
    return (
      <div className="portal-entry">
        <div className="portal-entry-card">
          <p className="editorial">This link is not open.</p>
          <p className="muted">
            {session.error instanceof Error
              ? session.error.message
              : 'Ask the studio for a new link.'}
          </p>
        </div>
      </div>
    );
  }

  return <PortalShell client={session.data.client} role={session.data.role} />;
}
