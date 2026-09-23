import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { RunStore } from '@edsai/engine';
import { digestToken, SignInAttempts } from '@edsai/auth';
import { ApiServer, newId } from '../src/server.js';

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

  it('says plainly, on both health and the run itself, that nothing will execute without a model', async () => {
    const health = await json('/api/health');
    expect(health.body['executionEnabled']).toBe(false);

    const run = await startRun();
    const { status, body } = await json(`/api/runs/${run.id}/execute`, { method: 'POST' });
    expect(status).toBe(503);
    expect(body['error']).toBe('no_executor');
    expect(body['message']).toMatch(/Automated execution/);
  });
});

describe('process overrides', () => {
  it('excludes a department from every run started while the override is set', async () => {
    const before = await startRun();
    const toExclude = before.activatedDepartments[0] as number;

    const patched = await json(`/api/process-overrides/${toExclude}`, {
      method: 'PATCH', body: JSON.stringify({ state: 'excluded' }),
    });
    expect(patched.status).toBe(200);

    const after = await startRun();
    expect(after.activatedDepartments).not.toContain(toExclude);
  });

  it('requires a reason to reduce a department', async () => {
    const { status, body } = await json('/api/process-overrides/7', {
      method: 'PATCH', body: JSON.stringify({ state: 'reduced' }),
    });
    expect(status).toBe(400);
    expect(body['message']).toMatch(/reason/);
  });

  it('refuses an unknown department number', async () => {
    const { status } = await json('/api/process-overrides/9999', {
      method: 'PATCH', body: JSON.stringify({ state: 'excluded' }),
    });
    expect(status).toBe(404);
  });

  it('deleting an override lets the department run normally again', async () => {
    const before = await startRun();
    const toExclude = before.activatedDepartments[0] as number;
    await json(`/api/process-overrides/${toExclude}`, {
      method: 'PATCH', body: JSON.stringify({ state: 'excluded' }),
    });
    await json(`/api/process-overrides/${toExclude}`, { method: 'DELETE' });

    const after = await startRun();
    expect(after.activatedDepartments).toContain(toExclude);
  });

  it('a portal session sees none of it and cannot write', async () => {
    const saved = cookie;
    const token = 'portal-process-check';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId: 'client-elsewhere', role: 'owner',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;
    expect((await json('/api/process-overrides')).body['overrides']).toEqual([]);
    expect((await json('/api/process-overrides/7', {
      method: 'PATCH', body: JSON.stringify({ state: 'excluded' }),
    })).status).toBe(403);
    cookie = saved;
  });
});

