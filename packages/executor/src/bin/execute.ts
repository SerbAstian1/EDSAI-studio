#!/usr/bin/env node
import { RunContext, RunStore, runInstrument, type InstrumentCall } from '@edsai/engine';
import { Executor, TurnRefused } from '../executor.js';
import { diagnose } from '../failure.js';
import { costOf, addUsage, NO_USAGE } from '../pricing.js';

/**
 * Run a run, from the command line.
 *
 * The same loop the API drives, reachable without a server. Useful for the case
 * the API cannot cover: watching a real run happen, one department at a time,
 * with the cost printed as it accrues.
 */

const usage = `edsai-execute <runId> [--model <id>] [--effort low|medium|high|xhigh|max]

  Executes every activated department that has no output yet, in order, and
  stops at the first one that will not produce one. Safe to re-run: completed
  departments are persisted, so it resumes rather than repeating.

  Needs ANTHROPIC_API_KEY. EDSAI_DB selects the database (default .edsai/runs.db).
`;

const flag = (argv: string[], name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};

async function main(argv: string[]): Promise<number> {
  const runId = argv[0];
  if (!runId || runId === '--help') {
    process.stdout.write(usage);
    return runId ? 0 : 2;
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    process.stderr.write('ANTHROPIC_API_KEY is not set, so there is nothing to run this with.\n');
    return 2;
  }

  const store = new RunStore(process.env['EDSAI_DB'] ?? '.edsai/runs.db');
  const context = new RunContext({ store });
  const model = flag(argv, 'model');
  const effort = flag(argv, 'effort') as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;

  const executor = new Executor({
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  });

  let total = NO_USAGE;
  let halted = false;

  for (;;) {
    const turn = context.prepare(runId);
    if (!turn) break;

    const { index, total: count } = turn.position;
    process.stdout.write(
      `[${index}/${count}] ${turn.department.id} ${turn.department.name} … `,
    );

    const calls: InstrumentCall[] = [];
    try {
      const result = await executor.runDepartment(turn, (name, input) => {
        const output = runInstrument(name, input);
        calls.push({ instrument: name, input, output });
        return output;
      });
      total = addUsage(total, result.usage);
      const accepted = context.accept(runId, turn.department.id, result.submission, calls);

      process.stdout.write(
        `${accepted.output.scores.length} scores, ${accepted.output.targets.length} targets`
        + `${result.instrumentCalls > 0 ? `, ${result.instrumentCalls} measurements` : ''}`
        + `${accepted.violations.length > 0 ? `, ${accepted.violations.length} violations` : ''}`
        + `${result.cost === undefined ? '' : ` · $${result.cost.toFixed(3)}`}\n`,
      );
      for (const violation of accepted.violations) {
        process.stderr.write(`    violation (${violation.kind}): ${violation.detail}\n`);
      }
    } catch (error) {
      halted = true;
      const why = error instanceof TurnRefused ? error.reason
        : error instanceof Error ? error.message : String(error);
      const diagnosis = diagnose(error);
      process.stdout.write('halted\n');
      process.stderr.write(`  ${why}\n`);
      process.stderr.write(`  ${diagnosis.hint}\n`);
      break;
    }
  }

  const spent = costOf(total, executor.model);
  process.stdout.write(
    `\n${total.inputTokens + total.cacheReadTokens + total.cacheCreationTokens} input tokens `
    + `(${total.cacheReadTokens} from cache), ${total.outputTokens} output`
    + `${spent === undefined ? '' : ` · $${spent.toFixed(2)}`}\n`,
  );
  store.close();
  return halted ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
