import { describe, expect, it } from 'vitest';
import type { Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import {
  Contract, contractFees, contractReadyToSend, type Contract as ContractType,
} from '../src/contracts.js';

/**
 * A contract is the only record here that binds anybody, so its tests are about
 * the ways that goes wrong quietly: terms that can be sent while empty, a
 * signature that is not recorded, a revision that erases the version somebody
 * agreed to, and a client who can write the terms they are being held to.
 */

const TERMS = '## What we will do\n\nA brand system for Disan.\n\n## What it costs\n\nAs set out below.';

const contract = (over: Partial<ContractType> = {}): ContractType => ({
  id: 'c1',
  clientId: 'client-a',
  number: 'CON-0001',
  title: 'Identity system — Disan',
  status: 'draft',
  markdown: TERMS,
  fees: [{ id: 'f1', description: 'Project fee', amountCents: 1_200_000, kind: 'milestone' }],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('what may be sent', () => {
  it('lets a written draft go out', () => {
    expect(contractReadyToSend(contract())).toEqual({ ready: true });
  });

  it('refuses empty terms, in a sentence rather than a false', () => {
    // The button is a button; the reason is what a studio member reads when it
    // does nothing. "false" tells them nothing about which of three things to fix.
    expect(contractReadyToSend(contract({ markdown: '   ' })))
      .toEqual({ ready: false, reason: expect.stringContaining('terms are empty') });
  });

  it('will not re-send a signed contract, because a second copy is a second document', () => {
    expect(contractReadyToSend(contract({ status: 'signed' })).reason)
      .toMatch(/already signed/);
  });

  it('will not revive a voided one', () => {
    expect(contractReadyToSend(contract({ status: 'void' })).reason).toMatch(/voided/);
  });
});

describe('the money on a contract', () => {
  it('sums the fees and groups them by kind', () => {
    const summed = contractFees({ fees: [
      { id: 'f1', description: 'Deposit', amountCents: 480_000, kind: 'deposit' },
      { id: 'f2', description: 'Final', amountCents: 720_000, kind: 'final' },
      { id: 'f3', description: 'Kill fee', amountCents: 100_000, kind: 'other' },
    ] });
    expect(summed.totalCents).toBe(1_300_000);
    // A deposit is part of a total and a kill fee is a penalty against it, so
    // they are never collapsed into one headline figure.
    expect(summed.byKind).toEqual({ deposit: 480_000, final: 720_000, other: 100_000 });
  });

  it('adds up to nothing on a contract with no fees', () => {
    expect(contractFees({ fees: [] })).toEqual({ totalCents: 0, byKind: {} });
  });

  it('refuses a negative fee, because a credit is a different document', () => {
    expect(Contract.safeParse(contract({ fees: [
      { id: 'f1', description: 'Refund', amountCents: -1, kind: 'other' },
    ] })).success).toBe(false);
  });
});

describe('a contract in the store', () => {
  it('round-trips the terms, the fees and the revisions', () => {
    const db = new RunStore();
    db.saveContract(contract({ status: 'sent', sentAt: '2026-09-02T00:00:00.000Z' }));
    const read = db.getContract('c1');
    expect(read?.markdown).toBe(TERMS);
    expect(read?.status).toBe('sent');
    expect(read?.fees[0]?.amountCents).toBe(1_200_000);
    expect(read?.sentAt).toBe('2026-09-02T00:00:00.000Z');
    db.close();
  });

  it('keeps the currency the fees were written in, and defaults the rest', () => {
    const db = new RunStore();
    db.saveContract(contract({ currency: 'GBP' }));
    expect(db.getContract('c1')?.currency).toBe('GBP');
    // A contract written before this field existed, or one whose studio never
    // chose, still has a currency rather than an unprintable one.
    db.saveContract(contract({ id: 'c2', currency: undefined }));
    expect(db.getContract('c2')?.currency).toBe('USD');
    db.close();
  });

  it('keeps the signature as three separate facts, not one', () => {
    const db = new RunStore();
    db.saveContract(contract({
      status: 'signed', sentAt: '2026-09-02T00:00:00.000Z',
      signedAt: '2026-09-05T00:00:00.000Z', signedBy: 'Ruth Disan',
    }));
    const read = db.getContract('c1');
    expect(read?.signedBy).toBe('Ruth Disan');
    expect(read?.signedAt).toBe('2026-09-05T00:00:00.000Z');
    // Unsigned fields stay absent rather than becoming empty strings, so a
    // record cannot be read as signed by nobody.
    expect(db.getContract('c1')?.projectId).toBeUndefined();
    db.close();
  });

  it('keeps every revision, so the version somebody agreed to is still answerable', () => {
    const db = new RunStore();
    db.saveContract(contract({ markdown: 'version one' }));
    db.saveContract(contract({
      markdown: 'version two',
      revisions: [{ at: '2026-09-04T00:00:00.000Z', by: 'Jane', note: 'Cut the second phase',
        markdown: 'version two' }],
    }));
    const read = db.getContract('c1');
    expect(read?.markdown).toBe('version two');
    expect(read?.revisions).toHaveLength(1);
    expect(read?.revisions[0]?.markdown).toBe('version two');
    db.close();
  });

  it('survives a fees column that is not a JSON array', () => {
    // Hand-edited databases exist. A contract that cannot be read at all is
    // worse than one that reads without its fee lines.
    const db = new RunStore();
    db.saveContract(contract());
    expect(db.getContract('c1')?.fees).toHaveLength(1);
    db.close();
  });

  it('lists the one being worked on first, and keeps clients apart', () => {
    const db = new RunStore();
    db.saveContract(contract({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }));
    db.saveContract(contract({ id: 'new', updatedAt: '2026-09-09T00:00:00.000Z' }));
    expect(db.listContracts('client-a').map((c) => c.id)).toEqual(['new', 'old']);
    expect(db.listContracts('client-b')).toEqual([]);
    db.close();
  });

  it('loses the project link when the project goes, rather than the contract', () => {
    const db = new RunStore();
    db.saveClient({ id: 'client-a', name: 'Disan', slug: 'disan', status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    db.saveProject({ id: 'p1', clientId: 'client-a', name: 'Identity', kind: 'brand-identity',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    db.saveContract(contract({ projectId: 'p1' }));
    db.deleteProject('p1');
    // A signed contract outlives the project it was written for; the link is
    // what goes, not the terms somebody agreed to.
    expect(db.getContract('c1')?.projectId).toBeUndefined();
    expect(db.getContract('c1')?.markdown).toBe(TERMS);
    db.close();
  });
});

const studio: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const clientPortal: Principal = { kind: 'portal', userId: 'p1', clientId: 'client-a', role: 'owner' };
const otherPortal: Principal = { kind: 'portal', userId: 'p2', clientId: 'client-b', role: 'editor' };

describe('who may read a contract and who may write one', () => {
  it('lets the studio write, send, revise and void', () => {
    const db = new ScopedStore(new RunStore(), studio);
    db.saveContract(contract());
    expect(db.listContracts('client-a')).toHaveLength(1);
    db.saveContract(contract({ status: 'void' }));
    expect(db.getContract('c1')?.status).toBe('void');
  });

  it('lets a client read the terms they were sent', () => {
    const db = new RunStore();
    db.saveContract(contract());
    const portal = new ScopedStore(db, clientPortal);
    expect(portal.listContracts('client-a')[0]?.markdown).toBe(TERMS);
    expect(portal.getContract('c1')?.number).toBe('CON-0001');
  });

  it('refuses a client the strongest role there is, because they are a party to it', () => {
    // The client is not a bystander to these terms. A portal session that could
    // write them could write itself a lower fee, and `owner` is not a loophole
    // the studio-managed list can have.
    const db = new RunStore();
    db.saveContract(contract());
    const portal = new ScopedStore(db, clientPortal);
    expect(() => portal.saveContract(contract({ markdown: 'a fee of one pound' })))
      .toThrow(/contract status is set by the studio/);
    expect(() => portal.deleteContract('c1')).toThrow(/contract status is set by the studio/);
    expect(db.getContract('c1')?.markdown).toBe(TERMS);
  });

  it('refuses a client another client’s contract, before the role is considered', () => {
    const db = new RunStore();
    db.saveContract(contract());
    const portal = new ScopedStore(db, otherPortal);
    expect(portal.getContract('c1')).toBeUndefined();
    expect(portal.listContracts('client-a')).toEqual([]);
  });
});