describe('runs, continued', () => {
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
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: 'not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { message: string }).message).toMatch(/not JSON/);
  });

  it('refuses a session-less request before it reads the body at all', async () => {
    // Ordering, not cosmetics: the body is read after the session is resolved,
    // so an unauthenticated caller cannot make this server buffer an upload.
    const run = await startRun();
    const res = await fetch(`${base}/api/runs/${run.id}/issues`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    });
    expect(res.status).toBe(401);
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
    const other = new ApiServer({ store, rubric, insecureCookies: true });
    const otherBase = `http://localhost:${await other.listen(0)}`;
    const unknownResponse = await fetch(`${otherBase}/api/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'not-the-password' }),
    });
    const unknown = {
      status: unknownResponse.status,
      body: await unknownResponse.json() as Record<string, unknown>,
    };
    await other.close();
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body['message']).toBe(unknown.body['message']);
  });

  it('holds a second failed sign-in from the same address, even with another email', async () => {
    const request = (email: string) => fetch(`${base}/api/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'not-the-password' }),
    });

    const first = await request('owner@example.com');
    expect(first.status).toBe(401);
    expect(first.headers.get('retry-after')).toBe('60');

    const second = await request('someone@example.com');
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('60');
  });

  it('reserves setup and sign-in for the configured owner email', async () => {
    const fresh = new RunStore();
    let now = 0;
    const server2 = new ApiServer({
      store: fresh, rubric, insecureCookies: true, signInAllow: ['owner@example.com'],
      signInAttempts: new SignInAttempts(() => now),
    });
    const base2 = `http://localhost:${await server2.listen(0)}`;
    const post = (path: string, body: unknown) => fetch(`${base2}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    const rejectedSetup = await post('/api/setup', {
      name: 'Other', email: 'other@example.com', password: 'a-long-enough-password',
    });
    expect(rejectedSetup.status).toBe(401);
    expect(fresh.countUsers()).toBe(0);
    now += 60_000;

    const ownerSetup = await post('/api/setup', {
      name: 'Owner', email: 'OWNER@example.com', password: 'a-long-enough-password',
    });
    expect(ownerSetup.status).toBe(201);

    const ownerSignIn = await post('/api/session', {
      email: 'owner@example.com', password: 'a-long-enough-password',
    });
    expect(ownerSignIn.status).toBe(200);

    const rejectedSignIn = await post('/api/session', {
      email: 'someone@example.com', password: 'a-long-enough-password',
    });
    expect(rejectedSignIn.status).toBe(401);
    await server2.close();
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

  describe('the studio-wide index', () => {
    it('lists every client’s onboarding in one read, with progress and a client name', async () => {
      const a = await newClient('Client A');
      const b = await newClient('Client B');
      await invite(a);
      await invite(b);

      const { body } = await json('/api/onboardings');
      const onboardings = body['onboardings'] as unknown as
        { clientId: string; clientName: string; progress?: { percent: number } }[];
      const names = onboardings.map((o) => o.clientName);
      expect(names).toContain('Client A');
      expect(names).toContain('Client B');
      expect(onboardings.every((o) => o.progress)).toBe(true);
    });

    it('shows a portal session only its own client’s onboarding, never another’s', async () => {
      const a = await newClient('Client A');
      const b = await newClient('Client B');
      await invite(a);
      await invite(b);

      const saved = cookie;
      const token = 'portal-a-only';
      const { createHash } = await import('node:crypto');
      store.saveSession({
        digest: createHash('sha256').update(token).digest('hex'),
        userId: 'p', kind: 'portal', clientId: a, role: 'owner',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      cookie = `edsai_session=${token}`;
      const { body } = await json('/api/onboardings');
      const onboardings = body['onboardings'] as unknown as { clientId: string }[];
      expect(onboardings.every((o) => o.clientId === a)).toBe(true);
      expect(onboardings.length).toBeGreaterThan(0);
      cookie = saved;
    });
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

describe('the brand system', () => {
  const brandClient = async () => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Brand Co' }),
    });
    const clientId = body['id'] as unknown as string;
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'paper', kind: 'color', value: '#FFFFFF', role: 'primary surface' }),
    });
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ink', kind: 'color', value: '#16181C', role: 'body text' }),
    });
    return clientId;
  };

  it('measures a value the moment it is created', async () => {
    const clientId = await brandClient();
    const { body } = await json(`/api/clients/${clientId}/brand`);
    const ink = (body['values'] as unknown as { name: string; measured: { ratio: number; passes: boolean } }[])
      .find((v) => v.name === 'ink');
    expect(ink?.measured.passes).toBe(true);
    expect(ink?.measured.ratio).toBeGreaterThan(15);
  });

  it('saves an edit that still passes without asking anything', async () => {
    const clientId = await brandClient();
    const { status, body } = await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: '#222222' }),
    });
    expect(status).toBe(200);
    expect(body['regressed']).toBe(false);
    expect((body['measured'] as unknown as { passes: boolean }).passes).toBe(true);
  });

  it('re-measures on save, so an edited value still carries a real number', async () => {
    const clientId = await brandClient();
    const { body } = await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: '#767676' }),
    });
    const measured = body['measured'] as unknown as { ratio: number; against: string };
    expect(measured.ratio).toBeCloseTo(4.54, 1);
    expect(measured.against).toBe('paper');
  });

  it('asks why before letting an edit break something', async () => {
    const clientId = await brandClient();
    const { status, body } = await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: '#CCCCCC' }),
    });
    expect(status).toBe(422);
    expect(body['error']).toBe('needs-reason');
    expect(body['message']).toContain('a decision rather than an accident');
  });

  it('accepts the same edit once the reason is there', async () => {
    const clientId = await brandClient();
    const { status, body } = await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH',
      body: JSON.stringify({ value: '#CCCCCC', reason: 'Placeholder until the client picks a grey.' }),
    });
    expect(status).toBe(200);
    expect(body['regressed']).toBe(true);
  });

  it('leaves the value untouched when an edit is refused', async () => {
    const clientId = await brandClient();
    await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: '#CCCCCC' }),
    });
    const { body } = await json(`/api/clients/${clientId}/brand`);
    const ink = (body['values'] as unknown as { name: string; value: string }[])
      .find((v) => v.name === 'ink');
    expect(ink?.value).toBe('#16181C');
  });

  it('refuses a value no renderer could use', async () => {
    const clientId = await brandClient();
    const { status } = await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: 'dark-ish' }),
    });
    expect(status).toBe(400);
  });

  it('404s a value that is not in the brand', async () => {
    const clientId = await brandClient();
    expect((await json(`/api/clients/${clientId}/brand/nonexistent`, {
      method: 'PATCH', body: JSON.stringify({ value: '#000000' }),
    })).status).toBe(404);
  });

  it('seeds from a run and never overwrites an edit', async () => {
    const clientId = await brandClient();
    // A run under this client, carrying a token that collides with `ink`.
    const { projectId } = seedProject(clientId, 'p-brand');
    const run = await json('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ projectId, level: 1, brief: 'A brief for the brand.' }),
    });
    const runId = run.body['id'] as unknown as string;
    store.saveOutput({
      runId, departmentId: 1, body: 'Palette.', scores: [], targets: [],
      tokens: [
        { name: 'ink', kind: 'color', value: '#000000' },
        { name: 'signal', kind: 'color', value: '#EB5E28', role: 'accent' },
      ],
      compositions: [], decisions: [], instrumentCalls: [],
      completedAt: new Date().toISOString(),
    });

    await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: '#101010' }),
    });

    const { status, body } = await json(`/api/clients/${clientId}/brand/seed`, {
      method: 'POST', body: JSON.stringify({ runId }),
    });
    expect(status).toBe(201);
    expect(body['seeded']).toBe(1);

    const after = await json(`/api/clients/${clientId}/brand`);
    const values = after.body['values'] as unknown as { name: string; value: string }[];
    expect(values.find((v) => v.name === 'ink')?.value).toBe('#101010');
    expect(values.find((v) => v.name === 'signal')?.value).toBe('#EB5E28');
  });

  it('will not seed from another client’s run', async () => {
    const a = await brandClient();
    const { projectId } = seedProject('c-other', 'p-other');
    const run = await json('/api/runs', {
      method: 'POST', body: JSON.stringify({ projectId, level: 1, brief: 'Elsewhere.' }),
    });
    const { status } = await json(`/api/clients/${a}/brand/seed`, {
      method: 'POST', body: JSON.stringify({ runId: run.body['id'] }),
    });
    expect(status).toBe(404);
  });

  it('keeps one client’s brand away from another session', async () => {
    const clientId = await brandClient();
    const saved = cookie;
    const token = 'portal-brand-other';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId: 'client-elsewhere', role: 'owner',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;
    expect((await json(`/api/clients/${clientId}/brand`)).status).toBe(404);
    cookie = saved;
  });
});

describe('brand value names', () => {
  const freshClient = async (name: string) => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    return body['id'] as unknown as string;
  };

  it('refuses a name that would leave nothing to put in a URL', async () => {
    // Stored raw, such a value could never be edited: the edit route matches
    // [\w-]+ and would 404 on it forever.
    const clientId = await freshClient('Name Co');
    const { status, body } = await json(`/api/clients/${clientId}/brand`, {
      method: 'POST', body: JSON.stringify({ name: '!!!', kind: 'color', value: '#000000' }),
    });
    expect(status).toBe(400);
    expect(body['message']).toContain('no usable name');
  });

  it('makes every accepted name editable afterwards', async () => {
    const clientId = await freshClient('Editable Co');
    const created = await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Brand/Primary Ink', kind: 'color', value: '#111111' }),
    });
    const name = (created.body['value'] as unknown as { name: string }).name;
    expect(name).toBe('brand-primary-ink');
    const edited = await json(`/api/clients/${clientId}/brand/${name}`, {
      method: 'PATCH', body: JSON.stringify({ value: '#222222' }),
    });
    expect(edited.status).toBe(200);
  });

  it('removes a value, and says so when there is nothing by that name to remove', async () => {
    // Editing is re-measured and can be refused; removing is the way back
    // out of a value added by mistake, which nothing offered before.
    const clientId = await freshClient('Removable Co');
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST', body: JSON.stringify({ name: 'ink', kind: 'color', value: '#111111' }),
    });

    const gone = await json(`/api/clients/${clientId}/brand/ink`, { method: 'DELETE' });
    expect(gone.status).toBe(200);
    expect((await json(`/api/clients/${clientId}/brand`)).body['values']).toEqual([]);

    const again = await json(`/api/clients/${clientId}/brand/ink`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });

  it('refuses to create over an existing value rather than overwriting it', async () => {
    const clientId = await freshClient('Collide Co');
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'paper', kind: 'color', value: '#FFFFFF', role: 'surface' }),
    });
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ink', kind: 'color', value: '#16181C', role: 'body text' }),
    });
    await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH',
      body: JSON.stringify({ value: '#CCCCCC', reason: 'A deliberate, recorded decision.' }),
    });

    const { status, body } = await json(`/api/clients/${clientId}/brand`, {
      method: 'POST', body: JSON.stringify({ name: 'ink', kind: 'color', value: '#999999' }),
    });
    expect(status).toBe(409);
    expect(body['message']).toContain('Edit it instead');
  });

  it('keeps the recorded reason when a collision is refused', async () => {
    const clientId = await freshClient('Keep Co');
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'paper', kind: 'color', value: '#FFFFFF', role: 'surface' }),
    });
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ink', kind: 'color', value: '#16181C', role: 'body text' }),
    });
    await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH',
      body: JSON.stringify({ value: '#CCCCCC', reason: 'A deliberate, recorded decision.' }),
    });
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST', body: JSON.stringify({ name: 'ink', kind: 'color', value: '#999999' }),
    });

    const { body } = await json(`/api/clients/${clientId}/brand`);
    const ink = (body['values'] as unknown as { name: string; value: string; reason?: string }[])
      .find((v) => v.name === 'ink');
    expect(ink?.value).toBe('#CCCCCC');
    expect(ink?.reason).toBe('A deliberate, recorded decision.');
  });
});

describe('assets', () => {
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

  const assetClient = async (name = 'Asset Co') => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    return body['id'] as unknown as string;
  };

  const upload = async (clientId: string, opts: {
    bytes?: Buffer; filename?: string; type?: string; collection?: string; cookieOverride?: string;
  } = {}) => {
    const res = await fetch(`${base}/api/clients/${clientId}/assets`, {
      method: 'POST',
      headers: {
        'content-type': opts.type ?? 'image/png',
        'x-filename': opts.filename ?? 'logo.png',
        ...(opts.collection ? { 'x-collection': opts.collection } : {}),
        cookie: opts.cookieOverride ?? cookie,
      },
      body: opts.bytes ?? PNG,
    });
    return { status: res.status, body: await res.json() as Record<string, never> };
  };

  it('stores an upload under the hash of its bytes, not its name', async () => {
    const clientId = await assetClient();
    const { status, body } = await upload(clientId);
    expect(status).toBe(201);
    const asset = body['asset'] as unknown as { digest: string; filename: string; bytes: number };
    expect(asset.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.filename).toBe('logo.png');
    expect(asset.bytes).toBe(PNG.byteLength);
  });

  it('treats a traversal filename as a label, never a path', async () => {
    const clientId = await assetClient();
    const { body } = await upload(clientId, { filename: '../../etc/passwd' });
    const asset = body['asset'] as unknown as { filename: string; digest: string };
    expect(asset.filename).not.toContain('/');
    expect(asset.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unapproved on arrival, so nothing reaches a client by forgetting', async () => {
    const clientId = await assetClient();
    const { body } = await upload(clientId);
    expect((body['asset'] as unknown as { approved: boolean }).approved).toBe(false);
  });

  it('refuses an empty upload', async () => {
    const clientId = await assetClient();
    expect((await upload(clientId, { bytes: Buffer.alloc(0) })).status).toBe(400);
  });

  it('serves a real image inline and an HTML upload as a download', async () => {
    const clientId = await assetClient();
    const image = await upload(clientId, { filename: 'a.png', type: 'image/png' });
    const html = await upload(clientId, {
      filename: 'payload.html', type: 'text/html', bytes: Buffer.from('<script>alert(1)</script>'),
    });
    const id = (r: typeof image) => (r.body['asset'] as unknown as { id: string }).id;

    for (const asset of [image, html]) {
      await json(`/api/assets/${id(asset)}`, {
        method: 'PATCH', body: JSON.stringify({ approved: true }),
      });
    }

    const imageRes = await fetch(`${base}/api/assets/${id(image)}/download`, { headers: { cookie } });
    expect(imageRes.headers.get('content-type')).toBe('image/png');
    expect(imageRes.headers.get('content-disposition')).toContain('inline');

    const htmlRes = await fetch(`${base}/api/assets/${id(html)}/download`, { headers: { cookie } });
    // The attack this closes: an uploaded page executing on the portal's origin.
    expect(htmlRes.headers.get('content-type')).toBe('application/octet-stream');
    expect(htmlRes.headers.get('content-disposition')).toContain('attachment');
    expect(htmlRes.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns the exact bytes that went in', async () => {
    const clientId = await assetClient();
    const { body } = await upload(clientId, { bytes: Buffer.from('precise contents') });
    const id = (body['asset'] as unknown as { id: string }).id;
    const res = await fetch(`${base}/api/assets/${id}/download`, { headers: { cookie } });
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('precise contents');
  });

  it('keeps two records for the same bytes under different names', async () => {
    // Found in a browser, not here: three uploads of one image collapsed into
    // a single row, and the portal showed the last one — an unapproved draft —
    // under the approval the studio had granted the file it replaced.
    const clientId = await assetClient();
    const same = Buffer.from('one image, two names');
    const first = await upload(clientId, { bytes: same, filename: 'logo.png' });
    const second = await upload(clientId, { bytes: same, filename: 'draft.png' });

    const one = first.body['asset'] as unknown as { id: string; digest: string };
    const two = second.body['asset'] as unknown as { id: string; digest: string };
    expect(one.id).not.toBe(two.id);
    // Storage still dedupes: two records, one file.
    expect(one.digest).toBe(two.digest);

    const listed = await json(`/api/clients/${clientId}/assets`);
    const names = (listed.body['assets'] as unknown as { filename: string }[])
      .map((a) => a.filename).sort();
    expect(names).toEqual(['draft.png', 'logo.png']);
  });

  it('approving one record leaves the other alone', async () => {
    const clientId = await assetClient();
    const same = Buffer.from('shared bytes');
    const live = await upload(clientId, { bytes: same, filename: 'released.png' });
    const draft = await upload(clientId, { bytes: same, filename: 'held-back.png' });
    const id = (r: typeof live) => (r.body['asset'] as unknown as { id: string }).id;

    await json(`/api/assets/${id(live)}`, {
      method: 'PATCH', body: JSON.stringify({ approved: true }),
    });

    const listed = await json(`/api/clients/${clientId}/assets`);
    const byName = Object.fromEntries(
      (listed.body['assets'] as unknown as { filename: string; approved: boolean }[])
        .map((a) => [a.filename, a.approved]),
    );
    expect(byName).toEqual({ 'released.png': true, 'held-back.png': false });
  });

  it('stores one copy when the same file is uploaded twice', async () => {
    const clientId = await assetClient();
    const first = await upload(clientId, { bytes: Buffer.from('identical') });
    const second = await upload(clientId, { bytes: Buffer.from('identical'), filename: 'other.png' });
    expect((first.body['asset'] as unknown as { digest: string }).digest)
      .toBe((second.body['asset'] as unknown as { digest: string }).digest);
  });

  it('refuses a file over the limit', async () => {
    const clientId = await assetClient();
    const huge = Buffer.alloc(26 * 1024 * 1024);
    const res = await fetch(`${base}/api/clients/${clientId}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-filename': 'huge.png', cookie },
      body: huge,
    }).catch(() => undefined);
    expect(res === undefined || res.status === 413).toBe(true);
  });

  it('hides an unapproved file from the client it belongs to', async () => {
    const clientId = await assetClient();
    const { body } = await upload(clientId);
    const id = (body['asset'] as unknown as { id: string }).id;

    const saved = cookie;
    const token = 'portal-assets';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId, role: 'viewer',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;

    expect((await json(`/api/clients/${clientId}/assets`)).body['assets']).toEqual([]);
    expect((await fetch(`${base}/api/assets/${id}/download`, { headers: { cookie } })).status)
      .toBe(404);

    // Approve it as the studio, and the same client can now fetch it.
    cookie = saved;
    await json(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ approved: true }) });
    cookie = `edsai_session=${token}`;
    expect((await fetch(`${base}/api/assets/${id}/download`, { headers: { cookie } })).status)
      .toBe(200);
    cookie = saved;
  });

  it('keeps one client’s files away from another client', async () => {
    const mine = await assetClient('Mine');
    const { body } = await upload(mine);
    const id = (body['asset'] as unknown as { id: string }).id;
    await json(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ approved: true }) });

    const saved = cookie;
    const token = 'portal-other-assets';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId: 'client-elsewhere', role: 'owner',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;
    expect((await fetch(`${base}/api/assets/${id}/download`, { headers: { cookie } })).status)
      .toBe(404);
    cookie = saved;
  });

  it('needs a session at all', async () => {
    const clientId = await assetClient();
    const { body } = await upload(clientId);
    const id = (body['asset'] as unknown as { id: string }).id;
    const res = await fetch(`${base}/api/assets/${id}/download`);
    expect(res.status).toBe(401);
  });

  it('clearing the collection field puts a file back in Unfiled, not a collection called "download"', async () => {
    // `safeFilename` — reused here to sanitize a collection name — falls back
    // to the literal string "download" for an empty input, since that is the
    // right default for a *file*. Editing a file with no collection and
    // saving without typing one must not silently file it under "download".
    const clientId = await assetClient();
    const uploaded = await upload(clientId, { filename: 'clean.png', collection: 'Drafts' });
    const id = (uploaded.body['asset'] as unknown as { id: string }).id;
    expect((uploaded.body['asset'] as unknown as { collection?: string }).collection).toBe('Drafts');

    const cleared = await json(`/api/assets/${id}`, {
      method: 'PATCH', body: JSON.stringify({ collection: '' }),
    });
    expect(cleared.body['asset']).not.toHaveProperty('collection');
  });

  it('can be re-kinded — e.g. marked as a template after the fact', async () => {
    const clientId = await assetClient();
    const { body } = await upload(clientId, { filename: 'deck-shell.png' });
    const id = (body['asset'] as unknown as { id: string }).id;
    expect((body['asset'] as unknown as { kind: string }).kind).toBe('photography');

    const patched = await json(`/api/assets/${id}`, {
      method: 'PATCH', body: JSON.stringify({ kind: 'template' }),
    });
    expect((patched.body['asset'] as unknown as { kind: string }).kind).toBe('template');
  });
});

