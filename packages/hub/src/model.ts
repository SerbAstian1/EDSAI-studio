import {
  evaluateGate, gateSummary,
  type BrandToken, type Conflict, type DepartmentOutput, type Issue, type Run, type Target,
} from '@edsai/engine';
import type { Rubric } from '@edsai/rubric';

/**
 * The hub's view of a run.
 *
 * Every section below is a projection of the run record and nothing else. There
 * is no authoring surface: if a value is not in the run, it cannot appear in the
 * hub. That is the whole product claim, and it is enforced here rather than
 * asked for in a style guide.
 */

/**
 * Why the hub would not render.
 *
 * Both reasons are the hub's own. It does not re-check provenance: that rule
 * belongs to the engine, which enforces it before a run record exists.
 */
export type HubRefusal = 'not-final' | 'unmeasured-colour';

export class HubRefused extends Error {
  constructor(readonly reason: HubRefusal, detail: string) {
    super(detail);
    this.name = 'HubRefused';
  }
}

export interface HubBundle {
  run: Run;
  rubric: Rubric;
  outputs: readonly DepartmentOutput[];
  issues: readonly Issue[];
  conflicts: readonly Conflict[];
}

/** Instruments whose output is a contrast measurement. */
export const CONTRAST_INSTRUMENTS = new Set([
  'contrast', 'contrast_worst_case', 'palette_audit',
]);

export interface RenderedTarget extends Target {
  /** Which department produced it, for attribution in the hub. */
  departmentId: number;
  departmentName: string;
}

export interface ColourEntry {
  token: BrandToken;
  /** Contrast measurements naming this token. Never empty in a rendered hub. */
  measurements: RenderedTarget[];
}

export interface HubModel {
  projectId: string;
  runId: string;
  determination: string;
  generatedAt: string;
  /** Digest of the inputs, so a stale hub can be detected rather than assumed. */
  digest: string;
  brief: string;
  strategy: { departmentName: string; body: string }[];
  colours: ColourEntry[];
  type: { token: BrandToken; measurements: RenderedTarget[] }[];
  otherTokens: { token: BrandToken; measurements: RenderedTarget[] }[];
  layout: { structure: string; family?: string; eyePath: string; departmentName: string }[];
  targets: RenderedTarget[];
  measuredCount: number;
  statedCount: number;
  /** Issues the client is told about: accepted risks, not open defects. */
  acceptedRisks: Issue[];
}

/** Departments whose body reads as brand strategy in a client-facing hub. */
const STRATEGY_DEPARTMENTS = [1, 2];

/**
 * A stable digest of everything the hub renders.
 *
 * Not a cryptographic hash — this only has to change when the run does, so a
 * regenerated hub can be compared against the record it came from. FNV-1a is
 * enough for that and needs no dependency.
 */
export function digestOf(value: unknown): string {
  const text = JSON.stringify(value) ?? '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function buildModel(bundle: HubBundle, now = new Date()): HubModel {
  const { run, rubric, outputs, issues, conflicts } = bundle;

  const gate = evaluateGate({
    proposed: run.determination ?? run.version, issues, conflicts,
  });

  if (gate.determination !== 'FINAL') {
    throw new HubRefused(
      'not-final',
      `This run is ${gate.determination}, not FINAL. ${gateSummary(gate)} A hub is what a ` +
      'client works from every day; publishing one from a run the gate has not cleared would ' +
      'put unresolved findings in front of the people least able to judge them.',
    );
  }

  const departmentName = (id: number): string =>
    rubric.departments.find((d) => d.id === id)?.name ?? `Department ${id}`;

  const ordered = [...outputs].sort(
    (a, b) => run.activatedDepartments.indexOf(a.departmentId)
            - run.activatedDepartments.indexOf(b.departmentId),
  );

  const targets: RenderedTarget[] = ordered.flatMap((output) => output.targets.map((target) => ({
    ...target,
    departmentId: output.departmentId,
    departmentName: departmentName(output.departmentId),
  })));

  // The run record's provenance is the engine's to guarantee, not the hub's.
  // `accept()` is the only path that writes a department output, it runs
  // `verifyTargets` on every submission, and an instrument claim it cannot
  // verify is downgraded to `stated-target` before anything is saved.
  // `RunStore.saveOutput` holds the structural invariant underneath that.
  //
  // This file used to re-derive that check, with a second hand-written
  // implementation, on the argument that the hub is the artefact that leaves
  // the building. The argument was wrong in the way it usually is: the copy
  // would have drifted from the original the first time the rule changed, and
  // a rule enforced in two places is a rule enforced in neither.

  const tokensWithMeasurements = (kind: BrandToken['kind'] | BrandToken['kind'][]) => {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return ordered.flatMap((output) => output.tokens
      .filter((token) => kinds.includes(token.kind))
      .map((token) => ({
        token,
        measurements: targets.filter((target) => target.tokens.includes(token.name)),
      })));
  };

  const colours: ColourEntry[] = tokensWithMeasurements('color');

  // "Done when" #2: every colour pairing in the hub renders a ratio produced by
  // the contrast instrument in that run.
  for (const entry of colours) {
    const measured = entry.measurements.filter((m) =>
      m.source === 'instrument' && m.instrument && CONTRAST_INSTRUMENTS.has(m.instrument));
    if (measured.length === 0) {
      throw new HubRefused(
        'unmeasured-colour',
        `Colour token "${entry.token.name}" (${entry.token.value}) carries no contrast ` +
        'measurement from this run. Every colour in the hub states what it measures against; ' +
        'a swatch without one is the thing every other brand-guidelines product already ships.',
      );
    }
  }

  return {
    projectId: run.projectId,
    runId: run.id,
    determination: gate.determination,
    generatedAt: now.toISOString(),
    digest: digestOf({ run, outputs: ordered, issues, conflicts }),
    brief: run.brief,
    strategy: ordered
      .filter((output) => STRATEGY_DEPARTMENTS.includes(output.departmentId))
      .map((output) => ({
        departmentName: departmentName(output.departmentId), body: output.body,
      })),
    colours,
    type: tokensWithMeasurements(['font', 'size']),
    otherTokens: tokensWithMeasurements(['space', 'radius', 'asset', 'text']),
    layout: ordered.flatMap((output) => output.compositions.map((composition) => ({
      structure: composition.structure,
      ...(composition.family ? { family: composition.family } : {}),
      eyePath: composition.eyePath,
      departmentName: departmentName(output.departmentId),
    }))),
    targets,
    measuredCount: targets.filter((t) => t.source === 'instrument').length,
    statedCount: targets.filter((t) => t.source === 'stated-target').length,
    acceptedRisks: issues.filter((issue) => issue.status === 'accepted'),
  };
}

/** Whether a hub generated from `digest` still matches the run it came from. */
export function isStale(digest: string, bundle: HubBundle): boolean {
  const ordered = [...bundle.outputs].sort(
    (a, b) => bundle.run.activatedDepartments.indexOf(a.departmentId)
            - bundle.run.activatedDepartments.indexOf(b.departmentId),
  );
  return digest !== digestOf({
    run: bundle.run, outputs: ordered, issues: bundle.issues, conflicts: bundle.conflicts,
  });
}
