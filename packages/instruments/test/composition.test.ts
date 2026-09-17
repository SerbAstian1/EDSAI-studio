import { describe, expect, it } from 'vitest';
import {
  compositionCheck, computableStructures, COMPOSITION_THRESHOLDS,
  type CompositionElement, type CompositionInput,
} from '../src/composition.js';

/**
 * The catalog's second failure condition is the one under test: *"a named
 * structure that doesn't match the stated eye-path — e.g. calling something
 * 'Radial' when the actual visual weight sits in a corner, not at a center
 * point."* Every refutation case below is a claim a write-up could plausibly
 * make and the geometry can disprove.
 */

const FRAME = { width: 1000, height: 1000 };

const box = (
  id: string, x: number, y: number, w: number, h: number,
  extra: Partial<CompositionElement> = {},
): CompositionElement => ({ id, x, y, width: w, height: h, ...extra });

const check = (over: Partial<CompositionInput> & { structure: string }) =>
  compositionCheck({
    frame: FRAME,
    elements: [box('a', 0, 0, 100, 100)],
    eyePath: ['a'],
    ...over,
  });

describe('rule-of-thirds', () => {
  it('supports a focal point on an intersection', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('hero', 283, 283, 100, 100, { role: 'primary' })],
      eyePath: ['hero'],
    });
    expect(result.value.verdict).toBe('supported');
    expect(result.value.evidence).toContain('third line');
  });

  it('refutes a dead-centre placement, which is what thirds exists to avoid', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('hero', 450, 450, 100, 100, { role: 'primary' })],
      eyePath: ['hero'],
    });
    expect(result.value.verdict).toBe('refuted');
    expect(result.value.evidence).toContain('dead centre');
    expect(result.findings.some((f) => f.severity === 'major')).toBe(true);
  });

  it('refutes a focal point on neither axis', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('hero', 800, 100, 100, 100, { role: 'primary' })],
      eyePath: ['hero'],
    });
    expect(result.value.verdict).toBe('refuted');
  });
});

describe('radiating-radial', () => {
  const around = (cx: number, cy: number): CompositionElement[] => [
    box('n', cx - 25, cy - 250, 50, 50),
    box('ne', cx + 150, cy - 175, 50, 50),
    box('e', cx + 200, cy - 25, 50, 50),
    box('se', cx + 150, cy + 125, 50, 50),
    box('s', cx - 25, cy + 200, 50, 50),
    box('w', cx - 250, cy - 25, 50, 50),
    box('core', cx - 40, cy - 40, 80, 80, { role: 'primary' }),
  ];

  it('supports elements radiating from frame centre', () => {
    const elements = around(500, 500);
    const result = check({
      structure: 'radiating-radial', elements, eyePath: ['core', 'n', 'e'],
    });
    expect(result.value.verdict).toBe('supported');
  });

  it("refutes the catalog's own example: radial with the weight in a corner", () => {
    const result = check({
      structure: 'radiating-radial',
      elements: [
        box('mass', 20, 20, 300, 300, { role: 'primary' }),
        box('speck', 900, 900, 20, 20),
      ],
      eyePath: ['mass', 'speck'],
    });
    expect(result.value.verdict).toBe('refuted');
    expect(result.value.evidence).toContain('from frame centre');
  });

  it('refutes a centred mass with nothing radiating from it', () => {
    const result = check({
      structure: 'radiating-radial',
      elements: [
        box('core', 450, 450, 100, 100, { role: 'primary' }),
        box('one', 600, 480, 40, 40),
      ],
      eyePath: ['core', 'one'],
    });
    expect(result.value.verdict).toBe('refuted');
    expect(result.value.evidence).toContain('sectors');
  });
});

describe('balance logic', () => {
  it('supports symmetry when the halves carry equal weight', () => {
    const result = check({
      structure: 'symmetry',
      elements: [
        box('l', 200, 400, 200, 200, { role: 'primary' }),
        box('r', 600, 400, 200, 200),
      ],
      eyePath: ['l', 'r'],
    });
    expect(result.value.verdict).toBe('supported');
  });

  it('refutes symmetry when one half carries nearly everything', () => {
    const result = check({
      structure: 'symmetry',
      elements: [
        box('l', 100, 400, 400, 400, { role: 'primary' }),
        box('r', 800, 480, 60, 60),
      ],
      eyePath: ['l', 'r'],
    });
    expect(result.value.verdict).toBe('refuted');
  });

  it('refutes "balance" for a composition that is actually Unbalanced', () => {
    const result = check({
      structure: 'asymmetry-balance-unequal-massing',
      elements: [
        box('slab', 620, 300, 350, 400, { role: 'primary' }),
        box('speck', 60, 500, 30, 30),
      ],
      eyePath: ['slab', 'speck'],
    });
    expect(result.value.verdict).toBe('refuted');
    expect(result.value.evidence).toContain('Unbalanced');
  });

  it('supports unequal masses that resolve to a balanced torque', () => {
    const result = check({
      structure: 'asymmetry-balance-unequal-massing',
      elements: [
        box('large-pale', 80, 350, 300, 300, { contrast: 0.35, role: 'primary' }),
        box('small-dense', 700, 420, 150, 150, { contrast: 1 }),
      ],
      eyePath: ['large-pale', 'small-dense'],
    });
    expect(Math.abs(result.value.torque)).toBeLessThanOrEqual(
      COMPOSITION_THRESHOLDS.balanceTolerance);
    expect(result.value.verdict).toBe('supported');
  });
});

