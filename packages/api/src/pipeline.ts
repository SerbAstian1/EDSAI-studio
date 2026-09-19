import { runInstrument, type RunContext, type InstrumentCall } from '@edsai/engine';
import {
  Executor, TurnRefused, addUsage, costOf, diagnose, NO_USAGE, type Usage,
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
  /** Checked between departments so a stop request does not need to interrupt a call. */
  isCancelled?: () => boolean;
}): Promise<PipelineResult> {
  const { context, executor, events, runId } = options;
  const completed: number[] = [];
  let usage = NO_USAGE;

  events.emit(runId, 'pipeline.started', { model: executor.model });

  for (;;) {
    if (options.isCancelled?.()) {
      events.emit(runId, 'pipeline.cancelled', { completed });
      break;
    }

    const turn = context.prepare(runId);
    if (!turn) {
      events.emit(runId, 'pipeline.finished', {
        completed, usage, cost: costOf(usage, executor.model),
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
      });

      usage = addUsage(usage, result.usage);
      const accepted = context.accept(runId, turn.department.id, result.submission, calls);
      completed.push(turn.department.id);

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
      return {
        completed,
        usage,
        ...(costOf(usage, executor.model) === undefined
          ? {} : { cost: costOf(usage, executor.model) as number }),
        halted: { departmentId: turn.department.id, reason },
      };
    }
  }

  const cost = costOf(usage, executor.model);
  return { completed, usage, ...(cost === undefined ? {} : { cost }) };
}
