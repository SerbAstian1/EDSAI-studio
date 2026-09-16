import type { Target } from './types.js';

/**
 * Instrument provenance verification.
 *
 * This is the check the product's central claim rests on: a department may
 * state a target and the mechanism for hitting it, but it may not assert a
 * measurement. A value reported with `source: 'instrument'` must have been
 * produced by an instrument call in that department's own turn — not recalled,
 * not carried over from an earlier department, not merely plausible.
 *
 * A failure here is not an error to raise. The department's reasoning may be
 * entirely sound and its number merely unearned, so the value is stripped back
 * to a stated target and the violation logged, rather than the turn rejected.
 */

export interface InstrumentCall {
  instrument: string;
  input: unknown;
  output: unknown;
}

export type ViolationKind =
  | 'no-call'
  | 'wrong-instrument'
  | 'value-not-found';

export interface Violation {
  kind: ViolationKind;
  metric: string;
  claimed: string;
  instrument?: string;
  detail: string;
}

export interface VerificationResult {
  /** Targets with unearned actuals stripped back to stated targets. */
  targets: Target[];
  violations: Violation[];
}

/**
 * Character ranges that break naive matching, built by code point rather than
 * written as escapes in a pattern literal.
 *
 * Two earlier bugs in this exact function motivate the indirection: a Unicode
 * dash was read as a minus sign and silently negated a value, and an invisible
 * control byte sat inside a pattern literal where nobody could see it, so that
 * pattern never matched anything. Constructing the classes from explicit code
 * points keeps both failure modes legible in review.
 */
const DASH_CODE_POINTS = [
  0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212,
];

const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f],
  [0x007f, 0x007f], [0x200b, 0x200d], [0xfeff, 0xfeff],
];

const DASHES = new Set(DASH_CODE_POINTS.map((c) => String.fromCharCode(c)));

function isInvisible(char: string): boolean {
  const code = char.charCodeAt(0);
  return INVISIBLE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

export function normalise(text: string): string {
  let out = '';
  for (const char of text) {
    if (isInvisible(char)) continue;
    out += DASHES.has(char) ? '-' : char;
  }
  return out;
}

/**
 * Every number in a string, as numbers.
 *
 * A hyphen is only a sign when nothing or a non-digit precedes it, so
 * "4.5-7.0" reads as two positives rather than a positive and a negative,
 * while "-3.2" still reads as negative. Ratio notation such as "7.04:1" yields
 * both sides; the trailing 1 is meaningful and cheap to keep.
 */
export function numbersIn(text: string): number[] {
  const clean = normalise(text);
  const found: number[] = [];
  const pattern = /(?<![\d.])(-?)(\d+(?:\.\d+)?)/g;

  for (const match of clean.matchAll(pattern)) {
    const at = match.index ?? 0;
    const sign = match[1] ?? '';
    const digits = match[2] ?? '';
    const previous = at > 0 ? clean[at - 1] : undefined;
    const isRange = sign === '-' && previous !== undefined && /\d/.test(previous);
    const value = Number.parseFloat(digits);
    found.push(isRange || sign === '' ? value : -value);
  }
  return found;
}

/**
 * The numbers a reported actual actually claims to have measured.
 *
 * Ratio notation is the reason this is not just `numbersIn`. "7.04:1" contains
 * two numerals but asserts one measurement — the trailing 1 is the notation's
 * denominator, and no contrast instrument ever emits it as a value. Demanding
 * it be found would strip every correctly measured ratio in the system.
 */
export function claimedNumbers(text: string): number[] {
  const withoutRatioDenominator = normalise(text).replace(/(\d)\s*:\s*1(?![\d.])/g, '$1');
  return numbersIn(withoutRatioDenominator);
}

/** Every number anywhere in an instrument's output, however deeply nested. */
export function numbersOf(value: unknown, depth = 0): number[] {
  if (depth > 12) return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (typeof value === 'string') return numbersIn(value);
  if (Array.isArray(value)) return value.flatMap((v) => numbersOf(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((v) => numbersOf(v, depth + 1));
  }
  return [];
}

/** Tolerant comparison — a report may round what an instrument returned in full. */
const matches = (claimed: number, produced: number): boolean => {
  if (claimed === produced) return true;
  const scale = Math.max(Math.abs(claimed), Math.abs(produced), 1);
  if (Math.abs(claimed - produced) <= scale * 1e-9) return true;
  for (const places of [0, 1, 2, 3, 4]) {
    const factor = 10 ** places;
    if (Math.round(produced * factor) / factor === claimed) return true;
  }
  return false;
};

function strip(target: Target, reason: string): Target {
  const { actual: _actual, instrument: _instrument, pass: _pass, ...rest } = target;
  return {
    ...rest,
    source: 'stated-target',
    mechanism: target.mechanism?.trim()
      ? target.mechanism
      : `Unverified: ${reason}. State the mechanism for hitting this target, or call the instrument.`,
  };
}

/**
 * Check every instrument-sourced target against the turn's actual tool calls.
 *
 * Targets already marked `stated-target` pass through untouched — the rule only
 * constrains claims of measurement.
 */
export function verifyTargets(
  targets: readonly Target[],
  calls: readonly InstrumentCall[],
): VerificationResult {
  const violations: Violation[] = [];
  const called = new Map<string, InstrumentCall[]>();
  for (const call of calls) {
    called.set(call.instrument, [...(called.get(call.instrument) ?? []), call]);
  }

  const verified = targets.map((target) => {
    if (target.source !== 'instrument' || target.actual === undefined) return target;

    if (calls.length === 0) {
      violations.push({
        kind: 'no-call',
        metric: target.metric,
        claimed: target.actual,
        detail: `"${target.metric}" reports a measured ${target.actual}, but no instrument ran this turn.`,
      });
      return strip(target, 'no instrument ran in this turn');
    }

    const name = target.instrument;
    const relevant = name ? called.get(name) : undefined;

    if (name && !relevant) {
      violations.push({
        kind: 'wrong-instrument',
        metric: target.metric,
        claimed: target.actual,
        instrument: name,
        detail:
          `"${target.metric}" credits ${name}, which was not called this turn. ` +
          `Called: ${[...called.keys()].join(', ')}.`,
      });
      return strip(target, `${name} was not called`);
    }

    const candidates = relevant ?? calls;
    const claimed = claimedNumbers(target.actual);
    const producedNumbers = new Set(candidates.flatMap((c) => numbersOf(c.output)));

    // A purely qualitative actual ("present", "no violations") is accepted when
    // the instrument ran: there is no number to match against.
    if (claimed.length === 0) return target;

    const unmatched = claimed.filter(
      (value) => ![...producedNumbers].some((produced) => matches(value, produced)),
    );

    if (unmatched.length > 0) {
      violations.push({
        kind: 'value-not-found',
        metric: target.metric,
        claimed: target.actual,
        ...(name ? { instrument: name } : {}),
        detail:
          `"${target.metric}" reports ${target.actual}, but ` +
          `${unmatched.join(', ')} appears nowhere in the instrument output.`,
      });
      return strip(target, `${unmatched.join(', ')} was not produced by any instrument`);
    }

    return target;
  });

  return { targets: verified, violations };
}
