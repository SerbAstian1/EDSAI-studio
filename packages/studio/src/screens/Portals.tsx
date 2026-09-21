import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Run } from '../api.js';
import { brandsFrom } from './Brands.js';

/**
 * Portals — the client-facing side of a brand.
 *
 * Two different things have been called a portal here, and this screen used
 * to show only the one that does not work yet: `@edsai/hub`'s static brand
 * page, which builds from a terminal and publishes nowhere. Meanwhile the
 * portal a client actually opens — a capability link issued from their own
 * page — had no studio-wide view at all.
 *
 * So the live links lead, and the generator keeps its honest note at the
 * bottom rather than standing in for the feature.
 */

function daysLeft(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

export default function Portals(): ReactElement {
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const keys = useQuery({ queryKey: ['portal-keys'], queryFn: api.allPortalKeys });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });

  if (runs.isPending || keys.isPending) return <p className="muted">Loading portals…</p>;
  if (runs.error || keys.error) {
    return (
      <p className="err">
        Could not load portals. {((runs.error ?? keys.error) as Error).message}
      </p>
    );
  }

  const clientName = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
  const live = [...keys.data].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const publishable: Run[] = brandsFrom(runs.data);

  return (
    <section className="stack">
      <div className="row">
        <h2>Portals</h2>
        <span className="muted mono">{live.length}</span>
      </div>
      <p className="muted">
        A portal is where a client's brand lives. One page, every value carrying the
        instrument that measured it — which is the claim no hosted-guidelines product
        can make without building the instruments first.
      </p>

      {live.length === 0 ? (
        <div className="empty">
          <p className="editorial">No client has a link yet.</p>
          <p>
            A portal opens from a link you issue on a client's own page — no account for
            them to make, no password to remember. Open a client and look under Portal
            access.
          </p>
          <a href="#/clients"><button className="primary">Go to clients</button></a>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Given to</th><th>Client</th><th>Opens</th><th>Use</th><th>Expires</th></tr>
          </thead>
          <tbody>
            {live.map((key) => {
              const left = daysLeft(key.expiresAt);
              return (
                <tr key={key.id}>
                  <td><strong>{key.label}</strong></td>
                  <td>
                    <a href={`#/clients/${key.clientId}`}>
                      {clientName.get(key.clientId) ?? key.clientId}
                    </a>
                  </td>
                  <td className="muted">
                    {key.collections && key.collections.length > 0
                      ? key.collections.join(', ')
                      : 'Everything approved'}
                  </td>
                  <td className="muted">
                    {key.lastUsedAt
                      ? `${key.uses} time${key.uses === 1 ? '' : 's'}`
                      : 'Never opened'}
                  </td>
                  <td>
                    {left <= 7
                      ? <span className="pill major">{left} day{left === 1 ? '' : 's'} left</span>
                      : <span className="muted">{left} days left</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="card">
        <span className="label">The published brand page, separately</span>
        <p className="muted" style={{ marginTop: 8 }}>
          A run that clears the gate can also be built into a standalone brand page.
          That generator exists and is tested, but it runs from a terminal and publishes
          nowhere yet — no hosting, no custom domain, nothing to press here.
          {publishable.length > 0
            ? ` ${publishable.length} run${publishable.length === 1 ? ' has' : 's have'} cleared the gate and would build.`
            : ' No run has cleared the gate yet, so nothing would build today.'}
        </p>
      </div>
    </section>
  );
}
