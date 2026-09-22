import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client, type Milestone } from '../../api.js';

const STATUS_TONE: Record<Milestone['status'], string> = {
  upcoming: 'minor', 'in-progress': 'minor', completed: 'pass',
};
const STATUS_LABEL: Record<Milestone['status'], string> = {
  upcoming: 'Upcoming', 'in-progress': 'In progress', completed: 'Completed',
};

export default function MilestonesSection({ client }: { client: Client }): ReactElement {
  const { data, isPending, error } = useQuery({
    queryKey: ['milestones', client.id], queryFn: () => api.milestones(client.id),
  });

  return (
    <section className="stack">
      <div>
        <p className="label mono">04</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Milestones</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          Key milestones that mark major progress points in the project.
        </p>
      </div>

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="err">Could not load milestones. {(error as Error).message}</p>}

      {data && data.length === 0 && (
        <div className="empty">
          <p className="editorial">No milestones yet.</p>
          <p>Your studio lays these out once the project is under way.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="project-grid">
          {data.map((m, i) => (
            <article key={m.id} className="project-card">
              <div className="row">
                <span className="mono muted">Milestone {i + 1}</span>
                <span className={`pill ${STATUS_TONE[m.status]}`} style={{ marginLeft: 'auto' }}>
                  {STATUS_LABEL[m.status]}
                </span>
              </div>
              <strong style={{ fontSize: 17 }}>{m.title}</strong>
              {m.description && <p className="project-card-status">{m.description}</p>}
              {m.dueDate && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{m.dueDate}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
