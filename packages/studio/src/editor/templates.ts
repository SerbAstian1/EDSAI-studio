import type { CanvasDocument, CanvasNode } from '../api.js';
import { makeNode } from './document.js';

/**
 * What a new design can start as: a size, and a composition to lay on it.
 *
 * **Templates are compositions, never pictures.** §10 is explicit and the reason
 * is not aesthetic: a flattened template is a starting point a client cannot
 * move, and the whole claim of the canvas is that every layer stays editable. So
 * a template here is an ordinary list of nodes — the same ones a client builds by
 * hand — and opening one produces a design with layers in it.
 *
 * **Nothing here names a file.** A template cannot reference a client's logo
 * because it was written before the client existed, and a template that pointed
 * at some other client's asset would be the exact leak the whole system is built
 * to prevent. What a template does instead is leave *named space* — a logo block,
 * a footer rule — that the Logo panel drops the client's own file into.
 */

/** What a new design can be sized for, and what to call it. */
export interface DesignSize {
  id: string;
  label: string;
  group: 'Social' | 'Presentation' | 'Print' | 'Web';
  width: number;
  height: number;
  /** Shown under the label; the numbers are already there, so this is the use. */
  detail: string;
}

/**
 * The sizes, in the order the create sheet shows them.
 *
 * Grouped rather than a flat list because the question a client is answering is
 * "what am I making?", and a flat list of eleven number pairs does not answer it.
 */
export const DESIGN_SIZES: readonly DesignSize[] = [
  { id: 'instagram-post', label: 'Instagram post', group: 'Social', width: 1080, height: 1080, detail: '1080 × 1080' },
  { id: 'instagram-portrait', label: 'Instagram portrait', group: 'Social', width: 1080, height: 1350, detail: '1080 × 1350' },
  { id: 'instagram-story', label: 'Instagram story', group: 'Social', width: 1080, height: 1920, detail: '1080 × 1920' },
  { id: 'linkedin', label: 'LinkedIn post', group: 'Social', width: 1200, height: 1200, detail: '1200 × 1200' },
  { id: 'x-post', label: 'X post', group: 'Social', width: 1600, height: 900, detail: '1600 × 900' },
  { id: 'presentation', label: 'Presentation', group: 'Presentation', width: 1920, height: 1080, detail: '1920 × 1080 · 16:9' },
  { id: 'a4-poster', label: 'A4 poster', group: 'Print', width: 2480, height: 3508, detail: '2480 × 3508 · 300 dpi' },
  { id: 'a5-poster', label: 'A5 poster', group: 'Print', width: 1748, height: 2480, detail: '1748 × 2480 · 300 dpi' },
  { id: 'web-banner', label: 'Web banner', group: 'Web', width: 1600, height: 600, detail: '1600 × 600' },
  { id: 'link-in-bio', label: 'Link in bio', group: 'Web', width: 1080, height: 1920, detail: '1080 × 1920' },
];

/** The sizes, for the template panel. */
export function sizesInGroup(group: DesignSize['group']): readonly DesignSize[] {
  return DESIGN_SIZES.filter((size) => size.group === group);
}

/**
 * The brand's own type and colour, handed to a template at creation time.
 *
 * The reason a template takes these rather than deciding its own: two clients
 * should not receive the same design. A template that chose Space Grotesk would
 * put the wrong typeface in a brand whose identity was never that, and the
 * point of the canvas is that the brand is known before the first layer exists.
 */
export interface TemplateBrand {
  displayFont: string;
  bodyFont: string;
  /** The brand's darkest measured colour, or a neutral when it named none. */
  ink: string;
  /** The brand's most saturated colour, or a neutral. */
  accent: string;
  ground: string;
}

export const FALLBACK_BRAND: TemplateBrand = {
  displayFont: 'Space Grotesk, sans-serif',
  bodyFont: 'Inter, sans-serif',
  ink: '#16181C',
  accent: '#EB5E28',
  ground: '#FFFCF7',
};

/** What a template is called, and what it lays out. */
export interface DesignTemplate {
  id: string;
  label: string;
  detail: string;
  /** True for the empty sheet, which is offered first and always. */
  blank?: boolean;
  /** Applied to the artboard rather than the layers. */
  background?: string;
  build: (size: DesignSize, brand: TemplateBrand) => CanvasNode[];
}

/** Margins as a fraction of the short edge, so every size reads the same. */
function margin(size: DesignSize): number {
  return Math.round(Math.min(size.width, size.height) * 0.08);
}

/** A headline, set in the brand's display face at a size the sheet can carry. */
function heading(
  size: DesignSize, brand: TemplateBrand, text: string, y: number, height: number, fontSize: number,
): CanvasNode {
  return makeNode('text', { name: 'Headline', x: margin(size), y, width: size.width - margin(size) * 2, height },
    {
      text,
      fontFamily: brand.displayFont,
      fontWeight: 700,
      fontSize,
      lineHeight: 1.08,
      letterSpacing: -0.01,
      align: 'left',
      transform: 'none',
      color: brand.ink,
    });
}

/** A supporting line, set in the brand's body face. */
function subhead(
  size: DesignSize, brand: TemplateBrand, text: string, y: number, height: number, fontSize: number,
): CanvasNode {
  return makeNode('text', { name: 'Subheading', x: margin(size), y, width: size.width - margin(size) * 2, height },
    {
      text,
      fontFamily: brand.bodyFont,
      fontWeight: 400,
      fontSize,
      lineHeight: 1.35,
      letterSpacing: 0,
      align: 'left',
      transform: 'none',
      color: brand.ink,
    });
}

