import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Legibility at viewing distance, for Departments 13 and 14.
 *
 * The corpus states the rule of thumb directly: "cap height in inches roughly
 * equals readable distance in tens of feet — state the actual numbers rather
 * than eyeballing it". This is that sentence, made executable.
 */

const MM_PER_INCH = 25.4;
const FEET_PER_METRE = 3.28084;

export type LengthUnit = 'mm' | 'cm' | 'in' | 'pt' | 'px';
export type DistanceUnit = 'ft' | 'm';

const TO_INCHES: Record<LengthUnit, number> = {
  mm: 1 / MM_PER_INCH,
  cm: 10 / MM_PER_INCH,
  in: 1,
  pt: 1 / 72,
  // Only meaningful for print output at a stated DPI; see `dpi` below.
  px: 1 / 96,
};

export interface LegibilityInput {
  /** Cap height of the smallest text that must be read. */
  capHeight: number;
  capHeightUnit?: LengthUnit;
  /** The distance the piece is actually read from. */
  viewingDistance: number;
  viewingDistanceUnit?: DistanceUnit;
  /** For px cap heights on a print piece, the output resolution. */
  dpi?: number;
  label?: string;
}

export function legibilityAtDistance(input: LegibilityInput): Measurement<{
  label: string;
  capHeightInches: number;
  capHeightMm: number;
  readableDistanceFt: number;
  viewingDistanceFt: number;
  legible: boolean;
  /** Negative when short of the requirement, as a fraction of the stated distance. */
  marginFraction: number;
  requiredCapHeightMm: number;
}> {
  const capUnit = input.capHeightUnit ?? 'mm';
  const distanceUnit = input.viewingDistanceUnit ?? 'ft';

  if (input.capHeight <= 0) throw new Error('capHeight must be positive');
  if (input.viewingDistance <= 0) throw new Error('viewingDistance must be positive');

  const perUnit = capUnit === 'px' && input.dpi ? 1 / input.dpi : TO_INCHES[capUnit];
  const capHeightInches = input.capHeight * perUnit;

  // The corpus rule: cap height in inches ~= readable distance in tens of feet.
  const readableDistanceFt = capHeightInches * 10;
  const viewingDistanceFt =
    distanceUnit === 'm' ? input.viewingDistance * FEET_PER_METRE : input.viewingDistance;

  const legible = readableDistanceFt >= viewingDistanceFt;
  const marginFraction = (readableDistanceFt - viewingDistanceFt) / viewingDistanceFt;
  const requiredCapHeightMm = (viewingDistanceFt / 10) * MM_PER_INCH;

  const label = input.label ?? 'smallest text';
  const findings: Finding[] = [];

  if (!legible) {
    findings.push({
      severity: marginFraction < -0.5 ? 'major' : 'minor',
      message:
        `${label} at ${round(input.capHeight, 2)}${capUnit} cap height is readable from ` +
        `${round(readableDistanceFt, 1)} ft, against a stated ${round(viewingDistanceFt, 1)} ft — ` +
        `${round(Math.abs(marginFraction) * 100, 1)}% under.`,
      remediation:
        `Reaching ${round(viewingDistanceFt, 1)} ft needs a cap height of at least ` +
        `${round(requiredCapHeightMm, 2)}mm — ${round(requiredCapHeightMm / (input.capHeight * (capUnit === 'mm' ? 1 : perUnit * MM_PER_INCH)), 2)}× the current size.`,
    });
  }

  return measurement('legibility_at_distance', {
    label,
    capHeightInches: round(capHeightInches, 4),
    capHeightMm: round(capHeightInches * MM_PER_INCH, 2),
    readableDistanceFt: round(readableDistanceFt, 2),
    viewingDistanceFt: round(viewingDistanceFt, 2),
    legible,
    marginFraction: round(marginFraction, 4),
    requiredCapHeightMm: round(requiredCapHeightMm, 2),
  }, findings);
}
