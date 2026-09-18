import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Client } from '../api.js';

/**
 * Clients.
 *
 * The record everything else in the studio hangs from: a project belongs to a
 * client, a run belongs to a project, and a portal is published for a client.
 * Before this, a run carried a project id with nothing behind it.
 */

const STATUS_TONE: Record<Client['status'], string> = {
  prospect: 'minor', active: 'pass', dormant: 'minor', archived: 'minor',
};

export default function Clients(): ReactElement {
  const queryClient = useQueryClient();
  const { data: clients, isPending, error } = useQuery({
    queryKey: ['clients'], queryFn: api.clients,
  });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');

  const create = useMutation({
    mutationFn: () => api.createClient({ name, ...(industry ? { industry } : {}) }),
    onSuccess: () => {
      setName(''); setIndustry(''); setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  if (isPending) return <p className="muted">Loading clients…</p>;
  if (error) return <p className="err">Could not load clients. {(error as Error).message}</p>;

  return (
    <section className="stack">
      <div className="row">
        <h2>Clients</h2>
        <span className="muted mono">{clients.length}</span>
        <button className="primary" style={{ marginLeft: 'auto' }}
                onClick={() => setAdding((open) => !open)}>
          {adding ? 'Cancel' : 'New client'}
        </button>
      </div>

      {adding && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="stack">
            <label className="field">
              <span className="label">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label className="field">
              <span className="label">Industry</span>
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </label>
            {create.error && <p className="err">{(create.error as Error).message}</p>}
            <div className="row">
              <button className="primary" type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create client'}
              </button>
              <span className="muted">
                The portal address is derived from the name.
              </span>
            </div>
          </div>
        </form>
      )}

      {clients.length === 0 && !adding ? (
        <div className="empty">
          <p className="editorial">Your studio starts here.</p>
          <p>
            Create your first client and begin building their brand system. Everything else —
            projects, runs, brands, portals — hangs from this record.
          </p>
          <button className="primary" onClick={() => setAdding(true)}>New client</button>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Client</th><th>Industry</th><th>Projects</th><th>Contacts</th><th>Status</th></tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>
                  <a href={`#/clients/${client.id}`}><strong>{client.name}</strong></a>
                  <div className="muted mono" style={{ fontSize: 12 }}>/{client.slug}</div>
                </td>
                <td className="muted">{client.industry ?? '—'}</td>
                <td className="mono">{client.projects ?? 0}</td>
                <td className="mono">{client.contacts ?? 0}</td>
                <td><span className={`pill ${STATUS_TONE[client.status]}`}>{client.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
