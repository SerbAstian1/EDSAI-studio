import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Deliverable } from '../api.js';

/**
 * What the studio owes this client, one named thing at a time.
 *
 * Status moves in one direction inside this panel: pending → in progress →
 * delivered. The client's own portal reads this same list — nothing here is
 * restated for their side, so a status set once is correct on both.
 */

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

export default function Deliverables({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Deliverable['kind']>('document');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data, isPending, error } = useQuery({
    queryKey: ['deliverables', clientId], queryFn: () => api.deliverables(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['deliverables', clientId] });
  };

  const create = useMutation({
    mutationFn: () => api.createDeliverable(clientId, {
      kind, title: title.trim(), ...(dueDate ? { dueDate } : {}),
    }),
    onSuccess: () => { setTitle(''); setDueDate(''); setAdding(false); invalidate(); },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: Deliverable['status'] }) =>
      api.updateDeliverable(input.id, { status: input.status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDeliverable(id),
    onSuccess: invalidate,
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
          {create.error && <p className="err">{(create.error as Error).message}</p>}
          <button className="primary" type="submit" disabled={!title.trim() || create.isPending}>
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
            {data.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.title}</strong></td>
                <td className="muted">{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</td>
                <td className="muted">{d.dueDate ?? '—'}</td>
                <td>
                  <select
                    value={d.status} className={`pill ${STATUS_TONE[d.status]}`}
                    onChange={(e) => setStatus.mutate({
                      id: d.id, status: e.target.value as Deliverable['status'],
                    })}
                  >
                    <option value="pending">Pending</option>
                    <option value="in-progress">In progress</option>
                    <option value="delivered">Delivered</option>
                  </select>
                </td>
                <td>
                  <button type="button" onClick={() => remove.mutate(d.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
