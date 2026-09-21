import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client } from '../../api.js';

/**
 * The same milestones as `Milestones`, read as a line rather than a grid.
 *
 * No entity of its own — a timeline is a milestone list laid end to end, and
 * a second record of "when things happen" is a second place for two answers
 * to disagree.
 */

const DOT_TONE: Record<string, string> = { upcoming: '', 'in-progress': 'pass', completed: 'pass' };

export default function TimelineSection({ client }: { client: Client }): ReactElement {
  const { data, isPending, error } = useQuery({
    queryKey: ['milestones', client.id], queryFn: () => api.milestones(client.id),
  });

  return (
    <section className="stack">
      <div>
        <p className="label mono">02</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Timeline</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          The project's milestones, laid out end to end.
        </p>
      </div>

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="err">Could not load the timeline. {(error as Error).message}</p>}

      {data && data.length === 0 && <p className="muted">Nothing on the timeline yet.</p>}

      {data && data.length > 0 && (
        <ol className="portal-timeline">
          {data.map((m) => (
            <li key={m.id}>
              <span className={`portal-timeline-dot ${DOT_TONE[m.status]}`} aria-hidden="true" />
              <div>
                <div className="row">
                  <strong>{m.title}</strong>
                  {m.dueDate && <span className="muted mono" style={{ marginLeft: 'auto' }}>{m.dueDate}</span>}
                </div>
                {m.description && <p className="muted" style={{ margin: '2px 0 0' }}>{m.description}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
