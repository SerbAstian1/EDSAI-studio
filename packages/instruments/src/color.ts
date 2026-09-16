import type { Finding } from './types.js';

/**
 * Colour parsing and the sRGB maths every contrast calculation stands on.
 *
 * Kept separate from `contrast.ts` because the same conversions serve the
 * palette matrix, the print-gamut heuristic, and any future instrument that
 * needs luminance — and because a bug here would be invisible in all of them
 * at once, so it gets its own tests.
 */

export interface Rgb {
  /** 0–255. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0–1. Opaque unless the input carried alpha. */
  readonly a: number;
}

const HEX = /^#?([0-9a-f]{3,8})$/i;
const RGB_FN = /^rgba?\(\s*([^)]+)\)$/i;

function expand(short: string): string {
  return short.split('').map((c) => c + c).join('');
}

/**
 * Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, and rgb()/rgba() with comma or space
 * separators. Percentages are accepted for channels because design tokens use
 * them; named colours deliberately are not — a token file that says "red" has a
 * token-discipline problem the type scale audit should catch, not a parsing
 * problem this function should paper over.
 */
export function parseColor(input: string): Rgb {
  const text = input.trim();

  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1] ?? '';
    if (digits.length === 3 || digits.length === 4) digits = expand(digits);
    if (digits.length !== 6 && digits.length !== 8) {
      throw new Error(`unparseable colour: ${input}`);
    }
    const value = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16);
    return {
      r: value(0),
      g: value(2),
      b: value(4),
      a: digits.length === 8 ? value(6) / 255 : 1,
    };
  }

  const fn = RGB_FN.exec(text);
  if (fn) {
    const parts = (fn[1] ?? '').split(/[,/\s]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) throw new Error(`unparseable colour: ${input}`);

    const channel = (raw: string): number => {
      const n = Number.parseFloat(raw);
      if (Number.isNaN(n)) throw new Error(`unparseable colour: ${input}`);
      return clamp(raw.endsWith('%') ? (n / 100) * 255 : n, 0, 255);
    };
    const alphaPart = parts[3];
    const alpha = alphaPart === undefined
      ? 1
      : clamp(alphaPart.endsWith('%') ? Number.parseFloat(alphaPart) / 100 : Number.parseFloat(alphaPart), 0, 1);

    return {
      r: channel(parts[0] ?? ''),
      g: channel(parts[1] ?? ''),
      b: channel(parts[2] ?? ''),
      a: alpha,
    };
  }

  throw new Error(`unparseable colour: ${input}`);
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function toHex({ r, g, b }: Rgb): string {
  const pair = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`.toUpperCase();
}

/** WCAG 2.1 sRGB channel linearisation. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * linearise(color.r) +
    0.7152 * linearise(color.g) +
    0.0722 * linearise(color.b)
  );
}

/**
 * Composite a translucent foreground over an opaque backdrop.
 *
 * Contrast is undefined for a translucent colour on its own: what the eye sees
 * depends entirely on what is behind it. Every contrast call therefore flattens
 * first, and `contrast.ts` requires a backdrop whenever alpha is below 1.
 */
export function alphaBlend(foreground: Rgb, backdrop: Rgb): Rgb {
  if (foreground.a >= 1) return foreground;
  const mix = (f: number, b: number): number => f * foreground.a + b * (1 - foreground.a);
  return {
    r: mix(foreground.r, backdrop.r),
    g: mix(foreground.g, backdrop.g),
    b: mix(foreground.b, backdrop.b),
    a: 1,
  };
}

/** A note when a colour carried alpha, so a report can say what it was flattened onto. */
export function alphaNote(label: string, color: Rgb, backdrop: Rgb): Finding | undefined {
  if (color.a >= 1) return undefined;
  return {
    severity: 'info',
    message:
      `${label} is translucent (alpha ${color.a}); measured after compositing onto ${toHex(backdrop)}.`,
    remediation:
      'State the backdrop this surface is guaranteed to sit on, or measure against the worst case.',
  };
}
