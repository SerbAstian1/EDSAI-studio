import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState , type ReactElement } from 'react';
import { api, ApiError } from '../api.js';

/**
 * The finalise screen and the client summary.
 *
 * The FINAL action is disabled while the gate withholds it, and the gate's
 * reasons are rendered rather than summarised — "1 open Major" is actionable in
 * a way that "not ready" is not. The client summary sits behind the same gate
 * and enforces three more constraints server-side.
 */
export default function Finalize({ runId }: { runId: string }): ReactElement {
  const client = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId) });

  const [draft, setDraft] = useState('');
  const [headline, setHeadline] = useState('');

  const finalize = useMutation({
    mutationFn: () => api.finalize(runId, 'FINAL'),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['run', runId] }); },
  });

  const summarize = useMutation({
    mutationFn: () => api.summary(runId, draft, headline || undefined),
  });

  if (isPending || !data) return <p className="muted">Loading…</p>;

  const { gate } = data;
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <section className="stack">
      <div className={`card gate${gate.passed ? ' pass' : ''}`}>
        <h2 style={{ marginTop: 0 }}>
          {gate.passed ? 'FINAL is reachable' : 'FINAL is withheld'}
        </h2>
        <p className="mono">determination {data.run.determination ?? data.run.version}</p>

        {gate.blockers.length > 0 ? (
          <ul>{gate.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        ) : (
          <p className="muted">No open Blockers or Majors, and every conflict carries a resolution.</p>
        )}

        <button className="primary" disabled={!gate.passed || finalize.isPending}
          onClick={() => finalize.mutate()}>
          {finalize.isPending ? 'Finalising…' : 'Mark FINAL'}
        </button>
        {!gate.passed && (
          <p className="muted" style={{ marginTop: 8 }}>
            The determination is computed, not chosen. Close what is open in Review
            and this enables itself.
          </p>
        )}
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Client summary</h3>
        <p className="muted">
          Under 600 words, no scores, no internal vocabulary, and only from a FINAL
          run. All four are enforced server-side — this is the one artifact a client
          reads without you in the room.
        </p>

        <input placeholder="Headline (optional)" value={headline} id="headline"
          onChange={(e) => setHeadline(e.target.value)} />
        <textarea rows={8} value={draft} id="summary-draft"
          placeholder="What we did, and why it mattered — in the client's language."
          onChange={(e) => setDraft(e.target.value)} />

        <div className="row">
          <span className={words > 600 ? 'err mono' : 'muted mono'}>{words}/600 words</span>
          <button className="primary" style={{ marginLeft: 'auto' }}
            disabled={!draft.trim() || summarize.isPending}
            onClick={() => summarize.mutate()}>Generate</button>
        </div>

        {summarize.error instanceof ApiError && (
          <div className="gate">
            <p className="err" style={{ marginBottom: 4 }}>Refused.</p>
            <ul>
              {(summarize.error.reasons.length
                ? summarize.error.reasons
                : [summarize.error.message]).map((r, i) => <li key={i} className="muted">{r}</li>)}
            </ul>
          </div>
        )}

        {summarize.data && (
          <div className="gate pass">
            <p className="pass">Accepted — {summarize.data.wordCount} words.</p>
            <p><strong>{summarize.data.title}</strong></p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{summarize.data.body}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Documents</h3>
        <div className="row">
          <a href={api.documentUrl(runId)} target="_blank" rel="noreferrer">
            <button>Internal document</button>
          </a>
          <a href={api.handoffUrl(runId)} target="_blank" rel="noreferrer">
            <button>DEVPOINT handoff</button>
          </a>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          The internal document carries every score and the provenance of every
          number. It is not the client's document.
        </p>
      </div>
    </section>
  );
}
