import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { histogram, targetSummary, weakestScore } from '../scorecard.js';

/**
 * The scorecard board.
 *
 * Its whole job is to make a wall of 8s visible before Arbitration rather than
 * after, so the histogram and the widest-band figure are the screen rather than
 * a footnote on it.
 */
export default function Scorecard({ runId }: { runId: string }): ReactElement {
  const { data, isPending, error } = useQuery({
    queryKey: ['run', runId], queryFn: () => api.run(runId),
  });

  if (isPending) return <p className="muted">Loading scores…</p>;
  if (error) return <p className="err">Could not load scores. {(error as Error).message}</p>;

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
          <h2>Distribution</h2>
          <span className="mono muted" style={{ marginLeft: 'auto' }}>
            {h.total} scores · mean {h.mean.toFixed(2)} · range {h.min}–{h.max}
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
          Widest two-point band: <strong>{h.widestBand.low}–{h.widestBand.high}</strong> at{' '}
          <span className="mono">{(h.widestBand.share * 100).toFixed(1)}%</span>
          {clustered
            ? ' — above the 70% clustering threshold. Re-examine the scores at the edges.'
            : ' — under the 70% clustering threshold.'}
        </p>
      </div>

      {weakest && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Named weak point</h3>
          <p>
            <strong>{weakest.dimension} at {weakest.value}</strong>
            <span className="muted"> (department {weakest.departmentId})</span>
          </p>
          <p className="muted">{weakest.justification}</p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Provenance</h3>
        <p className="mono">
          {targets.measured} of {targets.total} targets instrument-measured
          {targets.total > 0 && <> ({(targets.provenance * 100).toFixed(0)}%)</>}
        </p>
        <p className="muted">
          A stated target carries a mechanism for hitting it. Only an instrument
          call in that department's own turn can produce an actual.
        </p>
      </div>

      {data.rescores.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Rescores</h3>
          <table>
            <thead><tr><th>Dept</th><th>Dimension</th><th>Change</th><th>Directed by</th><th>Reason</th></tr></thead>
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
