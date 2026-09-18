import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  Conflict, DepartmentOutput, Issue, Run,
  type Conflict as ConflictType, type DepartmentOutput as OutputType,
  type Issue as IssueType, type Run as RunType,
} from './types.js';
import { slugify } from './entities.js';
import { BrandValue, type BrandValue as BrandValueType } from './brand.js';
import {
  Onboarding, Answer,
  type Onboarding as OnboardingType, type Answer as AnswerType,
} from './onboarding.js';
import {
  Client, Contact, Project, Session, StudioUser,
  type Client as ClientType, type Contact as ContactType, type Project as ProjectType,
  type Session as SessionType, type StudioUser as StudioUserType,
} from './entities.js';

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
  client_id TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  website TEXT,
  industry TEXT,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  title TEXT,
  decision_maker INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL,
  deadline TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_values (
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  role TEXT,
  against TEXT,
  origin TEXT NOT NULL,
  source_run_id TEXT,
  reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_id, name)
);

CREATE TABLE IF NOT EXISTS onboardings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  submitted_at TEXT,
  project_id TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_answers (
  onboarding_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  value TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (onboarding_id, question_id)
);

CREATE TABLE IF NOT EXISTS onboarding_invites (
  digest TEXT PRIMARY KEY,
  onboarding_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS onboardings_by_client ON onboardings (client_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  client_id TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS contacts_by_client ON contacts (client_id);
CREATE INDEX IF NOT EXISTS projects_by_client ON projects (client_id);
CREATE INDEX IF NOT EXISTS runs_by_client ON runs (client_id);

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

/**
 * The structural invariant every stored output has to satisfy.
 *
 * `verifyTargets` decides whether a claimed measurement is real: it needs the
 * turn's tool outputs, it compares the claimed numbers against what the
 * instrument produced, and it downgrades anything it cannot verify. That is the
 * rule, and it lives in `verify.ts` alone.
 *
 * This is a different and much weaker statement: a record that says
 * `source: 'instrument'` must at least name an instrument the same output says
 * was called. It cannot re-do the verification — the tool outputs are gone by
 * the time anything is persisted — but it does make the contradiction
 * unstorable, so a write path added later cannot put a self-contradicting
 * record in front of a client by skipping `accept()`.
 *
 * It lives here because `saveOutput` is the one place every write passes
 * through. The alternative was a second copy of the real check in whatever
 * reads the record last, which is where this started and is worse: that copy
 * drifts, and a rule enforced in two places is a rule enforced in neither.
 */
function assertProvenanceIsRecordable(output: OutputType): void {
  const called = new Set(output.instrumentCalls);
  for (const target of output.targets) {
    if (target.source !== 'instrument') continue;

    if (!target.instrument) {
      throw new Error(
        `Refusing to store ${output.departmentId}/"${target.metric}": it reports a measured ` +
        'actual with no instrument named. Submit through `accept`, which verifies the claim ' +
        'or downgrades it.',
      );
    }
    if (!called.has(target.instrument)) {
      throw new Error(
        `Refusing to store ${output.departmentId}/"${target.metric}": it credits ` +
        `${target.instrument}, which this output does not list as called. Called: ` +
        `${[...called].join(', ') || 'nothing'}.`,
      );
    }
  }
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
    const columns = (table: string): string[] =>
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .map((column) => column.name);

    if (!columns('outputs').includes('tokens')) {
      this.db.exec("ALTER TABLE outputs ADD COLUMN tokens TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns('runs').includes('client_id')) {
      this.db.exec("ALTER TABLE runs ADD COLUMN client_id TEXT NOT NULL DEFAULT ''");
    }
    this.attachOrphanedRuns();
  }

  /**
   * Give every run that predates clients a client and a project.
   *
   * Runs used to carry `project_id` as a free string with nothing behind it.
   * Now it is a foreign key, so the string becomes a `Project.name` under one
   * client created for the purpose. Nothing is discarded and nothing is left
   * unscoped: a run with no client is a run no scope check can reason about,
   * which is precisely the row that leaks later.
   *
   * Idempotent — it only touches runs whose client is still empty.
   */
  private attachOrphanedRuns(): void {
    const orphans = this.db
      .prepare("SELECT id, project_id, started_at FROM runs WHERE client_id = '' OR client_id IS NULL")
      .all() as { id: string; project_id: string; started_at: string }[];
    if (orphans.length === 0) return;

    const now = new Date().toISOString();
    const client = this.ensureClient({
      id: 'client-unattributed',
      name: 'Unattributed',
      slug: 'unattributed',
      notes: 'Created by migration for runs recorded before clients existed.',
      status: 'archived',
      createdAt: now,
      updatedAt: now,
    });

    const byName = new Map<string, string>();
    for (const project of this.listProjects(client.id)) byName.set(project.name, project.id);

    const update = this.db.prepare('UPDATE runs SET client_id = ?, project_id = ? WHERE id = ?');
    for (const orphan of orphans) {
      const name = orphan.project_id || 'Untitled';
      let projectId = byName.get(name);
      if (!projectId) {
        projectId = `project-${slugify(name) || 'untitled'}-${client.id.slice(-4)}`;
        this.saveProject({
          id: projectId, clientId: client.id, name,
          kind: 'other', phase: 'complete',
          createdAt: orphan.started_at || now, updatedAt: now,
        });
        byName.set(name, projectId);
      }
      update.run(client.id, projectId, orphan.id);
    }
  }

  close(): void {
    this.db.close();
  }

  /* ----------------------------------------------------------------- clients */

  saveClient(client: ClientType): void {
    Client.parse(client);
    this.db.prepare(`
      INSERT INTO clients (id, name, slug, website, industry, location, notes, status,
                           created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, slug = excluded.slug, website = excluded.website,
        industry = excluded.industry, location = excluded.location, notes = excluded.notes,
        status = excluded.status, updated_at = excluded.updated_at
    `).run(
      client.id, client.name, client.slug, client.website ?? null, client.industry ?? null,
      client.location ?? null, client.notes ?? null, client.status,
      client.createdAt, client.updatedAt,
    );
  }

  /** Save unless the slug is already taken by someone else. */
  ensureClient(client: ClientType): ClientType {
    const existing = this.getClientBySlug(client.slug);
    if (existing) return existing;
    this.saveClient(client);
    return client;
  }

  getClient(id: string): ClientType | undefined {
    const row = this.db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return row ? hydrateClient(row as Record<string, unknown>) : undefined;
  }

  getClientBySlug(slug: string): ClientType | undefined {
    const row = this.db.prepare('SELECT * FROM clients WHERE slug = ?').get(slug);
    return row ? hydrateClient(row as Record<string, unknown>) : undefined;
  }

  listClients(): ClientType[] {
    return (this.db.prepare('SELECT * FROM clients ORDER BY name').all() as Record<string, unknown>[])
      .map(hydrateClient);
  }

  /* ---------------------------------------------------------------- contacts */

  saveContact(contact: ContactType): void {
    Contact.parse(contact);
    this.db.prepare(`
      INSERT INTO contacts (id, client_id, name, email, phone, title, decision_maker, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, email = excluded.email, phone = excluded.phone,
        title = excluded.title, decision_maker = excluded.decision_maker
    `).run(
      contact.id, contact.clientId, contact.name, contact.email ?? null,
      contact.phone ?? null, contact.title ?? null, contact.decisionMaker ? 1 : 0,
      contact.createdAt,
    );
  }

  listContacts(clientId: string): ContactType[] {
    const rows = this.db
      .prepare('SELECT * FROM contacts WHERE client_id = ? ORDER BY decision_maker DESC, name')
      .all(clientId) as Record<string, unknown>[];
    return rows.map((row) => Contact.parse({
      id: row['id'], clientId: row['client_id'], name: row['name'],
      ...(row['email'] ? { email: row['email'] } : {}),
      ...(row['phone'] ? { phone: row['phone'] } : {}),
      ...(row['title'] ? { title: row['title'] } : {}),
      decisionMaker: row['decision_maker'] === 1,
      createdAt: row['created_at'],
    }));
  }

  /* ---------------------------------------------------------------- projects */

  saveProject(project: ProjectType): void {
    Project.parse(project);
    this.db.prepare(`
      INSERT INTO projects (id, client_id, name, kind, phase, deadline, notes,
                            created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, kind = excluded.kind, phase = excluded.phase,
        deadline = excluded.deadline, notes = excluded.notes, updated_at = excluded.updated_at
    `).run(
      project.id, project.clientId, project.name, project.kind, project.phase,
      project.deadline ?? null, project.notes ?? null, project.createdAt, project.updatedAt,
    );
  }

  getProject(id: string): ProjectType | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? hydrateProject(row as Record<string, unknown>) : undefined;
  }

  listProjects(clientId?: string): ProjectType[] {
    const rows = (clientId === undefined
      ? this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
      : this.db.prepare('SELECT * FROM projects WHERE client_id = ? ORDER BY updated_at DESC')
        .all(clientId)) as Record<string, unknown>[];
    return rows.map(hydrateProject);
  }

  /* ------------------------------------------------------------ brand values */

  saveBrandValue(value: BrandValueType): void {
    BrandValue.parse(value);
    this.db.prepare(`
      INSERT INTO brand_values (client_id, name, kind, value, role, against, origin,
                                source_run_id, reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id, name) DO UPDATE SET
        kind = excluded.kind, value = excluded.value, role = excluded.role,
        against = excluded.against, origin = excluded.origin,
        source_run_id = excluded.source_run_id, reason = excluded.reason,
        updated_at = excluded.updated_at
    `).run(value.clientId, value.name, value.kind, value.value, value.role ?? null,
      value.against ?? null, value.origin, value.sourceRunId ?? null, value.reason ?? null,
      value.updatedAt);
  }

  listBrandValues(clientId: string): BrandValueType[] {
    return (this.db.prepare('SELECT * FROM brand_values WHERE client_id = ? ORDER BY kind, name')
      .all(clientId) as Record<string, unknown>[]).map((row) => BrandValue.parse({
      clientId: row['client_id'], name: row['name'], kind: row['kind'], value: row['value'],
      ...(row['role'] ? { role: row['role'] } : {}),
      ...(row['against'] ? { against: row['against'] } : {}),
      origin: row['origin'],
      ...(row['source_run_id'] ? { sourceRunId: row['source_run_id'] } : {}),
      ...(row['reason'] ? { reason: row['reason'] } : {}),
      updatedAt: row['updated_at'],
    }));
  }

  getBrandValue(clientId: string, name: string): BrandValueType | undefined {
    return this.listBrandValues(clientId).find((value) => value.name === name);
  }

  /* ------------------------------------------------------------- onboarding */

  saveOnboarding(onboarding: OnboardingType): void {
    Onboarding.parse(onboarding);
    this.db.prepare(`
      INSERT INTO onboardings (id, client_id, status, created_at, sent_at, submitted_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, sent_at = excluded.sent_at,
        submitted_at = excluded.submitted_at, project_id = excluded.project_id
    `).run(onboarding.id, onboarding.clientId, onboarding.status, onboarding.createdAt,
      onboarding.sentAt ?? null, onboarding.submittedAt ?? null, onboarding.projectId ?? null);
  }

  getOnboarding(id: string): OnboardingType | undefined {
    const row = this.db.prepare('SELECT * FROM onboardings WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateOnboarding(row) : undefined;
  }

  listOnboardings(clientId: string): OnboardingType[] {
    return (this.db.prepare('SELECT * FROM onboardings WHERE client_id = ? ORDER BY created_at DESC')
      .all(clientId) as Record<string, unknown>[]).map(hydrateOnboarding);
  }

  saveAnswer(answer: AnswerType): void {
    Answer.parse(answer);
    this.db.prepare(`
      INSERT INTO onboarding_answers (onboarding_id, question_id, value, answered_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(onboarding_id, question_id) DO UPDATE SET
        value = excluded.value, answered_at = excluded.answered_at
    `).run(answer.onboardingId, answer.questionId, JSON.stringify(answer.value),
      answer.answeredAt);
  }

  getAnswers(onboardingId: string): AnswerType[] {
    return (this.db.prepare('SELECT * FROM onboarding_answers WHERE onboarding_id = ?')
      .all(onboardingId) as Record<string, unknown>[]).map((row) => Answer.parse({
      onboardingId: row['onboarding_id'],
      questionId: row['question_id'],
      value: JSON.parse(String(row['value'])),
      answeredAt: row['answered_at'],
    }));
  }

  /**
   * An onboarding invite: a capability, not a session.
   *
   * It grants exactly one thing — reading and writing the answers of one
   * onboarding — and nothing else. Deliberately not a portal principal with a
   * role: a magic link that minted a session would hand a stranger every read
   * that role allows, which is far more than filling in a form needs.
   *
   * Stored as a digest for the same reason sessions are.
   */
  saveInvite(invite: { digest: string; onboardingId: string; createdAt: string; expiresAt: string }): void {
    this.db.prepare(`
      INSERT INTO onboarding_invites (digest, onboarding_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(digest) DO UPDATE SET expires_at = excluded.expires_at
    `).run(invite.digest, invite.onboardingId, invite.createdAt, invite.expiresAt);
  }

  /** The onboarding an invite opens, or nothing once it has expired. */
  getInvited(digest: string, now = new Date()): string | undefined {
    const row = this.db.prepare('SELECT * FROM onboarding_invites WHERE digest = ?')
      .get(digest) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (new Date(String(row['expires_at'])).getTime() <= now.getTime()) {
      this.db.prepare('DELETE FROM onboarding_invites WHERE digest = ?').run(digest);
      return undefined;
    }
    return String(row['onboarding_id']);
  }

  revokeInvites(onboardingId: string): void {
    this.db.prepare('DELETE FROM onboarding_invites WHERE onboarding_id = ?').run(onboardingId);
  }

  /* ------------------------------------------------------- users and sessions */

  saveUser(user: StudioUserType): void {
    StudioUser.parse(user);
    this.db.prepare(`
      INSERT INTO users (id, email, name, role, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email, name = excluded.name, role = excluded.role,
        password_salt = excluded.password_salt, password_hash = excluded.password_hash
    `).run(user.id, user.email.toLowerCase(), user.name, user.role,
      user.passwordSalt, user.passwordHash, user.createdAt);
  }

  getUserByEmail(email: string): StudioUserType | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?')
      .get(email.toLowerCase()) as Record<string, unknown> | undefined;
    return row ? StudioUser.parse({
      id: row['id'], email: row['email'], name: row['name'], role: row['role'],
      passwordSalt: row['password_salt'], passwordHash: row['password_hash'],
      createdAt: row['created_at'],
    }) : undefined;
  }

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  }

  saveSession(session: SessionType): void {
    Session.parse(session);
    this.db.prepare(`
      INSERT INTO sessions (digest, user_id, kind, client_id, role, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest) DO UPDATE SET expires_at = excluded.expires_at
    `).run(session.digest, session.userId, session.kind, session.clientId ?? null,
      session.role, session.createdAt, session.expiresAt);
  }

  /** A session is returned only while it is still valid; expiry is not the caller's to judge. */
  getSession(digest: string, now = new Date()): SessionType | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE digest = ?')
      .get(digest) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const session = Session.parse({
      digest: row['digest'], userId: row['user_id'], kind: row['kind'],
      ...(row['client_id'] ? { clientId: row['client_id'] } : {}),
      role: row['role'], createdAt: row['created_at'], expiresAt: row['expires_at'],
    });
    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      this.deleteSession(digest);
      return undefined;
    }
    return session;
  }

  deleteSession(digest: string): void {
    this.db.prepare('DELETE FROM sessions WHERE digest = ?').run(digest);
  }

  /** Housekeeping: drop everything already expired. */
  pruneSessions(now = new Date()): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(now.toISOString());
    return Number(result.changes ?? 0);
  }

  /* -------------------------------------------------------------------- runs */

  saveRun(run: RunType): void {
    Run.parse(run);
    this.db.prepare(`
      INSERT INTO runs (id, project_id, client_id, brief, level, tracks, scope_id, activated,
                        version, status, started_at, completed_at, determination)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version, status = excluded.status,
        completed_at = excluded.completed_at, determination = excluded.determination
    `).run(
      run.id, run.projectId, run.clientId, run.brief, run.level, JSON.stringify(run.tracks),
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
      clientId: row['client_id'],
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

  /** Every run, or only one client's. The filter is SQL, not a post-filter. */
  listRuns(clientId?: string): RunType[] {
    const rows = (clientId === undefined
      ? this.db.prepare('SELECT id FROM runs ORDER BY started_at DESC').all()
      : this.db.prepare('SELECT id FROM runs WHERE client_id = ? ORDER BY started_at DESC')
        .all(clientId)) as { id: string }[];
    return rows.map((r) => this.getRun(r.id)).filter((r): r is RunType => Boolean(r));
  }

  /* ----------------------------------------------------------------- outputs */

  saveOutput(output: OutputType): void {
    DepartmentOutput.parse(output);
    assertProvenanceIsRecordable(output);
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

function hydrateClient(row: Record<string, unknown>): ClientType {
  return Client.parse({
    id: row['id'], name: row['name'], slug: row['slug'],
    ...(row['website'] ? { website: row['website'] } : {}),
    ...(row['industry'] ? { industry: row['industry'] } : {}),
    ...(row['location'] ? { location: row['location'] } : {}),
    ...(row['notes'] ? { notes: row['notes'] } : {}),
    status: row['status'], createdAt: row['created_at'], updatedAt: row['updated_at'],
  });
}

function hydrateProject(row: Record<string, unknown>): ProjectType {
  return Project.parse({
    id: row['id'], clientId: row['client_id'], name: row['name'],
    kind: row['kind'], phase: row['phase'],
    ...(row['deadline'] ? { deadline: row['deadline'] } : {}),
    ...(row['notes'] ? { notes: row['notes'] } : {}),
    createdAt: row['created_at'], updatedAt: row['updated_at'],
  });
}

function hydrateOnboarding(row: Record<string, unknown>): OnboardingType {
  return Onboarding.parse({
    id: row['id'], clientId: row['client_id'], status: row['status'],
    createdAt: row['created_at'],
    ...(row['sent_at'] ? { sentAt: row['sent_at'] } : {}),
    ...(row['submitted_at'] ? { submittedAt: row['submitted_at'] } : {}),
    ...(row['project_id'] ? { projectId: row['project_id'] } : {}),
  });
}
