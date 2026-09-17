import { useQuery } from '@tanstack/react-query';
import { useState , type ReactElement } from 'react';
import { api, type DepartmentOutput } from '../api.js';
import { progress } from '../scorecard.js';

/** Run view and department reader — progress, resume, and what each one produced. */
export default function RunView({ runId }: { runId: string }): ReactElement {
  const { data, isPending, error } = useQuery({
    queryKey: ['run', runId], queryFn: () => api.run(runId),
  });
  const { data: next } = useQuery({
    queryKey: ['next', runId], queryFn: () => api.next(runId),
  });
  const [open, setOpen] = useState<number | undefined>(undefined);

  if (isPending) return <p className="muted">Loading run…</p>;
  if (error) return <p className="err">Could not load this run. {(error as Error).message}</p>;

  const done = data.outputs.map((o) => o.departmentId);
  const p = progress(data.run.activatedDepartments, done);

  return (
    <section className="stack">
      <div className="card">
        <div className="row">
          <h2>{data.run.projectId}</h2>
          <span className="mono muted" style={{ marginLeft: 'auto' }}>
            level {data.run.level} · scope {data.run.scopeId}
          </span>
        </div>
        <p className="mono">{p.done} of {p.total} departments</p>
        <div className="meter"><i style={{ width: `${Math.round(p.share * 100)}%` }} /></div>

        {next?.done === false && (
          <p className="muted" style={{ marginTop: 10 }}>
            Next: <strong>{next.departmentId} {next.name}</strong>
            {next.estimate && (
              <> · ≈{Math.round(next.estimate.totalTokens / 1000)}K tokens
                 ({Math.round(next.estimate.stableTokens / 1000)}K cached)</>
            )}
          </p>
        )}
        {next?.done && <p className="pass">Every activated department has an output.</p>}
        {p.remaining.length > 0 && (
          <p className="muted mono" style={{ fontSize: 13 }}>
            remaining: {p.remaining.join(', ')}
          </p>
        )}
      </div>

      {data.violations.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Instrument violations</h3>
          <p className="muted">
            Numbers reported as measured that no instrument produced. Each was stripped
            back to a stated target before the output was saved.
          </p>
          <table>
            <thead><tr><th>Dept</th><th>Metric</th><th>Detail</th></tr></thead>
            <tbody>
              {data.violations.map((v, i) => (
                <tr key={i}>
                  <td className="mono">{v.departmentId}</td>
                  <td>{v.metric}</td>
                  <td className="muted">{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.outputs.map((output: DepartmentOutput) => (
        <div className="card" key={output.departmentId}>
          <div className="row">
            <strong>{output.departmentId}</strong>
            <span>{output.scores.length} scores · {output.targets.length} targets</span>
            <button style={{ marginLeft: 'auto' }}
              aria-expanded={open === output.departmentId}
              onClick={() => setOpen(open === output.departmentId ? undefined : output.departmentId)}>
              {open === output.departmentId ? 'Close' : 'Read'}
            </button>
          </div>

          {open === output.departmentId && (
            <div style={{ marginTop: 12 }}>
              <p style={{ whiteSpace: 'pre-wrap' }}>{output.body}</p>

              {output.targets.length > 0 && (
                <table>
                  <thead><tr><th>Metric</th><th>Target</th><th>Actual</th><th>Source</th></tr></thead>
                  <tbody>
                    {output.targets.map((t, i) => (
                      <tr key={i}>
                        <td>{t.metric}</td>
                        <td className="mono">{t.target}</td>
                        <td className="mono">{t.actual ?? '—'}</td>
                        <td className={t.source === 'instrument' ? 'pass mono' : 'muted mono'}>
                          {t.source === 'instrument' ? (t.instrument ?? 'instrument') : 'stated'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {output.compositions.map((c, i) => (
                <p key={i} className="muted">
                  <strong>{c.structure}</strong> — {c.eyePath}
                </p>
              ))}

              {output.instrumentCalls.length > 0 && (
                <p className="muted mono" style={{ fontSize: 13 }}>
                  instruments: {[...new Set(output.instrumentCalls)].join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
