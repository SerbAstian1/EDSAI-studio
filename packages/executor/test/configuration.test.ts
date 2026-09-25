import { describe, expect, it } from 'vitest';
import type { PreparedTurn } from '@edsai/engine';
import {
  BRAND_MODEL_DEPARTMENT_IDS,
  departmentModelSelector,
  lowEffortForGpt6,
  parseDepartmentIds,
  parseMaxOutputTokens,
  parseModelEffort,
} from '../src/configuration.js';

const turn = (departmentId: number): PreparedTurn => ({
  department: { id: departmentId },
} as PreparedTurn);

describe('cost-conscious model configuration', () => {
  it('routes only the named departments to the premium model', () => {
    const select = departmentModelSelector('gpt-6-sol', 'gpt-6-astra', [1, 5]);
    expect(select(turn(1))).toBe('gpt-6-astra');
    expect(select(turn(5))).toBe('gpt-6-astra');
    expect(select(turn(7))).toBe('gpt-6-sol');
  });

  it('uses the brand-producing departments when no override list is supplied', () => {
    expect(parseDepartmentIds(undefined)).toEqual(BRAND_MODEL_DEPARTMENT_IDS);
    expect(parseDepartmentIds('1, 5, 5, 12')).toEqual([1, 5, 12]);
    expect(parseDepartmentIds('')).toEqual([]);
  });

  it('rejects malformed department and output-limit settings', () => {
    expect(() => parseDepartmentIds('1,not-a-number')).toThrow(/positive integers/);
    expect(() => parseMaxOutputTokens('1000')).toThrow(/at least 1024/);
  });

  it('parses explicit effort while allowing the model default', () => {
    expect(parseModelEffort('LOW')).toBe('low');
    expect(parseModelEffort('default')).toBeUndefined();
    expect(() => parseModelEffort('expensive')).toThrow(/Unknown reasoning effort/);
  });

  it('defaults GPT-6 requests to low effort without changing older models', () => {
    expect(lowEffortForGpt6(turn(1), 'gpt-6-sol')).toBe('low');
    expect(lowEffortForGpt6(turn(1), 'gpt-6-astra')).toBe('low');
    expect(lowEffortForGpt6(turn(1), 'gpt-4.1')).toBeUndefined();
  });
});
