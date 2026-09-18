import { z } from 'zod';

/**
 * Who is making a request.
 *
 * Two populations use this system and they are not variations of one another.
 * A **studio** principal is the creative studio itself: it works across every
 * client, because that is the job. A **portal** principal is one client looking
 * at their own brand, and it is bound to a single `clientId` at the moment the
 * session is created — not at the moment a query is written.
 *
 * That binding is the whole isolation model. A portal principal cannot widen
 * its own scope because the scope is not a parameter it supplies; it is a
 * property of the session, and the store reads it from there.
 */

/** `27` in the brief. Ordered weakest to strongest so comparison is meaningful. */
export const ROLES = ['limited', 'viewer', 'editor', 'brand_manager', 'owner'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

export const StudioPrincipal = z.object({
  kind: z.literal('studio'),
  userId: z.string().min(1),
  role: Role,
});

export const PortalPrincipal = z.object({
  kind: z.literal('portal'),
  userId: z.string().min(1),
  /** The one client this session may ever see. Fixed at sign-in. */
  clientId: z.string().min(1),
  role: Role,
  /**
   * Optional narrowing for the `limited` role — specific collections only.
   * Absent means the whole client, which is what every other role gets.
   */
  collections: z.array(z.string().min(1)).optional(),
});

export const Principal = z.discriminatedUnion('kind', [StudioPrincipal, PortalPrincipal]);
export type Principal = z.infer<typeof Principal>;
export type StudioPrincipal = z.infer<typeof StudioPrincipal>;
export type PortalPrincipal = z.infer<typeof PortalPrincipal>;

/**
 * Which clients a principal may see.
 *
 * `'all'` rather than a list of ids for the studio, because enumerating every
 * client to check one would make the common case O(clients) and would silently
 * start failing the day a client is added while a session is open.
 */
export type Scope = 'all' | { clientIds: readonly string[] };

export function scopeOf(principal: Principal): Scope {
  return principal.kind === 'studio' ? 'all' : { clientIds: [principal.clientId] };
}

export function scopeAllows(scope: Scope, clientId: string): boolean {
  return scope === 'all' || scope.clientIds.includes(clientId);
}
