import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState , type ReactElement } from 'react';
import { api, ApiError } from '../api.js';

/**
 * Finish the run and prepare the client-facing summary.
 *
 * The finish action stays disabled until every blocking problem is handled.
 * Exact reasons remain visible so the user knows what to fix.
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
          {gate.passed ? 'Ready to finish' : 'Not ready to finish'}
        </h2>
        <p className="muted">Current review result: {data.run.determination ?? data.run.version}</p>

        {gate.blockers.length > 0 ? (
          <ul>{gate.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        ) : (
          <p className="muted">No critical or major problems remain, and every conflict is resolved.</p>
        )}

        <button className="primary" disabled={!gate.passed || finalize.isPending}
          onClick={() => finalize.mutate()}>
          {finalize.isPending ? 'Finishing…' : 'Finish run'}
        </button>
        {!gate.passed && (
          <p className="muted" style={{ marginTop: 8 }}>
            Resolve the items listed above in Review. This button will enable automatically.
          </p>
        )}
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Client summary</h3>
        <p className="muted">
          Write the client-ready explanation in under 600 words. Use everyday language,
          leave out internal scores, and explain what was decided and why.
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
            onClick={() => summarize.mutate()}>Create summary</button>
        </div>

        {summarize.error instanceof ApiError && (
          <div className="gate">
            <p className="err" style={{ marginBottom: 4 }}>Could not create the summary.</p>
            <ul>
              {(summarize.error.reasons.length
                ? summarize.error.reasons
                : [summarize.error.message]).map((r, i) => <li key={i} className="muted">{r}</li>)}
            </ul>
          </div>
        )}

        {summarize.data && (
          <div className="gate pass">
            <p className="pass">Summary ready — {summarize.data.wordCount} words.</p>
            <p><strong>{summarize.data.title}</strong></p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{summarize.data.body}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Documents</h3>
        <div className="row">
          <a href={api.documentUrl(runId)} target="_blank" rel="noreferrer">
            <button>Full internal report</button>
          </a>
          <a href={api.handoffUrl(runId)} target="_blank" rel="noreferrer">
            <button>Developer handoff</button>
          </a>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          The full report includes every score and shows where each measured number came from.
          Keep it inside the studio.
        </p>
      </div>
    </section>
  );
}
