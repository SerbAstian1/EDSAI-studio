import { z } from 'zod';

/**
 * The design workbench's document: the thing a Brand Canvas saves.
 *
 * **Why this is a schema and not a screenshot.** Every other tool in the hub
 * saves the configuration that made a picture; this one saves the picture's
 * parts, so that reopening it gives back layers that can still be moved. The
 * consequence is that this document is the only thing crossing the wire for a
 * canvas design, and it is therefore the one thing that has to be *checked*
 * rather than trusted: it arrives from a browser, it names files, and a client
 * that could put another client's asset id in here would be reading that file
 * the next time the design opened.
 *
 * That is why `assetsInDesign` below exists and why `assetsInConfiguration`
 * routes this tool's configurations through it. Everything else here is shape.
 *
 * **Flat, not nested.** Nodes are an array with a `parentId`, rather than
 * children inside their parent, for two reasons that both showed up as bugs in
 * nested versions of this: a reorder becomes one splice instead of a recursive
 * rewrite of the tree, and a node's position is meaningful on its own — dragging
 * a shape out of a group is a matter of clearing one field, not rebuilding the
 * object it came out of. Array order is the stacking order, which is the one
 * piece of ordering state there is; a separate `zIndex` beside it would be a
 * second answer to the same question, and two answers disagree.
 */

export const DESIGN_VERSION = 1;

/**
 * A hex colour, six digits, and nothing else.
 *
 * The same definition `brand-hub.ts` uses, restated rather than imported
 * because that module imports *this* one for the tool registry; sharing a
 * private const across that pair would make the cycle a runtime one.
 */
const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const HEX_OR_NONE = HEX.or(z.literal(''));

/**
 * What a design node can be.
 *
 * A closed set rather than a string, and deliberately a set of *design
 * objects* rather than a list of renderers. A node that is "arbitrary HTML"
 * is a node whose properties nothing can validate and whose inspector nobody
 * can fill in, and this is the list that keeps the editor's promise that every
 * layer is one of a known kind with known controls.
 */
export const DESIGN_NODE_TYPES = [
  'text', 'image', 'shape', 'logo', 'illustration', 'pattern', 'texture', 'group',
] as const;

export type DesignNodeType = typeof DESIGN_NODE_TYPES[number];

/* -------------------------------------------------------------- properties */

/**
 * How a node sits against what is behind it.
 *
 * The five that a design system actually uses. `normal` is in the list rather
 * than being the absence of one so that the property is always a real choice:
 * a renderer that treats an unknown value as `normal` is a renderer that has
 * silently accepted something it was never given.
 */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const;
export type BlendMode = typeof BLEND_MODES[number];

const Blend = z.enum(BLEND_MODES);

/**
 * The four effects a first release has, and no more.
 *
 * Opacity, shadow, blur and blend are here because each is a single, well
 * defined transform that survives export identically. An inner shadow, a glow
 * and a background blur are all doable and none of them is yet; the list grows
 * when one of them renders the same in the editor as it does in the file, which
 * is a testable claim and the only reason to add one.
 */
export const NodeEffects = z.object({
  /** 0–1. Above the node's own `effects.opacity`; both multiply. */
  opacity: z.number().min(0).max(1).default(1),
  blur: z.number().min(0).max(200).default(0),
  shadow: z.object({
    enabled: z.boolean().default(false),
    x: z.number().min(-400).max(400).default(0),
    y: z.number().min(-400).max(400).default(12),
    blur: z.number().min(0).max(400).default(24),
    color: HEX.default('#000000'),
    opacity: z.number().min(0).max(1).default(0.25),
  }).default({}),
  blend: Blend.default('normal'),
}).default({});

export type NodeEffects = z.infer<typeof NodeEffects>;

