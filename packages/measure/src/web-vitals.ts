import { measurement, round, type Finding, type Measurement } from '@edsai/instruments';
import type { WebVitalsRecord } from './records.js';

/**
 * Core Web Vitals, evaluated.
 *
 * The rule the corpus states and almost nobody implements: **field data
 * outranks lab**. A Lighthouse run is one synthetic load on one machine; CrUX is
 * what happened to real people over 28 days. Where both exist the verdict is the
 * field number, and the lab number is still reported, because it is what a
 * developer can iterate against between deploys.
 *
 * Every miss carries a diagnosis rather than a restatement. "Improve LCP" is not
 * actionable; "TTFB is 1.2s of your 2.5s budget, so the server is the problem
 * before the client has done anything" is.
 */

export const VITALS_TARGET = {
  performanceScore: 90,
  lcp: 2500,
  inp: 200,
  cls: 0.1,
} as const;

export interface VitalVerdict {
  metric: 'LCP' | 'INP' | 'CLS' | 'Lighthouse Performance';
  target: string;
  /** The value the verdict rests on. */
  actual: string;
  /** Which source decided it. */
  basis: 'field' | 'lab' | 'none';
  /** Reported alongside when field data decided the verdict. */
  lab?: string;
  passes: boolean | undefined;
}

export interface VitalsResult {
  url: string;
  strategy: string;
  hasFieldData: boolean;
  fieldScope?: 'page' | 'origin';
  verdicts: VitalVerdict[];
  met: number;
  measured: number;
}

const ms = (n: number): string => `${Math.round(n)}ms`;

/** Department 8.1's own diagnoses, attached to the metric that failed. */
function diagnose(metric: string, record: WebVitalsRecord): string {
  const lab = record.lab;
  switch (metric) {
    case 'LCP': {
      const ttfb = lab.ttfb;
      if (ttfb !== undefined && ttfb > 800) {
        return `TTFB alone is ${ms(ttfb)} of the ${VITALS_TARGET.lcp}ms budget — the server is ` +
          'the problem before the client has rendered anything. Fix that first; no amount of ' +
          'image optimisation recovers a slow origin.';
      }
      if (lab.fcp !== undefined && lab.lcp !== undefined && lab.lcp - lab.fcp > 1000) {
        return `First paint lands at ${ms(lab.fcp)} but the largest element takes until ` +
          `${ms(lab.lcp)} — the gap is the hero asset. Serve it at display size, preload it, ` +
          'and make sure it is not waiting behind a font or a script.';
      }
      return 'Identify the LCP element, then get it into the first response: preload it, ' +
        'serve it at display size, and remove anything render-blocking ahead of it.';
    }
    case 'INP':
      return lab.totalBlockingTime !== undefined && lab.totalBlockingTime > 200
        ? `Total blocking time is ${ms(lab.totalBlockingTime)}, so the main thread is busy when ` +
          'input arrives. Break up long tasks and move work off the critical path.'
        : 'Find the slowest interaction and what it does synchronously. INP is the worst ' +
          'interaction, not the average — one bad handler sets it.';
    case 'CLS':
      return 'Reserve space before content arrives: explicit dimensions on images and embeds, ' +
        'fixed-height skeletons, and a fallback font whose metrics match the web font.';
    default:
      return 'The composite score follows the individual metrics — fix those rather than the score.';
  }
}

export function webVitalsAudit(record: WebVitalsRecord): Measurement<VitalsResult> {
  const findings: Finding[] = [];
  const field = record.field;
  const lab = record.lab;
  const hasFieldData = Boolean(field && (field.lcp ?? field.inp ?? field.cls) !== undefined);

  const verdicts: VitalVerdict[] = [];

  const judge = (
    metric: VitalVerdict['metric'],
    fieldValue: number | undefined,
    labValue: number | undefined,
    target: number,
    format: (n: number) => string,
    higherIsBetter = false,
  ): void => {
    const basis: VitalVerdict['basis'] =
      fieldValue !== undefined ? 'field' : labValue !== undefined ? 'lab' : 'none';
    const value = fieldValue ?? labValue;

    if (value === undefined) {
      verdicts.push({
        metric, target: format(target), actual: 'not measured', basis: 'none', passes: undefined,
      });
      return;
    }

    const passes = higherIsBetter ? value >= target : value <= target;
    verdicts.push({
      metric,
      target: `${higherIsBetter ? '≥' : '<'} ${format(target)}`,
      actual: format(value),
      basis,
      ...(basis === 'field' && labValue !== undefined ? { lab: format(labValue) } : {}),
      passes,
    });

    if (!passes) {
      findings.push({
        severity: metric === 'CLS' || metric === 'INP' ? 'major' : 'major',
        message:
          `${metric} is ${format(value)} against a ${higherIsBetter ? '≥' : '<'} ${format(target)} ` +
          `target, measured from ${basis === 'field' ? 'real users' : 'a lab run'}` +
          (basis === 'field' && labValue !== undefined ? ` (lab reads ${format(labValue)})` : '') + '.',
        remediation: diagnose(metric, record),
      });
    }
  };

  judge('LCP', field?.lcp, lab.lcp, VITALS_TARGET.lcp, ms);
  judge('INP', field?.inp, lab.inp, VITALS_TARGET.inp, ms);
  judge('CLS', field?.cls, lab.cls, VITALS_TARGET.cls, (n) => round(n, 3).toFixed(3));
  judge('Lighthouse Performance', undefined, lab.performanceScore,
    VITALS_TARGET.performanceScore, (n) => String(Math.round(n)), true);

  if (!hasFieldData) {
    findings.push({
      severity: 'info',
      message:
        'No field data — this page does not have enough real traffic for CrUX, so every ' +
        'verdict above rests on a lab run.',
      remediation:
        'Treat these as directional. A lab run is one load on one machine and routinely ' +
        'disagrees with what users experience.',
    });
  } else if (field?.scope === 'origin') {
    findings.push({
      severity: 'info',
      message:
        'Field data is origin-level, not page-level: this specific URL lacks the traffic, so ' +
        'the numbers describe the site as a whole.',
      remediation: 'A slow page can hide inside a fast origin. Weight these accordingly.',
    });
  }

  const measured = verdicts.filter((v) => v.passes !== undefined).length;

  return measurement('web_vitals_audit', {
    url: record.url,
    strategy: record.strategy,
    hasFieldData,
    ...(field?.scope ? { fieldScope: field.scope } : {}),
    verdicts,
    met: verdicts.filter((v) => v.passes === true).length,
    measured,
  }, findings);
}
