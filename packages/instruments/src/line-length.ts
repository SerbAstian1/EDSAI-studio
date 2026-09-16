import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Line length in characters, from the measure and the type size.
 *
 * `00-scorecard.md §4` sets 45–75 characters for body copy. The conversion needs
 * an average character width, which is a property of the typeface: 0.5em is the
 * common approximation for a humanist sans at text sizes, and it is stated as an
 * input rather than hidden so a project using a narrow or wide face can correct
 * it instead of inheriting a wrong answer.
 */

export const LINE_LENGTH_TARGET = { min: 45, max: 75 } as const;

export interface LineLengthInput {
  /** Column width in px. */
  measure: number;
  fontSize: number;
  /** Average glyph advance as a fraction of the em. 0.5 suits a typical text sans. */
  averageCharWidth?: number;
  target?: { min: number; max: number };
}

export function lineLength(input: LineLengthInput): Measurement<{
  measure: number;
  fontSize: number;
  averageCharWidth: number;
  charactersPerLine: number;
  target: { min: number; max: number };
  withinTarget: boolean;
  /** The measure that would land mid-target, for a remediation that is actionable. */
  suggestedMeasure: number;
}> {
  const { measure, fontSize } = input;
  if (measure <= 0 || fontSize <= 0) throw new Error('measure and fontSize must be positive');

  const averageCharWidth = input.averageCharWidth ?? 0.5;
  const target = input.target ?? LINE_LENGTH_TARGET;

  const charactersPerLine = round(measure / (fontSize * averageCharWidth), 1);
  const withinTarget = charactersPerLine >= target.min && charactersPerLine <= target.max;
  const midTarget = (target.min + target.max) / 2;
  const suggestedMeasure = Math.round(midTarget * fontSize * averageCharWidth);

  const findings: Finding[] = [];
  if (!withinTarget) {
    const tooWide = charactersPerLine > target.max;
    findings.push({
      severity: 'minor',
      message:
        `${measure}px at ${fontSize}px reaches ${charactersPerLine} characters per line, ` +
        `against a ${target.min}–${target.max} target.`,
      remediation: tooWide
        ? `Long lines lose the reader on the return sweep. A ${suggestedMeasure}px measure lands near ${midTarget}.`
        : `Short lines break rhythm and hyphenate badly. A ${suggestedMeasure}px measure lands near ${midTarget}.`,
    });
  }

  return measurement('line_length', {
    measure,
    fontSize,
    averageCharWidth,
    charactersPerLine,
    target,
    withinTarget,
    suggestedMeasure,
  }, findings);
}
