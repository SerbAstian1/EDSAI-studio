import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Compass, ExternalLink, RotateCcw, Trash2 } from 'lucide-react';
import { api, type Run } from '../api.js';
import { requestConfirmation } from './ConfirmDialog.js';
import OverflowMenu from './OverflowMenu.js';
import { go } from './actions.js';

/**
 * The run table, in one place.
 *
 * The overview shows the most recent handful and the runs screen shows all of
 * them; the rows are identical, so the markup is written once. Two copies of a
 * table drift in exactly the way two copies of a rule do — one gains a column.
 *
 * The project column resolves its own name rather than printing the id the
 * database uses. Every caller already has the projects in cache, so this
 * costs a cache read, not a request.
 *
 * Deleting a run is available here regardless of how far it progressed. The
 * server refuses only a pipeline that is executing at that moment.
 */
export function RunTable({ runs }: { runs: readonly Run[] }): ReactElement {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const named = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const execute = useMutation({
    mutationFn: (id: string) => api.executeRun(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      go(`#/run/${id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRun(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: ['run', id], exact: true });
      queryClient.removeQueries({ queryKey: ['next', id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
    },
  });

  return (
    <table>
      <thead>
        <tr>
          <th>Run</th><th>Project</th><th>Level</th>
          <th>Progress</th><th>Determination</th><th />
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => {
          const total = run.activatedDepartments.length;
          const done = run.completed ?? 0;
          const determination = run.determination ?? run.version;
          const unfinished = done < total;
          return (
            <tr key={run.id}>
              <td><a className="mono" href={`#/run/${run.id}`}>{run.id}</a></td>
              <td>{named.get(run.projectId) ?? run.projectId}</td>
              <td className="mono">{run.level}</td>
              <td className="mono">
                {done}/{total}
                <span className="meter" style={{ marginTop: 5 }}>
                  <i style={{ width: total === 0 ? '0%' : `${(done / total) * 100}%` }} />
                </span>
              </td>
              <td>
                <span className={`pill ${determination === 'FINAL' ? 'pass' : 'minor'}`}>
                  {determination}
                </span>
              </td>
              <td className="actions">
                <OverflowMenu label={`Actions for run ${run.id}`} items={[
                  { label: 'Open run', icon: ExternalLink, onSelect: () => go(`#/run/${run.id}`) },
                  { label: 'Read the direction', icon: Compass, onSelect: () => go(`#/run/${run.id}/direction`) },
                  { label: 'Scorecard', icon: BarChart3, onSelect: () => go(`#/run/${run.id}/scorecard`) },
                  ...(unfinished ? [{
                    label: run.status === 'failed' ? 'Retry execution' : 'Resume execution',
                    icon: RotateCcw, disabled: execute.isPending,
                    onSelect: () => execute.mutate(run.id),
                  }] : []),
                  {
                    label: 'Delete run', icon: Trash2, danger: true, disabled: remove.isPending,
                    onSelect: () => {
                      void requestConfirmation({
                        title: `Delete run ${run.id}?`,
                        message: 'This permanently removes its outputs, scores, issues, conflicts, '
                          + 'rescores, and run-generated positioning points. Brand values already '
                          + 'copied into the Brand workspace remain. It cannot be undone.',
                        confirmLabel: 'Delete run',
                      }).then((confirmed) => { if (confirmed) remove.mutate(run.id); });
                    },
                  },
                ]} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
