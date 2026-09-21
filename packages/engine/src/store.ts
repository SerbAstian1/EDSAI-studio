import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  Conflict, DepartmentOutput, Issue, Run,
  type Conflict as ConflictType, type DepartmentOutput as OutputType,
  type Issue as IssueType, type Run as RunType,
} from './types.js';
import { slugify } from './entities.js';
import { Comparator, type Comparator as ComparatorType } from './positioning.js';
import { BrandValue, type BrandValue as BrandValueType } from './brand.js';
import { Asset, type Asset as AssetType } from './assets.js';
import { Deliverable, type Deliverable as DeliverableType } from './deliverables.js';
import { Milestone, type Milestone as MilestoneType } from './milestones.js';
import { Invoice, type Invoice as InvoiceType } from './invoices.js';
import { Message, type Message as MessageType } from './messages.js';
import { Feedback, type Feedback as FeedbackType } from './feedback.js';
import { SupportNote, type SupportNote as SupportNoteType } from './support.js';
import { DepartmentOverride, type DepartmentOverride as DepartmentOverrideType } from './process.js';
import {
  Onboarding, Answer,
  type Onboarding as OnboardingType, type Answer as AnswerType,
} from './onboarding.js';
import {
  Client, Contact, Project, Session, StudioUser,
  type Client as ClientType, type Contact as ContactType, type Project as ProjectType,
  type Session as SessionType, type StudioUser as StudioUserType,
  type PortalKey,
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
  determination TEXT,
  halted_reason TEXT,
  halted_retryable INTEGER
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  website TEXT,
  industry TEXT,
  location TEXT,
  notes TEXT,
  slack_url TEXT,
  meet_url TEXT,
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
  figma_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  collection TEXT,
  description TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_by_client ON assets (client_id);

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

CREATE TABLE IF NOT EXISTS portal_keys (
  digest TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  collections TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  uses INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS portal_keys_by_client ON portal_keys (client_id);

CREATE TABLE IF NOT EXISTS comparators (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  positions TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS comparators_by_client ON comparators (client_id);

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

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  asset_id TEXT,
  due_date TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS deliverables_by_client ON deliverables (client_id);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  due_date TEXT,
  completed_at TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS milestones_by_client ON milestones (client_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  number TEXT NOT NULL,
  description TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS invoices_by_client ON invoices (client_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment_asset_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_by_client ON messages (client_id);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  body TEXT NOT NULL,
  rating INTEGER,
  created_at TEXT NOT NULL,
  response TEXT,
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS feedback_by_client ON feedback (client_id);

CREATE TABLE IF NOT EXISTS support_notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS process_overrides (
  department_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  reason TEXT
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
    if (!columns('sessions').includes('collections')) {
      // A portal key can grant specific collections, and the session it mints
      // has to carry them: reading them from anywhere else at request time
      // would be a second source for the one fact isolation depends on.
      this.db.exec('ALTER TABLE sessions ADD COLUMN collections TEXT');
    }
    if (!columns('clients').includes('slack_url')) {
      this.db.exec('ALTER TABLE clients ADD COLUMN slack_url TEXT');
    }
    if (!columns('clients').includes('meet_url')) {
      this.db.exec('ALTER TABLE clients ADD COLUMN meet_url TEXT');
    }
    if (!columns('projects').includes('figma_url')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN figma_url TEXT');
    }
    if (!columns('runs').includes('halted_reason')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN halted_reason TEXT');
    }
    if (!columns('runs').includes('halted_retryable')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN halted_retryable INTEGER');
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
      INSERT INTO clients (id, name, slug, website, industry, location, notes, slack_url,
                           meet_url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, slug = excluded.slug, website = excluded.website,
        industry = excluded.industry, location = excluded.location, notes = excluded.notes,
        slack_url = excluded.slack_url, meet_url = excluded.meet_url,
        status = excluded.status, updated_at = excluded.updated_at
    `).run(
      client.id, client.name, client.slug, client.website ?? null, client.industry ?? null,
      client.location ?? null, client.notes ?? null, client.slackUrl ?? null,
      client.meetUrl ?? null, client.status,
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
    return rows.map(hydrateContact);
  }

  getContact(id: string): ContactType | undefined {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? hydrateContact(row) : undefined;
  }

  deleteContact(id: string): void {
    this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  }

  deleteClient(id: string): void {
    this.db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  /* ---------------------------------------------------------------- projects */

  saveProject(project: ProjectType): void {
    Project.parse(project);
    this.db.prepare(`
      INSERT INTO projects (id, client_id, name, kind, phase, deadline, notes, figma_url,
                            created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, kind = excluded.kind, phase = excluded.phase,
        deadline = excluded.deadline, notes = excluded.notes, figma_url = excluded.figma_url,
        updated_at = excluded.updated_at
    `).run(
      project.id, project.clientId, project.name, project.kind, project.phase,
      project.deadline ?? null, project.notes ?? null, project.figmaUrl ?? null,
      project.createdAt, project.updatedAt,
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

  /* ----------------------------------------------------------------- assets */

  saveAsset(asset: AssetType): void {
    Asset.parse(asset);
    this.db.prepare(`
      INSERT INTO assets (id, client_id, digest, filename, kind, content_type, bytes,
                          collection, description, approved, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        filename = excluded.filename, kind = excluded.kind,
        collection = excluded.collection, description = excluded.description,
        approved = excluded.approved
    `).run(asset.id, asset.clientId, asset.digest, asset.filename, asset.kind,
      asset.contentType, asset.bytes, asset.collection ?? null, asset.description ?? null,
      asset.approved ? 1 : 0, asset.uploadedAt);
  }

  listAssets(clientId: string): AssetType[] {
    return (this.db.prepare('SELECT * FROM assets WHERE client_id = ? ORDER BY uploaded_at DESC')
      .all(clientId) as Record<string, unknown>[]).map(hydrateAsset);
  }

  getAsset(id: string): AssetType | undefined {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateAsset(row) : undefined;
  }

  deleteAsset(id: string): void {
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  }

  /** How many records still point at a digest, so a file is not orphaned early. */
  countByDigest(digest: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE digest = ?')
      .get(digest) as { n: number };
    return row.n;
  }

  /* ------------------------------------------------------------ deliverables */

  saveDeliverable(deliverable: DeliverableType): void {
    Deliverable.parse(deliverable);
    this.db.prepare(`
      INSERT INTO deliverables (id, client_id, project_id, kind, title, description, status,
                                asset_id, due_date, delivered_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id, kind = excluded.kind, title = excluded.title,
        description = excluded.description, status = excluded.status,
        asset_id = excluded.asset_id, due_date = excluded.due_date,
        delivered_at = excluded.delivered_at, updated_at = excluded.updated_at
    `).run(deliverable.id, deliverable.clientId, deliverable.projectId ?? null,
      deliverable.kind, deliverable.title, deliverable.description ?? null, deliverable.status,
      deliverable.assetId ?? null, deliverable.dueDate ?? null, deliverable.deliveredAt ?? null,
      deliverable.createdAt, deliverable.updatedAt);
  }

  listDeliverables(clientId: string): DeliverableType[] {
    return (this.db.prepare('SELECT * FROM deliverables WHERE client_id = ? ORDER BY created_at')
      .all(clientId) as Record<string, unknown>[]).map(hydrateDeliverable);
  }

  getDeliverable(id: string): DeliverableType | undefined {
    const row = this.db.prepare('SELECT * FROM deliverables WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateDeliverable(row) : undefined;
  }

  deleteDeliverable(id: string): void {
    this.db.prepare('DELETE FROM deliverables WHERE id = ?').run(id);
  }

  /* -------------------------------------------------------------- milestones */

  saveMilestone(milestone: MilestoneType): void {
    Milestone.parse(milestone);
    this.db.prepare(`
      INSERT INTO milestones (id, client_id, project_id, title, description, status,
                              due_date, completed_at, ord, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id, title = excluded.title,
        description = excluded.description, status = excluded.status,
        due_date = excluded.due_date, completed_at = excluded.completed_at,
        ord = excluded.ord, updated_at = excluded.updated_at
    `).run(milestone.id, milestone.clientId, milestone.projectId ?? null, milestone.title,
      milestone.description ?? null, milestone.status, milestone.dueDate ?? null,
      milestone.completedAt ?? null, milestone.order, milestone.createdAt, milestone.updatedAt);
  }

  listMilestones(clientId: string): MilestoneType[] {
    return (this.db.prepare('SELECT * FROM milestones WHERE client_id = ? ORDER BY ord, due_date')
      .all(clientId) as Record<string, unknown>[]).map(hydrateMilestone);
  }

  getMilestone(id: string): MilestoneType | undefined {
    const row = this.db.prepare('SELECT * FROM milestones WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateMilestone(row) : undefined;
  }

  deleteMilestone(id: string): void {
    this.db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
  }

  /* ---------------------------------------------------------------- invoices */

  saveInvoice(invoice: InvoiceType): void {
    Invoice.parse(invoice);
    this.db.prepare(`
      INSERT INTO invoices (id, client_id, project_id, number, description, issue_date,
                            due_date, amount_cents, currency, paid, paid_at,
                            created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id, number = excluded.number,
        description = excluded.description, issue_date = excluded.issue_date,
        due_date = excluded.due_date, amount_cents = excluded.amount_cents,
        currency = excluded.currency, paid = excluded.paid, paid_at = excluded.paid_at,
        updated_at = excluded.updated_at
    `).run(invoice.id, invoice.clientId, invoice.projectId ?? null, invoice.number,
      invoice.description, invoice.issueDate, invoice.dueDate, invoice.amountCents,
      invoice.currency, invoice.paid ? 1 : 0, invoice.paidAt ?? null,
      invoice.createdAt, invoice.updatedAt);
  }

  listInvoices(clientId: string): InvoiceType[] {
    return (this.db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY issue_date DESC')
      .all(clientId) as Record<string, unknown>[]).map(hydrateInvoice);
  }

  getInvoice(id: string): InvoiceType | undefined {
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateInvoice(row) : undefined;
  }

  deleteInvoice(id: string): void {
    this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  }

  /* ---------------------------------------------------------------- messages */

  saveMessage(message: MessageType): void {
    Message.parse(message);
    this.db.prepare(`
      INSERT INTO messages (id, client_id, author_kind, author_name, body,
                            attachment_asset_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(message.id, message.clientId, message.authorKind, message.authorName,
      message.body, message.attachmentAssetId ?? null, message.createdAt);
  }

  listMessages(clientId: string): MessageType[] {
    return (this.db.prepare('SELECT * FROM messages WHERE client_id = ? ORDER BY created_at')
      .all(clientId) as Record<string, unknown>[]).map(hydrateMessage);
  }

  /* ---------------------------------------------------------------- feedback */

  saveFeedback(feedback: FeedbackType): void {
    Feedback.parse(feedback);
    this.db.prepare(`
      INSERT INTO feedback (id, client_id, project_id, body, rating, created_at,
                            response, responded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        response = excluded.response, responded_at = excluded.responded_at
    `).run(feedback.id, feedback.clientId, feedback.projectId ?? null, feedback.body,
      feedback.rating ?? null, feedback.createdAt, feedback.response ?? null,
      feedback.respondedAt ?? null);
  }

  listFeedback(clientId: string): FeedbackType[] {
    return (this.db.prepare('SELECT * FROM feedback WHERE client_id = ? ORDER BY created_at DESC')
      .all(clientId) as Record<string, unknown>[]).map(hydrateFeedback);
  }

  getFeedback(id: string): FeedbackType | undefined {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateFeedback(row) : undefined;
  }

  /* ------------------------------------------------------------ support notes */

  saveSupportNote(note: SupportNoteType): void {
    SupportNote.parse(note);
    this.db.prepare(`
      INSERT INTO support_notes (id, kind, body, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind, body = excluded.body, status = excluded.status,
        resolved_at = excluded.resolved_at
    `).run(note.id, note.kind, note.body, note.status, note.createdAt, note.resolvedAt ?? null);
  }

  listSupportNotes(): SupportNoteType[] {
    return (this.db.prepare('SELECT * FROM support_notes ORDER BY created_at DESC')
      .all() as Record<string, unknown>[]).map(hydrateSupportNote);
  }

  getSupportNote(id: string): SupportNoteType | undefined {
    const row = this.db.prepare('SELECT * FROM support_notes WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateSupportNote(row) : undefined;
  }

  deleteSupportNote(id: string): void {
    this.db.prepare('DELETE FROM support_notes WHERE id = ?').run(id);
  }

  /* ------------------------------------------------------------ process overrides */

  saveProcessOverride(override: DepartmentOverrideType): void {
    DepartmentOverride.parse(override);
    this.db.prepare(`
      INSERT INTO process_overrides (department_id, state, reason)
      VALUES (?, ?, ?)
      ON CONFLICT(department_id) DO UPDATE SET state = excluded.state, reason = excluded.reason
    `).run(override.departmentId, override.state, override.reason ?? null);
  }

  listProcessOverrides(): DepartmentOverrideType[] {
    return (this.db.prepare('SELECT * FROM process_overrides ORDER BY department_id')
      .all() as Record<string, unknown>[]).map(hydrateProcessOverride);
  }

  deleteProcessOverride(departmentId: number): void {
    this.db.prepare('DELETE FROM process_overrides WHERE department_id = ?').run(departmentId);
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

  deleteBrandValue(clientId: string, name: string): void {
    this.db.prepare('DELETE FROM brand_values WHERE client_id = ? AND name = ?')
      .run(clientId, name);
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

  listOnboardings(clientId?: string): OnboardingType[] {
    const rows = (clientId === undefined
      ? this.db.prepare('SELECT * FROM onboardings ORDER BY created_at DESC').all()
      : this.db.prepare('SELECT * FROM onboardings WHERE client_id = ? ORDER BY created_at DESC')
        .all(clientId)) as Record<string, unknown>[];
    return rows.map(hydrateOnboarding);
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

  /* ------------------------------------------------------------- comparators */

  /**
   * A brand the studio placed on a positioning chart.
   *
   * Stored apart from `brand_values` deliberately. A brand value is the
   * client's own and carries a measurement; a comparator is somebody else's
   * brand carrying the studio's judgement about where it sits. Putting them in
   * one table would be the first step toward rendering them the same way.
   */
  saveComparator(comparator: ComparatorType): void {
    Comparator.parse(comparator);
    this.db.prepare(`
      INSERT INTO comparators (id, client_id, name, note, positions, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, note = excluded.note, positions = excluded.positions
    `).run(
      comparator.id, comparator.clientId, comparator.name, comparator.note ?? null,
      JSON.stringify(comparator.positions), comparator.createdAt,
    );
  }

  listComparators(clientId: string): ComparatorType[] {
    return (this.db.prepare(
      'SELECT * FROM comparators WHERE client_id = ? ORDER BY name',
    ).all(clientId) as Record<string, unknown>[]).map(hydrateComparator);
  }

  getComparator(id: string): ComparatorType | undefined {
    const row = this.db.prepare('SELECT * FROM comparators WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateComparator(row) : undefined;
  }

  deleteComparator(id: string): void {
    this.db.prepare('DELETE FROM comparators WHERE id = ?').run(id);
  }

  /* ------------------------------------------------------------- portal keys */

  /**
   * A portal key: the client's way in.
   *
   * Deliberately not a password. A client receives brand files a handful of
   * times a year, and an account they must create, remember and reset is a
   * barrier in front of work they have already paid for. The key is a long
   * random string in a link, stored as a digest exactly as sessions are, and
   * the thing it buys is that a client never fails to open their own portal.
   *
   * What it costs, stated rather than glossed: **anyone holding the link is
   * that client.** The link is a bearer credential in an inbox. Three things
   * bound that, and none of them is optional:
   *
   * - It **expires**, and the studio chooses when.
   * - It is **revocable** at any moment, and revoking is one row.
   * - Every use is **recorded** — count and last-used — so a designer can see
   *   a link being used long after the job ended, rather than guessing.
   *
   * The key itself grants nothing directly: presenting it mints an ordinary
   * portal session with the role and collections recorded here. There is no
   * second authorization path, so everything `ScopedStore` enforces is enforced
   * for a client who arrived this way.
   */
  savePortalKey(key: {
    digest: string; clientId: string; label: string;
    role: 'limited' | 'viewer' | 'editor' | 'brand_manager' | 'owner';
    collections?: readonly string[];
    createdAt: string; expiresAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO portal_keys
        (digest, client_id, label, role, collections, created_at, expires_at, uses)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(digest) DO UPDATE SET expires_at = excluded.expires_at
    `).run(
      key.digest, key.clientId, key.label, key.role,
      key.collections && key.collections.length > 0 ? JSON.stringify(key.collections) : null,
      key.createdAt, key.expiresAt,
    );
  }

  /**
   * Relabelling a key, and only the label — role and collections stay what
   * they were issued as, on purpose: the same reason `savePortalKey`'s own
   * upsert never touches them on a re-save. Renaming who a link was given to
   * is bookkeeping; widening what it opens is a different action entirely,
   * and this method cannot be used for it even by a caller that wanted to.
   */
  relabelPortalKey(digest: string, label: string): void {
    this.db.prepare('UPDATE portal_keys SET label = ? WHERE digest = ?').run(label, digest);
  }

  /**
   * Redeem a key, or nothing.
   *
   * Recording the use is part of redeeming it rather than a separate call a
   * route could forget: the audit trail is the main thing bounding a bearer
   * credential, so it cannot be optional at the call site.
   */
  redeemPortalKey(digest: string, now = new Date()): PortalKey | undefined {
    const key = this.getPortalKey(digest, now);
    if (!key) return undefined;
    this.db.prepare(
      'UPDATE portal_keys SET uses = uses + 1, last_used_at = ? WHERE digest = ?',
    ).run(now.toISOString(), digest);
    return { ...key, uses: key.uses + 1, lastUsedAt: now.toISOString() };
  }

  /** Read a key without redeeming it. Expired keys are deleted, not returned. */
  getPortalKey(digest: string, now = new Date()): PortalKey | undefined {
    const row = this.db.prepare('SELECT * FROM portal_keys WHERE digest = ?')
      .get(digest) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (new Date(String(row['expires_at'])).getTime() <= now.getTime()) {
      this.db.prepare('DELETE FROM portal_keys WHERE digest = ?').run(digest);
      return undefined;
    }
    return hydratePortalKey(row);
  }

  /**
   * The keys issued for a client.
   *
   * Expired keys are dropped on the way out rather than listed as dead rows: a
   * designer looking at this list is asking "who can get in right now".
   */
  listPortalKeys(clientId: string, now = new Date()): PortalKey[] {
    return (this.db.prepare(
      'SELECT * FROM portal_keys WHERE client_id = ? ORDER BY created_at DESC',
    ).all(clientId) as Record<string, unknown>[])
      .map(hydratePortalKey)
      .filter((key) => new Date(key.expiresAt).getTime() > now.getTime());
  }

  /**
   * Revoke a key, and end what it already opened.
   *
   * Deleting the key alone stops new entries and leaves every browser already
   * inside untouched until its session expires — which is not what "withdraw"
   * means to the person clicking it, and the screen that offers it promises
   * exactly that. The sessions a key minted are identifiable because their
   * `userId` is derived from its digest, so they go with it.
   */
  revokePortalKey(digest: string): void {
    this.db.prepare('DELETE FROM portal_keys WHERE digest = ?').run(digest);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(portalUserId(digest));
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

  getUserById(id: string): StudioUserType | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
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

  /** The earliest owner account, for a caller that needs one without a name. */
  getFirstOwner(): StudioUserType | undefined {
    const row = this.db.prepare(
      "SELECT * FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1",
    ).get() as Record<string, unknown> | undefined;
    return row ? StudioUser.parse({
      id: row['id'], email: row['email'], name: row['name'], role: row['role'],
      passwordSalt: row['password_salt'], passwordHash: row['password_hash'],
      createdAt: row['created_at'],
    }) : undefined;
  }

  saveSession(session: SessionType): void {
    Session.parse(session);
    this.db.prepare(`
      INSERT INTO sessions
        (digest, user_id, kind, client_id, role, collections, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest) DO UPDATE SET expires_at = excluded.expires_at
    `).run(session.digest, session.userId, session.kind, session.clientId ?? null,
      session.role,
      session.collections && session.collections.length > 0
        ? JSON.stringify(session.collections) : null,
      session.createdAt, session.expiresAt);
  }

  /** A session is returned only while it is still valid; expiry is not the caller's to judge. */
  getSession(digest: string, now = new Date()): SessionType | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE digest = ?')
      .get(digest) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const session = Session.parse({
      digest: row['digest'], userId: row['user_id'], kind: row['kind'],
      ...(row['client_id'] ? { clientId: row['client_id'] } : {}),
      ...(row['collections']
        ? { collections: JSON.parse(String(row['collections'])) as string[] } : {}),
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
                        version, status, started_at, completed_at, determination,
                        halted_reason, halted_retryable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version, status = excluded.status,
        completed_at = excluded.completed_at, determination = excluded.determination,
        halted_reason = excluded.halted_reason, halted_retryable = excluded.halted_retryable
    `).run(
      run.id, run.projectId, run.clientId, run.brief, run.level, JSON.stringify(run.tracks),
      run.scopeId, JSON.stringify(run.activatedDepartments), run.version, run.status,
      run.startedAt, run.completedAt ?? null, run.determination ?? null,
      run.haltedReason ?? null, run.haltedRetryable === undefined ? null : (run.haltedRetryable ? 1 : 0),
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
      ...(row['halted_reason'] ? { haltedReason: row['halted_reason'] } : {}),
      ...(row['halted_retryable'] !== null && row['halted_retryable'] !== undefined
        ? { haltedRetryable: row['halted_retryable'] === 1 } : {}),
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
    ...(row['slack_url'] ? { slackUrl: row['slack_url'] } : {}),
    ...(row['meet_url'] ? { meetUrl: row['meet_url'] } : {}),
    status: row['status'], createdAt: row['created_at'], updatedAt: row['updated_at'],
  });
}

function hydrateContact(row: Record<string, unknown>): ContactType {
  return Contact.parse({
    id: row['id'], clientId: row['client_id'], name: row['name'],
    ...(row['email'] ? { email: row['email'] } : {}),
    ...(row['phone'] ? { phone: row['phone'] } : {}),
    ...(row['title'] ? { title: row['title'] } : {}),
    decisionMaker: row['decision_maker'] === 1,
    createdAt: row['created_at'],
  });
}

function hydrateProject(row: Record<string, unknown>): ProjectType {
  return Project.parse({
    id: row['id'], clientId: row['client_id'], name: row['name'],
    kind: row['kind'], phase: row['phase'],
    ...(row['deadline'] ? { deadline: row['deadline'] } : {}),
    ...(row['notes'] ? { notes: row['notes'] } : {}),
    ...(row['figma_url'] ? { figmaUrl: row['figma_url'] } : {}),
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

/**
 * The user id a portal key's sessions carry.
 *
 * Derived rather than stored, and in one place rather than two: minting and
 * revoking have to agree on it, and a revocation that quietly matched nothing
 * would look exactly like a revocation that worked.
 */
export function portalUserId(digest: string): string {
  return `portal-${digest.slice(0, 12)}`;
}

function hydrateComparator(row: Record<string, unknown>): ComparatorType {
  return Comparator.parse({
    id: row['id'],
    clientId: row['client_id'],
    name: row['name'],
    ...(row['note'] ? { note: row['note'] } : {}),
    positions: JSON.parse(String(row['positions'])) as Record<string, number>,
    createdAt: row['created_at'],
  });
}

function hydratePortalKey(row: Record<string, unknown>): PortalKey {
  const collections = row['collections'];
  return {
    digest: String(row['digest']),
    clientId: String(row['client_id']),
    label: String(row['label']),
    role: String(row['role']) as PortalKey['role'],
    ...(collections ? { collections: JSON.parse(String(collections)) as string[] } : {}),
    createdAt: String(row['created_at']),
    expiresAt: String(row['expires_at']),
    ...(row['last_used_at'] ? { lastUsedAt: String(row['last_used_at']) } : {}),
    uses: Number(row['uses'] ?? 0),
  };
}

function hydrateAsset(row: Record<string, unknown>): AssetType {
  return Asset.parse({
    id: row['id'], clientId: row['client_id'], digest: row['digest'],
    filename: row['filename'], kind: row['kind'], contentType: row['content_type'],
    bytes: row['bytes'],
    ...(row['collection'] ? { collection: row['collection'] } : {}),
    ...(row['description'] ? { description: row['description'] } : {}),
    approved: row['approved'] === 1,
    uploadedAt: row['uploaded_at'],
  });
}

function hydrateDeliverable(row: Record<string, unknown>): DeliverableType {
  return Deliverable.parse({
    id: row['id'], clientId: row['client_id'],
    ...(row['project_id'] ? { projectId: row['project_id'] } : {}),
    kind: row['kind'], title: row['title'],
    ...(row['description'] ? { description: row['description'] } : {}),
    status: row['status'],
    ...(row['asset_id'] ? { assetId: row['asset_id'] } : {}),
    ...(row['due_date'] ? { dueDate: row['due_date'] } : {}),
    ...(row['delivered_at'] ? { deliveredAt: row['delivered_at'] } : {}),
    createdAt: row['created_at'], updatedAt: row['updated_at'],
  });
}

function hydrateMilestone(row: Record<string, unknown>): MilestoneType {
  return Milestone.parse({
    id: row['id'], clientId: row['client_id'],
    ...(row['project_id'] ? { projectId: row['project_id'] } : {}),
    title: row['title'],
    ...(row['description'] ? { description: row['description'] } : {}),
    status: row['status'],
    ...(row['due_date'] ? { dueDate: row['due_date'] } : {}),
    ...(row['completed_at'] ? { completedAt: row['completed_at'] } : {}),
    order: row['ord'],
    createdAt: row['created_at'], updatedAt: row['updated_at'],
  });
}

function hydrateInvoice(row: Record<string, unknown>): InvoiceType {
  return Invoice.parse({
    id: row['id'], clientId: row['client_id'],
    ...(row['project_id'] ? { projectId: row['project_id'] } : {}),
    number: row['number'], description: row['description'],
    issueDate: row['issue_date'], dueDate: row['due_date'],
    amountCents: row['amount_cents'], currency: row['currency'],
    paid: row['paid'] === 1,
    ...(row['paid_at'] ? { paidAt: row['paid_at'] } : {}),
    createdAt: row['created_at'], updatedAt: row['updated_at'],
  });
}

function hydrateMessage(row: Record<string, unknown>): MessageType {
  return Message.parse({
    id: row['id'], clientId: row['client_id'], authorKind: row['author_kind'],
    authorName: row['author_name'], body: row['body'],
    ...(row['attachment_asset_id'] ? { attachmentAssetId: row['attachment_asset_id'] } : {}),
    createdAt: row['created_at'],
  });
}

function hydrateFeedback(row: Record<string, unknown>): FeedbackType {
  return Feedback.parse({
    id: row['id'], clientId: row['client_id'],
    ...(row['project_id'] ? { projectId: row['project_id'] } : {}),
    body: row['body'],
    ...(row['rating'] !== null && row['rating'] !== undefined ? { rating: row['rating'] } : {}),
    createdAt: row['created_at'],
    ...(row['response'] ? { response: row['response'] } : {}),
    ...(row['responded_at'] ? { respondedAt: row['responded_at'] } : {}),
  });
}

function hydrateSupportNote(row: Record<string, unknown>): SupportNoteType {
  return SupportNote.parse({
    id: row['id'], kind: row['kind'], body: row['body'], status: row['status'],
    createdAt: row['created_at'],
    ...(row['resolved_at'] ? { resolvedAt: row['resolved_at'] } : {}),
  });
}

function hydrateProcessOverride(row: Record<string, unknown>): DepartmentOverrideType {
  return DepartmentOverride.parse({
    departmentId: row['department_id'], state: row['state'],
    ...(row['reason'] ? { reason: row['reason'] } : {}),
  });
}
