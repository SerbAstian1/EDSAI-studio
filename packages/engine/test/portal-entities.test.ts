import { describe, expect, it } from 'vitest';
import { Forbidden, type Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import {
  invoiceStatus, invoiceTotals, lineAmountCents, invoiceSubtotalCents, invoiceTaxCents,
  invoiceAmounts, type Invoice,
} from '../src/invoices.js';
import { orderMilestones, type Milestone } from '../src/milestones.js';
import type { Client } from '../src/entities.js';
import { isFigmaUrl, type Deliverable } from '../src/deliverables.js';
import type { BrandHub, BrandProject } from '../src/brand-hub.js';
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

  it('keeps a Figma preview URL, and drops it when cleared', () => {
    const store = fixture();
    const base: Deliverable = {
      id: 'd2', clientId: 'acme', kind: 'document', title: 'Brand guide',
      status: 'in-progress', createdAt: NOW, updatedAt: NOW,
      figmaUrl: 'https://www.figma.com/design/abc/Brand-guide',
    };
    store.saveDeliverable(base);
    expect(store.getDeliverable('d2')?.figmaUrl).toBe('https://www.figma.com/design/abc/Brand-guide');
    const { figmaUrl: _cleared, ...withoutFigma } = base;
    store.saveDeliverable(withoutFigma);
    expect(store.getDeliverable('d2')).toEqual(withoutFigma);
  });

  it('keeps one document per slot per client, and replaces rather than duplicates', () => {
    const store = fixture();
    store.saveDocument({
      clientId: 'acme', slot: 'contract', figmaUrl: 'https://www.figma.com/design/c1/Contract',
      updatedAt: NOW,
    });
    store.saveDocument({
      clientId: 'acme', slot: 'contract', figmaUrl: 'https://www.figma.com/design/c2/Contract-v2',
      note: 'v2', updatedAt: NOW,
    });
    const docs = store.listDocuments('acme');
    expect(docs).toHaveLength(1);
    expect(docs[0]?.figmaUrl).toContain('c2');
    expect(docs[0]?.note).toBe('v2');
    expect(store.listDocuments('morrow')).toEqual([]);
    store.deleteDocument('acme', 'contract');
    expect(store.listDocuments('acme')).toEqual([]);
  });

  it('refuses a document in a slot that does not exist', () => {
    const store = fixture();
    expect(() => store.saveDocument({
      clientId: 'acme', slot: 'moodboard' as never, figmaUrl: 'https://www.figma.com/x', updatedAt: NOW,
    })).toThrow();
  });

  it('a portal reads the shelf and never writes it', () => {
    const store = fixture();
    new ScopedStore(store, studio).saveDocument({
      clientId: 'acme', slot: 'proposal', figmaUrl: 'https://www.figma.com/design/p/Proposal', updatedAt: NOW,
    });
    const viewer = new ScopedStore(store, acmeViewer);
    expect(viewer.listDocuments('acme')).toHaveLength(1);
    expect(() => new ScopedStore(store, acmeEditor).saveDocument({
      clientId: 'acme', slot: 'invoice', figmaUrl: 'https://www.figma.com/design/i/Invoice', updatedAt: NOW,
    })).toThrow(Forbidden);
    expect(new ScopedStore(store, morrowEditor).listDocuments('acme')).toEqual([]);
  });

  it('only frames figma.com', () => {
    expect(isFigmaUrl('https://www.figma.com/design/abc/Brand')).toBe(true);
    expect(isFigmaUrl('https://figma.com/proto/abc')).toBe(true);
    expect(isFigmaUrl('https://embed.figma.com/design/abc')).toBe(true);
    expect(isFigmaUrl('http://www.figma.com/design/abc')).toBe(false);
    expect(isFigmaUrl('https://figma.com.evil.example/design/abc')).toBe(false);
    expect(isFigmaUrl('https://notfigma.com/design/abc')).toBe(false);
    expect(isFigmaUrl('javascript:alert(1)')).toBe(false);
    expect(isFigmaUrl('figma.com/design/abc')).toBe(false);
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
    // Defaults are part of the record: an invoice written before there were
    // lines reads back as an invoice with no lines, not as a broken one.
    expect(store.getInvoice('i1')).toEqual({ ...invoice, lines: [], taxBasisPoints: 0 });
    store.saveInvoice({ ...invoice, paid: true, paidAt: NOW });
    expect(store.getInvoice('i1')?.paid).toBe(true);
  });

  it('round-trips invoice lines in the order they were filed', () => {
    const store = fixture();
    const invoice: Invoice = {
      id: 'i2', clientId: 'acme', number: 'INV-0002', description: 'Identity work',
      issueDate: '2026-02-01', dueDate: '2026-02-15',
      // 120000 + 150000, plus the 20% proposed below: the store derives this,
      // so a round-trip means the derived total came back rather than the typed one.
      amountCents: 324000,
      currency: 'GBP', lines: [
        { id: 'l1', description: 'Discovery workshop', quantityHundredths: 100,
          unitAmountCents: 120000, createdAt: NOW },
        { id: 'l2', description: 'Identity system', quantityHundredths: 100,
          unitAmountCents: 150000, createdAt: NOW },
      ],
      taxBasisPoints: 2000, terms: 'Net 14. Bank transfer.',
      paid: false, createdAt: NOW, updatedAt: NOW,
    };
    store.saveInvoice(invoice);
    expect(store.getInvoice('i2')).toEqual(invoice);
  });

  it('derives the stored total from the lines, whatever the caller sent', () => {
    const store = fixture();
    // The route already adds this up, but the store is where the row is
    // written and it is reachable by seeds, tests and anything written later.
    // A total that disagrees with the lines under it is the one thing an
    // invoice must never be.
    store.saveInvoice({
      id: 'i2b', clientId: 'acme', number: 'INV-0002B', description: 'Identity work',
      issueDate: '2026-02-01', dueDate: '2026-02-15',
      // Deliberately wrong: 120000 + 150000, plus 20% on top.
      amountCents: 1,
      currency: 'GBP', lines: [
        { id: 'l1', description: 'Discovery workshop', quantityHundredths: 100,
          unitAmountCents: 120000, createdAt: NOW },
        { id: 'l2', description: 'Identity system', quantityHundredths: 100,
          unitAmountCents: 150000, createdAt: NOW },
      ],
      taxBasisPoints: 2000, paid: false, createdAt: NOW, updatedAt: NOW,
    });
    expect(store.getInvoice('i2b')?.amountCents).toBe(324000);
  });

  it('keeps the stated total on an invoice that has no lines', () => {
    const store = fixture();
    store.saveInvoice({
      id: 'i2c', clientId: 'acme', number: 'INV-0002C', description: 'Retainer',
      issueDate: '2026-02-01', dueDate: '2026-02-15', amountCents: 120000,
      taxBasisPoints: 2000, paid: false, createdAt: NOW, updatedAt: NOW,
    });
    // No lines means nothing to derive from: the number it was created with is
    // the only total it has, and the tax on it is shown beside it.
    const stored = store.getInvoice('i2c');
    expect(stored?.amountCents).toBe(120000);
    expect(stored && invoiceAmounts(stored)).toEqual({
      subtotalCents: 120000, taxCents: 24000, totalCents: 144000,
    });
  });

  it('replaces the line set on save, so a removed line leaves the total', () => {
    const store = fixture();
    const base: Invoice = {
      id: 'i3', clientId: 'acme', number: 'INV-0003', description: 'Two lines',
      issueDate: '2026-02-01', dueDate: '2026-02-15', amountCents: 200,
      currency: 'USD', paid: false, createdAt: NOW, updatedAt: NOW,
    };
    const line = (id: string, cents: number) => ({
      id, description: id, quantityHundredths: 100, unitAmountCents: cents, createdAt: NOW,
    });
    store.saveInvoice({ ...base, lines: [line('a', 100), line('b', 100)] });
    expect(store.getInvoice('i3')?.lines).toHaveLength(2);
    // Saving with one line is a deletion, and the orphan has to go with it.
    store.saveInvoice({ ...base, lines: [line('a', 100)] });
    expect(store.getInvoice('i3')?.lines.map((l) => l.id)).toEqual(['a']);
  });

  it('takes an invoice\'s lines with it when the invoice is deleted', () => {
    const store = fixture();
    store.saveInvoice({
      id: 'i4', clientId: 'acme', number: 'INV-0004', description: 'Gone',
      issueDate: '2026-02-01', dueDate: '2026-02-15', amountCents: 100,
      currency: 'USD', lines: [{
        id: 'l1', description: 'Work', quantityHundredths: 100,
        unitAmountCents: 100, createdAt: NOW,
      }],
      paid: false, createdAt: NOW, updatedAt: NOW,
    });
    store.deleteInvoice('i4');
    expect(store.getInvoice('i4')).toBeUndefined();
    // Nothing here cascades, so the lines are removed explicitly. Re-saving the
    // id afterwards must not resurrect them.
    store.saveInvoice({
      id: 'i4', clientId: 'acme', number: 'INV-0004', description: 'Again',
      issueDate: '2026-02-01', dueDate: '2026-02-15', amountCents: 100,
      currency: 'USD', paid: false, createdAt: NOW, updatedAt: NOW,
    });
    expect(store.getInvoice('i4')?.lines).toEqual([]);
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

describe('invoice arithmetic, in integers', () => {
  const line = (description: string, quantityHundredths: number, unitAmountCents: number) =>
    ({ description, quantityHundredths, unitAmountCents });

  it('multiplies a fractional quantity without floating point drift', () => {
    // 7.5 hours at £120 is £900. In floats, 7.5 * 12000 is 90000.00000000001.
    expect(lineAmountCents(line('Design', 750, 12000))).toBe(90000);
    // Half a unit of £33.35 is £16.675, and half a cent rounds up rather than
    // being lost — three lines like that would otherwise quietly be a penny short.
    expect(lineAmountCents(line('Half hour', 50, 3335))).toBe(1668);
  });

  it('sums the lines into a subtotal', () => {
    expect(invoiceSubtotalCents([
      line('Workshop', 100, 120000), line('System', 250, 60000),
    ])).toBe(270000);
  });

  it('turns a proposed rate in basis points into an amount', () => {
    expect(invoiceTaxCents(100000, 2000)).toBe(20000);
    expect(invoiceTaxCents(100000, 0)).toBe(0);
    // 20% of 33.335 rounds to the nearest cent, not down.
    expect(invoiceTaxCents(3335, 2000)).toBe(667);
  });

  it('falls back to the stored amount when there are no lines', () => {
    // An invoice recorded as one number has to keep totalling that number.
    expect(invoiceAmounts({ lines: [], taxBasisPoints: 0, amountCents: 45000 }))
      .toEqual({ subtotalCents: 45000, taxCents: 0, totalCents: 45000 });
  });

  it('derives the total from the lines and the rate, not from a typed number', () => {
    const amounts = invoiceAmounts({
      lines: [line('Workshop', 100, 120000), line('System', 100, 150000)],
      taxBasisPoints: 2000,
      // A total that disagrees with the lines is exactly the bug this prevents.
      amountCents: 1,
    });
    expect(amounts).toEqual({ subtotalCents: 270000, taxCents: 54000, totalCents: 324000 });
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

describe('the Brand Hub is optional, and a client’s own', () => {
  const hub = (clientId: string, status: 'draft' | 'active' | 'suspended' | 'archived'): BrandHub => ({
    clientId, status, tools: ['pattern-studio'], createdAt: NOW, updatedAt: NOW,
  });
  const design = (clientId: string, id = 'd1'): BrandProject => ({
    id, clientId, toolId: 'pattern-studio', name: 'Wrap', configuration: { scale: 100 },
    createdBy: 'p2', createdAt: NOW, updatedAt: NOW,
  });

  it('does not exist for a client nobody set it up for', () => {
    const store = fixture();
    expect(store.getBrandHub('acme')).toBeUndefined();
    expect(new ScopedStore(store, acmeViewer).getBrandHub('acme')).toBeUndefined();
    expect(new ScopedStore(store, acmeViewer).listBrandProjects('acme')).toEqual([]);
  });

  it('is invisible to the client until it is active, and visible to the studio throughout', () => {
    const store = fixture();
    for (const status of ['draft', 'suspended', 'archived'] as const) {
      store.saveBrandHub(hub('acme', status));
      expect(new ScopedStore(store, acmeViewer).getBrandHub('acme')).toBeUndefined();
      expect(new ScopedStore(store, studio).getBrandHub('acme')?.status).toBe(status);
    }
    store.saveBrandHub(hub('acme', 'active'));
    expect(new ScopedStore(store, acmeViewer).getBrandHub('acme')?.status).toBe('active');
  });

  it('only the studio switches a hub on', () => {
    const store = fixture();
    expect(() => new ScopedStore(store, acmeEditor).saveBrandHub(hub('acme', 'active'))).toThrow(Forbidden);
    expect(() => new ScopedStore(store, studio).saveBrandHub(hub('acme', 'active'))).not.toThrow();
  });

  it('a client editor saves designs inside an active hub, a viewer only looks', () => {
    const store = fixture();
    store.saveBrandHub(hub('acme', 'active'));
    expect(() => new ScopedStore(store, acmeEditor).saveBrandProject(design('acme'))).not.toThrow();
    expect(new ScopedStore(store, acmeViewer).listBrandProjects('acme')).toHaveLength(1);
    expect(() => new ScopedStore(store, acmeViewer).saveBrandProject(design('acme', 'd2'))).toThrow(Forbidden);
  });

  it('nothing can be made in a hub that is not active', () => {
    const store = fixture();
    store.saveBrandHub(hub('acme', 'suspended'));
    expect(() => new ScopedStore(store, acmeEditor).saveBrandProject(design('acme'))).toThrow(Forbidden);
  });

  it('one client’s designs never reach another client', () => {
    const store = fixture();
    store.saveBrandHub(hub('acme', 'active'));
    store.saveBrandHub(hub('morrow', 'active'));
    new ScopedStore(store, acmeEditor).saveBrandProject(design('acme'));
    const morrow = new ScopedStore(store, morrowEditor);
    expect(morrow.listBrandProjects('acme')).toEqual([]);
    expect(morrow.getBrandProject('d1')).toBeUndefined();
    expect(() => morrow.saveBrandProject({ ...design('acme'), name: 'Taken' })).toThrow(Forbidden);
    expect(() => morrow.deleteBrandProject('d1')).toThrow(Forbidden);
    expect(store.getBrandProject('d1')).toBeDefined();
  });

  it('keeps the configuration, not a picture, so a design reopens as it was left', () => {
    const store = fixture();
    store.saveBrandHub(hub('acme', 'active'));
    const scoped = new ScopedStore(store, acmeEditor);
    scoped.saveBrandProject({ ...design('acme'), configuration: { scale: 72, rotation: 15, tint: '#eb5e28' } });
    expect(scoped.getBrandProject('d1')?.configuration).toEqual({ scale: 72, rotation: 15, tint: '#eb5e28' });
    scoped.saveBrandProject({ ...design('acme'), configuration: { scale: 80 }, updatedAt: '2026-09-23T00:00:00.000Z' });
    expect(store.listBrandProjects('acme')).toHaveLength(1);
    expect(store.getBrandProject('d1')?.configuration).toEqual({ scale: 80 });
  });
});
