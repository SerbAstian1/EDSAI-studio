import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseError,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputText,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';
import type {
  ModelClient,
  ModelContentBlock,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelTextBlock,
  ModelTool,
} from './protocol.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-6-astra';

export interface OpenAIResponseCreator {
  create(params: ResponseCreateParamsNonStreaming): Promise<Response>;
}

export interface OpenAIModelClientOptions {
  apiKey?: string;
  organization?: string;
  project?: string;
  responses?: OpenAIResponseCreator;
}

export class OpenAIModelClient implements ModelClient {
  private readonly responses: OpenAIResponseCreator;

  constructor(options: OpenAIModelClientOptions = {}) {
    if (options.responses) {
      this.responses = options.responses;
      return;
    }

    const client = new OpenAI({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.organization ? { organization: options.organization } : {}),
      ...(options.project ? { project: options.project } : {}),
    });
    this.responses = client.responses;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const explicitCache = supportsExplicitPromptCaching(request.model)
      && request.system.some((block) => block.cache);
    const response = await this.responses.create({
      model: request.model,
      input: responseInput(request, explicitCache),
      tools: request.tools.map(responseTool),
      tool_choice: 'required',
      parallel_tool_calls: true,
      max_output_tokens: request.maxOutputTokens,
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
      ...(explicitCache
        ? { prompt_cache_options: { mode: 'explicit' as const, ttl: '30m' as const } }
        : {}),
    });

    if (response.error) {
      if (isPolicyRefusal(response.error)) {
        return {
          ...modelResponse(response),
          stopReason: 'refusal',
          refusalReason: response.error.message,
        };
      }
      throw responseFailure(response.error);
    }
    if (response.status === 'failed') {
      throw new Error('OpenAI response failed without an error description.');
    }

    return modelResponse(response);
  }
}

function responseTool(tool: ModelTool): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: tool.strict ?? false,
  };
}

function responseInput(request: ModelRequest, explicitCache: boolean): ResponseInput {
  const input: ResponseInput = [];
  if (request.system.length > 0) {
    input.push({
      role: 'developer',
      content: request.system.map((block) => responseText(block, explicitCache)),
    });
  }

  for (const message of request.messages) {
    appendMessage(input, message);
  }
  return input;
}

function appendMessage(input: ResponseInput, message: ModelMessage): void {
  const opaque = message.content
    .filter((block) => block.type === 'opaque')
    .map((block) => block.value as ResponseOutputItem);

  if (opaque.length > 0) {
    input.push(...toResponseInputItems(opaque));
    if (message.role === 'assistant') return;
  }

  const text = message.content.filter((block): block is ModelTextBlock => block.type === 'text');
  if (text.length > 0) {
    input.push({
      role: message.role,
      content: text.map((block) => responseText(block, false)),
    });
  }

  for (const block of message.content) {
    if (block.type === 'tool-call') {
      input.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? null),
      });
    } else if (block.type === 'tool-result') {
      input.push({
        type: 'function_call_output',
        call_id: block.toolCallId,
        output: block.isError
          ? JSON.stringify({ error: block.content })
          : block.content,
      });
    }
  }
}

function responseText(block: ModelTextBlock, explicitCache: boolean): ResponseInputText {
  return {
    type: 'input_text',
    text: block.text,
    ...(explicitCache && block.cache
      ? { prompt_cache_breakpoint: { mode: 'explicit' as const } }
      : {}),
  };
}

function modelResponse(response: Response): ModelResponse {
  const content: ModelContentBlock[] = [];
  const refusals: string[] = [];
  let calledTool = false;

  for (const item of response.output) {
    content.push({ type: 'opaque', value: item });
    if (item.type === 'function_call') {
      calledTool = true;
      content.push({
        type: 'tool-call',
        id: item.call_id,
        name: item.name,
        input: toolArguments(item),
      });
    } else if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'output_text') content.push({ type: 'text', text: part.text });
        else if (part.type === 'refusal') refusals.push(part.refusal);
      }
    }
  }

  const filtered = response.incomplete_details?.reason === 'content_filter';
  const refused = refusals.length > 0 || filtered;
  const usage = response.usage;
  const cacheReadTokens = usage?.input_tokens_details.cached_tokens ?? 0;
  const cacheCreationTokens = usage?.input_tokens_details.cache_write_tokens ?? 0;

  return {
    content,
    stopReason: refused
      ? 'refusal'
      : calledTool
        ? 'tool-call'
        : response.incomplete_details?.reason ?? response.status ?? 'end',
    ...(refused
      ? {
        refusalReason: refusals.join('\n')
          || 'OpenAI stopped the response because of its content filter.',
      }
      : {}),
    ...(usage
      ? {
        usage: {
          inputTokens: Math.max(
            0,
            usage.input_tokens - cacheReadTokens - cacheCreationTokens,
          ),
          outputTokens: usage.output_tokens,
          cacheCreationTokens,
          cacheReadTokens,
        },
      }
      : {}),
  };
}

function toolArguments(call: ResponseFunctionToolCall): unknown {
  try {
    return JSON.parse(call.arguments) as unknown;
  } catch {
    throw new Error(`OpenAI returned invalid JSON arguments for tool "${call.name}".`);
  }
}

function supportsExplicitPromptCaching(model: string): boolean {
  return /^gpt-(?:6(?:[-.]|$)|5\.6(?:[-.]|$))/.test(model);
}

function isPolicyRefusal(error: ResponseError): boolean {
  return error.code === 'bio_policy' || error.code === 'misalignment_policy_violation';
}

function responseFailure(failure: ResponseError): Error & { status: number } {
  const status = failure.code === 'rate_limit_exceeded'
    ? 429
    : failure.code === 'server_error' || failure.code === 'vector_store_timeout'
      ? 503
      : 400;
  return Object.assign(
    new Error(`OpenAI response failed (${failure.code}): ${failure.message}`),
    { status },
  );
}
