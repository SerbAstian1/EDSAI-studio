import { describe, expect, it } from 'vitest';
import {
  AXES, axis, positionOf, positionsOf, matrixFor, comparatorFromProposal, type Comparator,
} from '../src/positioning.js';
import type { Answer } from '../src/onboarding.js';

const NOW = '2026-09-19T00:00:00.000Z';

const answer = (questionId: string, value: unknown): Answer => ({
  onboardingId: 'onb', questionId, value, answeredAt: NOW,
});

const comparator = (
  id: string, name: string, positions: Record<string, number>,
): Comparator => ({ id, clientId: 'acme', name, positions, createdAt: NOW });

describe('turning answers into positions', () => {
  it('reads a 1–5 scale onto the full axis', () => {
    expect(positionOf([answer('e2', 1)], 'E2')).toBe(0);
    expect(positionOf([answer('e2', 3)], 'E2')).toBe(50);
    expect(positionOf([answer('e2', 5)], 'E2')).toBe(100);
  });

  it('reads a ratio as the share that went to the high pole', () => {
    // Side b is the high pole, so picking it overwhelmingly lands at 85.
    expect(positionOf([answer('e4', { side: 'b', strength: 'overwhelmingly' })], 'E4')).toBe(85);
    expect(positionOf([answer('e4', { side: 'b', strength: 'slightly' })], 'E4')).toBe(60);
    // Side a is the low pole, so the same strength mirrors.
    expect(positionOf([answer('e4', { side: 'a', strength: 'overwhelmingly' })], 'E4')).toBe(15);
    expect(positionOf([answer('e4', { side: 'a', strength: 'slightly' })], 'E4')).toBe(40);
  });

  it('never puts a ratio answer on the fence', () => {
    // The flow asks "pick a side" before "how strongly" so 50/50 cannot be
    // expressed. That has to survive into the chart, or the chart quietly
    // reintroduces the answer the questionnaire refused to collect.
    const ratioAxes = ['E4', 'E5', 'E6', 'E7'];
    const strengths = ['slightly', 'clearly', 'overwhelmingly'];
    for (const id of ratioAxes) {
      const q = axis(id)?.questionId ?? '';
      for (const side of ['a', 'b']) {
        for (const strength of strengths) {
          expect(positionOf([answer(q, { side, strength })], id)).not.toBe(50);
        }
      }
    }
  });

  it('returns nothing for an axis nobody answered', () => {
    expect(positionOf([], 'E2')).toBeUndefined();
  });

  it('returns nothing for an answer that does not fit its question', () => {
    // The onboarding endpoint is the one place a stranger writes to this
    // database, so a stored value is not trusted to be the right shape.
    expect(positionOf([answer('e2', 9)], 'E2')).toBeUndefined();
    expect(positionOf([answer('e4', { side: 'c', strength: 'slightly' })], 'E4')).toBeUndefined();
    expect(positionOf([answer('e4', 'overwhelmingly')], 'E4')).toBeUndefined();
  });

  it('refuses an axis that is not one', () => {
    expect(positionOf([answer('e2', 3)], 'E9')).toBeUndefined();
  });

  it('leaves out the two axes that are a choice rather than a position', () => {
    // E1 and E8 pick between named options. Spacing those evenly on a line
    // would invent an ordering the question never asked for.
    expect(AXES.map((a) => a.id)).toEqual(['E2', 'E3', 'E4', 'E5', 'E6', 'E7']);
  });

  it('collects every axis the answers resolve, and no others', () => {
    const positions = positionsOf([
      answer('e2', 5),
      answer('e4', { side: 'a', strength: 'clearly' }),
      answer('e1', 'directness'),
    ]);
    expect(positions).toEqual({ E2: 100, E4: 30 });
  });
});

