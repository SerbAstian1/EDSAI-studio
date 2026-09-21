import { z } from 'zod';

/**
 * A note left for whoever maintains this studio's own tool — a bug, an idea,
 * a question — not tied to any client.
 *
 * Everything else in this file belongs to a client's brand or a client's
 * work. This is the one record that is about the tool itself, which is why
 * it carries no `clientId`: the policy that gates every other resource in
 * `@edsai/auth` is a *client* scope, and forcing one onto a note about the
 * software would be inventing a client this record has nothing to do with.
 * `ScopedStore` gates it directly instead — studio session, editor or above
 * to write — the same threshold every other write needs, applied without a
 * resource that does not fit the shape.
 */

export const SupportKind = z.enum(['bug', 'idea', 'question', 'other']);
export type SupportKind = z.infer<typeof SupportKind>;

export const SupportStatus = z.enum(['open', 'resolved']);
export type SupportStatus = z.infer<typeof SupportStatus>;

export const SupportNote = z.object({
  id: z.string().min(1),
  kind: SupportKind.default('other'),
  body: z.string().min(1),
  status: SupportStatus.default('open'),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});
export type SupportNote = z.infer<typeof SupportNote>;
