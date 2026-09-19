import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as instruments from '@edsai/instruments';
import { RunContext, type Submission } from './run.js';
import type { InstrumentCall } from './verify.js';

/**
 * Harness mode — Claude Code as the model.
 *
 * The Anthropic API is billed separately from a Claude subscription, so an
 * engine with no credit has a pipeline it cannot run. Harness mode writes each
 * department's prompt and schema to disk for a person (or an agent already in a
 * session) to answer, then takes the response back through the same `accept`
 * path the API would use.
 *
 * The important property is that this is not a relaxed path. Instrument calls
 * are logged here and verified exactly as on the API path, pipeline order is
 * enforced, and a submission that misses the schema is rejected without being
 * persisted. What it gives up is automation, not rigour.
 */

export interface HarnessPaths {
  root: string;
  prompt: string;
  instruction: string;
  calls: string;
  submission: string;
}

export class Harness {
  constructor(
    private readonly context: RunContext,
    private readonly root = '.edsai/harness',
  ) {}

  paths(runId: string, departmentId: number): HarnessPaths {
    const root = join(this.root, runId, String(departmentId));
    return {
      root,
      prompt: join(root, 'prompt.md'),
      instruction: join(root, 'schema.json'),
      calls: join(root, 'instrument-calls.json'),
      submission: join(root, 'submission.json'),
    };
  }

  /** Write the next department's prompt and schema to disk. */
  next(runId: string): { departmentId: number; name: string; paths: HarnessPaths } | undefined {
    const turn = this.context.prepare(runId);
    if (!turn) return undefined;

    const paths = this.paths(runId, turn.department.id);
    mkdirSync(paths.root, { recursive: true });

    writeFileSync(paths.prompt, [
      `<!-- Department ${turn.department.id} — ${turn.department.name} -->`,
      `<!-- ${turn.position.index} of ${turn.position.total} -->`,
      '',
      '# System',
      '',
      turn.prompt.system,
      '',
      '# Turn',
      '',
      turn.prompt.user,
    ].join('\n'));

    writeFileSync(paths.instruction, JSON.stringify({
      department: turn.department.id,
      name: turn.department.name,
      mode: turn.department.mode,
      dimensions: turn.department.mode === 'scored'
        ? [
            ...this.context.rubric.universalDimensions.map((d) => d.name),
            ...turn.department.dimensions.map((d) => d.name),
          ]
        : [],
      tools: turn.tools.map((t) => t.name),
      estimate: turn.estimate,
      submissionShape: {
        body: 'string — the department reasoning',
        scores: '[{ dimension, value 1-10, justification }]',
        targets: '[{ discipline, metric, target, actual?, source, mechanism?, instrument? }]',
        compositions: '[{ structure, eyePath }]',
        decisions: '[{ technology, appropriateWhen, notAppropriateWhen, complexity, failureModes, simplerAlternative }]',
      },
    }, null, 2));

    if (!existsSync(paths.calls)) writeFileSync(paths.calls, '[]');

    return { departmentId: turn.department.id, name: turn.department.name, paths };
  }

  /**
   * Run an instrument and log the call.
   *
   * The log is what the verifier reads, so an instrument invoked any other way
   * does not count — which is the point. A number is earned by a call recorded
   * against this department's turn, not by having been computed somewhere.
   */
  callInstrument(runId: string, departmentId: number, name: string, input: unknown): unknown {
    const output = runInstrument(name, input);
    const paths = this.paths(runId, departmentId);
    mkdirSync(paths.root, { recursive: true });

    const existing: InstrumentCall[] = existsSync(paths.calls)
      ? JSON.parse(readFileSync(paths.calls, 'utf8'))
      : [];
    existing.push({ instrument: name, input, output });
    writeFileSync(paths.calls, JSON.stringify(existing, null, 2));

    return output;
  }

  loggedCalls(runId: string, departmentId: number): InstrumentCall[] {
    const paths = this.paths(runId, departmentId);
    return existsSync(paths.calls) ? JSON.parse(readFileSync(paths.calls, 'utf8')) : [];
  }

  /** Take a submission through the same accept path the API path uses. */
  submit(runId: string, departmentId: number, submission: Submission) {
    return this.context.accept(
      runId, departmentId, submission, this.loggedCalls(runId, departmentId),
    );
  }

  submitFromDisk(runId: string, departmentId: number) {
    const paths = this.paths(runId, departmentId);
    if (!existsSync(paths.submission)) {
      throw new Error(`no submission at ${paths.submission}`);
    }
    return this.submit(runId, departmentId, JSON.parse(readFileSync(paths.submission, 'utf8')));
  }

  /** Discard a department's turn so it can be re-prepared from scratch. */
  retract(runId: string, departmentId: number): void {
    rmSync(this.paths(runId, departmentId).root, { recursive: true, force: true });
  }
}

/**
 * Instruments the harness can invoke, by tool name.
 *
 * Deliberately a lookup rather than dynamic dispatch: an instrument reachable
 * here is one the verifier can credit, so the list is the contract.
 */
type InstrumentFn = (input: unknown) => unknown;

/**
 * The one cast in this file, and the only place it belongs: input reaches here
 * as JSON from disk, the tool's schema validates it immediately above the call,
 * and everything after that point is typed again.
 */
const call = <T>(fn: (input: T) => unknown): InstrumentFn =>
  fn as (input: unknown) => unknown;

const INSTRUMENT_FUNCTIONS: Record<string, InstrumentFn> = {
  contrast: call(instruments.contrast),
  contrast_worst_case: call(instruments.contrastWorstCase),
  palette_audit: call(instruments.auditPalette),
  type_scale: call(instruments.generateScale),
  type_scale_audit: call(instruments.auditScale),
  spacing_audit: call(instruments.auditSpacing),
  line_length: call(instruments.lineLength),
  legibility_at_distance: call(instruments.legibilityAtDistance),
  // These two take a bare array; the tool schema wraps it in an object so the
  // call site reads the same as every other instrument.
  motion_timing: call((i: { events: Parameters<typeof instruments.auditMotion>[0] }) =>
    instruments.auditMotion(i.events)),
  seo_lengths: call(instruments.auditSeo),
  score_drift: call((i: { scores: Parameters<typeof instruments.scoreDrift>[0] }) =>
    instruments.scoreDrift(i.scores)),
  print_gamut_risk: call(instruments.printGamutRisk),
  composition_check: call(instruments.compositionCheck),
  mind_map_check: call(instruments.checkMindMap),
};

export const instrumentNames = (): string[] => Object.keys(INSTRUMENT_FUNCTIONS).sort();

/**
 * Call an instrument by name, validated, with no side effects.
 *
 * Split out of the harness so the model executor can reach the same dispatch
 * table. Keeping a second copy of "which instruments exist" would be a second
 * source of truth about the one thing the provenance rule depends on — an
 * instrument the verifier credits is one reachable from here, and two lists
 * would eventually disagree about that.
 *
 * Input arrives as JSON from a file or from a model's tool call, so it is
 * genuinely unknown until the tool's own schema has seen it. Validating here
 * rejects a malformed call rather than letting a wrong shape reach an
 * instrument and produce a number out of nonsense.
 */
export function runInstrument(name: string, input: unknown): unknown {
  const fn = INSTRUMENT_FUNCTIONS[name];
  if (!fn) {
    throw new Error(`unknown instrument: ${name}. Available: ${instrumentNames().join(', ')}`);
  }

  const schema = instruments.ToolInput[name as instruments.ToolName];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `${name} received input its schema rejects: ` +
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; '),
    );
  }
  return fn(parsed.data);
}
