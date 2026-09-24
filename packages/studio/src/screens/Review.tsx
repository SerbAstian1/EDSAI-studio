import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState , type ReactElement } from 'react';
import { api, type Severity } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { issueCounts, orderIssues } from '../scorecard.js';

const SEVERITIES: Severity[] = ['Blocker', 'Major', 'Minor', 'Nitpick'];

/** Problems and trade-offs that must be handled before the run can be finished. */
export default function Review({ runId }: { runId: string }): ReactElement {
  const client = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['run', runId], queryFn: () => api.run(runId),
  });

  const [severity, setSeverity] = useState<Severity>('Major');
  const [description, setDescription] = useState('');
  const [traced, setTraced] = useState('');
  const [fix, setFix] = useState('');

  const refresh = (): void => { void client.invalidateQueries({ queryKey: ['run', runId] }); };

  const addIssue = useMutation({
    mutationFn: () => api.saveIssue(runId, {
      id: `i${Date.now().toString(36)}`,
      severity, description,
      tracedTo: traced.split(',').map((n) => Number(n.trim())).filter(Number.isInteger),
      fix, status: 'open',
    }),
    onSuccess: () => { setDescription(''); setTraced(''); setFix(''); refresh(); },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: 'open' | 'resolved' | 'accepted' }) => {
      const issue = data?.issues.find((i) => i.id === input.id);
      if (!issue) throw new Error('issue not found');
      return api.saveIssue(runId, { ...issue, status: input.status });
    },
    onSuccess: refresh,
  });

  const resolveConflict = useMutation({
    mutationFn: (input: { id: string; resolution: string; whatWasLost: string }) => {
      const conflict = data?.conflicts.find((c) => c.id === input.id);
      if (!conflict) throw new Error('conflict not found');
      return api.saveConflict(runId, {
        ...conflict, resolution: input.resolution, whatWasLost: input.whatWasLost,
      });
    },
    onSuccess: refresh,
  });

  // `!data` without an error branch meant a failed fetch rendered "Loading
  // review…" for as long as the tab stayed open — the gate between V1 and
  // FINAL, apparently still loading, permanently.
  if (error) {
    return <ErrorPanel title="Could not load this review" error={error} onRetry={() => { void refetch(); }} />;
  }
  if (isPending || !data) return <p className="muted">Loading review…</p>;

  const counts = issueCounts(data.issues);
  // An untraced issue is not saveable: Department 9's own working method.
  const canSave = description.trim() && fix.trim() &&
    traced.split(',').some((n) => Number.isInteger(Number(n.trim())) && n.trim() !== '');

  return (
    <section className="stack">
      <div className="card">
        <h2>Issues</h2>
        <div className="row">
          {SEVERITIES.map((s) => (
            <span key={s} className={`pill ${s}`}>
              {s} {counts[s].open}/{counts[s].total}
            </span>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          The run cannot be finished while a critical or major problem is still open.
        </p>
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Log an issue</h3>
        <div className="row">
          <select value={severity} id="severity"
            onChange={(e) => setSeverity(e.target.value as Severity)} style={{ width: 'auto' }}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Related step numbers, e.g. 5, 8" value={traced} id="traced"
            onChange={(e) => setTraced(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        </div>
        <textarea rows={2} placeholder="What is wrong" value={description} id="description"
          onChange={(e) => setDescription(e.target.value)} />
        <textarea rows={2} placeholder="The fix" value={fix} id="fix"
          onChange={(e) => setFix(e.target.value)} />
        {!canSave && (description || fix || traced) && (
          <p className="muted">Add at least one related step number so the problem can be found again.</p>
        )}
        <div>
          <button className="primary" disabled={!canSave || addIssue.isPending}
            onClick={() => addIssue.mutate()}>Log issue</button>
        </div>
      </div>

      {orderIssues(data.issues).map((issue) => (
        <div className="card" key={issue.id}>
          <div className="row">
            <span className={`pill ${issue.severity}`}>{issue.severity}</span>
            <span className="muted mono">related steps {issue.tracedTo.join(', ')}</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>{issue.status}</span>
          </div>
          <p style={{ marginBottom: 4 }}>{issue.description}</p>
          <p className="muted">{issue.fix}</p>
          <div className="row">
            {issue.status === 'open' ? (
              <>
                <button onClick={() => setStatus.mutate({ id: issue.id, status: 'resolved' })}>
                  Mark resolved
                </button>
                <button onClick={() => setStatus.mutate({ id: issue.id, status: 'accepted' })}>
                  Accept as-is
                </button>
              </>
            ) : (
              <button onClick={() => setStatus.mutate({ id: issue.id, status: 'open' })}>Reopen</button>
            )}
          </div>
        </div>
      ))}

      <h2>Conflicts</h2>
      {data.conflicts.length === 0 && <p className="muted">None recorded.</p>}
      {data.conflicts.map((conflict) => (
        <ConflictRow key={conflict.id} conflict={conflict}
          onResolve={(resolution, whatWasLost) =>
            resolveConflict.mutate({ id: conflict.id, resolution, whatWasLost })} />
      ))}
    </section>
  );
}

function ConflictRow({ conflict, onResolve }: {
  conflict: { id: string; departments: number[]; description: string;
              resolution?: string; whatWasLost?: string };
  onResolve(resolution: string, whatWasLost: string): void;
}): ReactElement {
  const [resolution, setResolution] = useState(conflict.resolution ?? '');
  const [lost, setLost] = useState(conflict.whatWasLost ?? '');
  const complete = Boolean(conflict.resolution?.trim() && conflict.whatWasLost?.trim());

  return (
    <div className="card stack">
      <div className="row">
        <strong className="mono">{conflict.departments.join(' ↔ ')}</strong>
        <span className={complete ? 'pass' : 'major'} style={{ marginLeft: 'auto' }}>
          {complete ? 'resolved' : 'open'}
        </span>
      </div>
      <p style={{ margin: 0 }}>{conflict.description}</p>

      <textarea rows={2} placeholder="Resolution" value={resolution}
        id={`res-${conflict.id}`} onChange={(e) => setResolution(e.target.value)} />
      <textarea rows={2} placeholder="What did this choice give up?"
        id={`lost-${conflict.id}`} value={lost} onChange={(e) => setLost(e.target.value)} />

      {resolution.trim() && !lost.trim() && (
        <p className="muted">
          Explain the trade-off: what became weaker when you chose this solution?
        </p>
      )}
      <div>
        <button className="primary" disabled={!resolution.trim() || !lost.trim()}
          onClick={() => onResolve(resolution, lost)}>Save resolution</button>
      </div>
    </div>
  );
}
