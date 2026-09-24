import { INSTRUMENT_TOOLS } from '@edsai/instruments';
import type { PreparedTurn, Submission } from '@edsai/engine';
import type {
  ModelClient, ModelMessage, ModelRequest, ModelResponse, ModelTextBlock, ModelToolCallBlock,
  ModelToolResultBlock,
} from './protocol.js';
import { SUBMIT_TOOL, SUBMIT_TOOL_NAME, submissionFrom } from './submission.js';
import {
  addUsage, cacheHitRate, NO_USAGE, type CostEstimator, type Usage,
} from './pricing.js';

export type {
  ModelClient, ModelContentBlock, ModelMessage, ModelRequest, ModelResponse, ModelTextBlock,
  ModelTool, ModelToolCallBlock, ModelToolResultBlock,
} from './protocol.js';

export interface ExecutorOptions {
  client?: ModelClient;
  model?: string;
  effort?: ModelRequest['effort'];
  maxToolRounds?: number;
  estimateCost?: CostEstimator;
  onEvent?: (event: ExecutorEvent) => void;
}

export type ExecutorEvent =
  | { type: 'department-started'; departmentId: number; name: string; index: number; total: number }
  | { type: 'instrument-called'; departmentId: number; name: string; ok: boolean }
  | { type: 'department-finished'; departmentId: number; usage: Usage; cost?: number }
  | { type: 'refused'; departmentId: number; reason: string };

export interface TurnResult {
  submission: Submission;
  usage: Usage;
  cost?: number;
  cacheHitRate: number;
  instrumentCalls: number;
  model: string;
}

export class TurnRefused extends Error {
  constructor(readonly departmentId: number, readonly reason: string) {
    super(`Department ${departmentId} did not produce an output: ${reason}`);
    this.name = 'TurnRefused';
  }
}

const MAX_TOKENS = 64_000;
const DEFAULT_MODEL = 'custom';
const DEFAULT_TOOL_ROUNDS = 12;

export class Executor {
  private readonly client: ModelClient;
  readonly model: string;
  private readonly effort: ExecutorOptions['effort'];
  private readonly maxToolRounds: number;
  private readonly estimateCost: CostEstimator | undefined;
  private readonly onEvent: (event: ExecutorEvent) => void;

  constructor(options: ExecutorOptions = {}) {
    if (!options.client) {
      throw new Error('An execution client is required. Configure a model adapter or use rehearsal mode.');
    }
    this.client = options.client;
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort;
    this.maxToolRounds = options.maxToolRounds ?? DEFAULT_TOOL_ROUNDS;
    this.estimateCost = options.estimateCost;
    this.onEvent = options.onEvent ?? (() => {});
  }

  async runDepartment(
    turn: PreparedTurn,
    callInstrument: (name: string, input: unknown) => unknown,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    this.onEvent({
      type: 'department-started',
      departmentId: turn.department.id,
      name: turn.department.name,
      index: turn.position.index,
      total: turn.position.total,
    });

    const messages: ModelMessage[] = [
      { role: 'user', content: this.userContent(turn) },
    ];
    let usage = NO_USAGE;
    let instrumentCalls = 0;

    for (let round = 0; round <= this.maxToolRounds; round += 1) {
      const response = await this.send(turn, messages, signal);
      usage = addUsage(usage, readUsage(response));

      if (response.stopReason === 'refusal') {
        const reason = response.refusalReason ?? 'the model declined';
        this.onEvent({ type: 'refused', departmentId: turn.department.id, reason });
        throw new TurnRefused(turn.department.id, reason);
      }

      const submitted = response.content.find(
        (block): block is ModelToolCallBlock =>
          block.type === 'tool-call' && block.name === SUBMIT_TOOL_NAME,
      );
      if (submitted) {
        const cost = this.costOf(usage);
        this.onEvent({
          type: 'department-finished',
          departmentId: turn.department.id,
          usage,
          ...(cost === undefined ? {} : { cost }),
        });
        return {
          submission: submissionFrom(submitted.input),
          usage,
          ...(cost === undefined ? {} : { cost }),
          cacheHitRate: cacheHitRate(usage),
          instrumentCalls,
          model: this.model,
        };
      }

      const requested = response.content.filter(
        (block): block is ModelToolCallBlock => block.type === 'tool-call',
      );
      if (requested.length === 0) {
        throw new TurnRefused(
          turn.department.id,
          `stopped with ${response.stopReason ?? 'no reason'} and never submitted an output`,
        );
      }

      messages.push({ role: 'assistant', content: response.content });
      const results: ModelToolResultBlock[] = requested.map((block) => {
        instrumentCalls += 1;
        try {
          const output = callInstrument(block.name, block.input);
          this.onEvent({
            type: 'instrument-called',
            departmentId: turn.department.id,
            name: block.name,
            ok: true,
          });
          return {
            type: 'tool-result',
            toolCallId: block.id,
            content: JSON.stringify(output ?? null),
          };
        } catch (error) {
          this.onEvent({
            type: 'instrument-called',
            departmentId: turn.department.id,
            name: block.name,
            ok: false,
          });
          return {
            type: 'tool-result',
            toolCallId: block.id,
            isError: true,
            content: error instanceof Error ? error.message : String(error),
          };
        }
      });
      messages.push({ role: 'user', content: results });
    }

    throw new TurnRefused(
      turn.department.id,
      `asked for instruments ${this.maxToolRounds} times without submitting an output`,
    );
  }

  costOf(usage: Usage): number | undefined {
    return this.estimateCost?.(usage, this.model);
  }

  private async send(
    turn: PreparedTurn,
    messages: ModelMessage[],
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    return this.client.complete({
      model: this.model,
      maxOutputTokens: MAX_TOKENS,
      ...(this.effort ? { effort: this.effort } : {}),
      ...(signal ? { signal } : {}),
      system: this.systemContent(turn),
      tools: [...INSTRUMENT_TOOLS, SUBMIT_TOOL],
      messages,
    });
  }

  private systemContent(turn: PreparedTurn): ModelTextBlock[] {
    const stable = turn.prompt.blocks.filter((block) => block.stable);
    return stable.map((block, index) => ({
      type: 'text',
      text: block.text,
      ...(index === stable.length - 1 ? { cache: true as const } : {}),
    }));
  }

  private userContent(turn: PreparedTurn): ModelTextBlock[] {
    const volatile = turn.prompt.blocks
      .filter((block) => !block.stable)
      .map((block): ModelTextBlock => ({ type: 'text', text: block.text }));

    return [...volatile, { type: 'text', text: turn.prompt.user }];
  }
}

function readUsage(response: ModelResponse): Usage {
  return {
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
    cacheCreationTokens: response.usage?.cacheCreationTokens ?? 0,
    cacheReadTokens: response.usage?.cacheReadTokens ?? 0,
  };
}
