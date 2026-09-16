import { parseColor, toHex, type Rgb } from './color.js';
import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Print gamut check — a heuristic, and labelled as one.
 *
 * A real gamut map needs an ICC profile for the actual press, paper and ink.
 * What this does is cheaper and still useful at the design stage: it flags
 * brand colours whose chroma sits where CMYK reliably cannot follow, so a
 * conversation happens before a print run rather than after.
 *
 * Do not report its output as a measured conversion. It answers "will this
 * probably shift?", not "what will it become".
 */

export interface Cmyk { c: number; m: number; y: number; k: number }

/** Naive sRGB → CMYK. No profile, no black generation strategy, no ink limit. */
export function toCmyk(color: Rgb): Cmyk {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const k = 1 - Math.max(r, g, b);

  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return {
    c: round((1 - r - k) / (1 - k), 4),
    m: round((1 - g - k) / (1 - k), 4),
    y: round((1 - b - k) / (1 - k), 4),
    k: round(k, 4),
  };
}

function hsl(color: Rgb): { h: number; s: number; l: number } {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * Hue ranges where a saturated sRGB colour most reliably loses chroma in CMYK.
 * Vivid blues and violets are the worst offenders; saturated greens and oranges
 * follow. These bounds are rules of thumb, not a profile.
 */
const RISKY_HUES: { from: number; to: number; name: string; severity: 'high' | 'medium' }[] = [
  { from: 220, to: 290, name: 'blue to violet', severity: 'high' },
  { from: 100, to: 165, name: 'green', severity: 'medium' },
  { from: 15,  to: 45,  name: 'orange', severity: 'medium' },
  { from: 290, to: 340, name: 'magenta to pink', severity: 'medium' },
];

export interface GamutInput {
  colors: readonly { name?: string; value: string }[];
  /** Saturation above which a risky hue is flagged. */
  saturationThreshold?: number;
}

export function printGamutRisk(input: GamutInput): Measurement<{
  method: 'heuristic';
  colors: {
    name: string;
    hex: string;
    cmyk: Cmyk;
    hue: number;
    saturation: number;
    lightness: number;
    risk: 'none' | 'medium' | 'high';
    reason?: string;
  }[];
  atRisk: number;
}> {
  if (input.colors.length === 0) throw new Error('a gamut check needs at least one colour');
  const saturationThreshold = input.saturationThreshold ?? 0.6;
  const findings: Finding[] = [];

  const colors = input.colors.map((entry, index) => {
    const rgb = parseColor(entry.value);
    const { h, s, l } = hsl(rgb);
    const name = entry.name ?? `colour ${index + 1}`;

    const band = RISKY_HUES.find((r) => h >= r.from && h <= r.to);
    let risk: 'none' | 'medium' | 'high' = 'none';
    let reason: string | undefined;

    if (band && s >= saturationThreshold && l > 0.2 && l < 0.8) {
      risk = band.severity === 'high' && s >= 0.75 ? 'high' : 'medium';
      reason =
        `saturated ${band.name} (hue ${round(h, 0)}°, saturation ${round(s * 100, 0)}%) — ` +
        `a hue range CMYK reliably renders duller than screen`;
    }

    if (risk !== 'none') {
      findings.push({
        severity: risk === 'high' ? 'major' : 'minor',
        message: `${name} (${toHex(rgb)}) is likely to shift in CMYK: ${reason}.`,
        remediation:
          'Proof this colour on the actual stock before committing, or choose a spot ' +
          'ink for it. If it is the primary brand colour, decide now what the print ' +
          'equivalent is rather than letting a printer decide later.',
      });
    }

    return {
      name,
      hex: toHex(rgb),
      cmyk: toCmyk(rgb),
      hue: round(h, 1),
      saturation: round(s, 3),
      lightness: round(l, 3),
      risk,
      ...(reason ? { reason } : {}),
    };
  });

  findings.push({
    severity: 'info',
    message:
      'Gamut risk is heuristic: hue and saturation only, with no ICC profile, paper ' +
      'stock or ink limit. Treat it as a prompt to proof, not as a conversion.',
  });

  return measurement('print_gamut_risk', {
    method: 'heuristic',
    colors,
    atRisk: colors.filter((c) => c.risk !== 'none').length,
  }, findings);
}
