import { measurement, type Finding, type Measurement } from '@edsai/instruments';
import type { AxeRecord } from './records.js';

/**
 * axe results, mapped into the corpus's severity vocabulary.
 *
 * Three decisions carry this file.
 *
 * **Count elements, not rules.** axe reports one violation per rule with a list
 * of nodes. "3 violations" on a page where one of them is 47 unlabelled inputs
 * is a number that understates the work by an order of magnitude. The headline
 * figure here is affected elements; the rule count is reported beside it.
 *
 * **A zero with no passes behind it is a failed run, not a clean page.** If axe
 * never executed — wrong selector, page not ready, script error — it returns
 * nothing, which looks identical to perfection. So a record with no violations
 * and no recorded passes is refused rather than celebrated.
 *
 * **`incomplete` is not `passed`.** axe flags what it could not decide. Those
 * are exactly the checks needing a human, so they surface rather than vanish.
 */

export const IMPACT_SEVERITY = {
  critical: 'blocker',
  serious: 'major',
  moderate: 'minor',
  minor: 'nitpick',
} as const;

export interface AxeResult {
  url: string;
  /** True when the run produced evidence of having actually executed. */
  trustworthy: boolean;
  ruleCount: number;
  elementCount: number;
  passes?: number;
  incomplete: number;
  byImpact: { impact: string; rules: number; elements: number }[];
  /** Violations ordered worst-impact first, then by how many elements they hit. */
  ranked: { id: string; impact: string; help: string; nodes: number }[];
}

const ORDER = ['critical', 'serious', 'moderate', 'minor'] as const;

export function axeAudit(record: AxeRecord): Measurement<AxeResult> {
  const findings: Finding[] = [];
  const violations = record.violations;

  const elementCount = violations.reduce((sum, v) => sum + v.nodes, 0);
  const trustworthy = violations.length > 0 || (record.passes ?? 0) > 0;

  if (!trustworthy) {
    findings.push({
      severity: 'major',
      message:
        'The axe run recorded no violations and no passes, which means it did not run. An ' +
        'empty result is indistinguishable from a clean page, so it is not being read as one.',
      remediation:
        'Re-run axe with the page fully loaded and confirm the pass count is non-zero before ' +
        'reporting an accessibility result.',
    });
  }

  const byImpact = ORDER.map((impact) => {
    const matching = violations.filter((v) => (v.impact ?? 'moderate') === impact);
    return {
      impact,
      rules: matching.length,
      elements: matching.reduce((sum, v) => sum + v.nodes, 0),
    };
  }).filter((row) => row.rules > 0);

  const ranked = [...violations]
    .map((v) => ({ id: v.id, impact: v.impact ?? 'moderate', help: v.help, nodes: v.nodes }))
    .sort((a, b) => {
      const byImpactRank = ORDER.indexOf(a.impact as typeof ORDER[number])
        - ORDER.indexOf(b.impact as typeof ORDER[number]);
      return byImpactRank !== 0 ? byImpactRank : b.nodes - a.nodes;
    });

  for (const violation of ranked) {
    const impact = violation.impact as keyof typeof IMPACT_SEVERITY;
    findings.push({
      severity: IMPACT_SEVERITY[impact] ?? 'minor',
      message:
        `${violation.help} (${violation.id}) — ${violation.nodes} element` +
        `${violation.nodes === 1 ? '' : 's'}, ${violation.impact} impact.`,
      remediation:
        `Fix the ${violation.nodes} affected element${violation.nodes === 1 ? '' : 's'}, not ` +
        'the one in the example. axe reports a rule once however many times it is broken.',
    });
  }

  if (record.incomplete > 0) {
    findings.push({
      severity: 'info',
      message:
        `${record.incomplete} check${record.incomplete === 1 ? '' : 's'} axe could not decide ` +
        'automatically.',
      remediation:
        'These need a human. They are not passes — automated testing reaches roughly a third ' +
        'of WCAG, and this is the boundary of that third.',
    });
  }

  if (trustworthy && violations.length === 0) {
    findings.push({
      severity: 'info',
      message:
        `axe found no violations across ${record.passes ?? 0} passing checks.`,
      remediation:
        'That clears the automated third of WCAG. Keyboard order, focus visibility, and screen ' +
        'reader flow are still unverified.',
    });
  }

  return measurement('axe_audit', {
    url: record.url,
    trustworthy,
    ruleCount: violations.length,
    elementCount,
    ...(record.passes !== undefined ? { passes: record.passes } : {}),
    incomplete: record.incomplete,
    byImpact,
    ranked,
  }, findings);
}
