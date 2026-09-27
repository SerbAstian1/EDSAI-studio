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
 *
 * ## The total is computed, not typed
 *
 * An invoice used to be one description and one number, which meant the
 * arithmetic behind it lived in somebody's head or in a spreadsheet nobody
 * else could read. Line items and a tax rate put it in the record:
 *
 * - `lines` are what was billed. A line's own amount is derived from its
 *   quantity and unit price rather than typed, so a line cannot disagree with
 *   itself — 3 × £240 is either £720 or the invoice is wrong, and only one of
 *   those is a fact.
 * - `quantityHundredths` is an integer rather than a float because 7.5 hours
 *   at £120 is £900, and `7.5 * 12000` in binary floating point is not. Studio
 *   members type "7.5"; the wire format is 750.
 * - `taxBasisPoints` is the *proposed* rate, 2000 for 20%. It is stored as a
 *   rate rather than a computed tax amount on purpose: a rate is what the
 *   studio decided, and a rate can be checked against what the client was
 *   quoted. The amount is derived, so a changed rate and a stale amount cannot
 *   both exist.
 * - `amountCents` remains the authoritative total, and the server recomputes it
 *   from the lines on every write. It is kept because this is what the portal
 *   shows and what `invoiceTotals` sums, and because an invoice with no lines
 *   yet — the common case for years of existing records — still has to total
 *     the number it was created with.
 */

/** One billed line. The amount is derived; see `lineAmountCents`. */
export const InvoiceLine = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** Times billed, in hundredths: 750 is seven and a half. */
  quantityHundredths: z.number().int().positive(),
  /** Price for one, in integer minor units. */
  unitAmountCents: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

/**
 * What one line comes to, in minor units.
 *
 * Rounds half up on the hundredth of a cent, so three lines of £33.335 do not
 * quietly lose a penny against a bank statement. The multiplication is done in
 * integers throughout: `quantityHundredths * unitAmountCents` is a plain
 * integer product, and only the final division is a fraction.
 */
export function lineAmountCents(line: Pick<InvoiceLine, 'quantityHundredths' | 'unitAmountCents'>): number {
  return Math.round((line.quantityHundredths * line.unitAmountCents) / 100);
}

/** The lines, summed, before tax. */
export function invoiceSubtotalCents(
  lines: readonly Pick<InvoiceLine, 'quantityHundredths' | 'unitAmountCents'>[],
): number {
  return lines.reduce((sum, line) => sum + lineAmountCents(line), 0);
}

/**
 * Tax on a subtotal, in minor units.
 *
 * "Proposed" is the word in the domain language and the reason this is a plain
 * function: nothing here decides what tax applies to whom. The studio proposes
 * a rate, this turns it into an amount, and whether that proposal is correct is
 * a question for an accountant and a jurisdiction, not for a database.
 */
export function invoiceTaxCents(subtotalCents: number, taxBasisPoints: number): number {
  return Math.round((subtotalCents * taxBasisPoints) / 10_000);
}

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
  /** What was billed, line by line. Empty on an invoice recorded as one number. */
  lines: z.array(InvoiceLine).default([]),
  /** The proposed tax rate: 2000 is 20%. Zero means none proposed. */
  taxBasisPoints: z.number().int().min(0).max(10_000).default(0),
  /** Payment terms in the studio's own words. Never parsed, never enforced. */
  terms: z.string().optional(),
  paid: z.boolean().default(false),
  paidAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Invoice = z.infer<typeof Invoice>;

/**
 * What the lines come to, and what that makes the total.
 *
 * An invoice with no lines falls back to `amountCents`, which is the whole
 * point of keeping it: records made before there were line items have to keep
 * totalling what they always did, and a builder mid-edit has lines whose sum
 * has not been saved yet.
 */
export function invoiceAmounts(invoice: Pick<Invoice, 'lines' | 'taxBasisPoints' | 'amountCents'>): {
  subtotalCents: number; taxCents: number; totalCents: number;
} {
  const subtotalCents = invoice.lines.length > 0
    ? invoiceSubtotalCents(invoice.lines)
    : invoice.amountCents;
  const taxCents = invoiceTaxCents(subtotalCents, invoice.taxBasisPoints);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

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
