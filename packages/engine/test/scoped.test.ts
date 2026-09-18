import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import type { Client, Project } from '../src/entities.js';
import type { Run } from '../src/types.js';

/**
 * Isolation, tested against a database with two clients in it.
 *
 * The policy tests in `@edsai/auth` prove the rules; these prove the rules are
 * actually applied at the boundary — which is the half that a policy nobody
 * calls would still pass.
 */

const NOW = '2026-09-18T00:00:00.000Z';

const client = (id: string, slug: string): Client => ({
  id, name: id, slug, status: 'active', createdAt: NOW, updatedAt: NOW,
});

const project = (id: string, clientId: string): Project => ({
  id, clientId, name: id, kind: 'brand-identity', phase: 'discovery',
  createdAt: NOW, updatedAt: NOW,
});

const run = (id: string, clientId: string, projectId: string): Run => ({
  id, projectId, clientId, brief: 'A brief.', level: 1, tracks: ['brand'],
  scopeId: 'full', activatedDepartments: [1], version: 'V1', status: 'running',
  startedAt: NOW,
});

function fixture(): RunStore {
  const store = new RunStore();
  store.saveClient(client('acme', 'acme'));
  store.saveClient(client('morrow', 'morrow'));
  store.saveProject(project('p-acme', 'acme'));
  store.saveProject(project('p-morrow', 'morrow'));
  store.saveRun(run('r-acme', 'acme', 'p-acme'));
  store.saveRun(run('r-morrow', 'morrow', 'p-morrow'));
  store.saveContact({
    id: 'c1', clientId: 'acme', name: 'A Person', decisionMaker: true, createdAt: NOW,
  });
  store.saveContact({
    id: 'c2', clientId: 'morrow', name: 'Another', decisionMaker: false, createdAt: NOW,
  });
  return store;
}

const studio: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const acmePortal: Principal = { kind: 'portal', userId: 'p1', clientId: 'acme', role: 'editor' };

describe('a portal session sees exactly one client', () => {
  const scoped = (): ScopedStore => new ScopedStore(fixture(), acmePortal);

  it('lists only its own client', () => {
    expect(scoped().listClients().map((c) => c.id)).toEqual(['acme']);
  });

  it('lists only its own runs, even asking for all of them', () => {
    expect(scoped().listRuns().map((r) => r.id)).toEqual(['r-acme']);
  });

  it('lists only its own projects', () => {
    expect(scoped().listProjects().map((p) => p.id)).toEqual(['p-acme']);
  });

  it('cannot fetch another client by id', () => {
    expect(scoped().getClient('morrow')).toBeUndefined();
    expect(scoped().getClient('acme')?.id).toBe('acme');
  });

  it('cannot fetch another client by slug', () => {
    expect(scoped().getClientBySlug('morrow')).toBeUndefined();
  });

  it('cannot fetch another client’s run, even knowing its id', () => {
    expect(scoped().getRun('r-morrow')).toBeUndefined();
    expect(scoped().getRun('r-acme')?.id).toBe('r-acme');
  });

  it('cannot fetch another client’s project', () => {
    expect(scoped().getProject('p-morrow')).toBeUndefined();
  });

  it('gets nothing rather than an error when reading outside its scope', () => {
    // A throw would confirm the id exists, which is the disclosure the policy
    // refuses to make. Reads filter; they do not announce.
    expect(() => scoped().getRun('r-morrow')).not.toThrow();
  });

  it('cannot list another client’s contacts even when naming the client', () => {
    expect(scoped().listContacts('morrow')).toEqual([]);
    expect(scoped().listContacts('acme')).toHaveLength(1);
  });

  it('is asked explicitly for another client’s projects and still gets none', () => {
    expect(scoped().listProjects('morrow')).toEqual([]);
  });
});

describe('a portal session cannot write outside its scope', () => {
  it('throws Forbidden writing another client’s project', () => {
    const scoped = new ScopedStore(fixture(), acmePortal);
    expect(() => scoped.saveProject(project('p-new', 'morrow'))).toThrow(Forbidden);
  });

  it('throws Forbidden writing another client’s contact', () => {
    const scoped = new ScopedStore(fixture(), acmePortal);
    expect(() => scoped.saveContact({
      id: 'x', clientId: 'morrow', name: 'Intruder', decisionMaker: false, createdAt: NOW,
    })).toThrow(Forbidden);
  });

  it('cannot modify the client record even its own', () => {
    const scoped = new ScopedStore(fixture(), acmePortal);
    expect(() => scoped.saveClient(client('acme', 'acme'))).toThrow(Forbidden);
  });

  it('leaves the database untouched when a write is refused', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, acmePortal);
    expect(() => scoped.saveProject(project('p-new', 'morrow'))).toThrow();
    expect(store.getProject('p-new')).toBeUndefined();
  });
});

describe('a viewer cannot write within its own scope', () => {
  const viewer: Principal = { kind: 'portal', userId: 'v', clientId: 'acme', role: 'viewer' };

  it('reads its own client but cannot write its project', () => {
    const scoped = new ScopedStore(fixture(), viewer);
    expect(scoped.getClient('acme')?.id).toBe('acme');
    expect(() => scoped.saveProject(project('p2', 'acme'))).toThrow(/needs at least editor/);
  });
});

describe('the studio sees everything', () => {
  const scoped = (): ScopedStore => new ScopedStore(fixture(), studio);

  it('lists every client, project and run', () => {
    expect(scoped().listClients()).toHaveLength(2);
    expect(scoped().listProjects()).toHaveLength(2);
    expect(scoped().listRuns()).toHaveLength(2);
  });

  it('writes across clients', () => {
    const store = fixture();
    const s = new ScopedStore(store, studio);
    expect(() => s.saveProject(project('p-new', 'morrow'))).not.toThrow();
    expect(store.getProject('p-new')?.clientId).toBe('morrow');
  });
});

describe('scope helpers', () => {
  it('reports whether a client is in scope without fetching it', () => {
    const scoped = new ScopedStore(fixture(), acmePortal);
    expect(scoped.inScope('acme')).toBe(true);
    expect(scoped.inScope('morrow')).toBe(false);
    expect(scoped.inScope('never-existed')).toBe(false);
  });

  it('reports write capability without performing the write', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, acmePortal);
    expect(scoped.canWrite('project', 'acme')).toBe(true);
    expect(scoped.canWrite('project', 'morrow')).toBe(false);
    expect(store.listProjects()).toHaveLength(2);
  });
});
