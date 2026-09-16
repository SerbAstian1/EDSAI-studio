import { plain, section, tables } from '../markdown.js';
import type { Department, Track } from '../types.js';

/**
 * Departments and track order come from SKILL.md's pipeline tables, which are
 * the only place that states both the running order and each department's
 * reference file. The scorecard knows what a department scores; only SKILL.md
 * knows when it runs and what it reads.
 */

const TRACK_HEADINGS: { id: string; match: RegExp }[] = [
  { id: 'digital-product', match: /^Digital Product Track$/i },
  { id: 'frontend-block', match: /^Frontend Engineering Block/i },
  { id: 'brand-physical', match: /^Brand Identity & Physical Collateral Track$/i },
  { id: 'closing', match: /^Closing Procedure/i },
];

/**
 * Departments 8 and 9 do not score. The corpus states this in the scorecard's
 * §3 cells ("Measured, not scored" / "Issue-counted, not scored"); it is
 * repeated here as the reporting mode so a consumer never has to parse prose
 * to learn that Department 9 has no dimensions.
 */
function reportingMode(id: number): Department['mode'] {
  if (id === 8) return 'measured';
  if (id === 9) return 'issue-counted';
  return 'scored';
}

export interface TrackParse {
  readonly tracks: Track[];
  /** Department id → name and reference file, before dimensions are attached. */
  readonly stubs: Map<number, { name: string; reference: string }>;
}

export function parseTracks(skill: string): TrackParse {
  const tracks: Track[] = [];
  const stubs = new Map<number, { name: string; reference: string }>();

  for (const { id, match } of TRACK_HEADINGS) {
    const body = section(skill, match);
    if (!body) throw new Error(`SKILL.md: track section not found: ${match}`);

    const table = tables(body)[0];
    if (!table) throw new Error(`SKILL.md: no pipeline table under ${id}`);

    const order: number[] = [];
    for (const row of table.rows) {
      const num = Number.parseInt(plain(row[0] ?? ''), 10);
      if (!Number.isInteger(num)) continue;
      order.push(num);

      // The reference cell may name two files (Department 11 does). The first
      // is the department's own; the second is the procedure it hands off to.
      const refCell = row[row.length - 1] ?? '';
      const first = /references\/[\w.-]+\.md/.exec(refCell)?.[0];
      if (!first) throw new Error(`SKILL.md: no reference file for department ${num}`);

      if (!stubs.has(num)) stubs.set(num, { name: plain(row[1] ?? ''), reference: first });
    }

    const heading = match.source.replace(/[\^$]/g, '').replace(/\\/g, '');
    tracks.push({ id, name: heading.replace(/\/i$/, '').trim(), order });
  }

  return { tracks, stubs };
}
