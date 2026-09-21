import { z } from 'zod';

/**
 * A milestone: a named checkpoint in the project's own timeline.
 *
 * Not derived from the rubric's departments or tracks — those describe how the
 * *pipeline* runs, which a client has no reason to read. A milestone is stated
 * in the studio's own words ("Concept Approval", "First Draft / Build") and
 * ordered by `order` first, `dueDate` second, so the studio can lay out a
 * timeline that matches what was actually promised rather than what the
 * pipeline happens to compute next.
 */

export const MilestoneStatus = z.enum(['upcoming', 'in-progress', 'completed']);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const Milestone = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: MilestoneStatus.default('upcoming'),
  dueDate: z.string().optional(),
  completedAt: z.string().optional(),
  /** Manual ordering — the studio's own running order, not a computed one. */
  order: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Milestone = z.infer<typeof Milestone>;

/** Chronological, `order` first: two milestones due the same week still read
 * in the order the studio laid them out. */
export function orderMilestones(milestones: readonly Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => a.order - b.order
    || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
}
