import { describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { RunContext, RunStore, ensureLocalProject } from '@edsai/engine';
import {
  Executor, RehearsalClient, REHEARSAL_MODEL, TurnRefused, NO_USAGE, type ModelClient,
  type ModelRequest, type ModelResponse, type Usage,
} from '@edsai/executor';
import { runPipeline } from '../src/pipeline.js';
import { RunEvents } from '../src/events.js';
import { SUBMIT_TOOL_NAME } from '@edsai/executor';

/**
 * The loop between the engine and the executor, with a fake model.
 *
 * What this has to get right is not the model call — that is tested in the
 * executor — but what happens around it: that every activated department runs,
 * that a halt stops the run where it halted rather than leaving a hole, and
 * that resuming picks up rather than repeating.
 */

const rubric = buildRubric();

function fixture() {
  const store = new RunStore();
  const context = new RunContext({ rubric, store });
  const { project } = ensureLocalProject(store, 'Executor Test');
  const run = context.start({
    projectId: project.id,
    clientId: project.clientId,
    brief: '## Explicit\nA one-page site.',
    level: 0,
  });
  return { store, context, run };
}

const usage: Usage = { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 };

/** A model that always submits an acceptable output. */
function alwaysSubmits(): ModelClient {
  return {
    complete: async (): Promise<ModelResponse> => ({
      stopReason: 'tool-call',
      usage,
      content: [{
        type: 'tool-call', id: 't', name: SUBMIT_TOOL_NAME,
        input: { body: 'Output.', scores: [], targets: [], compositions: [], decisions: [] },
      }],
    }),
  };
}

/** A model that submits for a while, then stops producing anything. */
function failsAfter(successes: number): ModelClient {
  let done = 0;
  return {
    complete: async (): Promise<ModelResponse> => {
      const finished = done < successes;
      done += 1;
      return {
        stopReason: finished ? 'tool-call' : 'end',
        usage,
        content: finished
          ? [{
            type: 'tool-call', id: 't', name: SUBMIT_TOOL_NAME,
            input: { body: 'Output.', scores: [], targets: [], compositions: [], decisions: [] },
          }]
          : [{ type: 'text', text: 'I would rather not.' }],
      };
    },
  };
}

describe('running a whole run', () => {
  it('executes every activated department, in order', async () => {
    const { context, run, store } = fixture();
    const result = await runPipeline({
      context,
      executor: new Executor({ client: alwaysSubmits() }),
      events: new RunEvents(),
      runId: run.id,
    });

    expect(result.completed).toEqual(run.activatedDepartments);
    expect(result.halted).toBeUndefined();
    expect(store.getRun(run.id)?.status).toBe('pending');
    store.close();
  });

  it('stops where it stopped instead of leaving a hole', async () => {
    // Carrying on past a department that produced nothing gives a scorecard
    // with rows missing that nobody notices are missing.
    const { context, run, store } = fixture();
    const result = await runPipeline({
      context,
      executor: new Executor({ client: failsAfter(2) }),
      events: new RunEvents(),
      runId: run.id,
    });

    expect(result.completed).toHaveLength(2);
    expect(result.halted?.departmentId).toBe(run.activatedDepartments[2]);
    store.close();
  });

  it('resumes from where it halted rather than repeating paid work', async () => {
    const { context, run, store } = fixture();
    const events = new RunEvents();
    await runPipeline({
      context, executor: new Executor({ client: failsAfter(2) }), events, runId: run.id,
    });

    const second = await runPipeline({
      context, executor: new Executor({ client: alwaysSubmits() }), events, runId: run.id,
    });

    // The first two are already persisted, so the second pass does the rest.
    expect(second.completed).toEqual(run.activatedDepartments.slice(2));
    store.close();
  });

  it('persists the halt onto the run itself, not just the event nobody may be listening for', async () => {
    // A tab opened after the halt (or one that was never open) still has to
    // be able to read why the run stopped, from the run's own record.
    const { context, run, store } = fixture();
    await runPipeline({
      context, executor: new Executor({ client: failsAfter(1) }), events: new RunEvents(), runId: run.id,
    });

    const saved = store.getRun(run.id);
    expect(saved?.status).toBe('failed');
    expect(saved?.haltedReason).toBeTruthy();
    store.close();
  });

  it('clears the halt once a resume actually gets moving again', async () => {
    const { context, run, store } = fixture();
    const events = new RunEvents();
    await runPipeline({
      context, executor: new Executor({ client: failsAfter(1) }), events, runId: run.id,
    });
    expect(store.getRun(run.id)?.status).toBe('failed');

    await runPipeline({
      context, executor: new Executor({ client: alwaysSubmits() }), events, runId: run.id,
    });

    const resumed = store.getRun(run.id);
    expect(resumed?.status).not.toBe('failed');
    expect(resumed?.haltedReason).toBeUndefined();
    store.close();
  });

  it('adds up what the whole run cost', async () => {
    const { context, run, store } = fixture();
    const result = await runPipeline({
      context,
      executor: new Executor({
        client: alwaysSubmits(),
        estimateCost: (used) => (used.inputTokens + used.outputTokens) / 1000,
      }),
      events: new RunEvents(), runId: run.id,
    });

    expect(result.usage.inputTokens).toBe(10 * run.activatedDepartments.length);
    expect(result.cost).toBeGreaterThan(0);
    store.close();
  });

  it('prices each department with the model that actually ran it', async () => {
    const { context, run, store } = fixture();
    const premiumDepartment = run.activatedDepartments[0];
    const result = await runPipeline({
      context,
      executor: new Executor({
        client: alwaysSubmits(),
        model: 'balanced',
        modelFor: (turn) => turn.department.id === premiumDepartment ? 'premium' : 'balanced',
        estimateCost: (_used, model) => model === 'premium' ? 2 : 1,
      }),
      events: new RunEvents(), runId: run.id,
    });

    expect(result.cost).toBe(run.activatedDepartments.length + 1);
    store.close();
  });

  it('reports each department as it lands, so a long run is watchable', async () => {
    const { context, run, store } = fixture();
    const events = new RunEvents();
    const seen: string[] = [];
    const original = events.emit.bind(events);
    events.emit = (runId, type, data) => { seen.push(type); return original(runId, type, data); };

    await runPipeline({
      context, executor: new Executor({ client: alwaysSubmits() }), events, runId: run.id,
    });

    expect(seen[0]).toBe('pipeline.started');
    expect(seen.filter((t) => t === 'department.accepted')).toHaveLength(
      run.activatedDepartments.length,
    );
    expect(seen[seen.length - 1]).toBe('pipeline.finished');
    store.close();
  });

  it('says a halt is not retryable when the model refused', async () => {
    // A refusal will refuse again; a network failure will not. Telling them
    // apart is the difference between "try again" and "change something".
    const { context, run, store } = fixture();
    const events = new RunEvents();
    const halts: unknown[] = [];
    const original = events.emit.bind(events);
    events.emit = (runId, type, data) => {
      if (type === 'pipeline.halted') halts.push(data);
      return original(runId, type, data);
    };

    await runPipeline({
      context, executor: new Executor({ client: failsAfter(0) }), events, runId: run.id,
    });

    expect((halts[0] as { retryable: boolean }).retryable).toBe(false);
    store.close();
  });

  it('cancels between departments when asked to', async () => {
    const { context, run, store } = fixture();
    let started = 0;
    const result = await runPipeline({
      context,
      executor: new Executor({ client: alwaysSubmits() }),
      events: new RunEvents(),
      runId: run.id,
      isCancelled: () => { started += 1; return started > 3; },
    });

    expect(result.completed.length).toBeLessThan(run.activatedDepartments.length);
    expect(result.halted).toBeUndefined();
    expect(store.getRun(run.id)?.status).toBe('cancelled');
    store.close();
  });

  it('waits while paused, then continues without repeating work', async () => {
    const { context, run, store } = fixture();
    const events = new RunEvents();
    let pauseRequested = true;
    let wake: (() => void) | undefined;
    let reportPaused: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => { reportPaused = resolve; });
    const original = events.emit.bind(events);
    events.emit = (runId, type, data) => {
      if (type === 'pipeline.paused') reportPaused?.();
      return original(runId, type, data);
    };

    const running = runPipeline({
      context,
      executor: new Executor({ client: alwaysSubmits() }),
      events,
      runId: run.id,
      isPaused: () => pauseRequested,
      waitWhilePaused: () => new Promise((resolve) => { wake = resolve; }),
    });

    await paused;
    expect(store.getRun(run.id)?.status).toBe('paused');
    pauseRequested = false;
    wake?.();
    const result = await running;

    expect(result.completed).toEqual(run.activatedDepartments);
    expect(store.getRun(run.id)?.status).toBe('pending');
    expect(events.eventsFor(run.id).some((event) => event.type === 'pipeline.resumed')).toBe(true);
    store.close();
  });

  it('aborts an in-flight model request when stopped', async () => {
    const { context, run, store } = fixture();
    const abortController = new AbortController();
    let cancelRequested = false;
    let reportStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { reportStarted = resolve; });
    const client: ModelClient = {
      complete: (request: ModelRequest) => new Promise<ModelResponse>((_resolve, reject) => {
        reportStarted?.();
        const stop = (): void => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }));
        if (request.signal?.aborted) stop();
        else request.signal?.addEventListener('abort', stop, { once: true });
      }),
    };

    const running = runPipeline({
      context,
      executor: new Executor({ client }),
      events: new RunEvents(),
      runId: run.id,
      isCancelled: () => cancelRequested,
      signal: abortController.signal,
    });

    await started;
    cancelRequested = true;
    abortController.abort();
    const result = await running;

    expect(result.halted).toBeUndefined();
    expect(store.getRun(run.id)?.status).toBe('cancelled');
    expect(store.getOutputs(run.id)).toEqual([]);
    store.close();
  });

  it('rehearses a whole run without a model, and every output passes the engine', async () => {
    // The point of a rehearsal is that the engine cannot tell: every scored
    // department scores every dimension the rubric expects, no target claims a
    // measurement, and nothing is rejected on the way in.
    const { context, run, store } = fixture();
    const rejected: number[] = [];
    const events = new RunEvents();
    const original = events.emit.bind(events);
    events.emit = (runId, type, data) => {
      if (type === 'department.accepted') rejected.push((data as { rejected: number }).rejected);
      return original(runId, type, data);
    };

    const result = await runPipeline({
      context,
      executor: new Executor({
        model: REHEARSAL_MODEL, client: new RehearsalClient({ rubric, delayMs: 0 }),
      }),
      events,
      runId: run.id,
    });

    expect(result.completed).toEqual(run.activatedDepartments);
    expect(result.halted).toBeUndefined();
    expect(rejected.every((n) => n === 0)).toBe(true);
    // No published rate for a model that is not one, so no invented cost.
    expect(result.cost).toBeUndefined();
    // A rehearsal never becomes a brand.
    expect(store.getRun(run.id)?.determination ?? 'V1').not.toBe('FINAL');
    const first = store.getOutputs(run.id)[0];
    expect(first?.body.startsWith('> **Rehearsal.**')).toBe(true);
    store.close();
  });

  it('does nothing on a run whose departments are all done', async () => {
    const { context, run, store } = fixture();
    const executor = new Executor({ client: alwaysSubmits() });
    await runPipeline({ context, executor, events: new RunEvents(), runId: run.id });

    const again = await runPipeline({ context, executor, events: new RunEvents(), runId: run.id });
    expect(again.completed).toEqual([]);
    expect(again.usage).toEqual(NO_USAGE);
    store.close();
  });
});
