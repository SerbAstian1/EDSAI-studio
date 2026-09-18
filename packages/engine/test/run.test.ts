import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import { evaluateGate, gateSummary } from '../src/gate.js';
import { Harness } from '../src/harness.js';
import { RunContext } from '../src/run.js';
import { RunStore } from '../src/store.js';
import type { Issue, Conflict } from '../src/types.js';

const rubric = buildRubric();

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop() ?? '', { recursive: true, force: true });
});

function fixture(options?: { scopeId?: string; path?: string }) {
  const store = new RunStore(options?.path ?? ':memory:');
  const context = new RunContext({
    rubric, store, ...(options?.scopeId ? { scopeId: options.scopeId } : {}),
  });
  const run = context.start({
    projectId: 'p1',
    clientId: 'client-test', brief: 'A booking interface for a Kampala shoemaker.',
    level: 1,
    runId: 'test-run',
  });
  return { store, context, run };
}

/** A complete submission for a scored department, so accept() has nothing to reject. */
function fullSubmission(context: RunContext, departmentId: number) {
  const department = rubric.departments.find((d) => d.id === departmentId);
  const dimensions = [
    ...rubric.universalDimensions.map((d) => d.name),
    ...(department?.dimensions ?? []).map((d) => d.name),
  ];
  return {
    body: `Reasoning for department ${departmentId}.`,
    scores: dimensions.map((dimension, i) => ({
      dimension,
      value: ((i * 3) % 9) + 1,
      justification: `Specific reason concerning ${dimension} in this project.`,
      inverse: false,
    })),
  };
}

describe('run start', () => {
  it('computes the departments the run will execute', () => {
    const { run } = fixture();
    expect(run.activatedDepartments).toHaveLength(24);
    expect(run.status).toBe('running');
    expect(run.version).toBe('V1');
  });

  it('honours the delivery scope', () => {
    const { run } = fixture({ scopeId: 'no-motion-authoring' });
    expect(run.activatedDepartments).toHaveLength(23);
    expect(run.activatedDepartments).not.toContain(6);
    expect(run.scopeId).toBe('no-motion-authoring');
  });
});

describe('prepare', () => {
  it('offers the first department first', () => {
    const { context, run } = fixture();
    expect(context.prepare(run.id)?.department.id).toBe(run.activatedDepartments[0]);
  });

  it('places the cache breakpoint on the last stable block', () => {
    const { context, run } = fixture();
    const turn = context.prepare(run.id);
    expect(turn?.prompt.cacheBreakpoint).toBe(3);
    expect(turn?.prompt.blocks.slice(0, 4).every((b) => b.stable)).toBe(true);
    expect(turn?.prompt.blocks.slice(4).every((b) => !b.stable)).toBe(true);
  });

  it('keeps the stable prefix byte-identical across departments', () => {
    const { context, run } = fixture();
    const first = context.prepare(run.id, 1);
    const second = context.prepare(run.id, 2);
    // Blocks 0-2 are the shared core; block 3 is the department's own file.
    expect(first?.prompt.blocks.slice(0, 3).map((b) => b.text))
      .toEqual(second?.prompt.blocks.slice(0, 3).map((b) => b.text));
  });

  it('adds exactly one upstream block per completed department', () => {
    const { context, run } = fixture();
    const before = context.prepare(run.id, 2)?.prompt.blocks.length ?? 0;
    context.accept(run.id, 1, fullSubmission(context, 1));
    const after = context.prepare(run.id, 2)?.prompt.blocks.length ?? 0;
    expect(after).toBe(before + 1);
  });

  it('presents upstream output in pipeline order', () => {
    const { context, run } = fixture();
    context.accept(run.id, 2, fullSubmission(context, 2));
    context.accept(run.id, 1, fullSubmission(context, 1));
    const labels = context.prepare(run.id, 3)?.prompt.blocks
      .filter((b) => b.label.startsWith('upstream-'))
      .map((b) => b.label);
    expect(labels).toEqual(['upstream-1', 'upstream-2']);
  });

  it('refuses a department the classification did not activate', () => {
    const { context, run } = fixture();
    expect(() => context.prepare(run.id, 46)).toThrow(/not activated/);
  });

  it('returns nothing once every department is done', () => {
    const { context, run } = fixture();
    for (const id of run.activatedDepartments) {
      context.accept(run.id, id, fullSubmission(context, id));
    }
    expect(context.prepare(run.id)).toBeUndefined();
  });
});

