import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Asset } from '../api.js';
import AssetMenu from '../components/AssetMenu.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { readableSize } from './Assets.js';

/**
 * Reusable artwork, across every client — the one filter on top of Files that
 * answers "is there already something to start from" without opening each
 * client in turn.
 *
 * Deliberately not a second entity. A template is a file like any other —
 * uploaded, approved, downloaded the same way — the only thing that makes
 * one a template is its `kind`, set from a file's own edit form on the
 * client's Files panel. Building a parallel upload path here would mean two
 * places a file's kind could go out of sync with what it actually is.
 */

export default function Templates(): ReactElement {
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const assets = useQuery({ queryKey: ['assets'], queryFn: api.allAssets });

  if (clients.isPending || assets.isPending) return <p className="muted">Loading templates…</p>;
  if (clients.error || assets.error) {
    return (
      <ErrorPanel
        title="Could not load templates"
        error={clients.error ?? assets.error}
        onRetry={() => {
          void clients.refetch();
          void assets.refetch();
        }}
      />
    );
  }

  const clientName = new Map(clients.data.map((client) => [client.id, client.name]));
  const templates = assets.data
    .filter((asset): asset is Asset => asset.kind === 'template')
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return (
    <section className="stack">
      <div className="row">
        <h2>Templates</h2>
        <span className="muted mono">{templates.length}</span>
      </div>

      <p className="muted">
        Artwork worth reusing, gathered from every client's own files — a moodboard shell, a
        deck layout, a pattern someone will want to start from again. Mark any file as a
        template from its edit form on a client's own Files panel, and it shows up here.
      </p>

      {templates.length === 0 ? (
        <div className="empty">
          <p className="editorial">Nothing marked as a template yet.</p>
          <p>
            Open a file on any <a href="#/clients">client's</a> page, edit it, and set its
            kind to "template".
          </p>
        </div>
      ) : (
        <table className="stacky">
          <thead>
            <tr><th>File</th><th>Client</th><th>Collection</th><th>Size</th><th /></tr>
          </thead>
          <tbody>
            {templates.map((asset) => (
              <tr key={asset.id}>
                <td data-label="File">
                  <strong>{asset.filename}</strong>
                  {asset.description && (
                    <div className="muted" style={{ fontSize: 13 }}>{asset.description}</div>
                  )}
                </td>
                <td data-label="Client">
                  <a href={`#/clients/${asset.clientId}`}>
                    {clientName.get(asset.clientId) ?? asset.clientId}
                  </a>
                </td>
                <td className="muted" data-label="Collection">{asset.collection ?? 'Unfiled'}</td>
                <td className="mono" data-label="Size">{readableSize(asset.bytes)}</td>
                <td className="actions"><AssetMenu asset={asset} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
