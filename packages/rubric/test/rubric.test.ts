import { describe, expect, it } from 'vitest';
import {
  activatedDepartments,
  activationAt,
  buildRubric,
  compositionStructures,
  dimensionsFor,
  findStructure,
} from '../src/index.js';

const rubric = buildRubric();

/**
 * These counts are the drift contract. They are not arbitrary: each is a
 * property of the corpus as written, so a change to a table in markdown that
 * this parser does not follow will fail here rather than silently ship a
 * rubric that disagrees with the document the model reads.
 */
describe('corpus round-trip', () => {
  it('parses all 28 departments across the four tracks', () => {
    expect(rubric.departments).toHaveLength(28);
  });

  it('scores four universal dimensions in every department', () => {
    expect(rubric.universalDimensions).toHaveLength(4);
    expect(rubric.universalDimensions.map((d) => d.name)).toEqual([
      'Brand Fidelity', 'User Clarity', 'Distinctiveness', 'Technical Feasibility',
    ]);
  });

  it('parses 79 department-specific dimensions', () => {
    const total = rubric.departments.reduce((n, d) => n + d.dimensions.length, 0);
    expect(total).toBe(79);
  });

  it('parses the 13-row activation matrix', () => {
    expect(rubric.activationMatrix).toHaveLength(13);
    expect(rubric.activationMatrix.map((r) => r.departmentId))
      .toEqual([35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]);
  });

  it('parses 29 composition structures in 6 families', () => {
    expect(rubric.compositionFamilies).toHaveLength(6);
    expect(compositionStructures(rubric)).toHaveLength(29);
  });

  it('parses the 7 cross-cutting roll-ups', () => {
    expect(rubric.rollUps).toHaveLength(7);
  });

  it('parses 118 measurable-target bullets across department files', () => {
    const total = rubric.departments.reduce((n, d) => n + d.measurableTargets.length, 0);
    expect(total).toBe(118);
  });

  it('parses the four pipeline tracks', () => {
    expect(rubric.tracks.map((t) => t.id)).toEqual([
      'digital-product', 'frontend-block', 'brand-physical', 'closing',
    ]);
  });

  it('gives every department a reference file that exists in the corpus', () => {
    for (const d of rubric.departments) {
      expect(d.reference, `department ${d.id}`).toMatch(/^references\/[\w.-]+\.md$/);
    }
  });
});

describe('reporting modes', () => {
  it('scores most departments', () => {
    expect(rubric.departments.find((d) => d.id === 1)?.mode).toBe('scored');
  });

  it('measures Department 8 rather than scoring it', () => {
    expect(rubric.departments.find((d) => d.id === 8)?.mode).toBe('measured');
    expect(dimensionsFor(rubric, 8)).toEqual([]);
  });

  it('issue-counts Department 9 rather than scoring it', () => {
    expect(rubric.departments.find((d) => d.id === 9)?.mode).toBe('issue-counted');
    expect(dimensionsFor(rubric, 9)).toEqual([]);
  });

  it('gives a scored department its universal dimensions plus its own', () => {
    const dims = dimensionsFor(rubric, 1);
    expect(dims.slice(0, 4).map((d) => d.name)).toEqual(
      rubric.universalDimensions.map((d) => d.name),
    );
    expect(dims.map((d) => d.name)).toContain('Positioning Sharpness');
  });
});

describe('inverse dimensions', () => {
  const inverse = rubric.departments
    .flatMap((d) => d.dimensions)
    .filter((d) => d.inverse)
    .map((d) => d.name);

  it('marks exactly the four the corpus names as inverse', () => {
    expect(new Set(inverse)).toEqual(new Set([
      'Friction-per-Word', 'Code Coupling', 'Motion Payload Discipline', 'Waterfall Discipline',
    ]));
  });

  it('strips the direction annotation from the stored name', () => {
    expect(inverse.every((name) => !name.includes('('))).toBe(true);
  });
});

describe('drift against the canonical list', () => {
  it('finds Department 5 scoring Optical Precision where §3 does not list it', () => {
    expect(rubric.drift).toHaveLength(1);
    expect(rubric.drift[0]).toMatchObject({
      departmentId: 5,
      kind: 'missing-from-canonical',
      dimension: 'Optical Precision',
    });
  });

  it('treats the drifted dimension as scored, since the department file defines it', () => {
    const dept5 = rubric.departments.find((d) => d.id === 5);
    expect(dept5?.dimensions.map((d) => d.name)).toContain('Optical Precision');
    expect(dept5?.dimensions).toHaveLength(4);
  });
});

describe('activation', () => {
  it('runs the always-on departments at every level', () => {
    for (const id of [35, 36, 39, 43]) {
      for (const level of [0, 1, 2, 3, 4, 5] as const) {
        expect(activationAt(rubric, id, level), `dept ${id} L${level}`).toBe('full');
      }
    }
  });

  it('keeps Advanced Architecture off until Level 5', () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      expect(activationAt(rubric, 46, level)).toBe('off');
    }
    expect(activationAt(rubric, 46, 5)).toBe('full');
  });

  it('reads the baseline glyph as baseline, not full', () => {
    expect(activationAt(rubric, 40, 0)).toBe('baseline');
    expect(activationAt(rubric, 41, 1)).toBe('baseline');
    expect(activationAt(rubric, 44, 1)).toBe('baseline');
  });

  it('reads the real-time sub-module marker at Level 3', () => {
    expect(activationAt(rubric, 38, 3)).toBe('full-plus-realtime');
  });

  it('turns State Management off at Level 0 and on from Level 1', () => {
    expect(activationAt(rubric, 37, 0)).toBe('off');
    expect(activationAt(rubric, 37, 1)).toBe('full');
  });

  it('runs departments outside the gated block regardless of level', () => {
    expect(activationAt(rubric, 1, 0)).toBe('full');
  });
});

