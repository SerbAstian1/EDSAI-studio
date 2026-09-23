import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Client } from '../../api.js';
import { ErrorPanel } from '../../components/ErrorPanel.js';

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }): ReactElement {
  return (
    <div role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" className="link" style={{ fontSize: 20, marginRight: 2 }}
          role="radio" aria-checked={value === n} onClick={() => onChange(n)}
        >
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

export default function FeedbackSection({ client, canWrite }: { client: Client; canWrite: boolean }): ReactElement {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['feedback', client.id], queryFn: () => api.feedback(client.id),
  });

  const submit = useMutation({
    mutationFn: () => api.submitFeedback(client.id, {
      body: body.trim(), ...(rating ? { rating } : {}),
    }),
    onSuccess: () => {
      setBody(''); setRating(0);
      void queryClient.invalidateQueries({ queryKey: ['feedback', client.id] });
    },
  });

  return (
    <section className="stack">
      <div>
        <p className="label mono">05</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Feedback</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          Tell your studio how the project is going — this reaches them directly.
        </p>
      </div>

      {canWrite && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (body.trim()) submit.mutate(); }}>
          <Stars value={rating} onChange={setRating} />
          <textarea
            rows={3} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="How is the project going so far?"
          />
          {submit.error && <p className="err">{(submit.error as Error).message}</p>}
          <button className="primary" type="submit" disabled={!body.trim() || submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      )}

      {isPending && <p className="muted">Loading…</p>}
      {error && (
        <ErrorPanel
          title="Could not load feedback"
          error={error}
          onRetry={() => { void refetch(); }}
        />
      )}

      {/* A read-only visitor with nothing here used to get the heading, the
          blurb, and then nothing at all — no form to explain the silence. */}
      {data && data.length === 0 && (
        <div className="empty">
          <p className="editorial">Nothing here yet.</p>
          <p>
            {canWrite
              ? 'Anything you send goes straight to the studio, and their reply appears here beside it.'
              : 'Feedback on this project will appear here, with the studio’s reply beside it.'}
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
          {data.map((entry) => (
            <div key={entry.id} className="card" style={{ marginBottom: 0 }}>
              <div className="row">
                {entry.rating !== undefined && (
                  <span className="mono">{'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)}</span>
                )}
                <span className="muted mono" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {dateOf(entry.createdAt)}
                </span>
              </div>
              <p style={{ margin: '4px 0 0' }}>{entry.body}</p>
              {entry.response && (
                <div className="muted" style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                  <strong>Studio replied:</strong> {entry.response}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
