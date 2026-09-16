import { plain, section, tables } from '../markdown.js';
import type { Dimension, RollUp, Severity, TargetDiscipline } from '../types.js';

/** Split on commas that sit outside parentheses, so "(inverse — lower, see below)" stays whole. */
function splitOutsideParens(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const NOT_SCORED = /measured,\s*not scored|issue-counted,\s*not scored/i;

/** `00-scorecard.md §2` — the four dimensions scored in every department. */
export function parseUniversalDimensions(scorecard: string): Dimension[] {
  const body = section(scorecard, /^2\.\s*The Universal Dimensions/i);
  if (!body) throw new Error('00-scorecard.md: section 2 not found');
  const table = tables(body)[0];
  if (!table) throw new Error('00-scorecard.md: no table in section 2');

  return table.rows.map((row) => ({
    name: plain(row[0] ?? ''),
    scope: 'universal' as const,
    inverse: false,
    question: plain(row[1] ?? ''),
    source: 'references/00-scorecard.md',
  }));
}

export interface CanonicalDimensions {
  /** Department id → the dimensions §3 says it scores. */
  readonly byDepartment: Map<number, Dimension[]>;
  /** The four names the corpus calls out as inverse, read from its own prose. */
  readonly declaredInverse: string[];
}

/** `00-scorecard.md §3` — the canonical per-department dimension list. */
export function parseCanonicalDimensions(scorecard: string): CanonicalDimensions {
  const body = section(scorecard, /^3\.\s*Department-Specific Dimensions/i);
  if (!body) throw new Error('00-scorecard.md: section 3 not found');

  // Two tables: the main track, then the Frontend Engineering Block.
  const found = tables(body);
  if (found.length < 2) throw new Error('00-scorecard.md: expected 2 dimension tables in section 3');

  const declaredInverse = [
    ...body.matchAll(/\*\*Inverse dimensions\*\*\s*\(([^)]*)\)/g),
  ].flatMap((m) => splitOutsideParens(m[1] ?? '').map((s) => s.trim()));

  const byDepartment = new Map<number, Dimension[]>();

  for (const table of found.slice(0, 2)) {
    for (const row of table.rows) {
      const label = plain(row[0] ?? '');
      const id = Number.parseInt(label, 10);
      if (!Number.isInteger(id)) continue;

      const cell = row[1] ?? '';
      if (NOT_SCORED.test(cell)) {
        byDepartment.set(id, []);
        continue;
      }

      const dims = splitOutsideParens(plain(cell)).map((part) => {
        const inverse = /\binverse\b/i.test(part);
        const name = part.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        return {
          name,
          scope: id,
          inverse,
          source: 'references/00-scorecard.md',
        } satisfies Dimension;
      });
      byDepartment.set(id, dims);
    }
  }

  return { byDepartment, declaredInverse };
}

/** `00-scorecard.md §3` — the cross-cutting roll-ups Arbitration reports. */
export function parseRollUps(scorecard: string): RollUp[] {
  const body = section(scorecard, /^Cross-cutting engineering roll-ups$/i);
  if (!body) throw new Error('00-scorecard.md: roll-up section not found');
  const table = tables(body)[0];
  if (!table) throw new Error('00-scorecard.md: no roll-up table');

  return table.rows.map((row) => ({
    name: plain(row[0] ?? ''),
    composedFrom: splitOutsideParens(plain(row[1] ?? '')),
  }));
}

/** `00-scorecard.md §5` — QA's severity model and what blocks FINAL. */
export function parseSeverities(scorecard: string): Severity[] {
  const body = section(scorecard, /^5\.\s*Issue Counting/i);
  if (!body) throw new Error('00-scorecard.md: section 5 not found');
  const table = tables(body)[0];
  if (!table) throw new Error('00-scorecard.md: no severity table');

  return table.rows.map((row) => {
    const name = plain(row[0] ?? '') as Severity['name'];
    const targetForFinal = plain(row[2] ?? '');
    return {
      name,
      definition: plain(row[1] ?? ''),
      targetForFinal,
      // The corpus sets a target of 0 for the two that block, and says so in
      // prose immediately below: "any open Blocker or Major... is not final".
      blocksFinal: targetForFinal === '0',
    };
  });
}

/** `00-scorecard.md §4` — the measurable targets, kept as the corpus words them. */
export function parseMeasurableTargets(scorecard: string): TargetDiscipline[] {
  const body = section(scorecard, /^4\.\s*Real Measurable Targets/i);
  if (!body) throw new Error('00-scorecard.md: section 4 not found');
  const table = tables(body)[0];
  if (!table) throw new Error('00-scorecard.md: no targets table');

  return table.rows.map((row) => ({
    discipline: plain(row[0] ?? ''),
    // Each cell lists several measurables separated by commas; parentheses hold
    // examples that contain their own commas, so the paren-aware split matters.
    targets: splitOutsideParens(plain(row[1] ?? '')),
  }));
}
