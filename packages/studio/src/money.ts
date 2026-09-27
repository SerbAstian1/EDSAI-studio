/**
 * Money, in the studio, without a float anywhere near it.
 *
 * This is a browser module, so it cannot import `@edsai/engine` — that package
 * carries the SQLite store and would drag `node:sqlite` into a bundle. So the
 * same integer rules the server writes are restated here, and the duplication is
 * deliberate and narrow: a person typing a price needs to see the total update
 * as they type, and a round trip to the server per keystroke to add up four
 * lines would be a worse trade than two functions that agree with each other.
 *
 * Where they must agree, they are checked on both sides: `lineTotalCents` and
 * `taxCents` below are the same half-up rounding as `lineAmountCents` and
 * `invoiceTaxCents` in `packages/engine/src/invoices.ts`. The engine is the
 * authority — it is what actually gets stored — and the studio's copy is a
 * preview of that, not a second source of truth.
 */

/** Typed money to the integer minor units the record stores. */
export function toCents(input: string): number | undefined {
  const trimmed = input.trim().replace(/^[$£€]/, '');
  if (trimmed === '') return undefined;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

/**
 * A typed quantity to integer hundredths: "7.5" is 750.
 *
 * The same rounding as money, and for the same reason — 7.5 hours at £120 is
 * £900, and `7.5 * 12000` in binary floating point is not. An invoice line is
 * stored in hundredths because a designer bills in fractions of an hour and
 * "7.53 hours" is a real thing to be charged.
 */
export function toHundredths(input: string): number | undefined {
  return toCents(input);
}

/** One line, in minor units. Rounds half up on the hundredth of a cent. */
export function lineTotalCents(quantityHundredths: number, unitAmountCents: number): number {
  return Math.round((quantityHundredths * unitAmountCents) / 100);
}

/** The lines, summed, before tax. */
export function subtotalCents(
  lines: readonly { quantityHundredths: number; unitAmountCents: number }[],
): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line.quantityHundredths, line.unitAmountCents), 0);
}

/** A typed percentage to integer basis points: "20" is 2000. */
export function toBasisPoints(input: string): number | undefined {
  const trimmed = input.trim().replace(/%$/, '');
  if (trimmed === '') return 0;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.round(value * 100);
}

/** Tax on a subtotal, in minor units. Half up, like every other amount here. */
export function taxCents(subtotal: number, taxBasisPoints: number): number {
  return Math.round((subtotal * taxBasisPoints) / 10_000);
}

export function formatCents(cents: number, currency = 'USD'): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
}

/** A basis-point rate back as the percentage a person reads: 2000 is "20%". */
export function formatBasisPoints(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
