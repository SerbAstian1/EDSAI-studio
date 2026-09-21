import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import { scopeFromOverrides, type DepartmentOverride } from '../src/process.js';

/**
 * The studio's own process — persisted `DepartmentOverride` rows, and the
 * pure function that turns them back into the `DeliveryScope` a run needs.
 * Permission gating mirrors support notes exactly: not a client's business
 * either way — see `Resource.clientId` in `@edsai/auth`.
 */

const owner: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const editor: Principal = { kind: 'studio', userId: 'u2', role: 'editor' };
const viewer: Principal = { kind: 'studio', userId: 'u3', role: 'viewer' };
const portal: Principal = { kind: 'portal', userId: 'p1', clientId: 'acme', role: 'owner' };

describe('scopeFromOverrides', () => {
  it('is the full scope when there is nothing to say', () => {
    const scope = scopeFromOverrides([]);
    expect(scope.excluded).toEqual([]);
    expect(scope.reduced).toEqual({});
  });

  it('sorts excluded and reduced departments into the scope shape a run reads', () => {
    const overrides: DepartmentOverride[] = [
      { departmentId: 6, state: 'excluded' },
      { departmentId: 15, state: 'reduced', reason: 'Accessibility only, no choreography.' },
    ];
    const scope = scopeFromOverrides(overrides);
    expect(scope.excluded).toEqual([6]);
    expect(scope.reduced).toEqual({ 15: 'Accessibility only, no choreography.' });
  });
});

describe('process overrides', () => {
  it('an editor can exclude a department and read it back', () => {
    const store = new RunStore();
    const scoped = new ScopedStore(store, editor);
    scoped.saveProcessOverride({ departmentId: 6, state: 'excluded' });
    expect(scoped.listProcessOverrides()).toEqual([{ departmentId: 6, state: 'excluded' }]);
  });

  it('refuses a reduction with no reason', () => {
    const store = new RunStore();
    const scoped = new ScopedStore(store, owner);
    expect(() => scoped.saveProcessOverride({ departmentId: 6, state: 'reduced' })).toThrow();
  });

  it('a viewer can read but not write', () => {
    const store = new RunStore();
    store.saveProcessOverride({ departmentId: 6, state: 'excluded' });
    const scoped = new ScopedStore(store, viewer);
    expect(scoped.listProcessOverrides()).toHaveLength(1);
    expect(() => scoped.saveProcessOverride({ departmentId: 7, state: 'excluded' }))
      .toThrow(Forbidden);
  });

  it('a portal session sees none of it and cannot write', () => {
    const store = new RunStore();
    store.saveProcessOverride({ departmentId: 6, state: 'excluded' });
    const scoped = new ScopedStore(store, portal);
    expect(scoped.listProcessOverrides()).toEqual([]);
    expect(() => scoped.saveProcessOverride({ departmentId: 7, state: 'excluded' }))
      .toThrow(Forbidden);
    expect(() => scoped.deleteProcessOverride(6)).toThrow(Forbidden);
  });

  it('deleting resets a department back to running normally', () => {
    const store = new RunStore();
    const scoped = new ScopedStore(store, owner);
    scoped.saveProcessOverride({ departmentId: 6, state: 'excluded' });
    scoped.deleteProcessOverride(6);
    expect(scoped.listProcessOverrides()).toEqual([]);
  });
});
