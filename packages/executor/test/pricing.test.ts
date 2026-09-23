import { describe, expect, it } from 'vitest';
import { addUsage, cacheHitRate, NO_USAGE } from '../src/pricing.js';

const usage = (over: Partial<typeof NO_USAGE> = {}) => ({ ...NO_USAGE, ...over });

describe('usage reporting', () => {
  it('adds usage across the rounds of one turn', () => {
    const total = addUsage(
      usage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 }),
      usage({ inputTokens: 3, outputTokens: 2, cacheCreationTokens: 7 }),
    );
    expect(total).toEqual({
      inputTokens: 13, outputTokens: 7, cacheCreationTokens: 7, cacheReadTokens: 100,
    });
  });

  it('measures cache hits against everything billed as input', () => {
    expect(cacheHitRate(usage({ inputTokens: 250, cacheReadTokens: 750 }))).toBeCloseTo(0.75, 6);
  });

  it('counts a cache write as a miss', () => {
    expect(cacheHitRate(usage({ cacheCreationTokens: 1000 }))).toBe(0);
  });

  it('does not divide by zero when nothing was used', () => {
    expect(cacheHitRate(NO_USAGE)).toBe(0);
  });
});
