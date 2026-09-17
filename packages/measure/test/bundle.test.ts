import { describe, expect, it } from 'vitest';
import { bundleAudit, DEFAULT_BUDGET_BYTES } from '../src/bundle.js';
import { BundleRecord } from '../src/records.js';

const KB = 1024;

const record = (chunks: unknown[]): BundleRecord => BundleRecord.parse({ chunks });

describe('bundleAudit', () => {
  it('measures the initial route, not the whole dist', () => {
    const result = bundleAudit(record([
      { name: 'index.js', bytes: 300 * KB, gzipBytes: 80 * KB, initial: true },
      { name: 'reader.js', bytes: 400 * KB, gzipBytes: 120 * KB, initial: false },
    ]));
    expect(result.value.initialGzipBytes).toBe(80 * KB);
    expect(result.value.deferredGzipBytes).toBe(120 * KB);
    expect(result.value.withinBudget).toBe(true);
  });

  it('names the three largest contributors when the budget is blown', () => {
    const result = bundleAudit(record([
      { name: 'vendor.js', bytes: 0, gzipBytes: 120 * KB, initial: true },
      { name: 'app.js', bytes: 0, gzipBytes: 60 * KB, initial: true },
      { name: 'polyfills.js', bytes: 0, gzipBytes: 20 * KB, initial: true },
      { name: 'icons.js', bytes: 0, gzipBytes: 5 * KB, initial: true },
    ]));
    expect(result.value.withinBudget).toBe(false);
    const finding = result.findings.find((f) => f.severity === 'major');
    expect(finding?.remediation).toContain('vendor.js');
    expect(finding?.remediation).toContain('polyfills.js');
    expect(finding?.remediation).not.toContain('icons.js');
  });

  it('reports each initial chunk as a share of the route', () => {
    const result = bundleAudit(record([
      { name: 'a.js', bytes: 0, gzipBytes: 75 * KB, initial: true },
      { name: 'b.js', bytes: 0, gzipBytes: 25 * KB, initial: true },
    ]));
    expect(result.value.initial.map((c) => c.share)).toEqual([75, 25]);
  });

  it('estimates gzip when only raw bytes are reported, and marks it', () => {
    const result = bundleAudit(record([{ name: 'index.js', bytes: 100 * KB, initial: true }]));
    expect(result.value.estimated).toBe(true);
    expect(result.value.initialGzipBytes).toBe(Math.round(100 * KB * 0.32));
    expect(result.findings.some((f) => f.severity === 'info'
      && f.message.includes('estimated'))).toBe(true);
  });

  it('counts render-blocking resources separately from weight', () => {
    const result = bundleAudit(record([
      { name: 'a.css', bytes: 0, gzipBytes: 2 * KB, initial: true, renderBlocking: true },
      { name: 'b.js', bytes: 0, gzipBytes: 2 * KB, initial: true, renderBlocking: true },
      { name: 'c.js', bytes: 0, gzipBytes: 2 * KB, initial: true, renderBlocking: true },
    ]));
    expect(result.value.withinBudget).toBe(true);
    expect(result.value.renderBlockingCount).toBe(3);
    expect(result.findings.some((f) => f.severity === 'major'
      && f.message.includes('render-blocking'))).toBe(true);
  });

  it('notes when nothing is split', () => {
    const result = bundleAudit(record([
      { name: 'a.js', bytes: 0, gzipBytes: KB, initial: true },
      { name: 'b.js', bytes: 0, gzipBytes: KB, initial: true },
    ]));
    expect(result.findings.some((f) => f.message.includes('nothing is split'))).toBe(true);
  });

  it('takes a budget Department 8 set over the default', () => {
    const chunks = record([{ name: 'index.js', bytes: 0, gzipBytes: 100 * KB, initial: true }]);
    expect(bundleAudit(chunks).value.withinBudget).toBe(true);
    expect(bundleAudit(chunks, 90 * KB).value.withinBudget).toBe(false);
    expect(bundleAudit(chunks).value.budgetBytes).toBe(DEFAULT_BUDGET_BYTES);
  });

  it('reports the largest chunk across the whole build, deferred included', () => {
    const result = bundleAudit(record([
      { name: 'index.js', bytes: 0, gzipBytes: 40 * KB, initial: true },
      { name: 'editor.js', bytes: 0, gzipBytes: 300 * KB, initial: false },
    ]));
    expect(result.value.largest?.name).toBe('editor.js');
  });
});
