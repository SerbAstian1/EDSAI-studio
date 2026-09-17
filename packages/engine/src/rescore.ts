import type { RunStore } from './store.js';
import { Score, type DepartmentOutput, type Score as ScoreType } from './types.js';

/**
 * Applying a rescore that Arbitration directed.
 *
 * This closes the gap run `f44f6852` found in the engine: the drift check
 * flagged clustering, Arbitration rescored a department in prose, and nothing
 * wrote that back into the persisted scores. Arbitration could direct a
 * rescore; the engine could not apply one, so the aggregate stayed wrong while
 * the document said otherwise.
 *
 * The correction is not an edit. The original score and its justification are
 * kept, because a rubric whose history can be quietly rewritten is not an
 * audit — it is a draft. What changes is which value is current.
 */

export interface RescoreRequest {
  runId: string;
  departmentId: number;
  dimension: string;
  value: number;
  justification: string;
  /** Who directed it — Arbitration, the Critic, or a named person. */
  directedBy: string;
  /** Why the original was wrong. Required: a rescore with no reason is a nudge. */
  reason: string;
}

export interface RescoreRecord {
  runId: string;
  departmentId: number;
  dimension: string;
  fromValue: number;
  fromJustification: string;
  toValue: number;
  toJustification: string;
  directedBy: string;
  reason: string;
  appliedAt: string;
}

export class RescoreRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RescoreRefused';
  }
}

export const RESCORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS rescores (
  run_id TEXT NOT NULL,
  department_id INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  from_value INTEGER NOT NULL,
  from_justification TEXT NOT NULL,
  to_value INTEGER NOT NULL,
  to_justification TEXT NOT NULL,
  directed_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

/**
 * Rewrite one score on a persisted department output, keeping the original.
 *
 * Refuses rather than guesses in three cases: an output that does not exist, a
 * dimension that department never scored, and a rescore to the value it already
 * holds — the last because an audit trail full of no-op entries is worse than
 * no audit trail, it is one nobody reads.
 */
export function applyRescore(store: RunStore, request: RescoreRequest): {
  output: DepartmentOutput;
  record: RescoreRecord;
} {
  const parsed = Score.safeParse({
    dimension: request.dimension,
    value: request.value,
    justification: request.justification,
  });
  if (!parsed.success) {
    throw new RescoreRefused(
      `the corrected score is not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  if (!request.reason.trim()) {
    throw new RescoreRefused('a rescore needs a stated reason; without one it is a nudge.');
  }

  const output = store.getOutput(request.runId, request.departmentId);
  if (!output) {
    throw new RescoreRefused(
      `Department ${request.departmentId} has no output in run ${request.runId} to rescore.`,
    );
  }

  const existing = output.scores.find((s) => s.dimension === request.dimension);
  if (!existing) {
    throw new RescoreRefused(
      `Department ${request.departmentId} never scored "${request.dimension}". ` +
      `It scored: ${output.scores.map((s) => s.dimension).join(', ')}.`,
    );
  }
  if (existing.value === request.value) {
    throw new RescoreRefused(
      `"${request.dimension}" already stands at ${request.value}. ` +
      'A rescore to the same value is not a correction.',
    );
  }

  const record: RescoreRecord = {
    runId: request.runId,
    departmentId: request.departmentId,
    dimension: request.dimension,
    fromValue: existing.value,
    fromJustification: existing.justification,
    toValue: request.value,
    toJustification: request.justification,
    directedBy: request.directedBy,
    reason: request.reason,
    appliedAt: new Date().toISOString(),
  };

  const scores: ScoreType[] = output.scores.map((score) =>
    score.dimension === request.dimension
      ? { ...score, value: request.value, justification: request.justification }
      : score,
  );

  const updated: DepartmentOutput = { ...output, scores };
  store.saveOutput(updated);
  store.saveRescore(record);

  return { output: updated, record };
}
