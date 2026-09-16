import { plain, section, tables } from '../markdown.js';
import type { Dimension, Drift } from '../types.js';

/**
 * Reads each department's own `## Scorecard` table and reconciles it against
 * the canonical list in `00-scorecard.md §3`.
 *
 * The corpus is a hand-maintained document in two places at once: a department
 * file states what it scores, and the scorecard restates it so Arbitration can
 * read one list. Those two can disagree, and when they do it is a finding about
 * the corpus rather than a bug in this parser — so drift is returned, not thrown.
 */

/** Several departments share a reference file, delimited by an uppercase H1. */
const DEPARTMENT_BLOCK = /^#\s+DEPARTMENT\s+(\d+)\s*[—–-]/gim;

/** Isolate one department's markdown from a file that may hold several. */
export function departmentBlock(markdown: string, id: number): string | undefined {
  const heads = [...markdown.matchAll(DEPARTMENT_BLOCK)];
  if (heads.length === 0) return markdown; // single-department file

  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (!head || Number.parseInt(head[1] ?? '', 10) !== id) continue;
    const start = head.index ?? 0;
    const end = heads[i + 1]?.index ?? markdown.length;
    return markdown.slice(start, end);
  }
  return undefined;
}

/** The dimensions a department's own file scores, or [] when it does not score. */
export function parseDepartmentDimensions(
  markdown: string,
  id: number,
  reference: string,
): Dimension[] {
  const block = departmentBlock(markdown, id);
  if (!block) return [];

  const scorecard = section(block, /^Scorecard/i);
  if (!scorecard) return [];

  const table = tables(scorecard)[0];
  if (!table) return [];

  return table.rows
    .map((row) => plain(row[0] ?? ''))
    .filter((label) => label.length > 0 && !/^dimension$/i.test(label))
    .map((label) => ({
      // Department files annotate direction inline — "Code Coupling (inverse —
      // 10 = least coupled)". The annotation is documentation of the scale, not
      // part of the dimension's name, so it is lifted into the flag and dropped
      // from the name. Keeping it would make every inverse dimension read as
      // drift against §3, which abbreviates.
      name: label.replace(/\s*\([^)]*\)\s*/g, ' ').trim(),
      scope: id,
      inverse: /\binverse\b/i.test(label),
      source: reference,
    }));
}

/**
 * The measurable targets a department reports against. `00-scorecard.md §4`
 * groups these by discipline; each department file restates the ones it owns,
 * which is the list a run actually has to fill.
 */
export function parseDepartmentTargets(markdown: string, id: number): string[] {
  const block = departmentBlock(markdown, id);
  if (!block) return [];

  const targets = section(block, /^Real Measurable Targets/i);
  if (!targets) return [];

  return targets
    .split('\n')
    .map((line) => /^\s*[-*]\s+(.*)$/.exec(line)?.[1] ?? '')
    .map((text) => plain(text))
    .filter((text) => text.length > 0);
}

const normalise = (name: string): string =>
  name.toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[^a-z0-9]+/g, '');

/**
 * Compare the two statements of a department's dimensions and report what
 * differs. The union is what the department actually scores: a dimension a
 * department file defines is real whether or not §3 caught up with it.
 */
export function reconcile(
  id: number,
  canonical: readonly Dimension[],
  fromFile: readonly Dimension[],
): { dimensions: Dimension[]; drift: Drift[] } {
  const drift: Drift[] = [];
  const byKey = new Map<string, Dimension>();

  for (const dim of canonical) byKey.set(normalise(dim.name), dim);

  for (const dim of fromFile) {
    const key = normalise(dim.name);
    const match = byKey.get(key);
    if (!match) {
      byKey.set(key, dim);
      drift.push({
        departmentId: id,
        kind: 'missing-from-canonical',
        dimension: dim.name,
        detail:
          `Department ${id}'s reference file scores "${dim.name}", but the canonical list ` +
          `in 00-scorecard.md §3 does not include it. Treated as scored.`,
      });
      continue;
    }
    // The department file is the more specific statement, so it wins on wording
    // and on the inverse flag; §3 abbreviates.
    if (match.name !== dim.name) {
      drift.push({
        departmentId: id,
        kind: 'name-mismatch',
        dimension: dim.name,
        detail: `00-scorecard.md §3 calls this "${match.name}"; the department file calls it "${dim.name}".`,
      });
    }
  }

  const fromFileKeys = new Set(fromFile.map((d) => normalise(d.name)));
  for (const dim of canonical) {
    if (fromFile.length > 0 && !fromFileKeys.has(normalise(dim.name))) {
      drift.push({
        departmentId: id,
        kind: 'missing-from-department',
        dimension: dim.name,
        detail:
          `00-scorecard.md §3 lists "${dim.name}" for Department ${id}, but the department's ` +
          `own reference file does not score it.`,
      });
    }
  }

  return { dimensions: [...byKey.values()], drift };
}
