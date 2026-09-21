import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import { invoiceStatus, invoiceTotals, type Invoice } from '../src/invoices.js';
import { orderMilestones, type Milestone } from '../src/milestones.js';
import type { Client } from '../src/entities.js';
import type { Deliverable } from '../src/deliverables.js';
import type { Message } from '../src/messages.js';
import type { Feedback } from '../src/feedback.js';

/**
 * The client-portal entities: deliverables, milestones, invoices, messages
 * and feedback. Store round-trips prove persistence; the `ScopedStore` tests
 * prove the split this whole feature depends on — a portal reads its own
 * project's status but only the studio ever sets it, except for messages and
 * feedback, which are genuinely two-way.
 */

const NOW = '2026-09-20T00:00:00.000Z';

const client = (id: string): Client => ({
  id, name: id, slug: id, status: 'active', createdAt: NOW, updatedAt: NOW,
});

function fixture(): RunStore {
  const store = new RunStore();
  store.saveClient(client('acme'));
  store.saveClient(client('morrow'));
  return store;
}

const studio: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const acmeViewer: Principal = { kind: 'portal', userId: 'p1', clientId: 'acme', role: 'viewer' };
const acmeEditor: Principal = { kind: 'portal', userId: 'p2', clientId: 'acme', role: 'editor' };
const morrowEditor: Principal = { kind: 'portal', userId: 'p3', clientId: 'morrow', role: 'editor' };

describe('store round-trips', () => {
  it('saves, lists and deletes a deliverable', () => {
    const store = fixture();
    const deliverable: Deliverable = {
      id: 'd1', clientId: 'acme', kind: 'design-assets', title: 'Logo pack',
      status: 'pending', createdAt: NOW, updatedAt: NOW,
    };
    store.saveDeliverable(deliverable);
    expect(store.listDeliverables('acme')).toEqual([deliverable]);
    expect(store.getDeliverable('d1')).toEqual(deliverable);
    store.deleteDeliverable('d1');
    expect(store.listDeliverables('acme')).toEqual([]);
  });

  it('orders milestones by their own order, not by insertion', () => {
    const store = fixture();
    const a: Milestone = {
      id: 'm1', clientId: 'acme', title: 'Second', status: 'upcoming', order: 1,
      createdAt: NOW, updatedAt: NOW,
    };
    const b: Milestone = {
      id: 'm2', clientId: 'acme', title: 'First', status: 'upcoming', order: 0,
      createdAt: NOW, updatedAt: NOW,
    };
    store.saveMilestone(a);
    store.saveMilestone(b);
    expect(store.listMilestones('acme').map((m) => m.title)).toEqual(['First', 'Second']);
  });

  it('round-trips an invoice including its paid flag', () => {
    const store = fixture();
    const invoice: Invoice = {
      id: 'i1', clientId: 'acme', number: 'INV-0001', description: 'Deposit',
      issueDate: '2026-01-01', dueDate: '2026-01-15', amountCents: 50000,
      currency: 'USD', paid: false, createdAt: NOW, updatedAt: NOW,
    };
    store.saveInvoice(invoice);
    expect(store.getInvoice('i1')).toEqual(invoice);
    store.saveInvoice({ ...invoice, paid: true, paidAt: NOW });
    expect(store.getInvoice('i1')?.paid).toBe(true);
  });

  it('appends messages in order without an update method', () => {
    const store = fixture();
    const first: Message = {
      id: 'msg1', clientId: 'acme', authorKind: 'studio', authorName: 'Jane',
      body: 'Hello', createdAt: '2026-01-01T00:00:00.000Z',
    };
    const second: Message = {
      id: 'msg2', clientId: 'acme', authorKind: 'portal', authorName: 'Client',
      body: 'Hi back', createdAt: '2026-01-02T00:00:00.000Z',
    };
    store.saveMessage(second);
    store.saveMessage(first);
    expect(store.listMessages('acme').map((m) => m.id)).toEqual(['msg1', 'msg2']);
  });

  it('lets a reply be saved onto existing feedback', () => {
    const store = fixture();
    const feedback: Feedback = {
      id: 'f1', clientId: 'acme', body: 'Loving the direction.', createdAt: NOW,
    };
    store.saveFeedback(feedback);
    store.saveFeedback({ ...feedback, response: 'Thank you!', respondedAt: NOW });
    expect(store.getFeedback('f1')?.response).toBe('Thank you!');
  });
});

