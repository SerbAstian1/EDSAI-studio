import { gzipSync } from 'node:zlib';
import { bundleAudit, type BundleRecord } from '@edsai/measure';
import type { Finding } from '@edsai/instruments';
import { buildModel, type HubBundle, type HubModel } from './model.js';
import { renderHub } from './render.js';

/**
 * Generate the hub and check it against its own budget.
 *
 * Phase 7's fourth acceptance criterion is that the hub meets budgets tighter
 * than the Studio's, "because the hub is content". 40 KB gzipped is the number
 * this generator holds itself to — a quarter of the Studio's 170 KB, on a page
 * with no framework and one behaviour.
 *
 * The budget is judged by `bundleAudit`, the same function that gates the
 * Studio's build and produces Department 43's target row. Three surfaces, one
 * rule, one implementation.
 */

export const HUB_BUDGET_BYTES = 40 * 1024;

export interface HubSite {
  /** Published path to contents. `index.html` is self-contained. */
  files: Record<string, string>;
  model: HubModel;
  bytes: number;
  gzipBytes: number;
  withinBudget: boolean;
  findings: readonly Finding[];
}

export function generateHub(
  bundle: HubBundle,
  options: { now?: Date; budgetBytes?: number } = {},
): HubSite {
  const model = buildModel(bundle, options.now ?? new Date());
  const html = renderHub(model);

  const bytes = Buffer.byteLength(html, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(html, 'utf8'), { level: 9 }).byteLength;
  const budget = options.budgetBytes ?? HUB_BUDGET_BYTES;

  const record: BundleRecord = {
    chunks: [{
      name: 'index.html', bytes, gzipBytes, initial: true, renderBlocking: true,
    }],
    source: 'hub generator',
  };
  const audit = bundleAudit(record, budget);

  return {
    files: { 'index.html': html },
    model,
    bytes,
    gzipBytes,
    withinBudget: audit.value.withinBudget,
    // The single-file hub is render-blocking by construction, which is correct
    // for one inlined stylesheet and is not a finding worth carrying.
    findings: audit.findings.filter((f) => !f.message.includes('render-blocking')),
  };
}
