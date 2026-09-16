import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * The score-drift audit, from `09-client-summary-and-score-audit.md §B`.
 *
 * The corpus asks a model to check its own scores for clustering, which is the
 * one check least likely to survive being self-administered — a system inclined
 * to score everything 8 is equally inclined to judge that reasonable. So it is
 * code, and it runs between the Critic and Arbitration.
 */

export interface ScoredItem {
  department?: number | string;
  dimension: string;
  value: number;
  justification?: string;
}

/** Clustering threshold: more than this share inside any 2-point band is a flag. */
export const CLUSTER_THRESHOLD = 0.7;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by', 'that', 'this', 'it',
  'its', 'not', 'no', 'so', 'than', 'then', 'which', 'has', 'have', 'from',
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

export function scoreDrift(scores: readonly ScoredItem[], options?: {
  threshold?: number;
  /** Mean pairwise justification similarity above which wording reads as templated. */
  similarityThreshold?: number;
}): Measurement<{
  count: number;
  mean: number;
  min: number;
  max: number;
  distribution: Record<number, number>;
  widestBand: { low: number; high: number; share: number };
  clustered: boolean;
  missingJustifications: number;
  meanJustificationSimilarity: number;
  templatedWording: boolean;
}> {
  if (scores.length === 0) throw new Error('the drift audit needs at least one score');

  const threshold = options?.threshold ?? CLUSTER_THRESHOLD;
  const similarityThreshold = options?.similarityThreshold ?? 0.6;
  const findings: Finding[] = [];

  const values = scores.map((s) => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  const distribution: Record<number, number> = {};
  for (const v of values) distribution[v] = (distribution[v] ?? 0) + 1;

  // Every two-point band, so the report can name the widest rather than assume 7–8.
  let widestBand = { low: 1, high: 2, share: 0 };
  for (let low = 1; low <= 9; low++) {
    const high = low + 1;
    const inBand = values.filter((v) => v >= low && v <= high).length;
    const share = inBand / values.length;
    if (share > widestBand.share) widestBand = { low, high, share: round(share, 4) };
  }

  const clustered = widestBand.share > threshold;
  if (clustered) {
    findings.push({
      severity: 'major',
      message:
        `${round(widestBand.share * 100, 1)}% of ${values.length} scores sit in the ` +
        `${widestBand.low}–${widestBand.high} band, above the ${round(threshold * 100, 0)}% threshold.`,
      remediation:
        'Re-examine the scores at the edges of the band. Clustering usually means the ' +
        'scale is being used as a formality rather than a judgment — find the genuinely ' +
        'weakest department and score it honestly.',
    });
  }

  const missingJustifications = scores.filter((s) => !s.justification?.trim()).length;
  if (missingJustifications > 0) {
    findings.push({
      severity: 'major',
      message: `${missingJustifications} of ${scores.length} scores carry no justification.`,
      remediation: 'A score without a one-sentence justification is not a score yet.',
    });
  }

  const justifications = scores
    .map((s) => s.justification?.trim())
    .filter((j): j is string => Boolean(j))
    .map(contentWords);

  let similaritySum = 0;
  let pairs = 0;
  for (let i = 0; i < justifications.length; i++) {
    for (let j = i + 1; j < justifications.length; j++) {
      similaritySum += jaccard(justifications[i] as Set<string>, justifications[j] as Set<string>);
      pairs++;
    }
  }
  const meanJustificationSimilarity = pairs === 0 ? 0 : similaritySum / pairs;
  const templatedWording = meanJustificationSimilarity > similarityThreshold;

  if (templatedWording) {
    findings.push({
      severity: 'minor',
      message:
        `Justifications share ${round(meanJustificationSimilarity * 100, 1)}% of their content ` +
        `words on average, which reads as one sentence rewritten per row.`,
      remediation:
        'A justification should name what is specifically true of that department. ' +
        'Near-identical wording across rows means the rubric was filled in, not applied.',
    });
  }

  return measurement('score_drift', {
    count: values.length,
    mean: round(mean, 2),
    min: Math.min(...values),
    max: Math.max(...values),
    distribution,
    widestBand,
    clustered,
    missingJustifications,
    meanJustificationSimilarity: round(meanJustificationSimilarity, 4),
    templatedWording,
  }, findings);
}
