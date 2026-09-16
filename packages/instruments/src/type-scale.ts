import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Type scale generation and audit.
 *
 * Department 5 names tracking-per-tier as "the most commonly skipped item in
 * this section and the one that most separates a real type system from a scale
 * with a font applied". A single letter-spacing value across a scale is, in the
 * corpus's words, "wrong somewhere by definition" — so this instrument treats a
 * flat tracking column as a finding rather than a style choice.
 */

export const NAMED_RATIOS: Record<string, number> = {
  'minor second': 1.067,
  'major second': 1.125,
  'minor third': 1.2,
  'major third': 1.25,
  'perfect fourth': 1.333,
  'augmented fourth': 1.414,
  'perfect fifth': 1.5,
  'golden ratio': 1.618,
};

export interface Tier {
  /** Steps from the base: 0 is body, negatives are smaller. */
  step: number;
  size: number;
  lineHeight: number;
  /** em, so it scales with the size it is applied to. */
  tracking: number;
}

export interface GenerateInput {
  base: number;
  ratio: number;
  stepsUp?: number;
  stepsDown?: number;
  /** Round sizes to whole pixels, as a real stylesheet would. */
  round?: boolean;
}

/**
 * Leading and tracking both move inversely with size, which is the rule
 * Department 5's Optical Precision dimension scores. Large text needs
 * proportionally tighter leading and negative tracking; small text needs looser
 * leading and a positive tracking bump to stay legible.
 */
function leadingFor(size: number): number {
  if (size >= 40) return 1.05;
  if (size >= 30) return 1.12;
  if (size >= 24) return 1.2;
  if (size >= 20) return 1.3;
  if (size >= 16) return 1.5;
  return 1.55;
}

function trackingFor(size: number): number {
  if (size >= 40) return -0.025;
  if (size >= 30) return -0.02;
  if (size >= 24) return -0.015;
  if (size >= 20) return -0.01;
  if (size >= 16) return 0;
  return 0.01;
}

export function generateScale(input: GenerateInput): Measurement<{
  base: number;
  ratio: number;
  ratioName?: string;
  tiers: Tier[];
  sizes: number[];
}> {
  const { base, ratio } = input;
  if (base <= 0) throw new Error('type scale base must be positive');
  if (ratio <= 1) throw new Error('type scale ratio must be greater than 1');

  const stepsUp = input.stepsUp ?? 5;
  const stepsDown = input.stepsDown ?? 1;
  const shouldRound = input.round ?? true;

  const tiers: Tier[] = [];
  for (let step = -stepsDown; step <= stepsUp; step++) {
    const raw = base * ratio ** step;
    const size = shouldRound ? Math.round(raw) : round(raw, 2);
    tiers.push({
      step,
      size,
      lineHeight: leadingFor(size),
      tracking: trackingFor(size),
    });
  }

  const ratioName = Object.entries(NAMED_RATIOS)
    .find(([, value]) => Math.abs(value - ratio) < 0.005)?.[0];

  return measurement('type_scale', {
    base,
    ratio,
    ...(ratioName ? { ratioName } : {}),
    tiers,
    sizes: tiers.map((t) => t.size),
  });
}

export interface AuditInput {
  /** The scale as actually used. Tracking and lineHeight optional so their absence is findable. */
  tiers: readonly { size: number; lineHeight?: number; tracking?: number }[];
  /** Maximum acceptable spread between consecutive step ratios, as a fraction. */
  maxRatioSpread?: number;
}

