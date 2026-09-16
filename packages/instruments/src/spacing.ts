import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Spacing scale audit. Department 5's Token Discipline dimension scores "no
 * orphan magic numbers" — a value used in the design that traces to no scale.
 * That is a set-membership question, so it is computable.
 */

export const BASE_8 = [4, 8, 12, 16, 24, 32, 48, 64, 96] as const;
export const BASE_4 = [4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64] as const;

export interface SpacingInput {
  /** The declared scale. Defaults to the corpus's base-8 example. */
  scale?: readonly number[];
  /** Values actually used in the design or stylesheet. */
  used: readonly number[];
  /** Base unit every scale value should be a multiple of. Inferred when absent. */
  base?: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function auditSpacing(input: SpacingInput): Measurement<{
  scale: number[];
  base: number;
  used: number[];
  orphans: number[];
  unusedScaleValues: number[];
  offBase: number[];
  coverage: number;
}> {
  const scale = [...(input.scale ?? BASE_8)].sort((a, b) => a - b);
  if (scale.length === 0) throw new Error('a spacing audit needs a scale');

  const used = [...new Set(input.used)].sort((a, b) => a - b);
  const base = input.base ?? scale.reduce((a, b) => gcd(a, b));

  const inScale = new Set(scale);
  const orphans = used.filter((v) => !inScale.has(v));
  const unusedScaleValues = scale.filter((v) => !used.includes(v));
  const offBase = orphans.filter((v) => v % base !== 0);

  const coverage = used.length === 0 ? 1 : (used.length - orphans.length) / used.length;

  const findings: Finding[] = [];

  if (orphans.length > 0) {
    findings.push({
      severity: orphans.length > used.length / 4 ? 'major' : 'minor',
      message:
        `${orphans.length} of ${used.length} spacing values trace to no scale step: ` +
        `${orphans.join(', ')}.`,
      remediation:
        `Replace each with its nearest scale value — ` +
        orphans.map((v) => `${v}→${nearest(scale, v)}`).join(', ') +
        ` — or add it to the stated scale deliberately.`,
    });
  }

  if (offBase.length > 0) {
    findings.push({
      severity: 'minor',
      message: `${offBase.join(', ')} are not multiples of the ${base}px base unit.`,
      remediation: `Values off the base unit break vertical rhythm wherever they stack.`,
    });
  }

  if (unusedScaleValues.length > scale.length / 2) {
    findings.push({
      severity: 'nitpick',
      message:
        `${unusedScaleValues.length} of ${scale.length} declared scale steps are unused ` +
        `(${unusedScaleValues.join(', ')}).`,
      remediation: 'A scale wider than the design needs invites inconsistency. Trim it to what is used.',
    });
  }

  return measurement('spacing_audit', {
    scale,
    base,
    used,
    orphans,
    unusedScaleValues,
    offBase,
    coverage: round(coverage, 4),
  }, findings);
}

const nearest = (scale: readonly number[], value: number): number =>
  scale.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), scale[0] ?? value);
