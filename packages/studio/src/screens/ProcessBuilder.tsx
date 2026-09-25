import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DepartmentOverride, type RubricSummary } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';

/**
 * Which departments this studio actually delivers.
 *
 * Not a new mechanism — `@edsai/rubric` already has `DeliveryScope`: exclude
 * a department outright, or keep it reduced for a stated reason. This is
 * that mechanism made editable and persistent, one row per department the
 * studio has an opinion about. A department with no row here just runs as
 * the corpus says.
 *
 * Reordering departments is deliberately not offered. Each department's
 * output can feed the next one downstream, and reordering that chain is a
 * pipeline change, not a delivery-scope one — a bigger, riskier piece of
 * work than this screen is.
 */

type Department = RubricSummary['departments'][number];

function StatusPill({ override }: { override: DepartmentOverride | undefined }): ReactElement {
  if (!override) return <span className="pill pass">Runs normally</span>;
  if (override.state === 'excluded') return <span className="pill Blocker">Excluded</span>;
  return <span className="pill minor">Reduced</span>;
}

function DepartmentRow({ department, override, onChanged }: {
  department: Department; override: DepartmentOverride | undefined; onChanged: () => void;
}): ReactElement {
  const [reducing, setReducing] = useState(false);
  const [reason, setReason] = useState(override?.reason ?? '');

  const exclude = useMutation({
    mutationFn: () => api.setProcessOverride(department.id, { state: 'excluded' }),
    onSuccess: onChanged,
  });

  const reduce = useMutation({
    mutationFn: () => api.setProcessOverride(department.id, { state: 'reduced', reason: reason.trim() }),
    onSuccess: () => { setReducing(false); onChanged(); },
  });

  const reset = useMutation({
    mutationFn: () => api.clearProcessOverride(department.id),
    onSuccess: () => { setReducing(false); onChanged(); },
  });

  return (
    <tr>
      <td>
        <span className="mono muted" style={{ marginRight: 8 }}>{department.id}</span>
        <strong>{department.name}</strong>
      </td>
      <td><StatusPill override={override} /></td>
      <td className="muted">
        {override?.state === 'reduced' && !reducing ? override.reason : null}
        {reducing && (
          <form className="row" style={{ gap: 6 }}
                onSubmit={(e) => { e.preventDefault(); if (reason.trim()) reduce.mutate(); }}>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="Why kept, and what it's reduced to…" aria-label="Reason"
                   className="process-reason" />
            <button type="submit" className="primary" disabled={!reason.trim() || reduce.isPending}>
              {reduce.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setReducing(false)}>Cancel</button>
          </form>
        )}
      </td>
      <td>
        {!reducing && (
          <div className="row" style={{ gap: 6 }}>
            {!override && (
              <>
                <button type="button" onClick={() => exclude.mutate()} disabled={exclude.isPending}>
                  Exclude
                </button>
                <button type="button" onClick={() => setReducing(true)}>Reduce…</button>
              </>
            )}
            {override && (
              <>
                {override.state === 'reduced' && (
                  <button type="button" onClick={() => setReducing(true)}>Edit reason</button>
                )}
                <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending}>
                  {reset.isPending ? 'Resetting…' : 'Reset'}
                </button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function ProcessBuilder(): ReactElement {
  const queryClient = useQueryClient();
  const rubric = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });
  const overrides = useQuery({ queryKey: ['process-overrides'], queryFn: api.processOverrides });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['process-overrides'] });
  };

  if (rubric.isPending || overrides.isPending) return <p className="muted">Loading process…</p>;
  if (rubric.error || overrides.error) {
    return (
      <ErrorPanel
        title="Could not load the process"
        error={rubric.error ?? overrides.error}
        onRetry={() => {
          void rubric.refetch();
          void overrides.refetch();
        }}
      />
    );
  }

  const overrideFor = new Map(overrides.data.map((o) => [o.departmentId, o]));
  const excludedCount = overrides.data.filter((o) => o.state === 'excluded').length;
  const reducedCount = overrides.data.filter((o) => o.state === 'reduced').length;

  return (
    <section className="stack">
      <div className="row">
        <h2>Process Builder</h2>
        <span className="muted mono">{rubric.data.departments.length}</span>
      </div>

      <p className="muted">
        {overrides.data.length === 0
          ? 'Every department in the corpus runs. Exclude one this studio does not practise, '
            + 'or reduce one to just the part that still applies — with a stated reason.'
          : `${excludedCount} excluded, ${reducedCount} reduced. Everything else runs as the corpus says.`}
      </p>

      {rubric.data.tracks.map((track) => {
        const departments = track.order
          .map((id) => rubric.data.departments.find((d) => d.id === id))
          .filter((d): d is Department => Boolean(d));
        if (departments.length === 0) return null;
        return (
          <div key={track.id} className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
            <span className="label">{track.name}</span>
            <table>
              <thead>
                <tr><th>Department</th><th>Status</th><th>Reason</th><th /></tr>
              </thead>
              <tbody>
                {departments.map((department) => (
                  <DepartmentRow
                    key={department.id}
                    department={department}
                    override={overrideFor.get(department.id)}
                    onChanged={invalidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
