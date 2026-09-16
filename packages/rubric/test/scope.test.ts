import { describe, expect, it } from 'vitest';
import {
  activatedDepartments, buildRubric, excludedDepartments, FULL_SCOPE, isExcluded,
  NO_MOTION_AUTHORING, reductionFor, scopeById, scopeWithout,
} from '../src/index.js';

const rubric = buildRubric();

describe('full scope', () => {
  it('is the default, so an unscoped run is unchanged', () => {
    expect(activatedDepartments(rubric, 1)).toEqual(activatedDepartments(rubric, 1, undefined, FULL_SCOPE));
  });

  it('excludes nothing', () => {
    expect(excludedDepartments(rubric, FULL_SCOPE)).toEqual([]);
  });
});

describe('no-motion-authoring scope', () => {
  it('drops Department 6 from the run', () => {
    const ids = activatedDepartments(rubric, 1, undefined, NO_MOTION_AUTHORING).map((d) => d.id);
    expect(ids).not.toContain(6);
  });

  it('keeps Department 15, because reduced-motion is not optional', () => {
    const ids = activatedDepartments(rubric, 1, undefined, NO_MOTION_AUTHORING).map((d) => d.id);
    expect(ids).toContain(15);
  });

  it('states why Department 15 was kept rather than leaving it implicit', () => {
    const reason = reductionFor(NO_MOTION_AUTHORING, 15);
    expect(reason).toMatch(/prefers-reduced-motion/);
    expect(reason).toMatch(/bundle cost/);
  });

  it('gives no reduction reason for a department it did not reduce', () => {
    expect(reductionFor(NO_MOTION_AUTHORING, 5)).toBeUndefined();
  });

  it('names what it drops, so a project can state it plainly', () => {
    const dropped = excludedDepartments(rubric, NO_MOTION_AUTHORING);
    expect(dropped.map((d) => d.id)).toEqual([6]);
    expect(dropped[0]?.name).toMatch(/Motion/);
  });

  it('runs one department fewer at every level', () => {
    for (const level of [0, 1, 2, 3, 4, 5] as const) {
      const full = activatedDepartments(rubric, level).length;
      const scoped = activatedDepartments(rubric, level, undefined, NO_MOTION_AUTHORING).length;
      expect(scoped, `L${level}`).toBe(full - 1);
    }
  });

  it('leaves 23 departments at Level 1, against the full run\'s 24', () => {
    expect(activatedDepartments(rubric, 1, undefined, NO_MOTION_AUTHORING)).toHaveLength(23);
  });

  it('does not disturb the closing loop', () => {
    const ids = activatedDepartments(rubric, 1, undefined, NO_MOTION_AUTHORING).map((d) => d.id);
    expect(ids.slice(-3)).toEqual([9, 10, 11]);
  });

  it('leaves the brand track untouched, which has no motion department', () => {
    const scoped = activatedDepartments(rubric, 0, ['brand-physical', 'closing'], NO_MOTION_AUTHORING);
    expect(scoped.map((d) => d.id)).toEqual([1, 2, 12, 13, 14, 9, 10, 11]);
  });
});

describe('scope construction', () => {
  it('looks a scope up by id', () => {
    expect(scopeById('no-motion-authoring').excluded).toEqual([6]);
    expect(scopeById('full').excluded).toEqual([]);
  });

  it('rejects an unknown scope id rather than silently running everything', () => {
    expect(() => scopeById('nope')).toThrow(/unknown delivery scope/);
  });

  it('builds a one-off scope for a project', () => {
    const scope = scopeWithout([13, 14], 'No print deliverables on this engagement.');
    expect(isExcluded(scope, 13)).toBe(true);
    expect(isExcluded(scope, 1)).toBe(false);
    const ids = activatedDepartments(rubric, 0, ['brand-physical', 'closing'], scope).map((d) => d.id);
    expect(ids).toEqual([1, 2, 12, 9, 10, 11]);
  });

  it('requires a reduced department to carry its reason', () => {
    for (const [, reason] of Object.entries(NO_MOTION_AUTHORING.reduced)) {
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });
});
