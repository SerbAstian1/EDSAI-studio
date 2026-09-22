import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, type Client, type Deliverable } from '../../api.js';
import FigmaEmbed, { isFigmaUrl } from '../../components/FigmaEmbed.js';

/**
 * The client's view of what they are owed. A deliverable that lives in Figma
 * previews right here — the client reads the document inside the portal
 * instead of being handed a link out of it — and a card with a preview takes
 * the full row so the viewer is a viewer, not a thumbnail.
 */

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
          {data.map((d) => {
            const preview = d.figmaUrl && isFigmaUrl(d.figmaUrl) ? d.figmaUrl : undefined;
            return (
              <article key={d.id} className={`project-card${preview ? ' wide' : ''}`}>
                <div className="project-card-head">
                  <div className="project-card-title">
                    <span className="client">{KIND_LABEL[d.kind]}</span>
                    <strong title={d.title}>{d.title}</strong>
                  </div>
                  <span className={`pill ${STATUS_TONE[d.status]}`} style={{ marginLeft: 'auto' }}>
                    {STATUS_LABEL[d.status]}
                  </span>
                </div>
                {d.description && <p className="project-card-status">{d.description}</p>}
                {d.dueDate && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Due {d.dueDate}</p>}
                {preview && <FigmaEmbed url={preview} title={d.title} />}
                {d.assetId && (
                  <a href={api.downloadPath(d.assetId)}>
                    <button type="button">
                      <Download size={14} strokeWidth={1.75} aria-hidden="true" /> Download
                    </button>
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
