import { useState, type ReactElement } from 'react';
import type { Client } from '../api.js';
import DeliverablesSection from './sections/Deliverables.js';
import TimelineSection from './sections/Timeline.js';
import MilestonesSection from './sections/Milestones.js';
import FeedbackSection from './sections/Feedback.js';
import FilesSection from './sections/Files.js';
import InvoicesSection from './sections/Invoices.js';
import MessagesSection from './sections/Messages.js';

/**
 * The portal's own shell — a numbered rail, seven sections, one client.
 *
 * Deliberately not routed through the studio's hash router: a client's
 * session is one visit at a time, not something worth deep-linking into a
 * specific tab, and keeping the active section as local state is the whole
 * mechanism this needs.
 */

interface Section { id: string; label: string; render: (props: { client: Client; canWrite: boolean }) => ReactElement }

const SECTIONS: Section[] = [
  { id: 'deliverables', label: 'Deliverables', render: (p) => <DeliverablesSection {...p} /> },
  { id: 'timeline', label: 'Timeline', render: (p) => <TimelineSection {...p} /> },
  { id: 'milestones', label: 'Milestones', render: (p) => <MilestonesSection {...p} /> },
  { id: 'feedback', label: 'Feedback', render: (p) => <FeedbackSection {...p} /> },
  { id: 'files', label: 'Files & Assets', render: (p) => <FilesSection {...p} /> },
  { id: 'invoices', label: 'Invoices', render: (p) => <InvoicesSection {...p} /> },
  { id: 'messages', label: 'Messages', render: (p) => <MessagesSection {...p} /> },
];

export function PortalShell({ client, role }: { client: Client; role: string }): ReactElement {
  const [active, setActive] = useState(SECTIONS[0]?.id ?? 'deliverables');
  const index = SECTIONS.findIndex((s) => s.id === active);
  const section = SECTIONS[index] ?? SECTIONS[0];
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
          {SECTIONS.map((s, i) => (
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