describe('record ids', () => {
  it('are distinct within one millisecond', () => {
    // The whole id used to be `Date.now().toString(36)`. A thousand calls span
    // a millisecond or two, so under that scheme this loop produced about two
    // distinct ids — and two onboardings issued back to back shared a row,
    // which meant both clients' invites opened the first client's form.
    //
    // Asserted here rather than through two HTTP requests on purpose: whether
    // two requests land in the same millisecond is the machine's mood, and a
    // regression test that depends on it is a test that stops noticing.
    const ids = new Set(Array.from({ length: 1000 }, () => newId('onb')));
    expect(ids.size).toBe(1000);
  });

  it('still sort roughly by age, which is the point of the timestamp', () => {
    const first = newId('onb');
    const later = newId('onb');
    expect(first <= later || first.slice(0, 12) === later.slice(0, 12)).toBe(true);
  });
});

describe('portal keys', () => {
  const client = async (name = 'Key Co') => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    return body['id'] as unknown as string;
  };

  const issue = async (clientId: string, input: Record<string, unknown> = {}) =>
    json(`/api/clients/${clientId}/portal-keys`, {
      method: 'POST', body: JSON.stringify({ label: 'Ada at Morrow', ...input }),
    });

  /** Redeem a link and return the portal session cookie it mints. */
  const enter = async (token: string): Promise<string> => {
    const res = await fetch(`${base}/api/portal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  };

  const tokenOf = (body: Record<string, never>): string =>
    (body['link'] as unknown as { token: string }).token;

  it('lists every client’s live links in one read, without ever exposing a digest', async () => {
    const a = await client('Link Co A');
    const b = await client('Link Co B');
    await issue(a, { label: 'Ada at A' });
    await issue(b, { label: 'Bo at B' });

    const { status, body } = await json('/api/portal-keys');
    expect(status).toBe(200);
    const keys = body['keys'] as unknown as { label: string; clientId: string; id: string }[];
    expect(keys.map((k) => k.label).sort()).toEqual(['Ada at A', 'Bo at B']);
    expect(keys.map((k) => k.clientId).sort()).toEqual([a, b].sort());
    // The id is a 12-char prefix, never the digest the server stores.
    expect(keys.every((k) => k.id.length === 12)).toBe(true);
    expect(JSON.stringify(keys)).not.toContain('digest');
  });

  it('shows a portal session none of the studio-wide link list', async () => {
    // A client holding a link must not be able to enumerate anyone's links,
    // including their own — issuing and listing are the studio's.
    const id = await client('Enumerate Co');
    const { body } = await issue(id);
    const saved = cookie;
    cookie = await enter(tokenOf(body));
    expect((await json('/api/portal-keys')).body['keys']).toEqual([]);
    cookie = saved;
  });

  it('shows the one-time access code exactly once and never again', async () => {
    const id = await client();
    const { status, body } = await issue(id);
    expect(status).toBe(201);
    expect(tokenOf(body)).toMatch(/^[a-z]+(?:-[a-z]+){4}-\d{12}$/);
    expect(body['accessCode']).toBe(tokenOf(body));

    const listed = await json(`/api/clients/${id}/portal-keys`);
    const keys = listed.body['keys'] as unknown as Record<string, unknown>[];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ label: 'Ada at Morrow', role: 'viewer', uses: 0 });
    // The token is not recoverable, and neither is the digest it is stored as.
    expect(JSON.stringify(keys)).not.toContain(tokenOf(body));
    expect(keys[0]).not.toHaveProperty('digest');
  });

  it('mints a portal session bound to the client that issued it', async () => {
    const id = await client();
    const { body } = await issue(id);
    const portalCookie = await enter(tokenOf(body));

    const res = await fetch(`${base}/api/session`, { headers: { cookie: portalCookie } });
    expect((await res.json() as { principal: { kind: string; clientId: string } }).principal)
      .toMatchObject({ kind: 'portal', clientId: id });
  });

  it('redeems a one-time access code only once', async () => {
    const id = await client();
    const { body } = await issue(id);
    const token = tokenOf(body);
    await enter(token);

    const repeated = await fetch(`${base}/api/portal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(repeated.status).toBe(401);

    const listed = await json(`/api/clients/${id}/portal-keys`);
    const keys = listed.body['keys'] as unknown as {
      uses: number; lastUsedAt?: string; singleUse: boolean;
    }[];
    expect(keys[0]?.uses).toBe(1);
    expect(keys[0]?.lastUsedAt).toBeTruthy();
    expect(keys[0]?.singleUse).toBe(true);
  });

  it('stops working the moment it is revoked', async () => {
    const id = await client();
    const { body } = await issue(id);
    const token = tokenOf(body);
    await enter(token);

    const listed = await json(`/api/clients/${id}/portal-keys`);
    const keyId = (listed.body['keys'] as unknown as { id: string }[])[0]?.id;
    const revoked = await json(`/api/clients/${id}/portal-keys/${keyId}`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);

    const res = await fetch(`${base}/api/portal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(401);
  });

  it('ends the session a revoked link had already opened', async () => {
    // "Withdraw" has to mean now. Deleting the key alone stops new entries and
    // leaves every browser already inside working until its session expires,
    // which is not what the studio was promised when they clicked it.
    const id = await client();
    const { body } = await issue(id);
    const portalCookie = await enter(tokenOf(body));

    const before = await fetch(`${base}/api/session`, { headers: { cookie: portalCookie } });
    expect(before.status).toBe(200);

    const listed = await json(`/api/clients/${id}/portal-keys`);
    const keyId = (listed.body['keys'] as unknown as { id: string }[])[0]?.id;
    await json(`/api/clients/${id}/portal-keys/${keyId}`, { method: 'DELETE' });

    const after = await fetch(`${base}/api/session`, { headers: { cookie: portalCookie } });
    expect(after.status).toBe(401);
  });

  it('leaves another link’s session alone when one is revoked', async () => {
    const id = await client();
    const doomed = await issue(id, { label: 'Leaving' });
    const kept = await issue(id, { label: 'Staying' });
    const keptCookie = await enter(tokenOf(kept.body));
    await enter(tokenOf(doomed.body));

    const listed = await json(`/api/clients/${id}/portal-keys`);
    const keys = listed.body['keys'] as unknown as { id: string; label: string }[];
    const target = keys.find((k) => k.label === 'Leaving');
    await json(`/api/clients/${id}/portal-keys/${target?.id}`, { method: 'DELETE' });

    const res = await fetch(`${base}/api/session`, { headers: { cookie: keptCookie } });
    expect(res.status).toBe(200);
  });

  it('refuses a link that expired, without saying which it was', async () => {
    const id = await client();
    const { body } = await issue(id, { days: 1 });
    // Re-save the same key with an expiry in the past. Waiting a day is not a
    // test, and the store's upsert is the honest way to move it.
    store.savePortalKey({
      digest: digestToken(tokenOf(body)),
      clientId: id, label: 'Ada at Morrow', role: 'viewer',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await fetch(`${base}/api/portal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tokenOf(body) }),
    });
    expect(res.status).toBe(401);
    const message = (await res.json() as { message: string }).message;
    expect(message).toMatch(/expired or been revoked/);
  });

  it('refuses a nonsense token the same way as a revoked one', async () => {
    const res = await fetch(`${base}/api/portal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-token' }),
    });
    expect(res.status).toBe(401);
  });

  it('will not issue a limited link that opens nothing', async () => {
    const id = await client();
    const { status } = await issue(id, { role: 'limited', collections: [] });
    expect(status).toBe(400);
  });

  it('carries the granted collections onto the session, and only those', async () => {
    const id = await client();
    const { body } = await issue(id, { role: 'limited', collections: ['logos'] });
    const portalCookie = await enter(tokenOf(body));

    const res = await fetch(`${base}/api/session`, { headers: { cookie: portalCookie } });
    const principal = (await res.json() as { principal: Record<string, unknown> }).principal;
    expect(principal).toMatchObject({ role: 'limited', collections: ['logos'] });
  });

  it('never issues a link that can issue links', async () => {
    const id = await client();
    // `owner` is not offered; asking for it lands on the default rather than
    // minting a credential that reproduces itself.
    const { body } = await issue(id, { role: 'owner' });
    expect((body['key'] as unknown as { role: string }).role).toBe('viewer');
  });

  it('refuses a portal session trying to issue its own link', async () => {
    const id = await client();
    const { body } = await issue(id);
    const portalCookie = await enter(tokenOf(body));

    const res = await fetch(`${base}/api/clients/${id}/portal-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: portalCookie },
      body: JSON.stringify({ label: 'Myself, wider' }),
    });
    expect(res.status).toBe(403);
  });

  it('will not let one client revoke another client’s link', async () => {
    const mine = await client('Mine');
    const theirs = await client('Theirs');
    const { body } = await issue(theirs);
    const listed = await json(`/api/clients/${theirs}/portal-keys`);
    const keyId = (listed.body['keys'] as unknown as { id: string }[])[0]?.id;

    const res = await json(`/api/clients/${mine}/portal-keys/${keyId}`, { method: 'DELETE' });
    expect(res.status).toBe(404);

    // And the link still works.
    await enter(tokenOf(body));
  });
});

