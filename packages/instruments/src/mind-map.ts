import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Department 12's narrowing, checked.
 *
 * The department exists to prevent one thing: *"generating one idea and calling
 * it exploration, or generating ten superficially-different ideas that are all
 * restatements of the same concept."* Its first failure condition is the
 * computable form of that — **fewer than three genuinely distinct conceptual
 * territories explored before narrowing** — and the branch a surviving direction
 * came from is data, not opinion.
 *
 * What this instrument can and cannot see:
 *
 * - It **can** count territories, check the 3–5 bound, verify every direction
 *   cites a Department 1 or 2 input, and flag directions whose stated concepts
 *   are lexically near-identical — ten renders of one idea leave a trace in the
 *   words used to describe them.
 * - It **cannot** run the competitor-swap test, judge longevity, or tell a
 *   genuine metaphor from a tired one. Those are the department's judgement and
 *   are not simulated here.
 *
 * Department 12 never produces final logo art, and nothing in this file moves
 * toward doing so. It counts and compares text.
 */

export const MIND_MAP_TARGET = {
  /** 12.1's named branches. */
  branches: [
    'literal', 'metaphor', 'letterform', 'abstract', 'cultural',
  ] as const,
  /** 12.1's own floor: fewer than three territories is the named failure. */
  minTerritories: 3,
  /** 12.3 narrows to 3–5. */
  minDirections: 3,
  maxDirections: 5,
  /**
   * Jaccard overlap of content words above which two direction concepts are
   * treated as restatements. This instrument's constant, not the corpus's —
   * the corpus states the rule qualitatively ("all variations on one idea").
   */
  restatementOverlap: 0.5,
} as const;

export type Branch = typeof MIND_MAP_TARGET.branches[number];

export interface MindMapNode {
  id: string;
  branch: Branch;
  text: string;
}

export interface Direction {
  name: string;
  /** The idea in plain language — 12.4's core concept. */
  concept: string;
  /** Which divergent branch(es) this direction came from. */
  branches: readonly Branch[];
  /** The specific Department 1 or 2 input this traces to. Absent means untraced. */
  tracesTo?: string;
  /** 12.4's construction logic. */
  construction?: string;
  /** The catalog structure the construction is built on, for geometric marks. */
  structure?: string;
  risk?: string;
}

export interface MindMapInput {
  /** The divergent stage, before narrowing. */
  nodes?: readonly MindMapNode[];
  /** The surviving directions. */
  directions: readonly Direction[];
}

export interface MindMapResult {
  branchesExplored: Branch[];
  branchesMissing: Branch[];
  nodesPerBranch: { branch: Branch; nodes: number }[];
  directionCount: number;
  territories: Branch[];
  territoryCount: number;
  /** True when the survivors come from fewer territories than the corpus's floor. */
  collapsed: boolean;
  untraced: string[];
  withoutConstruction: string[];
  /** Pairs whose concepts overlap past the restatement threshold. */
  restatements: { a: string; b: string; overlap: number }[];
  /** Nodes reaching the same idea from different branches — 12.2's signal. */
  crossPollinated: { branches: Branch[]; shared: string[] }[];
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from',
  'that', 'this', 'it', 'its', 'is', 'are', 'be', 'into', 'about', 'than', 'then', 'but', 'not',
  'mark', 'logo', 'brand', 'design', 'form', 'shape', 'idea', 'direction', 'concept', 'visual',
]);

