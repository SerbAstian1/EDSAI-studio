import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/App.js';
import {
  histogram, issueCounts, orderIssues, progress, targetSummary, weakestScore,
} from '../src/scorecard.js';
import type { DepartmentOutput, Issue } from '../src/api.js';

const output = (departmentId: number, values: number[], over: Partial<DepartmentOutput> = {}): DepartmentOutput => ({
  runId: 'r1', departmentId, body: 'x',
  scores: values.map((value, i) => ({
    dimension: `Dimension ${i}`, value, justification: `Reason ${i}.`,
  })),
  targets: [], compositions: [], decisions: [], instrumentCalls: [],
  completedAt: '2026-09-17T00:00:00Z',
  ...over,
});

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i1', severity: 'Major', description: 'x', tracedTo: [5], fix: 'y', status: 'open', ...over,
});

describe('routing', () => {
  it('reads the workspace from an empty or root hash', () => {
    expect(parseRoute('')).toEqual({ screen: 'workspace' });
    expect(parseRoute('#/')).toEqual({ screen: 'workspace' });
  });

  it('reads the intake screen', () => {
    expect(parseRoute('#/new')).toEqual({ screen: 'intake' });
  });

  it('reads a run and its sub-screens', () => {
    expect(parseRoute('#/run/abc')).toEqual({ screen: 'run', runId: 'abc' });
    expect(parseRoute('#/run/abc/scorecard')).toEqual({ screen: 'scorecard', runId: 'abc' });
    expect(parseRoute('#/run/abc/review')).toEqual({ screen: 'review', runId: 'abc' });
    expect(parseRoute('#/run/abc/finalize')).toEqual({ screen: 'finalize', runId: 'abc' });
  });

  it('falls back to the run view for an unknown sub-screen', () => {
    expect(parseRoute('#/run/abc/nonsense')).toEqual({ screen: 'run', runId: 'abc' });
  });

  it('ignores a run path with no id', () => {
    expect(parseRoute('#/run')).toEqual({ screen: 'workspace' });
  });
});

describe('histogram', () => {
  it('buckets every value 1 through 10, including the empty ones', () => {
    const h = histogram([output(1, [7, 7, 9])]);
    expect(h?.buckets).toHaveLength(10);
    expect(h?.buckets[6]).toEqual({ value: 7, count: 2, share: 2 / 3 });
    expect(h?.buckets[0]?.count).toBe(0);
  });

  it('reports mean, min and max across every department', () => {
    const h = histogram([output(1, [4, 8]), output(2, [6, 10])]);
    expect(h?.total).toBe(4);
    expect(h?.mean).toBe(7);
    expect(h?.min).toBe(4);
    expect(h?.max).toBe(10);
  });

  /** The screen exists to make this visible before Arbitration, not after. */
  it('finds the widest two-point band rather than assuming 7-8', () => {
    const h = histogram([output(1, [3, 3, 3, 4, 4, 9, 10])]);
    expect(h?.widestBand.low).toBe(3);
    expect(h?.widestBand.high).toBe(4);
    expect(h?.widestBand.share).toBeCloseTo(5 / 7, 5);
  });

  it('puts a wall of 8s at 100% in one band', () => {
    const h = histogram([output(1, [8, 8, 8, 8, 8])]);
    expect(h?.widestBand.share).toBe(1);
  });

  it('returns nothing when no score has been recorded', () => {
    expect(histogram([])).toBeUndefined();
    expect(histogram([output(1, [])])).toBeUndefined();
  });
});

describe('weakest score', () => {
  it('names the lowest score and where it came from', () => {
    const weakest = weakestScore([output(1, [8, 8]), output(5, [4, 9])]);
    expect(weakest?.value).toBe(4);
    expect(weakest?.departmentId).toBe(5);
  });

  /** A low inverse score means the opposite of a weakness. */
  it('excludes an inverse dimension, where low is good', () => {
    const weakest = weakestScore([
      output(7, [8], {
        scores: [
          { dimension: 'Code Coupling', value: 2, justification: 'x', inverse: true },
          { dimension: 'Architecture Scalability', value: 6, justification: 'y' },
        ],
      }),
    ]);
    expect(weakest?.dimension).toBe('Architecture Scalability');
    expect(weakest?.value).toBe(6);
  });

  it('returns nothing when there is nothing to name', () => {
    expect(weakestScore([])).toBeUndefined();
  });
});

describe('target provenance', () => {
  it('separates measured from stated', () => {
    const summary = targetSummary([output(8, [], {
      targets: [
        { discipline: 'Color', metric: 'a', target: '4.5:1', actual: '7:1',
          source: 'instrument', instrument: 'contrast' },
        { discipline: 'Perf', metric: 'b', target: '< 1.8s',
          source: 'stated-target', mechanism: 'Text-first shell.' },
      ],
    })]);
    expect(summary).toEqual({ total: 2, measured: 1, stated: 1, provenance: 0.5 });
  });

  it('reports zero provenance rather than dividing by zero', () => {
    expect(targetSummary([]).provenance).toBe(0);
  });
});

describe('issues', () => {
  it('orders open before closed, then worst severity first', () => {
    const ordered = orderIssues([
      issue({ id: 'a', severity: 'Minor' }),
      issue({ id: 'b', severity: 'Blocker', status: 'resolved' }),
      issue({ id: 'c', severity: 'Major' }),
      issue({ id: 'd', severity: 'Blocker' }),
    ]);
    expect(ordered.map((i) => i.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('counts open against total per severity', () => {
    const counts = issueCounts([
      issue({ id: 'a', severity: 'Major' }),
      issue({ id: 'b', severity: 'Major', status: 'resolved' }),
      issue({ id: 'c', severity: 'Nitpick' }),
    ]);
    expect(counts.Major).toEqual({ open: 1, total: 2 });
    expect(counts.Nitpick).toEqual({ open: 1, total: 1 });
    expect(counts.Blocker).toEqual({ open: 0, total: 0 });
  });
});

describe('progress', () => {
  it('measures by department rather than by clock', () => {
    const p = progress([1, 2, 3, 4], [1, 3]);
    expect(p).toEqual({ done: 2, total: 4, share: 0.5, remaining: [2, 4] });
  });

  it('keeps remaining in pipeline order, not numeric order', () => {
    expect(progress([5, 1, 15, 7], [1]).remaining).toEqual([5, 15, 7]);
  });

  it('handles a run with nothing activated', () => {
    expect(progress([], []).share).toBe(0);
  });
});
