import { describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { assemble, estimatePrompt, estimateTokens, instruction, stableBlocks, volatileBlocks } from '../src/index.js';

const rubric = buildRubric();
const dept = (id: number) => {
  const found = rubric.departments.find((d) => d.id === id);
  if (!found) throw new Error(`no department ${id}`);
  return found;
};

const context = {
  brief: 'A booking interface for a Kampala shoemaker.',
  level: 1 as const,
  upstream: [],
};

describe('stable prefix', () => {
  /**
   * Caching is a prefix match, so this is the property the whole cost model
   * depends on. Anything that varies between two calls — a timestamp, a
   * re-ordered list — costs the discount on every department in a run.
   */
  it('is byte-identical when built twice', () => {
    const a = stableBlocks(dept(1)).map((b) => b.text).join('');
    const b = stableBlocks(dept(1)).map((b) => b.text).join('');
    expect(a).toBe(b);
  });

  it('shares its first three blocks across every department', () => {
    const shared = (id: number) => stableBlocks(dept(id)).slice(0, 3).map((b) => b.text);
    expect(shared(1)).toEqual(shared(5));
    expect(shared(1)).toEqual(shared(43));
  });

  it('differs only in the department file', () => {
    const a = stableBlocks(dept(1));
    const b = stableBlocks(dept(5));
    expect(a[3]?.text).not.toBe(b[3]?.text);
    expect(a[3]?.label).toBe('department-1');
    expect(b[3]?.label).toBe('department-5');
  });

  it('carries no timestamp or random value that would invalidate the cache', () => {
    const text = stableBlocks(dept(1)).map((b) => b.text).join('\n');
    const thisYear = String(new Date().getFullYear());
    // The corpus may discuss dates; what must not appear is a rendered "now".
    expect(text).not.toContain(new Date().toISOString().slice(0, 10));
    expect(text.includes(`${thisYear}-`) && /\d{4}-\d{2}-\d{2}T\d{2}:/.test(text)).toBe(false);
  });

  it('marks every prefix block stable and every other block volatile', () => {
    const prompt = assemble(rubric, dept(1), context);
    expect(prompt.blocks.filter((b) => b.stable)).toHaveLength(4);
    expect(prompt.cacheBreakpoint).toBe(3);
    expect(prompt.blocks[prompt.cacheBreakpoint]?.stable).toBe(true);
    expect(prompt.blocks[prompt.cacheBreakpoint + 1]?.stable).toBe(false);
  });
});

describe('volatile suffix', () => {
  it('states the brief and the system level', () => {
    const blocks = volatileBlocks(context);
    expect(blocks[0]?.text).toContain('A booking interface');
    expect(blocks[0]?.text).toContain('Frontend System Level: 1');
  });

  it('includes the classification defence when one is given', () => {
    const blocks = volatileBlocks({ ...context, classificationDefence: 'six endpoints, no real-time' });
    expect(blocks[0]?.text).toContain('six endpoints, no real-time');
  });

  it('states the delivery scope when it is not the full one', () => {
    const blocks = volatileBlocks({ ...context, scopeNote: 'Motion is not a deliverable.' });
    expect(blocks[0]?.text).toContain('Motion is not a deliverable.');
  });

  it('gives each upstream department its own block, labelled and in order', () => {
    const blocks = volatileBlocks({
      ...context,
      upstream: [
        { departmentId: 1, name: 'Brand Strategy', body: 'positioning' },
        { departmentId: 2, name: 'Creative Direction', body: 'world' },
      ],
    });
    expect(blocks.map((b) => b.label)).toEqual(['brief', 'upstream-1', 'upstream-2']);
    expect(blocks[1]?.text).toContain('positioning');
  });
});

describe('instruction', () => {
  it('lists every dimension a scored department must score', () => {
    const text = instruction(rubric, dept(1));
    expect(text).toContain('Brand Fidelity');
    expect(text).toContain('Positioning Sharpness');
  });

  it('marks an inverse dimension as inverse', () => {
    expect(instruction(rubric, dept(7))).toContain('Code Coupling (inverse');
  });

  it('tells a measured department it is measured, not scored', () => {
    expect(instruction(rubric, dept(8))).toContain('measured, not scored');
  });

  it('tells an issue-counted department that untraced issues are rejected', () => {
    expect(instruction(rubric, dept(9))).toContain('untraced issue is rejected');
  });

  it('restates the provenance rule the engine mechanically enforces', () => {
    // The instruction is hard-wrapped for legibility in the prompt, so the
    // assertion collapses whitespace rather than pinning the wrap points.
    const text = instruction(rubric, dept(5)).replace(/\s+/g, ' ');
    expect(text).toContain('may not assert a measurement');
    expect(text).toContain('stripped and logged as a violation');
  });

  it('restates the composition requirement', () => {
    expect(instruction(rubric, dept(5))).toContain('name a structure from the composition');
  });

  it('includes Optical Precision for Department 5, the drifted dimension', () => {
    expect(instruction(rubric, dept(5))).toContain('Optical Precision');
  });
});

describe('estimates', () => {
  it('counts tokens roughly', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('separates the cached prefix from the volatile suffix', () => {
    const estimate = estimatePrompt(assemble(rubric, dept(1), context));
    expect(estimate.stableTokens).toBeGreaterThan(5000);
    expect(estimate.volatileTokens).toBeLessThan(estimate.stableTokens);
    expect(estimate.totalTokens).toBe(estimate.stableTokens + estimate.volatileTokens);
  });

  it('grows the volatile half as upstream output accumulates', () => {
    const empty = estimatePrompt(assemble(rubric, dept(3), context));
    const loaded = estimatePrompt(assemble(rubric, dept(3), {
      ...context,
      upstream: [{ departmentId: 1, name: 'Brand Strategy', body: 'x'.repeat(4000) }],
    }));
    expect(loaded.volatileTokens).toBeGreaterThan(empty.volatileTokens);
    expect(loaded.stableTokens).toBe(empty.stableTokens);
  });
});
