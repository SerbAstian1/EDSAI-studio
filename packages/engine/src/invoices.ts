import { z } from 'zod';

/**
 * An invoice, tracked rather than processed.
 *
 * This studio does not move money — there is no payment gateway here and
 * this is not the place to fake one. What it does is keep the one record a
 * client and a studio both need to agree on: what was billed, when, and
 * whether it was paid. Reconciling that against a real payment processor is
 * a studio's own bookkeeping, done elsewhere; a `paid` flag set by the
 * studio is the honest boundary of what this system asserts.
 *
 * `status` is never stored as `'overdue'`. A due date that has passed is a
 * fact about *today*, not about the row — storing it would mean either a
 * background job to keep it current or a status silently going stale the
 * moment nobody looks. `invoiceStatus` computes it fresh, every time.
 */

export const Invoice = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  /** Studio-facing, e.g. "INV-0004". Not required to be unique across studios. */
  number: z.string().min(1),
  description: z.string().min(1),
  issueDate: z.string(),
  dueDate: z.string(),
  /** Integer minor units (cents), so money is never a floating-point value. */
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1).default('USD'),
  paid: z.boolean().default(false),
  paidAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Invoice = z.infer<typeof Invoice>;

export type InvoiceStatus = 'paid' | 'pending' | 'overdue';

export function invoiceStatus(invoice: Invoice, now: Date = new Date()): InvoiceStatus {
  if (invoice.paid) return 'paid';
  return invoice.dueDate < now.toISOString() ? 'overdue' : 'pending';
}

export interface InvoiceTotals {
  totalCents: number;
  paidCents: number;
  pendingCents: number;
  overdueCents: number;
  count: number;
  pendingCount: number;
  overdueCount: number;
}

export function invoiceTotals(invoices: readonly Invoice[], now: Date = new Date()): InvoiceTotals {
  const totals: InvoiceTotals = {
    totalCents: 0, paidCents: 0, pendingCents: 0, overdueCents: 0,
    count: invoices.length, pendingCount: 0, overdueCount: 0,
  };
  for (const invoice of invoices) {
    totals.totalCents += invoice.amountCents;
    const status = invoiceStatus(invoice, now);
    if (status === 'paid') totals.paidCents += invoice.amountCents;
    else if (status === 'pending') { totals.pendingCents += invoice.amountCents; totals.pendingCount += 1; }
    else { totals.overdueCents += invoice.amountCents; totals.overdueCount += 1; }
  }
  return totals;
}
