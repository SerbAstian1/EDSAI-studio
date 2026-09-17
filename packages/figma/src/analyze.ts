import {
  auditScale, auditSpacing, contrast, lineLength, worstSeverity,
  type Severity,
} from '@edsai/instruments';
import { isLargeText, type FrameSnapshot } from './snapshot.js';

/**
 * Department 5 critique of a frame, computed.
 *
 * This is the Figma plugin's whole point, and it is deliberately narrow: it
 * reports what can be measured — contrast, scale consistency, tracking
 * discipline, orphan spacing, line length — and says nothing about whether the
 * design is any good. A plugin that offered taste would be worth ignoring; one
 * that hands back exact ratios attached to the layers that carry them is worth
 * opening.
 */

export interface Annotation {
  /** The Figma node this attaches to, so the plugin can place it. */
  nodeId: string;
  layer: string;
  severity: Severity;
  /** Short enough to read on a pin in the canvas. */
  headline: string;
  detail: string;
  remediation?: string;
  /** The measured value, so an annotation never asserts an unmeasured number. */
  measured?: string;
}

export interface FrameReport {
  frame: string;
  annotations: Annotation[];
  summary: {
    textNodes: number;
    contrastChecked: number;
    contrastFailing: number;
    boundariesChecked: number;
    boundariesFailing: number;
    distinctSizes: number[];
    scaleConsistent: boolean | undefined;
    trackingVaries: boolean | undefined;
    spacingOrphans: number[];
    worst: Severity | undefined;
  };
}

/** Text shorter than this is a label or a number, not a column with a measure. */
const MEASURE_MIN_CHARS = 60;