/** What a text node says and how it is set. */
export const TextProperties = z.object({
  text: z.string().max(4000).default(''),
  fontFamily: z.string().min(1).max(120).default(''),
  fontWeight: z.number().int().min(100).max(900).default(400),
  fontSize: z.number().min(4).max(600).default(48),
  /** A multiple of the size, not a pixel height: it has to survive a resize. */
  lineHeight: z.number().min(0.5).max(4).default(1.2),
  /** Em-relative, so tracking scales with the type rather than sliding off it. */
  letterSpacing: z.number().min(-0.4).max(2).default(0),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Cased at render time, so the source keeps the author's own capitalisation. */
  transform: z.enum(['none', 'uppercase', 'lowercase']).default('none'),
  color: HEX.default('#111111'),
}).default({});
export type TextProperties = z.infer<typeof TextProperties>;

/** Adjustments that exist to reproduce a brand look, not to be a photo editor. */
export const ImageAdjustments = z.object({
  /** 0–2, 1 as it was. */
  brightness: z.number().min(0).max(2).default(1),
  contrast: z.number().min(0).max(2).default(1),
  saturation: z.number().min(0).max(2).default(1),
}).default({});

/** A picture: the client's own photography, or anything already approved. */
export const ImageProperties = z.object({
  assetId: z.string().min(1),
  /** Intrinsic size, captured when placed, so aspect ratio can be measured. */
  naturalWidth: z.number().min(1).max(20000).default(1),
  naturalHeight: z.number().min(1).max(20000).default(1),
  fit: z.enum(['fill', 'contain', 'cover']).default('cover'),
  cornerRadius: z.number().min(0).max(2000).default(0),
  adjustments: ImageAdjustments.default({}),
});
export type ImageProperties = z.infer<typeof ImageProperties>;

/** An illustration part. The same file, with the two things it can also do. */
export const IllustrationProperties = z.object({
  assetId: z.string().min(1),
  naturalWidth: z.number().min(1).max(20000).default(1),
  naturalHeight: z.number().min(1).max(20000).default(1),
  fit: z.enum(['fill', 'contain', 'cover']).default('contain'),
  cornerRadius: z.number().min(0).max(2000).default(0),
  /** A brand colour to knock the part into, or empty for the file's own. */
  tint: HEX_OR_NONE.default(''),
  flip: z.boolean().default(false),
});
export type IllustrationProperties = z.infer<typeof IllustrationProperties>;

/** A logo, and the one node whose manipulations a brand can forbid. */
export const LogoProperties = z.object({
  assetId: z.string().min(1),
  naturalWidth: z.number().min(1).max(20000).default(1),
  naturalHeight: z.number().min(1).max(20000).default(1),
  /**
   * The file's own proportions, recorded once when the logo is placed.
   *
   * This is what makes distortion *measurable* rather than a matter of taste:
   * without it, "was this logo squashed?" needs a second look at the original,
   * and a check that needs a second look is not a check.
   */
  sourceAspect: z.number().min(0.01).max(100).default(1),
  /** The brand's own name for this variant, so the rules can address it. */
  variant: z.string().min(1).max(60).default('primary'),
});
export type LogoProperties = z.infer<typeof LogoProperties>;

/** A tiled pattern: an approved file repeated inside the node's box. */
export const PatternProperties = z.object({
  assetId: z.string().min(1),
  /** Tile edge in px. The one dial a pattern is really judged on. */
  tile: z.number().min(8).max(2000).default(200),
  rotation: z.number().min(-180).max(180).default(0),
  offsetX: z.number().min(-1).max(1).default(0),
  offsetY: z.number().min(-1).max(1).default(0),
  /** A brand colour laid over the tile, or empty for the file's own. */
  color: HEX_OR_NONE.default(''),
});

/** A texture, which is a pattern the brand intends to be barely seen. */
export const TextureProperties = z.object({
  assetId: z.string().min(1),
  scale: z.number().min(8).max(2000).default(240),
  /** Kept on the node rather than in effects: a texture *is* its opacity. */
  opacity: z.number().min(0).max(1).default(0.35),
  blend: Blend.default('multiply'),
  color: HEX_OR_NONE.default(''),
});
export type TextureProperties = z.infer<typeof TextureProperties>;

