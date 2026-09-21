import Anthropic from '@anthropic-ai/sdk';
import { INSTRUMENT_TOOLS } from '@edsai/instruments';
import type { PreparedTurn, Submission } from '@edsai/engine';
import { SUBMIT_TOOL, SUBMIT_TOOL_NAME, submissionFrom } from './submission.js';
import { addUsage, cacheSaving, costOf, NO_USAGE, type Usage } from './pricing.js';

/**
 * The thing that was missing.
 *
 * Everything else in EDSAI was built around a department turn: the rubric says
 * which departments run, the prompt assembly builds the request, the verifier
 * checks the provenance of what comes back, the gate decides whether it is
 * FINAL. What no part of this repository did was **call a model**. A run
 * prepared a prompt, wrote it to a file, and waited for somebody to carry it
 * across by hand — twenty-four times for a Level 1 run.
 *
 * This is that carrier, and nothing more. It does not decide anything: which
 * department runs is the rubric's, what the prompt says is the prompt
 * assembly's, and whether the result is acceptable is the engine's. It sends,
 * runs the instruments the model asks for, and hands back a submission.
 *
 * **Why it is its own package.** The engine is deliberately free of network
 * code so its rules can be tested without one, and `@edsai/measure` owns the
 * only other socket in the system. A model call inside the engine would make
 * the rules untestable offline and the seam impossible to see.
 */

/** Just the part of the SDK this depends on, so a test can stand in for it. */
export interface ModelClient {
  messages: {
    stream(params: Anthropic.MessageStreamParams): {
      finalMessage(): Promise<Anthropic.Message>;
    };
  };
}

export interface ExecutorOptions {
  client?: ModelClient;
  apiKey?: string;
  /**
   * The workspace to bill against. An organisation-level key is refused by
   * the API unless every request names one; a key already scoped to a
   * workspace needs nothing here.
   */
  workspaceId?: string;
  model?: string;
  /** How hard to think. The default is the API's, which is `high`. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * Ceiling on instrument calls in one department's turn.
   *
   * A stop, not a budget: a model looping on a failing tool would otherwise
   * spend a run's worth of tokens discovering the same error.
   */
  maxToolRounds?: number;
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
  /** Undefined for a model with no published rate rather than a guessed figure. */
  cost?: number;
  cacheHitRate: number;
  instrumentCalls: number;
  model: string;
}

/**
 * A model that declined, or stopped without finishing.
 *
 * Typed so a caller can tell it from a network failure: one means try again,
 * the other means this department cannot be run as asked.
 */
export class TurnRefused extends Error {
  constructor(readonly departmentId: number, readonly reason: string) {
    super(`Department ${departmentId} did not produce an output: ${reason}`);
    this.name = 'TurnRefused';
  }
}

/** Streaming, because a department's output is long and a socket is not patient. */
const MAX_TOKENS = 64_000;
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_TOOL_ROUNDS = 12;

export class Executor {
  private readonly client: ModelClient;
  readonly model: string;
  private readonly effort: ExecutorOptions['effort'];
  private readonly maxToolRounds: number;
  private readonly onEvent: (event: ExecutorEvent) => void;

  constructor(options: ExecutorOptions = {}) {
    this.client = options.client ?? new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.workspaceId
        ? { defaultHeaders: { 'anthropic-workspace-id': options.workspaceId } }
        : {}),
    });
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort;
    this.maxToolRounds = options.maxToolRounds ?? DEFAULT_TOOL_ROUNDS;
    this.onEvent = options.onEvent ?? (() => {});
  }

  /**
   * Run one department to a submission.
   *
   * `callInstrument` is passed in rather than imported so the caller keeps the
   * one that logs — the verifier credits a measurement only when a tool call in
   * this turn produced it, and an instrument invoked outside that record would
   * produce a number the engine then refuses. The signature makes it awkward to
   * get that wrong.
   */
  async runDepartment(
    turn: PreparedTurn,
    callInstrument: (name: string, input: unknown) => unknown,
  ): Promise<TurnResult> {
    this.onEvent({
      type: 'department-started',
      departmentId: turn.department.id,
      name: turn.department.name,
      index: turn.position.index,
      total: turn.position.total,
    });

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: this.userContent(turn) },
    ];
    let usage = NO_USAGE;
    let instrumentCalls = 0;

    for (let round = 0; round <= this.maxToolRounds; round += 1) {
      const response = await this.send(turn, messages);
      usage = addUsage(usage, readUsage(response));

      if (response.stop_reason === 'refusal') {
        const reason = response.stop_details?.explanation ?? 'the model declined';
        this.onEvent({ type: 'refused', departmentId: turn.department.id, reason });
        throw new TurnRefused(turn.department.id, reason);
      }

      const submitted = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === SUBMIT_TOOL_NAME,
      );
      if (submitted) {
        const cost = costOf(usage, this.model);
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
          cacheHitRate: cacheSaving(usage, this.model)?.hitRate ?? 0,
          instrumentCalls,
          model: this.model,
        };
      }

      const requested = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (requested.length === 0) {
        throw new TurnRefused(
          turn.department.id,
          `stopped with ${response.stop_reason ?? 'no reason'} and never submitted an output`,
        );
      }

      // The whole assistant turn goes back, thinking blocks included: they are
      // bound to this model and dropping them loses the reasoning the next
      // request continues from.
      messages.push({ role: 'assistant', content: response.content });

      // Every result in ONE user message. Splitting them across messages
      // teaches the model to stop asking for instruments in parallel.
      const results: Anthropic.ToolResultBlockParam[] = requested.map((block) => {
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
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output ?? null),
          };
        } catch (error) {
          this.onEvent({
            type: 'instrument-called',
            departmentId: turn.department.id,
            name: block.name,
            ok: false,
          });
          // Handed back rather than thrown: an instrument that refused is
          // information the department can act on — usually by stating a
          // target instead of claiming a measurement.
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
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

  private async send(
    turn: PreparedTurn,
    messages: Anthropic.MessageParam[],
  ): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: MAX_TOKENS,
      // Department work is judgement under a rubric, which is exactly what
      // adaptive thinking is for.
      thinking: { type: 'adaptive' },
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
      system: this.systemContent(turn),
      tools: [...INSTRUMENT_TOOLS, SUBMIT_TOOL] as Anthropic.Tool[],
      messages,
    });
    return stream.finalMessage();
  }

  /**
   * The system prompt, with the cache breakpoint where the assembly put it.
   *
   * The corpus prefix is tens of thousands of tokens and identical for every
   * run of the same department, so this is the difference between paying for it
   * once and paying for it twenty-four times. `cache_control` goes on the last
   * stable block; everything after it varies and must not be cached.
   */
  private systemContent(turn: PreparedTurn): Anthropic.TextBlockParam[] {
    const stable = turn.prompt.blocks.filter((block) => block.stable);
    return stable.map((block, index) => ({
      type: 'text',
      text: block.text,
      ...(index === stable.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
  }

  /** Everything that varies: the brief, upstream outputs, this turn's instruction. */
  private userContent(turn: PreparedTurn): Anthropic.TextBlockParam[] {
    const volatile = turn.prompt.blocks
      .filter((block) => !block.stable)
      .map((block): Anthropic.TextBlockParam => ({ type: 'text', text: block.text }));

    return [...volatile, { type: 'text', text: turn.prompt.user }];
  }
}

function readUsage(response: Anthropic.Message): Usage {
  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}
