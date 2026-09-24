import { describe, expect, it } from 'vitest';
import {
  can, require as requirePermission, Forbidden, ACTIONS, atLeast, scopeOf, scopeAllows,
  type Principal, type Resource,
} from '../src/index.js';

/**
 * The isolation model, tested from the attacker's side first.
 *
 * Every rule below is stated as "this principal must NOT be able to", because
 * an authorization test that only checks the permitted path proves nothing —
 * `() => true` passes all of those.
 */

const studio = (role: Principal['role'] = 'owner'): Principal =>
  ({ kind: 'studio', userId: 'u1', role });

const portal = (clientId: string, role: Principal['role'] = 'viewer',
  collections?: string[]): Principal =>
  ({ kind: 'portal', userId: 'c1', clientId, role, ...(collections ? { collections } : {}) });

const res = (clientId: string, kind: Resource['kind'] = 'brand',
  collection?: string): Resource =>
  ({ kind, clientId, ...(collection ? { collection } : {}) });

describe('client isolation', () => {
  it('refuses every action on another client, for every role and action', () => {
    for (const role of ['viewer', 'editor', 'brand_manager', 'owner'] as const) {
      for (const action of ACTIONS) {
        const decision = can(portal('acme', role), action, res('morrow'));
        expect(decision.allowed, `${role}/${action}`).toBe(false);
        expect(decision.reason).toContain('not scoped to that client');
      }
    }
  });

  it('does not leak whether the role would have sufficed on another client', () => {
    const asOwner = can(portal('acme', 'owner'), 'read', res('morrow'));
    const asViewer = can(portal('acme', 'viewer'), 'read', res('morrow'));
    expect(asOwner.reason).toBe(asViewer.reason);
  });

  it('lets a portal read its own client', () => {
    expect(can(portal('acme'), 'read', res('acme')).allowed).toBe(true);
  });

  it('lets the studio across every client', () => {
    expect(can(studio(), 'read', res('anyone')).allowed).toBe(true);
    expect(can(studio(), 'write', res('anyone-else')).allowed).toBe(true);
  });
});

describe('what a portal may never do', () => {
  it('never manages access, even as owner of its own client', () => {
    const decision = can(portal('acme', 'owner'), 'manage-access', res('acme'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('belongs to the studio');
  });

  it('never publishes, even as owner', () => {
    expect(can(portal('acme', 'owner'), 'publish', res('acme')).allowed).toBe(false);
  });

  it('never modifies the client record', () => {
    expect(can(portal('acme', 'owner'), 'write', res('acme', 'client')).allowed).toBe(false);
    expect(can(portal('acme', 'viewer'), 'read', res('acme', 'client')).allowed).toBe(true);
  });

  it('never modifies pipeline runs, even as a client owner', () => {
    const decision = can(portal('acme', 'owner'), 'write', res('acme', 'run'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('studio');
  });
});

describe('the limited role', () => {
  it('reads only the collections it was granted', () => {
    const principal = portal('acme', 'limited', ['logos']);
    expect(can(principal, 'read', res('acme', 'asset', 'logos')).allowed).toBe(true);
    expect(can(principal, 'read', res('acme', 'asset', 'photography')).allowed).toBe(false);
  });

  it('is refused a resource that names no collection at all', () => {
    expect(can(portal('acme', 'limited', ['logos']), 'read', res('acme', 'asset')).allowed)
      .toBe(false);
  });

  it('is read-only whatever the collection', () => {
    const principal = portal('acme', 'limited', ['logos']);
    expect(can(principal, 'write', res('acme', 'asset', 'logos')).allowed).toBe(false);
  });

  it('is refused everything when granted no collections', () => {
    expect(can(portal('acme', 'limited'), 'read', res('acme', 'asset', 'logos')).allowed)
      .toBe(false);
  });

  it('can still read the client record whose portal it is in', () => {
    // Not a hole: a session that cannot name the client it is looking at opens
    // a portal with no title, and every list that resolves clients first —
    // `listAllAssets` among them — returns nothing at all.
    expect(can(portal('acme', 'limited', ['logos']), 'read', res('acme', 'client')).allowed)
      .toBe(true);
  });

  it('still cannot write the client record it may read', () => {
    expect(can(portal('acme', 'limited', ['logos']), 'write', res('acme', 'client')).allowed)
      .toBe(false);
  });

  it('sees files and nothing else about the client', () => {
    const principal = portal('acme', 'limited', ['logos']);
    for (const kind of ['contact', 'project', 'run', 'brand', 'portal'] as const) {
      expect(can(principal, 'read', res('acme', kind)).allowed).toBe(false);
      // And granting a collection does not turn a record into a file.
      expect(can(principal, 'read', res('acme', kind, 'logos')).allowed).toBe(false);
    }
  });

  it('is still bound to its own client, record or not', () => {
    expect(can(portal('acme', 'limited', ['logos']), 'read', res('morrow', 'client')).allowed)
      .toBe(false);
  });
});

describe('role thresholds', () => {
  it('orders roles weakest to strongest', () => {
    expect(atLeast('owner', 'viewer')).toBe(true);
    expect(atLeast('viewer', 'editor')).toBe(false);
    expect(atLeast('editor', 'editor')).toBe(true);
  });

  it('holds a viewer to reading', () => {
    expect(can(studio('viewer'), 'read', res('a')).allowed).toBe(true);
    expect(can(studio('viewer'), 'write', res('a')).allowed).toBe(false);
  });

  it('holds approval and publishing to brand_manager', () => {
    expect(can(studio('editor'), 'approve', res('a')).allowed).toBe(false);
    expect(can(studio('brand_manager'), 'approve', res('a')).allowed).toBe(true);
    expect(can(studio('brand_manager'), 'publish', res('a')).allowed).toBe(true);
  });

  it('holds access management to owner', () => {
    expect(can(studio('brand_manager'), 'manage-access', res('a')).allowed).toBe(false);
    expect(can(studio('owner'), 'manage-access', res('a')).allowed).toBe(true);
  });

  it('states the threshold it refused against', () => {
    expect(can(studio('viewer'), 'write', res('a')).reason).toContain('needs at least editor');
  });
});

describe('scope', () => {
  it('gives the studio everything and a portal exactly one client', () => {
    expect(scopeOf(studio())).toBe('all');
    expect(scopeOf(portal('acme'))).toEqual({ clientIds: ['acme'] });
  });

  it('allows any client under an all scope', () => {
    expect(scopeAllows('all', 'anything')).toBe(true);
    expect(scopeAllows({ clientIds: ['acme'] }, 'morrow')).toBe(false);
  });
});

describe('require', () => {
  it('throws Forbidden naming the action, resource and reason', () => {
    expect(() => requirePermission(portal('acme'), 'write', res('morrow'))).toThrow(Forbidden);
    try {
      requirePermission(portal('acme'), 'write', res('morrow'));
    } catch (error) {
      expect((error as Forbidden).action).toBe('write');
      expect((error as Error).message).toContain('not scoped to that client');
    }
  });

  it('returns quietly when allowed', () => {
    expect(() => requirePermission(studio(), 'write', res('a'))).not.toThrow();
  });
});