export function analyzeFrame(snapshot: FrameSnapshot): FrameReport {
  const annotations: Annotation[] = [];

  /* ------------------------------------------------------------- contrast */

  let contrastFailing = 0;
  for (const text of snapshot.texts) {
    const large = isLargeText(text.fontSize, text.fontWeight);
    const result = contrast({
      foreground: text.fill,
      background: text.backdrop,
      size: large ? 'large' : 'normal',
      label: text.name,
    });

    if (!result.value.passes) {
      contrastFailing++;
      annotations.push({
        nodeId: text.id,
        layer: text.name,
        severity: large ? 'major' : 'blocker',
        headline: `${result.value.ratio}:1 — needs ${result.value.required}:1`,
        detail:
          `${text.fill} on ${text.backdrop} at ${text.fontSize}px/${text.fontWeight} ` +
          `is ${large ? 'large' : 'body'} text under WCAG 1.4.3, so it faces ` +
          `${result.value.required}:1 and measures ${result.value.ratio}:1.`,
        remediation:
          `Darken the fill or lighten the backdrop until it reaches ` +
          `${result.value.required}:1. APCA reads Lc ${result.value.apcaLc} for reference.`,
        measured: `${result.value.ratio}:1`,
      });
    }
  }

  /* ---------------------------------------------- boundaries (WCAG 1.4.11) */

  let boundariesFailing = 0;
  const judged = snapshot.boundaries.filter((b) => b.role !== 'decorative');

  for (const boundary of judged) {
    const result = contrast({
      foreground: boundary.color,
      background: boundary.backdrop,
      usage: 'non-text',
      label: boundary.name,
    });

    if (!result.value.passes) {
      boundariesFailing++;
      annotations.push({
        nodeId: boundary.id,
        layer: boundary.name,
        // A boundary whose role we inferred rather than knew is reported one
        // step softer, because the finding may not apply.
        severity: boundary.role === 'control' ? 'major' : 'minor',
        headline: `${result.value.ratio}:1 — boundaries need 3:1`,
        detail:
          `${boundary.name} measures ${result.value.ratio}:1 against its backdrop. ` +
          (boundary.role === 'control'
            ? 'WCAG 1.4.11 holds a control boundary to 3:1.'
            : 'If this edge separates a control from its surroundings, 1.4.11 holds it to 3:1. ' +
              'If it is purely decorative, this finding does not apply — rename the layer and re-run.'),
        remediation: 'Darken the stroke, or give the control a fill difference that carries the boundary instead.',
        measured: `${result.value.ratio}:1`,
      });
    }
  }

  /* ------------------------------------------------------------ type scale */

  const sizes = [...new Set(snapshot.texts.map((t) => t.fontSize))].sort((a, b) => a - b);
  let scaleConsistent: boolean | undefined;
  let trackingVaries: boolean | undefined;

  if (sizes.length >= 2) {
    const tiers = sizes.map((size) => {
      const at = snapshot.texts.filter((t) => t.fontSize === size);
      const trackings = [...new Set(at.map((t) => t.letterSpacing))];
      const heights = [...new Set(at.map((t) => t.lineHeight).filter((h): h is number => h != null))];
      return {
        size,
        // Only one value per tier is meaningful; a tier used at two trackings is
        // its own inconsistency, reported separately below.
        ...(trackings.length === 1 ? { tracking: trackings[0] as number } : {}),
        ...(heights.length === 1 ? { lineHeight: heights[0] as number } : {}),
      };
    });

    const audit = auditScale({ tiers });
    scaleConsistent = audit.value.consistent;
    trackingVaries = audit.value.trackingVaries;

    for (const finding of audit.findings) {
      annotations.push({
        nodeId: '',
        layer: snapshot.name,
        severity: finding.severity,
        headline: finding.message.split('.')[0] ?? 'Type scale',
        detail: finding.message,
        ...(finding.remediation ? { remediation: finding.remediation } : {}),
        measured: sizes.join(' / '),
      });
    }

    for (const size of sizes) {
      const at = snapshot.texts.filter((t) => t.fontSize === size);
      const trackings = [...new Set(at.map((t) => t.letterSpacing))];
      if (trackings.length > 1) {
        annotations.push({
          nodeId: at[0]?.id ?? '',
          layer: `${size}px tier`,
          severity: 'minor',
          headline: `${size}px uses ${trackings.length} tracking values`,
          detail:
            `Layers at ${size}px carry tracking ${trackings.map((t) => `${t}em`).join(', ')}. ` +
            'One size tier should carry one tracking value.',
          remediation: 'Pick the value the tier should use and apply it as a text style.',
          measured: trackings.map((t) => `${t}em`).join(', '),
        });
      }
    }
  }

  /* --------------------------------------------------------------- spacing */

  let spacingOrphans: number[] = [];
  if (snapshot.spacing.length > 0) {
    const audit = auditSpacing({
      used: snapshot.spacing,
      ...(snapshot.declaredSpacingScale ? { scale: snapshot.declaredSpacingScale } : {}),
    });
    spacingOrphans = audit.value.orphans;

    for (const finding of audit.findings) {
      if (finding.severity === 'nitpick') continue; // unused scale steps are not a frame's problem
      annotations.push({
        nodeId: '',
        layer: snapshot.name,
        severity: finding.severity,
        headline: `${audit.value.orphans.length} spacing values off the scale`,
        detail: finding.message,
        ...(finding.remediation ? { remediation: finding.remediation } : {}),
        measured: audit.value.orphans.join(', '),
      });
    }
  }

  /* ----------------------------------------------------------- line length */

  for (const text of snapshot.texts) {
    if (!text.width || text.characters.length < MEASURE_MIN_CHARS) continue;
    const result = lineLength({ measure: text.width, fontSize: text.fontSize });
    if (result.value.withinTarget) continue;

    annotations.push({
      nodeId: text.id,
      layer: text.name,
      severity: 'minor',
      headline: `${result.value.charactersPerLine} characters per line`,
      detail: result.findings[0]?.message ?? '',
      ...(result.findings[0]?.remediation ? { remediation: result.findings[0].remediation } : {}),
      measured: `${result.value.charactersPerLine} chars`,
    });
  }

  const order: Severity[] = ['blocker', 'major', 'minor', 'nitpick', 'info'];
  annotations.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return {
    frame: snapshot.name,
    annotations,
    summary: {
      textNodes: snapshot.texts.length,
      contrastChecked: snapshot.texts.length,
      contrastFailing,
      boundariesChecked: judged.length,
      boundariesFailing,
      distinctSizes: sizes,
      scaleConsistent,
      trackingVaries,
      spacingOrphans,
      worst: worstSeverity(annotations.map((a) => ({ severity: a.severity, message: a.headline }))),
    },
  };
}

/** One line per annotation, for the plugin panel and for a CLI. */
export function formatReport(report: FrameReport): string {
  if (report.annotations.length === 0) {
    return `${report.frame}: ${report.summary.textNodes} text layers, nothing measured failed.`;
  }
  return [
    `${report.frame} — ${report.annotations.length} finding(s)`,
    ...report.annotations.map(
      (a) => `  [${a.severity}] ${a.layer}: ${a.headline}`,
    ),
  ].join('\n');
}