describe('the portal', () => {
  /** A client with one approved file, one draft, and a brand colour. */
  const furnished = async () => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Morrow' }),
    });
    const clientId = body['id'] as unknown as string;

    const put = async (filename: string, approved: boolean, collection?: string) => {
      const res = await fetch(`${base}/api/clients/${clientId}/assets`, {
        method: 'POST',
        headers: {
          'content-type': 'image/png', 'x-filename': filename, cookie,
          ...(collection ? { 'x-collection': collection } : {}),
        },
        body: Buffer.from(`bytes of ${filename}`),
      });
      const asset = (await res.json() as { asset: { id: string } }).asset;
      if (approved) {
        await json(`/api/assets/${asset.id}`, {
          method: 'PATCH', body: JSON.stringify({ approved: true }),
        });
      }
      return asset.id;
    };

    const live = await put('morrow-logo.png', true, 'Logos');
    const draft = await put('draft-wordmark.png', false, 'Logos');
    const photo = await put('shoot.png', true, 'Photography');

    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'paper', kind: 'color', value: '#FFFFFF', role: 'Page' }),
    });
    await json(`/api/clients/${clientId}/brand`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ink', kind: 'color', value: '#1A1A1A', role: 'Body text' }),
    });

    return { clientId, live, draft, photo };
  };

  const link = async (clientId: string, input: Record<string, unknown> = {}) => {
    const { body } = await json(`/api/clients/${clientId}/portal-keys`, {
      method: 'POST', body: JSON.stringify({ label: 'Ada', ...input }),
    });
    return (body['link'] as unknown as { token: string }).token;
  };

  /** Follow a portal link exactly as a browser would, and keep the cookie. */
  const open = async (token: string) => {
    const entered = await fetch(`${base}/portal/enter/${token}`, { redirect: 'manual' });
    expect(entered.status).toBe(303);
    expect(entered.headers.get('location')).toBe('/portal');
    const portalCookie = (entered.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const page = await fetch(`${base}/portal`, { headers: { cookie: portalCookie } });
    return { status: page.status, html: await page.text(), cookie: portalCookie };
  };

  it('shows a client their approved files and not their drafts', async () => {
    const { clientId } = await furnished();
    const { status, html } = await open(await link(clientId));
    expect(status).toBe(200);
    expect(html).toContain('morrow-logo.png');
    expect(html).toContain('shoot.png');
    expect(html).not.toContain('draft-wordmark.png');
  });

  it('gives every file a working download, from the portal itself', async () => {
    const { clientId, live } = await furnished();
    const { html, cookie: portalCookie } = await open(await link(clientId));
    expect(html).toContain(`/api/assets/${live}/download`);

    // The link on the page, followed with the session the page was served to.
    const file = await fetch(`${base}/api/assets/${live}/download`,
      { headers: { cookie: portalCookie } });
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('bytes of morrow-logo.png');
  });

  it('carries the brand, measured, without the studio’s working notes', async () => {
    const { clientId } = await furnished();

    // Change a value the way a designer would, with a recorded reason. The
    // reason is the studio's record of a decision, not the client's reference.
    const REASON = 'Lightened for the new packaging stock.';
    await json(`/api/clients/${clientId}/brand/ink`, {
      method: 'PATCH', body: JSON.stringify({ value: '#333333', reason: REASON }),
    });

    const { html } = await open(await link(clientId));
    expect(html).toContain('#333333');
    expect(html).toContain('Body text');
    // Asserted against the exact text that exists rather than a bare word like
    // "origin", which the page's own copy script contains inside `var original`
    // — an assertion that passes for the wrong reason is worse than none.
    expect(html).not.toContain(REASON);
    expect(html).not.toContain('sourceRunId');
  });

  it('opens on day one, before any run has finished', async () => {
    // The hub refuses anything the gate has not cleared. The portal cannot:
    // there are files to send long before a brand system is FINAL.
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Brand New' }),
    });
    const clientId = body['id'] as unknown as string;
    const { status, html } = await open(await link(clientId));
    expect(status).toBe(200);
    expect(html).toContain('Brand New');
    expect(html).toContain('Nothing has been shared with you yet');
  });

  it('holds a limited link to its own collections', async () => {
    const { clientId } = await furnished();
    const { html } = await open(await link(clientId, {
      role: 'limited', collections: ['Logos'],
    }));
    expect(html).toContain('morrow-logo.png');
    expect(html).not.toContain('shoot.png');
    // And it can still name whose portal it is.
    expect(html).toContain('Morrow');
  });

  it('shows one client nothing of another’s, even mid-session', async () => {
    const mine = await furnished();
    const theirs = await furnished();
    const { cookie: portalCookie } = await open(await link(mine.clientId));

    const res = await fetch(`${base}/api/assets/${theirs.live}/download`,
      { headers: { cookie: portalCookie } });
    expect(res.status).toBe(404);
  });

  it('tells a lapsed visitor what happened instead of returning JSON', async () => {
    const res = await fetch(`${base}/portal`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('This link has expired');
  });

  it('never leaves the token in the address bar', async () => {
    const { clientId } = await furnished();
    const token = await link(clientId);
    const entered = await fetch(`${base}/portal/enter/${token}`, { redirect: 'manual' });
    // The redirect target carries no token, and the page that follows sends no
    // referrer anywhere.
    expect(entered.headers.get('location')).not.toContain(token);

    const page = await fetch(`${base}/portal`, {
      headers: { cookie: (entered.headers.get('set-cookie') ?? '').split(';')[0] ?? '' },
    });
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('refuses to be framed and to load anything third-party', async () => {
    const { clientId } = await furnished();
    const { cookie: portalCookie } = await open(await link(clientId));
    const page = await fetch(`${base}/portal`, { headers: { cookie: portalCookie } });
    const csp = page.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('escapes a hostile filename rather than rendering it', async () => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Hostile' }),
    });
    const clientId = body['id'] as unknown as string;
    const res = await fetch(`${base}/api/clients/${clientId}/assets`, {
      method: 'POST',
      headers: {
        'content-type': 'image/png', cookie,
        'x-filename': encodeURIComponent('<img src=x onerror=alert(1)>.png'),
      },
      body: Buffer.from('png'),
    });
    const asset = (await res.json() as { asset: { id: string } }).asset;
    await json(`/api/assets/${asset.id}`, {
      method: 'PATCH', body: JSON.stringify({ approved: true }),
    });

    const { html } = await open(await link(clientId));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('answers the browser’s automatic favicon request silently', async () => {
    // Found in a browser: a JSON 404 put a red line in the console of a page
    // whose whole claim is that it is the client's copy of record.
    const res = await fetch(`${base}/favicon.ico`);
    expect(res.status).toBe(204);
  });

  it('sends a designer to the studio rather than an arbitrary client', async () => {
    const res = await fetch(`${base}/portal`, { headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('This is the client side');
  });
});

describe('listing projects', () => {
  it('lists every project the session can see, so a run can name one', async () => {
    // A run is refused unless it names a project that exists. Without this
    // route the only way to learn a project id was to open its client, so the
    // form that starts a run asked for something a person could not know.
    const { body: a } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'One' }),
    });
    const { body: b } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Two' }),
    });
    await json(`/api/clients/${a['id']}/projects`, {
      method: 'POST', body: JSON.stringify({ name: 'Rebrand' }),
    });
    await json(`/api/clients/${b['id']}/projects`, {
      method: 'POST', body: JSON.stringify({ name: 'Packaging' }),
    });

    const { status, body } = await json('/api/projects');
    expect(status).toBe(200);
    const projects = body['projects'] as unknown as { name: string; clientId: string }[];
    expect(projects.map((p) => p.name).sort()).toEqual(
      expect.arrayContaining(['Packaging', 'Rebrand']),
    );
    // And each one carries the client it belongs to, which is what lets the
    // form group them by client rather than showing a flat list of names.
    expect(projects.every((p) => typeof p.clientId === 'string' && p.clientId)).toBe(true);
  });

  it('starts a run against a project id the listing gave out', async () => {
    const { body: client } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Runnable' }),
    });
    const { body: project } = await json(`/api/clients/${client['id']}/projects`, {
      method: 'POST', body: JSON.stringify({ name: 'Identity' }),
    });
    const listed = await json('/api/projects');
    const found = (listed.body['projects'] as unknown as { id: string }[])
      .find((p) => p.id === (project['id'] as unknown as string));
    expect(found).toBeTruthy();

    const { status } = await json('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ projectId: found?.id, level: 1, brief: '## Explicit\nA test.' }),
    });
    expect(status).toBe(201);
  });
});

