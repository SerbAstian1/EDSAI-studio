import { z } from 'zod';

/**
 * Feedback a client leaves on the project, outside the run's own review flow.
 *
 * The engine already has a review cycle for a *run* — issues, conflicts,
 * rescores. This is smaller and less formal on purpose: a client's general
 * word on how the project is going, not tied to a department or a score.
 */

export const Feedback = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  body: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  createdAt: z.string(),
  /** The studio's reply, if it sent one. */
  response: z.string().optional(),
  respondedAt: z.string().optional(),
});
export type Feedback = z.infer<typeof Feedback>;