/** Vector primitives. Fill, stroke, a corner. Nothing that pretends to be more. */
export const SHAPE_KINDS = [
  'rectangle', 'rounded-rectangle', 'ellipse', 'line', 'arrow', 'polygon',
] as const;

export const ShapeProperties = z.object({
  shape: z.enum(SHAPE_KINDS).default('rectangle'),
  fill: HEX.default('#EB5E28'),
  stroke: HEX.default('#252422'),
  /** Zero means no stroke, which is why the colour has no "none" of its own. */
  strokeWidth: z.number().min(0).max(200).default(0),
  cornerRadius: z.number().min(0).max(2000).default(0),
  /** Polygon points as fractions of the node's box, so a shape scales cleanly. */
  points: z.array(z.number().min(-4).max(4)).max(40).default([]),
});
export type ShapeProperties = z.infer<typeof ShapeProperties>;

/** A group holds no appearance of its own; it holds children and a name. */
export const GroupProperties = z.object({}).default({});

/* ------------------------------------------------------------------ nodes */

/**
 * Everything a node is regardless of what it is.
 *
 * `x`/`y` are the node's top-left corner *before* rotation, in artboard px,
 * and rotation turns it about its own centre. Keeping the untransformed box in
 * the document means a node's stored numbers are the ones the inspector shows
 * and the ones a template author typed, rather than something derived from a
 * rotation that has since changed.
 */
const NodeBase = {
  id: z.string().min(1).max(60),
  /** The group this node sits in, or null for the artboard itself. */
  parentId: z.string().min(1).max(60).nullable().default(null),
  name: z.string().min(1).max(80),
  x: z.number().min(-20000).max(20000),
  y: z.number().min(-20000).max(20000),
  width: z.number().min(1).max(20000),
  height: z.number().min(1).max(20000),
  rotation: z.number().min(-360).max(360).default(0),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  effects: NodeEffects.default({}),
};

export const TextNode = z.object({ ...NodeBase, type: z.literal('text'), properties: TextProperties });
export const ImageNode = z.object({ ...NodeBase, type: z.literal('image'), properties: ImageProperties });
export const ShapeNode = z.object({ ...NodeBase, type: z.literal('shape'), properties: ShapeProperties });
export const LogoNode = z.object({ ...NodeBase, type: z.literal('logo'), properties: LogoProperties });
export const IllustrationNode = z.object({ ...NodeBase, type: z.literal('illustration'), properties: IllustrationProperties });
export const PatternNode = z.object({ ...NodeBase, type: z.literal('pattern'), properties: PatternProperties });
export const TextureNode = z.object({ ...NodeBase, type: z.literal('texture'), properties: TextureProperties });
export const GroupNode = z.object({ ...NodeBase, type: z.literal('group'), properties: GroupProperties });

/**
 * One layer, as a discriminated union on `type`.
 *
 * The union is the point: `properties` is only ever the shape its own type
 * declares, so an image cannot be given `fontSize` and a text node cannot be
 * handed an asset id that no check will ever look at. It also means the
 * inspector can be written once per type and the compiler will refuse to render
 * a fill control for a logo.
 */
export const DesignNode = z.discriminatedUnion('type', [
  TextNode, ImageNode, ShapeNode, LogoNode,
  IllustrationNode, PatternNode, TextureNode, GroupNode,
]);
export type DesignNode = z.infer<typeof DesignNode>;

/* --------------------------------------------------------------- document */

/**
 * The sheet the design lives on.
 *
 * Dimensions are the file's own pixels and never change when the editor zooms:
 * zoom is a view, and a design that exports at a different size from the one
 * it was drawn at is the single most common way a canvas tool loses a client's
 * trust.
 */
export const Artboard = z.object({
  width: z.number().int().min(16).max(8000).default(1080),
  height: z.number().int().min(16).max(8000).default(1350),
  background: HEX.default('#FFFCF7'),
}).default({});
export type Artboard = z.infer<typeof Artboard>;

