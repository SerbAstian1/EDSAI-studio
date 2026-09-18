import { z } from 'zod';

/**
 * The studio's records: clients, the people at them, and the work.
 *
 * These are introduced *before* the features that need them, and with
 * `clientId` on every client-scoped row from the first migration rather than
 * added later. Retrofitting a scope column is how the isolation bug gets
 * written: the row that predates the column is the row nobody remembers to
 * filter.
 *
 * A `Run` now belongs to a `Project`, which belongs to a `Client`. Until this,
 * `Run.projectId` was a free string with nothing behind it.
 */

/** A slug is what a portal URL is built from, so it is constrained here. */
export const Slug = z.string().min(1).max(64).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'a slug is lower-case words joined by single hyphens',
);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

export const ClientStatus = z.enum(['prospect', 'active', 'dormant', 'archived']);
export type ClientStatus = z.infer<typeof ClientStatus>;

export const Client = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Unique; a portal address is derived from it. */
  slug: Slug,
  website: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  status: ClientStatus.default('prospect'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Client = z.infer<typeof Client>;

export const Contact = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  /** Their role at the client, e.g. "Marketing Director". Not an access role. */
  title: z.string().optional(),
  /**
   * Who decides. The brief asks for decision makers to be named, and a project
   * whose approver is unrecorded is a project whose approvals stall.
   */
  decisionMaker: z.boolean().default(false),
  createdAt: z.string(),
});
export type Contact = z.infer<typeof Contact>;

export const ProjectKind = z.enum([
  'brand-identity', 'rebrand', 'campaign', 'website', 'collateral', 'other',
]);
export type ProjectKind = z.infer<typeof ProjectKind>;

/** The creative phases the brief names, in order. */
export const PROJECT_PHASES = [
  'discovery', 'strategy', 'identity', 'applications', 'guidelines', 'handoff', 'complete',
] as const;
export const ProjectPhase = z.enum(PROJECT_PHASES);
export type ProjectPhase = z.infer<typeof ProjectPhase>;

export const Project = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  name: z.string().min(1),
  kind: ProjectKind.default('brand-identity'),
  phase: ProjectPhase.default('discovery'),
  deadline: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

/** How far through the phases a project is, for a progress indicator. */
export function phaseIndex(phase: ProjectPhase): number {
  return PROJECT_PHASES.indexOf(phase);
}

export const StudioUser = z.object({
  id: z.string().min(1),
  email: z.string().min(3),
  name: z.string().min(1),
  role: z.enum(['limited', 'viewer', 'editor', 'brand_manager', 'owner']),
  passwordSalt: z.string().min(1),
  passwordHash: z.string().min(1),
  createdAt: z.string(),
});
export type StudioUser = z.infer<typeof StudioUser>;

export const Session = z.object({
  /** SHA-256 of the token. The token itself is never stored. */
  digest: z.string().length(64),
  userId: z.string().min(1),
  kind: z.enum(['studio', 'portal']),
  /** Set for a portal session, fixed at sign-in and never widened. */
  clientId: z.string().min(1).optional(),
  /** Set for a `limited` portal session: the collections its key granted. */
  collections: z.array(z.string()).optional(),
  role: z.enum(['limited', 'viewer', 'editor', 'brand_manager', 'owner']),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Session = z.infer<typeof Session>;

/**
 * A portal key, as a record.
 *
 * The token itself never appears here: only its SHA-256, exactly as sessions
 * store theirs. `uses` and `lastUsedAt` are what make a bearer credential
 * accountable, so they are part of the record rather than a log elsewhere.
 */
export const PortalKey = z.object({
  digest: z.string().length(64),
  clientId: z.string().min(1),
  /** Who this link was given to, in the designer's words. "Ada at Morrow". */
  label: z.string().min(1),
  role: z.enum(['limited', 'viewer', 'editor', 'brand_manager', 'owner']),
  /** Set only for a `limited` key: which collections it opens. */
  collections: z.array(z.string()).optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().optional(),
  uses: z.number().int().nonnegative(),
});
export type PortalKey = z.infer<typeof PortalKey>;

/** How long a portal link lasts unless the studio says otherwise. */
export const PORTAL_KEY_DAYS = 90;
