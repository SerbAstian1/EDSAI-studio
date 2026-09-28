import type { BrandLogoRule, BrandRules, CanvasDocument, CanvasNode } from '../api.js';
import { boundsOf } from './document.js';
import { textLines } from './render.js';

/**
 * Is this design still this brand's?
 *
 * **A guard, not a gate.** §8 is careful about this: a design that is off-brand
 * can still be saved, because the most useful thing a client can do is look at
 * what needs fixing. So nothing here refuses anything — the inspector lists the
 * problem, the top bar counts it, and the save goes through. A canvas that will
 * not save the wrong thing teaches people to be afraid of saving, and then they
 * save nothing at all.
 *
 * **All of it pure.** No React, no document, no network, so the same functions
 * answer the same way for the live badge, for the check before a save, and for
 * the tests. A rule that could only be evaluated inside a component would be a
 * rule nobody could test.
 */

export type IssueLevel = 'error' | 'warn';

export interface Issue {
  level: IssueLevel;
  /** The layer at fault, when the fault is a layer. */
  nodeId?: string;
  title: string;
  detail: string;
  /** What to do, phrased so the inspector can offer it as a button. */
  fix: string;
  /** The action, when it is one the canvas can carry out by itself. */
  action?: { label: string; kind: 'brand-color'; hex: string } | { label: string; kind: 'brand-font'; family: string };
}

/* ------------------------------------------------------------------ colours */

/** The policy that applies, whether or not one was written down. */
export type Policy = 'open' | 'guided' | 'strict';

/**
 * Fall back to the old boolean when no policy was written.
 *
 * A hub that said `allowCustomColor: true` has always let a client reach any
 * colour, and reading that as `guided` costs it only a warning on a colour it
 * deliberately permitted. Defaulting the other way would take away a permission
 * the client already had, which is the direction that gets a release rolled back.
 *
 * A client with no rules at all is not a client being forbidden anything, so it
 * is `open` rather than `strict` — a strict reading of silence would make every
 * colour in a blank brand an error, which is a warning nobody would act on.
 */
export function policyOf(rules: BrandRules | undefined): Policy {
  if (!rules) return 'open';
  if (rules.colorPolicy) return rules.colorPolicy;
  return rules.allowCustomColor ? 'guided' : 'strict';
}

/** The measured palette, as named swatches, or nothing. */
export function paletteOf(rules: BrandRules | undefined): { hex: string; name: string }[] {
  return (rules?.colors ?? []).map((hex) => ({ hex, name: hex }));
}

/** `#ABCDEF` or `#abcd` as `[r, g, b]`, or null when it is not a hex. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const body = match[1]!;
  const full = body.length === 3 ? [...body].map((c) => c + c).join('') : body;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function rgbToHex(rgb: readonly [number, number, number]): string {
  return '#' + rgb
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

/**
 * Relative luminance, 0 (black) to 1 (white), as WCAG defines it.
 *
 * The channels are linearised first: a monitor's 128 is not half as bright as
 * 255 to the eye, it is about a fifth. Skipping that step gives a blue that
 * looks dark a luma of 29 on a 0-255 scale, and then a black/white pair comes
 * out at a "contrast" of 5101 - a number no threshold can be written against.
 */
