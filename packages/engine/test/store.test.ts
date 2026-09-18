import { describe, expect, it } from 'vitest';
import { RunStore } from '../src/store.js';
import type { DepartmentOutput, Run } from '../src/types.js';

/**
 * The provenance invariant, tested at the one place every write passes through.
 *
 * `verifyTargets` is the real rule and is tested in `verify.test.ts`. This is
 * the weaker structural statement underneath it: a stored record that claims a
 * measurement must at least name an instrument the same record says was called.
 * It exists so that a write path added later cannot skip `accept` and put a
 * self-contradicting record in front of a client.
 *
 * Both branches are exercised. A check only ever run on the passing case is the
 * failure mode this repository has now recorded three times in `notes/gaps.md`.
 */

const run: Run = {
  id: 'r1',
  projectId: 'p',
  clientId: 'client-test',
  brief: 'A brief.',
  level: 1,
  tracks: ['brand'],
  scopeId: 'full',
  activatedDepartments: [5],
  version: 'V1',
  status: 'running',
  startedAt: '2026-09-01T00:00:00.000Z',
};

const output = (over: Partial<DepartmentOutput> = {}): DepartmentOutput => ({
  runId: 'r1',
  departmentId: 5,
  body: 'Reasoning.',
  scores: [],
  targets: [],
  tokens: [],
  compositions: [],
  decisions: [],
  instrumentCalls: [],
  completedAt: '2026-09-02T00:00:00.000Z',
  ...over,
});

const measured = {
  discipline: 'Department 5',
  metric: 'Ink on paper',
  target: '4.5:1',
  actual: '7.04:1',
  source: 'instrument' as const,
  instrument: 'contrast',
  pass: true,
  tokens: [],
};

function store(): RunStore {
  const created = new RunStore();
  created.saveRun(run);
  return created;
}

describe('saveOutput provenance invariant', () => {
  it('stores a measurement whose instrument the output lists as called', () => {
    const db = store();
    db.saveOutput(output({ targets: [measured], instrumentCalls: ['contrast'] }));
    expect(db.getOutput('r1', 5)?.targets[0]?.actual).toBe('7.04:1');
    db.close();
  });

  it('refuses a measurement crediting an instrument the output never called', () => {
    const db = store();
    expect(() => db.saveOutput(output({ targets: [measured], instrumentCalls: [] })))
      .toThrow(/credits contrast, which this output does not list as called/);
    db.close();
  });

  it('names what was called, so the contradiction is readable', () => {
    const db = store();
    expect(() => db.saveOutput(output({
      targets: [measured], instrumentCalls: ['type_scale', 'spacing_audit'],
    }))).toThrow(/Called: type_scale, spacing_audit/);
    db.close();
  });

  it('refuses a measured actual with no instrument named', () => {
    const db = store();
    const { instrument: _dropped, ...unattributed } = measured;
    expect(() => db.saveOutput(output({ targets: [unattributed], instrumentCalls: ['contrast'] })))
      .toThrow(/no instrument named/);
    db.close();
  });

  it('leaves a stated target alone — the rule only constrains claims of measurement', () => {
    const db = store();
    db.saveOutput(output({
      targets: [{
        discipline: 'Department 5',
        metric: 'Print reproduction',
        target: 'Delta-E < 2',
        source: 'stated-target',
        mechanism: 'Proof on the production stock before sign-off.',
        tokens: [],
      }],
      instrumentCalls: [],
    }));
    expect(db.getOutput('r1', 5)?.targets).toHaveLength(1);
    db.close();
  });

  it('does not block an output with no targets at all', () => {
    const db = store();
    db.saveOutput(output());
    expect(db.getOutput('r1', 5)?.targets).toEqual([]);
    db.close();
  });
});
