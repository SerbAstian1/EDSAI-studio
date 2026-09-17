import { FrameSnapshot, type BoundarySnapshot, type TextSnapshot } from './snapshot.js';

/**
 * Figma nodes → FrameSnapshot.
 *
 * This is the one module here that cannot be tested outside Figma, so it is
 * kept as thin and as dumb as it can be: read, normalise, hand off. Every
 * judgement lives in `analyze.ts`, which runs anywhere.
 *
 * The types are structural rather than imported from `@figma/plugin-typings`,
 * so this package builds without the plugin environment present. Anything this
 * file gets wrong shows up as a wrong snapshot, which is why `snapshot.ts`
 * validates one before analysis runs.
 */

interface RGB { r: number; g: number; b: number }
interface SolidPaint { type: string; color?: RGB; opacity?: number; visible?: boolean }

interface NodeLike {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  width?: number;
  height?: number;
  fills?: readonly SolidPaint[] | symbol;
  strokes?: readonly SolidPaint[] | symbol;
  parent?: NodeLike | null;
  children?: readonly NodeLike[];
  opacity?: number;
  characters?: string;
  fontSize?: number | symbol;
  fontName?: { family: string; style: string } | symbol;
  fontWeight?: number | symbol;
  letterSpacing?: { value: number; unit: string } | symbol;
  lineHeight?: { value: number; unit: string } | symbol;
  itemSpacing?: number;
  paddingLeft?: number; paddingRight?: number;
  paddingTop?: number; paddingBottom?: number;
  layoutMode?: string;
}

const hex = (c: RGB): string => {
  const channel = (n: number): string =>
    Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0');
  return `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`.toUpperCase();
};

/** Composite a translucent paint over what is already resolved beneath it. */
function over(paint: SolidPaint, beneath: RGB): RGB {
  const alpha = paint.opacity ?? 1;
  const c = paint.color ?? { r: 0, g: 0, b: 0 };
  return {
    r: c.r * alpha + beneath.r * (1 - alpha),
    g: c.g * alpha + beneath.g * (1 - alpha),
    b: c.b * alpha + beneath.b * (1 - alpha),
  };
}

const solidFills = (node: NodeLike): SolidPaint[] => {
  const fills = node.fills;
  if (!fills || typeof fills === 'symbol' || !Array.isArray(fills)) return [];
  return (fills as SolidPaint[]).filter((f) => f.type === 'SOLID' && f.visible !== false);
};

/**
 * What is actually behind a node, composited.
 *
 * The naive version takes the nearest ancestor with a fill and stops, which
 * reports a wrong ratio whenever that ancestor is translucent or sits on
 * something else. This walks the whole ancestor chain from the outside in,
 * compositing each solid fill in turn, and only then reads a colour. Nodes with
 * a gradient or image fill are not resolvable this way, so the walk treats them
 * as opaque unknowns and the caller skips the text over them.
 */
export function resolveBackdrop(node: NodeLike, pageBackground = '#FFFFFF'): string | undefined {
  const chain: NodeLike[] = [];
  for (let current = node.parent; current; current = current.parent ?? null) chain.unshift(current);

  const base = pageBackground.replace('#', '');
  let resolved: RGB = {
    r: parseInt(base.slice(0, 2), 16) / 255,
    g: parseInt(base.slice(2, 4), 16) / 255,
    b: parseInt(base.slice(4, 6), 16) / 255,
  };

  for (const ancestor of chain) {
    if (ancestor.visible === false) continue;
    const fills = solidFills(ancestor);
    const nonSolid = ancestor.fills;
    if (Array.isArray(nonSolid) && nonSolid.length > 0 && fills.length === 0) {
      // A gradient or image sits behind this text; no single colour describes it.
      return undefined;
    }
    for (const fill of fills) {
      resolved = over({ ...fill, opacity: (fill.opacity ?? 1) * (ancestor.opacity ?? 1) }, resolved);
    }
  }
  return hex(resolved);
}

