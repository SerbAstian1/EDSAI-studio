import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { RunStore } from '@edsai/engine';
import { ApiServer } from '../src/server.js';

/**
 * Exercised over real HTTP against a listening server rather than by calling
 * handlers directly: the status codes, the SSE framing and the body limits are
 * the contract, and none of them are visible from a function call.
 */

const rubric = buildRubric();
let server: ApiServer;
let base: string;
let store: RunStore;
/** The session cookie every authenticated request carries. */
let cookie = '';

beforeEach(async () => {
  store = new RunStore();
  server = new ApiServer({
    store, rubric, scopeId: 'no-motion-authoring', insecureCookies: true,
  });
  base = `http://localhost:${await server.listen(0)}`;
  cookie = await signIn();
});
afterEach(async () => { await server.close(); });

/** Create the first owner and keep the cookie the server hands back. */
async function signIn(): Promise<string> {
  const res = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Studio Owner', email: 'owner@example.com', password: 'a-long-enough-password',
    }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return { status: res.status, body: await res.json() as Record<string, never> };
};

/** A client and project to hang runs on, since a run now needs both. */
const seedProject = (clientId = 'c-test', projectId = 'p-test') => {
  const now = new Date().toISOString();
  store.saveClient({
    id: clientId, name: 'Disan Footwear', slug: clientId, status: 'active',
    createdAt: now, updatedAt: now,
  });
  store.saveProject({
    id: projectId, clientId, name: 'Brand Identity', kind: 'brand-identity',
    phase: 'discovery', createdAt: now, updatedAt: now,
  });
  return { clientId, projectId };
};

const startRun = async () => {
  const { projectId } = seedProject();
  const { body } = await json('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      projectId, level: 1,
      brief: 'A booking interface for the Kampala workshop.',
    }),
  });
  return body as unknown as { id: string; activatedDepartments: number[] };
};

const fullSubmission = (departmentId: number) => {
  const department = rubric.departments.find((d) => d.id === departmentId);
  const dimensions = [
    ...rubric.universalDimensions.map((d) => d.name),
    ...(department?.dimensions ?? []).map((d) => d.name),
  ];
  return {
    body: `Reasoning for department ${departmentId}.`,
    scores: dimensions.map((dimension, i) => ({
      dimension, value: ((i * 3) % 9) + 1,
      justification: `A specific observation about ${dimension} here.`,
    })),
  };
};

describe('health and rubric', () => {
  it('reports the rubric it loaded', async () => {
    const { status, body } = await json('/api/health');
    expect(status).toBe(200);
    expect(body['departments']).toBe(28);
  });

  it('serves the rubric, including the corpus drift it found', async () => {
    const { body } = await json('/api/rubric');
    expect((body['universalDimensions'] as unknown as string[])).toHaveLength(4);
    expect((body['drift'] as unknown as { dimension: string }[])[0]?.dimension)
      .toBe('Optical Precision');
  });

  it('404s an unknown route with the method and path', async () => {
    const { status, body } = await json('/api/nope');
    expect(status).toBe(404);
    expect(body['message']).toContain('GET /api/nope');
  });
});

