import {
  runInstrument, comparatorFromProposal, type RunContext, type InstrumentCall,
} from '@edsai/engine';
import {
  Executor, TurnRefused, addUsage, diagnose, NO_USAGE, type Usage,
} from '@edsai/executor';
import type { RunEvents } from './events.js';

/**
 * Running a whole run.
 *
 * The engine knows which departments a run activates and refuses to accept an
 * output that breaks its rules. The executor knows how to get one department's
 * output from a model. This is the loop between them, and it is deliberately
 * the only place that knows a run is a sequence rather than a single turn.
 *
 * **It runs in the background and survives the tab.** A Level 1 run is
 * twenty-four departments; nobody is going to hold a request open for that, and
 * the SSE channel already exists to report progress with replay for a client
 * that reconnects. So this returns immediately and reports as it goes.
 *
 * **It stops at the first department that will not produce an output.** The
 * alternative — carry on and leave a hole — produces a run whose scorecard is
 * missing rows nobody will notice are missing. A halted run says where it
 * halted and can be resumed, because `prepare` reads only from the store and
 * the completed departments are already persisted.
 */

export interface PipelineResult {
  completed: number[];
  usage: Usage;
  cost?: number;
  halted?: { departmentId: number; reason: string };
}

export async function runPipeline(options: {
  context: RunContext;
  executor: Executor;
  events: RunEvents;
  runId: string;
  /** Checked before and after each provider request. */
  isCancelled?: () => boolean;
  /** Pauses before the next department, after preserving the current one. */
  isPaused?: () => boolean;
  /** Keeps a server-side run asleep until Continue or Stop wakes it. */
  waitWhilePaused?: () => Promise<void>;
  /** Stops an in-flight provider request when the adapter supports aborting. */
  signal?: AbortSignal;
}): Promise<PipelineResult> {
  const { context, executor, events, runId } = options;
  const completed: number[] = [];
  let usage = NO_USAGE;

  // A retry starts by clearing whatever the last attempt left behind — a run
  // reopened cold reads its own record, not a live event, so a halt that no
  // longer applies has to stop being reported the moment work resumes.
  const opening = context.store.getRun(runId);
  if (opening && !['running', 'complete', 'blocked'].includes(opening.status)) {
    context.store.saveRun({
      ...opening, status: 'running', haltedReason: undefined, haltedRetryable: undefined,
    });
  }

  events.emit(runId, 'pipeline.started', { model: executor.model });

  const cancelled = (): PipelineResult => {
    const current = context.store.getRun(runId);
    if (current) {
      context.store.saveRun({
        ...current, status: 'cancelled', haltedReason: undefined, haltedRetryable: undefined,
      });
    }
    events.emit(runId, 'pipeline.cancelled', { completed });
    const cost = executor.costOf(usage);
    return { completed, usage, ...(cost === undefined ? {} : { cost }) };
  };

  for (;;) {
    if (options.isCancelled?.()) return cancelled();

    if (options.isPaused?.()) {
      const current = context.store.getRun(runId);
      if (current) {
        context.store.saveRun({
          ...current, status: 'paused', haltedReason: undefined, haltedRetryable: undefined,
        });
      }
      events.emit(runId, 'pipeline.paused', { completed });
      if (!options.waitWhilePaused) {
        const cost = executor.costOf(usage);
        return { completed, usage, ...(cost === undefined ? {} : { cost }) };
      }
      await options.waitWhilePaused();
      if (options.isCancelled?.()) return cancelled();
      const resumed = context.store.getRun(runId);
      if (resumed) context.store.saveRun({ ...resumed, status: 'running' });
      events.emit(runId, 'pipeline.resumed', { completed });
      continue;
    }

    const turn = context.prepare(runId);
    if (!turn) {
      const cost = executor.costOf(usage);
      const current = context.store.getRun(runId);
      if (current && current.status !== 'complete' && current.status !== 'blocked') {
        context.store.saveRun({
          ...current, status: 'pending', haltedReason: undefined, haltedRetryable: undefined,
        });
      }
      events.emit(runId, 'pipeline.finished', {
        completed, usage, ...(cost === undefined ? {} : { cost }),
      });
      break;
    }

    // Collected per department and handed to `accept` together: the verifier
    // credits a measurement only against the calls made in that department's
    // own turn, so this list is what turns a claimed number into a checked one.
    const calls: InstrumentCall[] = [];

    try {
      const result = await executor.runDepartment(turn, (name, input) => {
        const output = runInstrument(name, input);
        calls.push({ instrument: name, input, output });
        return output;
      }, options.signal);

      usage = addUsage(usage, result.usage);
      if (options.isCancelled?.()) return cancelled();
      const accepted = context.accept(runId, turn.department.id, result.submission, calls);
      completed.push(turn.department.id);

      // Brands the department placed on the positioning chart. Saved as
      // proposals under the run and department that made them, so the chart
      // draws them apart from the client's computed point and the studio's
      // own placements, and a department run again replaces its own.
      const run = context.store.getRun(runId);
      for (const proposal of result.submission.comparators ?? []) {
        const comparator = run && comparatorFromProposal({
          clientId: run.clientId, runId, departmentId: turn.department.id,
          proposal, now: new Date().toISOString(),
        });
        if (comparator) context.store.saveComparator(comparator);
      }

      events.emit(runId, 'department.accepted', {
        departmentId: turn.department.id,
        name: turn.department.name,
        scores: accepted.output.scores.length,
        targets: accepted.output.targets.length,
        violations: accepted.violations.length,
        rejected: accepted.rejected.length,
        instrumentCalls: result.instrumentCalls,
        cost: result.cost,
        cacheHitRate: result.cacheHitRate,
      });
    } catch (error) {
      if (options.isCancelled?.() || options.signal?.aborted) return cancelled();
      // A refusal is about this department; anything else is about the world.
      // Both stop the run, and the difference decides whether retrying helps.
      const reason = error instanceof TurnRefused
        ? error.reason
        : error instanceof Error ? error.message : String(error);
      const diagnosis = diagnose(error);

      events.emit(runId, 'pipeline.halted', {
        departmentId: turn.department.id,
        reason,
        retryable: diagnosis.retryable,
        hint: diagnosis.hint,
        completed,
      });

      // Persisted, not just broadcast — a tab opened after the halt (or one
      // that was never listening) still has to be able to read why the run
      // stopped moving, from the run's own record rather than a stream
      // nobody caught.
      const current = context.store.getRun(runId);
      if (current) {
        context.store.saveRun({
          ...current, status: 'failed',
          haltedReason: diagnosis.hint ? `${reason} — ${diagnosis.hint}` : reason,
          haltedRetryable: diagnosis.retryable,
        });
      }
      const cost = executor.costOf(usage);
      return {
        completed,
        usage,
        ...(cost === undefined ? {} : { cost }),
        halted: { departmentId: turn.department.id, reason },
      };
    }
  }

  const cost = executor.costOf(usage);
  return { completed, usage, ...(cost === undefined ? {} : { cost }) };
}
