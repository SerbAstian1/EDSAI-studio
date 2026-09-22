import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Compass, ExternalLink, RotateCcw } from 'lucide-react';
import { api, type Run } from '../api.js';
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
 * A run is history and has no delete: the menu opens it, its direction and
 * its scorecard, and restarts one that stopped.
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
                ]} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
