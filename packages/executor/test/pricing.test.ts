import { describe, expect, it } from 'vitest';
import { addUsage, cacheSaving, costOf, NO_USAGE, RATES } from '../src/pricing.js';

const usage = (over: Partial<typeof NO_USAGE> = {}) => ({ ...NO_USAGE, ...over });

describe('what a call cost', () => {
  it('prices input and output at the published rates', () => {
    // One million of each, so the arithmetic is readable rather than clever.
    const cost = costOf(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 'claude-opus-5');
    expect(cost).toBeCloseTo(5 + 25, 6);
  });

  it('charges a cache write more than fresh input and a read far less', () => {
    const write = costOf(usage({ cacheCreationTokens: 1_000_000 }), 'claude-opus-5') ?? 0;
    const read = costOf(usage({ cacheReadTokens: 1_000_000 }), 'claude-opus-5') ?? 0;
    const fresh = costOf(usage({ inputTokens: 1_000_000 }), 'claude-opus-5') ?? 0;
    expect(write).toBeGreaterThan(fresh);
    expect(read).toBeLessThan(fresh);
  });

  it('returns nothing for a model it has no rate for, rather than a guess', () => {
    // A fabricated cost is indistinguishable from a real one, which is the
    // failure that matters — every figure in this repo has been an estimate
    // and the point of this module is to stop that.
    expect(costOf(usage({ inputTokens: 1000 }), 'some-model-we-do-not-price')).toBeUndefined();
  });

  it('costs nothing when nothing was used', () => {
    expect(costOf(NO_USAGE, 'claude-opus-5')).toBe(0);
  });

  it('adds usage across the rounds of one turn', () => {
    const total = addUsage(
      usage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 }),
      usage({ inputTokens: 3, outputTokens: 2, cacheCreationTokens: 7 }),
    );
    expect(total).toEqual({
      inputTokens: 13, outputTokens: 7, cacheCreationTokens: 7, cacheReadTokens: 100,
    });
  });
});

describe('what the cache saved', () => {
  it('measures the hit rate against everything billed as input', () => {
    const saving = cacheSaving(usage({ inputTokens: 250, cacheReadTokens: 750 }), 'claude-opus-5');
    expect(saving?.hitRate).toBeCloseTo(0.75, 6);
  });

  it('counts a cache write as a miss, because that is what it is', () => {
    const saving = cacheSaving(usage({ cacheCreationTokens: 1000 }), 'claude-opus-5');
    expect(saving?.hitRate).toBe(0);
  });

  it('reports what was saved against paying full price for the same tokens', () => {
    const saving = cacheSaving(usage({ cacheReadTokens: 1_000_000 }), 'claude-opus-5');
    const rates = RATES['claude-opus-5'];
    expect(saving?.saved).toBeCloseTo((rates?.input ?? 0) * 0.9, 6);
  });

  it('does not divide by zero on a call that used nothing', () => {
    expect(cacheSaving(NO_USAGE, 'claude-opus-5')?.hitRate).toBe(0);
  });
});