describe('runs', () => {
  it('starts a run under the configured scope', async () => {
    const run = await startRun();
    expect(run.activatedDepartments).toHaveLength(23);
    expect(run.activatedDepartments).not.toContain(6);
  });

  it('refuses a run with no brief', async () => {
    const { status, body } = await json('/api/runs', {
      method: 'POST', body: JSON.stringify({ level: 1 }),
    });
    expect(status).toBe(400);
    expect(body['message']).toMatch(/needs a brief/);
  });

  it('prepares the next department, with its prompt and cache breakpoint', async () => {
    const run = await startRun();
    const { body } = await json(`/api/runs/${run.id}/next`);
    expect(body['done']).toBe(false);
    expect(body['departmentId']).toBe(1);
    expect((body['prompt'] as unknown as { cacheBreakpoint: number }).cacheBreakpoint).toBe(3);
    expect((body['tools'] as unknown as string[])).toContain('contrast');
  });

  it('accepts a complete department submission', async () => {
    const run = await startRun();
    const { status, body } = await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });
    expect(status).toBe(200);
    expect((body['rejected'] as unknown as unknown[])).toHaveLength(0);
  });

  it('returns 422 with the rejected fields when a submission misses the schema', async () => {
    const run = await startRun();
    const { status, body } = await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST',
      body: JSON.stringify({ submission: { body: 'x', scores: [] } }),
    });
    expect(status).toBe(422);
    expect((body['rejected'] as unknown as unknown[]).length).toBeGreaterThan(0);
  });

  it('strips a fabricated actual and reports the violation', async () => {
    const run = await startRun();
    const { body } = await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST',
      body: JSON.stringify({
        submission: {
          ...fullSubmission(1),
          targets: [{
            discipline: 'Color', metric: 'ink on ground', target: '4.5:1',
            actual: '17.21:1', source: 'instrument', instrument: 'contrast',
          }],
        },
      }),
    });
    const violations = body['violations'] as unknown as { kind: string }[];
    expect(violations[0]?.kind).toBe('no-call');
  });

  it('404s a department the classification did not activate', async () => {
    const run = await startRun();
    const { status } = await json(`/api/runs/${run.id}/departments/46`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });
    expect(status).toBe(404);
  });

  it('404s an unknown run', async () => {
    const { status, body } = await json('/api/runs/nope');
    expect(status).toBe(404);
    expect(body['message']).toMatch(/No run nope is visible to this session/);
  });
});

describe('the gate, over HTTP', () => {
  it('grants FINAL when nothing is open', async () => {
    const run = await startRun();
    const { body } = await json(`/api/runs/${run.id}/finalize`, {
      method: 'POST', body: JSON.stringify({ proposed: 'FINAL' }),
    });
    expect(body['determination']).toBe('FINAL');
    expect(body['passed']).toBe(true);
  });

  /** The property the plan requires provable in the UI. */
  it('makes FINAL unreachable while a Major is open', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'i1', severity: 'Major', description: 'Tables have no behaviour below 768px.',
        tracedTo: [5], fix: 'Define a stacked layout.', status: 'open',
      }),
    });

    const { body } = await json(`/api/runs/${run.id}/finalize`, {
      method: 'POST', body: JSON.stringify({ proposed: 'FINAL' }),
    });
    expect(body['determination']).toBe('V1');
    expect(body['passed']).toBe(false);
    expect((body['blockers'] as unknown as string[])[0]).toMatch(/1 open Major/);

    const after = await json(`/api/runs/${run.id}`);
    expect((after.body['run'] as unknown as { status: string }).status).toBe('blocked');
  });

  it('refuses FINAL for a conflict resolved without saying what was lost', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/conflicts`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'c1', departments: [1, 2], description: 'Proof versus recession.',
        resolution: 'The measurement is the expression.',
      }),
    });
    const { body } = await json(`/api/runs/${run.id}/finalize`, {
      method: 'POST', body: JSON.stringify({ proposed: 'FINAL' }),
    });
    expect(body['passed']).toBe(false);
    expect((body['blockers'] as unknown as string[])[0]).toMatch(/not stating what was lost/);
  });
});

describe('rescore over HTTP', () => {
  it('applies a directed rescore and keeps the original', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });

    const { status, body } = await json(`/api/runs/${run.id}/rescore`, {
      method: 'POST',
      body: JSON.stringify({
        departmentId: 1, dimension: 'Distinctiveness', value: 5,
        justification: 'Rescored after the drift check flagged clustering.',
        directedBy: 'Arbitration', reason: 'Clustering in the 7-8 band.',
      }),
    });

    expect(status).toBe(200);
    const record = body['record'] as unknown as { fromValue: number; toValue: number };
    expect(record.toValue).toBe(5);
    expect(record.fromValue).not.toBe(5);

    const after = await json(`/api/runs/${run.id}`);
    expect((after.body['rescores'] as unknown as unknown[])).toHaveLength(1);
  });

  it('409s a rescore of a dimension the department never scored', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });
    const { status, body } = await json(`/api/runs/${run.id}/rescore`, {
      method: 'POST',
      body: JSON.stringify({
        departmentId: 1, dimension: 'Hierarchy Legibility', value: 5,
        justification: 'x', directedBy: 'Arbitration', reason: 'y',
      }),
    });
    expect(status).toBe(409);
    expect(body['message']).toMatch(/never scored/);
  });
});

describe('documents', () => {
  it('serves the internal document as markdown', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });
    const res = await fetch(`${base}/api/runs/${run.id}/document`, { headers: { cookie } });
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toContain('internal run document');
  });

  it('serves the DEVPOINT handoff pack', async () => {
    const run = await startRun();
    const text = await (await fetch(`${base}/api/runs/${run.id}/handoff`,
      { headers: { cookie } })).text();
    expect(text).toContain('DEVPOINT handoff');
    expect(text).toContain('| 429 |');
  });

  /** The client-summary gate, enforced at the edge as well as in the library. */
  it('409s a client summary for a run that is not FINAL, listing every reason', async () => {
    const run = await startRun();
    const { status, body } = await json(`/api/runs/${run.id}/summary`, {
      method: 'POST',
      body: JSON.stringify({ body: 'We rebuilt how Disan presents itself online.' }),
    });
    expect(status).toBe(409);
    expect(body['error']).toBe('summary_refused');
    expect((body['reasons'] as unknown as string[])[0]).toMatch(/not FINAL/);
  });

  it('generates the summary once the run is FINAL', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/finalize`, {
      method: 'POST', body: JSON.stringify({ proposed: 'FINAL' }),
    });
    const { status, body } = await json(`/api/runs/${run.id}/summary`, {
      method: 'POST',
      body: JSON.stringify({ body: 'We rebuilt how Disan presents itself online.' }),
    });
    expect(status).toBe(200);
    expect(body['wordCount']).toBe(7);
  });
});

