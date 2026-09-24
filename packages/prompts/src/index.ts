import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  corpusRoot, dimensionsFor, type Department, type Rubric, type SystemLevel,
} from '@edsai/rubric';

/**
 * Prompt assembly.
 *
 * The shape matters more than the wording. Caching is a prefix match, so
 * everything stable goes first and never varies between departments of the same
 * kind, and everything volatile goes after the last cache breakpoint. A single
 * timestamp or an unsorted list in the prefix costs the discount on every call
 * in a twenty-minute run.
 */

export interface PromptBlock {
  /** Blocks before the breakpoint are cached; blocks after it vary per call. */
  stable: boolean;
  label: string;
  text: string;
}

export interface AssembledPrompt {
  blocks: PromptBlock[];
  /** Index of the last stable block — where the cache breakpoint belongs. */
  cacheBreakpoint: number;
  system: string;
  user: string;
}

const read = (file: string, root: string): string =>
  readFileSync(join(root, file.replace(/^references\//, 'references/')), 'utf8');

/**
 * The frozen prefix: the core rules, the scorecard, the composition catalog,
 * and this department's own reference file.
 *
 * Read in a fixed order with no interpolation of anything that could vary, so
 * two runs of the same department a week apart produce a byte-identical prefix.
 */
export function stableBlocks(department: Department, root = corpusRoot()): PromptBlock[] {
  return [
    { stable: true, label: 'skill-core', text: readFileSync(join(root, 'SKILL.md'), 'utf8') },
    { stable: true, label: 'scorecard', text: read('references/00-scorecard.md', root) },
    { stable: true, label: 'composition', text: read('references/composition-frameworks.md', root) },
    { stable: true, label: `department-${department.id}`, text: read(department.reference, root) },
  ];
}

export interface VolatileContext {
  brief: string;
  level: SystemLevel;
  classificationDefence?: string;
  scopeNote?: string;
  /** Upstream department outputs, in pipeline order. Each becomes its own block. */
  upstream: readonly { departmentId: number; name: string; body: string }[];
  /**
   * The positioning chart, for the department that places brands on it.
   * The client's own point is computed from their answers and stated here
   * as a fact; the department is asked for the others.
   */
  positioning?: {
    axes: readonly { id: string; label: string; low: string; high: string }[];
    own: readonly { axis: string; value: number; evidence: string }[];
    /** Who the client would hate to be mistaken for, in their words. */
    antiReference?: string;
  };
}

function positioningBlock(p: NonNullable<VolatileContext['positioning']>): string {
  return [
    '# Positioning chart',
    '',
    'The studio draws the client and the brands they will be compared with on two-axis',
    'charts. Every axis runs 0–100 from its first pole to its second:',
    '',
    ...p.axes.map((a) => `- **${a.id}** ${a.label}: 0 = ${a.low}, 100 = ${a.high}`),
    '',
    p.own.length > 0
      ? 'The client\'s own point is **computed from their discovery answers** and is not yours to move:'
      : 'The client has not answered discovery yet, so their own point is absent.',
    ...p.own.map((o) => `- ${o.axis} = ${o.value} — they chose: "${o.evidence}"`),
    '',
    ...(p.antiReference ? [`They would hate to be mistaken for: ${p.antiReference}`, ''] : []),
    '## What to submit',
    '',
    'In `comparators`, name two to four brands the client will actually be compared with —',
    'the one above if it is a real brand, direct competitors, the category default — and',
    'place each on at least two of the axes with one sentence saying why. These are drawn as',
    '*proposed* points, apart from the client\'s computed one and from anything the studio',
    'placed by hand, so state a judgement, not a measurement.',
  ].join('\n');
}

export function volatileBlocks(context: VolatileContext): PromptBlock[] {
  const blocks: PromptBlock[] = [
    {
      stable: false,
      label: 'brief',
      text: [
        '# Project brief',
        '',
        context.brief,
        '',
        `Frontend System Level: ${context.level}` +
        (context.classificationDefence ? ` — ${context.classificationDefence}` : ''),
        ...(context.scopeNote ? ['', `Delivery scope: ${context.scopeNote}`] : []),
      ].join('\n'),
    },
  ];

  for (const upstream of context.upstream) {
    blocks.push({
      stable: false,
      label: `upstream-${upstream.departmentId}`,
      text: `# Department ${upstream.departmentId} — ${upstream.name} (output)\n\n${upstream.body}`,
    });
  }
  if (context.positioning) {
    blocks.push({ stable: false, label: 'positioning', text: positioningBlock(context.positioning) });
  }
  return blocks;
}

/**
 * The department's instruction: what to produce and what the schema will refuse.
 *
 * The rules restated here are the ones the engine mechanically enforces, so a
 * department that ignores them gets its turn rejected or its numbers stripped.
 * Restating them is not redundancy — it is the difference between a rejection
 * the model can correct and one it cannot understand.
 */
export function instruction(rubric: Rubric, department: Department): string {
  const dimensions = dimensionsFor(rubric, department.id);
  const lines = [
    `# Your turn: Department ${department.id} — ${department.name}`,
    '',
    'Reason through this department in full, using its reference file above. Then report.',
    '',
    '## Body',
    '',
    'Open the body with a `## Summary` section of three to five one-sentence bullets.',
    'State the decision, why it matters, and what to do next in everyday language. Avoid',
    'department names, process labels and unexplained jargon. Put full reasoning under',
    'separate headings so the interface can show the short summary first.',
    '',
  ];

  if (department.mode === 'scored') {
    lines.push(
      '## Scores',
      '',
      'Score every dimension below, 1-10, each with a one-sentence justification naming what',
      'is specifically true of this department here. An empty justification is rejected by the',
      'schema. Never default to the middle of the range out of habit.',
      '',
      ...dimensions.map((d) => `- ${d.name}${d.inverse ? ' (inverse — 10 is least)' : ''}`),
      '',
    );
  } else if (department.mode === 'measured') {
    lines.push('## Targets', '', 'This department is measured, not scored. Report targets only.', '');
  } else {
    lines.push(
      '## Issues',
      '',
      'This department counts issues by severity rather than scoring. Every issue must name the',
      'departments it traces to; an untraced issue is rejected.',
      '',
    );
  }

  lines.push(
    '## Numbers',
    '',
    'You may state a target and the design decision that will hit it. You may not assert a',
    'measurement. To report an `actual`, call the relevant instrument in this turn and set',
    '`source: "instrument"` with the instrument name. Any actual not produced by a call this',
    'turn is stripped and logged as a violation — the reasoning survives, the number does not.',
    '',
    '## Compositions',
    '',
    'Any layout, arrangement or key-art decision must name a structure from the composition',
    'catalog and state the eye-path in one sentence. Adjectives alone do not satisfy this.',
    '',
  );

  return lines.join('\n');
}

export function assemble(
  rubric: Rubric,
  department: Department,
  context: VolatileContext,
  root = corpusRoot(),
): AssembledPrompt {
  const stable = stableBlocks(department, root);
  const volatile = volatileBlocks(context);
  const blocks = [...stable, ...volatile];

  return {
    blocks,
    cacheBreakpoint: stable.length - 1,
    system: stable.map((b) => b.text).join('\n\n---\n\n'),
    user: [...volatile.map((b) => b.text), instruction(rubric, department)].join('\n\n---\n\n'),
  };
}

/** Rough token estimate, for cost reporting before a run. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function estimatePrompt(prompt: AssembledPrompt): {
  stableTokens: number;
  volatileTokens: number;
  totalTokens: number;
} {
  const stableTokens = prompt.blocks
    .filter((b) => b.stable)
    .reduce((n, b) => n + estimateTokens(b.text), 0);
  const volatileTokens = prompt.blocks
    .filter((b) => !b.stable)
    .reduce((n, b) => n + estimateTokens(b.text), 0);
  return { stableTokens, volatileTokens, totalTokens: stableTokens + volatileTokens };
}
