import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import type { Onboarding } from '../src/onboarding.js';
import type { Project } from '../src/entities.js';

/**
 * Deleting an onboarding permanently.
 *
 * Two separate claims are under test and they are not the same claim:
 *
 *   1. *What goes.* This schema declares no foreign keys, so a delete is
 *      whatever somebody typed out by hand. The hand-typed list is asserted
 *      here in both directions — the three onboarding-owned tables are empty,
 *      and the client, its project and the sibling onboarding are untouched.
 *      A test that only checked the first direction would pass against a
 *      `DELETE FROM onboardings` with no children cleaned up at all, since
 *      this database would happily keep the orphans.
 *
 *   2. *Who may.* `RunStore.deleteOnboarding` has no idea who is asking. The
 *      gate is `ScopedStore`, so that is what the authorization tests drive,
 *      because a store method tested alone would say nothing about the route.
 */

const NOW = '2026-09-22T00:00:00.000Z';
const CLIENT = 'acme';

const owner: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const editor: Principal = { kind: 'studio', userId: 'u2', role: 'editor' };
const viewer: Principal = { kind: 'studio', userId: 'u3', role: 'viewer' };
const portal: Principal = { kind: 'portal', userId: 'p1', clientId: CLIENT, role: 'owner' };

const onboarding = (id: string, over: Partial<Onboarding> = {}): Onboarding => ({
  id,
  clientId: CLIENT,
  status: 'sent',
  createdAt: NOW,
  ...over,
});

const project = (id: string): Project => ({
  id,
  clientId: CLIENT,
  name: 'Brand identity',
  kind: 'brand-identity',
  createdAt: NOW,
  updatedAt: NOW,
});

/** An onboarding with two answers and two live invites — a link mid-flight. */
function seeded(store: RunStore): void {
  store.saveClient({
    id: CLIENT, name: 'Acme', slug: 'acme', status: 'active', createdAt: NOW, updatedAt: NOW,
  });
  store.saveProject(project('p1'));
  store.saveOnboarding(onboarding('o1'));
  store.saveOnboarding(onboarding('o2', { status: 'accepted', projectId: 'p1' }));
  store.saveAnswer({ onboardingId: 'o1', questionId: 'e1', value: 'directness', answeredAt: NOW });
  store.saveAnswer({ onboardingId: 'o1', questionId: 'e2', value: 4, answeredAt: NOW });
  store.saveAnswer({ onboardingId: 'o2', questionId: 'e1', value: 'warmth', answeredAt: NOW });
  store.saveInvite({ digest: 'd1', onboardingId: 'o1', createdAt: NOW, expiresAt: '2099-01-01T00:00:00.000Z' });
  store.saveInvite({ digest: 'd2', onboardingId: 'o1', createdAt: NOW, expiresAt: '2099-01-01T00:00:00.000Z' });
  store.saveInvite({ digest: 'd3', onboardingId: 'o2', createdAt: NOW, expiresAt: '2099-01-01T00:00:00.000Z' });
}

