import type { RunStore } from './store.js';
import { slugify, type Client, type Project } from './entities.js';

/**
 * Resolve a client and project for a run started outside the studio UI.
 *
 * The CLI genuinely does not know which client a brief belongs to, and the
 * honest answer is a named client that says so rather than a blank field. The
 * alternative — letting `clientId` be optional for the CLI path — would put an
 * unscoped row in the same table as scoped ones, and the unscoped row is the
 * one no isolation rule can reason about.
 *
 * Idempotent: the same project name resolves to the same project.
 */

export const UNATTRIBUTED_CLIENT = {
  id: 'client-unattributed',
  slug: 'unattributed',
  name: 'Unattributed',
} as const;

export interface ResolvedProject {
  client: Client;
  project: Project;
}

export function ensureLocalProject(store: RunStore, projectName: string): ResolvedProject {
  const now = new Date().toISOString();

  const client = store.ensureClient({
    id: UNATTRIBUTED_CLIENT.id,
    name: UNATTRIBUTED_CLIENT.name,
    slug: UNATTRIBUTED_CLIENT.slug,
    notes: 'Runs started from the CLI, where no client was named.',
    status: 'archived',
    createdAt: now,
    updatedAt: now,
  });

  const name = projectName.trim() || 'Untitled';
  const existing = store.listProjects(client.id).find((project) => project.name === name);
  if (existing) return { client, project: existing };

  const project = {
    id: `project-${slugify(name) || 'untitled'}-${Math.random().toString(36).slice(2, 6)}`,
    clientId: client.id,
    name,
    kind: 'other' as const,
    phase: 'discovery' as const,
    createdAt: now,
    updatedAt: now,
  };
  store.saveProject(project);
  return { client, project };
}
