import { atLeast, scopeAllows, scopeOf, type Principal } from './principal.js';

/**
 * The authorization policy, as a pure function.
 *
 * Kept separate from anything that reads a database so every rule can be tested
 * exhaustively without one, and so the answer to "who can do what" is readable
 * in a single file rather than distributed across route handlers.
 *
 * Enforcement is elsewhere, and deliberately: `ScopedStore` calls this at the
 * data boundary. A policy that route handlers are trusted to call is a policy
 * that stops being applied the first time someone adds a route.
 */

export const ACTIONS = ['read', 'write', 'approve', 'publish', 'manage-access'] as const;
export type Action = typeof ACTIONS[number];

export const RESOURCES = [
  'client', 'contact', 'project', 'run', 'brand', 'asset', 'portal',
  'deliverable', 'document', 'milestone', 'invoice', 'message', 'feedback', 'support', 'process',
  // The hub's own switch and tool list are the studio's; the designs a
  // client makes inside it are the client's, written like a message is.
  'brand-hub', 'brand-project',
] as const;
export type ResourceKind = typeof RESOURCES[number];

/** Studio-only writes: a client portal reads its own status, never sets it. */
const STUDIO_MANAGED: readonly ResourceKind[] = [
  'deliverable', 'document', 'milestone', 'invoice', 'contact', 'project', 'run', 'brand-hub',
];

export interface Resource {
  kind: ResourceKind;
  /**
   * Which client's data this is. Everything client-scoped carries one —
   * `support` is the one kind that is not about a client at all, and passes
   * an empty string here. A portal principal's scope is a list of real
   * client ids, so an empty string never matches it and every portal
   * session is refused before any role is even considered; a studio
   * principal's scope is `'all'`, so this reaches the ordinary role check
   * below untouched. No special case needed for either.
   */
  clientId: string;
  /** For `limited` portal principals: which collection the resource sits in. */
  collection?: string;
}

export interface Decision {
  allowed: boolean;
  /** Stated for every refusal, so a 403 can say something true. */
  reason?: string;
}

const ALLOW: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

/** The minimum role each action needs, once the client scope already matched. */
const NEEDS: Record<Action, 'viewer' | 'editor' | 'brand_manager' | 'owner'> = {
  read: 'viewer',
  write: 'editor',
  approve: 'brand_manager',
  publish: 'brand_manager',
  'manage-access': 'owner',
};

export function can(principal: Principal, action: Action, resource: Resource): Decision {
  // 1. Scope first. A principal that cannot see the client cannot be told
  //    anything about it, including whether its role would have sufficed —
  //    that answer is itself a disclosure.
  if (!scopeAllows(scopeOf(principal), resource.clientId)) {
    return deny('this session is not scoped to that client');
  }

  // 2. A `limited` portal principal sees only the collections it was granted.
  //
  //    The restriction is about **collections**, and only assets have those. An
  //    earlier version treated "this resource has no collection" as "not
  //    granted", which denied a limited session its own client record — so a
  //    contractor given the logos folder opened a portal that could not name
  //    whose portal it was, and `listAllAssets`, which resolves clients first,
  //    returned nothing at all. Absence of a collection is not a denial; it
  //    means the question does not apply, and the resource kind decides.
  if (principal.kind === 'portal' && principal.role === 'limited') {
    if (action !== 'read') {
      return deny('a limited portal session is read-only');
    }
    if (resource.kind === 'client') return ALLOW;
    if (resource.kind !== 'asset') {
      return deny(`a limited session sees files, not ${resource.kind} records`);
    }
    const granted = principal.collections ?? [];
    if (resource.collection === undefined || !granted.includes(resource.collection)) {
      return deny('this session is limited to specific collections');
    }
    return ALLOW;
  }

  // 3. A portal principal never manages access or publishes, whatever its role
  //    within the client. Those are the studio's, and a client who could grant
  //    themselves access would make every other rule here decorative.
  if (principal.kind === 'portal' && (action === 'manage-access' || action === 'publish')) {
    return deny(`${action} belongs to the studio, not to a client portal`);
  }

  // 4. A client record itself is the studio's to create and edit; a portal may
  //    read its own but never write it.
  if (principal.kind === 'portal' && resource.kind === 'client' && action !== 'read') {
    return deny('a client portal cannot modify the client record');
  }

  // 5. Deliverables, milestones and invoices are the studio's own tracking of
  //    its own work — a portal reads them to see where things stand, but only
  //    the studio moves one to done or marks an invoice paid. Messages and
  //    feedback stay off this list deliberately: those are genuinely two-way,
  //    gated by the ordinary role check below like any other write.
  if (principal.kind === 'portal' && STUDIO_MANAGED.includes(resource.kind) && action !== 'read') {
    return deny(`${resource.kind} status is set by the studio, not from a client portal`);
  }

  return atLeast(principal.role, NEEDS[action])
    ? ALLOW
    : deny(`${action} needs at least ${NEEDS[action]}; this session is ${principal.role}`);
}

/** Throwing form, for the call sites that must not carry on regardless. */
export class Forbidden extends Error {
  constructor(readonly action: Action, readonly resource: Resource, reason: string) {
    super(`Refusing ${action} on ${resource.kind} for client ${resource.clientId}: ${reason}.`);
    this.name = 'Forbidden';
  }
}

export function require(principal: Principal, action: Action, resource: Resource): void {
  const decision = can(principal, action, resource);
  if (!decision.allowed) throw new Forbidden(action, resource, decision.reason ?? 'refused');
}
