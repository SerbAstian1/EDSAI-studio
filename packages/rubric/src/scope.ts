import type { Department, Rubric } from './types.js';

/**
 * Delivery scope — which departments a studio actually delivers.
 *
 * The corpus is explicit that a skipped department produces no row: "not a
 * zero, not an N/A". The activation matrix already does this by system level
 * for Departments 35–47. This is the same idea applied for a different reason:
 * a studio may decline to deliver a discipline at all.
 *
 * That is a stronger position than it sounds. `01-strategy-and-direction.md`
 * treats a department with nothing brand-specific to say as a signal that more
 * input is needed, never as permission to fill the gap — so a discipline
 * outside the studio's competence should leave the pipeline rather than produce
 * a confident paragraph nobody can stand behind.
 */

export interface DeliveryScope {
  id: string;
  description: string;
  /** Departments that do not run. They produce no output record and no row. */
  excluded: readonly number[];
  /**
   * Departments kept only for a named reason, when the whole department is out
   * of scope but part of it is not optional. The reason is required: a reduced
   * department with no stated basis is just an excluded one that someone
   * flinched on.
   */
  reduced: Readonly<Record<number, string>>;
}

/** Everything runs. The default when a project states no scope. */
export const FULL_SCOPE: DeliveryScope = {
  id: 'full',
  description: 'Every department in the selected tracks runs.',
  excluded: [],
  reduced: {},
};

/**
 * Motion authoring out, motion hygiene in.
 *
 * Department 6 is creative direction for motion — narrative purpose, timing as
 * expression, choreography. It is scored on taste, and a studio that does not
 * practise it should not ship it.
 *
 * Department 15 cannot leave with it. Its reference file calls itself "the
 * concrete implementation of Department 6's non-negotiable
 * prefers-reduced-motion requirement", and Department 8's accessibility
 * checklist audits reduced-motion, reduced-transparency and reduced-contrast
 * whether or not anyone designed an animation. A site still inherits motion
 * from a component library, a CSS framework or a browser default, and that
 * inherited motion still needs a fallback and compositor-safe properties.
 *
 * So Department 15 stays, reduced: it answers for the motion that exists rather
 * than proposing motion that does not.
 */
export const NO_MOTION_AUTHORING: DeliveryScope = {
  id: 'no-motion-authoring',
  description:
    'Motion is not offered as a creative deliverable. Motion accessibility and ' +
    'payload discipline remain in scope, because they apply to inherited motion too.',
  excluded: [6],
  reduced: {
    15:
      'Accessibility and payload only: prefers-reduced-motion, ' +
      'prefers-reduced-transparency and prefers-contrast handling, animation-library ' +
      'bundle cost against the JS budget, and lifecycle cleanup. No engine selection ' +
      'for expressive motion, no choreography.',
  },
};

export const SCOPES: Record<string, DeliveryScope> = {
  [FULL_SCOPE.id]: FULL_SCOPE,
  [NO_MOTION_AUTHORING.id]: NO_MOTION_AUTHORING,
};

export function scopeById(id: string): DeliveryScope {
  const scope = SCOPES[id];
  if (!scope) throw new Error(`unknown delivery scope: ${id}`);
  return scope;
}

/** Build a scope that drops the named departments, for a one-off project. */
export function scopeWithout(excluded: readonly number[], description?: string): DeliveryScope {
  return {
    id: 'custom',
    description: description ?? `Custom scope excluding departments ${excluded.join(', ')}.`,
    excluded: [...excluded],
    reduced: {},
  };
}

export const isExcluded = (scope: DeliveryScope, id: number): boolean =>
  scope.excluded.includes(id);

export const reductionFor = (scope: DeliveryScope, id: number): string | undefined =>
  scope.reduced[id];

/**
 * Departments a scope removes that the corpus would otherwise have run — so a
 * project can state plainly what it is not delivering, rather than leaving a
 * reader to infer it from an absence.
 */
export function excludedDepartments(rubric: Rubric, scope: DeliveryScope): Department[] {
  return rubric.departments.filter((d) => isExcluded(scope, d.id));
}
