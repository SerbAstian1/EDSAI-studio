import { BLOCKS_FINAL, type Conflict, type Issue, type RunVersion } from './types.js';

/**
 * The FINAL gate.
 *
 * `07-qa-critic-arbitration.md` is unambiguous: "A FINAL output with any open
 * Blocker or Major issue is not actually final — it's V-next-minus-one wearing
 * a FINAL label." So the determination is computed, not accepted. Arbitration
 * may propose FINAL; if the conditions do not hold, the gate overrides it and
 * says why.
 *
 * This is deliberately the least clever code in the package. A gate that can be
 * argued with is not a gate.
 */

export interface GateInput {
  proposed: RunVersion;
  issues: readonly Issue[];
  conflicts: readonly Conflict[];
}

export interface GateResult {
  determination: RunVersion;
  passed: boolean;
  /** Why FINAL was refused, in the order a reader should act on them. */
  blockers: string[];
  openBlocking: { severity: string; count: number }[];
  unresolvedConflicts: number;
}

export function evaluateGate(input: GateInput): GateResult {
  const open = input.issues.filter((i) => i.status === 'open');
  const openBlocking = BLOCKS_FINAL.map((severity) => ({
    severity,
    count: open.filter((i) => i.severity === severity).length,
  })).filter((row) => row.count > 0);

  const unresolved = input.conflicts.filter(
    (c) => !c.resolution?.trim() || !c.whatWasLost?.trim(),
  );

  const blockers: string[] = [];
  for (const { severity, count } of openBlocking) {
    blockers.push(
      `${count} open ${severity}${count === 1 ? '' : 's'} — ` +
      `${severity === 'Blocker' ? 'breaks core function or message' : 'undermines brand, UX or conversion'}.`,
    );
  }
  if (unresolved.length > 0) {
    const missingLoss = unresolved.filter((c) => c.resolution?.trim() && !c.whatWasLost?.trim());
    blockers.push(
      `${unresolved.length} conflict${unresolved.length === 1 ? '' : 's'} without a complete resolution` +
      (missingLoss.length > 0
        ? ` (${missingLoss.length} resolved but not stating what was lost — the corpus forbids averaging a conflict away).`
        : '.'),
    );
  }

  const passed = blockers.length === 0;

  return {
    // A proposal of FINAL that cannot hold falls back to V1; any other proposal
    // stands, because the gate only ever withholds FINAL, never grants it.
    determination: input.proposed === 'FINAL' && !passed ? 'V1' : input.proposed,
    passed,
    blockers,
    openBlocking,
    unresolvedConflicts: unresolved.length,
  };
}

/** A one-line summary for a CLI or a run record. */
export function gateSummary(result: GateResult): string {
  if (result.passed) return `FINAL is reachable: no open Blockers or Majors, all conflicts resolved.`;
  return `FINAL withheld — ${result.blockers.join(' ')}`;
}
