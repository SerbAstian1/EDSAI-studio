import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api, type Client } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { ClientIdentity } from '../components/ClientIdentity.js';
import { go } from '../components/actions.js';

/**
 * Client acquisition: the leads, in the order they are won.
 *
 * A prospect in this studio is a client record with the status `prospect` and
 * nothing else — no separate lead entity, no pipeline to lose. So this screen
 * derives the funnel from `status` rather than pretending to a stage machine
 * the database does not have: everything not yet active is a lead, and
 * everything active has been won. What that cannot tell you is *when* a lead
 * went cold, which is why the dormant column is the one worth looking at.
 *
 * Discovery sessions live one click away rather than here, because a session
 * belongs to the client it is about — it is their onboarding link, and it is
 * already the first thing on their own page.
 */

const STAGES: { id: 'prospect' | 'dormant'; label: string; detail: string }[] = [
  { id: 'prospect', label: 'Prospect', detail: 'In conversation. No work has been agreed.' },
  { id: 'dormant', label: 'Dormant', detail: 'Was a client. Nothing in flight right now.' },
];

/** The lead columns, in the order a lead travels. Active clients are not leads. */
export function leadsByStage(clients: readonly Client[]): [string, Client[]][] {
  const ranked = [...clients]
    .filter((client) => client.status === 'prospect' || client.status === 'dormant')
    .sort((a, b) => a.name.localeCompare(b.name));
  return STAGES.map((stage) => [stage.id, ranked.filter((client) => client.status === stage.id)]);
}

export default function Acquisition(): ReactElement {
  const queryClient = useQueryClient();
  const { data: clients, isPending, error, refetch } = useQuery({
    queryKey: ['clients'], queryFn: api.clients,
  });

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [source, setSource] = useState('');

  const add = useMutation({
    mutationFn: () => api.createClient({
      name: name.trim(),
      status: 'prospect',
      ...(industry.trim() ? { industry: industry.trim() } : {}),
      // The source is the one field a lead record has that a client record does
      // not, and it is kept in notes rather than a column of its own: it is
      // read once, at the call, and a schema change is not worth that.
      ...(source.trim() ? { notes: `Came in via ${source.trim()}.` } : {}),
    }),
    onSuccess: () => {
      setName(''); setIndustry(''); setSource('');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  if (isPending) return <p className="muted">Loading the pipeline…</p>;
  if (error) {
    return <ErrorPanel title="Could not load leads" error={error} onRetry={() => { void refetch(); }} />;
  }

  const columns = leadsByStage(clients);
  const leads = columns.flatMap(([, held]) => held);
  const won = clients.filter((client) => client.status === 'active').length;

  return (
    <section className="stack">
      <div className="row">
        <h2>Client Acquisition</h2>
        <span className="muted mono">{leads.length} lead{leads.length === 1 ? '' : 's'}</span>
        <span className="pill pass">{won} active</span>
        <a href="#/clients" style={{ marginLeft: 'auto' }}><button type="button">All clients</button></a>
      </div>

      <p className="muted" style={{ maxWidth: '62ch' }}>
        A lead is a client record that has not started work yet. The moment one becomes
        active it moves onto the rail in the sidebar and out of here — a lead that has
        become work is not a lead any more.
      </p>

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Who</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required
                   placeholder="A company or a person" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Industry</span>
            <input value={industry} onChange={(e) => setIndustry(e.target.value)}
                   placeholder="Footwear" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">How they came in</span>
            <input value={source} onChange={(e) => setSource(e.target.value)}
                   placeholder="Referral, Instagram…" />
          </label>
          <button className="primary" type="submit" disabled={!name.trim() || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add lead'}
          </button>
        </div>
        {add.error && <p className="err">{(add.error as Error).message}</p>}
      </form>

      {leads.length === 0 ? (
        <div className="empty">
          <p className="editorial">No leads on the board.</p>
          <p>
            Add one above, or create a client and leave it as a prospect until the work
            is agreed. Nothing here is a separate system — it is the same client record,
            read from the other end.
          </p>
        </div>
      ) : (
        <div className="stat-row">
          {STAGES.map((stage) => {
            const held = columns.find(([id]) => id === stage.id)?.[1] ?? [];
            return (
              <div className="stat" key={stage.id} style={{ flex: 1 }}>
                <span className="label">{stage.label}</span>
                <span className="metric">{String(held.length).padStart(2, '0')}</span>
                <span className="muted" style={{ fontSize: 13 }}>{stage.detail}</span>
              </div>
            );
          })}
        </div>
      )}

      {leads.length > 0 && (
        <table className="stacky">
          <thead><tr><th>Lead</th><th>Industry</th><th>Stage</th><th>Projects</th><th /></tr></thead>
          <tbody>
            {leads.map((client) => (
              <tr key={client.id}>
                <td data-label="Lead">
                  <a href={`#/clients/${client.id}`}>
                    <ClientIdentity size="sm" client={client} />
                  </a>
                  <div className="muted mono" style={{ fontSize: 12 }}>/{client.slug}</div>
                </td>
                <td className="muted" data-label="Industry">{client.industry ?? '—'}</td>
                <td data-label="Stage">
                  <span className={`pill ${client.status === 'prospect' ? 'minor' : ''}`}>
                    {client.status}
                  </span>
                </td>
                <td className="mono" data-label="Projects">{client.projects ?? 0}</td>
                <td className="actions">
                  <div className="row">
                    <a href={`#/clients/${client.id}`}>
                      <button type="button">Open</button>
                    </a>
                    <button
                      type="button"
                      onClick={() => go(`#/clients/${client.id}/strategy`)}
                    >
                      Discovery <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
