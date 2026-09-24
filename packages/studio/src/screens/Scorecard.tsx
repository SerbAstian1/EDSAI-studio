import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { histogram, targetSummary, weakestScore } from '../scorecard.js';

/**
 * The run's quality scores in plain language.
 *
 * The chart keeps the detailed 1–10 evidence, while the surrounding copy says
 * what the numbers mean and what the user should check next.
 */
export default function Scorecard({ runId }: { runId: string }): ReactElement {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['run', runId], queryFn: () => api.run(runId),
  });

  if (isPending) return <p className="muted">Loading scores…</p>;
  if (error) {
    return <ErrorPanel title="Could not load scores" error={error} onRetry={() => { void refetch(); }} />;
  }

  const h = histogram(data.outputs);
  const weakest = weakestScore(data.outputs);
  const targets = targetSummary(data.outputs);

  if (!h) return <p className="muted">No scores recorded yet.</p>;

  const peak = Math.max(...h.buckets.map((b) => b.count), 1);
  const clustered = h.widestBand.share > 0.7;

  return (
    <section className="stack">
      <div className="card">
        <div className="row">
          <h2>Quality scores</h2>
          <span className="mono muted" style={{ marginLeft: 'auto' }}>
            {h.total} checks · average {h.mean.toFixed(1)}/10 · lowest {h.min} · highest {h.max}
          </span>
        </div>

        <div className="bars">
          {h.buckets.map((b) => (
            <div key={b.value}
              className={`bar${b.count === 0 ? ' empty' : ''}`}
              style={{ height: `${Math.max(2, (b.count / peak) * 100)}%` }}
              title={`${b.count} score(s) at ${b.value}`} />
          ))}
        </div>
        <div className="bar-labels">
          {h.buckets.map((b) => <span key={b.value}>{b.value}</span>)}
        </div>

        <p className={clustered ? 'err' : 'muted'} style={{ marginTop: 12 }}>
          Most scores sit between <strong>{h.widestBand.low} and {h.widestBand.high}</strong>:{' '}
          <span className="mono">{(h.widestBand.share * 100).toFixed(1)}%</span>
          {clustered
            ? ' of all checks. They may be too similar, so review the highest and lowest scores.'
            : ' of all checks. The scores are spread enough to show meaningful differences.'}
        </p>
      </div>

      {weakest && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Lowest score</h3>
          <p>
            <strong>{weakest.dimension} at {weakest.value}</strong>
            <span className="muted"> (step {weakest.departmentId})</span>
          </p>
          <p className="muted">{weakest.justification}</p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Measurement check</h3>
        <p className="mono">
          {targets.measured} of {targets.total} goals were measured with a tool
          {targets.total > 0 && <> ({(targets.provenance * 100).toFixed(0)}%)</>}
        </p>
        <p className="muted">
          Goals without a tool result are plans, not proven outcomes. EDSAI keeps
          them visible but does not present them as measurements.
        </p>
      </div>

      {data.rescores.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Changed scores</h3>
          <table>
            <thead><tr><th>Step</th><th>Quality</th><th>Change</th><th>Changed by</th><th>Reason</th></tr></thead>
            <tbody>
              {data.rescores.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.departmentId}</td>
                  <td>{r.dimension}</td>
                  <td className="mono">{r.fromValue} → {r.toValue}</td>
                  <td>{r.directedBy}</td>
                  <td className="muted">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
