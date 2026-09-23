import { describe, expect, it, vi } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import type { PreparedTurn } from '@edsai/engine';
import { Executor, TurnRefused } from '../src/executor.js';
import { diagnose } from '../src/failure.js';
import type {
  ModelClient, ModelContentBlock, ModelRequest, ModelResponse, ModelTextBlock, ModelToolCallBlock,
  ModelToolResultBlock,
} from '../src/protocol.js';
import { NO_USAGE, type Usage } from '../src/pricing.js';
import { SUBMIT_TOOL, SUBMIT_TOOL_NAME, submissionFrom } from '../src/submission.js';

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

const usage = (over: Partial<Usage> = {}): Usage => ({
  ...NO_USAGE,
  inputTokens: 100,
  outputTokens: 50,
  ...over,
});

const response = (over: Partial<ModelResponse> = {}): ModelResponse => ({
  content: [],
  stopReason: 'end',
  usage: usage(),
  ...over,
});

const submitBlock = (input: unknown): ModelToolCallBlock => ({
  type: 'tool-call',
  id: 'tu-submit',
  name: SUBMIT_TOOL_NAME,
  input,
});

function fakeClient(responses: ModelResponse[]): { client: ModelClient; sent: ModelRequest[] } {
  const sent: ModelRequest[] = [];
  let index = 0;
  return {
    sent,
    client: {
      complete: async (params) => {
        sent.push(params);
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        if (!next) throw new Error('the fake client has no response');
        return next;
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
    const { client } = fakeClient([response({ content: [finished], stopReason: 'tool-call' })]);
    const result = await new Executor({ client }).runDepartment(turn, () => ({}));

    expect(result.submission.body).toBe('The department output.');
    expect(result.submission.scores).toHaveLength(1);
    expect(result.instrumentCalls).toBe(0);
  });

  it('marks the stable prefix as cacheable and nothing after it', async () => {
    const { client, sent } = fakeClient([response({ content: [finished], stopReason: 'tool-call' })]);
    await new Executor({ client }).runDepartment(turn, () => ({}));

    const system = sent[0]?.system;
    expect(system?.map((block) => block.text)).toEqual(['CORE RULES', 'DEPARTMENT REFERENCE']);
    expect(system?.[0]?.cache).toBeUndefined();
    expect(system?.[1]?.cache).toBe(true);
  });

  it('keeps the volatile blocks out of the cacheable prefix', async () => {
    const { client, sent } = fakeClient([response({ content: [finished], stopReason: 'tool-call' })]);
    await new Executor({ client }).runDepartment(turn, () => ({}));

    const user = sent[0]?.messages[0]?.content as ModelTextBlock[];
    expect(user.map((block) => block.text)).toEqual(['THE BRIEF', 'Produce your output.']);
  });

  it('offers the instruments and the way to finish', async () => {
    const { client, sent } = fakeClient([response({ content: [finished], stopReason: 'tool-call' })]);
    await new Executor({ client }).runDepartment(turn, () => ({}));

    const names = (sent[0]?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain(SUBMIT_TOOL_NAME);
    expect(names.length).toBeGreaterThan(1);
  });

  it('runs an instrument and feeds the result back', async () => {
    const ask: ModelToolCallBlock = {
      type: 'tool-call', id: 'tu-1', name: 'contrast', input: { a: '#fff', b: '#000' },
    };
    const { client, sent } = fakeClient([
      response({ content: [ask], stopReason: 'tool-call' }),
      response({ content: [finished], stopReason: 'tool-call' }),
    ]);
    const callInstrument = vi.fn(() => ({ ratio: 21 }));

    const result = await new Executor({ client }).runDepartment(turn, callInstrument);

    expect(callInstrument).toHaveBeenCalledWith('contrast', { a: '#fff', b: '#000' });
    expect(result.instrumentCalls).toBe(1);
    const followUp = sent[1]?.messages ?? [];
    const results = followUp[followUp.length - 1]?.content as ModelToolResultBlock[];
    expect(results[0]?.content).toContain('21');
  });

  it('returns every result in one message, so parallel calls keep happening', async () => {
    const asks = ['a', 'b', 'c'].map((id): ModelToolCallBlock => ({
      type: 'tool-call', id, name: 'contrast', input: {},
    }));
    const { client, sent } = fakeClient([
      response({ content: asks, stopReason: 'tool-call' }),
      response({ content: [finished], stopReason: 'tool-call' }),
    ]);

    await new Executor({ client }).runDepartment(turn, () => ({ ratio: 1 }));

    const followUp = sent[1]?.messages ?? [];
    const results = followUp[followUp.length - 1]?.content as ModelToolResultBlock[];
    expect(results).toHaveLength(3);
  });

  it('hands a failing instrument back as an error instead of abandoning the turn', async () => {
    const ask: ModelToolCallBlock = { type: 'tool-call', id: 'tu-1', name: 'contrast', input: {} };
    const { client, sent } = fakeClient([
      response({ content: [ask], stopReason: 'tool-call' }),
      response({ content: [finished], stopReason: 'tool-call' }),
    ]);

    const result = await new Executor({ client }).runDepartment(turn, () => {
      throw new Error('that is not a colour');
    });

    const followUp = sent[1]?.messages ?? [];
    const results = followUp[followUp.length - 1]?.content as ModelToolResultBlock[];
    expect(results[0]?.isError).toBe(true);
    expect(results[0]?.content).toContain('not a colour');
    expect(result.submission.body).toBe('The department output.');
  });

  it('sends opaque assistant state back with the tool results', async () => {
    const opaque: ModelContentBlock = { type: 'opaque', value: { signature: 'sig' } };
    const ask: ModelToolCallBlock = { type: 'tool-call', id: 'tu-1', name: 'contrast', input: {} };
    const { client, sent } = fakeClient([
      response({ content: [opaque, ask], stopReason: 'tool-call' }),
      response({ content: [finished], stopReason: 'tool-call' }),
    ]);

    await new Executor({ client }).runDepartment(turn, () => ({}));

    const assistant = (sent[1]?.messages ?? [])[1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.content[0]?.type).toBe('opaque');
  });

  it('adds up usage across every round and delegates pricing to its adapter', async () => {
    const ask: ModelToolCallBlock = { type: 'tool-call', id: 'tu-1', name: 'contrast', input: {} };
    const { client } = fakeClient([
      response({ content: [ask], stopReason: 'tool-call', usage: usage({ inputTokens: 1000 }) }),
      response({ content: [finished], stopReason: 'tool-call', usage: usage({ inputTokens: 500 }) }),
    ]);

    const result = await new Executor({
      client,
      estimateCost: (used) => (used.inputTokens + used.outputTokens) / 1000,
    }).runDepartment(turn, () => ({}));
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.outputTokens).toBe(100);
    expect(result.cost ?? 0).toBeGreaterThan(0);
  });

  it('refuses rather than looping forever on an instrument', async () => {
    const ask: ModelToolCallBlock = { type: 'tool-call', id: 'tu-1', name: 'contrast', input: {} };
    const { client } = fakeClient([response({ content: [ask], stopReason: 'tool-call' })]);

    await expect(new Executor({ client, maxToolRounds: 3 }).runDepartment(turn, () => ({})))
      .rejects.toThrow(TurnRefused);
  });

  it('reports a declined request as a refusal, not a crash', async () => {
    const { client } = fakeClient([response({ stopReason: 'refusal', refusalReason: 'declined' })]);

    await expect(new Executor({ client }).runDepartment(turn, () => ({})))
      .rejects.toThrow(/declined/);
  });

  it('refuses a turn that stopped without submitting anything', async () => {
    const text: ModelContentBlock = { type: 'text', text: 'Here are my thoughts.' };
    const { client } = fakeClient([response({ content: [text], stopReason: 'end' })]);

    await expect(new Executor({ client }).runDepartment(turn, () => ({})))
      .rejects.toThrow(/never submitted/);
  });

  it('reports progress so a long run is not a blank screen', async () => {
    const events: string[] = [];
    const { client } = fakeClient([response({ content: [finished], stopReason: 'tool-call' })]);
    await new Executor({ client, onEvent: (event) => events.push(event.type) })
      .runDepartment(turn, () => ({}));

    expect(events).toEqual(['department-started', 'department-finished']);
  });
});