describe('the positioning chart', () => {
  /** A client who has been through discovery, with real answers stored. */
  const answered = async (name = 'Plotted Co') => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    const clientId = body['id'] as unknown as string;
    const invited = await json(`/api/clients/${clientId}/onboarding`, { method: 'POST' });
    const token = (invited.body['invite'] as unknown as { token: string }).token;

    const saved = cookie;
    cookie = '';
    // Answered as the client would: through the public capability link.
    for (const [questionId, value] of [
      ['e2', 4], ['e3', 2],
      ['e4', { side: 'a', strength: 'overwhelmingly' }],
      ['e6', { side: 'b', strength: 'clearly' }],
    ] as const) {
      await json(`/api/onboard/${token}`, {
        method: 'POST', body: JSON.stringify({ questionId, value }),
      });
    }
    cookie = saved;
    return clientId;
  };

  it('computes the client’s own point from their answers, not from the caller', async () => {
    const clientId = await answered();
    const { status, body } = await json(`/api/clients/${clientId}/positioning?x=E4&y=E6`);
    expect(status).toBe(200);
    const matrix = body['matrix'] as unknown as {
      points: { label: string; x: number; y: number; source: string; evidence?: { x: string; y: string } }[];
    };
    expect(matrix.points).toHaveLength(1);
    expect(matrix.points[0]).toMatchObject({ id: 'brand', label: 'Plotted Co', x: 15, y: 70, source: 'computed' });
    // The point carries the two sentences that put it there.
    expect(matrix.points[0]?.evidence?.x).toBeTruthy();
    expect(matrix.points[0]?.evidence?.y).toBeTruthy();
  });

  it('will not take a position for the client from the request', async () => {
    // The whole claim is that this point is computed. A caller who could pass
    // it would be drawing the chart themselves.
    const clientId = await answered();
    const { body } = await json(`/api/clients/${clientId}/positioning?x=E4&y=E6&brandX=99&brandY=1`);
    const matrix = body['matrix'] as unknown as { points: { x: number; y: number }[] };
    expect(matrix.points[0]).toMatchObject({ x: 15, y: 70 });
  });

  it('places a comparator and marks it as placed rather than computed', async () => {
    const clientId = await answered();
    const created = await json(`/api/clients/${clientId}/comparators`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Rival', note: 'The one they hate', positions: { E4: 80, E6: 20 } }),
    });
    expect(created.status).toBe(201);

    const { body } = await json(`/api/clients/${clientId}/positioning?x=E4&y=E6`);
    const matrix = body['matrix'] as unknown as { points: { label: string; source: string }[] };
    expect(matrix.points.map((p) => [p.label, p.source])).toEqual([
      ['Plotted Co', 'computed'], ['Rival', 'placed'],
    ]);
  });

  it('refuses an axis it does not have, rather than inventing one', async () => {
    const clientId = await answered();
    const { status } = await json(`/api/clients/${clientId}/comparators`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Nowhere', positions: { E4: 50, MADE_UP: 50 } }),
    });
    // Only one usable axis survived, and one position is not a point.
    expect(status).toBe(400);
  });

  it('clamps a position that would sit off the chart', async () => {
    const clientId = await answered();
    const { body } = await json(`/api/clients/${clientId}/comparators`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Extreme', positions: { E4: 900, E6: -40 } }),
    });
    expect((body['comparator'] as unknown as { positions: Record<string, number> }).positions)
      .toEqual({ E4: 100, E6: 0 });
  });

  it('refuses two of the same axis', async () => {
    const clientId = await answered();
    const { status } = await json(`/api/clients/${clientId}/positioning?x=E4&y=E4`);
    expect(status).toBe(400);
  });

  it('leaves a client with no answers off their own chart', async () => {
    const { body } = await json('/api/clients', {
      method: 'POST', body: JSON.stringify({ name: 'Never Asked' }),
    });
    const clientId = body['id'] as unknown as string;
    await json(`/api/clients/${clientId}/comparators`, {
      method: 'POST', body: JSON.stringify({ name: 'Rival', positions: { E4: 30, E6: 70 } }),
    });

    const chart = await json(`/api/clients/${clientId}/positioning?x=E4&y=E6`);
    const matrix = chart.body['matrix'] as unknown as { points: { label: string }[] };
    // The competitor is there; the client is not, because nothing measured them.
    expect(matrix.points.map((p) => p.label)).toEqual(['Rival']);
    expect(chart.body['answersFrom']).toBe('none');
  });

  it('charts a client who is still answering, and says the answers are not final', async () => {
    // A gate on submission would leave this chart blank until the last
    // question, which hides decisions that have already been made. A missing
    // answer already drops its own axis, so nothing here is invented.
    const clientId = await answered('Mid Flow');
    const { body } = await json(`/api/clients/${clientId}/positioning?x=E4&y=E6`);
    expect(body['answersFrom']).toBe('in-progress');
    const matrix = body['matrix'] as unknown as { points: { label: string }[] };
    expect(matrix.points.map((p) => p.label)).toEqual(['Mid Flow']);
  });

  it('leaves out an axis the client has not reached yet', async () => {
    const clientId = await answered('Mid Flow');
    // E5 and E7 were never answered, so nobody appears on that chart.
    const { body } = await json(`/api/clients/${clientId}/positioning?x=E5&y=E7`);
    const matrix = body['matrix'] as unknown as {
      points: unknown[]; unanswered: string[];
    };
    expect(matrix.points).toEqual([]);
    expect(matrix.unanswered).toEqual(['E5', 'E7']);
  });

  it('removes a placed brand', async () => {
    const clientId = await answered();
    const created = await json(`/api/clients/${clientId}/comparators`, {
      method: 'POST', body: JSON.stringify({ name: 'Gone Soon', positions: { E4: 10, E6: 90 } }),
    });
    const id = (created.body['comparator'] as unknown as { id: string }).id;
    expect((await json(`/api/comparators/${id}`, { method: 'DELETE' })).status).toBe(200);

    const { body } = await json(`/api/clients/${clientId}/comparators`);
    expect(body['comparators']).toEqual([]);
  });

  it('keeps one client’s comparators away from another client', async () => {
    const mine = await answered('Mine');
    const theirs = await answered('Theirs');
    await json(`/api/clients/${theirs}/comparators`, {
      method: 'POST', body: JSON.stringify({ name: 'Secret', positions: { E4: 10, E6: 90 } }),
    });

    const { body } = await json(`/api/clients/${mine}/comparators`);
    expect(body['comparators']).toEqual([]);
  });
});

