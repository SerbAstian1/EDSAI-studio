import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { api, type Milestone } from '../api.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import OverflowMenu from '../components/OverflowMenu.js';

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

function MilestoneRow({ m, index, count, onChanged, onMove }: {
  m: Milestone; index: number; count: number; onChanged: () => void;
  onMove: (delta: number) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description ?? '');
  const [dueDate, setDueDate] = useState(m.dueDate ?? '');

  const setStatus = useMutation({
    mutationFn: (status: Milestone['status']) => api.updateMilestone(m.id, { status }),
    onSuccess: onChanged,
  });

  const save = useMutation({
    mutationFn: () => api.updateMilestone(m.id, { title: title.trim(), description, dueDate }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteMilestone(m.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    void requestConfirmation({
      title: `Remove ${m.title}?`,
      message: 'This removes the milestone from the project timeline. It cannot be undone.',
      confirmLabel: 'Remove milestone',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  if (editing) {
    return (
      <tr>
        <td className="mono muted" data-label="Order">{index + 1}</td>
        <td data-label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
                 aria-label="Description" placeholder="Description" style={{ marginTop: 4 }} />
        </td>
        <td data-label="Due"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></td>
        <td colSpan={2}><div className="row">
          <button type="button" className="primary" disabled={!title.trim() || save.isPending}
                  onClick={() => save.mutate()}>Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div></td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="mono muted" data-label="Order">{index + 1}</td>
      <td data-label="Title">
        <strong>{m.title}</strong>
        {m.description && <div className="muted" style={{ fontSize: 13 }}>{m.description}</div>}
      </td>
      <td className="muted" data-label="Due">{m.dueDate ?? '—'}</td>
      <td data-label="Status">
        <select
          value={m.status} className={`pill ${STATUS_TONE[m.status]}`}
          onChange={(e) => setStatus.mutate(e.target.value as Milestone['status'])}
        >
          <option value="upcoming">Upcoming</option>
          <option value="in-progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </td>
      <td className="actions">
        <OverflowMenu label={`Actions for ${m.title}`} items={[
          { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true) },
          { label: 'Move up', icon: ArrowUp, disabled: index === 0, onSelect: () => onMove(-1) },
          { label: 'Move down', icon: ArrowDown, disabled: index === count - 1, onSelect: () => onMove(1) },
          { label: 'Remove', icon: Trash2, danger: true, disabled: remove.isPending, onSelect: onDelete },
        ]} />
      </td>
    </tr>
  );
}

export default function Milestones({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data, isPending, error, refetch } = useQuery({
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
      {error && (
        <ErrorPanel
          title="Could not load milestones"
          error={error}
          onRetry={() => { void refetch(); }}
        />
      )}

      {data && data.length === 0 && !adding && (
        <p className="muted">No milestones laid out yet.</p>
      )}

      {data && data.length > 0 && (
        <table className="stacky">
          <thead><tr><th>#</th><th>Title</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((m, i) => (
              <MilestoneRow
                key={m.id} m={m} index={i} count={data.length} onChanged={invalidate}
                onMove={(delta) => swap(i, delta)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
