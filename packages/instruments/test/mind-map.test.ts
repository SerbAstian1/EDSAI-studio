import { describe, expect, it } from 'vitest';
import { checkMindMap, contentWords, MIND_MAP_TARGET, type Direction } from '../src/mind-map.js';

/**
 * Department 12's first failure condition — "fewer than three genuinely
 * distinct conceptual territories explored before narrowing" — is the one this
 * instrument exists for, because the branch a direction came from is data
 * rather than opinion.
 */

const direction = (over: Partial<Direction> & { name: string }): Direction => ({
  concept: 'A placeholder concept.',
  branches: ['metaphor'],
  tracesTo: 'Dept 1: positioning — reliability under chaos',
  construction: 'Built from a keystone geometry on a 3-unit grid.',
  ...over,
});

const four: Direction[] = [
  direction({
    name: 'The Keystone',
    concept: 'A load-bearing wedge holding an arch together.',
    branches: ['metaphor'],
  }),
  direction({
    name: 'Counterweight Monogram',
    concept: 'The D and F interlock so each supports the other.',
    branches: ['letterform'],
  }),
  direction({
    name: 'Fixed Point',
    concept: 'A single anchored dot with orbital paths around it.',
    branches: ['abstract'],
    structure: 'circular',
  }),
  direction({
    name: 'Adinkra Echo',
    concept: 'A restrained nod to a regional symbol of endurance.',
    branches: ['cultural'],
  }),
];

describe('conceptual territories', () => {
  it('accepts a set spanning four territories', () => {
    const result = checkMindMap({ directions: four });
    expect(result.instrument).toBe('mind_map_check');
    expect(result.value.territoryCount).toBe(4);
    expect(result.value.collapsed).toBe(false);
    expect(result.findings.some((f) => f.severity === 'blocker')).toBe(false);
  });

  it('blocks three directions that all came from one branch', () => {
    const result = checkMindMap({
      directions: [
        direction({ name: 'Swoosh One', concept: 'An upward curve of speed.', branches: ['abstract'], structure: 'compound-curve-s-curve' }),
        direction({ name: 'Arc Two', concept: 'A rising stroke with momentum.', branches: ['abstract'], structure: 'compound-curve-s-curve' }),
        direction({ name: 'Sweep Three', concept: 'A tapered ribbon lifting away.', branches: ['abstract'], structure: 'compound-curve-s-curve' }),
      ],
    });
    expect(result.value.collapsed).toBe(true);
    const blocker = result.findings.find((f) => f.severity === 'blocker');
    expect(blocker?.message).toContain('1 conceptual territory');
    expect(blocker?.remediation).toContain('first failure condition');
  });

  it('counts a direction drawing on two branches as covering both', () => {
    const result = checkMindMap({
      directions: [
        direction({ name: 'A', branches: ['metaphor', 'letterform'] }),
        direction({ name: 'B', branches: ['abstract'], structure: 'cross' }),
        direction({ name: 'C', branches: ['literal'] }),
      ],
    });
    expect(result.value.territoryCount).toBe(4);
  });
});

describe('the 3-5 bound', () => {
  it('flags too few survivors as a divergent-stage failure', () => {
    const result = checkMindMap({ directions: four.slice(0, 2) });
    expect(result.findings.some((f) => f.remediation?.includes("didn't go wide enough")))
      .toBe(true);
  });

  it('flags too many survivors as narrowing never applied', () => {
    const result = checkMindMap({
      directions: [...four, direction({ name: 'E', branches: ['literal'] }),
        direction({ name: 'F', branches: ['literal'] })],
    });
    expect(result.findings.some((f) => f.remediation?.includes("wasn't actually applied")))
      .toBe(true);
  });

  it('accepts exactly the bounds', () => {
    for (const count of [MIND_MAP_TARGET.minDirections, MIND_MAP_TARGET.maxDirections]) {
      const directions = Array.from({ length: count }, (_, i) => direction({
        name: `Direction ${i}`,
        concept: `Distinct notion number ${i} about wholly separate matters.`,
        branches: [MIND_MAP_TARGET.branches[i % 5] ?? 'literal'],
        structure: 'cross',
      }));
      const result = checkMindMap({ directions });
      expect(result.findings.some((f) => f.message.includes('survived'))).toBe(false);
    }
  });
});

