import { describe, expect, it } from 'vitest';
import { webVitalsAudit, VITALS_TARGET } from '../src/web-vitals.js';
import { WebVitalsRecord } from '../src/records.js';

const record = (over: Partial<WebVitalsRecord> = {}): WebVitalsRecord =>
  WebVitalsRecord.parse({
    url: 'https://example.com/',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    lab: { performanceScore: 95, lcp: 1800, cls: 0.02, fcp: 900, ttfb: 200, totalBlockingTime: 50 },
    ...over,
  });

describe('webVitalsAudit', () => {
  it('passes a page inside every target', () => {
    const result = webVitalsAudit(record());
    expect(result.instrument).toBe('web_vitals_audit');
    expect(result.value.met).toBe(result.value.measured);
    expect(result.findings.filter((f) => f.severity === 'major')).toHaveLength(0);
  });

  it('lets field data outrank lab, and still reports the lab number', () => {
    const result = webVitalsAudit(record({
      field: { lcp: 4200, scope: 'page' },
      lab: { lcp: 1800, performanceScore: 99 },
    }));
    const lcp = result.value.verdicts.find((v) => v.metric === 'LCP');
    expect(lcp?.basis).toBe('field');
    expect(lcp?.passes).toBe(false);
    expect(lcp?.lab).toBe('1800ms');
    expect(result.findings.some((f) => f.message.includes('real users'))).toBe(true);
  });

  it('falls back to lab when there is no field data, and says so', () => {
    const result = webVitalsAudit(record());
    expect(result.value.hasFieldData).toBe(false);
    expect(result.findings.some((f) =>
      f.severity === 'info' && f.message.includes('No field data'))).toBe(true);
    expect(result.value.verdicts.every((v) => v.basis !== 'field')).toBe(true);
  });

  it('flags origin-level field data as describing the site, not the page', () => {
    const result = webVitalsAudit(record({ field: { lcp: 1200, scope: 'origin' } }));
    expect(result.value.fieldScope).toBe('origin');
    expect(result.findings.some((f) => f.message.includes('origin-level'))).toBe(true);
  });

  it('blames the server when TTFB eats the LCP budget', () => {
    const result = webVitalsAudit(record({
      lab: { lcp: 3400, ttfb: 1200, fcp: 1400, performanceScore: 60 },
    }));
    const finding = result.findings.find((f) => f.message.startsWith('LCP'));
    expect(finding?.remediation).toContain('TTFB alone is 1200ms');
    expect(finding?.remediation).toContain('server');
  });

  it('blames the hero asset when first paint is early and LCP is late', () => {
    const result = webVitalsAudit(record({
      lab: { lcp: 3400, ttfb: 200, fcp: 900, performanceScore: 60 },
    }));
    const finding = result.findings.find((f) => f.message.startsWith('LCP'));
    expect(finding?.remediation).toContain('hero asset');
  });

  it('points INP at the main thread when total blocking time is high', () => {
    const result = webVitalsAudit(record({ lab: { inp: 500, totalBlockingTime: 900 } }));
    const finding = result.findings.find((f) => f.message.startsWith('INP'));
    expect(finding?.remediation).toContain('main thread');
  });

  it('reports a metric nothing measured as not measured rather than as a pass', () => {
    const result = webVitalsAudit(record({ lab: { lcp: 1000 } }));
    const inp = result.value.verdicts.find((v) => v.metric === 'INP');
    expect(inp?.passes).toBeUndefined();
    expect(inp?.actual).toBe('not measured');
    expect(result.value.measured).toBeLessThan(result.value.verdicts.length);
  });

  it('formats CLS to three places rather than as a float artefact', () => {
    const result = webVitalsAudit(record({ lab: { cls: 0.1 + 0.2 } }));
    const cls = result.value.verdicts.find((v) => v.metric === 'CLS');
    expect(cls?.actual).toBe('0.300');
    expect(cls?.passes).toBe(false);
  });

  it('treats the Lighthouse score as higher-is-better', () => {
    const result = webVitalsAudit(record({ lab: { performanceScore: 80 } }));
    const score = result.value.verdicts.find((v) => v.metric === 'Lighthouse Performance');
    expect(score?.target).toBe(`≥ ${VITALS_TARGET.performanceScore}`);
    expect(score?.passes).toBe(false);
  });
});
