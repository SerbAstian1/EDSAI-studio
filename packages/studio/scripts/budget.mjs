#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleFromViteDist, bundleAudit } from '@edsai/measure';

/**
 * Measure the initial route against the budget.
 *
 * The budget is 170 KB gzipped, per the build plan's §11. "Initial route" means
 * what a first paint actually costs — the entry chunk plus everything it
 * statically imports — not the whole dist, which includes the lazy screens a
 * visitor has not opened.
 *
 * The measurement itself lives in `@edsai/measure`, which is also what produces
 * Department 43's target row for a run. One rule in one place: a build that
 * passes this gate and a run that reports the number cannot disagree, because
 * they are the same function over the same manifest.
 */
const BUDGET_BYTES = 170 * 1024;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const record = bundleFromViteDist(dist);
const { value } = bundleAudit(record, BUDGET_BYTES);
const kb = (n) => (n / 1024).toFixed(1);

for (const chunk of [...record.chunks].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
  process.stdout.write(
    `${chunk.initial ? 'initial' : 'lazy   '} ${kb(chunk.gzipBytes).padStart(7)} KB gz  ` +
    `${chunk.name}${chunk.renderBlocking ? '  (render-blocking)' : ''}\n`,
  );
}

process.stdout.write(
  `\ninitial route  ${kb(value.initialGzipBytes)} KB gz against a ${kb(BUDGET_BYTES)} KB budget\n` +
  `deferred       ${kb(value.deferredGzipBytes)} KB gz across ` +
  `${value.chunkCount - value.initial.length} chunks\n`,
);

if (!value.withinBudget) {
  process.stderr.write(`\nOVER BUDGET by ${kb(-value.headroomBytes)} KB\n`);
  process.exit(1);
}
process.stdout.write(`under budget by ${kb(value.headroomBytes)} KB\n`);