describe('12.3 and 12.4 discipline', () => {
  it('names the directions that trace to no strategic input', () => {
    const result = checkMindMap({
      directions: [...four.slice(1), direction({ name: 'Untraced', tracesTo: '', branches: ['literal'] })],
    });
    expect(result.value.untraced).toEqual(['Untraced']);
    expect(result.findings.some((f) => f.remediation?.includes('guessing with extra steps')))
      .toBe(true);
  });

  it('names the directions with no construction logic', () => {
    const result = checkMindMap({
      directions: [...four.slice(1), direction({ name: 'Mood Only', construction: '   ', branches: ['literal'] })],
    });
    expect(result.value.withoutConstruction).toEqual(['Mood Only']);
  });

  it('requires an abstract direction to name a composition structure', () => {
    const result = checkMindMap({
      directions: [
        direction({ name: 'Gesture', branches: ['abstract'] }),
        direction({ name: 'B', branches: ['letterform'] }),
        direction({ name: 'C', branches: ['literal'] }),
      ],
    });
    expect(result.findings.some((f) => f.message.includes('name no composition structure')))
      .toBe(true);
  });
});

describe('restatement detection', () => {
  it('catches two directions that are one idea worded twice', () => {
    const result = checkMindMap({
      directions: [
        direction({ name: 'Rising Arc', concept: 'An upward tapered curve suggesting momentum and lift.', branches: ['abstract'], structure: 'cross' }),
        direction({ name: 'Rising Curve', concept: 'A tapered upward arc suggesting lift and momentum.', branches: ['letterform'] }),
        direction({ name: 'Keystone', concept: 'A wedge holding an arch together under load.', branches: ['metaphor'] }),
      ],
    });
    expect(result.value.restatements).toHaveLength(1);
    expect(result.findings.some((f) => f.message.includes('same content words'))).toBe(true);
  });

  it('leaves genuinely different concepts alone', () => {
    expect(checkMindMap({ directions: four }).value.restatements).toEqual([]);
  });

  it('ignores the filler words that every write-up shares', () => {
    const words = contentWords('A visual mark for the brand, a design concept');
    expect([...words]).toEqual([]);
  });
});

describe('the divergent stage', () => {
  it('names the branches with no nodes on them', () => {
    const result = checkMindMap({
      nodes: [
        { id: '1', branch: 'metaphor', text: 'keystone arch' },
        { id: '2', branch: 'abstract', text: 'fixed point orbit' },
      ],
      directions: four,
    });
    expect(result.value.branchesExplored).toEqual(['metaphor', 'abstract']);
    expect(result.value.branchesMissing).toEqual(['literal', 'letterform', 'cultural']);
  });

  it('spots two branches arriving at the same idea, which 12.2 calls the strongest signal', () => {
    const result = checkMindMap({
      nodes: [
        { id: '1', branch: 'metaphor', text: 'a keystone holding an arch under load' },
        { id: '2', branch: 'letterform', text: 'the D drawn as a keystone under the arch of the F' },
      ],
      directions: four,
    });
    expect(result.value.crossPollinated.length).toBeGreaterThan(0);
    expect(result.value.crossPollinated[0]?.shared).toContain('keystone');
  });

  it('notes the absence of convergence without treating it as a fault', () => {
    const result = checkMindMap({
      nodes: [
        { id: '1', branch: 'metaphor', text: 'a keystone' },
        { id: '2', branch: 'cultural', text: 'woven kente rhythm' },
      ],
      directions: four,
    });
    const finding = result.findings.find((f) => f.message.includes('No two branches'));
    expect(finding?.severity).toBe('info');
    expect(finding?.remediation).toContain('not a fault');
  });

  it('says nothing about the divergent stage when no nodes were given', () => {
    const result = checkMindMap({ directions: four });
    expect(result.findings.some((f) => f.message.includes('branch'))).toBe(false);
  });
});
