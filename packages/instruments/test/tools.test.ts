import { describe, expect, it } from 'vitest';
import { INSTRUMENT_TOOLS, toolNames, ToolInput } from '../src/tools.js';
import * as instruments from '../src/index.js';

/**
 * Strict tool use requires `strict: true` on the tool definition, and a schema
 * carrying `additionalProperties: false` plus `required`. These tests hold that
 * contract, because a malformed call that half-ran would let a fabricated
 * number past the provenance check built to catch fabricated numbers.
 */
describe('model tool definitions', () => {
  it('emits one tool per instrument input schema', () => {
    expect(INSTRUMENT_TOOLS).toHaveLength(Object.keys(ToolInput).length);
    expect(INSTRUMENT_TOOLS).toHaveLength(14);
  });

  it('marks every tool strict', () => {
    for (const tool of INSTRUMENT_TOOLS) {
      expect(tool.strict, tool.name).toBe(true);
    }
  });

  it('closes every schema to additional properties', () => {
    for (const tool of INSTRUMENT_TOOLS) {
      expect(tool.inputSchema['additionalProperties'], tool.name).toBe(false);
    }
  });

  it('declares an object schema with properties on every tool', () => {
    for (const tool of INSTRUMENT_TOOLS) {
      expect(tool.inputSchema['type'], tool.name).toBe('object');
      expect(Object.keys(tool.inputSchema['properties'] as object).length, tool.name)
        .toBeGreaterThan(0);
    }
  });

  it('lists required fields wherever a tool has any', () => {
    const withRequired = INSTRUMENT_TOOLS.filter((t) => Array.isArray(t.inputSchema['required']));
    // Only seo_lengths is entirely optional — a page may legitimately lack all of them.
    expect(withRequired.length).toBe(INSTRUMENT_TOOLS.length - 1);
  });

  it('strips the JSON Schema dialect declaration, which is noise on the wire', () => {
    for (const tool of INSTRUMENT_TOOLS) {
      expect(tool.inputSchema['$schema'], tool.name).toBeUndefined();
    }
  });

  it('describes every tool in terms of when to reach for it', () => {
    for (const tool of INSTRUMENT_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it('tells the model not to state a ratio it did not measure', () => {
    const contrast = INSTRUMENT_TOOLS.find((t) => t.name === 'contrast');
    expect(contrast?.description).toMatch(/cannot be reported as an actual/);
  });

  it('labels the gamut heuristic in the tool description itself', () => {
    const gamut = INSTRUMENT_TOOLS.find((t) => t.name === 'print_gamut_risk');
    expect(gamut?.description).toMatch(/Heuristic/);
  });

  it('orders tools stably, so the tool list never invalidates the prompt cache', () => {
    expect(INSTRUMENT_TOOLS.map((t) => t.name)).toEqual([...toolNames()].sort());
    expect(INSTRUMENT_TOOLS.map((t) => t.name)).toEqual(
      [...INSTRUMENT_TOOLS.map((t) => t.name)].sort(),
    );
  });

  it('validates a good call and rejects a malformed one', () => {
    expect(ToolInput.contrast.safeParse({ foreground: '#000', background: '#fff' }).success).toBe(true);
    expect(ToolInput.contrast.safeParse({ foreground: '#000' }).success).toBe(false);
    expect(ToolInput.score_drift.safeParse({ scores: [{ dimension: 'a', value: 11 }] }).success)
      .toBe(false);
  });
});

describe('package surface', () => {
  it('exports every instrument function', () => {
    for (const name of [
      'contrast', 'contrastWorstCase', 'auditPalette', 'generateScale', 'auditScale',
      'auditSpacing', 'lineLength', 'legibilityAtDistance', 'auditMotion', 'auditSeo',
      'scoreDrift', 'printGamutRisk',
    ]) {
      expect(typeof (instruments as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('names itself in every measurement, so provenance can be checked', () => {
    expect(instruments.contrast({ foreground: '#000', background: '#fff' }).instrument)
      .toBe('contrast');
    expect(instruments.lineLength({ measure: 600, fontSize: 16 }).instrument).toBe('line_length');
    expect(instruments.scoreDrift([{ dimension: 'a', value: 5 }]).instrument).toBe('score_drift');
  });

  it('reports the worst severity across a finding set', () => {
    expect(instruments.worstSeverity([
      { severity: 'minor', message: 'a' },
      { severity: 'blocker', message: 'b' },
    ])).toBe('blocker');
    expect(instruments.worstSeverity([])).toBeUndefined();
  });
});
