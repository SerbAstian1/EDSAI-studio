import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Client } from '../../api.js';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function readName(): string {
  try { return localStorage.getItem('edsai.portal.name') ?? ''; } catch { return ''; }
}
function writeName(name: string): void {
  try { localStorage.setItem('edsai.portal.name', name); } catch { /* per-viewer only */ }
}

export default function MessagesSection({ client, canWrite }: { client: Client; canWrite: boolean }): ReactElement {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [name, setName] = useState(readName);

  const { data, isPending, error } = useQuery({
    queryKey: ['messages', client.id], queryFn: () => api.messages(client.id),
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: () => api.sendMessage(client.id, {
      body: body.trim(), ...(name.trim() ? { authorName: name.trim() } : {}),
    }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['messages', client.id] });
    },
  });

  return (
    <section className="stack">
      <div>
        <p className="label mono">08</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Messages</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          Keep the conversation going. Ask questions, share updates, and stay aligned throughout the project.
        </p>
      </div>

      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="err">Could not load messages. {(error as Error).message}</p>}

      {data && data.length === 0 && <p className="muted">No messages yet — say hello.</p>}

      {data && data.length > 0 && (
        <div className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
          {data.map((message) => (
            <div
              key={message.id} className="card" style={{
                marginBottom: 0,
                ...(message.authorKind === 'portal'
                  ? { background: 'var(--surface)', marginLeft: '15%' }
                  : { marginRight: '15%' }),
              }}
            >
              <div className="row">
                <strong>{message.authorName}</strong>
                <span className="muted mono" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {timeOf(message.createdAt)}
                </span>
              </div>
              <p style={{ margin: '4px 0 0' }}>{message.body}</p>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <form
          className="stack" style={{ gap: 'calc(var(--step) * 1.5) ' }}
          onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}
        >
          {!readName() && (
            <input
              value={name} onChange={(e) => { setName(e.target.value); writeName(e.target.value); }}
              placeholder="Your name" aria-label="Your name" style={{ maxWidth: 220 }}
            />
          )}
          <div className="row">
            <input
              value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Write a message…" style={{ flex: 1 }} aria-label="Message"
            />
            <button className="primary" type="submit" disabled={!body.trim() || send.isPending}>
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {send.error && <p className="err">{(send.error as Error).message}</p>}
        </form>
      ) : (
        <p className="muted">This link is read-only — ask your studio for a link that can reply.</p>
      )}
    </section>
  );
}