describe('support notes', () => {
  it('adds one, edits it, resolves it, and lists it back', async () => {
    const created = await json('/api/support', {
      method: 'POST', body: JSON.stringify({ kind: 'bug', body: 'Sidebar overlaps on narrow screens.' }),
    });
    expect(created.status).toBe(201);
    const note = created.body['note'] as unknown as { id: string; status: string };
    expect(note.status).toBe('open');

    const edited = await json(`/api/support/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: 'Sidebar overlaps below 900px.' }),
    });
    expect((edited.body['note'] as unknown as { body: string }).body).toBe('Sidebar overlaps below 900px.');

    const resolved = await json(`/api/support/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'resolved' }),
    });
    const resolvedNote = resolved.body['note'] as unknown as { status: string; resolvedAt?: string };
    expect(resolvedNote.status).toBe('resolved');
    expect(resolvedNote.resolvedAt).toBeTruthy();

    const list = await json('/api/support');
    expect((list.body['notes'] as unknown as unknown[]).length).toBe(1);
  });

  it('reopening clears the resolved timestamp', async () => {
    const created = await json('/api/support', {
      method: 'POST', body: JSON.stringify({ kind: 'idea', body: 'Dark mode.' }),
    });
    const id = (created.body['note'] as unknown as { id: string }).id;
    await json(`/api/support/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
    const reopened = await json(`/api/support/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'open' }),
    });
    expect(reopened.body['note']).not.toHaveProperty('resolvedAt');
  });

  it('deletes one', async () => {
    const created = await json('/api/support', {
      method: 'POST', body: JSON.stringify({ kind: 'question', body: 'Why 1440px?' }),
    });
    const id = (created.body['note'] as unknown as { id: string }).id;
    expect((await json(`/api/support/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await json('/api/support')).body['notes']).toEqual([]);
  });

  it('a portal session sees none of it', async () => {
    await json('/api/support', {
      method: 'POST', body: JSON.stringify({ kind: 'bug', body: 'Studio-only.' }),
    });

    const saved = cookie;
    const token = 'portal-support-check';
    const { createHash } = await import('node:crypto');
    store.saveSession({
      digest: createHash('sha256').update(token).digest('hex'),
      userId: 'p', kind: 'portal', clientId: 'client-elsewhere', role: 'owner',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    cookie = `edsai_session=${token}`;
    expect((await json('/api/support')).body['notes']).toEqual([]);
    expect((await json('/api/support', {
      method: 'POST', body: JSON.stringify({ kind: 'bug', body: 'Should be refused.' }),
    })).status).toBe(403);
    cookie = saved;
  });
});

describe('the Brand Hub, over the wire', () => {
  const client = async (name: string) => {
    const { body } = await json('/api/clients', { method: 'POST', body: JSON.stringify({ name }) });
    return body['id'] as unknown as string;
  };
  const enter = async (token: string): Promise<string> => {
    const res = await fetch(`${base}/api/portal/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  };
  const portalCookie = async (clientId: string, role = 'editor'): Promise<string> => {
    const { body } = await json(`/api/clients/${clientId}/portal-keys`, {
      method: 'POST', body: JSON.stringify({ label: 'Ada', role }),
    });
    return enter((body['link'] as unknown as { token: string }).token);
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64',
  );
  const approvedPattern = async (clientId: string): Promise<string> => {
    const res = await fetch(`${base}/api/clients/${clientId}/assets`, {
      method: 'POST', headers: { cookie, 'content-type': 'image/png', 'x-filename': 'dot.png' }, body: png,
    });
    const asset = (await res.json() as { asset: { id: string } }).asset;
    await json(`/api/assets/${asset.id}`, { method: 'PATCH', body: JSON.stringify({ kind: 'pattern', approved: true }) });
    return asset.id;
  };
  const configuration = (assetId: string) => ({
    assetId, scale: 120, spacing: 10, rotation: 15, opacity: 0.9, tint: '#eb5e28',
    background: '#14161a', offsetX: 0, offsetY: 0,
  });

  it('is off for every client until the studio sets it up', async () => {
    const id = await client('Plain Co');
    const { body } = await json(`/api/clients/${id}/brand-hub`);
    expect(body['enabled']).toBe(false);
    expect(body['hub']).toBeUndefined();
    // A portal for that client is told nothing more than "no".
    const saved = cookie;
    cookie = await portalCookie(id);
    const seen = await json(`/api/clients/${id}/brand-hub`);
    expect(seen.body).toMatchObject({ enabled: false, tools: [] });
    cookie = saved;
  });

  it('only the studio switches it on, and only built tools can be offered', async () => {
    const id = await client('Hub Co');
    const saved = cookie;
    cookie = await portalCookie(id);
    const refused = await json(`/api/clients/${id}/brand-hub`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) });
    expect(refused.status).toBe(403);
    cookie = saved;
    const { body } = await json(`/api/clients/${id}/brand-hub`, {
      method: 'PUT', body: JSON.stringify({ status: 'active', tools: ['pattern-studio', 'poster', 'nonsense'] }),
    });
    expect(body['enabled']).toBe(true);
    expect((body['hub'] as unknown as { tools: string[] }).tools).toEqual(['pattern-studio', 'poster']);
  });

  it('lets a client save, reopen and delete a design, and never another client’s', async () => {
    const a = await client('Maker Co');
    const b = await client('Other Co');
    const pattern = await approvedPattern(a);
    const foreign = await approvedPattern(b);
    await json(`/api/clients/${a}/brand-hub`, { method: 'PUT', body: JSON.stringify({ status: 'active', tools: ['pattern-studio'] }) });
    await json(`/api/clients/${b}/brand-hub`, { method: 'PUT', body: JSON.stringify({ status: 'active', tools: ['pattern-studio'] }) });

    const saved = cookie;
    cookie = await portalCookie(a);
    const created = await json(`/api/clients/${a}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'pattern-studio', name: 'Wrap', configuration: configuration(pattern) }),
    });
    expect(created.status).toBe(201);
    const project = created.body['project'] as unknown as { id: string; configuration: { rotation: number } };
    expect(project.configuration.rotation).toBe(15);

    // A design may not point at another client's file, even an approved one.
    const stolen = await json(`/api/clients/${a}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'pattern-studio', name: 'Theirs', configuration: configuration(foreign) }),
    });
    expect(stolen.status).toBe(400);

    // The other client sees nothing of it. (Keys are issued by the studio.)
    cookie = saved;
    cookie = await portalCookie(b);
    expect((await json(`/api/clients/${a}/brand-projects`)).status).toBe(404);
    expect((await json(`/api/brand-projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Mine now' }) })).status).toBe(404);
    expect((await json(`/api/brand-projects/${project.id}`, { method: 'DELETE' })).status).toBe(404);

    // Back as the owner: reopen, edit, delete.
    cookie = saved;
    cookie = await portalCookie(a);
    const list = await json(`/api/clients/${a}/brand-projects`);
    expect((list.body['projects'] as unknown as unknown[]).length).toBe(1);
    const edited = await json(`/api/brand-projects/${project.id}`, {
      method: 'PUT', body: JSON.stringify({ configuration: { ...configuration(pattern), rotation: 45 } }),
    });
    expect((edited.body['project'] as unknown as { configuration: { rotation: number } }).configuration.rotation).toBe(45);
    expect((await json(`/api/brand-projects/${project.id}`, { method: 'DELETE' })).status).toBe(200);
    cookie = saved;
  });

  it('checks every file a scene or a post refers to, not just the first', async () => {
    const a = await client('Scene Co');
    const b = await client('Elsewhere Co');
    const mine = await approvedPattern(a);
    const theirs = await approvedPattern(b);
    await json(`/api/clients/${a}/brand-hub`, { method: 'PUT', body: JSON.stringify({ status: 'active', tools: ['illustration-builder', 'social-post'] }) });
    const saved = cookie;
    cookie = await portalCookie(a);
    const layer = (assetId: string) => ({ assetId, x: 0.5, y: 0.5, scale: 1, rotation: 0, flip: false, tint: '' });
    const ok = await json(`/api/clients/${a}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'illustration-builder', name: 'Scene',
        configuration: { background: '#ffffff', layers: [layer(mine), layer(mine)] } }),
    });
    expect(ok.status).toBe(201);
    const smuggled = await json(`/api/clients/${a}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'illustration-builder', name: 'Scene',
        configuration: { background: '#ffffff', layers: [layer(mine), layer(theirs)] } }),
    });
    expect(smuggled.status).toBe(400);
    const post = await json(`/api/clients/${a}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'social-post', name: 'Post', configuration: {
        templateAssetId: '', photoAssetId: theirs, logoAssetId: '', headline: 'Hi', body: '', cta: '',
        layout: 'bottom', align: 'left', logoCorner: 'none', background: '#ffffff', textColor: '#000000',
        accent: '#eb5e28', scrim: 0.3 } }),
    });
    expect(post.status).toBe(400);
    // A tool the hub does not offer is refused even though it exists.
    const notOffered = await json(`/api/clients/${a}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'poster', name: 'P', configuration: {} }),
    });
    expect(notOffered.status).toBe(400);
    cookie = saved;
  });

  it('closes the tools the moment the hub is suspended', async () => {
    const id = await client('Paused Co');
    const pattern = await approvedPattern(id);
    await json(`/api/clients/${id}/brand-hub`, { method: 'PUT', body: JSON.stringify({ status: 'active', tools: ['pattern-studio'] }) });
    await json(`/api/clients/${id}/brand-hub`, { method: 'PUT', body: JSON.stringify({ status: 'suspended' }) });
    const saved = cookie;
    cookie = await portalCookie(id);
    expect((await json(`/api/clients/${id}/brand-hub`)).body['enabled']).toBe(false);
    const refused = await json(`/api/clients/${id}/brand-projects`, {
      method: 'POST', body: JSON.stringify({ toolId: 'pattern-studio', name: 'Wrap', configuration: configuration(pattern) }),
    });
    expect(refused.status).toBe(404);
    cookie = saved;
  });
});
