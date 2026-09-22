import { z } from 'zod';

/**
 * The documents every engagement has.
 *
 * A deliverable is one named thing among many; these are the eight a
 * client always gets, in the same places, on the same shelf: the proposal,
 * the contract and the invoice on the commercial side; the strategy, the two
 * speed-run presentations, the final presentation and the guidelines on the
 * brand side. Fixed slots rather than a list, because a client should find
 * "the contract" where it always is, not search a list for it.
 *
 * Each slot holds a Figma file and is previewed in place — here and in the
 * client's portal — instead of sending anyone off to Figma to look.
 */

export const DOCUMENT_SLOTS = [
  { id: 'proposal', label: 'Proposal', group: 'commercial' },
  { id: 'contract', label: 'Contract', group: 'commercial' },
  { id: 'invoice', label: 'Invoice', group: 'commercial' },
  { id: 'brand-strategy', label: 'Brand strategy', group: 'brand' },
  { id: 'speed-run-1', label: 'Speed run presentation 1', group: 'brand' },
  { id: 'speed-run-2', label: 'Speed run presentation 2', group: 'brand' },
  { id: 'final-presentation', label: 'Final brand presentation', group: 'brand' },
  { id: 'brand-guidelines', label: 'Figma brand guidelines', group: 'brand' },
] as const;

export type DocumentSlot = typeof DOCUMENT_SLOTS[number]['id'];
export const DocumentSlotId = z.enum(
  DOCUMENT_SLOTS.map((s) => s.id) as [DocumentSlot, ...DocumentSlot[]],
);

export function isDocumentSlot(value: string): value is DocumentSlot {
  return DOCUMENT_SLOTS.some((s) => s.id === value);
}

export const ClientDocument = z.object({
  clientId: z.string().min(1),
  slot: DocumentSlotId,
  /** Checked to be figma.com before it is stored, and again before it is framed. */
  figmaUrl: z.string().min(1),
  /** A note the studio leaves beside it: "v2, after the March review". */
  note: z.string().optional(),
  updatedAt: z.string(),
});
export type ClientDocument = z.infer<typeof ClientDocument>;
