import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import type { SupportNote } from '../src/support.js';

/**
 * Notes about the tool itself — the one record with no client behind it.
 * The interesting question here isn't CRUD (that's the same shape as every
 * other record); it's whether a resource with no client id still keeps a
 * portal principal out, since the general policy is written client-first.
 */

const NOW = '2026-09-22T00:00:00.000Z';

const note = (id: string): SupportNote => ({
  id, kind: 'bug', body: 'The Figma link does not open in a new tab.', status: 'open', createdAt: NOW,
});

const owner: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const editor: Principal = { kind: 'studio', userId: 'u2', role: 'editor' };
const viewer: Principal = { kind: 'studio', userId: 'u3', role: 'viewer' };
const portal: Principal = { kind: 'portal', userId: 'p1', clientId: 'acme', role: 'owner' };

describe('support notes', () => {
  it('an editor can write one and read it back', () => {
    const store = new RunStore();
    const scoped = new ScopedStore(store, editor);
    scoped.saveSupportNote(note('n1'));
    expect(scoped.getSupportNote('n1')?.body).toContain('Figma');
    expect(scoped.listSupportNotes()).toHaveLength(1);
  });

  it('a viewer can read but not write', () => {
    const store = new RunStore();
    store.saveSupportNote(note('n1'));
    const scoped = new ScopedStore(store, viewer);
    expect(scoped.listSupportNotes()).toHaveLength(1);
    expect(() => scoped.saveSupportNote(note('n1'))).toThrow(Forbidden);
  });

  it('a portal session — any client, any role — sees none of it and cannot write', () => {
    const store = new RunStore();
    store.saveSupportNote(note('n1'));
    const scoped = new ScopedStore(store, portal);
    expect(scoped.listSupportNotes()).toEqual([]);
    expect(scoped.getSupportNote('n1')).toBeUndefined();
    expect(() => scoped.saveSupportNote(note('n2'))).toThrow(Forbidden);
    expect(() => scoped.deleteSupportNote('n1')).toThrow(Forbidden);
  });

  it('resolving sets a timestamp, reopening clears it', () => {
    const store = new RunStore();
    const scoped = new ScopedStore(store, owner);
    scoped.saveSupportNote(note('n1'));
    scoped.saveSupportNote({ ...note('n1'), status: 'resolved', resolvedAt: NOW });
    expect(scoped.getSupportNote('n1')).toMatchObject({ status: 'resolved', resolvedAt: NOW });

    scoped.saveSupportNote({ ...note('n1'), status: 'open', resolvedAt: undefined });
    expect(scoped.getSupportNote('n1')?.resolvedAt).toBeUndefined();
  });

  it('deletes cleanly', () => {
    const store = new RunStore();
    const scoped = new ScopedStore(store, owner);
    scoped.saveSupportNote(note('n1'));
    scoped.deleteSupportNote('n1');
    expect(scoped.getSupportNote('n1')).toBeUndefined();
  });
});
