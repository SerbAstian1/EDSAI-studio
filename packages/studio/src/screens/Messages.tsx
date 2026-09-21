import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

/**
 * The one conversation this client's portal can see.
 *
 * No thread id: the client scope already is the thread, so there is exactly
 * one to render. Polled rather than pushed — this studio has no websocket
 * layer, and a conversation that refreshes every few seconds while the panel
 * is open is close enough to live for what this is.
 */

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function Messages({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const { data, isPending, error } = useQuery({
    queryKey: ['messages', clientId], queryFn: () => api.messages(clientId),
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: () => api.sendMessage(clientId, { body: body.trim() }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['messages', clientId] });
    },
  });

  return (
    <section className="stack">
      <h3 style={{ margin: 0 }}>Messages</h3>

      {isPending && <p className="muted">Loading messages…</p>}
      {error && <p className="err">Could not load messages. {(error as Error).message}</p>}

      {data && data.length === 0 && (
        <p className="muted">No messages yet. Anything sent here reaches the client's own portal.</p>
      )}

      {data && data.length > 0 && (
        <div className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
          {data.map((message) => (
            <div key={message.id} className="card" style={{ marginBottom: 0 }}>
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

      <form className="row" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}>
        <input
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…" style={{ flex: 1 }} aria-label="Message"
        />
        <button className="primary" type="submit" disabled={!body.trim() || send.isPending}>
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {send.error && <p className="err">{(send.error as Error).message}</p>}
    </section>
  );
}
