import { useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Trash2 } from 'lucide-react';
import { api, type Asset } from '../api.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import OverflowMenu from '../components/OverflowMenu.js';

/**
 * Files — the studio's side of what a client downloads.
 *
 * Two things are deliberate here and both are about the same rule: nothing
 * reaches a client because someone forgot.
 *
 * - An upload arrives **unapproved**, and this screen says so plainly rather
 *   than with a subtle badge. Approval is the one action that changes what
 *   another person can see, so it is the one action that looks like a decision.
 * - The studio's view and the client's view are not the same list. What a client
 *   would see is stated on the page, so a designer never has to guess whether a
 *   file is out there.
 *
 * Collections are free text on purpose. They are what a `limited` portal session
 * is scoped to, so a client's agency can be given "logos" and nothing else —
 * which is a per-person answer, not a taxonomy the studio can fix in advance.
 *
 * Renaming a file or moving it between collections was previously only
 * possible through the API directly — the fields existed, nothing on this
 * screen wrote to them. Delete had the same gap the other way: the store
 * could remove a row, but nothing between it and this screen could reach
 * that method at all. Both are wired up now.
 */

const KIND_GLYPH: Record<Asset['kind'], string> = {
  logo: '✦', photography: '◫', video: '▷', font: 'Aa', icon: '◆', illustration: '✎',
  pattern: '▩', texture: '▨', guideline: '▥',
  document: '▤', presentation: '▦', template: '▧', other: '◇',
};

/** In `KIND_GLYPH`'s own order, so the two never drift apart. */
const KINDS = Object.keys(KIND_GLYPH) as Asset['kind'][];

/** Bytes as a person reads them. */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The order a designer looks for things in: unapproved first, then newest. */
export function shelve(assets: readonly Asset[]): Asset[] {
  return [...assets].sort((a, b) => {
    if (a.approved !== b.approved) return a.approved ? 1 : -1;
    return b.uploadedAt.localeCompare(a.uploadedAt);
  });
}

export function groupByCollection(assets: readonly Asset[]): [string, Asset[]][] {
  const groups = new Map<string, Asset[]>();
  for (const asset of shelve(assets)) {
    const key = asset.collection ?? 'Unfiled';
    const existing = groups.get(key);
    if (existing) existing.push(asset);
    else groups.set(key, [asset]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    // Unfiled last: it is the pile, not a collection someone chose.
    if (a === 'Unfiled') return 1;
    if (b === 'Unfiled') return -1;
    return a.localeCompare(b);
  });
}

