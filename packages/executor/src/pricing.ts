export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export type CostEstimator = (usage: Usage, model: string) => number | undefined;

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

export function cacheHitRate(usage: Usage): number {
  const cached = usage.cacheReadTokens;
  const billedAsInput = usage.inputTokens + usage.cacheCreationTokens + cached;
  return billedAsInput === 0 ? 0 : cached / billedAsInput;
}
