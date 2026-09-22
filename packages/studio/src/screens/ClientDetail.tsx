import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { api, type ApiError, type Client, type Contact, type Project } from '../api.js';
import { RunTable } from '../components/RunTable.js';
import OverflowMenu from '../components/OverflowMenu.js';
import DocumentShelf from '../components/DocumentShelf.js';
import { OnboardingPanel } from '../components/OnboardingPanel.js';
import Brand from './Brand.js';
import Assets from './Assets.js';
import PortalAccess from './PortalAccess.js';
import Positioning from './Positioning.js';
import Deliverables from './Deliverables.js';
import Milestones from './Milestones.js';
import Invoices from './Invoices.js';
import Messages from './Messages.js';
import FeedbackPanel from './FeedbackPanel.js';
import type { Run } from '../api.js';

/**
 * One client: their people, their work, and the runs underneath it.
 *
 * The tabs the brief lists (deliverables, portal, approvals) are not here
 * because the entities behind them do not exist yet. Rendering empty tabs would
 * make the record look finished when it is not. Files are here now: they are
 * what the client actually downloads, so they belong beside the people and the
 * work rather than in a library of their own.
 *
 * Editing and deleting follow one rule throughout this page: a delete asks
 * first (`confirm()`, plain and native — no dialog component this app does
 * not otherwise have), and nothing with real work under it can be deleted at
 * all. A client with a project, a project with a run — those get edited or
 * archived, never erased in one click.
 */

const CLIENT_STATUSES: Client['status'][] = ['prospect', 'active', 'dormant', 'archived'];

