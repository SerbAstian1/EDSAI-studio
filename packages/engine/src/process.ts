import { z } from 'zod';
import type { DeliveryScope } from '@edsai/rubric';

/**
 * The studio's own process — which departments it actually delivers,
 * persisted so it survives past one server boot.
 *
 * `@edsai/rubric` already has the real mechanism for this: a `DeliveryScope`
 * excludes a department outright or keeps it reduced, for a stated reason.
 * That type is immutable and in-memory — exactly right for the two built-in
 * scopes (`FULL_SCOPE`, `NO_MOTION_AUTHORING`), wrong for a studio's own
 * choice, which has to be read and written like any other record. This is
 * the storable form: one row per department the studio has an opinion
 * about, everything else runs as the corpus says. `scopeFromOverrides`
 * turns the stored rows back into the `DeliveryScope` a run actually needs.
 */

export const DepartmentOverrideState = z.enum(['excluded', 'reduced']);
export type DepartmentOverrideState = z.infer<typeof DepartmentOverrideState>;

export const DepartmentOverride = z.object({
  departmentId: z.number().int().positive(),
  state: DepartmentOverrideState,
  /** Required when reduced — an unreasoned reduction is just an exclusion no one committed to. */
  reason: z.string().min(1).optional(),
}).refine((o) => o.state !== 'reduced' || Boolean(o.reason?.trim()), {
  message: 'a reduced department needs a stated reason',
  path: ['reason'],
});
export type DepartmentOverride = z.infer<typeof DepartmentOverride>;

/** No overrides at all — every department in the selected tracks runs, same as `FULL_SCOPE`. */
export function scopeFromOverrides(overrides: readonly DepartmentOverride[]): DeliveryScope {
  const excluded = overrides.filter((o) => o.state === 'excluded').map((o) => o.departmentId);
  const reduced = Object.fromEntries(
    overrides.filter((o) => o.state === 'reduced').map((o) => [o.departmentId, o.reason ?? '']),
  );
  return {
    id: 'studio',
    description: overrides.length === 0
      ? 'Every department in the selected tracks runs.'
      : `This studio's own process — ${excluded.length} department(s) excluded, `
        + `${Object.keys(reduced).length} reduced.`,
    excluded,
    reduced,
  };
}
