import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client } from '../api.js';
import BrandHubSection from './sections/BrandHub.js';
import DocumentsSection from './sections/Documents.js';
import DeliverablesSection from './sections/Deliverables.js';
import TimelineSection from './sections/Timeline.js';
import MilestonesSection from './sections/Milestones.js';
import FeedbackSection from './sections/Feedback.js';
import FilesSection from './sections/Files.js';
import InvoicesSection from './sections/Invoices.js';
import MessagesSection from './sections/Messages.js';

/**
 * The portal's own shell — a numbered rail, eight sections, one client.
 *
 * Deliberately not routed through the studio's hash router: a client's
 * session is one visit at a time, not something worth deep-linking into a
 * specific tab, and keeping the active section as local state is the whole
 * mechanism this needs.
 */

interface Section { id: string; label: string; render: (props: { client: Client; canWrite: boolean }) => ReactElement }

const SECTIONS: Section[] = [
  { id: 'documents', label: 'Documents', render: (p) => <DocumentsSection {...p} /> },
  { id: 'deliverables', label: 'Deliverables', render: (p) => <DeliverablesSection {...p} /> },
  { id: 'timeline', label: 'Timeline', render: (p) => <TimelineSection {...p} /> },
  { id: 'milestones', label: 'Milestones', render: (p) => <MilestonesSection {...p} /> },
  { id: 'feedback', label: 'Feedback', render: (p) => <FeedbackSection {...p} /> },
  { id: 'files', label: 'Files & Assets', render: (p) => <FilesSection {...p} /> },
  { id: 'invoices', label: 'Invoices', render: (p) => <InvoicesSection {...p} /> },
  { id: 'messages', label: 'Messages', render: (p) => <MessagesSection {...p} /> },
];

/** The one section that exists only for a client who has it. */
const BRAND_HUB: Section = {
  id: 'brand-hub', label: 'Brand Hub', render: (p) => <BrandHubSection {...p} />,
};

export function PortalShell({ client, role }: { client: Client; role: string }): ReactElement {
  const [active, setActive] = useState(SECTIONS[0]?.id ?? 'deliverables');
  // Asked once, here: the server says `enabled: false` unless the hub is
  // active, so a client without one never sees the room at all.
  const hub = useQuery({ queryKey: ['brand-hub', client.id], queryFn: () => api.brandHub(client.id) });
  const sections = hub.data?.enabled ? [...SECTIONS, BRAND_HUB] : SECTIONS;
  const index = sections.findIndex((s) => s.id === active);
  const section = sections[index] ?? sections[0];
  // `limited` never reaches this shell in practice (its links open the file
  // library directly), but the check costs nothing and keeps every section's
  // write controls honest about what the session in front of it can do.
  const canWrite = role === 'editor' || role === 'brand_manager' || role === 'owner';

  return (
    <div className="portal">
      <aside className="portal-sidebar">
        <div>
          <p className="wordmark" style={{ marginBottom: 4 }}>Client Portal</p>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Your project. Our process.<br />Always in sync.
          </p>
        </div>

        <nav className="portal-nav" aria-label="Portal sections">
          {sections.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="portal-nav-item"
              aria-current={s.id === active ? 'page' : undefined}
              onClick={() => setActive(s.id)}
            >
              <span className="portal-nav-index">{String(i + 1).padStart(2, '0')}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="portal-help">
          <strong>Need help?</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>Contact your project manager anytime.</p>
        </div>
      </aside>

      <main className="portal-main">
        <div className="portal-topline muted">
          <span>{client.name}</span>
          <span aria-hidden="true">·</span>
          <span>CLIENT PORTAL</span>
          <span aria-hidden="true">·</span>
          <span className="mono">{String(index + 1).padStart(2, '0')}</span>
        </div>

        {section?.render({ client, canWrite })}
      </main>
    </div>
  );
}
