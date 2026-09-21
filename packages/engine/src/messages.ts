import { z } from 'zod';

/**
 * A message between the studio and one client.
 *
 * One thread per client rather than a `MessageThread` record of its own: the
 * client scope already *is* the thread — there is exactly one conversation a
 * client's portal can ever see, so a thread id would be a second name for
 * `clientId` that the two could drift apart from.
 */

export const Message = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  authorKind: z.enum(['studio', 'portal']),
  /** Whoever actually typed it — a studio user's name, or the portal role's label. */
  authorName: z.string().min(1),
  body: z.string().min(1),
  /** An uploaded file, referenced rather than duplicated — see `Asset`. */
  attachmentAssetId: z.string().optional(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;