describe('accept', () => {
  it('rejects a score with no justification without persisting it', () => {
    const { context, run } = fixture();
    const result = context.accept(run.id, 1, {
      body: 'x',
      scores: [{ dimension: 'Brand Fidelity', value: 8, justification: '', inverse: false }],
    });
    expect(result.rejected.some((r) => r.field === 'scores[0]')).toBe(true);
    expect(result.output.scores).toHaveLength(0);
  });

  it('names every dimension a scored department failed to score', () => {
    const { context, run } = fixture();
    const result = context.accept(run.id, 1, { body: 'x', scores: [] });
    const missing = result.rejected.filter((r) => r.reason === 'dimension not scored');
    expect(missing).toHaveLength(7);
    expect(missing.map((m) => m.field)).toContain('scores.Positioning Sharpness');
  });

  it('accepts a complete submission cleanly', () => {
    const { context, run } = fixture();
    const result = context.accept(run.id, 1, fullSubmission(context, 1));
    expect(result.rejected).toHaveLength(0);
    expect(result.output.scores).toHaveLength(7);
  });

  it('strips a fabricated actual and records the violation', () => {
    const { context, store, run } = fixture();
    const result = context.accept(run.id, 1, {
      ...fullSubmission(context, 1),
      targets: [{
        discipline: 'Color', metric: 'body on ground', target: '4.5:1',
        actual: '7.04:1', source: 'instrument', instrument: 'contrast',
      }],
    });
    expect(result.violations[0]?.kind).toBe('no-call');
    expect(result.output.targets[0]?.source).toBe('stated-target');
    expect(store.getViolations(run.id)).toHaveLength(1);
  });

  it('rejects a target claiming an actual without an instrument source', () => {
    const { context, run } = fixture();
    const result = context.accept(run.id, 1, {
      ...fullSubmission(context, 1),
      targets: [{
        discipline: 'Color', metric: 'x', target: '4.5:1',
        actual: '7.04:1', source: 'stated-target', mechanism: 'y',
      }],
    });
    expect(result.rejected.some((r) => /source is "instrument"/.test(r.reason))).toBe(true);
  });

  it('rejects a stated target with no mechanism, which is just a wish', () => {
    const { context, run } = fixture();
    const result = context.accept(run.id, 1, {
      ...fullSubmission(context, 1),
      targets: [{ discipline: 'Color', metric: 'x', target: '4.5:1', source: 'stated-target' }],
    });
    expect(result.rejected.some((r) => /just a wish/.test(r.reason))).toBe(true);
  });
});

describe('resume', () => {
  it('produces byte-identical records after a simulated crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edsai-run-'));
    temps.push(dir);
    const path = join(dir, 'runs.db');

    const first = fixture({ path });
    const order = first.run.activatedDepartments.slice(0, 4);
    for (const id of order) first.context.accept(first.run.id, id, fullSubmission(first.context, id));
    const before = first.store.getOutputs(first.run.id).map((o) => JSON.stringify(o));
    first.store.close();

    // A second process opens the same database and carries on.
    const store = new RunStore(path);
    const context = new RunContext({ rubric, store });
    expect(context.prepare('test-run')?.department.id).toBe(first.run.activatedDepartments[4]);
    expect(store.getOutputs('test-run').map((o) => JSON.stringify(o))).toEqual(before);
    store.close();
  });

  it('is idempotent when a department is re-run', () => {
    const { context, store, run } = fixture();
    context.accept(run.id, 1, fullSubmission(context, 1));
    context.accept(run.id, 1, fullSubmission(context, 1));
    expect(store.completedDepartments(run.id)).toEqual([1]);
  });
});

describe('the FINAL gate', () => {
  const issue = (over: Partial<Issue> = {}): Issue => ({
    id: 'i1', severity: 'Major', description: 'x', tracedTo: [5], fix: 'y', status: 'open', ...over,
  });
  const conflict = (over: Partial<Conflict> = {}): Conflict => ({
    id: 'c1', departments: [1, 2], description: 'x',
    resolution: 'y', whatWasLost: 'z', ...over,
  });

  it('passes when nothing is open and every conflict is resolved', () => {
    const result = evaluateGate({
      proposed: 'FINAL',
      issues: [issue({ status: 'resolved' }), issue({ id: 'i2', severity: 'Minor' })],
      conflicts: [conflict()],
    });
    expect(result.passed).toBe(true);
    expect(result.determination).toBe('FINAL');
  });

  it('overrides a proposed FINAL while a Major is open', () => {
    const result = evaluateGate({ proposed: 'FINAL', issues: [issue()], conflicts: [] });
    expect(result.determination).toBe('V1');
    expect(result.blockers[0]).toMatch(/1 open Major/);
  });

  it('overrides for an open Blocker too', () => {
    const result = evaluateGate({
      proposed: 'FINAL', issues: [issue({ severity: 'Blocker' })], conflicts: [],
    });
    expect(result.determination).toBe('V1');
  });

  it('lets Minors and Nitpicks through', () => {
    const result = evaluateGate({
      proposed: 'FINAL',
      issues: [issue({ severity: 'Minor' }), issue({ id: 'i2', severity: 'Nitpick' })],
      conflicts: [],
    });
    expect(result.passed).toBe(true);
  });

  it('refuses a conflict resolved without saying what was lost', () => {
    const result = evaluateGate({
      proposed: 'FINAL', issues: [],
      conflicts: [conflict({ whatWasLost: undefined })],
    });
    expect(result.passed).toBe(false);
    expect(result.blockers[0]).toMatch(/not stating what was lost/);
  });

  it('never grants FINAL — it only ever withholds it', () => {
    const result = evaluateGate({ proposed: 'V1', issues: [], conflicts: [] });
    expect(result.determination).toBe('V1');
    expect(result.passed).toBe(true);
  });

  it('summarises in one line', () => {
    expect(gateSummary(evaluateGate({ proposed: 'FINAL', issues: [issue()], conflicts: [] })))
      .toMatch(/FINAL withheld/);
  });
});

