import { describe, expect, it } from 'vitest';
import { Target } from '@edsai/engine';
import { measurementTargets } from '../src/targets.js';
import { WebVitalsRecord, HeaderRecord, BundleRecord, AxeRecord } from '../src/records.js';

/**
 * The provenance claim, tested at the seam where it matters: every row this
 * produces must survive the engine's own `Target` schema, which refuses an
 * `actual` that is not instrument-sourced.
 */

const vitals = WebVitalsRecord.parse({
  url: 'https://example.com/',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  field: { lcp: 3100, inp: 150, cls: 0.08, scope: 'page' },
  lab: { performanceScore: 86, lcp: 2100, cls: 0.04 },
});

const headers = HeaderRecord.parse({
  url: 'https://example.com/',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  status: 200,
  headers: {
    'content-security-policy': "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  },
  cookies: [{ name: 'session', httpOnly: false, secure: true, sameSite: 'lax' }],
});

const bundle = BundleRecord.parse({
  chunks: [
    { name: 'index.js', bytes: 0, gzipBytes: 80 * 1024, initial: true },
    { name: 'reader.js', bytes: 0, gzipBytes: 20 * 1024, initial: false },
  ],
});

const axe = AxeRecord.parse({
  url: 'https://example.com/',
  testedAt: '2026-01-01T00:00:00.000Z',
  passes: 40,
  violations: [{ id: 'label', impact: 'critical', help: 'Labels', nodes: 3 }],
});

describe('measurementTargets', () => {
  it('produces rows the engine accepts as instrument-sourced', () => {
    const targets = measurementTargets({ vitals, headers, bundle, axe });
    expect(targets.length).toBeGreaterThan(10);
    for (const target of targets) {
      expect(() => Target.parse(target)).not.toThrow();
      expect(target.source).toBe('instrument');
      expect(target.instrument).toBeTruthy();
      expect(target.actual).toBeTruthy();
    }
  });

  it('says in the metric name whether a vital came from field or lab', () => {
    const targets = measurementTargets({ vitals });
    expect(targets.some((t) => t.metric === 'LCP (field, real users)')).toBe(true);
    expect(targets.some((t) => t.metric === 'Lighthouse Performance (lab)')).toBe(true);
  });

  it('emits nothing for a record it was not given', () => {
    expect(measurementTargets({})).toEqual([]);
    const only = measurementTargets({ bundle });
    expect(only.every((t) => t.discipline.startsWith('Department 43'))).toBe(true);
  });

  it('omits a vital nothing measured rather than reporting it as a target', () => {
    const sparse = WebVitalsRecord.parse({
      url: 'https://example.com/', fetchedAt: 'x', lab: { lcp: 1000 },
    });
    const targets = measurementTargets({ vitals: sparse });
    expect(targets.map((t) => t.metric)).toEqual(['LCP (lab)']);
  });

  it('refuses to report an accessibility number from a run that did not happen', () => {
    const empty = AxeRecord.parse({ url: 'https://example.com/', testedAt: 'x', violations: [] });
    expect(measurementTargets({ axe: empty })).toEqual([]);
  });

  it('fails the CSP row and marks Report-Only as enforcing nothing', () => {
    const reportOnly = HeaderRecord.parse({
      ...headers,
      headers: {
        'content-security-policy-report-only': "script-src 'self'; frame-ancestors 'none'",
      },
    });
    const row = measurementTargets({ headers: reportOnly })
      .find((t) => t.metric === 'CSP script-src');
    expect(row?.pass).toBe(false);
    expect(row?.actual).toContain('Report-Only');
  });

  it("fails script-src when 'unsafe-inline' is present", () => {
    const row = measurementTargets({ headers }).find((t) => t.metric === 'CSP script-src');
    expect(row?.pass).toBe(false);
    expect(row?.target).toBe("set, without 'unsafe-inline'");
  });

  it('carries the budget Department 8 set into the bundle row', () => {
    const row = measurementTargets({ bundle, bundleBudgetBytes: 60 * 1024 })
      .find((t) => t.metric.startsWith('Initial-route JS'));
    expect(row?.target).toBe('< 60 KB');
    expect(row?.actual).toBe('80 KB');
    expect(row?.pass).toBe(false);
  });

  it('attributes each row to the department whose reference states the target', () => {
    const disciplines = new Set(measurementTargets({ vitals, headers, bundle, axe })
      .map((t) => t.discipline));
    expect(disciplines).toEqual(new Set([
      'Department 8 — Performance + SEO + Accessibility',
      'Department 40 — Frontend Security Engineering',
      'Department 43 — Build Systems & Dependency Engineering',
    ]));
  });
});
