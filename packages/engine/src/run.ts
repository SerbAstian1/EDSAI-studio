import {
  activatedDepartments, buildRubric, scopeById,
  type DeliveryScope, type Department, type Rubric, type SystemLevel,
} from '@edsai/rubric';
import { assemble, estimatePrompt, type AssembledPrompt } from '@edsai/prompts';
import { INSTRUMENT_TOOLS } from '@edsai/instruments';
import { RunStore } from './store.js';
import { verifyTargets, type InstrumentCall, type Violation } from './verify.js';
import {
  DepartmentOutput, Run, Score, Target,
  type Composition, type Decision, type DepartmentOutput as OutputType,
  type Run as RunType, type Score as ScoreType, type Target as TargetType,
} from './types.js';

/**
 * The run loop, split so that every path through it is the same path.
 *
 * `prepare` builds the exact request for the next department from persisted
 * state. `accept` validates a response, verifies its numbers, and persists it.
 * Nothing between them knows or cares whether the response came from the API or
 * from a person pasting into a terminal — which is what made harness mode a
 * refactor rather than a second implementation, and what keeps the two paths
 * from drifting.
 */

export interface StartRunInput {
  projectId: string;
  brief: string;
  level: SystemLevel;
  tracks?: readonly string[];
  scopeId?: string;
  runId?: string;
  classificationDefence?: string;
}

export interface PreparedTurn {
  runId: string;
  department: Department;
  prompt: AssembledPrompt;
  /** Instruments this department may call. */
  tools: typeof INSTRUMENT_TOOLS;
  estimate: { stableTokens: number; volatileTokens: number; totalTokens: number };
  /** How far through the run this department sits. */
  position: { index: number; total: number };
}

export interface Submission {
  body: string;
  scores?: readonly ScoreType[];
  targets?: readonly TargetType[];
  compositions?: readonly Composition[];
  decisions?: readonly Decision[];
}

export interface AcceptResult {
  output: OutputType;
  violations: Violation[];
  /** Scores rejected by the schema, with the reason, rather than silently dropped. */
  rejected: { field: string; reason: string }[];
}

export class RunContext {
  readonly rubric: Rubric;
  readonly store: RunStore;
  private readonly scope: DeliveryScope;

  constructor(options?: { rubric?: Rubric; store?: RunStore; scopeId?: string }) {
    this.rubric = options?.rubric ?? buildRubric();
    this.store = options?.store ?? new RunStore();
    this.scope = scopeById(options?.scopeId ?? 'full');
  }