function ClientHeader({ client, dependents, onSaved }: {
  client: Client; dependents: number; onSaved: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [industry, setIndustry] = useState(client.industry ?? '');
  const [place, setPlace] = useState(client.location ?? '');
  const [website, setWebsite] = useState(client.website ?? '');
  const [notes, setNotes] = useState(client.notes ?? '');
  const [status, setStatus] = useState<Client['status']>(client.status);
  const [slackUrl, setSlackUrl] = useState(client.slackUrl ?? '');
  const [meetUrl, setMeetUrl] = useState(client.meetUrl ?? '');

  const save = useMutation({
    mutationFn: () => api.updateClient(client.id, {
      name: name.trim(), industry, location: place, website, notes, status, slackUrl, meetUrl,
    }),
    onSuccess: () => { setEditing(false); onSaved(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteClient(client.id),
    onSuccess: () => {
      // The navigation below is a hash change, not a reload — the query
      // cache survives it, so the clients list would otherwise still show
      // the row this just deleted until its own staleTime happened to lapse.
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      globalThis.location.href = '#/clients';
    },
  });

  // A refusal from one attempt ("still has a contact") goes stale the moment
  // that contact is removed from a table below — nothing about *this*
  // mutation changes to clear it on its own, so the count that caused it is
  // watched directly instead.
  // `remove` is deliberately left out of this dependency list — its own
  // identity changes the moment `reset()` runs, which would make this fire
  // on every render instead of only when `dependents` actually moves.
  useEffect(() => { remove.reset(); }, [dependents]);

  const onDelete = (): void => {
    if (!confirm(`Delete ${client.name}? This can't be undone.`)) return;
    remove.mutate();
  };

  if (!editing) {
    return (
      <div>
        <div className="row">
          <div>
            <p className="label">Client · /{client.slug}</p>
            <h2>{client.name}</h2>
          </div>
          <span className={`pill ${client.status === 'archived' ? 'minor' : 'pass'}`}
                style={{ marginLeft: 'auto' }}>
            {client.status}
          </span>
          <OverflowMenu label={`Actions for ${client.name}`} size="bar" items={[
            { label: 'Edit client', icon: Pencil, onSelect: () => setEditing(true) },
            { label: remove.isPending ? 'Deleting…' : 'Delete client', icon: Trash2,
              danger: true, disabled: remove.isPending, onSelect: onDelete },
          ]} />
        </div>
        <p className="muted">
          {[client.industry, client.location, client.website].filter(Boolean).join(' · ') || '—'}
        </p>
        {/*
          Shown whether or not they are set. Rendering these only once a URL
          existed meant the integration was invisible until you already knew
          it was there — the feature and the empty state were the same
          nothing. Unset, each one is the way in to setting it.
        */}
        <div className="row" style={{ gap: 6 }}>
          {client.slackUrl ? (
            <a href={client.slackUrl} target="_blank" rel="noreferrer">
              <button type="button">Open Slack ↗</button>
            </a>
          ) : (
            <button type="button" className="link" onClick={() => setEditing(true)}>
              + Slack channel
            </button>
          )}
          {client.meetUrl ? (
            <a href={client.meetUrl} target="_blank" rel="noreferrer">
              <button type="button">Join Meet ↗</button>
            </a>
          ) : (
            <button type="button" className="link" onClick={() => setEditing(true)}>
              + Google Meet
            </button>
          )}
        </div>
        {client.notes && <p className="muted">{client.notes}</p>}
        {remove.error && (
          <p className="err">{((remove.error as ApiError).message)}</p>
        )}
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Client['status'])}>
            {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Industry</span>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Location</span>
          <input value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">Website</span>
        <input value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Slack channel</span>
          <input value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)}
                 placeholder="https://your-workspace.slack.com/archives/…" />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Google Meet</span>
          <input value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)}
                 placeholder="https://meet.google.com/xxx-xxxx-xxx" />
        </label>
      </div>
      <label className="field">
        <span className="label">Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {save.error && <p className="err">{(save.error as Error).message}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={!name.trim() || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

function ContactRow({ contact, onChanged }: { contact: Contact; onChanged: () => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.name);
  const [title, setTitle] = useState(contact.title ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [decisionMaker, setDecisionMaker] = useState(contact.decisionMaker);

  const save = useMutation({
    mutationFn: () => api.updateContact(contact.id, { name: name.trim(), title, email, decisionMaker }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteContact(contact.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    if (!confirm(`Remove ${contact.name}?`)) return;
    remove.mutate();
  };

  if (editing) {
    return (
      <tr>
        <td><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" /></td>
        <td><input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" /></td>
        <td><input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" /></td>
        <td>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={decisionMaker}
                   onChange={(e) => setDecisionMaker(e.target.checked)} />
            decides
          </label>
        </td>
        <td><div className="row">
          <button type="button" className="primary" disabled={!name.trim() || save.isPending}
                  onClick={() => save.mutate()}>Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div></td>
      </tr>
    );
  }

  return (
    <tr>
      <td><strong>{contact.name}</strong></td>
      <td className="muted">{contact.title ?? '—'}</td>
      <td className="muted">{contact.email ?? '—'}</td>
      <td>{contact.decisionMaker ? <span className="pill pass">yes</span> : ''}</td>
      <td className="actions">
        <OverflowMenu label={`Actions for ${contact.name}`} items={[
          { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true) },
          { label: 'Remove', icon: Trash2, danger: true, disabled: remove.isPending, onSelect: onDelete },
        ]} />
      </td>
    </tr>
  );
}

const PROJECT_KINDS = ['brand-identity', 'rebrand', 'campaign', 'website', 'collateral', 'other'];
const PROJECT_PHASES = ['discovery', 'strategy', 'identity', 'applications', 'guidelines', 'handoff', 'complete'];

function ProjectRow({ project, onChanged }: { project: Project; onChanged: () => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [kind, setKind] = useState(project.kind);
  const [phase, setPhase] = useState(project.phase);
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [figmaUrl, setFigmaUrl] = useState(project.figmaUrl ?? '');

  const save = useMutation({
    mutationFn: () => api.updateProject(project.id, {
      name: name.trim(), kind, phase, deadline, figmaUrl,
    }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    if (!confirm(`Delete "${project.name}"?`)) return;
    remove.mutate();
  };

  if (editing) {
    return (
      <tr>
        <td><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" /></td>
        <td>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {PROJECT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </td>
        <td>
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            {PROJECT_PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </td>
        <td className="muted">{project.deadline ?? '—'}</td>
        <td>
          <input value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)}
                 aria-label="Figma file" placeholder="https://figma.com/file/…" />
        </td>
        <td><div className="row">
          <button type="button" className="primary" disabled={!name.trim() || save.isPending}
                  onClick={() => save.mutate()}>Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div></td>
      </tr>
    );
  }

  return (
    <tr>
      <td><strong>{project.name}</strong></td>
      <td className="muted">{project.kind}</td>
      <td><span className="pill minor">{project.phase}</span></td>
      <td className="muted">{project.deadline ?? '—'}</td>
      <td>
        {project.figmaUrl
          ? <a href={project.figmaUrl} target="_blank" rel="noreferrer" className="row" style={{ gap: 4, display: 'inline-flex' }}>
              Figma <ExternalLink size={12} aria-hidden="true" />
            </a>
          : <span className="muted">—</span>}
      </td>
      <td className="actions">
        <div className="row">
          <a href={`#/new/${project.id}`}>
            <button type="button" className="primary">Start a run</button>
          </a>
          <OverflowMenu label={`Actions for ${project.name}`} items={[
            { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true) },
            ...(project.figmaUrl ? [{
              label: 'Open in Figma', icon: ExternalLink,
              onSelect: () => { window.open(project.figmaUrl, '_blank', 'noopener'); },
            }] : []),
            { label: 'Remove', icon: Trash2, danger: true, disabled: remove.isPending, onSelect: onDelete },
          ]} />
        </div>
        {/* A refusal that only exists in a `title` is a refusal for people
            who happen to hover. This one says why a project with a run
            against it stays. */}
        {remove.error && (
          <p className="err" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {(remove.error as ApiError).message}
          </p>
        )}
      </td>
    </tr>
  );
}

export type ClientTab = 'overview' | 'discovery' | 'brand' | 'delivery' | 'client';

/** In the order the work actually flows: set up, discover, define, deliver, talk. */
const TABS: { id: ClientTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'brand', label: 'Brand' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'client', label: 'Client' },
];

export default function ClientDetail({ clientId, tab }: {
  clientId: string; tab: string | undefined;
}): ReactElement {
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
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
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
  const current: ClientTab = tab && TABS.some((t) => t.id === tab) ? tab as ClientTab : 'overview';

  return (
    <section className="stack">
      <ClientHeader client={client} dependents={contacts.length + projects.length} onSaved={invalidate} />

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

      {/*
        Five tabs where there were twelve stacked sections. The tab is in the
        URL rather than component state so a refresh, a shared link and the
        back button all land on the same view — the same reason the run
        screens are routes and not a state variable.
      */}
      <nav className="tabs" aria-label="Client sections">
        {TABS.map((t) => (
          <a key={t.id} className="tab"
             href={`#/clients/${clientId}${t.id === 'overview' ? '' : `/${t.id}`}`}
             aria-current={current === t.id ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>

      {current === 'overview' && (<>
      <h3>Contacts</h3>
      {contacts.length === 0
        ? <p className="muted">Nobody recorded yet. A project whose approver is unnamed is a
            project whose approvals stall.</p>
        : (
          <table>
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Decides</th><th /></tr></thead>
            <tbody>
              {contacts.map((contact) => (
                <ContactRow key={contact.id} contact={contact} onChanged={invalidate} />
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
            <thead><tr><th>Project</th><th>Kind</th><th>Phase</th><th>Deadline</th><th>Figma</th><th /></tr></thead>
            <tbody>
              {projects.map((project) => (
                <ProjectRow key={project.id} project={project} onChanged={invalidate} />
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

      <h3>Runs</h3>
      {runs.length === 0
        ? <p className="muted">No run has been started for this client yet.</p>
        : <RunTable runs={runs as Run[]} />}
      </>)}

      {current === 'discovery' && (<>
        <OnboardingPanel clientId={clientId} />
        <Positioning clientId={clientId} />
      </>)}

      {current === 'brand' && <Brand clientId={clientId} />}

      {current === 'delivery' && (<>
        <DocumentShelf clientId={clientId} editable />
        <Deliverables clientId={clientId} />
        <Milestones clientId={clientId} />
        <Assets clientId={clientId} />
      </>)}

      {current === 'client' && (<>
        <Messages clientId={clientId} />
        <FeedbackPanel clientId={clientId} />
        <Invoices clientId={clientId} />
        <PortalAccess clientId={clientId} />
      </>)}
    </section>
  );
}
