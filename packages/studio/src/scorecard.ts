import type { DepartmentOutput, Issue, Severity, Target } from './api.js';

/**
 * The arithmetic behind the scorecard board.
 *
 * Kept out of the components so it can be tested without a DOM, and because the
 * board's whole job is to make a wall of 8s visible before Arbitration rather
 * than after. A histogram that quietly mis-buckets would defeat the one screen
 * built to catch that.
 *
 * Nothing here decides anything the server already decided: the gate and the
 * drift verdict arrive computed. This is presentation arithmetic only.
 */

export interface Histogram {
  buckets: { value: number; count: number; share: number }[];
  total: number;
  mean: number;
  min: number;
  max: number;
  /** The widest two-point band, which is what clustering actually looks like. */
  widestBand: { low: number; high: number; share: number };
}

export function histogram(outputs: readonly DepartmentOutput[]): Histogram | undefined {
  const values = outputs.flatMap((o) => o.scores.map((s) => s.value));
  if (values.length === 0) return undefined;

  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const buckets = Array.from({ length: 10 }, (_, i) => i + 1).map((value) => {
    const count = counts.get(value) ?? 0;
    return { value, count, share: count / values.length };
  });

  let widestBand = { low: 1, high: 2, share: 0 };
  for (let low = 1; low <= 9; low++) {
    const share = values.filter((v) => v >= low && v <= low + 1).length / values.length;
    if (share > widestBand.share) widestBand = { low, high: low + 1, share };
  }

  return {
    buckets,
    total: values.length,
    mean: values.reduce((n, v) => n + v, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    widestBand,
  };
}

/**
 * The lowest score in the run, which `00-scorecard.md §6` requires named
 * explicitly. An inverse dimension is excluded: a low value there means the
 * opposite of a weakness, and reporting it as the weak point would be wrong.
 */
export function weakestScore(outputs: readonly DepartmentOutput[]): {
  departmentId: number;
  dimension: string;
  value: number;
  justification: string;
} | undefined {
  const candidates = outputs.flatMap((o) =>
    o.scores.filter((s) => !s.inverse).map((s) => ({ ...s, departmentId: o.departmentId })),
  );
  if (candidates.length === 0) return undefined;

  return candidates.reduce((worst, s) => (s.value < worst.value ? s : worst));
}

export interface TargetSummary {
  total: number;
  measured: number;
  stated: number;
  /** Share measured by an instrument rather than asserted. */
  provenance: number;
}

export function targetSummary(outputs: readonly DepartmentOutput[]): TargetSummary {
  const targets: Target[] = outputs.flatMap((o) => o.targets);
  const measured = targets.filter((t) => t.source === 'instrument').length;
  return {
    total: targets.length,
    measured,
    stated: targets.length - measured,
    provenance: targets.length === 0 ? 0 : measured / targets.length,
  };
}

const SEVERITY_ORDER: readonly Severity[] = ['Blocker', 'Major', 'Minor', 'Nitpick'];

/** Issues worst-first, open before closed, so the list reads as a queue. */
export function orderIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
    return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  });
}

export function issueCounts(issues: readonly Issue[]): Record<Severity, { open: number; total: number }> {
  const counts = Object.fromEntries(
    SEVERITY_ORDER.map((s) => [s, { open: 0, total: 0 }]),
  ) as Record<Severity, { open: number; total: number }>;

  for (const issue of issues) {
    const row = counts[issue.severity];
    row.total++;
    if (issue.status === 'open') row.open++;
  }
  return counts;
}

/**
 * How far through the run, by department rather than by time.
 *
 * Elapsed time is a poor proxy here: departments vary from forty to ninety
 * seconds, and a resumed run has no useful clock at all.
 */
export function progress(activated: readonly number[], completed: readonly number[]): {
  done: number;
  total: number;
  share: number;
  remaining: number[];
} {
  const doneSet = new Set(completed);
  const remaining = activated.filter((id) => !doneSet.has(id));
  return {
    done: activated.length - remaining.length,
    total: activated.length,
    share: activated.length === 0 ? 0 : (activated.length - remaining.length) / activated.length,
    remaining,
  };
}