/** Content words, lower-cased and de-duplicated. */
export function contentWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function checkMindMap(input: MindMapInput): Measurement<MindMapResult> {
  const findings: Finding[] = [];
  const directions = input.directions;
  const nodes = input.nodes ?? [];

  const nodesPerBranch = MIND_MAP_TARGET.branches.map((branch) => ({
    branch,
    nodes: nodes.filter((node) => node.branch === branch).length,
  }));
  const branchesExplored = nodesPerBranch.filter((row) => row.nodes > 0).map((row) => row.branch);
  const branchesMissing = nodesPerBranch.filter((row) => row.nodes === 0).map((row) => row.branch);

  if (nodes.length > 0 && branchesMissing.length > 0) {
    findings.push({
      severity: 'minor',
      message: `The divergent map has no nodes on ${branchesMissing.length} of 12.1's five branches: ${branchesMissing.join(', ')}.`,
      remediation:
        '12.1 says "at minimum these branches, each explored on its own terms before ' +
        'cross-pollinating". A branch skipped at the divergent stage cannot produce a survivor.',
    });
  }

  const territories = [...new Set(directions.flatMap((d) => d.branches))];
  const collapsed = territories.length < MIND_MAP_TARGET.minTerritories;

  if (collapsed) {
    findings.push({
      severity: 'blocker',
      message:
        `The ${directions.length} surviving direction${directions.length === 1 ? '' : 's'} come ` +
        `from ${territories.length} conceptual territor${territories.length === 1 ? 'y' : 'ies'} ` +
        `(${territories.join(', ') || 'none stated'}), against a floor of ` +
        `${MIND_MAP_TARGET.minTerritories}.`,
      remediation:
        'This is Department 12\'s first failure condition, and the failure the department exists ' +
        'to prevent: a set of directions that look different and are one idea. Go back to 12.1 ' +
        'and explore the untouched branches on their own terms before narrowing again.',
    });
  }

  if (directions.length < MIND_MAP_TARGET.minDirections) {
    findings.push({
      severity: 'major',
      message: `${directions.length} direction${directions.length === 1 ? '' : 's'} survived, under the minimum of ${MIND_MAP_TARGET.minDirections}.`,
      remediation: '12.3: "fewer than 3 usually means the divergent stage didn\'t go wide enough."',
    });
  } else if (directions.length > MIND_MAP_TARGET.maxDirections) {
    findings.push({
      severity: 'major',
      message: `${directions.length} directions survived, over the maximum of ${MIND_MAP_TARGET.maxDirections}.`,
      remediation: '12.3: "more than 5 usually means the narrowing wasn\'t actually applied."',
    });
  }

  const untraced = directions.filter((d) => !d.tracesTo?.trim()).map((d) => d.name);
  if (untraced.length > 0) {
    findings.push({
      severity: 'major',
      message: `${untraced.length} direction(s) cite no Department 1 or 2 input: ${untraced.join(', ')}.`,
      remediation:
        '12.3\'s first filter is strategic fit — "if it can\'t be traced, cut it, no matter how ' +
        'visually appealing". Narrowing by taste alone is guessing with extra steps.',
    });
  }

  const withoutConstruction = directions.filter((d) => !d.construction?.trim()).map((d) => d.name);
  if (withoutConstruction.length > 0) {
    findings.push({
      severity: 'major',
      message: `${withoutConstruction.length} direction(s) carry no construction logic: ${withoutConstruction.join(', ')}.`,
      remediation:
        '12.4 asks for enough for the user to start sketching from. A direction with no buildable ' +
        'logic is a mood description, which the scorecard puts at a 3–4.',
    });
  }

  const geometric = directions.filter((d) =>
    d.branches.includes('abstract') && !d.structure?.trim());
  if (geometric.length > 0) {
    findings.push({
      severity: 'minor',
      message: `${geometric.length} abstract direction(s) name no composition structure: ${geometric.map((d) => d.name).join(', ')}.`,
      remediation:
        '12.4 requires geometric and abstract directions to name the structure from ' +
        'composition-frameworks.md the construction is built on. That is what turns ' +
        '"construction feasibility" into something buildable rather than a geometric gesture.',
    });
  }

  const restatements: MindMapResult['restatements'] = [];
  for (let i = 0; i < directions.length; i += 1) {
    for (let j = i + 1; j < directions.length; j += 1) {
      const a = directions[i];
      const b = directions[j];
      if (!a || !b) continue;
      const overlap = jaccard(
        contentWords(`${a.name} ${a.concept}`),
        contentWords(`${b.name} ${b.concept}`),
      );
      if (overlap >= MIND_MAP_TARGET.restatementOverlap) {
        restatements.push({ a: a.name, b: b.name, overlap: round(overlap, 3) });
      }
    }
  }

  for (const pair of restatements) {
    findings.push({
      severity: 'major',
      message:
        `"${pair.a}" and "${pair.b}" describe their concepts with ` +
        `${round(pair.overlap * 100, 1)}% of the same content words.`,
      remediation:
        'Two directions worded almost identically are usually one direction rendered twice — ' +
        'the "ten variations on an abstract swoosh" failure. If they are genuinely different, ' +
        'the write-up has not said how yet, which is its own problem.',
    });
  }

  // 12.2: independent branches arriving at the same idea is a strength signal.
  const crossPollinated: MindMapResult['crossPollinated'] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b || a.branch === b.branch) continue;
      const wordsA = contentWords(a.text);
      const wordsB = contentWords(b.text);
      const shared = [...wordsA].filter((word) => wordsB.has(word));
      if (shared.length >= 2) {
        crossPollinated.push({ branches: [a.branch, b.branch], shared });
      }
    }
  }

  if (nodes.length > 0 && crossPollinated.length === 0 && branchesExplored.length >= 2) {
    findings.push({
      severity: 'info',
      message: 'No two branches reached the same idea from different angles.',
      remediation:
        '12.2 calls that convergence the strongest signal available, because independent paths ' +
        'arriving at one idea means fit rather than a lucky guess. Its absence is not a fault — ' +
        'it just means nothing here has that particular backing.',
    });
  }

  return measurement('mind_map_check', {
    branchesExplored,
    branchesMissing,
    nodesPerBranch,
    directionCount: directions.length,
    territories,
    territoryCount: territories.length,
    collapsed,
    untraced,
    withoutConstruction,
    restatements,
    crossPollinated,
  }, findings);
}
