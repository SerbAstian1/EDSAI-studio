import { useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Asset, type Client } from '../../api.js';
import { groupByCollection, readableSize } from '../../screens/Assets.js';

/**
 * Exactly what `scoped.listAssets` decided this session may see — every file
 * here is already approved, because the server never sends an unapproved one
 * to a portal principal. Nothing is filtered again on this side.
 */
export default function FilesSection({ client, canWrite }: { client: Client; canWrite: boolean }): ReactElement {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  const { data: assets, isPending, error } = useQuery({
    queryKey: ['assets', client.id], queryFn: () => api.assets(client.id),
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const done: Asset[] = [];
      for (const file of files) done.push(await api.uploadAsset(client.id, file));
      return done;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['assets', client.id] }); },
  });

  const groups = assets ? groupByCollection(assets) : [];
  const filtered = query.trim()
    ? (assets ?? []).filter((a) => a.filename.toLowerCase().includes(query.trim().toLowerCase()))
    : assets ?? [];

  return (
    <section className="stack">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          <p className="label mono">05</p>
          <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Files &amp; Assets</h1>
          <p className="muted" style={{ maxWidth: '56ch' }}>
            Access and download every project file in one place.
          </p>
        </div>
        {canWrite && (
          <button
            type="button" className="primary" style={{ marginLeft: 'auto' }}
            onClick={() => input.current?.click()} disabled={upload.isPending}
          >
            {upload.isPending ? 'Uploading…' : 'Upload files'}
          </button>
        )}
        <input
          ref={input} type="file" multiple hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) upload.mutate(files);
            e.target.value = '';
          }}
        />
      </div>
      {upload.error && <p className="err">{(upload.error as Error).message}</p>}
      {/*
        An upload arrives unapproved, and this list only ever shows approved
        files — so without this line the file a client just sent vanishes:
        the button returns to rest, the list does not change, and if it was
        empty they read "Nothing shared yet." right after sending something.
      */}
      {upload.isSuccess && upload.data && (
        <p className="pass">
          {upload.data.length === 1 ? 'Sent.' : `${upload.data.length} files sent.`} Your studio
          reviews what arrives before it appears here — nothing is lost in the meantime.
        </p>
      )}

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="err">Could not load files. {(error as Error).message}</p>}

      {assets && assets.length === 0 && (
        <div className="empty">
          <p className="editorial">Nothing shared yet.</p>
          <p>Files your studio approves will appear here.</p>
        </div>
      )}

      {assets && assets.length > 0 && (
        <>
          <div className="project-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {groups.map(([name, group]) => (
              <div key={name} className="card" style={{ marginBottom: 0 }}>
                <strong>{name}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  {group.length} file{group.length === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>

          <div className="row">
            <h3 style={{ margin: 0 }}>All files</h3>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…" style={{ marginLeft: 'auto', maxWidth: 240 }}
              aria-label="Search files"
            />
          </div>

          <table>
            <thead><tr><th>Name</th><th>Kind</th><th>Size</th><th>Added</th><th /></tr></thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id}>
                  <td><strong>{asset.filename}</strong></td>
                  <td className="muted">{asset.kind}</td>
                  <td className="mono">{readableSize(asset.bytes)}</td>
                  <td className="muted">{asset.uploadedAt.slice(0, 10)}</td>
                  <td>
                    <a href={api.downloadPath(asset.id)} download={asset.filename}>
                      <button type="button">Download</button>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