/** A filled block, for a band, a card or a photo that has not been placed yet. */
function block(
  size: DesignSize, name: string, y: number, height: number, fill: string,
): CanvasNode {
  return makeNode('shape', { name, x: 0, y, width: size.width, height },
    { shape: 'rectangle', fill, stroke: fill, strokeWidth: 0, cornerRadius: 0, points: [] });
}

/** A short bar in the brand's accent, the one mark every template can share. */
function rule(size: DesignSize, name: string, x: number, y: number, height: number, fill: string): CanvasNode {
  return makeNode('shape', { name, x, y, width: Math.round(size.width * 0.14), height: Math.max(4, height) },
    { shape: 'rectangle', fill, stroke: fill, strokeWidth: 0, cornerRadius: 0, points: [] });
}

/**
 * Every template.
 *
 * **Each one is honest about what it is**: a name, a note, and layers. Where a
 * template reserves space for the client's own logo it says so in the note, so
 * the panel reads as a description of a layout rather than as a mystery. Nothing
 * is invented on the client's behalf — a template that placed a fake mark would be
 * a template that put something untrue on a poster.
 */
export const DESIGN_TEMPLATES: readonly DesignTemplate[] = [
  {
    id: 'blank',
    label: 'Blank canvas',
    detail: 'Just the sheet. Add the logo, a headline and a picture.',
    blank: true,
    build: () => [],
  },
  {
    id: 'announcement',
    label: 'Announcement',
    detail: 'A full-bleed band, a headline and a line of support. Space for the logo above.',
    build: (size, brand) => [
      block(size, 'Band', 0, Math.round(size.height * 0.42), brand.accent),
      heading(size, brand, 'The headline goes here', Math.round(size.height * 0.52), Math.round(size.height * 0.18), Math.round(size.height * 0.062)),
      subhead(size, brand, 'One supporting line, in the brand’s body face.', Math.round(size.height * 0.72), Math.round(size.height * 0.1), Math.round(size.height * 0.026)),
    ],
  },
  {
    id: 'split',
    label: 'Split campaign',
    detail: 'Picture on one side, words on the other. A logo-sized gap sits top left.',
    build: (size, brand) => {
      const half = Math.round(size.width * 0.52);
      const pictureX = size.width - half;
      const left: DesignSize = { ...size, width: half };
      return [
        block(size, 'Picture', 0, size.height, brand.ink),
        {
          ...rule(left, 'Rule', margin(left), Math.round(size.height * 0.14), Math.round(size.height * 0.02), brand.accent),
          x: pictureX,
        },
        heading(left, brand, 'Words on the left', Math.round(size.height * 0.38), Math.round(size.height * 0.2), Math.round(size.height * 0.05)),
        subhead(left, brand, 'And a line beneath.', Math.round(size.height * 0.6), Math.round(size.height * 0.12), Math.round(size.height * 0.024)),
      ];
    },
  },
  {
    id: 'statement',
    label: 'Full-bleed statement',
    detail: 'One word across the whole sheet. For a campaign that says one thing.',
    build: (size, brand) => [
      block(size, 'Ground', 0, size.height, brand.ink),
      makeNode('text', {
        name: 'Statement',
        x: margin(size),
        y: Math.round(size.height * 0.4),
        width: size.width - margin(size) * 2,
        height: Math.round(size.height * 0.2),
      }, {
        text: 'Say it',
        fontFamily: brand.displayFont,
        fontWeight: 700,
        fontSize: Math.round(size.height * 0.13),
        lineHeight: 1,
        letterSpacing: -0.02,
        align: 'center',
        transform: 'uppercase',
        color: brand.ground,
      }),
    ],
  },
  {
    id: 'quote',
    label: 'Quote',
    detail: 'A pull quote with attribution beneath. Long reading, quiet ground.',
    build: (size, brand) => [
      rule(size, 'Rule', margin(size), Math.round(size.height * 0.3), Math.round(size.height * 0.006), brand.accent),
      heading(size, brand, 'A sentence worth repeating.', Math.round(size.height * 0.36), Math.round(size.height * 0.26), Math.round(size.height * 0.045)),
      subhead(size, brand, '— who said it', Math.round(size.height * 0.68), Math.round(size.height * 0.08), Math.round(size.height * 0.022)),
    ],
  },
];

/** The template a new design opens on when nothing else is chosen. */
export const DEFAULT_TEMPLATE = DESIGN_TEMPLATES[0]!;

/**
 * A new design: the sheet at a size, with a template's layers on it.
 *
 * Built through the same `makeNode` the editor uses, so a template layer is
 * indistinguishable from one a client dragged in — which is the test that a
 * template really is an editable composition and not a special kind of thing.
 */
export function documentFromTemplate(
  size: DesignSize,
  template: DesignTemplate,
  brand: TemplateBrand,
): CanvasDocument {
  const background = template.background ?? brand.ground;
  const nodes = template.blank ? [] : template.build(size, brand);
  return { version: 1, artboard: { width: size.width, height: size.height, background }, nodes };
}

/** A suggested file name for a design, before anyone types one. */
export function suggestName(size: DesignSize): string {
  return size.label.replace(/\b\w/g, (c) => c.toUpperCase());
}
