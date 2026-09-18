import { z } from 'zod';
import { contrast } from '@edsai/instruments';

/**
 * The brand system: the values a client actually works from.
 *
 * **Where these come from, and why that is not duplication.** A run produces
 * `BrandToken`s under provenance, and that record is immutable — it is the audit
 * of what the pipeline computed on a given day. The brand is the *living*
 * version: seeded from a run, then owned by the designer. The direction only
 * ever goes one way, and `sourceRunId` records where each value started, so
 * "where did this come from" has an answer that is not a guess.
 *
 * **Every value stays measured.** An edited colour is re-measured by the same
 * instrument on save, so the hub's claim — every value carries its measurement —
 * survives a designer typing a hex code. What changes is `origin`, not whether
 * there is a number.
 *
 * **A reason is required only when an edit breaks something.** Demanding
 * justification for every nudge produces a database full of "updated", which is
 * worse than an empty field because it looks like an answer. The reason exists
 * so that a *failing* value is not mysterious to whoever meets it next; a change
 * that stays passing needs no defence.
 */

export const BrandValueKind = z.enum(['color', 'font', 'size', 'space', 'radius', 'text']);
export type BrandValueKind = z.infer<typeof BrandValueKind>;

export const BrandValue = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  kind: BrandValueKind,
  value: z.string().min(1),
  role: z.string().optional(),
  /**
   * For a colour: the token it is read against. A colour alone has no contrast;
   * it only has one in a pairing, and leaving the pairing implicit is how a
   * swatch ends up labelled "accessible" with nothing behind it.
   */
  against: z.string().optional(),
  /** Whether the current value came from a run or from a person. */
  origin: z.enum(['run', 'studio']).default('run'),
  /** The run this value was seeded from, if it was. */
  sourceRunId: z.string().optional(),
  /** Required only when an edit made this value fail. */
  reason: z.string().optional(),
  updatedAt: z.string(),
});
export type BrandValue = z.infer<typeof BrandValue>;

/** What the instrument says about a value right now. */
export interface Measured {
  /** Absent when this kind of value has nothing to measure. */
  ratio?: number;
  required?: number;
  passes?: boolean;
  against?: string;
  /** Plain-language note for a client, never a scorecard. */
  note?: string;
}

const WHITE = '#FFFFFF';

/** The colour a token is read against, resolved through the set. */
export function groundFor(
  value: BrandValue, values: readonly BrandValue[],
): { name: string; color: string } {
  const named = value.against
    ? values.find((v) => v.name === value.against && v.kind === 'color')
    : undefined;
  if (named) return { name: named.name, color: named.value };

  // Default to the lightest surface in the set, which is what body text will
  // actually sit on more often than not.
  const surface = values.find((v) =>
    v.kind === 'color' && /surface|paper|background|ground/i.test(`${v.name} ${v.role ?? ''}`));
  return surface
    ? { name: surface.name, color: surface.value }
    : { name: 'white', color: WHITE };
}

/**
 * Re-measure a value.
 *
 * Only colour has an instrument behind it today. Everything else returns an
 * empty measurement rather than a fabricated one — a font name has no ratio, and
 * inventing a number for it would be the exact failure this system exists to
 * prevent.
 */
export function measure(value: BrandValue, values: readonly BrandValue[]): Measured {
  if (value.kind !== 'color') return {};

  const ground = groundFor(value, values);

  // A surface has no contrast of its own — its contrast is a property of what
  // sits on it. Measuring it against itself returns 1:1 and flags the brand's
  // own background as failing, which is a false alarm on the one colour that
  // cannot be wrong. Caught by walking the real screen, where `paper` appeared
  // under a "1 below target" badge.
  if (ground.name === value.name) return {};
  const large = /display|heading|headline|large/i.test(`${value.name} ${value.role ?? ''}`);
  const nonText = /border|line|edge|rule|divider|icon|surface|paper|background|ground/i
    .test(`${value.name} ${value.role ?? ''}`);

  try {
    const result = contrast({
      foreground: value.value,
      background: ground.color,
      ...(large ? { size: 'large' as const } : {}),
      ...(nonText ? { usage: 'non-text' as const } : {}),
    });
    return {
      ratio: result.value.ratio,
      required: result.value.required,
      passes: result.value.passes,
      against: ground.name,
      note: result.value.passes
        ? `${result.value.ratio}:1 against ${ground.name} — clears the ${result.value.required}:1 it needs.`
        : `${result.value.ratio}:1 against ${ground.name} — under the ${result.value.required}:1 it needs.`,
    };
  } catch {
    // An unparseable colour is a fact about the value, not a crash.
    return { note: 'This is not a colour any renderer will understand.' };
  }
}

