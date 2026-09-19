import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { RunTable } from '../components/RunTable.js';
import { OnboardingPanel } from '../components/OnboardingPanel.js';
import Brand from './Brand.js';
import Assets from './Assets.js';
import PortalAccess from './PortalAccess.js';
import Positioning from './Positioning.js';
import type { Run } from '../api.js';

/**
 * One client: their people, their work, and the runs underneath it.
 *
 * The tabs the brief lists (deliverables, portal, approvals) are not here
 * because the entities behind them do not exist yet. Rendering empty tabs would
 * make the record look finished when it is not. Files are here now: they are
 * what the client actually downloads, so they belong beside the people and the
 * work rather than in a library of their own.
 */
export default function ClientDetail({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['client', clientId], queryFn: () => api.client(clientId),
  });

  const [contactName, setContactName] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [projectName, setProjectName] = useState('');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const addContact = useMutation({
    mutationFn: () => api.createContact(clientId, {
      name: contactName, ...(contactTitle ? { title: contactTitle } : {}),
    }),
    onSuccess: () => { setContactName(''); setContactTitle(''); invalidate(); },
  });

  const addProject = useMutation({
    mutationFn: () => api.createProject(clientId, { name: projectName }),
    onSuccess: () => { setProjectName(''); invalidate(); },
  });

  if (isPending) return <p className="muted">Loading client…</p>;
  if (error) {
    return (
      <div className="empty">
        <p className="editorial">That client is not here.</p>
        <p>{(error as Error).message}</p>
        <a href="#/clients"><button>Back to clients</button></a>
      </div>
    );
  }

  const { client, contacts, projects, runs } = data;

  return (
    <section className="stack">
      <div>
        <p className="label">Client · /{client.slug}</p>
        <h2>{client.name}</h2>
        <p className="muted">
          {[client.industry, client.location, client.website].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>

      <div className="stat-row">
        <div className="stat"><span className="label">Projects</span>
          <span className="metric">{String(projects.length).padStart(2, '0')}</span></div>
        <div className="stat"><span className="label">Runs</span>
          <span className="metric">{String(runs.length).padStart(2, '0')}</span></div>
        <div className="stat"><span className="label">Contacts</span>
          <span className="metric">{String(contacts.length).padStart(2, '0')}</span></div>
        <div className="stat"><span className="label">Status</span>
          <span className="metric" style={{ fontSize: 20 }}>{client.status}</span></div>
      </div>

      <h3>Contacts</h3>
      {contacts.length === 0
        ? <p className="muted">Nobody recorded yet. A project whose approver is unnamed is a
            project whose approvals stall.</p>
        : (
          <table>
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Decides</th></tr></thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td><strong>{contact.name}</strong></td>
                  <td className="muted">{contact.title ?? '—'}</td>
                  <td className="muted">{contact.email ?? '—'}</td>
                  <td>{contact.decisionMaker ? <span className="pill pass">yes</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <form className="row" onSubmit={(e) => { e.preventDefault(); addContact.mutate(); }}>
        <input value={contactName} onChange={(e) => setContactName(e.target.value)}
               placeholder="Name" aria-label="Contact name" style={{ maxWidth: 220 }} />
        <input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)}
               placeholder="Title" aria-label="Contact title" style={{ maxWidth: 220 }} />
        <button type="submit" disabled={!contactName.trim() || addContact.isPending}>
          Add contact
        </button>
      </form>

      <h3>Projects</h3>
      {projects.length === 0
        ? <p className="muted">No projects yet.</p>
        : (
          <table>
            <thead><tr><th>Project</th><th>Kind</th><th>Phase</th></tr></thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td><strong>{project.name}</strong></td>
                  <td className="muted">{project.kind}</td>
                  <td><span className="pill minor">{project.phase}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <form className="row" onSubmit={(e) => { e.preventDefault(); addProject.mutate(); }}>
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)}
               placeholder="Project name" aria-label="Project name" style={{ maxWidth: 260 }} />
        <button type="submit" disabled={!projectName.trim() || addProject.isPending}>
          Add project
        </button>
      </form>

      <OnboardingPanel clientId={clientId} />

      <Brand clientId={clientId} />

      <Positioning clientId={clientId} />

      <Assets clientId={clientId} />

      <PortalAccess clientId={clientId} />

      <h3>Runs</h3>
      {runs.length === 0
        ? <p className="muted">No run has been started for this client yet.</p>
        : <RunTable runs={runs as Run[]} />}
    </section>
  );
}
