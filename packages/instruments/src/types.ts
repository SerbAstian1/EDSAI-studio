import { z } from 'zod';

/**
 * Shared shapes for every instrument.
 *
 * An instrument is a pure function. It never calls a model, never reaches the
 * network, and never decides what a number means for the brand — it computes,
 * and states plainly whether the computed value meets the target it was given.
 * Interpretation is the department's job; measurement is this package's.
 */

/** The corpus's severity vocabulary (`00-scorecard.md §5`), plus a non-issue note. */
export const Severity = z.enum(['blocker', 'major', 'minor', 'nitpick', 'info']);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  severity: Severity,
  message: z.string().min(1),
  /** What to change. A finding with no remediation is a complaint, not a finding. */
  remediation: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

/**
 * Every instrument returns its own name alongside its value.
 *
 * This is what makes the engine's provenance check possible: a target may only
 * carry `source: 'instrument'` if an instrument in that turn produced it, and
 * the name is how the verifier matches the claim to the call.
 */
export interface Measurement<T> {
  readonly instrument: string;
  readonly value: T;
  readonly findings: readonly Finding[];
}

export function measurement<T>(
  instrument: string,
  value: T,
  findings: readonly Finding[] = [],
): Measurement<T> {
  return { instrument, value, findings };
}

/** Highest severity present, or undefined when an instrument found nothing wrong. */
export function worstSeverity(findings: readonly Finding[]): Severity | undefined {
  const order: Severity[] = ['blocker', 'major', 'minor', 'nitpick', 'info'];
  for (const severity of order) {
    if (findings.some((f) => f.severity === severity)) return severity;
  }
  return undefined;
}

/** Round half away from zero at `places`, avoiding the usual float surprises. */
export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON) / factor;
}
