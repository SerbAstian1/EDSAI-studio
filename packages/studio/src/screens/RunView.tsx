import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState , type ReactElement } from 'react';
import { api, type ApiError, type DepartmentOutput } from '../api.js';
import Markdown from '../components/Markdown.js';
import { progress } from '../scorecard.js';

/**
 * Run view and department reader — progress, resume, and what each one produced.
 *
 * A run that isn't moving and a run that's working are indistinguishable from
 * the outside unless this says which — no model configured, a halt with a
 * reason, or genuinely in flight. "Resume execution" covers all three: the
 * server's own response says why, rather than this guessing in advance.
 */
export default function RunView({ runId }: { runId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['run', runId], queryFn: () => api.run(runId),
  });
  const { data: next } = useQuery({
    queryKey: ['next', runId], queryFn: () => api.next(runId),
  });
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: api.health });
  const rubric = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });
  // A run's own heading used to be its project's id. Nobody calls it that.
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const [open, setOpen] = useState<number | undefined>(undefined);

  const execute = useMutation({
    mutationFn: () => api.executeRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['next', runId] });
    },
  });

  if (isPending) return <p className="muted">Loading run…</p>;
  if (error) return <p className="err">Could not load this run. {(error as Error).message}</p>;

  const done = data.outputs.map((o) => o.departmentId);
  const p = progress(data.run.activatedDepartments, done);
  const halted = data.run.status === 'failed';

  const project = (projects.data ?? []).find((each) => each.id === data.run.projectId);
  const client = project
    ? (clients.data ?? []).find((each) => each.id === project.clientId)
    : undefined;

  return (
    <section className="stack">
      <div className="card">
        <div className="row">
          <h2>{project?.name ?? data.run.projectId}</h2>
          {client && <span className="muted">{client.name}</span>}
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
        {next?.done && (
          <p className="pass">
            Every activated department has an output.{' '}
            <a href={`#/run/${runId}/direction`} style={{ color: 'inherit' }}>Read it as direction →</a>
          </p>
        )}
        {p.remaining.length > 0 && (
          <p className="muted mono" style={{ fontSize: 13 }}>
            remaining: {p.remaining.join(', ')}
          </p>
        )}

        {halted && data.run.haltedReason && (
          <p className="err" style={{ marginTop: 10 }}>
            Stopped: {data.run.haltedReason}
            {data.run.haltedRetryable === false
              && ' — retrying won\'t change this on its own; it needs the cause fixed first.'}
          </p>
        )}
        {health?.rehearsal && (
          <p className="muted" style={{ marginTop: 10 }}>
            <strong>Rehearsal.</strong> This server moves runs without a model: each department
            lands with a placeholder output and placeholder scores, so the whole pipeline can be
            watched before a key is spent. Nothing it produces is a finding about the client.
          </p>
        )}
        {health && !health.executionEnabled && next?.done === false && (
          <p className="muted" style={{ marginTop: 10 }}>
            This server has no model configured, so this run will not proceed on its own.
            Set <span className="mono">ANTHROPIC_API_KEY</span> and restart it, then resume below.
          </p>
        )}

        {next?.done === false && (
          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            <button type="button" className="primary"
                    onClick={() => execute.mutate()} disabled={execute.isPending}>
              {execute.isPending ? 'Starting…' : halted ? 'Retry execution' : 'Start execution'}
            </button>
            {execute.error && (
              <span className="err">{(execute.error as ApiError).message}</span>
            )}
          </div>
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
            <strong>
              {output.departmentId}
              <span className="muted" style={{ fontWeight: 400 }}>
                {' '}{rubric.data?.departments.find((d) => d.id === output.departmentId)?.name ?? ''}
              </span>
            </strong>
            <span className="muted">{output.scores.length} scores · {output.targets.length} targets</span>
            <button style={{ marginLeft: 'auto' }}
              aria-expanded={open === output.departmentId}
              onClick={() => setOpen(open === output.departmentId ? undefined : output.departmentId)}>
              {open === output.departmentId ? 'Close' : 'Read'}
            </button>
          </div>

          {open === output.departmentId && (
            <div style={{ marginTop: 12 }}>
              <Markdown text={output.body} />

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