/**
 * A whole design: one artboard and its layers.
 *
 * `version` is written on every save and read on every open, so a document that
 * a later release has to restructure is recognisable rather than guessed at.
 *
 * **One artboard, and the shape does not forbid more.** Adding `artboards` as
 * an array later is a wider version of this field, and nothing else here has to
 * move: a node names no artboard because it names a parent, and the document's
 * root is currently the artboard itself.
 */
export const DesignDocument = z.object({
  version: z.literal(DESIGN_VERSION).default(DESIGN_VERSION),
  artboard: Artboard.default({}),
  nodes: z.array(DesignNode).max(400).default([]),
});
export type DesignDocument = z.infer<typeof DesignDocument>;

export const EMPTY_DOCUMENT: DesignDocument = DesignDocument.parse({});

/* ---------------------------------------------------------------- helpers */

/** The node types that point at a stored file. */
const ASSET_TYPES: ReadonlySet<DesignNodeType> = new Set([
  'image', 'logo', 'illustration', 'pattern', 'texture',
]);

/**
 * Every file a design refers to, or `undefined` if the document is not one.
 *
 * This is the whole isolation story for a canvas design, and it works because it
 * returns *nothing* when the shape is wrong: `assetsInConfiguration` hands the
 * result straight to the loop that refuses a file this client does not own, and
 * a malformed document that produced an empty list would sail past it. An
 * unparseable design is refused, not treated as a design with no files.
 *
 * Duplicates collapse, because the same logo placed twice is one file to check.
 */
export function assetsInDesign(configuration: unknown): string[] | undefined {
  const parsed = DesignDocument.safeParse(configuration);
  if (!parsed.success) return undefined;
  const ids = new Set<string>();
  for (const node of parsed.data.nodes) {
    if (!ASSET_TYPES.has(node.type)) continue;
    ids.add((node.properties as { assetId: string }).assetId);
  }
  return [...ids];
}

/** Whether this node holds a reference to a stored file. */
export function nodeAssetId(node: DesignNode): string | undefined {
  return ASSET_TYPES.has(node.type) ? (node.properties as { assetId: string }).assetId : undefined;
}

/**
 * The corners of a node once its rotation is applied, about its centre.
 *
 * Geometry, not rendering: the canvas needs it for hit testing and for the
 * selection box, and the export does not use it at all because the SVG applies
 * its own transform. A rotated node's *bounding* box is not its box — that is
 * the entire reason this function exists, and the reason the inspector keeps
 * showing the untransformed numbers rather than the corners' extent.
 */
export function rotatedCorners(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
): { x: number; y: number }[] {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rad = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local: { x: number; y: number }[] = [
    { x: node.x, y: node.y },
    { x: node.x + node.width, y: node.y },
    { x: node.x + node.width, y: node.y + node.height },
    { x: node.x, y: node.y + node.height },
  ];
  return local.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

/** The axis-aligned box that encloses a node's rotated corners. */
export function boundingBox(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
): { x: number; y: number; width: number; height: number } {
  if (node.rotation === 0) return { x: node.x, y: node.y, width: node.width, height: node.height };
  const corners = rotatedCorners(node);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The box around a set of nodes, for a multi-selection.
 *
 * Returns `undefined` for an empty set rather than a box at the origin, so a
 * caller that forgot to check for "nothing selected" gets `undefined` and fails
 * loudly rather than an inspector describing a shape at 0,0.
 */
export function selectionBox(
  nodes: readonly Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>[],
): { x: number; y: number; width: number; height: number } | undefined {
  if (nodes.length === 0) return undefined;
  const boxes = nodes.map(boundingBox);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * How far a node's shape has been stretched from its file's own proportions.
 *
 * One number, and `1` is untouched. A logo is the node this matters for, which
 * is why `sourceAspect` is recorded on the logo itself rather than looked up:
 * the rule is stated once and evaluated the same way wherever it is called.
 */
export function distortionOf(
  node: Pick<DesignNode, 'width' | 'height'>,
  sourceAspect: number,
): number {
  if (sourceAspect <= 0) return 1;
  return (node.width / node.height) / sourceAspect;
}