/**
 * Whether a string is a colour at all.
 *
 * Kept separate from whether it has a *measurement*: a ground has no ratio
 * because there is nothing behind it, which is not the same as being
 * unparseable. Conflating the two refused a legitimate edit to the background.
 */
export function isColor(value: string): boolean {
  try {
    contrast({ foreground: value, background: '#FFFFFF' });
    return true;
  } catch {
    return false;
  }
}

export class EditRefused extends Error {
  constructor(readonly reason: 'unmeasurable' | 'needs-reason', message: string) {
    super(message);
    this.name = 'EditRefused';
  }
}

export interface EditResult {
  value: BrandValue;
  measured: Measured;
  /** True when this edit turned a passing value into a failing one. */
  regressed: boolean;
}

/**
 * Apply a designer's edit.
 *
 * The rule that keeps this usable: a reason is demanded only when the edit
 * introduces a failure. Everything else saves on the spot.
 */
export function applyEdit(
  existing: BrandValue,
  next: { value: string; against?: string; role?: string; reason?: string },
  values: readonly BrandValue[],
  now = new Date(),
): EditResult {
  const before = measure(existing, values);

  const candidate: BrandValue = BrandValue.parse({
    ...existing,
    value: next.value,
    ...(next.against !== undefined ? { against: next.against } : {}),
    ...(next.role !== undefined ? { role: next.role } : {}),
    origin: 'studio',
    updatedAt: now.toISOString(),
    ...(next.reason?.trim() ? { reason: next.reason.trim() } : { reason: undefined }),
  });

  // Measure against the set with this value already replaced, so a token that
  // is itself a ground is judged against what it is becoming.
  const updatedSet = values.map((v) =>
    v.name === candidate.name && v.clientId === candidate.clientId ? candidate : v);
  const after = measure(candidate, updatedSet);

  if (candidate.kind === 'color' && !isColor(candidate.value)) {
    throw new EditRefused(
      'unmeasurable',
      `"${next.value}" is not a colour this can measure. Use a hex, rgb() or hsl() value.`,
    );
  }

  const regressed = before.passes === true && after.passes === false;
  if (regressed && !candidate.reason) {
    throw new EditRefused(
      'needs-reason',
      `This change takes ${candidate.name} to ${after.ratio}:1, under the ${after.required}:1 `
      + 'it needs. That is allowed, but say why — whoever meets this next will want to know '
      + 'it was a decision rather than an accident.',
    );
  }

  return { value: candidate, measured: after, regressed };
}

/**
 * Seed a brand from what a run produced.
 *
 * Existing values are never overwritten: a designer's edit outranks a later
 * re-seed, because the alternative is a run quietly undoing an hour of work.
 */
export function seedFromRun(
  clientId: string,
  runId: string,
  // Widened to match what Zod infers for an optional field under
  // `exactOptionalPropertyTypes`, so a BrandToken passes without a cast.
  tokens: readonly { name: string; kind: string; value: string; role?: string | undefined }[],
  existing: readonly BrandValue[],
  now = new Date(),
): BrandValue[] {
  const known = new Set(existing.map((v) => v.name));
  return tokens
    .filter((token) => !known.has(token.name))
    .filter((token) => BrandValueKind.safeParse(token.kind).success)
    .map((token) => BrandValue.parse({
      clientId,
      name: token.name,
      kind: token.kind,
      value: token.value,
      ...(token.role ? { role: token.role } : {}),
      origin: 'run',
      sourceRunId: runId,
      updatedAt: now.toISOString(),
    }));
}

/** What the client sees: the value, what it measures, and nothing procedural. */
export interface ClientFacingValue {
  name: string;
  kind: BrandValueKind;
  value: string;
  role?: string;
  note?: string;
  passes?: boolean;
}

/**
 * The client-facing projection.
 *
 * Deliberately drops `origin`, `reason` and `sourceRunId`. Whether a value was
 * computed or typed is the studio's business; the client needs the value, what
 * it is for, and whether it holds up. Showing them "changed by hand, because…"
 * on every swatch would turn their reference into our changelog.
 */
export function forClient(values: readonly BrandValue[]): ClientFacingValue[] {
  return values.map((value) => {
    const measured = measure(value, values);
    return {
      name: value.name,
      kind: value.kind,
      value: value.value,
      ...(value.role ? { role: value.role } : {}),
      ...(measured.note ? { note: measured.note } : {}),
      ...(measured.passes !== undefined ? { passes: measured.passes } : {}),
    };
  });
}