describe('reading the submission', () => {
  it('keeps every object in the strict submission schema closed and fully required', () => {
    const check = (schema: unknown): void => {
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
      const node = schema as Record<string, unknown>;
      if (node['type'] === 'object') {
        const properties = node['properties'] as Record<string, unknown>;
        expect(node['additionalProperties']).toBe(false);
        expect([...(node['required'] as string[])].sort()).toEqual(Object.keys(properties).sort());
        Object.values(properties).forEach(check);
      }
      check(node['items']);
    };

    check(SUBMIT_TOOL.inputSchema);
  });

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

  it('removes nullable strict-schema placeholders from optional fields', () => {
    const result = submissionFrom({
      body: 'x',
      targets: [{
        discipline: 'UI', metric: 'contrast', target: '4.5:1', actual: null,
        source: 'stated-target', mechanism: 'Use tested pairs.', pass: null, instrument: null,
      }],
      compositions: [{ structure: 'grid', family: null, eyePath: 'Left to right.' }],
    });

    expect(result.targets?.[0]).not.toHaveProperty('actual');
    expect(result.targets?.[0]).not.toHaveProperty('pass');
    expect(result.compositions?.[0]).not.toHaveProperty('family');
  });
});

describe('telling one failure from another', () => {
  const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

  it('says rejected credentials are not worth retrying', () => {
    const result = diagnose(apiError(401, 'credentials are invalid'));
    expect(result.retryable).toBe(false);
    expect(result.hint).toMatch(/credentials/i);
  });

  it('says a rate limit is worth retrying', () => {
    expect(diagnose(apiError(429, 'slow down')).retryable).toBe(true);
  });

  it('recognises running out of credit', () => {
    const result = diagnose(apiError(400, 'Your credit balance is too low'));
    expect(result.retryable).toBe(false);
    expect(result.hint).toMatch(/out of credit/i);
    expect(result.hint).toMatch(/resumes/);
  });

  it('separates a malformed request from an empty wallet', () => {
    const result = diagnose(apiError(400, 'messages.0: unexpected field'));
    expect(result.hint).toMatch(/bug here/);
  });

  it('says a refusal will refuse again', () => {
    const result = diagnose(new TurnRefused(1, 'declined'));
    expect(result.retryable).toBe(false);
    expect(result.hint).toMatch(/brief/);
  });

  it('retries a server failure and not a client one', () => {
    expect(diagnose(apiError(500, 'oops')).retryable).toBe(true);
    expect(diagnose(apiError(418, 'teapot')).retryable).toBe(false);
  });

  it('retries something it has never seen, because stopping forever is worse', () => {
    expect(diagnose(new Error('who knows')).retryable).toBe(true);
  });
});
