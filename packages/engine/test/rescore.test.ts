import { describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { applyRescore, RescoreRefused } from '../src/rescore.js';
import { RunContext } from '../src/run.js';
import { RunStore } from '../src/store.js';

/**
 * The gap run `f44f6852` found: Arbitration could direct a rescore and the
 * engine could not apply one, so the aggregate stayed wrong while the document
 * said it had been corrected.
 */

const rubric = buildRubric();

function fixture() {
  const store = new RunStore();
  const context = new RunContext({ rubric, store });
  const run = context.start({
    projectId: 'p',
    clientId: 'client-test', brief: 'A booking interface.', level: 1, runId: 'r1',
  });

  const dimensions = [
    ...rubric.universalDimensions.map((d) => d.name),
    ...(rubric.departments.find((d) => d.id === 1)?.dimensions ?? []).map((d) => d.name),
  ];
  context.accept(run.id, 1, {
    body: 'Positioning.',
    scores: dimensions.map((dimension) => ({
      dimension, value: 8, justification: `Something true about ${dimension}.`, inverse: false,
    })),
  });
  return { store, context, run };
}

const request = (over: Record<string, unknown> = {}) => ({
  runId: 'r1', departmentId: 1, dimension: 'Distinctiveness', value: 5,
  justification: 'Rescored: the palette is three free faces on a default scale.',
  directedBy: 'Arbitration', reason: 'Drift check flagged clustering in the 7-8 band.',
  ...over,
} as Parameters<typeof applyRescore>[1]);

describe('applyRescore', () => {
  it('writes the corrected score back into the persisted output', () => {
    const { store } = fixture();
    const { output } = applyRescore(store, request());

    expect(output.scores.find((s) => s.dimension === 'Distinctiveness')?.value).toBe(5);
    expect(store.getOutput('r1', 1)?.scores.find((s) => s.dimension === 'Distinctiveness')?.value)
      .toBe(5);
  });

  it('keeps the original in an audit trail rather than overwriting history', () => {
    const { store } = fixture();
    const { record } = applyRescore(store, request());

    expect(record.fromValue).toBe(8);
    expect(record.toValue).toBe(5);
    expect(record.fromJustification).toContain('Distinctiveness');
    expect(record.directedBy).toBe('Arbitration');
    expect(store.getRescores('r1')).toHaveLength(1);
  });

  it('leaves every other dimension untouched', () => {
    const { store } = fixture();
    applyRescore(store, request());
    const scores = store.getOutput('r1', 1)?.scores ?? [];
    expect(scores.filter((s) => s.value === 8)).toHaveLength(scores.length - 1);
  });

  it('records each correction, so a twice-rescored dimension keeps both steps', () => {
    const { store } = fixture();
    applyRescore(store, request({ value: 5 }));
    applyRescore(store, request({ value: 6, reason: 'Critic disagreed with the first.' }));

    const trail = store.getRescores('r1');
    expect(trail.map((r) => [r.fromValue, r.toValue])).toEqual([[8, 5], [5, 6]]);
  });

  it('refuses a rescore with no stated reason', () => {
    const { store } = fixture();
    expect(() => applyRescore(store, request({ reason: '  ' })))
      .toThrow(/needs a stated reason/);
  });

  it('refuses a rescore to the value it already holds', () => {
    const { store } = fixture();
    expect(() => applyRescore(store, request({ value: 8 })))
      .toThrow(/already stands at 8/);
  });

  it('refuses a dimension the department never scored, and lists what it did', () => {
    const { store } = fixture();
    try {
      applyRescore(store, request({ dimension: 'Hierarchy Legibility' }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RescoreRefused);
      expect((error as Error).message).toMatch(/never scored "Hierarchy Legibility"/);
      expect((error as Error).message).toMatch(/Brand Fidelity/);
    }
  });

  it('refuses a department with no output yet', () => {
    const { store } = fixture();
    expect(() => applyRescore(store, request({ departmentId: 2 })))
      .toThrow(/has no output in run r1/);
  });

  it('refuses a corrected score the schema rejects', () => {
    const { store } = fixture();
    expect(() => applyRescore(store, request({ value: 11 }))).toThrow(/not valid/);
    expect(() => applyRescore(store, request({ justification: '' }))).toThrow(/not valid/);
  });

  it('changes what the aggregate reports, which was the point', () => {
    const { store } = fixture();
    const before = store.getOutput('r1', 1)?.scores ?? [];
    const meanBefore = before.reduce((n, s) => n + s.value, 0) / before.length;

    applyRescore(store, request());

    const after = store.getOutput('r1', 1)?.scores ?? [];
    const meanAfter = after.reduce((n, s) => n + s.value, 0) / after.length;
    expect(meanAfter).toBeLessThan(meanBefore);
  });
});