describe('weighted shapes and frame', () => {
  it('supports a pyramid with a wide base and a narrow apex', () => {
    const result = check({
      structure: 'pyramid-triangle-composition',
      elements: [
        box('apex', 450, 150, 100, 150, { role: 'primary' }),
        box('left', 150, 600, 250, 250),
        box('right', 600, 600, 250, 250),
      ],
      eyePath: ['apex', 'left', 'right'],
    });
    expect(result.value.verdict).toBe('supported');
  });

  it('refutes a pyramid that is actually top-heavy', () => {
    const result = check({
      structure: 'pyramid-triangle-composition',
      elements: [
        box('slab', 50, 50, 900, 350, { role: 'primary' }),
        box('foot', 470, 700, 60, 60),
      ],
      eyePath: ['slab', 'foot'],
    });
    expect(result.value.verdict).toBe('refuted');
  });

  it('supports an L that leaves one corner open', () => {
    const result = check({
      structure: 'l-arrangement',
      elements: [
        box('left-column', 60, 100, 200, 800, { role: 'primary' }),
        box('bottom-run', 300, 780, 600, 120),
      ],
      eyePath: ['left-column', 'bottom-run'],
    });
    expect(result.value.verdict).toBe('supported');
    expect(result.value.evidence).toContain('open');
  });

  it('refutes an L when every corner carries weight', () => {
    const result = check({
      structure: 'l-arrangement',
      elements: [
        box('tl', 50, 50, 300, 300, { role: 'primary' }),
        box('tr', 650, 50, 300, 300),
        box('bl', 50, 650, 300, 300),
        box('br', 650, 650, 300, 300),
      ],
      eyePath: ['tl', 'tr', 'bl', 'br'],
    });
    expect(result.value.verdict).toBe('refuted');
  });

  it('supports negative space at low coverage and refutes it at high', () => {
    const sparse = check({
      structure: 'negative-space',
      elements: [box('mark', 400, 400, 200, 200, { role: 'primary' })],
      eyePath: ['mark'],
    });
    expect(sparse.value.verdict).toBe('supported');
    expect(sparse.value.coverage).toBeCloseTo(0.04, 2);

    const crowded = check({
      structure: 'negative-space',
      elements: [box('bleed', 0, 0, 950, 950, { role: 'primary' })],
      eyePath: ['bleed'],
    });
    expect(crowded.value.verdict).toBe('refuted');
  });

  it('measures coverage by rasterising, so overlaps are not double-counted', () => {
    const result = check({
      structure: 'fill-the-frame',
      elements: [
        box('a', 0, 0, 1000, 1000, { role: 'primary' }),
        box('b', 0, 0, 1000, 1000),
      ],
      eyePath: ['a', 'b'],
    });
    expect(result.value.coverage).toBe(1);
    expect(result.value.verdict).toBe('supported');
  });
});

describe('what it refuses to judge', () => {
  it.each([
    'golden-spiral-fibonacci-spiral',
    'tunnel',
    'converging-leading-lines',
    'compound-curve-s-curve',
    'depth-foreground-midground-background-layering',
  ])('returns not-computable for %s with a stated reason', (structure) => {
    const result = check({ structure, elements: [box('a', 0, 0, 100, 100, { role: 'primary' })] });
    expect(result.value.verdict).toBe('not-computable');
    expect(result.value.evidence.length).toBeGreaterThan(20);
    expect(result.findings.some((f) => f.severity === 'info')).toBe(true);
  });

  it('does not invent a verdict for a structure it has never heard of', () => {
    const result = check({ structure: 'vibes-based-layout' });
    expect(result.value.verdict).toBe('not-computable');
    expect(result.value.evidence).toContain('vibes-based-layout');
  });

  it('cannot judge figure-to-ground without contrast values', () => {
    const result = check({
      structure: 'figure-to-ground',
      elements: [box('a', 100, 100, 200, 200, { role: 'primary' })],
      eyePath: ['a'],
    });
    expect(result.value.verdict).toBe('not-computable');
  });

  it('judges figure-to-ground when contrast is supplied', () => {
    const result = check({
      structure: 'figure-to-ground',
      elements: [box('a', 100, 100, 200, 200, { role: 'primary', contrast: 0.2 })],
      eyePath: ['a'],
    });
    expect(result.value.verdict).toBe('refuted');
  });

  it('lists what it can test', () => {
    const structures = computableStructures();
    expect(structures).toContain('rule-of-thirds');
    expect(structures).not.toContain('tunnel');
    expect(structures.length).toBeGreaterThan(15);
  });
});

