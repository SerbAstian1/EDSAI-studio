import { describe, expect, it } from 'vitest';
import { axeFromResults } from '../src/import.js';
import { axeAudit } from '../src/axe.js';

describe('axeFromResults', () => {
  const raw = {
    url: 'https://example.com/',
    timestamp: '2026-01-01T00:00:00.000Z',
    violations: [
      { id: 'label', impact: 'critical', help: 'Labels', nodes: [{}, {}, {}] },
      { id: 'region', impact: null, help: 'Landmarks', nodes: [{}] },
    ],
    passes: [{}, {}, {}, {}],
    incomplete: [{}],
  };

  it('keeps the node count, which is the size of the work', () => {
    const record = axeFromResults(raw);
    expect(record.violations[0]?.nodes).toBe(3);
    expect(axeAudit(record).value.elementCount).toBe(4);
  });

  it('records the pass count so a clean result can be trusted', () => {
    expect(axeFromResults(raw).passes).toBe(4);
    expect(axeAudit(axeFromResults(raw)).value.trustworthy).toBe(true);
  });

  it('leaves passes absent when axe did not report them, rather than defaulting to zero', () => {
    const record = axeFromResults({ url: 'https://example.com/', violations: [] });
    expect(record.passes).toBeUndefined();
    expect(axeAudit(record).value.trustworthy).toBe(false);
  });

  it('drops an impact axe did not state rather than inventing one', () => {
    expect(axeFromResults(raw).violations[1]?.impact).toBeUndefined();
  });

  it('refuses results with no page to attribute them to', () => {
    expect(() => axeFromResults({ violations: [] })).toThrow(/not attributable/);
  });

  it('takes an explicit url over the one in the file', () => {
    expect(axeFromResults(raw, 'https://other.example/').url).toBe('https://other.example/');
  });
});
