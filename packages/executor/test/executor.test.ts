import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildRubric } from '@edsai/rubric';
import { Executor, TurnRefused, type ModelClient } from '../src/executor.js';
import { SUBMIT_TOOL_NAME, submissionFrom } from '../src/submission.js';
import { diagnose } from '../src/failure.js';
import type { PreparedTurn } from '@edsai/engine';

/**
 * The loop, proven without spending anything.
 *
 * A fake client returns the responses a real one would. That is the only way
 * to hold this code to its contract at all: every alternative costs money per
 * assertion, and a test nobody can afford to run is a test nobody runs.
 */

const rubric = buildRubric();
const department = rubric.departments[0];
if (!department) throw new Error('the rubric has no departments');

const turn: PreparedTurn = {
  runId: 'r1',
  department,
  prompt: {
    blocks: [
      { stable: true, label: 'skill-core', text: 'CORE RULES' },
      { stable: true, label: 'department', text: 'DEPARTMENT REFERENCE' },
      { stable: false, label: 'brief', text: 'THE BRIEF' },
    ],
    cacheBreakpoint: 1,
    system: 'unused here',
    user: 'Produce your output.',
  },
  tools: [],
  estimate: { stableTokens: 100, volatileTokens: 10, totalTokens: 110 },
  position: { index: 1, total: 24 },
} as PreparedTurn;

const usage = (over: Partial<Anthropic.Usage> = {}): Anthropic.Usage => ({
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  ...over,
} as Anthropic.Usage);

const message = (over: Partial<Anthropic.Message>): Anthropic.Message => ({
  id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [], stop_reason: 'end_turn', stop_sequence: null, usage: usage(),
  ...over,
} as Anthropic.Message);

const submitBlock = (input: unknown): Anthropic.ToolUseBlock => ({
  type: 'tool_use', id: 'tu-submit', name: SUBMIT_TOOL_NAME, input,
} as Anthropic.ToolUseBlock);

/** A client that replays the given responses, recording what it was sent. */
function fakeClient(responses: Anthropic.Message[]): {
  client: ModelClient; sent: Anthropic.MessageStreamParams[];
} {
  const sent: Anthropic.MessageStreamParams[] = [];
  let index = 0;
  return {
    sent,
    client: {
      messages: {
        stream(params) {
          sent.push(params);
          const response = responses[Math.min(index, responses.length - 1)];
          index += 1;
          return { finalMessage: async () => response as Anthropic.Message };
        },
      },
    },
  };
}

const finished = submitBlock({
  body: 'The department output.',
  scores: [{ dimension: 'Clarity', value: 8, justification: 'Reads plainly.', inverse: false }],
  targets: [], compositions: [], decisions: [],
});

