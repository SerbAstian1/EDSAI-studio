#!/usr/bin/env node
import { RunContext, RunStore, runInstrument, type InstrumentCall } from '@edsai/engine';
import { buildRubric } from '@edsai/rubric';
import { Executor, TurnRefused } from '../executor.js';
import { diagnose } from '../failure.js';
import { OPENAI_DEFAULT_MODEL, OpenAIModelClient } from '../openai.js';
import { addUsage, NO_USAGE } from '../pricing.js';
import type { ModelEffort } from '../protocol.js';
import { RehearsalClient, REHEARSAL_MODEL } from '../rehearsal.js';

const usage = `edsai-execute <runId> [--rehearse] [--delay-ms <milliseconds>]
  [--model <id>] [--effort none|minimal|low|medium|high|xhigh|max]

  Executes every activated department that has no output yet, in order, and
  stops at the first one that will not produce one. Safe to re-run: completed
  departments are persisted, so it resumes rather than repeating.

  Needs OPENAI_API_KEY for live execution. Use --rehearse (or
  EDSAI_REHEARSAL=1) for marked placeholder output. EDSAI_DB selects the
  database (default .edsai/runs.db).
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

  const rehearsal = argv.includes('--rehearse') || process.env['EDSAI_REHEARSAL'] === '1';
  const openaiApiKey = process.env['OPENAI_API_KEY'];
  if (!rehearsal && !openaiApiKey) {
    process.stderr.write('OPENAI_API_KEY is not set, so there is nothing to run this with.\n');
    return 2;
  }

  const store = new RunStore(process.env['EDSAI_DB'] ?? '.edsai/runs.db');
  const context = new RunContext({ store });
  const delay = Number.parseInt(flag(argv, 'delay-ms') ?? '', 10);
  const effort = modelEffort(flag(argv, 'effort'));
  const executor = rehearsal
    ? new Executor({
      model: REHEARSAL_MODEL,
      client: new RehearsalClient({
        rubric: buildRubric(),
        ...(Number.isFinite(delay) ? { delayMs: delay } : {}),
      }),
    })
    : new Executor({
      model: flag(argv, 'model') ?? process.env['EDSAI_MODEL'] ?? OPENAI_DEFAULT_MODEL,
      ...(effort ? { effort } : {}),
      client: new OpenAIModelClient({ apiKey: requiredApiKey(openaiApiKey) }),
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
        + `${accepted.violations.length > 0 ? `, ${accepted.violations.length} violations` : ''}\n`,
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

  process.stdout.write(
    `\n${total.inputTokens + total.cacheReadTokens + total.cacheCreationTokens} input tokens `
    + `(${total.cacheReadTokens} from cache), ${total.outputTokens} output\n`,
  );
  store.close();
  return halted ? 1 : 0;
}

function modelEffort(value: string | undefined): ModelEffort | undefined {
  if (value === undefined) return undefined;
  const efforts: ModelEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (efforts.includes(value as ModelEffort)) return value as ModelEffort;
  throw new Error(`Unknown reasoning effort "${value}".`);
}

function requiredApiKey(value: string | undefined): string {
  if (!value) throw new Error('OPENAI_API_KEY is required for live execution.');
  return value;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
