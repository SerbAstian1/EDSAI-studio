/**
 * What a run costs, computed from what the API reported.
 *
 * Every cost figure in this repository has been an estimate until now — §5 of
 * the notes says so explicitly. These are still list prices rather than an
 * invoice, but they are applied to the token counts the API actually returned
 * for the call that happened, which is a different kind of number from "≈ $3.4
 * per Level 1 run".
 *
 * Rates are per million tokens, from Anthropic's published pricing. They are a
 * cached copy of somebody else's number and will go stale; a run records the
 * rates it was priced with so an old figure can be read for what it is rather
 * than silently re-interpreted under today's prices.
 */

export interface Rates {
  model: string;
  /** Per million input tokens. */
  input: number;
  /** Per million output tokens. */
  output: number;
  /** Cache writes cost more than fresh input; reads cost far less. */
  cacheWriteMultiplier: number;
  cacheReadMultiplier: number;
}

export const RATES: Record<string, Rates> = {
  'claude-opus-5': {
    model: 'claude-opus-5', input: 5, output: 25,
    cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1,
  },
  'claude-sonnet-5': {
    model: 'claude-sonnet-5', input: 2, output: 10,
    cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1,
  },
  'claude-haiku-4-5': {
    model: 'claude-haiku-4-5', input: 1, output: 5,
    cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1,
  },
};

/** The tokens one call used, as the API reported them. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export const NO_USAGE: Usage = {
  inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

/**
 * Dollars for one usage record.
 *
 * Returns `undefined` for a model with no published rate here rather than
 * guessing one. A missing cost is readable as missing; a fabricated one is
 * indistinguishable from a real figure, which is the failure that matters.
 */
export function costOf(usage: Usage, model: string): number | undefined {
  const rates = RATES[model];
  if (!rates) return undefined;

  const perToken = (millions: number): number => millions / 1_000_000;
  return usage.inputTokens * perToken(rates.input)
    + usage.outputTokens * perToken(rates.output)
    + usage.cacheCreationTokens * perToken(rates.input) * rates.cacheWriteMultiplier
    + usage.cacheReadTokens * perToken(rates.input) * rates.cacheReadMultiplier;
}

/**
 * What the cache actually saved, against the same tokens at full input price.
 *
 * Worth computing rather than assuming: the prompt assembly is built around a
 * stable prefix, and this is the number that says whether that design is paying
 * for itself on a real run. A hit rate of zero means something in the prefix is
 * varying, and that is invisible without measuring it.
 */
export function cacheSaving(usage: Usage, model: string): { saved: number; hitRate: number } | undefined {
  const rates = RATES[model];
  if (!rates) return undefined;

  const cached = usage.cacheReadTokens;
  const billedAsInput = usage.inputTokens + usage.cacheCreationTokens + cached;
  const perToken = rates.input / 1_000_000;

  return {
    saved: cached * perToken * (1 - rates.cacheReadMultiplier),
    hitRate: billedAsInput === 0 ? 0 : cached / billedAsInput,
  };
}
