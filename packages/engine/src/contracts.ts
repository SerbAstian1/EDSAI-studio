import { z } from 'zod';

/**
 * A contract: the one document in this system that binds anyone to anything.
 *
 * Everything else here records a fact — what a client said, what a run scored,
 * what a milestone is called. A contract is the exception, and that difference
 * is the whole reason it is a separate entity rather than a document slot with
 * a different label:
 *
 * - It is **signed**. A signature is a person agreeing to terms, so a contract
 *   carries when it was sent, when it came back, and by what name. Those three
 *   facts are the record; the prose is not.
 * - It is **versioned in place**. A revised contract supersedes its own earlier
 *   text rather than sitting beside it, because two live contracts with the
 *   same number is how a client ends up signing the wrong one. The revisions
 *   are kept, with what changed, so "which version did they sign" is answerable.
 * - It is **never generated**. There is no model behind this type and there will
 *   not be one: a clause invented by a machine and sent to a client as terms is
 *   the failure this system exists to avoid. The body is written by a person,
 *   in Markdown, and the server only ever renders and stores it.
 *
 * Money on a contract is a *fee*, and it is the same integer minor units an
 * invoice uses. A deposit, a retainer and a kill fee are all expressible as
 * lines here; this type deliberately stops at the ones a studio can honour
 * without a payment processor, which is the same boundary the invoice draws.
 */

export const ContractStatus = z.enum(['draft', 'sent', 'signed', 'declined', 'void']);
export type ContractStatus = z.infer<typeof ContractStatus>;

/** What was agreed to change hands. Optional on a draft — that is the point. */
export const ContractFee = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** Integer minor units. The amount is stated, not derived from a rate. */
  amountCents: z.number().int().nonnegative(),
  /** When it falls due, as a wall-clock `YYYY-MM-DD`. */
  dueDate: z.string().optional(),
  /** What it is for: a deposit is a fraction of a total, a kill fee is a whole one. */
  kind: z.enum(['retainer', 'deposit', 'milestone', 'final', 'other']).default('other'),
});
export type ContractFee = z.infer<typeof ContractFee>;

/** One recorded change to the terms. Kept so a signed version stays answerable. */
export const ContractRevision = z.object({
  /** When the change was made. */
  at: z.string(),
  /** Who made it, in their own words. Never an account id. */
  by: z.string().min(1),
  /** What changed, in one line. A diff is a lie about intent; this is a claim. */
  note: z.string().min(1),
  /** The text as it stood after this change. */
  markdown: z.string(),
});
export type ContractRevision = z.infer<typeof ContractRevision>;

export const Contract = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  /** Studio-facing, e.g. "CON-0002". */
  number: z.string().min(1),
  title: z.string().min(1),
  status: ContractStatus.default('draft'),
  /**
   * The terms, in Markdown, written by a person. Empty only on a draft that has
   * not been written yet — a contract that has been sent must say something.
   */
  markdown: z.string(),
  /**
   * The currency the fees are in, as an ISO 4217 code. Carried on the contract
   * rather than assumed, because "£4,800" and "$4,800" are different promises
   * and a fee schedule printed in the wrong one is a dispute with a printer's
   * mark on it. Same default and same reason as an invoice's.
   */
  currency: z.string().min(1).default('USD'),
  fees: z.array(ContractFee).default([]),
  /** When it went out, and when it came back signed. Absent until they happen. */
  sentAt: z.string().optional(),
  signedAt: z.string().optional(),
  /** The name that was typed on the signature line. */
  signedBy: z.string().optional(),
  /** Every version, oldest first. The last entry is what the record means now. */
  revisions: z.array(ContractRevision).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contract = z.infer<typeof Contract>;

/**
 * Whether this contract may be sent, and why not if it may not.
 *
 * A refusal here is a sentence a studio member can read out to whoever is about
 * to press the button, not a boolean. "No terms yet" and "who signed this" are
 * different problems with different fixes, and a studio that only sees
 * `false` will send the wrong one.
 */
export function contractReadyToSend(contract: Contract): { ready: boolean; reason?: string } {
  if (contract.markdown.trim().length === 0) {
    return { ready: false, reason: 'The terms are empty. A contract that says nothing cannot be sent.' };
  }
  if (contract.status === 'signed') {
    return { ready: false, reason: 'This one is already signed. Revise it instead of sending it again.' };
  }
  if (contract.status === 'void') {
    return { ready: false, reason: 'This one was voided. Start a new contract rather than reviving it.' };
  }
  return { ready: true };
}

/**
 * What a contract commits the studio to, summed.
 *
 * Deliberately not a "total contract value" in one place: a deposit is part of
 * a total and a kill fee is a penalty against it, and adding them together is
 * the arithmetic that turns a contract into a misleading headline figure. The
 * studio sees the lines; the client sees the lines.
 */
export function contractFees(contract: Pick<Contract, 'fees'>): {
  totalCents: number; byKind: Record<string, number>;
} {
  const byKind: Record<string, number> = {};
  let totalCents = 0;
  for (const fee of contract.fees) {
    totalCents += fee.amountCents;
    byKind[fee.kind] = (byKind[fee.kind] ?? 0) + fee.amountCents;
  }
  return { totalCents, byKind };
}
