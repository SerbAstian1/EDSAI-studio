import type { Target } from '@edsai/engine';
import { webVitalsAudit, VITALS_TARGET } from './web-vitals.js';
import { headerAudit } from './headers.js';
import { bundleAudit, DEFAULT_BUDGET_BYTES } from './bundle.js';
import { axeAudit } from './axe.js';
import type { WebVitalsRecord, HeaderRecord, BundleRecord, AxeRecord } from './records.js';

/**
 * The join: records in, `Target` rows out.
 *
 * This is the point of the whole package. Departments 8, 40 and 43 each end
 * with a "Real Measurable Targets to report" list, and until now a department
 * could only ever assert those numbers — which the engine correctly refuses to
 * accept as `source: 'instrument'`. Every row produced here carries
 * `source: 'instrument'` and the instrument's own name, because a tool call in
 * that turn actually produced the value.
 *
 * Rows only appear for records that exist. An absent record produces no target,
 * rather than a target with a hopeful actual: "not measured" reported as a
 * measurement is the exact failure this system was built to make impossible.
 */

export interface MeasurementInput {
  vitals?: WebVitalsRecord;
  headers?: HeaderRecord;
  bundle?: BundleRecord;
  axe?: AxeRecord;
  /** Department 8 sets the real budget; 170 KB is only the default. */
  bundleBudgetBytes?: number;
}

const PERFORMANCE = 'Department 8 — Performance + SEO + Accessibility';
const SECURITY = 'Department 40 — Frontend Security Engineering';
const BUILD = 'Department 43 — Build Systems & Dependency Engineering';

function row(
  discipline: string,
  instrument: string,
  metric: string,
  target: string,
  actual: string,
  pass: boolean,
): Target {
  return { discipline, metric, target, actual, source: 'instrument', instrument, pass };
}

export function measurementTargets(input: MeasurementInput): Target[] {
  const targets: Target[] = [];

  if (input.vitals) {
    const result = webVitalsAudit(input.vitals);
    for (const verdict of result.value.verdicts) {
      if (verdict.passes === undefined) continue;
      targets.push(row(
        PERFORMANCE,
        result.instrument,
        // Which source decided it belongs in the metric name: a reader comparing
        // two runs needs to know one is real users and the other is a lab box.
        `${verdict.metric} (${verdict.basis === 'field' ? 'field, real users' : 'lab'})`,
        verdict.target,
        verdict.actual,
        verdict.passes,
      ));
    }
  }

  if (input.axe) {
    const result = axeAudit(input.axe);
    const value = result.value;
    if (value.trustworthy) {
      targets.push(row(
        PERFORMANCE,
        result.instrument,
        'axe violations (affected elements)',
        '0',
        `${value.elementCount} across ${value.ruleCount} rule${value.ruleCount === 1 ? '' : 's'}`,
        value.elementCount === 0,
      ));
      const blocking = value.byImpact
        .filter((r) => r.impact === 'critical' || r.impact === 'serious')
        .reduce((sum, r) => sum + r.elements, 0);
      targets.push(row(
        PERFORMANCE,
        result.instrument,
        'axe critical + serious elements',
        '0',
        String(blocking),
        blocking === 0,
      ));
    }
  }

  if (input.bundle) {
    const budget = input.bundleBudgetBytes ?? DEFAULT_BUDGET_BYTES;
    const result = bundleAudit(input.bundle, budget);
    const value = result.value;
    const kb = (bytes: number): string => `${Math.round((bytes / 1024) * 10) / 10} KB`;
    targets.push(row(
      BUILD,
      result.instrument,
      `Initial-route JS, gzipped${value.estimated ? ' (estimated)' : ''}`,
      `< ${kb(budget)}`,
      kb(value.initialGzipBytes),
      value.withinBudget,
    ));
    if (value.largest) {
      targets.push(row(
        BUILD,
        result.instrument,
        `Largest single chunk (${value.largest.name})`,
        `< ${kb(budget)}`,
        kb(value.largest.gzipBytes),
        value.largest.gzipBytes <= budget,
      ));
    }
    targets.push(row(
      BUILD,
      result.instrument,
      'Render-blocking resources',
      '0',
      String(value.renderBlockingCount),
      value.renderBlockingCount === 0,
    ));
  }

  if (input.headers) {
    const result = headerAudit(input.headers);
    const value = result.value;
    for (const directive of value.csp.directives) {
      targets.push(row(
        SECURITY,
        result.instrument,
        `CSP ${directive.name}`,
        directive.name === 'script-src' ? "set, without 'unsafe-inline'" : 'set',
        directive.state === 'absent'
          ? 'not set'
          : `${directive.value ?? ''}${value.csp.reportOnly ? ' (Report-Only — enforcing nothing)' : ''}`,
        directive.state === 'pass' && !value.csp.reportOnly,
      ));
    }
    for (const header of value.transport) {
      targets.push(row(
        SECURITY,
        result.instrument,
        header.name,
        'set',
        header.state === 'absent' ? 'not set' : header.value ?? '',
        header.state === 'pass',
      ));
    }
    for (const cookie of value.cookies) {
      targets.push(row(
        SECURITY,
        result.instrument,
        `Cookie attributes — ${cookie.name}`,
        'HttpOnly, Secure, SameSite',
        cookie.missing.length === 0 ? 'all set' : `missing ${cookie.missing.join(', ')}`,
        cookie.state === 'pass',
      ));
    }
  }

  return targets;
}

export { VITALS_TARGET };
