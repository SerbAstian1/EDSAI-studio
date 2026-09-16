import { describe, expect, it } from 'vitest';
import { contrast, lineLength } from '@edsai/instruments';
import { claimedNumbers, normalise, numbersIn, numbersOf, verifyTargets } from '../src/verify.js';
import type { Target } from '../src/types.js';

const stated = (over: Partial<Target> = {}): Target => ({
  discipline: 'Color',
  metric: 'body on ground',
  target: '4.5:1',
  source: 'stated-target',
  mechanism: 'Ink darkened until it clears AA.',
  ...over,
});

describe('normalise', () => {
  it('turns every Unicode dash into an ASCII hyphen', () => {
    for (const dash of ['‐', '‑', '‒', '–', '—', '―', '−']) {
      expect(normalise(`4${dash}7`)).toBe('4-7');
    }
  });

  it('removes invisible characters that would break matching', () => {
    expect(normalise('7.0​4:1')).toBe('7.04:1');
    expect(normalise('4.5﻿')).toBe('4.5');
    expect(normalise('4.5')).toBe('4.5');
  });

  it('leaves ordinary text alone', () => {
    expect(normalise('LCP < 2.5s')).toBe('LCP < 2.5s');
  });
});

describe('numbersIn', () => {
  /** The bug an earlier implementation shipped: a range dash read as a minus. */
  it('reads a range as two positives, not a positive and a negative', () => {
    expect(numbersIn('45-75')).toEqual([45, 75]);
    expect(numbersIn('45–75')).toEqual([45, 75]);
    expect(numbersIn('400-600ms')).toEqual([400, 600]);
  });

  it('still reads a genuine negative as negative', () => {
    expect(numbersIn('-0.025em')).toEqual([-0.025]);
    expect(numbersIn('tracking -0.02')).toEqual([-0.02]);
  });

  it('reads both sides of ratio notation', () => {
    expect(numbersIn('7.04:1')).toEqual([7.04, 1]);
  });

  it('is not defeated by an invisible character mid-number', () => {
    expect(numbersIn('7.0​4:1')).toEqual([7.04, 1]);
  });

  it('finds nothing in a purely qualitative value', () => {
    expect(numbersIn('present')).toEqual([]);
  });
});

describe('numbersOf', () => {
  it('finds numbers nested anywhere in an instrument result', () => {
    const result = contrast({ foreground: '#141822', background: '#EEF0F4' });
    expect(numbersOf(result)).toContain(result.value.ratio);
  });

  it('does not recurse forever on a cyclic structure', () => {
    const a: Record<string, unknown> = { n: 1 };
    a['self'] = a;
    expect(() => numbersOf(a)).not.toThrow();
  });
});

describe('verifyTargets', () => {
  it('leaves stated targets untouched', () => {
    const result = verifyTargets([stated()], []);
    expect(result.violations).toHaveLength(0);
    expect(result.targets[0]?.source).toBe('stated-target');
  });

  it('accepts an actual an instrument genuinely produced', () => {
    const measured = contrast({ foreground: '#141822', background: '#EEF0F4' });
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: `${measured.value.ratio}:1`, instrument: 'contrast', mechanism: undefined })],
      [{ instrument: 'contrast', input: {}, output: measured }],
    );
    expect(result.violations).toHaveLength(0);
    expect(result.targets[0]?.actual).toBe(`${measured.value.ratio}:1`);
  });

  it('strips an actual when no instrument ran at all', () => {
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: '7.04:1', mechanism: undefined })],
      [],
    );
    expect(result.violations[0]?.kind).toBe('no-call');
    expect(result.targets[0]?.source).toBe('stated-target');
    expect(result.targets[0]?.actual).toBeUndefined();
  });

  it('strips an actual crediting an instrument that was not called', () => {
    const measured = lineLength({ measure: 640, fontSize: 17 });
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: '7.04:1', instrument: 'contrast', mechanism: undefined })],
      [{ instrument: 'line_length', input: {}, output: measured }],
    );
    expect(result.violations[0]?.kind).toBe('wrong-instrument');
    expect(result.violations[0]?.detail).toMatch(/Called: line_length/);
  });

  /**
   * The case the whole mechanism exists for: the value is real and correct, but
   * it was not produced in this turn.
   */
  it('strips a plausible number the instrument never produced', () => {
    const measured = contrast({ foreground: '#141822', background: '#EEF0F4' });
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: '4.61:1', instrument: 'contrast', mechanism: undefined })],
      [{ instrument: 'contrast', input: {}, output: measured }],
    );
    expect(result.violations[0]?.kind).toBe('value-not-found');
    expect(result.targets[0]?.source).toBe('stated-target');
  });

  it('accepts a value rounded to the precision it was written at', () => {
    const measured = contrast({ foreground: '#6A7384', background: '#F8F9FB' });
    const rounded = String(Math.round(measured.value.ratio));
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: `${rounded}:1`, instrument: 'contrast', mechanism: undefined })],
      [{ instrument: 'contrast', input: {}, output: measured }],
    );
    expect(result.violations).toHaveLength(0);
  });

  it('accepts a qualitative actual when the instrument ran', () => {
    const measured = contrast({ foreground: '#000', background: '#fff' });
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: 'passes', instrument: 'contrast', mechanism: undefined })],
      [{ instrument: 'contrast', input: {}, output: measured }],
    );
    expect(result.violations).toHaveLength(0);
  });

  it('leaves a stated mechanism intact when stripping', () => {
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: '9.9:1', mechanism: 'Ink darkened until it clears AA.' })],
      [],
    );
    expect(result.targets[0]?.mechanism).toBe('Ink darkened until it clears AA.');
  });

  it('writes a mechanism explaining the strip when there was none', () => {
    const result = verifyTargets(
      [stated({ source: 'instrument', actual: '9.9:1', mechanism: undefined })],
      [],
    );
    expect(result.targets[0]?.mechanism).toMatch(/Unverified/);
  });

  it('verifies each target independently', () => {
    const measured = contrast({ foreground: '#141822', background: '#EEF0F4' });
    const result = verifyTargets([
      stated({ metric: 'real', source: 'instrument', actual: `${measured.value.ratio}:1`, instrument: 'contrast', mechanism: undefined }),
      stated({ metric: 'invented', source: 'instrument', actual: '3.21:1', instrument: 'contrast', mechanism: undefined }),
    ], [{ instrument: 'contrast', input: {}, output: measured }]);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.metric).toBe('invented');
    expect(result.targets[0]?.source).toBe('instrument');
    expect(result.targets[1]?.source).toBe('stated-target');
  });
});

describe('claimedNumbers', () => {
  it('treats the denominator of ratio notation as notation, not a measurement', () => {
    expect(claimedNumbers('7.04:1')).toEqual([7.04]);
    expect(claimedNumbers('measured 15.72:1 against the ground')).toEqual([15.72]);
  });

  it('keeps a genuine 1 that is not a ratio denominator', () => {
    expect(claimedNumbers('1 violation')).toEqual([1]);
    expect(claimedNumbers('3:12')).toEqual([3, 12]);
  });

  it('still reads ranges and negatives correctly', () => {
    expect(claimedNumbers('45-75 characters')).toEqual([45, 75]);
    expect(claimedNumbers('-0.02em')).toEqual([-0.02]);
  });
});
