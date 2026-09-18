import { describe, expect, it } from 'vitest';
import { RunStore } from '../src/store.js';
import { slugify, Slug, phaseIndex, PROJECT_PHASES } from '../src/entities.js';
import { ensureLocalProject, UNATTRIBUTED_CLIENT } from '../src/bootstrap.js';

describe('slugs', () => {
  it('builds a portal-safe slug from a name', () => {
    expect(slugify("Disan's Footwear")).toBe('disan-s-footwear');
    expect(slugify('Acme  Hotels ')).toBe('acme-hotels');
    expect(slugify('Café Morrow')).toBe('cafe-morrow');
  });

  it('never leaves a leading or trailing hyphen', () => {
    for (const input of ['—Acme—', '!!!', ' a ', 'x'.repeat(100)]) {
      const slug = slugify(input);
      if (slug !== '') expect(Slug.safeParse(slug).success, input).toBe(true);
    }
  });

  it('refuses a slug the URL could not carry', () => {
    for (const bad of ['Acme', 'acme_hotels', 'acme--hotels', '-acme', 'acme-', '']) {
      expect(Slug.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('project phases', () => {
  it('orders the creative phases the brief names', () => {
    expect(PROJECT_PHASES[0]).toBe('discovery');
    expect(PROJECT_PHASES[PROJECT_PHASES.length - 1]).toBe('complete');
    expect(phaseIndex('identity')).toBeGreaterThan(phaseIndex('strategy'));
  });
});

describe('the migration', () => {
  it('gives a run recorded before clients existed a client and a project', () => {
    const store = new RunStore();
    // Write a legacy row directly, the way one recorded before the column existed.
    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db;
    db.exec(`INSERT INTO runs (id, project_id, client_id, brief, level, tracks, scope_id,
      activated, version, status, started_at)
      VALUES ('old1', 'Morrow Coffee', '', 'A brief.', 1, '["brand"]', 'full', '[1]',
              'V1', 'complete', '2026-01-01T00:00:00.000Z')`);

    // Re-opening runs the migration against the existing rows.
    (store as unknown as { migrate: () => void }).migrate();

    const migrated = store.getRun('old1');
    expect(migrated?.clientId).toBe(UNATTRIBUTED_CLIENT.id);
    const project = store.getProject(migrated?.projectId ?? '');
    expect(project?.name).toBe('Morrow Coffee');
    store.close();
  });

  it('is idempotent — running it twice does not duplicate projects', () => {
    const store = new RunStore();
    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db;
    db.exec(`INSERT INTO runs (id, project_id, client_id, brief, level, tracks, scope_id,
      activated, version, status, started_at)
      VALUES ('old1', 'Morrow Coffee', '', 'A brief.', 1, '["brand"]', 'full', '[1]',
              'V1', 'complete', '2026-01-01T00:00:00.000Z')`);
    const migrate = (store as unknown as { migrate: () => void }).migrate.bind(store);
    migrate();
    migrate();
    expect(store.listProjects(UNATTRIBUTED_CLIENT.id)).toHaveLength(1);
    store.close();
  });

  it('gives two legacy runs on one project name the same project', () => {
    const store = new RunStore();
    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db;
    for (const id of ['old1', 'old2']) {
      db.exec(`INSERT INTO runs (id, project_id, client_id, brief, level, tracks, scope_id,
        activated, version, status, started_at)
        VALUES ('${id}', 'Atlas', '', 'A brief.', 1, '["brand"]', 'full', '[1]',
                'V1', 'complete', '2026-01-01T00:00:00.000Z')`);
    }
    (store as unknown as { migrate: () => void }).migrate();
    expect(store.getRun('old1')?.projectId).toBe(store.getRun('old2')?.projectId);
    store.close();
  });
});

describe('ensureLocalProject', () => {
  it('resolves the same project for the same name', () => {
    const store = new RunStore();
    const a = ensureLocalProject(store, 'Atlas Sports');
    const b = ensureLocalProject(store, 'Atlas Sports');
    expect(a.project.id).toBe(b.project.id);
    expect(a.client.id).toBe(UNATTRIBUTED_CLIENT.id);
    store.close();
  });

  it('names the client honestly rather than leaving the scope blank', () => {
    const store = new RunStore();
    const { client } = ensureLocalProject(store, 'x');
    expect(client.name).toBe('Unattributed');
    expect(client.id).toBeTruthy();
    store.close();
  });
});

describe('sessions', () => {
  it('does not return an expired session, and removes it', () => {
    const store = new RunStore();
    store.saveSession({
      digest: 'a'.repeat(64), userId: 'u1', kind: 'studio', role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z',
    });
    expect(store.getSession('a'.repeat(64), new Date('2026-01-01T00:30:00.000Z'))).toBeTruthy();
    expect(store.getSession('a'.repeat(64), new Date('2026-01-02T00:00:00.000Z'))).toBeUndefined();
    // Gone, not merely hidden.
    expect(store.getSession('a'.repeat(64), new Date('2026-01-01T00:30:00.000Z'))).toBeUndefined();
    store.close();
  });

  it('prunes what has already expired', () => {
    const store = new RunStore();
    store.saveSession({
      digest: 'b'.repeat(64), userId: 'u1', kind: 'studio', role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z',
    });
    expect(store.pruneSessions(new Date('2026-02-01T00:00:00.000Z'))).toBe(1);
    store.close();
  });

  it('keeps a portal session bound to the client it was created for', () => {
    const store = new RunStore();
    store.saveSession({
      digest: 'c'.repeat(64), userId: 'p1', kind: 'portal', clientId: 'acme', role: 'viewer',
      createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(store.getSession('c'.repeat(64))?.clientId).toBe('acme');
    store.close();
  });
});