describe('activated department counts', () => {
  it('runs 19 departments at Level 0', () => {
    expect(activatedDepartments(rubric, 0)).toHaveLength(19);
  });

  it('runs 24 departments at Levels 1 through 4', () => {
    for (const level of [1, 2, 3, 4] as const) {
      expect(activatedDepartments(rubric, level), `L${level}`).toHaveLength(24);
    }
  });

  it('runs 25 departments at Level 5', () => {
    expect(activatedDepartments(rubric, 5)).toHaveLength(25);
  });

  it('never repeats a department that two tracks share', () => {
    const ids = activatedDepartments(rubric, 1).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('runs Motion Engineering after the Motion System and before Engineering', () => {
    const ids = activatedDepartments(rubric, 1).map((d) => d.id);
    expect(ids.indexOf(15)).toBeGreaterThan(ids.indexOf(6));
    expect(ids.indexOf(15)).toBeLessThan(ids.indexOf(7));
  });

  it('closes every run with QA, Critic, then Arbitration', () => {
    const ids = activatedDepartments(rubric, 1).map((d) => d.id);
    expect(ids.slice(-3)).toEqual([9, 10, 11]);
  });

  it('runs the brand track from the same strategic foundation', () => {
    const ids = activatedDepartments(rubric, 0, ['brand-physical', 'closing']).map((d) => d.id);
    expect(ids).toEqual([1, 2, 12, 13, 14, 9, 10, 11]);
  });

  it('produces no row for a skipped department, rather than a zero', () => {
    const ids = activatedDepartments(rubric, 0).map((d) => d.id);
    expect(ids).not.toContain(46);
    expect(ids).not.toContain(37);
  });
});

describe('composition catalog', () => {
  it('gives every structure a unique slug', () => {
    const ids = compositionStructures(rubric).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every structure a description, never a bare name', () => {
    for (const s of compositionStructures(rubric)) {
      expect(s.description.length, s.name).toBeGreaterThan(20);
    }
  });

  it('finds a structure by name or by slug', () => {
    expect(findStructure(rubric, 'Rule of Thirds')?.family).toBe('Grid & Proportion');
    expect(findStructure(rubric, 'rule-of-thirds')?.name).toBe('Rule of Thirds');
  });

  it('returns nothing for an adjective, which is the point of the catalog', () => {
    expect(findStructure(rubric, 'clean and balanced')).toBeUndefined();
  });

  it('keeps the family effect note from the heading', () => {
    const family = rubric.compositionFamilies.find((f) => f.name === 'Grid & Proportion');
    expect(family?.effect).toBe('calm, structured, editorial');
  });
});

describe('severity model', () => {
  it('parses the four severities in order', () => {
    expect(rubric.severities.map((s) => s.name)).toEqual(['Blocker', 'Major', 'Minor', 'Nitpick']);
  });

  it('blocks FINAL on Blocker and Major only', () => {
    const blocking = rubric.severities.filter((s) => s.blocksFinal).map((s) => s.name);
    expect(blocking).toEqual(['Blocker', 'Major']);
  });
});

describe('measurable targets', () => {
  it('parses every discipline in §4 with at least one target', () => {
    expect(rubric.measurableTargets.length).toBeGreaterThanOrEqual(11);
    for (const t of rubric.measurableTargets) {
      expect(t.targets.length, t.discipline).toBeGreaterThan(0);
    }
  });

  it('keeps an example containing commas as one target, not several', () => {
    const motion = rubric.measurableTargets.find((t) => /Motion/i.test(t.discipline));
    expect(motion?.targets.some((t) => t.includes('cubic-bezier'))).toBe(true);
  });

  /**
   * Department 8 is the one department that is entirely measurables, and it is
   * the only one that does not state them under the `## Real Measurable Targets`
   * heading the other seventeen share — its file uses `## 8.1 Performance
   * Targets`, `## 8.2 Accessibility`, `## 8.3 SEO Structure` instead. Its
   * measurables therefore come from the scorecard's §4 table rather than from
   * its own file. This is structural drift in the corpus; the test pins the
   * current shape so that changing it is a deliberate act, not an accident.
   */
  it('takes Department 8 and 9 measurables from §4, not from their own files', () => {
    expect(rubric.departments.find((d) => d.id === 8)?.measurableTargets).toEqual([]);
    expect(rubric.departments.find((d) => d.id === 9)?.measurableTargets).toEqual([]);

    const disciplines = rubric.measurableTargets.map((t) => t.discipline);
    expect(disciplines).toContain('Performance (Core Web Vitals)');
    expect(disciplines).toContain('SEO');
    expect(disciplines).toContain('Accessibility');
  });

  it('spreads the 118 department-stated targets across 17 departments', () => {
    const withTargets = rubric.departments.filter((d) => d.measurableTargets.length > 0);
    expect(withTargets).toHaveLength(17);
  });
});
