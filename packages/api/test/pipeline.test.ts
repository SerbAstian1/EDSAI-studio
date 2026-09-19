import { describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { RunContext, RunStore, ensureLocalProject } from '@edsai/engine';
import { Executor, TurnRefused, NO_USAGE, type ModelClient } from '@edsai/executor';
import type Anthropic from '@anthropic-ai/sdk';
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

const usage = { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage;

/** A model that always submits an acceptable output. */
function alwaysSubmits(): ModelClient {
  return {
    messages: {
      stream: () => ({
        finalMessage: async () => ({
          id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5',
          stop_reason: 'tool_use', stop_sequence: null, usage,
          content: [{
            type: 'tool_use', id: 't', name: SUBMIT_TOOL_NAME,
            input: { body: 'Output.', scores: [], targets: [], compositions: [], decisions: [] },
          }],
        } as Anthropic.Message),
      }),
    },
  };
}

/** A model that submits for a while, then stops producing anything. */
function failsAfter(successes: number): ModelClient {
  let done = 0;
  return {
    messages: {
      stream: () => ({
        finalMessage: async () => {
          const finished = done < successes;
          done += 1;
          return {
            id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5',
            stop_reason: finished ? 'tool_use' : 'end_turn', stop_sequence: null, usage,
            content: finished
              ? [{
                type: 'tool_use', id: 't', name: SUBMIT_TOOL_NAME,
                input: { body: 'Output.', scores: [], targets: [], compositions: [], decisions: [] },
              }]
              : [{ type: 'text', text: 'I would rather not.', citations: null }],
          } as Anthropic.Message;
        },
      }),
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

  it('adds up what the whole run cost', async () => {
    const { context, run, store } = fixture();
    const result = await runPipeline({
      context, executor: new Executor({ client: alwaysSubmits() }),
      events: new RunEvents(), runId: run.id,
    });

    expect(result.usage.inputTokens).toBe(10 * run.activatedDepartments.length);
    expect(result.cost).toBeGreaterThan(0);
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

  it('stops between departments when asked to, without interrupting a call', async () => {
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
