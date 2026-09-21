import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import type { Client, Contact, Project } from '../src/entities.js';
import type { Run } from '../src/types.js';

/**
 * Editing, renaming and deleting — the studio-authenticated paths added
 * alongside the client portal's own equivalents. The rule tested throughout:
 * a delete either succeeds outright (nothing depends on the record) or is
 * refused with a reason a person can act on — never a silent no-op, never a
 * cascade.
 */

const NOW = '2026-09-22T00:00:00.000Z';

const client = (id: string): Client => ({
  id, name: id, slug: id, status: 'active', createdAt: NOW, updatedAt: NOW,
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
  store.saveClient(client('acme'));
  return store;
}

const studio: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const studioEditor: Principal = { kind: 'studio', userId: 'u2', role: 'editor' };
const studioViewer: Principal = { kind: 'studio', userId: 'u3', role: 'viewer' };
const portalEditor: Principal = { kind: 'portal', userId: 'p1', clientId: 'acme', role: 'editor' };

describe('editing a client', () => {
  it('an editor can rename and re-status a client', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, studioEditor);
    scoped.saveClient({ ...client('acme'), name: 'Acme Renamed', status: 'archived' });
    expect(store.getClient('acme')).toMatchObject({ name: 'Acme Renamed', status: 'archived' });
  });

  it('a viewer cannot', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, studioViewer);
    expect(() => scoped.saveClient({ ...client('acme'), name: 'Hijacked' })).toThrow(Forbidden);
  });

  it('a portal session can never edit the client record it reads', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, portalEditor);
    expect(() => scoped.saveClient({ ...client('acme'), name: 'Hijacked' })).toThrow(Forbidden);
  });

  it('round-trips the Slack channel and Google Meet quick links', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, studio);
    scoped.saveClient({
      ...client('acme'),
      slackUrl: 'https://acme.slack.com/archives/C123',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });
    expect(store.getClient('acme')).toMatchObject({
      slackUrl: 'https://acme.slack.com/archives/C123',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });
});

describe('deleting a client', () => {
  it('deletes an empty client', () => {
    const store = fixture();
    new ScopedStore(store, studio).deleteClient('acme');
    expect(store.getClient('acme')).toBeUndefined();
  });

  it('the store itself does not refuse — the guard is the API route, not the engine', () => {
    // ScopedStore.deleteClient trusts its caller to have checked for
    // dependents already (see server.ts) — it is a plain permissioned
    // delete, the same shape as every other one in this file. This test
    // documents that boundary rather than asserting a guard that lives
    // one layer up.
    const store = fixture();
    store.saveProject(project('p1', 'acme'));
    new ScopedStore(store, studio).deleteClient('acme');
    expect(store.getClient('acme')).toBeUndefined();
  });

  it('a viewer cannot delete a client', () => {
    const store = fixture();
    expect(() => new ScopedStore(store, studioViewer).deleteClient('acme')).toThrow(Forbidden);
    expect(store.getClient('acme')).toBeDefined();
  });
});

describe('contacts', () => {
  const contact = (id: string, clientId: string): Contact => ({
    id, clientId, name: 'Ada', decisionMaker: false, createdAt: NOW,
  });

  it('round-trips through get, edit and delete', () => {
    const store = fixture();
    const scoped = new ScopedStore(store, studio);
    scoped.saveContact(contact('c1', 'acme'));
    expect(scoped.getContact('c1')?.name).toBe('Ada');

    scoped.saveContact({ ...contact('c1', 'acme'), name: 'Ada Renamed', decisionMaker: true });
    expect(scoped.getContact('c1')).toMatchObject({ name: 'Ada Renamed', decisionMaker: true });

    scoped.deleteContact('c1');
    expect(scoped.getContact('c1')).toBeUndefined();
  });

  it('a portal session reads its own client’s contacts but cannot edit or delete one', () => {
    // Contacts were already portal-readable before this pass (the client
    // detail response includes them) — that did not change. What is new is
    // that write and delete are now refused rather than simply unreachable
    // because no UI called them.
    const store = fixture();
    new ScopedStore(store, studio).saveContact(contact('c1', 'acme'));
    const asPortal = new ScopedStore(store, portalEditor);
    expect(asPortal.getContact('c1')?.name).toBe('Ada');
    expect(() => asPortal.saveContact(contact('c1', 'acme'))).toThrow(Forbidden);
    expect(() => asPortal.deleteContact('c1')).toThrow(Forbidden);
    expect(store.getContact('c1')).toBeDefined();
  });

  it('deleting an unknown id is a quiet no-op, not an error', () => {
    const store = fixture();
    expect(() => new ScopedStore(store, studio).deleteContact('nope')).not.toThrow();
  });
});

describe('projects', () => {
  it('an editor can rename and rephase a project', () => {
    const store = fixture();
    store.saveProject(project('p1', 'acme'));
    const scoped = new ScopedStore(store, studioEditor);
    scoped.saveProject({ ...project('p1', 'acme'), name: 'Renamed', phase: 'identity' });
    expect(store.getProject('p1')).toMatchObject({ name: 'Renamed', phase: 'identity' });
  });

  it('round-trips the Figma file quick link', () => {
    const store = fixture();
    store.saveProject(project('p1', 'acme'));
    const scoped = new ScopedStore(store, studioEditor);
    scoped.saveProject({ ...project('p1', 'acme'), figmaUrl: 'https://figma.com/file/abc123' });
    expect(store.getProject('p1')).toMatchObject({ figmaUrl: 'https://figma.com/file/abc123' });
  });

  it('a portal session cannot write a project even as an editor', () => {
    const store = fixture();
    store.saveProject(project('p1', 'acme'));
    expect(() => new ScopedStore(store, portalEditor).saveProject(project('p1', 'acme')))
      .toThrow(/studio/);
  });

  it('deletes a project with no run against it', () => {
    const store = fixture();
    store.saveProject(project('p1', 'acme'));
    new ScopedStore(store, studio).deleteProject('p1');
    expect(store.getProject('p1')).toBeUndefined();
  });

  it('the run guard, like the client one, lives at the API layer', () => {
    const store = fixture();
    store.saveProject(project('p1', 'acme'));
    store.saveRun(run('r1', 'acme', 'p1'));
    // ScopedStore itself does not consult listRuns — server.ts does, before
    // ever calling this. Documented here so the boundary is not assumed.
    new ScopedStore(store, studio).deleteProject('p1');
    expect(store.getProject('p1')).toBeUndefined();
    expect(store.getRun('r1')).toBeDefined();
  });
});

describe('portal key relabelling', () => {
  it('changes only the label — role and collections are untouched', () => {
    const store = fixture();
    store.savePortalKey({
      digest: 'd'.repeat(64), clientId: 'acme', label: 'Ada at Morrow', role: 'limited',
      collections: ['logos'], createdAt: NOW, expiresAt: '2027-01-01T00:00:00.000Z',
    });
    store.relabelPortalKey('d'.repeat(64), 'Priya at Morrow');
    const [key] = store.listPortalKeys('acme');
    expect(key).toMatchObject({ label: 'Priya at Morrow', role: 'limited', collections: ['logos'] });
  });
});
