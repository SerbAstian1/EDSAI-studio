import { z } from 'zod';

/**
 * A deliverable: one named thing the studio owes the client.
 *
 * Separate from a `Project` on purpose. A project is one creative engagement;
 * a deliverable is one item inside it — a moodboard, a logo pack, a site —
 * each with its own status. A client asking "where is the brand guide" should
 * find one row that answers, not a project phase that covers a dozen things
 * at once.
 */

export const DeliverableKind = z.enum([
  'document', 'presentation', 'planning', 'data', 'design-assets',
  'development', 'media', 'other',
]);
export type DeliverableKind = z.infer<typeof DeliverableKind>;

export const DeliverableStatus = z.enum(['pending', 'in-progress', 'delivered']);
export type DeliverableStatus = z.infer<typeof DeliverableStatus>;

export const Deliverable = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  kind: DeliverableKind,
  title: z.string().min(1),
  description: z.string().optional(),
  status: DeliverableStatus.default('pending'),
  /** Set once an uploaded file is what "delivered" means for this item. */
  assetId: z.string().optional(),
  /**
   * A Figma file or prototype that *is* this deliverable, previewed in place
   * in the studio and in the client's portal rather than sent as a link to
   * open somewhere else. The URL is checked to be Figma's before it is ever
   * framed — an arbitrary origin in an iframe is not a preview, it is a hole.
   */
  figmaUrl: z.string().optional(),
  dueDate: z.string().optional(),
  deliveredAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Deliverable = z.infer<typeof Deliverable>;

/**
 * True only for an https link on figma.com or one of its subdomains. This is
 * the whole gate between "a URL someone typed" and "an origin we frame", so
 * it is deliberately strict: no http, no look-alike hosts, no bare strings.
 */
export function isFigmaUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'figma.com' || host.endsWith('.figma.com');
}
