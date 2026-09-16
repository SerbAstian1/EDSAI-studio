import { z } from 'zod';

/**
 * The typed shape of the EDSAI rubric.
 *
 * Every schema here mirrors something the corpus states in prose or a table.
 * Nothing is invented: if a field exists, a reference file is its source, and
 * the parser that fills it names which one.
 */

/** A 1–10 score. Integer only — the corpus scores in whole numbers. */
export const ScoreValue = z.number().int().min(1).max(10);

/**
 * A score is never a bare number. `00-scorecard.md §1` requires a justification
 * for every score, so the schema makes an unjustified score unrepresentable
 * rather than merely discouraged.
 */
export const Score = z.object({
  dimension: z.string().min(1),
  value: ScoreValue,
  justification: z.string().min(1, 'every score needs a one-sentence justification'),
  /** True for Friction-per-Word, Code Coupling, Motion Payload, Waterfall Discipline. */
  inverse: z.boolean().default(false),
});
export type Score = z.infer<typeof Score>;

export const Dimension = z.object({
  name: z.string().min(1),
  /** Which department scores it; `universal` for the four scored everywhere. */
  scope: z.union([z.literal('universal'), z.number().int()]),
  inverse: z.boolean().default(false),
  /** Present for universal dimensions, which the corpus defines by question. */
  question: z.string().optional(),
  /** The reference file this dimension was read from. */
  source: z.string(),
});
export type Dimension = z.infer<typeof Dimension>;

/** How a department reports. Not every department scores. */
export const ReportingMode = z.enum(['scored', 'measured', 'issue-counted']);
export type ReportingMode = z.infer<typeof ReportingMode>;

export const Department = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  mode: ReportingMode,
  dimensions: z.array(Dimension),
  /** Measurables this department reports against, from its own reference file. */
  measurableTargets: z.array(z.string().min(1)),
  reference: z.string(),
});
export type Department = z.infer<typeof Department>;

/**
 * Activation strength per system level, from the matrix in
 * `00-frontend-classification.md`. The corpus draws these as glyphs.
 */
export const Activation = z.enum(['off', 'baseline', 'full', 'full-plus', 'full-plus-realtime']);
export type Activation = z.infer<typeof Activation>;

export const SystemLevel = z.union([
  z.literal(0), z.literal(1), z.literal(2),
  z.literal(3), z.literal(4), z.literal(5),
]);
export type SystemLevel = z.infer<typeof SystemLevel>;

export const ActivationRow = z.object({
  departmentId: z.number().int(),
  departmentName: z.string().min(1),
  /** Indexed by system level 0–5. */
  byLevel: z.tuple([Activation, Activation, Activation, Activation, Activation, Activation]),
});
export type ActivationRow = z.infer<typeof ActivationRow>;

export const CompositionStructure = z.object({
  /** Stable slug used as the enum value a department must cite. */
  id: z.string().min(1),
  name: z.string().min(1),
  family: z.string().min(1),
  description: z.string().min(1),
});
export type CompositionStructure = z.infer<typeof CompositionStructure>;

export const CompositionFamily = z.object({
  name: z.string().min(1),
  effect: z.string(),
  structures: z.array(CompositionStructure).min(1),
});
export type CompositionFamily = z.infer<typeof CompositionFamily>;

/** A cross-cutting roll-up: a mean of named dimensions, never a fresh judgment. */
export const RollUp = z.object({
  name: z.string().min(1),
  composedFrom: z.array(z.string().min(1)).min(1),
});
export type RollUp = z.infer<typeof RollUp>;

export const Severity = z.object({
  name: z.enum(['Blocker', 'Major', 'Minor', 'Nitpick']),
  definition: z.string().min(1),
  targetForFinal: z.string().min(1),
  /** Blocker and Major block FINAL; the other two do not. */
  blocksFinal: z.boolean(),
});
export type Severity = z.infer<typeof Severity>;

export const TargetDiscipline = z.object({
  discipline: z.string().min(1),
  /** One bullet per measurable the corpus names for this discipline. */
  targets: z.array(z.string().min(1)).min(1),
});
export type TargetDiscipline = z.infer<typeof TargetDiscipline>;

/** A pipeline track: an ordered department list sharing a strategic foundation. */
export const Track = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.array(z.number().int()).min(1),
});
export type Track = z.infer<typeof Track>;

/**
 * A discrepancy between the canonical dimension list in `00-scorecard.md §3`
 * and what a department's own reference file scores. The corpus is the product;
 * drift in it is a finding, not a parser error, so it is reported rather than
 * thrown.
 */
export const Drift = z.object({
  departmentId: z.number().int(),
  kind: z.enum(['missing-from-canonical', 'missing-from-department', 'name-mismatch']),
  dimension: z.string().min(1),
  detail: z.string().min(1),
});
export type Drift = z.infer<typeof Drift>;

export const Rubric = z.object({
  universalDimensions: z.array(Dimension).length(4),
  departments: z.array(Department).min(1),
  activationMatrix: z.array(ActivationRow).min(1),
  compositionFamilies: z.array(CompositionFamily).min(1),
  rollUps: z.array(RollUp).min(1),
  severities: z.array(Severity).length(4),
  measurableTargets: z.array(TargetDiscipline).min(1),
  tracks: z.array(Track).min(1),
  drift: z.array(Drift),
});
export type Rubric = z.infer<typeof Rubric>;