describe('harness mode', () => {
  function harnessFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'edsai-harness-'));
    temps.push(dir);
    const { context, store, run } = fixture();
    return { harness: new Harness(context, dir), context, store, run };
  }

  it('writes a prompt and schema for the next department', () => {
    const { harness, run } = harnessFixture();
    const next = harness.next(run.id);
    expect(next?.departmentId).toBe(1);
    expect(next?.paths.prompt).toMatch(/prompt\.md$/);
  });

  it('runs an instrument and logs the call', () => {
    const { harness, run } = harnessFixture();
    harness.next(run.id);
    harness.callInstrument(run.id, 1, 'contrast', { foreground: '#141822', background: '#EEF0F4' });
    const calls = harness.loggedCalls(run.id, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.instrument).toBe('contrast');
  });

  it('rejects instrument input its schema refuses', () => {
    const { harness, run } = harnessFixture();
    harness.next(run.id);
    expect(() => harness.callInstrument(run.id, 1, 'contrast', { foreground: '#000' }))
      .toThrow(/schema rejects/);
  });

  it('rejects an unknown instrument and lists the real ones', () => {
    const { harness, run } = harnessFixture();
    expect(() => harness.callInstrument(run.id, 1, 'vibes', {}))
      .toThrow(/unknown instrument: vibes/);
  });

  /** The property that makes harness mode a refactor rather than a second path. */
  it('verifies a submitted actual exactly as the API path would', () => {
    const { harness, run } = harnessFixture();
    harness.next(run.id);
    const measured = harness.callInstrument(run.id, 1, 'contrast', {
      foreground: '#141822', background: '#EEF0F4',
    }) as { value: { ratio: number } };

    const good = harness.submit(run.id, 1, {
      ...fullSubmission(harness['context'] as never, 1),
      targets: [{
        discipline: 'Color', metric: 'ink on ground', target: '4.5:1',
        actual: `${measured.value.ratio}:1`, source: 'instrument', instrument: 'contrast',
      }],
    });
    expect(good.violations).toHaveLength(0);
    expect(good.output.targets[0]?.source).toBe('instrument');
  });

  it('strips a number no logged call produced', () => {
    const { harness, context, run } = harnessFixture();
    harness.next(run.id);
    harness.callInstrument(run.id, 1, 'contrast', { foreground: '#141822', background: '#EEF0F4' });

    const result = harness.submit(run.id, 1, {
      ...fullSubmission(context, 1),
      targets: [{
        discipline: 'Color', metric: 'ink on ground', target: '4.5:1',
        actual: '4.61:1', source: 'instrument', instrument: 'contrast',
      }],
    });
    expect(result.violations[0]?.kind).toBe('value-not-found');
  });

  it('retracts a turn so it can be prepared again', () => {
    const { harness, run } = harnessFixture();
    harness.next(run.id);
    harness.callInstrument(run.id, 1, 'contrast', { foreground: '#000', background: '#fff' });
    expect(harness.loggedCalls(run.id, 1)).toHaveLength(1);
    harness.retract(run.id, 1);
    expect(harness.loggedCalls(run.id, 1)).toHaveLength(0);
  });

  it('enforces pipeline order — next() never skips ahead', () => {
    const { harness, context, run } = harnessFixture();
    expect(harness.next(run.id)?.departmentId).toBe(1);
    context.accept(run.id, 1, fullSubmission(context, 1));
    expect(harness.next(run.id)?.departmentId).toBe(2);
  });
});