function AssetRow({ asset, onChanged }: { asset: Asset; onChanged: () => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [filename, setFilename] = useState(asset.filename);
  const [description, setDescription] = useState(asset.description ?? '');
  const [collection, setCollection] = useState(asset.collection ?? '');
  const [kind, setKind] = useState(asset.kind);

  const setApproved = useMutation({
    mutationFn: (approved: boolean) => api.updateAsset(asset.id, { approved }),
    onSuccess: onChanged,
  });

  const save = useMutation({
    mutationFn: () => api.updateAsset(asset.id, {
      filename: filename.trim(), description, collection, kind,
    }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAsset(asset.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    void requestConfirmation({
      title: `Delete ${asset.filename}?`,
      message: 'This removes the file from the studio and the client portal. It cannot be undone.',
      confirmLabel: 'Delete file',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={2}>
          <input value={filename} onChange={(e) => setFilename(e.target.value)}
                 aria-label="Filename" />
          <div className="row" style={{ marginTop: 4, gap: 4 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'])}
                    aria-label="Kind">
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
                   aria-label="Description" placeholder="Description" style={{ flex: 1 }} />
          </div>
        </td>
        <td>
          <input value={collection} onChange={(e) => setCollection(e.target.value)}
                 aria-label="Collection" placeholder="Unfiled" style={{ maxWidth: 140 }} />
        </td>
        <td colSpan={2}><div className="row">
          <button type="button" className="primary" disabled={!filename.trim() || save.isPending}
                  onClick={() => save.mutate()}>Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div></td>
      </tr>
    );
  }

  return (
    <tr>
      <td data-label="File">
        <span>
          <span aria-hidden="true" style={{ marginRight: 8 }}>{KIND_GLYPH[asset.kind]}</span>
          <strong>{asset.filename}</strong>
        </span>
        {asset.description && <div className="muted" style={{ fontSize: 13 }}>{asset.description}</div>}
      </td>
      <td className="muted" data-label="Kind">{asset.kind}</td>
      <td className="mono" data-label="Size">{readableSize(asset.bytes)}</td>
      <td data-label="In the portal">
        {asset.approved
          ? <span className="pill pass">Visible</span>
          : <span className="pill major">Not yet</span>}
      </td>
      <td className="actions">
        <div className="row">
          <button
            type="button"
            className={asset.approved ? '' : 'primary'}
            disabled={setApproved.isPending}
            onClick={() => setApproved.mutate(!asset.approved)}
          >
            {asset.approved ? 'Withdraw' : 'Approve'}
          </button>
          <OverflowMenu label={`Actions for ${asset.filename}`} items={[
            { label: 'Download', icon: Download, onSelect: () => {
              const a = document.createElement('a');
              a.href = api.downloadPath(asset.id);
              a.download = asset.filename;
              a.click();
            } },
            { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true) },
            { label: 'Delete', icon: Trash2, danger: true, disabled: remove.isPending, onSelect: onDelete },
          ]} />
        </div>
      </td>
    </tr>
  );
}

export default function Assets({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [collection, setCollection] = useState('');
  const [dragging, setDragging] = useState(false);

  const { data: assets, isPending, error, refetch } = useQuery({
    queryKey: ['assets', clientId], queryFn: () => api.assets(clientId),
  });

  const invalidate = (): void => {
    // The bare ['assets'] prefix also catches this screen's own
    // ['assets', clientId] key (a query key matches by prefix), and reaches
    // the cross-client Files overview besides — invalidating only the
    // narrower key would leave that overview showing a file this screen just
    // deleted, renamed or newly approved.
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      // Sequential rather than parallel: the failure a designer needs to see is
      // "this file was too large", and `Promise.all` would lose every other
      // result the moment one rejected.
      const done: Asset[] = [];
      for (const file of files) {
        done.push(await api.uploadAsset(
          clientId, file, collection.trim() ? { collection: collection.trim() } : {},
        ));
      }
      return done;
    },
    onSuccess: invalidate,
  });

  const take = (list: FileList | null): void => {
    const files = [...(list ?? [])];
    if (files.length > 0) upload.mutate(files);
  };

  if (isPending) return <p className="muted">Loading files…</p>;
  if (error) {
    return <ErrorPanel title="Could not load files" error={error} onRetry={() => { void refetch(); }} />;
  }

  const approved = assets.filter((asset) => asset.approved).length;
  const waiting = assets.length - approved;

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Files</h3>
        <span className="muted mono">{assets.length}</span>
        {waiting > 0 && <span className="pill major">{waiting} awaiting approval</span>}
      </div>

      <p className="muted">
        {approved === 0
          ? 'Nothing here is visible to the client yet. A file reaches their portal only when you approve it.'
          : `${approved} of ${assets.length} ${approved === 1 ? 'file is' : 'files are'} in the client's portal. The rest are yours alone.`}
      </p>

      <div
        className={`dropzone${dragging ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
      >
        <p className="editorial" style={{ margin: 0 }}>Drop files here</p>
        <p className="muted" style={{ margin: 0 }}>
          Or <button className="link" type="button" onClick={() => input.current?.click()}>
            choose them
          </button>. Up to 25 MB each.
        </p>
        <input
          ref={input} type="file" multiple hidden
          onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        />
        <label className="field" style={{ maxWidth: 320, margin: '0 auto' }}>
          <span className="label">Put them in</span>
          <input
            value={collection} placeholder="Logos, Summer campaign…"
            onChange={(e) => setCollection(e.target.value)}
          />
        </label>
      </div>

      {upload.isPending && <p className="muted">Uploading…</p>}
      {upload.error && <p className="err">{(upload.error as Error).message}</p>}

      {assets.length === 0 ? (
        <div className="empty">
          <p className="editorial">No files yet.</p>
          <p>
            Whatever you put here is what the client downloads — logos, fonts, the
            guidelines PDF. They never get a link to a drive folder.
          </p>
        </div>
      ) : (
        groupByCollection(assets).map(([name, group]) => (
          <div key={name} className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
            <span className="label">{name}</span>
            <table className="stacky">
              <thead>
                <tr><th>File</th><th>Kind</th><th>Size</th><th>In the portal</th><th /></tr>
              </thead>
              <tbody>
                {group.map((asset) => (
                  <AssetRow key={asset.id} asset={asset} onChanged={invalidate} />
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}
