import { z } from 'zod';

/**
 * The run record — the plan's §6 data model, as schemas.
 *
 * The discipline lives in the constraints, not the shapes. Three of them carry
 * the system's whole argument: a score cannot exist without a justification, an
 * `actual` cannot exist without an instrument behind it, and an issue cannot
 * exist without a department it traces to.
 */

export const Severity = z.enum(['Blocker', 'Major', 'Minor', 'Nitpick']);
export type Severity = z.infer<typeof Severity>;

export const BLOCKS_FINAL: readonly Severity[] = ['Blocker', 'Major'];

export const Score = z.object({
  dimension: z.string().min(1),
  value: z.number().int().min(1).max(10),
  justification: z.string().min(1, 'every score needs a one-sentence justification'),
  inverse: z.boolean().default(false),
});
export type Score = z.infer<typeof Score>;

/**
 * Where a number came from.
 *
 * `instrument` means a tool call in that department's own turn produced it.
 * `stated-target` means a target with a stated mechanism for hitting it, which
 * is what the corpus asks for when nothing can be measured directly. The engine
 * enforces the difference; nothing else in the system has to trust the model
 * about it.
 */
export const TargetSource = z.enum(['instrument', 'stated-target']);
export type TargetSource = z.infer<typeof TargetSource>;

export const Target = z.object({
  discipline: z.string().min(1),
  metric: z.string().min(1),
  /** The target as stated, e.g. "< 2.5s" or "4.5:1". */
  target: z.string().min(1),
  /** Only ever present when an instrument produced it. */
  actual: z.string().optional(),
  source: TargetSource,
  /** Required when there is no actual: how the target will be hit. */
  mechanism: z.string().optional(),
  pass: z.boolean().optional(),
  /** Which instrument produced `actual`, matched against the turn's tool calls. */
  instrument: z.string().optional(),
  /**
   * The token names this measurement is about.
   *
   * Without it, a hub rendering a swatch beside its ratio has to match the two
   * by reading the metric string, which is a guess wearing a join's clothes.
   */
  tokens: z.array(z.string().min(1)).default([]),
}).superRefine((value, ctx) => {
  if (value.actual !== undefined && value.source !== 'instrument') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actual'],
      message: 'an actual may only be reported when source is "instrument"',
    });
  }
  if (value.source === 'instrument' && value.actual === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actual'],
      message: 'source "instrument" requires the measured actual',
    });
  }
  if (value.source === 'stated-target' && !value.mechanism?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mechanism'],
      message: 'a target without a stated mechanism for hitting it is just a wish',
    });
  }
});
export type Target = z.infer<typeof Target>;

/**
 * A named brand value, as data rather than as prose.
 *
 * Added for Phase 7. The hub's whole claim is that every value it renders
 * carries its measurement, and that is not possible while a hex code exists
 * only inside a department's paragraph — parsing it back out would be the
 * fabrication this system exists to prevent, one layer down.
 *
 * `default([])` so every run written before this existed still parses.
 */
export const BrandToken = z.object({
  name: z.string().min(1),
  kind: z.enum(['color', 'font', 'size', 'space', 'radius', 'asset', 'text']),
  value: z.string().min(1),
  /** How it is used: e.g. "body text", "primary surface", "display". */
  role: z.string().optional(),
  notes: z.string().optional(),
});
export type BrandToken = z.infer<typeof BrandToken>;

export const Composition = z.object({
  /** Slug from the catalog. Free text cannot satisfy this. */
  structure: z.string().min(1),
  family: z.string().optional(),
  /** The corpus requires an eye-path sentence alongside the named structure. */
  eyePath: z.string().min(1),
});
export type Composition = z.infer<typeof Composition>;

/** The five-part frame the corpus requires for any gated technology. */
export const Decision = z.object({
  technology: z.string().min(1),
  appropriateWhen: z.string().min(1),
  notAppropriateWhen: z.string().min(1),
  complexity: z.string().min(1),
  failureModes: z.string().min(1),
  simplerAlternative: z.string().min(1),
});
export type Decision = z.infer<typeof Decision>;

export const Issue = z.object({
  id: z.string().min(1),
  severity: Severity,
  description: z.string().min(1),
  /** Untraced issues are not saveable — Department 9's own working method. */
  tracedTo: z.array(z.number().int()).min(1),
  fix: z.string().min(1),
  status: z.enum(['open', 'resolved', 'accepted']).default('open'),
});
export type Issue = z.infer<typeof Issue>;

export const Conflict = z.object({
  id: z.string().min(1),
  departments: z.array(z.number().int()).min(2),
  description: z.string().min(1),
  resolution: z.string().optional(),
  /** Required once resolved: the corpus forbids averaging a conflict away. */
  whatWasLost: z.string().optional(),
});
export type Conflict = z.infer<typeof Conflict>;

export const DepartmentOutput = z.object({
  runId: z.string().min(1),
  departmentId: z.number().int(),
  /** Free-form reasoning, in the department's own shape. */
  body: z.string().min(1),
  scores: z.array(Score),
  targets: z.array(Target),
  tokens: z.array(BrandToken).default([]),
  compositions: z.array(Composition),
  decisions: z.array(Decision),
  /** Instrument names called during this department's turn. */
  instrumentCalls: z.array(z.string()),
  completedAt: z.string(),
});
export type DepartmentOutput = z.infer<typeof DepartmentOutput>;

export const RunVersion = z.enum(['V1', 'V2', 'V3', 'FINAL']);
export type RunVersion = z.infer<typeof RunVersion>;

export const RunStatus = z.enum(['pending', 'running', 'blocked', 'complete', 'failed']);
export type RunStatus = z.infer<typeof RunStatus>;

export const Run = z.object({
  id: z.string().min(1),
  /**
   * The project this run belongs to. A foreign key since Phase 2 — it used to
   * be a free string with nothing behind it, and the migration turned every
   * distinct string into a real `Project`.
   */
  projectId: z.string().min(1),
  /**
   * The client whose data this is. Every scope check reads this field, so it is
   * required rather than optional: a run with no client is a run no isolation
   * rule can reason about.
   */
  clientId: z.string().min(1),
  brief: z.string().min(1),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  tracks: z.array(z.string().min(1)).min(1),
  scopeId: z.string().min(1).default('full'),
  activatedDepartments: z.array(z.number().int()),
  version: RunVersion,
  status: RunStatus,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  /** Set by Arbitration, then overridden by the gate if it cannot hold. */
  determination: RunVersion.optional(),
});
export type Run = z.infer<typeof Run>;
