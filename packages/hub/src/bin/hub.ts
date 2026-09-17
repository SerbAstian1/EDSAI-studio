#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RunStore } from '@edsai/engine';
import { buildRubric } from '@edsai/rubric';
import { generateHub } from '../generate.js';
import { HubRefused, isStale } from '../model.js';

/**
 * `edsai-hub` — emit a brand hub from a FINAL run.
 *
 * It refuses rather than degrades. A run the gate has not cleared, a colour with
 * no measurement behind it, or a target crediting an instrument that was never
 * called all stop the build with the reason stated. A hub is what a client works
 * from every day; a partial one is worse than none.
 */

const USAGE = `edsai-hub — generate a brand hub from a FINAL run

  build <runId> [--db <path>] [--out <dir>] [--budget <KB>]
  check <runId> --digest <digest> [--db <path>]   is a generated hub still current?
`;

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function load(runId: string, dbPath: string) {
  const store = new RunStore(dbPath);
  const run = store.getRun(runId);
  if (!run) throw new Error(`No run ${runId} in ${dbPath}.`);
  return {
    run,
    rubric: buildRubric(),
    outputs: store.getOutputs(runId, run.activatedDepartments),
    issues: store.getIssues(runId),
    conflicts: store.getConflicts(runId),
  };
}

function main(): number {
  const [command = '', ...rest] = process.argv.slice(2);
  const runId = rest[0];
  const db = arg(rest, '--db') ?? 'data/runs/edsai.db';

  if (command === 'build' && runId) {
    const budgetKb = arg(rest, '--budget');
    const site = generateHub(load(runId, db), {
      ...(budgetKb ? { budgetBytes: Number(budgetKb) * 1024 } : {}),
    });
    const out = arg(rest, '--out') ?? 'hub';
    for (const [path, contents] of Object.entries(site.files)) {
      const target = join(out, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
      process.stdout.write(`wrote ${target}\n`);
    }
    process.stdout.write(
      `\n${site.model.measuredCount} measured, ${site.model.statedCount} stated · ` +
      `${(site.gzipBytes / 1024).toFixed(1)} KB gz · digest ${site.model.digest}\n`,
    );
    for (const finding of site.findings) {
      process.stderr.write(`[${finding.severity}] ${finding.message}\n`);
    }
    return site.withinBudget ? 0 : 1;
  }

  if (command === 'check' && runId) {
    const digest = arg(rest, '--digest');
    if (!digest) {
      process.stderr.write('check needs --digest\n');
      return 2;
    }
    const stale = isStale(digest, load(runId, db));
    process.stdout.write(stale
      ? `STALE — run ${runId} has changed since that hub was generated. Regenerate it.\n`
      : `current — the hub matches run ${runId}.\n`);
    return stale ? 1 : 0;
  }

  process.stdout.write(USAGE);
  return command === '' || command === 'help' || command === '--help' ? 0 : 2;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(error instanceof HubRefused
    ? `Refused (${error.reason}): ${error.message}\n`
    : `edsai-hub failed: ${String(error)}\n`);
  process.exitCode = 1;
}
