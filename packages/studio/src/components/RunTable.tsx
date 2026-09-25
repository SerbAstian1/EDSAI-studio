import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, CirclePause, CirclePlay, Compass, ExternalLink, RefreshCw, Square, Trash2,
} from 'lucide-react';
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
  const control = useMutation({
    mutationFn: async ({ id, action }: {
      id: string; action: 'pause' | 'continue' | 'stop';
    }): Promise<void> => {
      if (action === 'pause') await api.pauseRun(id);
      else if (action === 'continue') await api.continueRun(id);
      else await api.cancelRun(id);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['runs'] }); },
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
    <table className="stacky run-table">
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
          const running = run.executionState === 'running';
          const paused = run.executionState === 'paused' || run.status === 'paused';
          const stopping = run.executionState === 'stopping';
          const interrupted = run.status === 'running' && run.executionState === 'idle';
          const retry = run.status === 'failed' || run.status === 'cancelled' || interrupted;
          return (
            <tr key={run.id}>
              <td data-label="Run"><a className="mono" href={`#/run/${run.id}`}>{run.id}</a></td>
              <td data-label="Project">{named.get(run.projectId) ?? run.projectId}</td>
              <td className="mono" data-label="Level">{run.level}</td>
              <td className="mono" data-label="Progress">
                {done}/{total}
                <span className="meter" style={{ marginTop: 5 }}>
                  <i style={{ width: total === 0 ? '0%' : `${(done / total) * 100}%` }} />
                </span>
              </td>
              <td data-label="Determination">
                <span className={`pill ${determination === 'FINAL' ? 'pass' : 'minor'}`}>
                  {determination}
                </span>
              </td>
              <td className="actions">
                <OverflowMenu label={`Actions for run ${run.id}`} items={[
                  { label: 'Open run', icon: ExternalLink, onSelect: () => go(`#/run/${run.id}`) },
                  { label: 'Read the direction', icon: Compass, onSelect: () => go(`#/run/${run.id}/direction`) },
                  { label: 'Scorecard', icon: BarChart3, onSelect: () => go(`#/run/${run.id}/scorecard`) },
                  ...(unfinished && running ? [{
                    label: 'Pause run', icon: CirclePause, disabled: control.isPending,
                    onSelect: () => control.mutate({ id: run.id, action: 'pause' }),
                  }] : []),
                  ...(unfinished && paused ? [{
                    label: 'Continue run', icon: CirclePlay, disabled: control.isPending,
                    onSelect: () => control.mutate({ id: run.id, action: 'continue' }),
                  }] : []),
                  ...(unfinished && !running && !paused && !stopping ? [{
                    label: retry ? 'Retry run' : 'Start run',
                    icon: retry ? RefreshCw : CirclePlay, disabled: execute.isPending,
                    onSelect: () => execute.mutate(run.id),
                  }] : []),
                  ...(unfinished && (running || paused || stopping) ? [{
                    label: stopping ? 'Stopping run…' : 'Stop run',
                    icon: Square, danger: true, disabled: control.isPending || stopping,
                    onSelect: () => {
                      void requestConfirmation({
                        title: `Stop run ${run.id}?`,
                        message: 'The active request will be cancelled. Completed steps stay saved, and you can retry later.',
                        confirmLabel: 'Stop run',
                      }).then((confirmed) => {
                        if (confirmed) control.mutate({ id: run.id, action: 'stop' });
                      });
                    },
                  }] : []),
                  {
                    label: 'Delete run', icon: Trash2, danger: true,
                    disabled: remove.isPending || running || paused || stopping,
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