describe('building one chart', () => {
  const answers = [
    answer('e4', { side: 'a', strength: 'overwhelmingly' }),
    answer('e6', { side: 'b', strength: 'clearly' }),
  ];

  it('computes the client’s own point from their answers', () => {
    const matrix = matrixFor({
      xAxis: 'E4', yAxis: 'E6', brandName: 'Acme', answers, comparators: [],
    });
    expect(matrix?.points).toHaveLength(1);
    expect(matrix?.points[0]).toMatchObject({ id: 'brand', label: 'Acme', x: 15, y: 70, source: 'computed' });
    // The dot shows its working: the sentence chosen on each axis.
    expect(matrix?.points[0]?.evidence?.x).toContain('Ordered');
    expect(matrix?.points[0]?.evidence?.y).toBeTruthy();
  });

  it('draws a department’s proposal apart from the studio’s own placement', () => {
    const proposal = comparatorFromProposal({
      clientId: 'acme', runId: 'r1', departmentId: 1, now: '2026-09-22T00:00:00.000Z',
      proposal: { name: 'Rival Co', note: 'The category default.',
        positions: [{ axis: 'E4', value: 80 }, { axis: 'E6', value: 130 }, { axis: 'E9', value: 5 }] },
    });
    expect(proposal?.id).toBe('cmp-r1-1-rival-co');
    expect(proposal?.origin).toBe('run');
    // Clamped to the scale, unknown axes dropped.
    expect(proposal?.positions).toEqual({ E4: 80, E6: 100 });
    const matrix = matrixFor({
      xAxis: 'E4', yAxis: 'E6', brandName: 'Acme', answers, comparators: proposal ? [proposal] : [],
    });
    expect(matrix?.points[1]).toMatchObject({ label: 'Rival Co', source: 'proposed', runId: 'r1', departmentId: 1 });
  });

  it('drops a proposal that could never appear on a chart', () => {
    expect(comparatorFromProposal({
      clientId: 'acme', runId: 'r1', departmentId: 1, now: '2026-09-22T00:00:00.000Z',
      proposal: { name: 'One-axis', note: '', positions: [{ axis: 'E4', value: 10 }] },
    })).toBeUndefined();
    expect(comparatorFromProposal({
      clientId: 'acme', runId: 'r1', departmentId: 1, now: '2026-09-22T00:00:00.000Z',
      proposal: 'not an object',
    })).toBeUndefined();
  });

  it('marks a studio-placed brand as placed, never as computed', () => {
    // The distinction is the whole point: a competitor never answered anything,
    // and drawing their position identically to a measured one is the claim
    // this system exists not to make.
    const matrix = matrixFor({
      xAxis: 'E4', yAxis: 'E6', brandName: 'Acme', answers,
      comparators: [comparator('c1', 'Rival', { E4: 80, E6: 20 })],
    });
    expect(matrix?.points.map((p) => p.source)).toEqual(['computed', 'placed']);
  });

  it('drops a brand that has only one of the two coordinates', () => {
    // Half a point is not a point. Pinning it to an edge or the middle would
    // put a position on the chart that nobody decided.
    const matrix = matrixFor({
      xAxis: 'E4', yAxis: 'E6', brandName: 'Acme', answers,
      comparators: [comparator('c1', 'Half', { E4: 80 })],
    });
    expect(matrix?.points.map((p) => p.label)).toEqual(['Acme']);
  });

  it('leaves the client off a chart they have not answered', () => {
    const matrix = matrixFor({
      xAxis: 'E2', yAxis: 'E3', brandName: 'Acme', answers,
      comparators: [comparator('c1', 'Rival', { E2: 10, E3: 90 })],
    });
    expect(matrix?.points.map((p) => p.label)).toEqual(['Rival']);
    expect(matrix?.unanswered).toEqual(['E2', 'E3']);
  });

  it('says which axes are unanswered rather than leaving it a mystery', () => {
    const matrix = matrixFor({
      xAxis: 'E4', yAxis: 'E3', brandName: 'Acme', answers, comparators: [],
    });
    expect(matrix?.unanswered).toEqual(['E3']);
  });

  it('refuses an axis plotted against itself', () => {
    expect(matrixFor({
      xAxis: 'E4', yAxis: 'E4', brandName: 'Acme', answers, comparators: [],
    })).toBeUndefined();
  });

  it('refuses an axis that does not exist', () => {
    expect(matrixFor({
      xAxis: 'E4', yAxis: 'E1', brandName: 'Acme', answers, comparators: [],
    })).toBeUndefined();
  });
});
