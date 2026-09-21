import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Milestone } from '../api.js';

/**
 * The project's own timeline, in the studio's own words.
 *
 * Deliberately not derived from the rubric's departments — a client reads
 * "Concept Approval", not a department name from the corpus. Order is a
 * plain integer the studio sets by where a milestone sits in this list; the
 * client's portal renders the same order.
 */

const STATUS_TONE: Record<Milestone['status'], string> = {
  upcoming: 'minor', 'in-progress': 'minor', completed: 'pass',
};

export default function Milestones({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data, isPending, error } = useQuery({
    queryKey: ['milestones', clientId], queryFn: () => api.milestones(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['milestones', clientId] });
  };

  const create = useMutation({
    mutationFn: () => api.createMilestone(clientId, {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(dueDate ? { dueDate } : {}),
    }),
    onSuccess: () => { setTitle(''); setDescription(''); setDueDate(''); setAdding(false); invalidate(); },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: Milestone['status'] }) =>
      api.updateMilestone(input.id, { status: input.status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMilestone(id),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: (input: { id: string; order: number }) =>
      api.updateMilestone(input.id, { order: input.order }),
    onSuccess: invalidate,
  });

  const swap = (index: number, delta: number): void => {
    if (!data) return;
    const other = data[index + delta];
    const current = data[index];
    if (!other || !current) return;
    move.mutate({ id: current.id, order: other.order });
    move.mutate({ id: other.id, order: current.order });
  };

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Milestones</h3>
        <span className="muted mono">{data?.length ?? 0}</span>
        <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setAdding((o) => !o)}>
          {adding ? 'Cancel' : 'New milestone'}
        </button>
      </div>

      {adding && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="field">
            <span className="label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Concept Approval" required autoFocus />
          </label>
          <label className="field">
            <span className="label">Description (optional)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
                   placeholder="Concepts presented and approved to move forward." />
          </label>
          <label className="field">
            <span className="label">Due (optional)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          {create.error && <p className="err">{(create.error as Error).message}</p>}
          <button className="primary" type="submit" disabled={!title.trim() || create.isPending}>
            {create.isPending ? 'Adding…' : 'Add milestone'}
          </button>
        </form>
      )}

      {isPending && <p className="muted">Loading milestones…</p>}
      {error && <p className="err">Could not load milestones. {(error as Error).message}</p>}

      {data && data.length === 0 && !adding && (
        <p className="muted">No milestones laid out yet.</p>
      )}

      {data && data.length > 0 && (
        <table>
          <thead><tr><th /><th>Title</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((m, i) => (
              <tr key={m.id}>
                <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" disabled={i === 0} onClick={() => swap(i, -1)}
                          aria-label="Move up" title="Move up">↑</button>
                  <button type="button" disabled={i === data.length - 1} onClick={() => swap(i, 1)}
                          aria-label="Move down" title="Move down">↓</button>
                </td>
                <td>
                  <strong>{m.title}</strong>
                  {m.description && <div className="muted" style={{ fontSize: 13 }}>{m.description}</div>}
                </td>
                <td className="muted">{m.dueDate ?? '—'}</td>
                <td>
                  <select
                    value={m.status} className={`pill ${STATUS_TONE[m.status]}`}
                    onChange={(e) => setStatus.mutate({
                      id: m.id, status: e.target.value as Milestone['status'],
                    })}
                  >
                    <option value="upcoming">Upcoming</option>
                    <option value="in-progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </td>
                <td>
                  <button type="button" onClick={() => remove.mutate(m.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