describe('deleting an onboarding', () => {
  it('removes the record, its answers and its invites, and reports the counts', () => {
    const store = new RunStore();
    seeded(store);

    expect(store.deleteOnboarding('o1')).toEqual({ answers: 2, invites: 2 });
    expect(store.getOnboarding('o1')).toBeUndefined();
    expect(store.getAnswers('o1')).toEqual([]);
    store.close();
  });

  it('kills the capability link, so a deleted onboarding’s URL opens nothing', () => {
    // The failure this prevents is not an orphan row, it is a client holding a
    // live link that resolves to a blank form. `getInvited` is the gate the
    // public form reads, so that is what is asserted.
    const store = new RunStore();
    seeded(store);
    expect(store.getInvited('d1')).toBe('o1');

    store.deleteOnboarding('o1');
    expect(store.getInvited('d1')).toBeUndefined();
    expect(store.getInvited('d2')).toBeUndefined();
    store.close();
  });

  it('leaves the client and the project it became', () => {
    // `onboardings.project_id` is a pointer, not ownership. Deleting the
    // onboarding that created a project must not take the project with it —
    // that project is the work, and it is keyed to the client.
    const store = new RunStore();
    seeded(store);
    store.deleteOnboarding('o2');

    expect(store.getClient(CLIENT)?.name).toBe('Acme');
    expect(store.getProject('p1')?.name).toBe('Brand identity');
    store.close();
  });

  it('leaves a sibling onboarding and its answers alone', () => {
    // One client, several rounds: deleting this one must not take the next.
    const store = new RunStore();
    seeded(store);
    store.deleteOnboarding('o1');

    expect(store.getOnboarding('o2')?.status).toBe('accepted');
    expect(store.getAnswers('o2')).toHaveLength(1);
    expect(store.getInvited('d3')).toBe('o2');
    store.close();
  });

  it('is deletable in every state the flow has', () => {
    // A rule that only ever runs on `draft` is a rule about drafts. Each state
    // is exercised on its own record so one failure cannot hide the others.
    const states = ['draft', 'sent', 'in-progress', 'submitted', 'accepted'] as const;
    const store = new RunStore();
    store.saveClient({
      id: CLIENT, name: 'Acme', slug: 'acme', status: 'active', createdAt: NOW, updatedAt: NOW,
    });
    for (const status of states) {
      const id = `o-${status}`;
      store.saveOnboarding(onboarding(id, { status }));
      store.saveAnswer({ onboardingId: id, questionId: 'e1', value: 'x', answeredAt: NOW });
      store.deleteOnboarding(id);
      expect(store.getOnboarding(id), status).toBeUndefined();
      expect(store.getAnswers(id), status).toEqual([]);
    }
    expect(store.listOnboardings(CLIENT)).toEqual([]);
    store.close();
  });

  it('is a no-op on an id that is not there, rather than an error', () => {
    // A double submit, or a second tab. Making the second one fail would make
    // the button look broken for having worked.
    const store = new RunStore();
    seeded(store);
    expect(store.deleteOnboarding('o1')).toEqual({ answers: 2, invites: 2 });
    expect(store.deleteOnboarding('o1')).toEqual({ answers: 0, invites: 0 });
    store.close();
  });

  it('leaves nothing behind for the deleted id in any of the three tables', () => {
    // Belt and braces on claim 1: count rows directly rather than trusting the
    // getters, so a bug in `getAnswers` cannot mask a row that survived.
    const store = new RunStore();
    seeded(store);
    store.deleteOnboarding('o1');

    const key: Record<string, string> = {
      onboardings: 'id',
      onboarding_answers: 'onboarding_id',
      onboarding_invites: 'onboarding_id',
    };
    for (const [table, column] of Object.entries(key)) {
      const row = store['db'].prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
      ).get('o1') as { n: number };
      expect(row.n, table).toBe(0);
    }
    store.close();
  });
});

describe('who may delete an onboarding', () => {
  it('lets an owner and an editor do it', () => {
    for (const principal of [owner, editor]) {
      const store = new RunStore();
      seeded(store);
      new ScopedStore(store, principal).deleteOnboarding('o1');
      expect(store.getOnboarding('o1'), principal.role).toBeUndefined();
      store.close();
    }
  });

  it('refuses a viewer, and changes nothing', () => {
    const store = new RunStore();
    seeded(store);
    expect(() => new ScopedStore(store, viewer).deleteOnboarding('o1')).toThrow(Forbidden);
    expect(store.getOnboarding('o1')).toBeDefined();
    expect(store.getAnswers('o1')).toHaveLength(2);
    expect(store.getInvited('d1')).toBe('o1');
    store.close();
  });

  it('refuses a portal session, even the client’s own', () => {
    // The asymmetry that matters: a client can *read* their own onboarding and
    // fill it in, but deleting the studio's record of it is not theirs to do.
    const store = new RunStore();
    seeded(store);
    const scoped = new ScopedStore(store, portal);
    expect(scoped.getOnboarding('o1')?.id).toBe('o1');
    expect(() => scoped.deleteOnboarding('o1')).toThrow(Forbidden);
    expect(store.getOnboarding('o1')).toBeDefined();
    store.close();
  });

  it('scopes the gate to the client on the onboarding, not to anything the caller says', () => {
    // A portal session pinned to a *different* client is refused on scope, and
    // the denial names the client read off the record. If the gate were derived
    // from anything the caller supplied — a body field, a query string — the id
    // in the message would be the caller's and this would read differently.
    const store = new RunStore();
    seeded(store);
    const stranger: Principal = { kind: 'portal', userId: 'p2', clientId: 'someone-else', role: 'owner' };
    expect(() => new ScopedStore(store, stranger).deleteOnboarding('o1'))
      .toThrow(/for client acme: this session is not scoped to that client/);
    expect(store.getOnboarding('o1')).toBeDefined();
    store.close();
  });
});