describe('request handling', () => {
  it('rejects a body that is not JSON', async () => {
    const run = await startRun();
    const res = await fetch(`${base}/api/runs/${run.id}/issues`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { message: string }).message).toMatch(/not JSON/);
  });

  it('sets nosniff on every JSON response', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('echoes an allowed origin only', async () => {
    const allowed = new ApiServer({
      store: new RunStore(), rubric, origins: ['https://studio.example'],
    });
    const port = await allowed.listen(0);
    try {
      const ok = await fetch(`http://localhost:${port}/api/health`, {
        headers: { origin: 'https://studio.example' },
      });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://studio.example');

      const denied = await fetch(`http://localhost:${port}/api/health`, {
        headers: { origin: 'https://evil.example' },
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await allowed.close();
    }
  });
});

describe('SSE', () => {
  it('streams events for a run and replays what a reconnect missed', async () => {
    const run = await startRun();

    // Two events happen before anyone is listening — the run does not wait.
    await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });

    const res = await fetch(`${base}/api/runs/${run.id}/stream`, {
      headers: { cookie, 'last-event-id': '0' },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const reader = res.body?.getReader();
    const chunk = await reader?.read();
    const text = new TextDecoder().decode(chunk?.value);

    expect(text).toContain('event: run.started');
    expect(text).toContain('event: department.accepted');
    expect(text).toMatch(/^id: 1/m);
    await reader?.cancel();
  });

  it('replays only what a client has not seen', async () => {
    const run = await startRun();
    await json(`/api/runs/${run.id}/departments/1`, {
      method: 'POST', body: JSON.stringify({ submission: fullSubmission(1) }),
    });

    const res = await fetch(`${base}/api/runs/${run.id}/stream`, {
      headers: { cookie, 'last-event-id': '1' },
    });
    const reader = res.body?.getReader();
    const text = new TextDecoder().decode((await reader?.read())?.value);

    expect(text).not.toContain('event: run.started');
    expect(text).toContain('event: department.accepted');
    await reader?.cancel();
  });

  it('keeps a bounded history rather than a whole run in memory', async () => {
    const run = await startRun();
    for (let i = 0; i < 260; i++) server.events.emit(run.id, 'tick', { i });
    expect(server.events.eventsFor(run.id).length).toBeLessThanOrEqual(200);
  });
});

/* --------------------------------------------------------------------- auth */

describe('authentication', () => {
  it('refuses every protected endpoint without a session', async () => {
    const saved = cookie;
    cookie = '';
    for (const path of ['/api/runs', '/api/rubric', '/api/session']) {
      const { status, body } = await json(path);
      expect(status, path).toBe(401);
      expect(body['error']).toBe('unauthenticated');
    }
    cookie = saved;
  });

  it('leaves health public, so a first run can discover it needs setting up', async () => {
    const saved = cookie;
    cookie = '';
    const { status, body } = await json('/api/health');
    expect(status).toBe(200);
    expect(body['needsSetup']).toBe(false);
    cookie = saved;
  });

  it('reports the signed-in principal', async () => {
    const { status, body } = await json('/api/session');
    expect(status).toBe(200);
    expect(body['principal']).toMatchObject({ kind: 'studio', role: 'owner' });
  });

  it('sets an HttpOnly SameSite cookie, never a readable one', async () => {
    const store2 = new RunStore();
    const other = new ApiServer({ store: store2, rubric, insecureCookies: true });
    const otherBase = `http://localhost:${await other.listen(0)}`;
    const res = await fetch(`${otherBase}/api/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'a@b.c', password: 'a-long-enough-password' }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    await other.close();
  });

  it('refuses to set the studio up twice', async () => {
    const { status, body } = await json('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ name: 'B', email: 'b@c.d', password: 'a-long-enough-password' }),
    });
    expect(status).toBe(409);
    expect(body['error']).toBe('already_set_up');
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrong = await json('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', password: 'not-the-password' }),
    });
    const unknown = await json('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com', password: 'not-the-password' }),
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body['message']).toBe(unknown.body['message']);
  });

  it('ends the session on logout, and the cookie stops working', async () => {
    const { status } = await json('/api/session', { method: 'DELETE' });
    expect(status).toBe(200);
    const after = await json('/api/runs');
    expect(after.status).toBe(401);
  });

  it('refuses a forged cookie', async () => {
    const saved = cookie;
    cookie = 'edsai_session=not-a-real-token';
    expect((await json('/api/runs')).status).toBe(401);
    cookie = saved;
  });
});

describe('CSRF', () => {
  it('refuses a state-changing request from an unknown origin', async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example' },
      body: JSON.stringify({ brief: 'x' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('bad_origin');
  });

  it('refuses a form-encoded POST with no origin, which is what a cross-site form sends', async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: 'brief=x',
    });
    expect(res.status).toBe(403);
  });

  it('allows a GET from anywhere, which changes nothing', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
  });
});

describe('client isolation over HTTP', () => {
  /** Sign in as a portal user for one client, by writing the session directly. */
  const portalCookie = (clientId: string): string => {
    const token = 'portal-token-for-' + clientId;
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'portal-user', kind: 'portal', clientId, role: 'editor',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    return `edsai_session=${token}`;
  };

  it('hides another client’s run from the list', async () => {
    const run = await startRun();
    const saved = cookie;
    cookie = portalCookie('someone-else');
    const { body } = await json('/api/runs');
    expect((body['runs'] as unknown as unknown[])).toEqual([]);
    cookie = saved;
    expect(run.id).toBeTruthy();
  });

  it('404s another client’s run even when its id is known', async () => {
    const run = await startRun();
    const saved = cookie;
    cookie = portalCookie('someone-else');
    const { status } = await json(`/api/runs/${run.id}`);
    expect(status).toBe(404);
    cookie = saved;
  });

  it('404s every sub-resource of another client’s run, not only the run itself', async () => {
    const run = await startRun();
    const saved = cookie;
    cookie = portalCookie('someone-else');
    for (const path of ['', '/document', '/handoff', '/next']) {
      const res = await fetch(`${base}/api/runs/${run.id}${path}`, { headers: { cookie } });
      expect(res.status, path).toBe(404);
    }
    cookie = saved;
  });

  it('lets the client who owns the run see it', async () => {
    const run = await startRun();
    const saved = cookie;
    cookie = portalCookie('c-test');
    const { status } = await json(`/api/runs/${run.id}`);
    expect(status).toBe(200);
    cookie = saved;
  });
});

describe('clients', () => {
  it('creates a client and derives a portal-safe address from its name', async () => {
    const { status, body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: "Disan's Footwear", industry: 'Footwear' }),
    });
    expect(status).toBe(201);
    expect(body['slug']).toBe('disan-s-footwear');
    expect(body['status']).toBe('prospect');
  });

  it('gives a second client of the same name a distinct address', async () => {
    await json('/api/clients', { method: 'POST', body: JSON.stringify({ name: 'Acme' }) });
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Acme' }),
    });
    expect(body['slug']).toBe('acme-2');
  });

  it('refuses a name that produces no usable address', async () => {
    const { status } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: '!!!' }),
    });
    expect(status).toBe(400);
  });

  it('refuses a client with no name', async () => {
    expect((await json('/api/clients', { method: 'POST', body: '{}' })).status).toBe(400);
  });

  it('counts projects and contacts alongside each client', async () => {
    const created = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Morrow Coffee' }),
    });
    const id = created.body['id'] as unknown as string;
    await json(`/api/clients/${id}/contacts`, {
      method: 'POST', body: JSON.stringify({ name: 'A Person', decisionMaker: true }),
    });
    await json(`/api/clients/${id}/projects`, {
      method: 'POST', body: JSON.stringify({ name: 'Rebrand' }),
    });

    const { body } = await json('/api/clients');
    const client = (body['clients'] as unknown as { id: string; contacts: number; projects: number }[])
      .find((c) => c.id === id);
    expect(client).toMatchObject({ contacts: 1, projects: 1 });
  });

  it('serves a client with its contacts, projects and runs', async () => {
    const created = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Atlas Sports' }),
    });
    const id = created.body['id'] as unknown as string;
    const { status, body } = await json(`/api/clients/${id}`);
    expect(status).toBe(200);
    expect(body['client']).toMatchObject({ name: 'Atlas Sports' });
    expect(body['contacts']).toEqual([]);
    expect(body['runs']).toEqual([]);
  });

  it('404s a client that does not exist', async () => {
    expect((await json('/api/clients/client-nope')).status).toBe(404);
  });

  it('refuses a contact on a client this session cannot see', async () => {
    const created = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Private Co' }),
    });
    const id = created.body['id'] as unknown as string;

    const saved = cookie;
    const token = 'portal-token-elsewhere';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId: 'client-elsewhere', role: 'editor',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;

    const { status } = await json(`/api/clients/${id}/contacts`, {
      method: 'POST', body: JSON.stringify({ name: 'Intruder' }),
    });
    expect(status).toBe(404);
    cookie = saved;

    // And nothing was written.
    const { body } = await json(`/api/clients/${id}`);
    expect(body['contacts']).toEqual([]);
  });
});

describe('the first-run window', () => {
  it('creates exactly one owner under concurrent setup requests', async () => {
    // `hashPassword` is deliberately slow, which leaves a wide window between
    // "is anyone set up?" and the write. Without a second check after the await,
    // several requests all pass the first one and each writes an owner.
    const fresh = new RunStore();
    const server2 = new ApiServer({ store: fresh, rubric, insecureCookies: true });
    const base2 = `http://localhost:${await server2.listen(0)}`;

    const attempt = (n: number) => fetch(`${base2}/api/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Owner ${n}`, email: `owner${n}@example.com`, password: 'a-long-enough-password',
      }),
    });

    const results = await Promise.all([1, 2, 3, 4].map(attempt));
    const created = results.filter((r) => r.status === 201);

    expect(created).toHaveLength(1);
    expect(fresh.countUsers()).toBe(1);
    await server2.close();
  });

  it('reports that setup is needed before anyone exists, and not after', async () => {
    const fresh = new RunStore();
    const server2 = new ApiServer({ store: fresh, rubric, insecureCookies: true });
    const base2 = `http://localhost:${await server2.listen(0)}`;

    const needs = async (): Promise<boolean> =>
      ((await (await fetch(`${base2}/api/health`)).json()) as { needsSetup: boolean }).needsSetup;

    expect(await needs()).toBe(true);
    await fetch(`${base2}/api/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'a@b.c', password: 'a-long-enough-password' }),
    });
    expect(await needs()).toBe(false);
    await server2.close();
  });
});

describe('onboarding', () => {
  const newClient = async (name = 'Disan Footwear') => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    return body['id'] as unknown as string;
  };

  const invite = async (clientId: string) => {
    const { body } = await json(`/api/clients/${clientId}/onboarding`, { method: 'POST' });
    return {
      token: (body['invite'] as unknown as { token: string }).token,
      onboardingId: (body['onboarding'] as unknown as { id: string }).id,
    };
  };

  /** Answer everything the catalog requires, through the public endpoint. */
  const answerEverything = async (token: string) => {
    const { body } = await json(`/api/onboard/${token}`);
    const questions = body['questions'] as unknown as {
      id: string; kind: string; required: boolean; take?: number;
      options?: { id: string }[];
    }[];
    for (const q of questions.filter((x) => x.required)) {
      const value = q.kind === 'text' ? 'An answer that means something.'
        : q.kind === 'scale' ? 3
          : q.kind === 'ratio' ? { side: 'a', strength: 'clearly' }
            : q.kind === 'binary' ? q.options?.[0]?.id
              : (q.options ?? []).slice(0, q.take || 1).map((o) => o.id);
      await json(`/api/onboard/${token}`, {
        method: 'POST', body: JSON.stringify({ questionId: q.id, value }),
      });
    }
  };

  it('issues an invite the studio sees exactly once', async () => {
    const clientId = await newClient();
    const { status, body } = await json(`/api/clients/${clientId}/onboarding`, { method: 'POST' });
    expect(status).toBe(201);
    expect((body['invite'] as unknown as { path: string }).path).toMatch(/^\/onboard\/.+/);

    // The token is not retrievable afterwards — only its digest was kept.
    const list = await json(`/api/clients/${clientId}/onboarding`);
    expect(JSON.stringify(list.body)).not.toContain(
      (body['invite'] as unknown as { token: string }).token);
  });

  it('opens the form for the client without any session at all', async () => {
    const clientId = await newClient();
    const { token } = await invite(clientId);

    const saved = cookie;
    cookie = '';
    const { status, body } = await json(`/api/onboard/${token}`);
    expect(status).toBe(200);
    expect(body['clientName']).toBe('Disan Footwear');
    expect((body['questions'] as unknown as unknown[]).length).toBeGreaterThan(10);
    cookie = saved;
  });

  it('exposes nothing about the client but their name', async () => {
    const clientId = await newClient();
    const { token } = await invite(clientId);
    const saved = cookie;
    cookie = '';
    const { body } = await json(`/api/onboard/${token}`);
    const text = JSON.stringify(body);
    expect(text).not.toContain(clientId);
    expect(body['notes']).toBeUndefined();
    cookie = saved;
  });

  it('refuses an invented token', async () => {
    const saved = cookie;
    cookie = '';
    expect((await json('/api/onboard/not-a-real-token')).status).toBe(404);
    cookie = saved;
  });

  it('refuses an answer that does not fit its question', async () => {
    const { token } = await invite(await newClient());
    const saved = cookie;
    cookie = '';
    const { status } = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'e2', value: 99 }),
    });
    expect(status).toBe(400);
    cookie = saved;
  });

  it('refuses an answer to a question that does not exist', async () => {
    const { token } = await invite(await newClient());
    const { status } = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'drop-tables', value: 'x' }),
    });
    expect(status).toBe(400);
  });

  it('tracks progress as answers arrive', async () => {
    const { token } = await invite(await newClient());
    const first = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'f-what', value: 'We make boots.' }),
    });
    expect((first.body['progress'] as unknown as { answered: number }).answered).toBe(1);
  });

  it('refuses to submit while anything required is unanswered', async () => {
    const { token } = await invite(await newClient());
    const { status, body } = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ submit: true }),
    });
    expect(status).toBe(400);
    expect(body['error']).toBe('incomplete');
  });

  it('submits once everything required is answered, and reaches eight axes', async () => {
    const { token } = await invite(await newClient());
    await answerEverything(token);
    const { status, body } = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ submit: true }),
    });
    expect(status).toBe(200);
    expect(body['status']).toBe('submitted');
    expect((body['progress'] as unknown as { axesDecided: number }).axesDecided).toBe(8);
  });

  it('becomes a project the studio did not have to type', async () => {
    const clientId = await newClient();
    const { token, onboardingId } = await invite(clientId);
    await answerEverything(token);
    await json(`/api/onboard/${token}`, { method: 'POST', body: JSON.stringify({ submit: true }) });

    const { status, body } = await json(`/api/onboarding/${onboardingId}/accept`, { method: 'POST' });
    expect(status).toBe(201);
    const project = body['project'] as unknown as { clientId: string; notes: string };
    expect(project.clientId).toBe(clientId);
    expect(project.notes).toContain('An answer that means something');
    expect(project.notes).toContain('leaves those three for the studio');
  });

  it('will not accept an onboarding that was never submitted', async () => {
    const clientId = await newClient();
    const { onboardingId } = await invite(clientId);
    const { status, body } = await json(`/api/onboarding/${onboardingId}/accept`, { method: 'POST' });
    expect(status).toBe(409);
    expect(body['error']).toBe('not_submitted');
  });

  it('kills the link once the answers are accepted', async () => {
    const clientId = await newClient();
    const { token, onboardingId } = await invite(clientId);
    await answerEverything(token);
    await json(`/api/onboard/${token}`, { method: 'POST', body: JSON.stringify({ submit: true }) });
    await json(`/api/onboarding/${onboardingId}/accept`, { method: 'POST' });

    const saved = cookie;
    cookie = '';
    expect((await json(`/api/onboard/${token}`)).status).toBe(404);
    cookie = saved;
  });

  it('keeps one client’s invite away from another client’s onboarding', async () => {
    const a = await newClient('Client A');
    const b = await newClient('Client B');
    const inviteA = await invite(a);
    const inviteB = await invite(b);

    const saved = cookie;
    cookie = '';
    const openedA = await json(`/api/onboard/${inviteA.token}`);
    const openedB = await json(`/api/onboard/${inviteB.token}`);
    expect(openedA.body['clientName']).toBe('Client A');
    expect(openedB.body['clientName']).toBe('Client B');
    cookie = saved;
  });

  it('does not let a portal session for one client accept another’s onboarding', async () => {
    const a = await newClient('Client A');
    const { onboardingId } = await invite(a);

    const saved = cookie;
    const token = 'portal-other-client';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId: 'client-elsewhere', role: 'owner',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;
    expect((await json(`/api/onboarding/${onboardingId}/accept`, { method: 'POST' })).status)
      .toBe(404);
    cookie = saved;
  });
});

describe('an onboarding closes when it is submitted', () => {
  const complete = async () => {
    const { body: created } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Freeze Co' }),
    });
    const clientId = created['id'] as unknown as string;
    const { body } = await json(`/api/clients/${clientId}/onboarding`, { method: 'POST' });
    const token = (body['invite'] as unknown as { token: string }).token;

    const form = await json(`/api/onboard/${token}`);
    const questions = form.body['questions'] as unknown as {
      id: string; kind: string; required: boolean; take?: number; options?: { id: string }[];
    }[];
    for (const q of questions.filter((x) => x.required)) {
      const value = q.kind === 'text' ? 'The answer the studio will read.'
        : q.kind === 'scale' ? 3
          : q.kind === 'ratio' ? { side: 'a', strength: 'clearly' }
            : q.kind === 'binary' ? q.options?.[0]?.id
              : (q.options ?? []).slice(0, q.take || 1).map((o) => o.id);
      await json(`/api/onboard/${token}`, {
        method: 'POST', body: JSON.stringify({ questionId: q.id, value }),
      });
    }
    await json(`/api/onboard/${token}`, { method: 'POST', body: JSON.stringify({ submit: true }) });
    return { token, clientId };
  };

  it('refuses an edit after submission', async () => {
    const { token } = await complete();
    const { status, body } = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'f-what', value: 'CHANGED' }),
    });
    expect(status).toBe(409);
    expect(body['message']).toContain('reopen');
  });

  it('keeps the answers the studio will actually read', async () => {
    const { token } = await complete();
    await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'f-what', value: 'CHANGED' }),
    });
    const { body } = await json(`/api/onboard/${token}`);
    const answers = body['answers'] as unknown as { questionId: string; value: unknown }[];
    expect(answers.find((a) => a.questionId === 'f-what')?.value)
      .toBe('The answer the studio will read.');
  });

  it('still lets a client edit before they submit', async () => {
    const { body: created } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Open Co' }),
    });
    const { body } = await json(`/api/clients/${created['id'] as unknown as string}/onboarding`, {
      method: 'POST',
    });
    const token = (body['invite'] as unknown as { token: string }).token;
    await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'f-what', value: 'first go' }),
    });
    const second = await json(`/api/onboard/${token}`, {
      method: 'POST', body: JSON.stringify({ questionId: 'f-what', value: 'second go' }),
    });
    expect(second.status).toBe(200);
  });
});
