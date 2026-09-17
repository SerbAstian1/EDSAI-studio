import { AxeRecord } from './records.js';

/**
 * Importers for results produced outside this process.
 *
 * axe has to run inside a browser with the page open, so there is no probe for
 * it — only an importer for what the browser produced. Keeping that honest
 * matters: an "axe probe" that quietly returned nothing would be indistinguishable
 * from a clean page, which is the failure `axe.ts` refuses.
 */

interface RawAxeResults {
  url?: string;
  timestamp?: string;
  violations?: {
    id?: string;
    impact?: string | null;
    help?: string;
    nodes?: unknown[];
  }[];
  passes?: unknown[];
  incomplete?: unknown[];
}

const IMPACTS = new Set(['critical', 'serious', 'moderate', 'minor']);

/** Normalise axe-core's own results object into an `AxeRecord`. */
export function axeFromResults(raw: RawAxeResults, url?: string): AxeRecord {
  const target = url ?? raw.url;
  if (!target) {
    throw new Error('axe results carry no url, and a result without a page is not attributable.');
  }

  return AxeRecord.parse({
    url: target,
    testedAt: raw.timestamp ?? new Date().toISOString(),
    violations: (raw.violations ?? []).map((violation) => ({
      id: violation.id ?? 'unknown',
      ...(violation.impact && IMPACTS.has(violation.impact) ? { impact: violation.impact } : {}),
      help: violation.help ?? violation.id ?? 'Unnamed rule',
      // axe reports a rule once with every affected node listed; the node count
      // is the size of the work, and dropping it understates it badly.
      nodes: Array.isArray(violation.nodes) ? violation.nodes.length : 1,
    })),
    // Absent rather than zero when axe did not report passes: `axe.ts` treats a
    // zero with no passes as a run that did not happen, and that distinction is
    // lost if this defaults.
    ...(Array.isArray(raw.passes) ? { passes: raw.passes.length } : {}),
    incomplete: Array.isArray(raw.incomplete) ? raw.incomplete.length : 0,
  });
}
