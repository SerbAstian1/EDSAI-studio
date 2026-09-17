#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Measure the initial route against the budget.
 *
 * The budget is 170 KB gzipped, per the build plan's §11. "Initial route" means
 * what a first paint actually costs — the entry chunk plus everything it
 * statically imports — not the whole dist, which includes the lazy screens a
 * visitor has not opened. Measuring the dist total would make the number look
 * worse than the experience and would push toward the wrong optimisations.
 *
 * Gzip at level 9 rather than an estimate, so the figure is the one a CDN sends.
 */
const BUDGET_BYTES = 170 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'assets');

const LAZY = /RunView|Scorecard|Review|Finalize/;

const rows = readdirSync(dist)
  .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
  .map((name) => ({
    name,
    lazy: LAZY.test(name),
    raw: statSync(join(dist, name)).size,
    gz: gzipSync(readFileSync(join(dist, name)), { level: 9 }).length,
  }))
  .sort((a, b) => b.gz - a.gz);

const kb = (n) => (n / 1024).toFixed(1);
const initial = rows.filter((r) => !r.lazy);
const deferred = rows.filter((r) => r.lazy);
const total = initial.reduce((n, r) => n + r.gz, 0);

for (const row of rows) {
  process.stdout.write(
    `${row.lazy ? 'lazy   ' : 'initial'} ${kb(row.gz).padStart(7)} KB gz  ${row.name}\n`,
  );
}

process.stdout.write(
  `\ninitial route  ${kb(total)} KB gz against a ${kb(BUDGET_BYTES)} KB budget\n` +
  `deferred       ${kb(deferred.reduce((n, r) => n + r.gz, 0))} KB gz across ${deferred.length} chunks\n`,
);

if (total > BUDGET_BYTES) {
  process.stderr.write(`\nOVER BUDGET by ${kb(total - BUDGET_BYTES)} KB\n`);
  process.exit(1);
}
process.stdout.write(`under budget by ${kb(BUDGET_BYTES - total)} KB\n`);
