import { measurement, type Finding, type Measurement } from './types.js';

/**
 * Motion timing sanity against Department 6's table.
 *
 * The corpus requires "actual duration/easing values used, not 'feels smooth'".
 * This checks a stated value against the band its category belongs to, and
 * checks the two things Department 15 cares about beyond timing: whether the
 * properties animated are compositor-only, and whether a reduced-motion
 * fallback exists for each event.
 */

export type MotionCategory =
  | 'micro-feedback' | 'ui-transition' | 'content-reveal' | 'page-transition' | 'ambient';

/** Department 6's duration and easing table, `04-motion-system.md`. */
export const MOTION_BANDS: Record<MotionCategory, {
  min: number; max: number; easing: string; note: string;
}> = {
  'micro-feedback':  { min: 100,  max: 150,      easing: 'ease-out', note: 'hover, button press' },
  'ui-transition':   { min: 200,  max: 300,      easing: 'cubic-bezier(0.16, 1, 0.3, 1)', note: 'modal open, menu reveal' },
  'content-reveal':  { min: 400,  max: 600,      easing: 'ease-out', note: 'scroll-triggered fade or slide-in' },
  'page-transition': { min: 500,  max: 800,      easing: 'ease-in-out', note: 'page or section transition' },
  'ambient':         { min: 3000, max: Infinity, easing: 'linear or ease-in-out', note: 'background, looping, low amplitude' },
};

/**
 * Properties the compositor can animate without layout or paint. Anything else
 * costs a frame on the main thread, which is Department 35's concern and the
 * usual cause of jank that no amount of easing fixes.
 */
const COMPOSITOR_SAFE = new Set(['transform', 'opacity', 'filter', 'backdrop-filter']);

/** Properties that force layout — the expensive mistake this check exists to catch. */
const LAYOUT_TRIGGERING = new Set([
  'width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'margin-top',
  'margin-left', 'padding', 'font-size', 'line-height', 'border-width', 'inset',
]);

export interface MotionEvent {
  name: string;
  category: MotionCategory;
  /** Milliseconds. */
  duration: number;
  easing?: string;
  /** CSS properties animated. */
  properties?: readonly string[];
  reducedMotionFallback?: string;
}

export function auditMotion(events: readonly MotionEvent[]): Measurement<{
  events: {
    name: string;
    category: MotionCategory;
    duration: number;
    withinBand: boolean;
    band: { min: number; max: number };
    compositorSafe: boolean;
    layoutTriggering: string[];
    hasReducedMotionFallback: boolean;
  }[];
  allWithinBands: boolean;
  allCompositorSafe: boolean;
  reducedMotionCoverage: number;
}> {
  if (events.length === 0) throw new Error('a motion audit needs at least one event');
  const findings: Finding[] = [];

  const rows = events.map((event) => {
    const band = MOTION_BANDS[event.category];
    if (!band) throw new Error(`unknown motion category: ${event.category}`);

    const withinBand = event.duration >= band.min && event.duration <= band.max;
    const properties = event.properties ?? [];
    const layoutTriggering = properties.filter((p) => LAYOUT_TRIGGERING.has(p));
    const compositorSafe =
      properties.length > 0 && properties.every((p) => COMPOSITOR_SAFE.has(p));
    const hasReducedMotionFallback = Boolean(event.reducedMotionFallback);

    if (!withinBand) {
      const bound = event.duration < band.min ? `${band.min}ms` : `${band.max}ms`;
      findings.push({
        severity: 'minor',
        message:
          `"${event.name}" runs ${event.duration}ms, outside the ${band.min}–` +
          `${band.max === Infinity ? '∞' : band.max}ms band for ${event.category} (${band.note}).`,
        remediation:
          `Move it toward ${bound}, or reclassify the event if it is doing a different job than its category implies.`,
      });
    }

    if (layoutTriggering.length > 0) {
      findings.push({
        severity: 'major',
        message: `"${event.name}" animates ${layoutTriggering.join(', ')}, which forces layout every frame.`,
        remediation:
          'Animate transform and opacity instead. A width animation cannot be composited, ' +
          'so it competes with everything else on the main thread.',
      });
    } else if (properties.length === 0) {
      findings.push({
        severity: 'minor',
        message: `"${event.name}" does not state which properties it animates.`,
        remediation: 'State the animated properties so compositor safety can be checked.',
      });
    }

    if (!hasReducedMotionFallback) {
      findings.push({
        severity: 'major',
        message: `"${event.name}" has no stated prefers-reduced-motion fallback.`,
        remediation:
          'Every motion event needs a defined behaviour under reduced motion — usually an ' +
          'instant state change, not a shorter version of the same animation.',
      });
    }

    if (event.easing && band.easing !== 'linear or ease-in-out' && !event.easing.trim()) {
      findings.push({ severity: 'nitpick', message: `"${event.name}" states an empty easing.` });
    }

    return {
      name: event.name,
      category: event.category,
      duration: event.duration,
      withinBand,
      band: { min: band.min, max: band.max },
      compositorSafe,
      layoutTriggering,
      hasReducedMotionFallback,
    };
  });

  const withFallback = rows.filter((r) => r.hasReducedMotionFallback).length;

  return measurement('motion_timing', {
    events: rows,
    allWithinBands: rows.every((r) => r.withinBand),
    allCompositorSafe: rows.every((r) => r.compositorSafe),
    reducedMotionCoverage: withFallback / rows.length,
  }, findings);
}
