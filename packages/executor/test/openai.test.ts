import { describe, expect, it } from 'vitest';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import {
  OPENAI_DEFAULT_MODEL,
  OpenAIModelClient,
  type OpenAIResponseCreator,
} from '../src/openai.js';
import type { ModelRequest } from '../src/protocol.js';

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  model: OPENAI_DEFAULT_MODEL,
  maxOutputTokens: 4096,
  effort: 'high',
  system: [
    { type: 'text', text: 'Stable rules.' },
    { type: 'text', text: 'Stable reference.', cache: true },
  ],
  tools: [{
    name: 'measure',
    description: 'Measure the value.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'number' } },
    },
  }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Measure this.' }] }],
  ...over,
});

const apiResponse = (over: Record<string, unknown> = {}): Response => ({
  error: null,
  incomplete_details: null,
  output: [],
  status: 'completed',
  ...over,
} as unknown as Response);

function fakeResponses(responses: Response[]): {
  responses: OpenAIResponseCreator;
  sent: ResponseCreateParamsNonStreaming[];
  options: Array<{ signal?: AbortSignal } | undefined>;
} {
  const sent: ResponseCreateParamsNonStreaming[] = [];
  const options: Array<{ signal?: AbortSignal } | undefined> = [];
  let index = 0;
  return {
    sent,
    options,
    responses: {
      create: async (params, requestOptions) => {
        sent.push(params);
        options.push(requestOptions);
        const response = responses[index];
        index += 1;
        if (!response) throw new Error('No fake OpenAI response remains.');
        return response;
      },
    },
  };
}

describe('OpenAI Responses adapter', () => {
  it('passes cancellation through to the provider request', async () => {
    const { responses, options } = fakeResponses([apiResponse()]);
    const abortController = new AbortController();

    await new OpenAIModelClient({ responses }).complete(request({ signal: abortController.signal }));

    expect(options[0]?.signal).toBe(abortController.signal);
  });

  it('maps the provider-neutral request to a private Responses API call', async () => {
    const { responses, sent } = fakeResponses([apiResponse()]);
    await new OpenAIModelClient({ responses }).complete(request());

    expect(sent[0]).toMatchObject({
      model: OPENAI_DEFAULT_MODEL,
      max_output_tokens: 4096,
      reasoning: { effort: 'high' },
      tool_choice: 'required',
      parallel_tool_calls: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
      tools: [{
        type: 'function',
        name: 'measure',
        description: 'Measure the value.',
        strict: true,
      }],
      input: [
        {
          role: 'developer',
          content: [
            { type: 'input_text', text: 'Stable rules.' },
            {
              type: 'input_text',
              text: 'Stable reference.',
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
        { role: 'user', content: [{ type: 'input_text', text: 'Measure this.' }] },
      ],
    });
  });

  it('turns function calls and token details into the executor protocol', async () => {
    const { responses } = fakeResponses([apiResponse({
      output: [{
        id: 'fc_1',
        type: 'function_call',
        status: 'completed',
        call_id: 'call_1',
        name: 'measure',
        arguments: '{"value":42}',
      }],
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 300, cache_write_tokens: 100 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 1_050,
      },
    })]);

    const response = await new OpenAIModelClient({ responses }).complete(request());

    expect(response.stopReason).toBe('tool-call');
    expect(response.content).toContainEqual({
      type: 'tool-call', id: 'call_1', name: 'measure', input: { value: 42 },
    });
    expect(response.content[0]?.type).toBe('opaque');
    expect(response.usage).toEqual({
      inputTokens: 600,
      outputTokens: 50,
      cacheCreationTokens: 100,
      cacheReadTokens: 300,
    });
  });

  it('replays raw reasoning and tool calls before appending tool results', async () => {
    const first = apiResponse({
      output: [
        {
          id: 'rs_1',
          type: 'reasoning',
          summary: [],
          encrypted_content: 'encrypted-state',
          status: 'completed',
        },
        {
          id: 'fc_1',
          type: 'function_call',
          status: 'completed',
          call_id: 'call_1',
          name: 'measure',
          arguments: '{"value":42}',
        },
      ],
    });
    const { responses, sent } = fakeResponses([first, apiResponse()]);
    const client = new OpenAIModelClient({ responses });
    const firstResult = await client.complete(request());

    await client.complete(request({
      messages: [
        ...request().messages,
        { role: 'assistant', content: firstResult.content },
        {
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_1',
            content: 'measurement failed',
            isError: true,
          }],
        },
      ],
    }));

    const input = sent[1]?.input;
    expect(Array.isArray(input)).toBe(true);
    const items = input as Array<Record<string, unknown>>;
    expect(items.filter((item) => item['type'] === 'reasoning')).toHaveLength(1);
    expect(items.filter((item) => item['type'] === 'function_call')).toHaveLength(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: 'reasoning', encrypted_content: 'encrypted-state',
    }));
    expect(items).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"error":"measurement failed"}',
    });
  });

  it('reports refusals and content-filter stops without retrying as normal text', async () => {
    const { responses } = fakeResponses([
      apiResponse({
        output: [{
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'refusal', refusal: 'I cannot do that.' }],
        }],
      }),
      apiResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
    ]);
    const client = new OpenAIModelClient({ responses });

    const response = await client.complete(request());
    expect(response.stopReason).toBe('refusal');
    expect(response.refusalReason).toBe('I cannot do that.');

    const filtered = await client.complete(request());
    expect(filtered.stopReason).toBe('refusal');
    expect(filtered.refusalReason).toMatch(/content filter/i);
  });

  it('maps policy failures to refusals and operational failures to diagnosable statuses', async () => {
    const { responses } = fakeResponses([
      apiResponse({
        status: 'failed',
        error: { code: 'misalignment_policy_violation', message: 'Policy stopped this response.' },
      }),
      apiResponse({
        status: 'failed',
        error: { code: 'rate_limit_exceeded', message: 'Slow down.' },
      }),
    ]);
    const client = new OpenAIModelClient({ responses });

    await expect(client.complete(request())).resolves.toMatchObject({
      stopReason: 'refusal', refusalReason: 'Policy stopped this response.',
    });
    await expect(client.complete(request())).rejects.toMatchObject({ status: 429 });
  });

  it('omits GPT-6 cache controls when the selected model does not support them', async () => {
    const { responses, sent } = fakeResponses([apiResponse()]);
    await new OpenAIModelClient({ responses }).complete(request({ model: 'gpt-4.1' }));

    expect(sent[0]?.prompt_cache_options).toBeUndefined();
    expect(JSON.stringify(sent[0]?.input)).not.toContain('prompt_cache_breakpoint');
  });

  it('rejects malformed function arguments instead of running a tool with guessed input', async () => {
    const { responses } = fakeResponses([apiResponse({
      output: [{
        type: 'function_call',
        call_id: 'call_bad',
        name: 'measure',
        arguments: '{bad json',
      }],
    })]);

    await expect(new OpenAIModelClient({ responses }).complete(request()))
      .rejects.toThrow(/invalid JSON arguments/);
  });
});
