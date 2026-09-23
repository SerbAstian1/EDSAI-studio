import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ExternalLink, Trash2 } from 'lucide-react';
import { api, type ApiError, type Client } from '../api.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import OverflowMenu from '../components/OverflowMenu.js';
import { go } from '../components/actions.js';

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
  const { data: clients, isPending, error, refetch } = useQuery({
    queryKey: ['clients'], queryFn: api.clients,
  });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');

  const create = useMutation({
    mutationFn: () => api.createClient({ name, ...(industry ? { industry } : {}) }),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      // Straight to the record just created, not back to the list it now
      // sits in — everything that makes it useful (a contact, a project, a
      // run) happens on its own page, not by finding the new row and
      // clicking in a second time.
      location.hash = `#/clients/${client.id}`;
    },
  });

  const invalidate = (): void => { void queryClient.invalidateQueries({ queryKey: ['clients'] }); };
  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: Client['status'] }) =>
      api.updateClient(input.id, { status: input.status }),
    onSuccess: invalidate,
  });
  // A refusal is shown on the row it belongs to, not in a dialog: a client
  // with work under it stays, and the reasons say what is still there.
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteClient(id),
    onSuccess: invalidate,
  });
  const [refused, setRefused] = useState<{ id: string; message: string } | undefined>(undefined);

  if (isPending) return <p className="muted">Loading clients…</p>;
  if (error) {
    return <ErrorPanel title="Could not load clients" error={error} onRetry={() => { void refetch(); }} />;
  }

  const onDelete = (client: Client): void => {
    void requestConfirmation({
      title: `Delete ${client.name}?`,
      message: 'This cannot be undone. Remove the client’s contacts and projects first.',
      confirmLabel: 'Delete client',
    }).then((confirmed) => {
      if (!confirmed) return;
      setRefused(undefined);
      remove.mutate(client.id, {
        onError: (e) => setRefused({ id: client.id, message: (e as ApiError).message }),
      });
    });
  };

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
            <tr><th>Client</th><th>Industry</th><th>Projects</th><th>Contacts</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>
                  <a href={`#/clients/${client.id}`}><strong>{client.name}</strong></a>
                  <div className="muted mono" style={{ fontSize: 12 }}>/{client.slug}</div>
                  {refused?.id === client.id && (
                    <div className="err" style={{ fontSize: 13, marginTop: 4 }}>{refused.message}</div>
                  )}
                </td>
                <td className="muted">{client.industry ?? '—'}</td>
                <td className="mono">{client.projects ?? 0}</td>
                <td className="mono">{client.contacts ?? 0}</td>
                <td><span className={`pill ${STATUS_TONE[client.status]}`}>{client.status}</span></td>
                <td className="actions">
                  <OverflowMenu label={`Actions for ${client.name}`} items={[
                    { label: 'Open', icon: ExternalLink, onSelect: () => go(`#/clients/${client.id}`) },
                    client.status === 'archived'
                      ? { label: 'Reactivate', icon: ArchiveRestore, disabled: setStatus.isPending,
                          onSelect: () => setStatus.mutate({ id: client.id, status: 'active' }) }
                      : { label: 'Archive', icon: Archive, disabled: setStatus.isPending,
                          onSelect: () => setStatus.mutate({ id: client.id, status: 'archived' }) },
                    { label: 'Delete', icon: Trash2, danger: true, disabled: remove.isPending,
                      onSelect: () => onDelete(client) },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
