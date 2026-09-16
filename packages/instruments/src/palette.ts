import { contrast, WCAG_THRESHOLD, type TextSize, type Usage } from './contrast.js';
import { parseColor, toHex } from './color.js';
import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Palette audit — every pairing in a token set, measured at once.
 *
 * This is the instrument the brand hub renders. A designer states which
 * foreground tokens are used on which surfaces, and every one of those pairings
 * gets a ratio, a verdict, and a remediation. The value is in the completeness:
 * a palette does not fail as a whole, it fails at the one pairing nobody checked.
 */

export interface PaletteToken {
  name: string;
  value: string;
  /** How this token is used, which decides the threshold it faces. */
  role?: 'text' | 'large-text' | 'non-text' | 'surface';
}

export interface PaletteInput {
  tokens: readonly PaletteToken[];
  /**
   * Pairings to check as [foreground, background] token names. When omitted,
   * every non-surface token is checked against every surface token — the
   * exhaustive reading, which is the right default for a palette nobody has
   * audited before.
   */
  pairings?: readonly [string, string][];
}

export interface PaletteRow {
  foreground: string;
  background: string;
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
  apcaLc: number;
  required: number;
  passes: boolean;
  size: TextSize;
  usage: Usage;
}

export function auditPalette(input: PaletteInput): Measurement<{
  rows: PaletteRow[];
  passing: number;
  failing: number;
  passRate: number;
  worst?: PaletteRow;
}> {
  if (input.tokens.length < 2) throw new Error('a palette audit needs at least two tokens');

  const byName = new Map(input.tokens.map((t) => [t.name, t]));
  const surfaces = input.tokens.filter((t) => t.role === 'surface');
  const foregrounds = input.tokens.filter((t) => t.role && t.role !== 'surface');

  const pairs: [string, string][] = input.pairings
    ? [...input.pairings]
    : foregrounds.flatMap((fg) => surfaces.map((bg): [string, string] => [fg.name, bg.name]));

  if (pairs.length === 0) {
    throw new Error(
      'no pairings to check — give explicit `pairings`, or mark tokens with a `role` ' +
      'so foregrounds and surfaces can be paired automatically',
    );
  }

  const findings: Finding[] = [];
  const rows: PaletteRow[] = [];

  for (const [fgName, bgName] of pairs) {
    const fg = byName.get(fgName);
    const bg = byName.get(bgName);
    if (!fg) throw new Error(`unknown token in pairing: ${fgName}`);
    if (!bg) throw new Error(`unknown token in pairing: ${bgName}`);

    const size: TextSize = fg.role === 'large-text' ? 'large' : 'normal';
    const usage: Usage = fg.role === 'non-text' ? 'non-text' : 'text';

    const result = contrast({
      foreground: fg.value,
      background: bg.value,
      size,
      usage,
      label: `${fgName} on ${bgName}`,
    });

    rows.push({
      foreground: fgName,
      background: bgName,
      foregroundHex: toHex(parseColor(fg.value)),
      backgroundHex: toHex(parseColor(bg.value)),
      ratio: result.value.ratio,
      apcaLc: result.value.apcaLc,
      required: result.value.required,
      passes: result.value.passes,
      size,
      usage,
    });

    findings.push(...result.findings.filter((f) => f.severity !== 'info'));
  }

  const failing = rows.filter((r) => !r.passes);
  const worst = rows.reduce<PaletteRow | undefined>(
    (acc, r) => (!acc || r.ratio - r.required < acc.ratio - acc.required ? r : acc),
    undefined,
  );

  if (failing.length > 0) {
    findings.unshift({
      severity: 'major',
      message:
        `${failing.length} of ${rows.length} pairings fail their threshold: ` +
        failing.map((r) => `${r.foreground} on ${r.background} (${r.ratio}:1 < ${r.required}:1)`).join('; '),
      remediation:
        'Each failing pairing needs one side adjusted, or a stated decision that the ' +
        'pairing is never used. A palette is only as accessible as its worst live combination.',
    });
  }

  return measurement('palette_audit', {
    rows,
    passing: rows.length - failing.length,
    failing: failing.length,
    passRate: round((rows.length - failing.length) / rows.length, 4),
    ...(worst ? { worst } : {}),
  }, findings);
}

/** Thresholds re-exported so a hub can render what a row was judged against. */
export { WCAG_THRESHOLD };
