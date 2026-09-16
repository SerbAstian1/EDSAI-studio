import { measurement, type Finding, type Measurement } from './types.js';

/**
 * SEO structural checks. `00-scorecard.md §4` states the targets: title 50–60
 * characters, meta description 150–160, a single H1, no skipped heading levels,
 * structured data present.
 */

export const SEO_TARGET = {
  title: { min: 50, max: 60 },
  metaDescription: { min: 150, max: 160 },
} as const;

export interface SeoInput {
  title?: string;
  metaDescription?: string;
  /** Heading levels in document order, e.g. [1, 2, 3, 2]. */
  headings?: readonly number[];
  hasStructuredData?: boolean;
}

export function auditSeo(input: SeoInput): Measurement<{
  titleLength: number;
  titleWithinTarget: boolean;
  metaLength: number;
  metaWithinTarget: boolean;
  h1Count: number;
  skippedLevels: { from: number; to: number; atIndex: number }[];
  headingHierarchyValid: boolean;
  hasStructuredData: boolean;
}> {
  const findings: Finding[] = [];

  const title = input.title ?? '';
  const titleLength = title.length;
  const titleWithinTarget =
    titleLength >= SEO_TARGET.title.min && titleLength <= SEO_TARGET.title.max;

  if (!input.title) {
    findings.push({
      severity: 'major',
      message: 'No title tag.',
      remediation: `Add one of ${SEO_TARGET.title.min}–${SEO_TARGET.title.max} characters.`,
    });
  } else if (!titleWithinTarget) {
    findings.push({
      severity: 'minor',
      message: `Title is ${titleLength} characters, against a ${SEO_TARGET.title.min}–${SEO_TARGET.title.max} target.`,
      remediation: titleLength > SEO_TARGET.title.max
        ? `Trim ${titleLength - SEO_TARGET.title.max} characters; search results truncate past roughly 60.`
        : `Add ${SEO_TARGET.title.min - titleLength} characters; a short title wastes the strongest ranking signal on the page.`,
    });
  }

  const meta = input.metaDescription ?? '';
  const metaLength = meta.length;
  const metaWithinTarget =
    metaLength >= SEO_TARGET.metaDescription.min && metaLength <= SEO_TARGET.metaDescription.max;

  if (!input.metaDescription) {
    findings.push({
      severity: 'minor',
      message: 'No meta description.',
      remediation: `Add one of ${SEO_TARGET.metaDescription.min}–${SEO_TARGET.metaDescription.max} characters.`,
    });
  } else if (!metaWithinTarget) {
    findings.push({
      severity: 'minor',
      message: `Meta description is ${metaLength} characters, against a ${SEO_TARGET.metaDescription.min}–${SEO_TARGET.metaDescription.max} target.`,
      remediation: metaLength > SEO_TARGET.metaDescription.max
        ? `Trim ${metaLength - SEO_TARGET.metaDescription.max} characters before the snippet is cut mid-sentence.`
        : `Add ${SEO_TARGET.metaDescription.min - metaLength} characters.`,
    });
  }

  const headings = input.headings ?? [];
  const h1Count = headings.filter((h) => h === 1).length;

  if (headings.length > 0 && h1Count !== 1) {
    findings.push({
      severity: h1Count === 0 ? 'major' : 'minor',
      message: h1Count === 0 ? 'No H1 on the page.' : `${h1Count} H1 elements on the page.`,
      remediation: 'Exactly one H1 states what the page is; the rest of the outline hangs off it.',
    });
  }

  const skippedLevels: { from: number; to: number; atIndex: number }[] = [];
  for (let i = 1; i < headings.length; i++) {
    const previous = headings[i - 1] ?? 1;
    const current = headings[i] ?? 1;
    if (current > previous + 1) skippedLevels.push({ from: previous, to: current, atIndex: i });
  }

  if (skippedLevels.length > 0) {
    findings.push({
      severity: 'minor',
      message: skippedLevels
        .map((s) => `H${s.from} → H${s.to} at position ${s.atIndex}`)
        .join('; '),
      remediation:
        'A skipped level breaks the outline a screen reader announces. Use the next level ' +
        'down and style it, rather than picking a level for its size.',
    });
  }

  const hasStructuredData = input.hasStructuredData ?? false;
  if (!hasStructuredData) {
    findings.push({
      severity: 'nitpick',
      message: 'No structured data declared.',
      remediation: 'Add JSON-LD appropriate to the page type.',
    });
  }

  return measurement('seo_lengths', {
    titleLength,
    titleWithinTarget,
    metaLength,
    metaWithinTarget,
    h1Count,
    skippedLevels,
    headingHierarchyValid: skippedLevels.length === 0 && h1Count === 1,
    hasStructuredData,
  }, findings);
}
