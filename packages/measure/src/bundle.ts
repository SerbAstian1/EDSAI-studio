import { measurement, round, type Finding, type Measurement } from '@edsai/instruments';
import type { BundleRecord } from './records.js';

/**
 * Bundle weight, against the budget Department 8 sets.
 *
 * The figure that matters is **initial-route JS, gzipped** — what a first paint
 * costs. Reporting the whole `dist` counts screens the visitor has not opened,
 * which makes the number look worse than the experience and pushes toward the
 * wrong optimisations: you end up shrinking a lazy chunk nobody waits on.
 *
 * Render-blocking resources are counted separately, because they are the part
 * of the bill the user pays before anything appears, regardless of total size.
 */

export const DEFAULT_BUDGET_BYTES = 170 * 1024;

/**
 * Estimate gzip when a bundler reports only raw bytes.
 *
 * Marked as an estimate everywhere it surfaces. Real gzip on minified JS lands
 * near 0.32; using that is honest about the error bar, where quietly treating
 * raw bytes as gzipped would overstate the problem by a factor of three.
 */
const GZIP_RATIO = 0.32;

export interface ChunkVerdict {
  name: string;
  bytes: number;
  gzipBytes: number;
  estimated: boolean;
  initial: boolean;
  renderBlocking: boolean;
  /** Share of the initial-route total, as a percentage. */
  share?: number;
}

export interface BundleResult {
  budgetBytes: number;
  initialGzipBytes: number;
  /** True when any initial chunk's gzip figure was estimated rather than measured. */
  estimated: boolean;
  withinBudget: boolean;
  headroomBytes: number;
  deferredGzipBytes: number;
  chunkCount: number;
  renderBlockingCount: number;
  largest?: ChunkVerdict;
  /** The initial chunks, largest first. */
  initial: ChunkVerdict[];
}

const kb = (bytes: number): string => `${round(bytes / 1024, 1)} KB`;

export function bundleAudit(
  record: BundleRecord,
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): Measurement<BundleResult> {
  const findings: Finding[] = [];

  const verdicts: ChunkVerdict[] = record.chunks.map((chunk) => ({
    name: chunk.name,
    bytes: chunk.bytes,
    gzipBytes: chunk.gzipBytes ?? Math.round(chunk.bytes * GZIP_RATIO),
    estimated: chunk.gzipBytes === undefined,
    initial: chunk.initial,
    renderBlocking: chunk.renderBlocking,
  }));

  const initial = verdicts.filter((c) => c.initial).sort((a, b) => b.gzipBytes - a.gzipBytes);
  const deferred = verdicts.filter((c) => !c.initial);

  const initialGzipBytes = initial.reduce((sum, c) => sum + c.gzipBytes, 0);
  for (const chunk of initial) {
    chunk.share = initialGzipBytes > 0 ? round((chunk.gzipBytes / initialGzipBytes) * 100, 1) : 0;
  }

  const estimated = initial.some((c) => c.estimated);
  const withinBudget = initialGzipBytes <= budgetBytes;
  const headroomBytes = budgetBytes - initialGzipBytes;
  const renderBlocking = verdicts.filter((c) => c.renderBlocking);

  if (!withinBudget) {
    const over = initialGzipBytes - budgetBytes;
    const top = initial.slice(0, 3);
    findings.push({
      severity: 'major',
      message:
        `Initial route is ${kb(initialGzipBytes)} gz against a ${kb(budgetBytes)} budget — ` +
        `${kb(over)} over${estimated ? ', from estimated gzip figures' : ''}.`,
      remediation: top.length > 0
        ? `The initial route's weight is ${top.map((c) => `${c.name} (${kb(c.gzipBytes)}, ${c.share ?? 0}%)`).join(', ')}. ` +
          'Split what is not needed for first paint behind a route boundary before optimising ' +
          'anything that is.'
        : 'Split what is not needed for first paint behind a route boundary.',
    });
  }

  if (estimated) {
    findings.push({
      severity: 'info',
      message:
        'Some chunks reported raw bytes only, so their gzip figures are estimated at ' +
        `${GZIP_RATIO} of raw.`,
      remediation:
        'Have the bundler emit compressed sizes — a real measurement here is cheap, and the ' +
        'estimate carries an error bar the budget verdict inherits.',
    });
  }

  if (renderBlocking.length > 0) {
    findings.push({
      severity: renderBlocking.length > 2 ? 'major' : 'minor',
      message:
        `${renderBlocking.length} render-blocking resource${renderBlocking.length === 1 ? '' : 's'}: ` +
        renderBlocking.map((c) => c.name).join(', ') + '.',
      remediation:
        'Each one is paid before anything appears, whatever the total weight. Defer, inline ' +
        'what is critical, or move it below the fold.',
    });
  }

  if (deferred.length === 0 && verdicts.length > 1) {
    findings.push({
      severity: 'minor',
      message: 'Every chunk is on the initial route — nothing is split.',
      remediation:
        'Route-level splitting is the cheapest win available: a screen the visitor has not ' +
        'opened should not be in the first response.',
    });
  }

  const largest = [...verdicts].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];

  return measurement('bundle_audit', {
    budgetBytes,
    initialGzipBytes,
    estimated,
    withinBudget,
    headroomBytes,
    deferredGzipBytes: deferred.reduce((sum, c) => sum + c.gzipBytes, 0),
    chunkCount: verdicts.length,
    renderBlockingCount: renderBlocking.length,
    ...(largest ? { largest } : {}),
    initial,
  }, findings);
}
