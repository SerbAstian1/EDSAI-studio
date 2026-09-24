import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { CirclePause, CirclePlay, RefreshCw, Square } from 'lucide-react';
import { api, type ApiError, type DepartmentOutput } from '../api.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import Markdown from '../components/Markdown.js';
import { progress } from '../scorecard.js';

/**
 * Run progress and results, written for the person operating the studio.
 *
 * A run that isn't moving and a run that's working are indistinguishable from
 * the outside unless this says which — no model configured, a halt with a
 * reason, or genuinely in flight. Live state comes from the server, while the
 * completed steps stay in the database, so pause, retry and stop never repeat
 * work that already landed.
 */
export default function RunView({ runId }: { runId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
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

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['run', runId] });
    void queryClient.invalidateQueries({ queryKey: ['next', runId] });
    void queryClient.invalidateQueries({ queryKey: ['runs'] });
  };

  const execute = useMutation({
    mutationFn: () => api.executeRun(runId),
    onSuccess: refresh,
  });
  const control = useMutation({
    mutationFn: async (action: 'pause' | 'continue' | 'stop'): Promise<void> => {
      if (action === 'pause') await api.pauseRun(runId);
      else if (action === 'continue') await api.continueRun(runId);
      else await api.cancelRun(runId);
    },
    onSuccess: refresh,
  });

  if (isPending) return <p className="muted">Loading run…</p>;
  if (error) {
    return <ErrorPanel title="Could not load this run" error={error} onRetry={() => { void refetch(); }} />;
  }

  const done = data.outputs.map((o) => o.departmentId);
  const p = progress(data.run.activatedDepartments, done);
  const halted = data.run.status === 'failed';
  const cancelled = data.run.status === 'cancelled';
  const execution = data.run.executionState ?? 'idle';
  const paused = execution === 'paused' || data.run.status === 'paused';
  const running = execution === 'running';
  const stopping = execution === 'stopping';
  const interrupted = data.run.status === 'running' && execution === 'idle' && next?.done === false;
  const retryableState = halted || cancelled || interrupted;
  const actionPending = execute.isPending || control.isPending;

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
        </div>
        <p><strong>{p.done} of {p.total} steps complete</strong></p>
        <div className="meter"><i style={{ width: `${Math.round(p.share * 100)}%` }} /></div>

        {next?.done === false && (
          <p className="muted" style={{ marginTop: 10 }}>
            Up next: <strong>{next.name}</strong>
          </p>
        )}
        {next?.done && (
          <p className="pass">
            All work steps are complete.{' '}
            <a href={`#/run/${runId}/direction`} style={{ color: 'inherit' }}>Read the recommendations →</a>
          </p>
        )}

        {running && <p className="pass"><strong>Running now.</strong> You can pause or stop it.</p>}
        {paused && (
          <p className="muted"><strong>Paused.</strong> Completed work is saved. Continue when ready.</p>
        )}
        {stopping && <p className="muted"><strong>Stopping now.</strong> The active request is being cancelled.</p>}
        {interrupted && (
          <p className="err"><strong>The run lost its connection.</strong> Retry to continue from the last saved step.</p>
        )}
        {cancelled && (
          <p className="muted"><strong>Stopped.</strong> Completed work is still saved.</p>
        )}

        {halted && data.run.haltedReason && (
          <p className="err" style={{ marginTop: 10 }}>
            <strong>The run hit an error.</strong> {data.run.haltedReason}
            {data.run.haltedRetryable === false
              && ' Fix the stated problem before retrying, or the same error will happen again.'}
          </p>
        )}
        {health?.rehearsal && (
          <p className="muted" style={{ marginTop: 10 }}>
            <strong>Practice mode.</strong> These are placeholders, not real findings about the client.
          </p>
        )}
        {health && !health.executionEnabled && next?.done === false && (
          <p className="muted" style={{ marginTop: 10 }}>
            This server is not connected to an AI model. Add <span className="mono">OPENAI_API_KEY</span>
            {' '}on the server, restart it, then retry this run.
          </p>
        )}

        {next?.done === false && (
          <>
            <div className="row run-controls" style={{ marginTop: 10, gap: 10 }}>
              {(running || paused) && (
                <button type="button" className="primary" disabled={actionPending}
                        onClick={() => control.mutate(paused ? 'continue' : 'pause')}>
                  {paused
                    ? <><CirclePlay size={16} aria-hidden="true" /> Continue</>
                    : <><CirclePause size={16} aria-hidden="true" /> Pause</>}
                </button>
              )}
              {(running || paused || stopping) && (
                <button type="button" className="danger-button" disabled={actionPending || stopping}
                        onClick={() => {
                          void requestConfirmation({
                            title: 'Stop this run?',
                            message: 'The active request will be cancelled. Steps already completed stay saved, and you can retry later.',
                            confirmLabel: 'Stop run',
                          }).then((confirmed) => { if (confirmed) control.mutate('stop'); });
                        }}>
                  <Square size={14} aria-hidden="true" /> {stopping ? 'Stopping…' : 'Stop'}
                </button>
              )}
              {retryableState && !running && !paused && !stopping && (
                <button type="button" className="primary" disabled={actionPending}
                        onClick={() => execute.mutate()}>
                  <RefreshCw size={16} aria-hidden="true" /> {execute.isPending ? 'Retrying…' : 'Retry'}
                </button>
              )}
              {!retryableState && !running && !paused && !stopping && (
                <button type="button" className="primary" disabled={actionPending}
                        onClick={() => execute.mutate()}>
                  <CirclePlay size={16} aria-hidden="true" /> {execute.isPending ? 'Starting…' : 'Start'}
                </button>
              )}
            </div>
            {(execute.error || control.error) && (
              <p className="err">{((execute.error ?? control.error) as ApiError).message}</p>
            )}
          </>
        )}

        <details className="run-technical" style={{ marginTop: 12 }}>
          <summary>Technical details</summary>
          <dl className="facts" style={{ marginTop: 8 }}>
            <dt>Run level</dt><dd>{data.run.level}</dd>
            <dt>Scope</dt><dd className="mono">{data.run.scopeId}</dd>
            <dt>Status</dt><dd>{data.run.status}</dd>
            {next?.done === false && <><dt>Next step ID</dt><dd className="mono">{next.departmentId}</dd></>}
            {next?.estimate && (
              <><dt>Estimated input</dt><dd>About {Math.round(next.estimate.totalTokens / 1000)}K tokens</dd></>
            )}
            {p.remaining.length > 0 && (
              <><dt>Remaining IDs</dt><dd className="mono">{p.remaining.join(', ')}</dd></>
            )}
          </dl>
        </details>
      </div>

      {data.violations.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Numbers we could not verify</h3>
          <p className="muted">
            The AI described these as measured results without using a measurement tool.
            EDSAI kept each goal but removed the unverified result.
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
              {rubric.data?.departments.find((d) => d.id === output.departmentId)?.name
                ?? `Step ${output.departmentId}`}
            </strong>
            <span className="muted">
              {output.scores.length} quality checks · {output.targets.length} measurable goals
            </span>
            <button style={{ marginLeft: 'auto' }}
              aria-expanded={open === output.departmentId}
              onClick={() => setOpen(open === output.departmentId ? undefined : output.departmentId)}>
              {open === output.departmentId ? 'Hide details' : 'Read details'}
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
