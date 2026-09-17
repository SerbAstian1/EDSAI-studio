import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Subscribe to a run's event stream and invalidate on change.
 *
 * The run executes server-side and survives having no listener, so this is a
 * view onto progress rather than the thing driving it — closing the tab does
 * not stop a twenty-minute run. EventSource reconnects on its own and sends
 * `Last-Event-ID`, which the server uses to replay what was missed; without
 * that replay a dropped connection shows a run that looks stalled.
 */
export function useRunStream(runId: string | undefined): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!runId) return;
    if (typeof EventSource === 'undefined') return;

    const source = new EventSource(`/api/runs/${runId}/stream`);
    const refresh = (): void => {
      void client.invalidateQueries({ queryKey: ['run', runId] });
      void client.invalidateQueries({ queryKey: ['next', runId] });
    };

    for (const type of [
      'department.accepted', 'issue.saved', 'conflict.saved',
      'score.rescored', 'run.finalized',
    ]) {
      source.addEventListener(type, refresh);
    }

    return () => source.close();
  }, [runId, client]);
}
