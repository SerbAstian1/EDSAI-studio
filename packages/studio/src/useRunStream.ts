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
      // A halt changes nothing department-level, so nothing else here would
      // ever trigger a refetch — without this, a run that stops moving looks
      // identical, live, to one still quietly in progress.
      'pipeline.started', 'pipeline.halted', 'pipeline.finished', 'pipeline.cancelled',
      'pipeline.pause-requested', 'pipeline.paused',
      'pipeline.continue-requested', 'pipeline.resumed', 'pipeline.stop-requested',
    ]) {
      source.addEventListener(type, refresh);
    }

    // A slow poll underneath the stream. Behind a proxy that buffers or
    // times out server-sent events (a static host rewriting `/api` to the
    // API is one), the stream can go quiet while the run does not; a refetch
    // every so often keeps the screen truthful either way, at the cost of
    // one small request a while.
    const poll = setInterval(refresh, 20_000);

    return () => { source.close(); clearInterval(poll); };
  }, [runId, client]);
}
