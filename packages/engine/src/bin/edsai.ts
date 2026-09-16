#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { activatedDepartments, buildRubric, scopeById, type SystemLevel } from '@edsai/rubric';
import { evaluateGate, gateSummary } from '../gate.js';
import { Harness, instrumentNames } from '../harness.js';
import { RunContext } from '../run.js';
import { RunStore } from '../store.js';

/**
 * The CLI.
 *
 * Every command reads and writes the same store the app would, so a run started
 * here can be finished anywhere. Harness mode is the default path because it
 * needs no API credit.
 */

const DB = process.env['EDSAI_DB'] ?? '.edsai/runs.db';

const USAGE = `edsai — EDSAI Studio pipeline

  edsai run <brief-file> [--level N] [--scope ID] [--id RUNID]
      Start a run and prepare its first department.

  edsai next <runId>              Prepare the next department.
  edsai tool <runId> <dept> <instrument> <json>
                                  Run an instrument and log the call.
  edsai submit <runId> <dept>     Submit from the turn's submission.json.
  edsai retract <runId> <dept>    Discard a turn so it can be prepared again.
  edsai status <runId>            Progress, violations and the gate.
  edsai estimate [--level N] [--scope ID]
                                  Departments and token estimate for a run.
  edsai runs                      List runs.
  edsai instruments               List instruments the harness can call.

Environment:
  EDSAI_DB    path to the run database (default .edsai/runs.db)
`;

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

function context(scopeId?: string): { context: RunContext; store: RunStore } {
  const store = new RunStore(DB);
  return {
    store,
    context: new RunContext({ store, ...(scopeId ? { scopeId } : {}) }),
  };
}

function main(argv: string[]): number {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (command) {
    case 'run': {
      const briefPath = args[0];
      if (!briefPath || !existsSync(briefPath)) {
        process.stderr.write(`edsai run needs a brief file. ${briefPath ?? ''}\n`);
        return 2;
      }
      const level = Number.parseInt(flag(args, 'level') ?? '1', 10) as SystemLevel;
      const scopeId = flag(args, 'scope');
      const { context: ctx } = context(scopeId);

      const run = ctx.start({
        projectId: flag(args, 'project') ?? 'default',
        brief: readFileSync(briefPath, 'utf8'),
        level,
        ...(flag(args, 'id') ? { runId: flag(args, 'id') as string } : {}),
      });

      process.stdout.write(
        `run ${run.id} — level ${run.level}, scope ${run.scopeId}, ` +
        `${run.activatedDepartments.length} departments\n`,
      );
      const harness = new Harness(ctx);
      const next = harness.next(run.id);
      if (next) process.stdout.write(`  prepared ${next.departmentId} ${next.name} → ${next.paths.prompt}\n`);
      return 0;
    }

    case 'next': {
      const runId = args[0];
      if (!runId) { process.stderr.write('edsai next needs a run id\n'); return 2; }
      const { context: ctx, store } = context(store_scope(runId));
      const next = new Harness(ctx).next(runId);
      store.close();
      if (!next) { process.stdout.write('run complete — every department has an output\n'); return 0; }
      process.stdout.write(`${next.departmentId} ${next.name}\n  prompt: ${next.paths.prompt}\n  schema: ${next.paths.instruction}\n`);
      return 0;
    }

    case 'tool': {
      const [runId, dept, name, json] = args;
      if (!runId || !dept || !name) { process.stderr.write('edsai tool needs <runId> <dept> <instrument> <json>\n'); return 2; }
      const { context: ctx, store } = context(store_scope(runId));
      const output = new Harness(ctx).callInstrument(
        runId, Number.parseInt(dept, 10), name, JSON.parse(json ?? '{}'),
      );
      store.close();
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return 0;
    }

    case 'submit': {
      const [runId, dept] = args;
      if (!runId || !dept) { process.stderr.write('edsai submit needs <runId> <dept>\n'); return 2; }
      const { context: ctx, store } = context(store_scope(runId));
      const result = new Harness(ctx).submitFromDisk(runId, Number.parseInt(dept, 10));
      store.close();

      if (result.rejected.length > 0) {
        process.stderr.write(`rejected ${result.rejected.length} field(s):\n`);
        for (const r of result.rejected) process.stderr.write(`  ${r.field}: ${r.reason}\n`);
      }
      for (const v of result.violations) process.stderr.write(`  violation (${v.kind}): ${v.detail}\n`);
      process.stdout.write(
        `accepted department ${dept} — ${result.output.scores.length} scores, ` +
        `${result.output.targets.length} targets, ${result.violations.length} violations\n`,
      );
      return result.rejected.length > 0 ? 1 : 0;
    }

    case 'retract': {
      const [runId, dept] = args;
      if (!runId || !dept) { process.stderr.write('edsai retract needs <runId> <dept>\n'); return 2; }
      const { context: ctx, store } = context();
      new Harness(ctx).retract(runId, Number.parseInt(dept, 10));
      store.close();
      process.stdout.write(`retracted ${dept}\n`);
      return 0;
    }

    case 'status': {
      const runId = args[0];
      if (!runId) { process.stderr.write('edsai status needs a run id\n'); return 2; }
      const store = new RunStore(DB);
      const run = store.getRun(runId);
      if (!run) { process.stderr.write(`no such run: ${runId}\n`); store.close(); return 1; }

      const done = store.completedDepartments(runId);
      const issues = store.getIssues(runId);
      const conflicts = store.getConflicts(runId);
      const violations = store.getViolations(runId);
      const gate = evaluateGate({ proposed: run.determination ?? run.version, issues, conflicts });

      process.stdout.write([
        `run ${run.id} — ${run.status}, ${run.version}`,
        `  level ${run.level}, scope ${run.scopeId}, tracks ${run.tracks.join(', ')}`,
        `  departments ${done.length}/${run.activatedDepartments.length}`,
        `  issues ${issues.filter((i) => i.status === 'open').length} open of ${issues.length}`,
        `  conflicts ${conflicts.length}`,
        `  instrument violations ${violations.length}`,
        `  ${gateSummary(gate)}`,
        '',
      ].join('\n'));
      store.close();
      return 0;
    }

    case 'estimate': {
      const level = Number.parseInt(flag(args, 'level') ?? '1', 10) as SystemLevel;
      const scope = scopeById(flag(args, 'scope') ?? 'full');
      const rubric = buildRubric();
      const departments = activatedDepartments(
        rubric, level, ['digital-product', 'frontend-block', 'closing'], scope,
      );
      process.stdout.write(
        `level ${level}, scope ${scope.id}: ${departments.length} departments\n` +
        departments.map((d) => `  ${d.id} ${d.name}`).join('\n') + '\n',
      );
      return 0;
    }

    case 'runs': {
      const store = new RunStore(DB);
      for (const run of store.listRuns()) {
        const done = store.completedDepartments(run.id).length;
        process.stdout.write(
          `${run.id}  ${run.version.padEnd(5)} ${String(done).padStart(2)}/${run.activatedDepartments.length}  ${run.startedAt}\n`,
        );
      }
      store.close();
      return 0;
    }

    case 'instruments':
      process.stdout.write(instrumentNames().join('\n') + '\n');
      return 0;

    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

/** A run remembers its own scope, so commands after `run` do not need the flag. */
function store_scope(runId: string): string | undefined {
  const store = new RunStore(DB);
  const scopeId = store.getRun(runId)?.scopeId;
  store.close();
  return scopeId;
}

process.exit(main(process.argv.slice(2)));
