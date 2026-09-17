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

beforeEach(async () => {
  server = new ApiServer({ store: new RunStore(), rubric, scopeId: 'no-motion-authoring' });
  base = `http://localhost:${await server.listen(0)}`;
});
afterEach(async () => { await server.close(); });

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json() as Record<string, never> };
};

const startRun = async () => {
  const { body } = await json('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 'Disan Footwear', level: 1,
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
    expect(body['message']).toMatch(/no such run/);
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
    const res = await fetch(`${base}/api/runs/${run.id}/document`);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toContain('internal run document');
  });

  it('serves the DEVPOINT handoff pack', async () => {
    const run = await startRun();
    const text = await (await fetch(`${base}/api/runs/${run.id}/handoff`)).text();
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
      headers: { 'last-event-id': '0' },
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
      headers: { 'last-event-id': '1' },
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