describe('invoice status, computed rather than stored', () => {
  const base: Invoice = {
    id: 'i1', clientId: 'acme', number: 'INV-0001', description: 'x',
    issueDate: '2026-01-01', dueDate: '2026-06-01', amountCents: 10000,
    currency: 'USD', paid: false, createdAt: NOW, updatedAt: NOW,
  };
  const now = new Date('2026-09-20T00:00:00.000Z');

  it('reads a paid invoice as paid regardless of its due date', () => {
    expect(invoiceStatus({ ...base, paid: true, dueDate: '2020-01-01' }, now)).toBe('paid');
  });

  it('reads an unpaid invoice past its due date as overdue', () => {
    expect(invoiceStatus(base, now)).toBe('overdue');
  });

  it('reads an unpaid invoice before its due date as pending', () => {
    expect(invoiceStatus({ ...base, dueDate: '2030-01-01' }, now)).toBe('pending');
  });

  it('totals across paid, pending and overdue buckets', () => {
    const totals = invoiceTotals([
      { ...base, id: 'a', paid: true, amountCents: 100 },
      { ...base, id: 'b', paid: false, dueDate: '2030-01-01', amountCents: 200 },
      { ...base, id: 'c', paid: false, dueDate: '2020-01-01', amountCents: 300 },
    ], now);
    expect(totals).toMatchObject({
      totalCents: 600, paidCents: 100, pendingCents: 200, overdueCents: 300,
      count: 3, pendingCount: 1, overdueCount: 1,
    });
  });
});

describe('milestone ordering', () => {
  it('breaks a tied order by due date', () => {
    const m = (id: string, dueDate: string): Milestone => ({
      id, clientId: 'acme', title: id, status: 'upcoming', order: 0, dueDate,
      createdAt: NOW, updatedAt: NOW,
    });
    const ordered = orderMilestones([m('late', '2026-06-01'), m('early', '2026-01-01')]);
    expect(ordered.map((x) => x.id)).toEqual(['early', 'late']);
  });
});

describe('a client portal reads its own project status but cannot set it', () => {
  const deliverable = (): Deliverable => ({
    id: 'd1', clientId: 'acme', kind: 'document', title: 'Brief', status: 'pending',
    createdAt: NOW, updatedAt: NOW,
  });

  it('a studio session creates a deliverable', () => {
    const scoped = new ScopedStore(fixture(), studio);
    expect(() => scoped.saveDeliverable(deliverable())).not.toThrow();
  });

  it('a portal viewer reads it', () => {
    const store = fixture();
    new ScopedStore(store, studio).saveDeliverable(deliverable());
    const scoped = new ScopedStore(store, acmeViewer);
    expect(scoped.listDeliverables('acme')).toHaveLength(1);
  });

  it('a portal editor cannot create or change one, even for its own client', () => {
    const scoped = new ScopedStore(fixture(), acmeEditor);
    expect(() => scoped.saveDeliverable(deliverable())).toThrow(Forbidden);
  });

  it('the same is true for milestones and invoices', () => {
    const scoped = new ScopedStore(fixture(), acmeEditor);
    expect(() => scoped.saveMilestone({
      id: 'm1', clientId: 'acme', title: 'Kickoff', status: 'upcoming', order: 0,
      createdAt: NOW, updatedAt: NOW,
    })).toThrow(Forbidden);
    expect(() => scoped.saveInvoice({
      id: 'i1', clientId: 'acme', number: 'INV-0001', description: 'x',
      issueDate: NOW, dueDate: NOW, amountCents: 100, currency: 'USD', paid: false,
      createdAt: NOW, updatedAt: NOW,
    })).toThrow(Forbidden);
  });

  it('a client at another studio cannot see acme’s deliverables at all', () => {
    const store = fixture();
    new ScopedStore(store, studio).saveDeliverable(deliverable());
    const scoped = new ScopedStore(store, morrowEditor);
    expect(scoped.listDeliverables('acme')).toEqual([]);
  });
});

describe('messages and feedback are two-way', () => {
  const message = (): Message => ({
    id: 'msg1', clientId: 'acme', authorKind: 'portal', authorName: 'Client',
    body: 'When is the first draft ready?', createdAt: NOW,
  });

  it('a portal editor can send a message', () => {
    const scoped = new ScopedStore(fixture(), acmeEditor);
    expect(() => scoped.saveMessage(message())).not.toThrow();
  });

  it('a portal viewer cannot — sending needs write, reading needs only view', () => {
    const scoped = new ScopedStore(fixture(), acmeViewer);
    expect(() => scoped.saveMessage(message())).toThrow(Forbidden);
  });

  it('the studio can read what a portal sent', () => {
    const store = fixture();
    new ScopedStore(store, acmeEditor).saveMessage(message());
    expect(new ScopedStore(store, studio).listMessages('acme')).toHaveLength(1);
  });

  it('a portal editor can leave feedback', () => {
    const scoped = new ScopedStore(fixture(), acmeEditor);
    expect(() => scoped.saveFeedback({
      id: 'f1', clientId: 'acme', body: 'Great progress!', createdAt: NOW,
    })).not.toThrow();
  });

  it('only the studio can reply to feedback — not even by calling saveFeedback directly', () => {
    const store = fixture();
    const feedback: Feedback = { id: 'f1', clientId: 'acme', body: 'Hi', createdAt: NOW };
    new ScopedStore(store, acmeEditor).saveFeedback(feedback);

    const portal = new ScopedStore(store, acmeEditor);
    expect(() => portal.respondToFeedback({ ...feedback, response: 'Forged' }))
      .toThrow(Forbidden);

    const asStudio = new ScopedStore(store, studio);
    expect(() => asStudio.respondToFeedback({ ...feedback, response: 'Thanks!' }))
      .not.toThrow();
    expect(store.getFeedback('f1')?.response).toBe('Thanks!');
  });
});
