import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  Conflict, DepartmentOutput, Issue, Run,
  type Conflict as ConflictType, type DepartmentOutput as OutputType,
  type Issue as IssueType, type Run as RunType,
} from './types.js';

/**
 * Run persistence.
 *
 * Every department is written before the next one starts, which is what makes a
 * twenty-minute run survivable: a crash at minute fourteen resumes from the
 * last completed department rather than from the brief. Re-running one
 * department is idempotent by primary key, so a resume produces the same record
 * as an uninterrupted run.
 *
 * SQLite because there is one user and one machine. Only portable SQL is used,
 * so the move to Postgres when a second user exists is a connection change
 * rather than a rewrite.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  brief TEXT NOT NULL,
  level INTEGER NOT NULL,
  tracks TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  activated TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  determination TEXT
);

CREATE TABLE IF NOT EXISTS outputs (
  run_id TEXT NOT NULL,
  department_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  scores TEXT NOT NULL,
  targets TEXT NOT NULL,
  compositions TEXT NOT NULL,
  decisions TEXT NOT NULL,
  instrument_calls TEXT NOT NULL,
  tokens TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT NOT NULL,
  PRIMARY KEY (run_id, department_id)
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  traced_to TEXT NOT NULL,
  fix TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  departments TEXT NOT NULL,
  description TEXT NOT NULL,
  resolution TEXT,
  what_was_lost TEXT,
  PRIMARY KEY (run_id, id)
);

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

CREATE TABLE IF NOT EXISTS violations (
  run_id TEXT NOT NULL,
  department_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  metric TEXT NOT NULL,
  claimed TEXT NOT NULL,
  detail TEXT NOT NULL
);
`;

export interface StoredViolation {
  runId: string;
  departmentId: number;
  kind: string;
  metric: string;
  claimed: string;
  detail: string;
}

export class RunStore {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Columns added after a database was first written.
   *
   * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
   * so a store opened against a run recorded before `tokens` existed would read
   * fine and fail on the first write. Adding the column with a default is the
   * whole migration: old rows read as `[]`, which is what they meant.
   */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(outputs)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'tokens')) {
      this.db.exec("ALTER TABLE outputs ADD COLUMN tokens TEXT NOT NULL DEFAULT '[]'");
    }
  }

  close(): void {
    this.db.close();
  }

  /* -------------------------------------------------------------------- runs */

  saveRun(run: RunType): void {
    Run.parse(run);
    this.db.prepare(`
      INSERT INTO runs (id, project_id, brief, level, tracks, scope_id, activated,
                        version, status, started_at, completed_at, determination)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version, status = excluded.status,
        completed_at = excluded.completed_at, determination = excluded.determination
    `).run(
      run.id, run.projectId, run.brief, run.level, JSON.stringify(run.tracks),
      run.scopeId, JSON.stringify(run.activatedDepartments), run.version, run.status,
      run.startedAt, run.completedAt ?? null, run.determination ?? null,
    );
  }

  getRun(id: string): RunType | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined;
    if (!row) return undefined;

    return Run.parse({
      id: row['id'],
      projectId: row['project_id'],
      brief: row['brief'],
      level: row['level'],
      tracks: JSON.parse(String(row['tracks'])),
      scopeId: row['scope_id'],
      activatedDepartments: JSON.parse(String(row['activated'])),
      version: row['version'],
      status: row['status'],
      startedAt: row['started_at'],
      ...(row['completed_at'] ? { completedAt: row['completed_at'] } : {}),
      ...(row['determination'] ? { determination: row['determination'] } : {}),
    });
  }

  listRuns(): RunType[] {
    const rows = this.db.prepare('SELECT id FROM runs ORDER BY started_at DESC').all() as
      { id: string }[];
    return rows.map((r) => this.getRun(r.id)).filter((r): r is RunType => Boolean(r));
  }

  /* ----------------------------------------------------------------- outputs */

  saveOutput(output: OutputType): void {
    DepartmentOutput.parse(output);
    this.db.prepare(`
      INSERT INTO outputs (run_id, department_id, body, scores, targets, compositions,
                           decisions, instrument_calls, tokens, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, department_id) DO UPDATE SET
        body = excluded.body, scores = excluded.scores, targets = excluded.targets,
        compositions = excluded.compositions, decisions = excluded.decisions,
        instrument_calls = excluded.instrument_calls, tokens = excluded.tokens,
        completed_at = excluded.completed_at
    `).run(
      output.runId, output.departmentId, output.body,
      JSON.stringify(output.scores), JSON.stringify(output.targets),
      JSON.stringify(output.compositions), JSON.stringify(output.decisions),
      JSON.stringify(output.instrumentCalls), JSON.stringify(output.tokens),
      output.completedAt,
    );
  }

  getOutput(runId: string, departmentId: number): OutputType | undefined {
    const row = this.db
      .prepare('SELECT * FROM outputs WHERE run_id = ? AND department_id = ?')
      .get(runId, departmentId) as Record<string, string | number> | undefined;
    return row ? this.hydrateOutput(row) : undefined;
  }

  /** Outputs in pipeline order, which is the order a prompt must present them. */
  getOutputs(runId: string, order?: readonly number[]): OutputType[] {
    const rows = this.db.prepare('SELECT * FROM outputs WHERE run_id = ?').all(runId) as
      Record<string, string | number>[];
    const outputs = rows.map((r) => this.hydrateOutput(r));
    if (!order) return outputs.sort((a, b) => a.departmentId - b.departmentId);

    const rank = new Map(order.map((id, i) => [id, i]));
    return outputs.sort(
      (a, b) => (rank.get(a.departmentId) ?? 0) - (rank.get(b.departmentId) ?? 0),
    );
  }

  completedDepartments(runId: string): number[] {
    const rows = this.db
      .prepare('SELECT department_id FROM outputs WHERE run_id = ?')
      .all(runId) as { department_id: number }[];
    return rows.map((r) => r.department_id);
  }

  private hydrateOutput(row: Record<string, string | number>): OutputType {
    return DepartmentOutput.parse({
      runId: row['run_id'],
      departmentId: row['department_id'],
      body: row['body'],
      scores: JSON.parse(String(row['scores'])),
      targets: JSON.parse(String(row['targets'])),
      compositions: JSON.parse(String(row['compositions'])),
      decisions: JSON.parse(String(row['decisions'])),
      instrumentCalls: JSON.parse(String(row['instrument_calls'])),
      tokens: JSON.parse(String(row['tokens'] ?? '[]')),
      completedAt: row['completed_at'],
    });
  }

  /* ------------------------------------------------------- issues, conflicts */

  saveIssue(runId: string, issue: IssueType): void {
    Issue.parse(issue);
    this.db.prepare(`
      INSERT INTO issues (id, run_id, severity, description, traced_to, fix, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, id) DO UPDATE SET
        severity = excluded.severity, description = excluded.description,
        traced_to = excluded.traced_to, fix = excluded.fix, status = excluded.status
    `).run(
      issue.id, runId, issue.severity, issue.description,
      JSON.stringify(issue.tracedTo), issue.fix, issue.status,
    );
  }

  getIssues(runId: string): IssueType[] {
    const rows = this.db.prepare('SELECT * FROM issues WHERE run_id = ?').all(runId) as
      Record<string, string>[];
    return rows.map((row) => Issue.parse({
      id: row['id'],
      severity: row['severity'],
      description: row['description'],
      tracedTo: JSON.parse(String(row['traced_to'])),
      fix: row['fix'],
      status: row['status'],
    }));
  }

  saveConflict(runId: string, conflict: ConflictType): void {
    Conflict.parse(conflict);
    this.db.prepare(`
      INSERT INTO conflicts (id, run_id, departments, description, resolution, what_was_lost)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, id) DO UPDATE SET
        departments = excluded.departments, description = excluded.description,
        resolution = excluded.resolution, what_was_lost = excluded.what_was_lost
    `).run(
      conflict.id, runId, JSON.stringify(conflict.departments), conflict.description,
      conflict.resolution ?? null, conflict.whatWasLost ?? null,
    );
  }

  getConflicts(runId: string): ConflictType[] {
    const rows = this.db.prepare('SELECT * FROM conflicts WHERE run_id = ?').all(runId) as
      Record<string, string | null>[];
    return rows.map((row) => Conflict.parse({
      id: row['id'],
      departments: JSON.parse(String(row['departments'])),
      description: row['description'],
      ...(row['resolution'] ? { resolution: row['resolution'] } : {}),
      ...(row['what_was_lost'] ? { whatWasLost: row['what_was_lost'] } : {}),
    }));
  }

  /* --------------------------------------------------------------- rescores */

  /**
   * The audit trail for a directed rescore. Append-only by design: the original
   * score is what makes a correction reviewable rather than a quiet rewrite.
   */
  saveRescore(record: {
    runId: string; departmentId: number; dimension: string;
    fromValue: number; fromJustification: string;
    toValue: number; toJustification: string;
    directedBy: string; reason: string; appliedAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO rescores (run_id, department_id, dimension, from_value, from_justification,
                            to_value, to_justification, directed_by, reason, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.runId, record.departmentId, record.dimension,
      record.fromValue, record.fromJustification,
      record.toValue, record.toJustification,
      record.directedBy, record.reason, record.appliedAt,
    );
  }

  getRescores(runId: string): {
    runId: string; departmentId: number; dimension: string;
    fromValue: number; fromJustification: string;
    toValue: number; toJustification: string;
    directedBy: string; reason: string; appliedAt: string;
  }[] {
    const rows = this.db
      .prepare('SELECT * FROM rescores WHERE run_id = ? ORDER BY applied_at')
      .all(runId) as Record<string, string | number>[];
    return rows.map((row) => ({
      runId: String(row['run_id']),
      departmentId: Number(row['department_id']),
      dimension: String(row['dimension']),
      fromValue: Number(row['from_value']),
      fromJustification: String(row['from_justification']),
      toValue: Number(row['to_value']),
      toJustification: String(row['to_justification']),
      directedBy: String(row['directed_by']),
      reason: String(row['reason']),
      appliedAt: String(row['applied_at']),
    }));
  }

  /* ------------------------------------------------------------- violations */

  saveViolations(runId: string, departmentId: number, violations: readonly {
    kind: string; metric: string; claimed: string; detail: string;
  }[]): void {
    const insert = this.db.prepare(
      'INSERT INTO violations (run_id, department_id, kind, metric, claimed, detail) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const v of violations) {
      insert.run(runId, departmentId, v.kind, v.metric, v.claimed, v.detail);
    }
  }

  getViolations(runId: string): StoredViolation[] {
    const rows = this.db.prepare('SELECT * FROM violations WHERE run_id = ?').all(runId) as
      Record<string, string | number>[];
    return rows.map((row) => ({
      runId: String(row['run_id']),
      departmentId: Number(row['department_id']),
      kind: String(row['kind']),
      metric: String(row['metric']),
      claimed: String(row['claimed']),
      detail: String(row['detail']),
    }));
  }
}
