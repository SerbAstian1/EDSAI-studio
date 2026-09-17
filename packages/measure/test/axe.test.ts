import { describe, expect, it } from 'vitest';
import { axeAudit } from '../src/axe.js';
import { AxeRecord } from '../src/records.js';

const record = (over: Record<string, unknown>): AxeRecord => AxeRecord.parse({
  url: 'https://example.com/',
  testedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('axeAudit', () => {
  it('distrusts a zero with no passes behind it', () => {
    const result = axeAudit(record({ violations: [] }));
    expect(result.value.trustworthy).toBe(false);
    expect(result.findings.some((f) => f.severity === 'major'
      && f.message.includes('did not run'))).toBe(true);
  });

  it('accepts a clean page when passes prove the run happened', () => {
    const result = axeAudit(record({ violations: [], passes: 41 }));
    expect(result.value.trustworthy).toBe(true);
    expect(result.findings.every((f) => f.severity === 'info')).toBe(true);
    expect(result.findings[0]?.remediation).toContain('Keyboard order');
  });

  it('counts elements rather than rules', () => {
    const result = axeAudit(record({
      passes: 30,
      violations: [
        { id: 'label', impact: 'critical', help: 'Form elements must have labels', nodes: 47 },
        { id: 'region', impact: 'moderate', help: 'All content should be in landmarks', nodes: 1 },
      ],
    }));
    expect(result.value.ruleCount).toBe(2);
    expect(result.value.elementCount).toBe(48);
    expect(result.findings[0]?.message).toContain('47 elements');
  });

  it('maps axe impacts onto the corpus severity vocabulary', () => {
    const result = axeAudit(record({
      passes: 10,
      violations: [
        { id: 'a', impact: 'minor', help: 'a', nodes: 1 },
        { id: 'b', impact: 'critical', help: 'b', nodes: 1 },
        { id: 'c', impact: 'serious', help: 'c', nodes: 1 },
        { id: 'd', impact: 'moderate', help: 'd', nodes: 1 },
      ],
    }));
    expect(result.findings.slice(0, 4).map((f) => f.severity))
      .toEqual(['blocker', 'major', 'minor', 'nitpick']);
  });

  it('ranks worst impact first, then by how many elements it hits', () => {
    const result = axeAudit(record({
      passes: 10,
      violations: [
        { id: 'small-critical', impact: 'critical', help: 'x', nodes: 2 },
        { id: 'big-critical', impact: 'critical', help: 'y', nodes: 9 },
        { id: 'serious', impact: 'serious', help: 'z', nodes: 100 },
      ],
    }));
    expect(result.value.ranked.map((v) => v.id))
      .toEqual(['big-critical', 'small-critical', 'serious']);
  });

  it('surfaces incomplete checks as needing a human, not as passes', () => {
    const result = axeAudit(record({ passes: 10, incomplete: 4 }));
    const finding = result.findings.find((f) => f.message.includes('could not decide'));
    expect(finding?.severity).toBe('info');
    expect(finding?.remediation).toContain('need a human');
  });

  it('treats a violation with no stated impact as moderate rather than dropping it', () => {
    const result = axeAudit(record({ passes: 5, violations: [{ id: 'x', help: 'x', nodes: 3 }] }));
    expect(result.value.byImpact).toEqual([{ impact: 'moderate', rules: 1, elements: 3 }]);
  });
});
