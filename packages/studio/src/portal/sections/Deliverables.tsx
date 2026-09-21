import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client, type Deliverable } from '../../api.js';

const KIND_LABEL: Record<Deliverable['kind'], string> = {
  document: 'Document', presentation: 'Presentation', planning: 'Planning / Strategy',
  data: 'Data / Insights', 'design-assets': 'Design Assets', development: 'Development',
  media: 'Media / Content', other: 'Other',
};

const STATUS_TONE: Record<Deliverable['status'], string> = {
  pending: 'minor', 'in-progress': 'minor', delivered: 'pass',
};
const STATUS_LABEL: Record<Deliverable['status'], string> = {
  pending: 'Pending', 'in-progress': 'In progress', delivered: 'Delivered',
};

export default function DeliverablesSection({ client }: { client: Client }): ReactElement {
  const { data, isPending, error } = useQuery({
    queryKey: ['deliverables', client.id], queryFn: () => api.deliverables(client.id),
  });

  return (
    <section className="stack">
      <div>
        <p className="label mono">01</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Deliverables</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          Everything the studio is producing for this project, and where each one stands.
        </p>
      </div>

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="err">Could not load deliverables. {(error as Error).message}</p>}

      {data && data.length === 0 && (
        <div className="empty">
          <p className="editorial">Nothing listed yet.</p>
          <p>Your studio will add deliverables here as the project is scoped.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="project-grid">
          {data.map((d) => (
            <article key={d.id} className="project-card">
              <div className="project-card-head">
                <div className="project-card-title">
                  <span className="client">{KIND_LABEL[d.kind]}</span>
                  <strong title={d.title}>{d.title}</strong>
                </div>
              </div>
              <span className={`pill ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
              {d.description && <p className="project-card-status">{d.description}</p>}
              {d.dueDate && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Due {d.dueDate}</p>}
              {d.assetId && (
                <a href={api.downloadPath(d.assetId)}><button type="button">Download</button></a>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
