import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Asset, type Client } from '../api.js';
import { readableSize, shelve } from './Assets.js';

/**
 * Files, across every client.
 *
 * The per-client panel is where the work happens; this is the view that answers
 * the question a designer actually asks between jobs — *what is sitting here
 * unapproved?* So the unapproved files come first and are counted in the
 * heading, rather than being a state you discover by opening each client.
 */

export interface Shelf {
  client: Client;
  assets: Asset[];
  waiting: number;
}

export function shelves(clients: readonly Client[], assets: readonly Asset[]): Shelf[] {
  return clients
    .map((client) => {
      const mine = shelve(assets.filter((asset) => asset.clientId === client.id));
      return { client, assets: mine, waiting: mine.filter((a) => !a.approved).length };
    })
    .filter((shelf) => shelf.assets.length > 0)
    // Anything waiting on the studio first, then the fullest shelf.
    .sort((a, b) => (b.waiting - a.waiting) || (b.assets.length - a.assets.length));
}

export default function FileLibrary(): ReactElement {
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const assets = useQuery({ queryKey: ['assets'], queryFn: api.allAssets });

  if (clients.isPending || assets.isPending) return <p className="muted">Loading files…</p>;
  if (clients.error || assets.error) {
    return (
      <p className="err">
        Could not load files. {((clients.error ?? assets.error) as Error).message}
      </p>
    );
  }

  const shelved = shelves(clients.data, assets.data);
  const waiting = shelved.reduce((total, shelf) => total + shelf.waiting, 0);

  return (
    <section className="stack">
      <div className="row">
        <h2>Files</h2>
        <span className="muted mono">{assets.data.length}</span>
        {waiting > 0 && <span className="pill major">{waiting} awaiting approval</span>}
      </div>

      <p className="muted">
        Everything a client downloads comes from here. Upload against a client, approve
        what is ready, and it appears in their portal — there is no drive link and no
        second place to look.
      </p>

      {shelved.length === 0 ? (
        <div className="empty">
          <p className="editorial">No files anywhere yet.</p>
          <p>Files are uploaded against a client. Open one and drop them in.</p>
          <a href="#/clients"><button>Go to clients</button></a>
        </div>
      ) : (
        shelved.map(({ client, assets: mine, waiting: pending }) => (
          <div key={client.id} className="card stack">
            <div className="row">
              <a href={`#/clients/${client.id}`}><strong>{client.name}</strong></a>
              <span className="muted mono">{mine.length}</span>
              {pending > 0
                ? <span className="pill major">{pending} not yet visible</span>
                : <span className="pill pass">All visible to the client</span>}
            </div>
            <table>
              <thead><tr><th>File</th><th>Collection</th><th>Size</th><th>In the portal</th></tr></thead>
              <tbody>
                {mine.slice(0, 6).map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.filename}</td>
                    <td className="muted">{asset.collection ?? 'Unfiled'}</td>
                    <td className="mono">{readableSize(asset.bytes)}</td>
                    <td>
                      {asset.approved
                        ? <span className="pill pass">Visible</span>
                        : <span className="pill major">Not yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mine.length > 6 && (
              <a href={`#/clients/${client.id}`} className="muted">
                {mine.length - 6} more →
              </a>
            )}
          </div>
        ))
      )}
    </section>
  );
}
