import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, PenTool, Pencil, Trash2 } from 'lucide-react';
import { api, type Deliverable } from '../api.js';
import FigmaEmbed, { isFigmaUrl } from '../components/FigmaEmbed.js';

/**
 * What the studio owes this client, one named thing at a time.
 *
 * Status moves in one direction inside this panel: pending → in progress →
 * delivered. The client's own portal reads this same list — nothing here is
 * restated for their side, so a status set once is correct on both.
 *
 * A deliverable that lives in Figma carries its file URL and previews in
 * place, here and in the portal. The preview is collapsed by default in the
 * studio: this table is for scanning status, and a viewer per row would bury
 * it.
 */

const FIGMA_HINT = 'Only figma.com links can be previewed.';

const KINDS: { value: Deliverable['kind']; label: string }[] = [
  { value: 'document', label: 'Document' },
  { value: 'presentation', label: 'Presentation' },
  { value: 'planning', label: 'Planning / Strategy' },
  { value: 'data', label: 'Data / Insights' },
  { value: 'design-assets', label: 'Design Assets' },
  { value: 'development', label: 'Development' },
  { value: 'media', label: 'Media / Content' },
  { value: 'other', label: 'Other' },
];

const STATUS_TONE: Record<Deliverable['status'], string> = {
  pending: 'minor', 'in-progress': 'minor', delivered: 'pass',
};

function DeliverableRow({ d, onChanged }: { d: Deliverable; onChanged: () => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description ?? '');
  const [dueDate, setDueDate] = useState(d.dueDate ?? '');
  const [figmaUrl, setFigmaUrl] = useState(d.figmaUrl ?? '');
  const figmaOk = !figmaUrl.trim() || isFigmaUrl(figmaUrl.trim());

  const setStatus = useMutation({
    mutationFn: (status: Deliverable['status']) => api.updateDeliverable(d.id, { status }),
    onSuccess: onChanged,
  });

  const save = useMutation({
    mutationFn: () => api.updateDeliverable(d.id, {
      title: title.trim(), description, dueDate, figmaUrl: figmaUrl.trim(),
    }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDeliverable(d.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    if (!confirm(`Remove "${d.title}"?`)) return;
    remove.mutate();
  };

  if (editing) {
    return (
      <tr>
        <td>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
                 aria-label="Description" placeholder="Description" style={{ marginTop: 4 }} />
          <input value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)}
                 aria-label="Figma file" placeholder="https://www.figma.com/design/…"
                 aria-invalid={!figmaOk} style={{ marginTop: 4 }} />
          {!figmaOk && <div className="err" style={{ fontSize: 12, marginTop: 4 }}>{FIGMA_HINT}</div>}
        </td>
        <td className="muted">{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</td>
        <td><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></td>
        <td colSpan={2}><div className="row">
          <button type="button" className="primary" disabled={!title.trim() || !figmaOk || save.isPending}
                  onClick={() => save.mutate()}>Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div></td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td>
          <strong>{d.title}</strong>
          {d.description && <div className="muted" style={{ fontSize: 13 }}>{d.description}</div>}
          {d.figmaUrl && (
            <div className="muted row" style={{ fontSize: 12, gap: 4, marginTop: 2 }}>
              <PenTool size={12} strokeWidth={1.75} aria-hidden="true" /> Figma
            </div>
          )}
        </td>
        <td className="muted">{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</td>
        <td className="muted">{d.dueDate ?? '—'}</td>
        <td>
          <select
            value={d.status} className={`pill ${STATUS_TONE[d.status]}`}
            onChange={(e) => setStatus.mutate(e.target.value as Deliverable['status'])}
          >
            <option value="pending">Pending</option>
            <option value="in-progress">In progress</option>
            <option value="delivered">Delivered</option>
          </select>
        </td>
        <td><div className="row">
          {d.figmaUrl && (
            <button type="button" onClick={() => setPreviewing((p) => !p)}
                    aria-expanded={previewing} aria-label={previewing ? 'Hide preview' : 'Preview'}>
              {previewing
                ? <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />
                : <Eye size={14} strokeWidth={1.75} aria-hidden="true" />}
              {previewing ? 'Hide' : 'Preview'}
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)}>
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={onDelete} disabled={remove.isPending}
                  aria-label={`Remove ${d.title}`}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div></td>
      </tr>
      {previewing && d.figmaUrl && (
        <tr>
          <td colSpan={5} style={{ paddingTop: 0 }}>
            <FigmaEmbed url={d.figmaUrl} title={d.title} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Deliverables({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Deliverable['kind']>('document');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const figmaOk = !figmaUrl.trim() || isFigmaUrl(figmaUrl.trim());

  const { data, isPending, error } = useQuery({
    queryKey: ['deliverables', clientId], queryFn: () => api.deliverables(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['deliverables', clientId] });
  };

  const create = useMutation({
    mutationFn: () => api.createDeliverable(clientId, {
      kind, title: title.trim(),
      ...(dueDate ? { dueDate } : {}),
      ...(figmaUrl.trim() ? { figmaUrl: figmaUrl.trim() } : {}),
    }),
    onSuccess: () => {
      setTitle(''); setDueDate(''); setFigmaUrl(''); setAdding(false); invalidate();
    },
  });

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Deliverables</h3>
        <span className="muted mono">{data?.length ?? 0}</span>
        <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setAdding((o) => !o)}>
          {adding ? 'Cancel' : 'New deliverable'}
        </button>
      </div>

      {adding && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="field">
            <span className="label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Brand guidelines" required autoFocus />
          </label>
          <label className="field">
            <span className="label">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Deliverable['kind'])}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Due (optional)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Figma file (optional)</span>
            <input value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)}
                   placeholder="https://www.figma.com/design/…" aria-invalid={!figmaOk} />
            <span className={figmaOk ? 'muted' : 'err'} style={{ fontSize: 12 }}>
              {figmaOk ? 'Previews in place, here and in the client’s portal.' : FIGMA_HINT}
            </span>
          </label>
          {create.error && <p className="err">{(create.error as Error).message}</p>}
          <button className="primary" type="submit" disabled={!title.trim() || !figmaOk || create.isPending}>
            {create.isPending ? 'Adding…' : 'Add deliverable'}
          </button>
        </form>
      )}

      {isPending && <p className="muted">Loading deliverables…</p>}
      {error && <p className="err">Could not load deliverables. {(error as Error).message}</p>}

      {data && data.length === 0 && !adding && (
        <p className="muted">Nothing listed yet. A client's portal shows this list as-is.</p>
      )}

      {data && data.length > 0 && (
        <table>
          <thead><tr><th>Title</th><th>Kind</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((d) => <DeliverableRow key={d.id} d={d} onChanged={invalidate} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}