/** Figma reports a style name; WCAG's large-text rule needs a number. */
export function weightOf(node: NodeLike): number {
  const weight = node.fontWeight;
  if (typeof weight === 'number') return weight;

  const font = node.fontName;
  const style = font && typeof font !== 'symbol' ? font.style.toLowerCase() : '';
  if (/thin|hairline/.test(style)) return 100;
  if (/extra ?light|ultra ?light/.test(style)) return 200;
  if (/light/.test(style)) return 300;
  if (/medium/.test(style)) return 500;
  if (/semi ?bold|demi ?bold/.test(style)) return 600;
  if (/extra ?bold|ultra ?bold/.test(style)) return 800;
  if (/black|heavy/.test(style)) return 900;
  if (/bold/.test(style)) return 700;
  return 400;
}

/** Figma reports px or percent; the instruments want em. */
function trackingEm(node: NodeLike, fontSize: number): number {
  const spacing = node.letterSpacing;
  if (!spacing || typeof spacing === 'symbol') return 0;
  return spacing.unit === 'PERCENT' ? spacing.value / 100 : spacing.value / fontSize;
}

/** Figma reports px, percent or AUTO; the instruments want a multiplier. */
function lineHeightMultiple(node: NodeLike, fontSize: number): number | undefined {
  const height = node.lineHeight;
  if (!height || typeof height === 'symbol') return undefined;
  if (height.unit === 'AUTO') return undefined;
  return height.unit === 'PERCENT' ? height.value / 100 : height.value / fontSize;
}

const CONTROL_HINT = /input|field|button|select|checkbox|radio|toggle|control|form|search/i;
const DECORATIVE_HINT = /divider|rule|hairline|separator|decor|ornament/i;

/** Walk a frame and produce the snapshot the analysis consumes. */
export function snapshotFrame(frame: NodeLike, pageBackground = '#FFFFFF'): FrameSnapshot {
  const texts: TextSnapshot[] = [];
  const boundaries: BoundarySnapshot[] = [];
  const spacing: number[] = [];

  const visit = (node: NodeLike): void => {
    if (node.visible === false) return;

    if (node.type === 'TEXT') {
      const fills = solidFills(node);
      const fill = fills[fills.length - 1];
      const backdrop = resolveBackdrop(node, pageBackground);
      const size = typeof node.fontSize === 'number' ? node.fontSize : undefined;

      // Text with no solid fill, no resolvable backdrop, or mixed sizes across
      // the run cannot be measured. Skipping is correct; guessing is not.
      if (fill?.color && backdrop && size) {
        const font = node.fontName;
        texts.push({
          id: node.id,
          name: node.name,
          characters: node.characters ?? '',
          fontSize: size,
          fontWeight: weightOf(node),
          letterSpacing: trackingEm(node, size),
          ...(lineHeightMultiple(node, size) !== undefined
            ? { lineHeight: lineHeightMultiple(node, size) as number }
            : {}),
          ...(font && typeof font !== 'symbol' ? { fontFamily: font.family } : {}),
          fill: hex(over(fill, { r: 1, g: 1, b: 1 })),
          backdrop,
          ...(node.width ? { width: node.width } : {}),
        });
      }
    }

    const strokes = node.strokes;
    if (Array.isArray(strokes) && strokes.length > 0 && node.type !== 'TEXT') {
      const stroke = (strokes as SolidPaint[]).find((s) => s.type === 'SOLID' && s.visible !== false);
      const backdrop = resolveBackdrop(node, pageBackground);
      if (stroke?.color && backdrop) {
        boundaries.push({
          id: node.id,
          name: node.name,
          color: hex(over(stroke, { r: 1, g: 1, b: 1 })),
          backdrop,
          role: CONTROL_HINT.test(node.name) ? 'control'
              : DECORATIVE_HINT.test(node.name) ? 'decorative'
              : 'unknown',
        });
      }
    }

    if (node.layoutMode && node.layoutMode !== 'NONE') {
      for (const value of [
        node.itemSpacing, node.paddingLeft, node.paddingRight,
        node.paddingTop, node.paddingBottom,
      ]) {
        if (typeof value === 'number' && value > 0) spacing.push(value);
      }
    }

    for (const child of node.children ?? []) visit(child);
  };

  visit(frame);

  return FrameSnapshot.parse({
    name: frame.name,
    width: frame.width ?? 1,
    height: frame.height ?? 1,
    texts,
    boundaries,
    spacing,
  });
}
