import { alphaBlend, alphaNote, parseColor, relativeLuminance, toHex, type Rgb } from './color.js';
import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Contrast measurement — the instrument the rest of the system leans on hardest.
 *
 * WCAG 2.1 is the conformance number and the one that gates. APCA is reported
 * alongside as a perceptual second opinion, never as the pass/fail: WCAG is what
 * an audit checks, and quietly substituting a different model would make the
 * hub's compliance claim untrue in the only sense that matters legally.
 */

/** WCAG 2.1 §1.4.3 / §1.4.6 / §1.4.11 thresholds. */
export const WCAG_THRESHOLD = {
  aaText: 4.5,
  aaLargeText: 3,
  aaaText: 7,
  aaaLargeText: 4.5,
  /** Non-text contrast: UI component boundaries and graphical objects. */
  nonText: 3,
} as const;

export type TextSize = 'normal' | 'large';
export type Usage = 'text' | 'non-text';

export interface ContrastInput {
  foreground: string;
  background: string;
  /**
   * Required when either colour is translucent. Contrast is undefined for a
   * colour with alpha on its own — what the eye sees depends on what is behind.
   */
  backdrop?: string;
  /** WCAG "large" is >= 24px, or >= 18.66px at weight 700+. */
  size?: TextSize;
  usage?: Usage;
  label?: string;
}

export interface ContrastResult {
  foreground: string;
  background: string;
  /** WCAG 2.1 ratio, 1–21, rounded to two decimals. */
  ratio: number;
  /** APCA Lc, signed: positive is dark-on-light, negative light-on-dark. */
  apcaLc: number;
  size: TextSize;
  usage: Usage;
  /** The threshold this pairing was judged against. */
  required: number;
  passes: boolean;
  /** Which conformance levels this pairing reaches, for reporting. */
  levels: { aa: boolean; aaa: boolean };
}

/** WCAG 2.1 contrast ratio between two opaque colours. */
export function ratioOf(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/* -------------------------------------------------------------------- APCA */

const APCA = {
  trc: 2.4,
  r: 0.2126729, g: 0.7151522, b: 0.0721750,
  normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
  blkThrs: 0.022, blkClmp: 1.414,
  scale: 1.14, loOffset: 0.027, loClip: 0.1, deltaYmin: 0.0005,
} as const;

/** APCA screen luminance. Note this is a simple power curve, not WCAG's piecewise one. */
function apcaY(c: Rgb): number {
  return (
    APCA.r * (c.r / 255) ** APCA.trc +
    APCA.g * (c.g / 255) ** APCA.trc +
    APCA.b * (c.b / 255) ** APCA.trc
  );
}

const softClampBlack = (y: number): number =>
  y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp;

/** APCA-W3 Lc, matching apca-w3 0.1.9. Cross-checked against that package in tests. */
export function apcaContrast(text: Rgb, background: Rgb): number {
  const txtY = softClampBlack(apcaY(text));
  const bgY = softClampBlack(apcaY(background));

  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0;

  if (bgY > txtY) {
    const sapc = (bgY ** APCA.normBG - txtY ** APCA.normTXT) * APCA.scale;
    return sapc < APCA.loClip ? 0 : (sapc - APCA.loOffset) * 100;
  }
  const sapc = (bgY ** APCA.revBG - txtY ** APCA.revTXT) * APCA.scale;
  return sapc > -APCA.loClip ? 0 : (sapc + APCA.loOffset) * 100;
}

/* --------------------------------------------------------------- the tool */

function flatten(color: Rgb, backdrop: Rgb | undefined, which: string): Rgb {
  if (color.a >= 1) return color;
  if (!backdrop) {
    throw new Error(
      `${which} is translucent (alpha ${color.a}) and no backdrop was given. ` +
      'Contrast is undefined without one — pass `backdrop`, or use contrastWorstCase.',
    );
  }
  return alphaBlend(color, backdrop);
}

export function contrast(input: ContrastInput): Measurement<ContrastResult> {
  const size = input.size ?? 'normal';
  const usage = input.usage ?? 'text';
  const backdrop = input.backdrop ? parseColor(input.backdrop) : undefined;

  const rawFg = parseColor(input.foreground);
  const rawBg = parseColor(input.background);

  // The background flattens first: a translucent foreground composites onto the
  // resolved background, not onto the backdrop directly.
  const bg = flatten(rawBg, backdrop, 'background');
  const fg = flatten(rawFg, backdrop ? bg : undefined, 'foreground');

  const ratio = round(ratioOf(fg, bg), 2);
  const required =
    usage === 'non-text'
      ? WCAG_THRESHOLD.nonText
      : size === 'large'
        ? WCAG_THRESHOLD.aaLargeText
        : WCAG_THRESHOLD.aaText;

  const passes = ratio >= required;
  const label = input.label ?? `${toHex(fg)} on ${toHex(bg)}`;

  const findings: Finding[] = [];
  const fgNote = backdrop ? alphaNote('foreground', rawFg, bg) : undefined;
  const bgNote = backdrop ? alphaNote('background', rawBg, backdrop) : undefined;
  if (fgNote) findings.push(fgNote);
  if (bgNote) findings.push(bgNote);

  if (!passes) {
    findings.push({
      severity: usage === 'non-text' || size === 'large' ? 'major' : 'blocker',
      message:
        `${label} measures ${ratio}:1 against a required ${required}:1 ` +
        `(${usage === 'non-text' ? 'WCAG 1.4.11 non-text' : `WCAG 1.4.3 AA ${size} text`}).`,
      remediation:
        `Darken or lighten one side until the ratio reaches ${required}:1. ` +
        `This pairing is ${round(((required - ratio) / required) * 100, 1)}% short.`,
    });
  }

  return measurement('contrast', {
    foreground: toHex(fg),
    background: toHex(bg),
    ratio,
    apcaLc: round(apcaContrast(fg, bg), 1),
    size,
    usage,
    required,
    passes,
    levels: {
      aa: ratio >= (size === 'large' ? WCAG_THRESHOLD.aaLargeText : WCAG_THRESHOLD.aaText),
      aaa: ratio >= (size === 'large' ? WCAG_THRESHOLD.aaaLargeText : WCAG_THRESHOLD.aaaText),
    },
  }, findings);
}

/**
 * The worst ratio a translucent surface reaches across a set of possible
 * backdrops.
 *
 * This is the case the corpus calls out directly: "flat mid-gray text over a
 * translucent surface fails against a busy backdrop". Measuring against the one
 * backdrop that happens to be in the mockup is how a translucent component ships
 * an accessibility failure that only appears over certain content.
 */
export function contrastWorstCase(
  input: Omit<ContrastInput, 'backdrop'> & { backdrops: readonly string[] },
): Measurement<ContrastResult & { worstBackdrop: string }> {
  if (input.backdrops.length === 0) {
    throw new Error('contrastWorstCase needs at least one backdrop');
  }

  let worst: (ContrastResult & { worstBackdrop: string }) | undefined;
  let worstFindings: readonly Finding[] = [];

  for (const backdrop of input.backdrops) {
    const result = contrast({ ...input, backdrop });
    if (!worst || result.value.ratio < worst.ratio) {
      worst = { ...result.value, worstBackdrop: toHex(parseColor(backdrop)) };
      worstFindings = result.findings;
    }
  }

  const value = worst as ContrastResult & { worstBackdrop: string };
  return measurement('contrast_worst_case', value, [
    ...worstFindings,
    {
      severity: 'info',
      message:
        `Worst of ${input.backdrops.length} backdrops: ${value.ratio}:1 over ${value.worstBackdrop}.`,
    },
  ]);
}