  /** Create a run and compute which departments it will execute. */
  start(input: StartRunInput): RunType {
    const tracks = input.tracks ?? ['digital-product', 'frontend-block', 'closing'];
    const departments = activatedDepartments(this.rubric, input.level, tracks, this.scope);

    const run: RunType = Run.parse({
      id: input.runId ?? crypto.randomUUID().slice(0, 8),
      projectId: input.projectId,
      brief: input.brief,
      level: input.level,
      tracks: [...tracks],
      scopeId: this.scope.id,
      activatedDepartments: departments.map((d) => d.id),
      version: 'V1',
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    this.store.saveRun(run);
    return run;
  }

  /** The next department with no persisted output, or undefined when the run is done. */
  nextDepartment(runId: string): Department | undefined {
    const run = this.requireRun(runId);
    const done = new Set(this.store.completedDepartments(runId));
    const nextId = run.activatedDepartments.find((id) => !done.has(id));
    if (nextId === undefined) return undefined;

    const department = this.rubric.departments.find((d) => d.id === nextId);
    if (!department) throw new Error(`run ${runId} names unknown department ${nextId}`);
    return department;
  }

  /**
   * Build the request for one department from persisted state alone.
   *
   * Reading only from the store is what makes resume produce an identical
   * record: there is no in-memory state that a crash could lose or a second
   * process could disagree about.
   */
  prepare(runId: string, departmentId?: number): PreparedTurn | undefined {
    const run = this.requireRun(runId);
    const department = departmentId === undefined
      ? this.nextDepartment(runId)
      : this.rubric.departments.find((d) => d.id === departmentId);

    if (!department) return undefined;
    if (!run.activatedDepartments.includes(department.id)) {
      throw new Error(
        `Department ${department.id} is not activated for run ${runId} ` +
        `(level ${run.level}, scope ${run.scopeId}). Running it would produce a row the ` +
        `classification says should not exist.`,
      );
    }

    // Upstream output, in pipeline order — each department's output is the next
    // one's input, and order is part of the meaning.
    const upstream = this.store
      .getOutputs(runId, run.activatedDepartments)
      .filter((o) => run.activatedDepartments.indexOf(o.departmentId)
                   < run.activatedDepartments.indexOf(department.id))
      .map((o) => ({
        departmentId: o.departmentId,
        name: this.rubric.departments.find((d) => d.id === o.departmentId)?.name ?? '',
        body: o.body,
      }));

    const prompt = assemble(this.rubric, department, {
      brief: run.brief,
      level: run.level,
      ...(this.scope.id !== 'full' ? { scopeNote: this.scope.description } : {}),
      upstream,
    });

    return {
      runId,
      department,
      prompt,
      tools: INSTRUMENT_TOOLS,
      estimate: estimatePrompt(prompt),
      position: {
        index: run.activatedDepartments.indexOf(department.id) + 1,
        total: run.activatedDepartments.length,
      },
    };
  }

  /**
   * Validate, verify and persist one department's response.
   *
   * Order matters: the schema runs first so a malformed score never reaches the
   * verifier, then provenance, then persistence. Nothing is written until all
   * three pass, so a rejected turn leaves the run exactly as it was and can be
   * retried without a cleanup step.
   */
  accept(
    runId: string,
    departmentId: number,
    submission: Submission,
    calls: readonly InstrumentCall[] = [],
  ): AcceptResult {
    const run = this.requireRun(runId);
    const department = this.rubric.departments.find((d) => d.id === departmentId);
    if (!department) throw new Error(`unknown department ${departmentId}`);
    if (!run.activatedDepartments.includes(departmentId)) {
      throw new Error(`Department ${departmentId} is not activated for run ${runId}.`);
    }

    const rejected: { field: string; reason: string }[] = [];

    const scores: ScoreType[] = [];
    for (const [index, raw] of (submission.scores ?? []).entries()) {
      const parsed = Score.safeParse(raw);
      if (parsed.success) scores.push(parsed.data);
      else {
        rejected.push({
          field: `scores[${index}]`,
          reason: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
    }

    if (department.mode === 'scored') {
      const expected = [
        ...this.rubric.universalDimensions.map((d) => d.name),
        ...department.dimensions.map((d) => d.name),
      ];
      const got = new Set(scores.map((s) => s.dimension));
      for (const name of expected) {
        if (!got.has(name)) {
          rejected.push({ field: `scores.${name}`, reason: 'dimension not scored' });
        }
      }
    }

    const targets: TargetType[] = [];
    for (const [index, raw] of (submission.targets ?? []).entries()) {
      const parsed = Target.safeParse(raw);
      if (parsed.success) targets.push(parsed.data);
      else {
        rejected.push({
          field: `targets[${index}]`,
          reason: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
    }

    const verification = verifyTargets(targets, calls);

    const output = DepartmentOutput.parse({
      runId,
      departmentId,
      body: submission.body,
      scores,
      targets: verification.targets,
      compositions: submission.compositions ?? [],
      decisions: submission.decisions ?? [],
      instrumentCalls: calls.map((c) => c.instrument),
      completedAt: new Date().toISOString(),
    });

    this.store.saveOutput(output);
    if (verification.violations.length > 0) {
      this.store.saveViolations(runId, departmentId, verification.violations);
    }

    return { output, violations: verification.violations, rejected };
  }

  private requireRun(runId: string): RunType {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`no such run: ${runId}`);
    return run;
  }
}