describe('running one department', () => {
  it('returns the submission the model handed to the submit tool', async () => {
    const { client } = fakeClient([message({ content: [finished], stop_reason: 'tool_use' })]);
    const result = await new Executor({ client }).runDepartment(turn, () => ({}));

    expect(result.submission.body).toBe('The department output.');
    expect(result.submission.scores).toHaveLength(1);
    expect(result.instrumentCalls).toBe(0);
  });

  it('caches the stable prefix and nothing after it', async () => {
    // The corpus prefix is the same on every department of a run. Paying for
    // it twenty-four times instead of once is the whole cost of getting this
    // wrong, and it is invisible unless something checks.
    const { client, sent } = fakeClient([message({ content: [finished], stop_reason: 'tool_use' })]);
    await new Executor({ client }).runDepartment(turn, () => ({}));

    const system = sent[0]?.system as Anthropic.TextBlockParam[];
    expect(system.map((b) => b.text)).toEqual(['CORE RULES', 'DEPARTMENT REFERENCE']);
    expect(system[0]?.cache_control).toBeUndefined();
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('keeps the volatile blocks out of the cached prefix', async () => {
    const { client, sent } = fakeClient([message({ content: [finished], stop_reason: 'tool_use' })]);
    await new Executor({ client }).runDepartment(turn, () => ({}));

    const user = sent[0]?.messages[0]?.content as Anthropic.TextBlockParam[];
    expect(user.map((b) => b.text)).toEqual(['THE BRIEF', 'Produce your output.']);
  });

  it('offers the instruments and the way to finish', async () => {
    const { client, sent } = fakeClient([message({ content: [finished], stop_reason: 'tool_use' })]);
    await new Executor({ client }).runDepartment(turn, () => ({}));

    const names = (sent[0]?.tools ?? []).map((t) => (t as Anthropic.Tool).name);
    expect(names).toContain(SUBMIT_TOOL_NAME);
    expect(names.length).toBeGreaterThan(1);
  });

  it('runs an instrument and feeds the result back', async () => {
    const ask: Anthropic.ToolUseBlock = {
      type: 'tool_use', id: 'tu-1', name: 'contrast', input: { a: '#fff', b: '#000' },
    } as Anthropic.ToolUseBlock;
    const { client, sent } = fakeClient([
      message({ content: [ask], stop_reason: 'tool_use' }),
      message({ content: [finished], stop_reason: 'tool_use' }),
    ]);
    const callInstrument = vi.fn(() => ({ ratio: 21 }));

    const result = await new Executor({ client }).runDepartment(turn, callInstrument);

    expect(callInstrument).toHaveBeenCalledWith('contrast', { a: '#fff', b: '#000' });
    expect(result.instrumentCalls).toBe(1);
    const followUp = sent[1]?.messages ?? [];
    const results = followUp[followUp.length - 1]?.content as Anthropic.ToolResultBlockParam[];
    expect(results[0]?.content).toContain('21');
  });

  it('returns every result in one message, so parallel calls keep happening', async () => {
    // Splitting tool results across messages quietly teaches the model to stop
    // asking for instruments in parallel.
    const asks = ['a', 'b', 'c'].map((id) => ({
      type: 'tool_use', id, name: 'contrast', input: {},
    } as Anthropic.ToolUseBlock));
    const { client, sent } = fakeClient([
      message({ content: asks, stop_reason: 'tool_use' }),
      message({ content: [finished], stop_reason: 'tool_use' }),
    ]);

    await new Executor({ client }).runDepartment(turn, () => ({ ratio: 1 }));

    const followUp = sent[1]?.messages ?? [];
    const results = followUp[followUp.length - 1]?.content as Anthropic.ToolResultBlockParam[];
    expect(results).toHaveLength(3);
  });

  it('hands a failing instrument back as an error instead of abandoning the turn', async () => {
    // An instrument that refused is information the department can act on —
    // usually by stating a target rather than claiming a measurement.
    const ask = { type: 'tool_use', id: 'tu-1', name: 'contrast', input: {} } as Anthropic.ToolUseBlock;
    const { client, sent } = fakeClient([
      message({ content: [ask], stop_reason: 'tool_use' }),
      message({ content: [finished], stop_reason: 'tool_use' }),
    ]);

    const result = await new Executor({ client }).runDepartment(turn, () => {
      throw new Error('that is not a colour');
    });

    const followUp = sent[1]?.messages ?? [];
    const results = followUp[followUp.length - 1]?.content as Anthropic.ToolResultBlockParam[];
    expect(results[0]?.is_error).toBe(true);
    expect(results[0]?.content).toContain('not a colour');
    expect(result.submission.body).toBe('The department output.');
  });

  it('sends the assistant turn back whole, thinking included', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' } as Anthropic.ThinkingBlock;
    const ask = { type: 'tool_use', id: 'tu-1', name: 'contrast', input: {} } as Anthropic.ToolUseBlock;
    const { client, sent } = fakeClient([
      message({ content: [thinking, ask], stop_reason: 'tool_use' }),
      message({ content: [finished], stop_reason: 'tool_use' }),
    ]);

    await new Executor({ client }).runDepartment(turn, () => ({}));

    const assistant = (sent[1]?.messages ?? [])[1];
    expect(assistant?.role).toBe('assistant');
    expect((assistant?.content as Anthropic.ContentBlock[])[0]?.type).toBe('thinking');
  });

  it('adds up what every round of the turn cost', async () => {
    const ask = { type: 'tool_use', id: 'tu-1', name: 'contrast', input: {} } as Anthropic.ToolUseBlock;
    const { client } = fakeClient([
      message({ content: [ask], stop_reason: 'tool_use', usage: usage({ input_tokens: 1000 }) }),
      message({ content: [finished], stop_reason: 'tool_use', usage: usage({ input_tokens: 500 }) }),
    ]);

    const result = await new Executor({ client }).runDepartment(turn, () => ({}));
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.outputTokens).toBe(100);
    expect(result.cost).toBeGreaterThan(0);
  });

  it('refuses rather than looping forever on an instrument', async () => {
    const ask = { type: 'tool_use', id: 'tu-1', name: 'contrast', input: {} } as Anthropic.ToolUseBlock;
    const { client } = fakeClient([message({ content: [ask], stop_reason: 'tool_use' })]);

    await expect(new Executor({ client, maxToolRounds: 3 }).runDepartment(turn, () => ({})))
      .rejects.toThrow(TurnRefused);
  });

  it('reports a declined request as a refusal, not a crash', async () => {
    const { client } = fakeClient([message({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' },
    } as Partial<Anthropic.Message>)]);

    await expect(new Executor({ client }).runDepartment(turn, () => ({})))
      .rejects.toThrow(/declined/);
  });

  it('refuses a turn that stopped without submitting anything', async () => {
    const text = { type: 'text', text: 'Here are my thoughts.', citations: null } as Anthropic.TextBlock;
    const { client } = fakeClient([message({ content: [text], stop_reason: 'end_turn' })]);

    await expect(new Executor({ client }).runDepartment(turn, () => ({})))
      .rejects.toThrow(/never submitted/);
  });

  it('reports progress so a twenty-minute run is not a blank screen', async () => {
    const events: string[] = [];
    const { client } = fakeClient([message({ content: [finished], stop_reason: 'tool_use' })]);
    await new Executor({ client, onEvent: (e) => events.push(e.type) })
      .runDepartment(turn, () => ({}));

    expect(events).toEqual(['department-started', 'department-finished']);
  });
});