export function luma(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** The contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number | null {
  const one = luma(a);
  const two = luma(b);
  if (one === null || two === null) return null;
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a colour is not a decision: no fill, no ink, no background. */
function isNeutral(hex: string): boolean {
  const value = hex.trim().toLowerCase();
  return value === 'transparent' || value === 'none' || value === ''
    || value === '#00000000' || value.startsWith('rgba(0, 0, 0, 0') || value.startsWith('rgb(0, 0, 0, 0');
}

/** The closest measured colour, by squared distance in RGB, and how far it is. */
export function nearestColour(
  colour: string, palette: readonly { hex: string; name: string }[],
): { hex: string; name: string; distance: number } | undefined {
  const rgb = hexToRgb(colour);
  if (!rgb) return undefined;
  let best: { hex: string; name: string; distance: number } | undefined;
  for (const entry of palette) {
    const other = hexToRgb(entry.hex);
    if (!other) continue;
    const distance = (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
    if (!best || distance < best.distance) best = { ...entry, distance };
  }
  return best;
}

/** Close enough to a measured colour to be one. 5_400 ≈ 73 per channel. */
const ON_PALETTE = 5_400;

/** Every colour a layer puts on the sheet. */
export function coloursOf(node: CanvasNode): { role: string; hex: string }[] {
  switch (node.type) {
    case 'text': return [{ role: 'Text', hex: node.properties.color }];
    case 'shape': return node.properties.strokeWidth > 0
      ? [{ role: 'Fill', hex: node.properties.fill }, { role: 'Stroke', hex: node.properties.stroke }]
      : [{ role: 'Fill', hex: node.properties.fill }];
    case 'pattern':
    case 'texture': return [{ role: 'Colour wash', hex: node.properties.color }];
    case 'illustration': return node.properties.tint ? [{ role: 'Tint', hex: node.properties.tint }] : [];
    default: return [];
  }
}

/* ------------------------------------------------------------------- checks */

function colourIssues(doc: CanvasDocument, rules: BrandRules | undefined): Issue[] {
  const issues: Issue[] = [];
  const policy = policyOf(rules);
  const palette = paletteOf(rules);
  const fonts = rules?.fonts ?? [];
  const customFont = rules?.allowCustomFont ?? false;

  for (const node of doc.nodes) {
    if (node.hidden) continue;

    for (const { role, hex } of coloursOf(node)) {
      if (isNeutral(hex)) continue;
      if (palette.length === 0 || palette.some((c) => same(c.hex, hex))) continue;
      if (policy === 'open') continue;

      const near = nearestColour(hex, palette);
      const close = near !== undefined && near.distance <= ON_PALETTE;
      if (policy === 'strict') {
        // Strict means the brand has said this is a mistake, so it is reported as
        // one — and the fix is offered as a button, because knowing the nearest
        // measured colour and having to type it is not the same help.
        issues.push({
          level: close ? 'warn' : 'error',
          nodeId: node.id,
          title: `${role} is not a brand colour`,
          detail: close
            ? `${hex} is a hair off ${near?.name}, and the brand asks for measured colours.`
            : `${hex} is not in the palette, and this brand does not allow other colours.`,
          fix: near ? `Use ${near.name} (${near.hex}).` : `Use one of the ${palette.length} measured colours.`,
          ...(near ? { action: { label: `Use ${near.name}`, kind: 'brand-color' as const, hex: near.hex } } : {}),
        });
        continue;
      }

      // Guided: the brand permits the colour and asks to be told. A warning is
      // the whole point of `guided`, so nothing here is an error.
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: `${role} is outside the palette`,
        detail: near ? `${hex} is nearest to ${near.name} (${near.hex}).` : `${hex} is not in the palette.`,
        fix: near ? `Nearest measured colour is ${near.name}.` : 'Consider a measured colour.',
        ...(near ? { action: { label: `Use ${near.name}`, kind: 'brand-color' as const, hex: near.hex } } : {}),
      });
    }

    if (node.type !== 'text') continue;
    const p = node.properties;

    if (p.fontSize < 12) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        title: 'Type is below the readable floor',
        detail: `${p.fontSize}px. Under 12px disappears on a phone and turns to grey on paper.`,
        fix: 'Set the size to at least 12px.',
      });
    }

    if (fonts.length > 0 && !customFont && !fonts.some((f) => same(f, p.fontFamily))) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        title: 'Type is not a brand typeface',
        detail: `${p.fontFamily} is not in the brand’s type, and this brand does not allow others.`,
        fix: `Set the family to ${fonts[0] ?? 'a brand typeface'}.`,
        ...(fonts[0] ? { action: { label: `Use ${fonts[0]}`, kind: 'brand-font' as const, family: fonts[0] } } : {}),
      });
    } else if (fonts.length > 0 && !fonts.some((f) => same(f, p.fontFamily))) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: 'Type is outside the brand’s type',
        detail: `${p.fontFamily} is not one of the brand’s faces.`,
        fix: `The brand uses ${fonts.join(', ')}.`,
        ...(fonts[0] ? { action: { label: `Use ${fonts[0]}`, kind: 'brand-font' as const, family: fonts[0] } } : {}),
      });
    }

    // §8's contrast rule, at the WCAG thresholds: 4.5:1 for body copy, 3:1 from
    // 24px or from 18px bold — the line where type is judged as "large".
    const large = p.fontSize >= 24 || (p.fontSize >= 18 && p.fontWeight >= 600);
    const bar = large ? 3 : 4.5;
    const ratio = contrastRatio(p.color, doc.artboard.background);
    if (ratio !== null && ratio < bar) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: 'Text is hard to read on the canvas',
        detail: `${ratio.toFixed(1)}:1 against ${doc.artboard.background}; text this size needs ${bar}:1.`,
        fix: 'Use a colour further from the background, or set the type on a shape of its own.',
      });
    }

    // A measure, not a rule: a line long enough to lose the eye is worth saying.
    const lines = textLines(p.text, node.width, p.fontSize, p.letterSpacing);
    const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
    if (longest > 90) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: 'Line length is long',
        detail: `${longest} characters on the longest line. Past about 90 the eye loses the start of the next one.`,
        fix: 'Widen the text box, or set the size smaller.',
      });
    }
  }
  return issues;
}

/** The logo rules for one placed mark, if the brand wrote any. */
export function logoRule(rules: BrandRules | undefined, assetId: string): BrandLogoRule | undefined {
  return rules?.logos?.[assetId];
}