describe('hierarchy and eye-path, independent of the claimed structure', () => {
  it("flags weight landing somewhere other than the primary message", () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [
        box('headline', 300, 300, 120, 60, { role: 'primary', kind: 'type' }),
        box('background-photo', 0, 0, 900, 900, { role: 'secondary' }),
      ],
      eyePath: ['background-photo', 'headline'],
    });
    expect(result.value.hierarchyAligned).toBe(false);
    expect(result.findings.some((f) =>
      f.severity === 'major' && f.message.includes('heaviest visual mass'))).toBe(true);
  });

  it('flags an eye-path that does not start where the eye actually goes', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [
        box('big', 0, 0, 800, 800),
        box('small', 850, 850, 60, 60, { role: 'primary' }),
      ],
      eyePath: ['small', 'big'],
    });
    expect(result.value.eyePath?.startsAtHeaviest).toBe(false);
    expect(result.findings.some((f) => f.message.includes('eye-path starts at'))).toBe(true);
  });

  it('flags a path naming elements that are not in the composition', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('a', 283, 283, 100, 100, { role: 'primary' })],
      eyePath: ['a', 'ghost'],
    });
    expect(result.value.eyePath?.unknown).toEqual(['ghost']);
  });

  it('treats a missing eye-path as the failure condition it is', () => {
    const result = compositionCheck({
      frame: FRAME,
      structure: 'rule-of-thirds',
      elements: [box('a', 283, 283, 100, 100, { role: 'primary' }), box('b', 700, 700, 50, 50)],
    });
    expect(result.findings.some((f) =>
      f.severity === 'major' && f.message === 'No eye-path is stated.')).toBe(true);
  });

  it('flags type scale contrast too subtle to separate at a glance', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [
        box('h1', 283, 283, 400, 110, { role: 'primary', kind: 'type' }),
        box('h2', 283, 420, 400, 80, { role: 'secondary', kind: 'type' }),
      ],
      eyePath: ['h1', 'h2'],
    });
    expect(result.findings.some((f) => f.message.includes('× the height of the secondary')))
      .toBe(true);
  });

  it('flags a safe default claimed three deliverables running', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('a', 283, 283, 100, 100, { role: 'primary' })],
      eyePath: ['a'],
      priorStructures: ['rule-of-thirds', 'rule-of-thirds', 'diagonal-double-diagonal'],
    });
    expect(result.findings.some((f) => f.message.includes('3 deliverables running'))).toBe(true);
  });

  it('does not flag a habit that is not one yet', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('a', 283, 283, 100, 100, { role: 'primary' })],
      eyePath: ['a'],
      priorStructures: ['symmetry'],
    });
    expect(result.findings.some((f) => f.message.includes('deliverables running'))).toBe(false);
  });
});

describe('the weight model', () => {
  it('weighs contrast alongside area, per Department 14 "darkest value, highest contrast"', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [
        box('pale-large', 0, 0, 400, 400, { contrast: 0.2 }),
        box('dark-small', 600, 600, 250, 250, { contrast: 1, role: 'primary' }),
      ],
      eyePath: ['dark-small', 'pale-large'],
    });
    expect(result.value.heaviest).toBe('dark-small');
    expect(result.value.hierarchyAligned).toBe(true);
  });

  it('reports shares that sum to one', () => {
    const result = check({
      structure: 'rule-of-thirds',
      elements: [box('a', 0, 0, 100, 100, { role: 'primary' }), box('b', 500, 500, 300, 300)],
      eyePath: ['b', 'a'],
    });
    const sum = result.value.elements.reduce((n, e) => n + e.share, 0);
    expect(sum).toBeCloseTo(1, 3);
  });

  it('names itself so the verifier can credit the call', () => {
    expect(check({ structure: 'rule-of-thirds' }).instrument).toBe('composition_check');
  });
});