describe('reading the submission', () => {
  it('drops an empty list rather than storing one', () => {
    const result = submissionFrom({ body: 'x', scores: [], targets: [], compositions: [], decisions: [] });
    expect(result).toEqual({ body: 'x' });
  });

  it('keeps a list that has something in it', () => {
    const result = submissionFrom({ body: 'x', scores: [{ dimension: 'd' }] });
    expect(result.scores).toHaveLength(1);
  });

  it('survives a body that is not a string', () => {
    expect(submissionFrom({ body: 42 }).body).toBe('');
    expect(submissionFrom(null).body).toBe('');
  });
});

describe('telling one failure from another', () => {
  const apiError = (Class: new (...a: never[]) => Error, status: number, message: string): Error =>
    Object.assign(Object.create(Class.prototype) as Error, { status, message, name: Class.name });

  it('says an invalid key is not worth retrying', async () => {
    // Found live, not reasoned about: a real 401 came back and the advice
    // underneath it said "this looks retryable", which would have failed
    // identically every time.
    const { AuthenticationError } = await import('@anthropic-ai/sdk');
    const result = diagnose(apiError(AuthenticationError, 401, 'API key is invalid.'));
    expect(result.retryable).toBe(false);
    expect(result.hint).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('says a rate limit is worth retrying', async () => {
    const { RateLimitError } = await import('@anthropic-ai/sdk');
    expect(diagnose(apiError(RateLimitError, 429, 'slow down')).retryable).toBe(true);
  });

  it('recognises running out of credit, which is how this project actually fails', async () => {
    const { BadRequestError } = await import('@anthropic-ai/sdk');
    const result = diagnose(apiError(BadRequestError, 400, 'Your credit balance is too low'));
    expect(result.retryable).toBe(false);
    expect(result.hint).toMatch(/out of credit/i);
    expect(result.hint).toMatch(/resumes/);
  });

  it('separates a malformed request from an empty wallet', async () => {
    const { BadRequestError } = await import('@anthropic-ai/sdk');
    const result = diagnose(apiError(BadRequestError, 400, 'messages.0: unexpected field'));
    expect(result.hint).toMatch(/bug here/);
  });

  it('says a refusal will refuse again', () => {
    const result = diagnose(new TurnRefused(1, 'declined'));
    expect(result.retryable).toBe(false);
    expect(result.hint).toMatch(/brief/);
  });

  it('retries a server failure and not a client one', async () => {
    const { InternalServerError, APIError } = await import('@anthropic-ai/sdk');
    expect(diagnose(apiError(InternalServerError, 500, 'oops')).retryable).toBe(true);
    expect(diagnose(apiError(APIError, 418, 'teapot')).retryable).toBe(false);
  });

  it('retries something it has never seen, because stopping forever is worse', () => {
    expect(diagnose(new Error('who knows')).retryable).toBe(true);
  });
});