function logoIssues(doc: CanvasDocument, rules: BrandRules | undefined): Issue[] {
  const issues: Issue[] = [];
  const placed = doc.nodes.filter((node) => node.type === 'logo' && !node.hidden);
  if (placed.length === 0) return issues;

  if (placed.length > 1) {
    issues.push({
      level: 'warn',
      title: 'More than one logo on the sheet',
      detail: `${placed.length} marks. Most brand guides want one, so the logo reads as the logo.`,
      fix: 'Keep the one you want, and move the others off the artboard.',
    });
  }

  const { width, height } = doc.artboard;
  for (const node of placed) {
    if (node.type !== 'logo') continue;
    const rule = logoRule(rules, node.properties.assetId);
    if (!rule) continue;
    const box = boundsOf(node);
    const actual = Math.abs(node.rotation) % 360;

    if (rule.minWidth !== undefined && box.width < rule.minWidth) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: 'Logo is smaller than the brand allows',
        detail: `${Math.round(box.width)}px wide; the brand sets a floor of ${rule.minWidth}px.`,
        fix: `Set the width to at least ${rule.minWidth}px.`,
      });
    }

    if (rule.maxRotation !== undefined && Math.min(actual, 360 - actual) > rule.maxRotation) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        title: 'Logo is turned too far',
        detail: `${Math.round(actual)}°; the brand allows up to ${rule.maxRotation}°.`,
        fix: `Set the rotation to ${rule.maxRotation}° or less.`,
      });
    }

    if (!rule.allowDistortion && node.properties.naturalHeight > 0) {
      const drawn = box.height > 0 ? box.width / box.height : 0;
      const source = node.properties.sourceAspect > 0 ? node.properties.sourceAspect : drawn;
      const skew = source > 0 ? Math.abs(drawn - source) / source : 0;
      if (skew > 0.02) {
        issues.push({
          level: 'error',
          nodeId: node.id,
          title: 'Logo is stretched',
          detail: `Its box is ${drawn.toFixed(2)} against the file’s own ${source.toFixed(2)}. A stretched mark is not the mark.`,
          fix: 'Reset the size so the width and height keep the file’s proportions.',
        });
      }
    }

    if (rule.backgrounds.length > 0 && !rule.backgrounds.some((bg) => same(bg, doc.artboard.background))) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: 'Logo is on a background it was not approved for',
        detail: `Approved against ${rule.backgrounds.join(', ')}; this canvas is ${doc.artboard.background}.`,
        fix: `Change the canvas background to one of the approved colours, or use a different logo.`,
      });
    }

    if (!rule.allowRecolor && node.effects.blend !== 'normal') {
      issues.push({
        level: 'error',
        nodeId: node.id,
        title: 'Logo has a blend mode',
        detail: `${node.effects.blend} changes the mark’s own colour, and the brand does not permit recolouring it.`,
        fix: 'Set the blend mode back to normal.',
      });
    }
  }
  return issues;
}

/** A layer that has fallen off the sheet, or been squashed to nothing. */
function placementIssues(doc: CanvasDocument): Issue[] {
  const issues: Issue[] = [];
  const { width, height } = doc.artboard;
  for (const node of doc.nodes) {
    if (node.hidden || node.type === 'group') continue;
    const box = boundsOf(node);
    const off = box.x + box.width < 0 || box.x > width || box.y + box.height < 0 || box.y > height;
    if (off) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: `${node.name} is off the canvas`,
        detail: 'It is saved, but none of it will be exported.',
        fix: 'Move it back onto the artboard, or hide it.',
      });
      continue;
    }
    if (box.width < 1 || box.height < 1) {
      issues.push({
        level: 'warn',
        nodeId: node.id,
        title: `${node.name} has no size`,
        detail: 'It is on the canvas at less than a pixel across, so it will not print.',
        fix: 'Give it a real width and height.',
      });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ verdict */

/**
 * Everything wrong with a design, worst first.
 *
 * **Errors before warnings, and stable within each.** The order a designer works
 * through them should be the order they can see them, and it should not change
 * between two renders of the same design — a list that reshuffles on every
 * keystroke is one nobody reads.
 */
export function checkDesign(doc: CanvasDocument, rules: BrandRules | undefined): Issue[] {
  const issues = [...colourIssues(doc, rules), ...logoIssues(doc, rules), ...placementIssues(doc)];
  const rank = (issue: Issue): number => (issue.level === 'error' ? 0 : 1);
  return issues.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

export type VerdictStatus = 'clean' | 'watch' | 'off-brand';

export interface Verdict {
  errors: number;
  warnings: number;
  issues: Issue[];
  /** One word, for a badge. */
  status: VerdictStatus;
}

export function judge(doc: CanvasDocument, rules: BrandRules | undefined): Verdict {
  const issues = checkDesign(doc, rules);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;
  return { errors, warnings, issues, status: errors > 0 ? 'off-brand' : warnings > 0 ? 'watch' : 'clean' };
}

/** Only the issues about one layer, for the inspector's own list. */
export function issuesForNode(verdict: Verdict, nodeId: string): Issue[] {
  return verdict.issues.filter((issue) => issue.nodeId === nodeId);
}