export function auditScale(input: AuditInput): Measurement<{
  sizes: number[];
  stepRatios: number[];
  meanRatio: number;
  ratioSpread: number;
  consistent: boolean;
  trackingStated: boolean;
  trackingVaries: boolean;
  trackingMovesInversely: boolean;
  leadingMovesInversely: boolean;
}> {
  const tiers = [...input.tiers].sort((a, b) => a.size - b.size);
  if (tiers.length < 2) throw new Error('a scale audit needs at least two tiers');

  const maxSpread = input.maxRatioSpread ?? 0.1;
  const findings: Finding[] = [];

  const stepRatios: number[] = [];
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1]?.size ?? 1;
    const next = tiers[i]?.size ?? 1;
    stepRatios.push(round(next / prev, 4));
  }

  const meanRatio = stepRatios.reduce((a, b) => a + b, 0) / stepRatios.length;
  const spread = (Math.max(...stepRatios) - Math.min(...stepRatios)) / meanRatio;
  const consistent = spread <= maxSpread;

  if (!consistent) {
    findings.push({
      severity: 'minor',
      message:
        `Step ratios range ${round(Math.min(...stepRatios), 3)}–${round(Math.max(...stepRatios), 3)}, ` +
        `a ${round(spread * 100, 1)}% spread around a mean of ${round(meanRatio, 3)}.`,
      remediation:
        `Sizes are not on one ratio. Regenerate from a single ratio (nearest named: ` +
        `${nearestRatioName(meanRatio)}) or state why a tier deliberately departs.`,
    });
  }

  const tracked = tiers.filter((t) => t.tracking !== undefined);
  const trackingStated = tracked.length === tiers.length;
  const trackingValues = tracked.map((t) => t.tracking as number);
  const trackingVaries = new Set(trackingValues).size > 1;

  if (!trackingStated) {
    findings.push({
      severity: 'major',
      message: `Tracking is stated for ${tracked.length} of ${tiers.length} tiers.`,
      remediation: 'State tracking per size tier. Department 5 requires it alongside size and line-height.',
    });
  } else if (!trackingVaries) {
    findings.push({
      severity: 'major',
      message: `One tracking value (${trackingValues[0]}em) is applied across the whole scale.`,
      remediation:
        'Optical spacing is size-dependent: display sizes want negative tracking, ' +
        'small text a positive bump, body near zero. A single value is wrong somewhere by definition.',
    });
  }

  const trackingMovesInversely = trackingStated && trackingVaries && monotonicNonIncreasing(
    tracked.map((t) => t.tracking as number),
  );
  if (trackingStated && trackingVaries && !trackingMovesInversely) {
    findings.push({
      severity: 'minor',
      message: 'Tracking does not decrease as size increases.',
      remediation: 'Tracking should move inversely with size across the scale.',
    });
  }

  const led = tiers.filter((t) => t.lineHeight !== undefined);
  const leadingMovesInversely = led.length === tiers.length && monotonicNonIncreasing(
    led.map((t) => t.lineHeight as number),
  );
  if (led.length !== tiers.length) {
    findings.push({
      severity: 'minor',
      message: `Line-height is stated for ${led.length} of ${tiers.length} tiers.`,
      remediation: 'State line-height per tier; it is part of the scale, not a global default.',
    });
  } else if (!leadingMovesInversely) {
    findings.push({
      severity: 'minor',
      message: 'Line-height does not tighten as size increases.',
      remediation: 'Leading should move inversely with size — display text needs proportionally less.',
    });
  }

  return measurement('type_scale_audit', {
    sizes: tiers.map((t) => t.size),
    stepRatios,
    meanRatio: round(meanRatio, 4),
    ratioSpread: round(spread, 4),
    consistent,
    trackingStated,
    trackingVaries,
    trackingMovesInversely,
    leadingMovesInversely,
  }, findings);
}

const monotonicNonIncreasing = (values: readonly number[]): boolean =>
  values.every((v, i) => i === 0 || v <= (values[i - 1] ?? v) + 1e-9);

function nearestRatioName(ratio: number): string {
  let best = '';
  let bestDelta = Infinity;
  for (const [name, value] of Object.entries(NAMED_RATIOS)) {
    const delta = Math.abs(value - ratio);
    if (delta < bestDelta) { bestDelta = delta; best = name; }
  }
  return `${best} ${NAMED_RATIOS[best]}`;
}
