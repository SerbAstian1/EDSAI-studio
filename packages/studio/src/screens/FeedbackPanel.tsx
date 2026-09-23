import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';

/**
 * What a client said about how the project is going, outside a run's own
 * review cycle. Smaller and less formal on purpose — see `Feedback` in
 * `@edsai/engine`.
 */

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ReplyForm({ feedbackId, onSent }: { feedbackId: string; onSent: () => void }): ReactElement {
  const [reply, setReply] = useState('');
  const respond = useMutation({
    mutationFn: () => api.respondToFeedback(feedbackId, reply.trim()),
    onSuccess: () => { setReply(''); onSent(); },
  });

  return (
    <form className="row" style={{ marginTop: 8 }}
          onSubmit={(e) => { e.preventDefault(); if (reply.trim()) respond.mutate(); }}>
      <input value={reply} onChange={(e) => setReply(e.target.value)}
             placeholder="Reply…" style={{ flex: 1 }} aria-label="Reply to feedback" />
      <button type="submit" disabled={!reply.trim() || respond.isPending}>
        {respond.isPending ? 'Sending…' : 'Reply'}
      </button>
    </form>
  );
}

export default function FeedbackPanel({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['feedback', clientId], queryFn: () => api.feedback(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['feedback', clientId] });
  };

  return (
    <section className="stack">
      <h3 style={{ margin: 0 }}>Feedback</h3>

      {isPending && <p className="muted">Loading feedback…</p>}
      {error && (
        <ErrorPanel
          title="Could not load feedback"
          error={error}
          onRetry={() => { void refetch(); }}
        />
      )}

      {data && data.length === 0 && (
        <p className="muted">Nothing left yet — a client can leave feedback from their portal.</p>
      )}

      {data && data.length > 0 && (
        <div className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
          {data.map((entry) => (
            <div key={entry.id} className="card" style={{ marginBottom: 0 }}>
              <div className="row">
                {entry.rating && (
                  <span className="mono" aria-label={`${entry.rating} of 5`}>
                    {'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)}
                  </span>
                )}
                <span className="muted mono" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {dateOf(entry.createdAt)}
                </span>
              </div>
              <p style={{ margin: '4px 0 0' }}>{entry.body}</p>
              {entry.response ? (
                <div className="muted" style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                  <strong>You replied:</strong> {entry.response}
                </div>
              ) : (
                <ReplyForm feedbackId={entry.id} onSent={invalidate} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
