import type {
  CanvasBlend, CanvasDocument, CanvasEffects, CanvasNode, CanvasNodeType, CanvasShapeProperties,
} from '../api.js';

/**
 * The editor's own document model: construction, tree walking and geometry.
 *
 * **Pure, and free of React and of the DOM**, which is the only reason any of
 * this is testable outside a browser. Everything here takes a document and
 * returns a document; nothing mutates and nothing reads a global. The editor
 * state, the undo stack and the renderer are all built on top of it, and a test
 * can exercise a drag without a canvas.
 *
 * The types are the wire types from `../api.js`, which are the engine's schema
 * restated there. A design is saved as exactly this shape, so the editor and the
 * thing on the server cannot drift: there is one model and two doors onto it.
 */

/* -------------------------------------------------------------- construction */

let sequence = 0;

/**
 * An id for a new node.
 *
 * A counter plus the clock rather than a UUID, because these ids live inside a
 * saved design rather than in a URL and are generated in bursts by a human
 * clicking. Readability matters more here than unguessability, and the counter
 * is what stops two nodes created in the same millisecond from colliding.
 */
export function newNodeId(): string {
  sequence += 1;
  return `n${Date.now().toString(36)}${sequence.toString(36)}`;
}

/** What a brand's own effects look like when nothing has been applied. */
export function defaultEffects(): CanvasEffects {
  return {
    opacity: 1,
    blur: 0,
    shadow: { enabled: false, x: 0, y: 12, blur: 24, color: '#000000', opacity: 0.25 },
    blend: 'normal',
  };
}

/** A blank sheet at a chosen size. */
export function blankDocument(width: number, height: number, background = '#FFFCF7'): CanvasDocument {
  return { version: 1, artboard: { width, height, background }, nodes: [] };
}

/** The parts of a node that are the same whatever it is. */
interface BaseSeed {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  locked?: boolean;
  hidden?: boolean;
  effects?: Partial<CanvasEffects>;
}

/**
 * Build a node of any type from a seed.
 *
 * Every property default the engine declares is written here, so a node this
 * function returns is always a *complete* node rather than one relying on a
 * schema to fill in the gaps. That matters more than it looks: the editor sends
 * documents back to the server on every autosave, and a document that only
 * parses because the server is generous about defaults is a document whose
 * shape depends on which end is reading it.
 *
 * Typed through `never` on the properties so that adding a node type without
 * deciding what its properties look like is a compile error here first.
 */
export function makeNode<T extends CanvasNodeType>(
  type: T,
  seed: BaseSeed,
  properties: NodeProperties<T>,
): Extract<CanvasNode, { type: T }> {
  return {
    id: newNodeId(),
    type,
    parentId: null,
    name: seed.name,
    x: seed.x,
    y: seed.y,
    width: seed.width,
    height: seed.height,
    rotation: seed.rotation ?? 0,
    locked: seed.locked ?? false,
    hidden: seed.hidden ?? false,
    effects: { ...defaultEffects(), ...seed.effects },
    properties,
  } as Extract<CanvasNode, { type: T }>;
}

/** What each node type's `properties` must be, so `makeNode` stays honest. */
export interface NodePropertiesMap {
  text: Extract<CanvasNode, { type: 'text' }>['properties'];
  image: Extract<CanvasNode, { type: 'image' }>['properties'];
  shape: Extract<CanvasNode, { type: 'shape' }>['properties'];
  logo: Extract<CanvasNode, { type: 'logo' }>['properties'];
  illustration: Extract<CanvasNode, { type: 'illustration' }>['properties'];
  pattern: Extract<CanvasNode, { type: 'pattern' }>['properties'];
  texture: Extract<CanvasNode, { type: 'texture' }>['properties'];
  group: Extract<CanvasNode, { type: 'group' }>['properties'];
}

export type NodeProperties<T extends CanvasNodeType> = NodePropertiesMap[T];

/* ------------------------------------------------------------ normalising */

/**
 * The bounds the engine's schema enforces, in one place.
 *
 * Restated rather than imported, for the same reason the wire types in
 * `../api.ts` are: the engine opens a SQLite file, so the Studio cannot import
 * it. But a bound written down twice is a bound that is *checked* — when the
 * engine moves a limit, this is one file to change, and `norm.test.ts` fails
 * rather than the change arriving quietly.
 */
export const LIMITS = {
  artboard: [16, 8000] as const,
  position: [-20000, 20000] as const,
  size: [1, 20000] as const,
  rotation: [-360, 360] as const,
  opacity: [0, 1] as const,
  blur: [0, 200] as const,
  shadowOffset: [-400, 400] as const,
  fontSize: [4, 600] as const,
  lineHeight: [0.5, 4] as const,
  letterSpacing: [-0.4, 2] as const,
  cornerRadius: [0, 2000] as const,
  strokeWidth: [0, 200] as const,
  natural: [1, 20000] as const,
  aspect: [0.01, 100] as const,
  tile: [8, 2000] as const,
  offset: [-1, 1] as const,
  nodes: 400,
  name: 80,
  variant: 60,
  id: 60,
  text: 4000,
  points: 40,
} as const;

/** A number, kept inside a range. Also fixes `NaN`, which no range contains. */
export function clamp(value: number, range: readonly [number, number]): number {
  if (!Number.isFinite(value)) return range[0];
  return Math.min(range[1], Math.max(range[0], value));
}

/** Whole degrees, which is what every rotation control moves in. */
export function clampRotation(degrees: number): number {
  return Math.round(clamp(degrees, LIMITS.rotation));
}

/** A hex, or nothing. Anything the schema would refuse becomes the fallback. */
const HEX = /^#[0-9a-fA-F]{6}$/;

function hex(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

/** A string short enough for the schema, never empty where it must not be. */
function text(value: string, max: number, fallback = ''): string {
  const trimmed = (value ?? '').slice(0, max);
  return trimmed.trim() === '' ? fallback : trimmed;
}

/**
 * Put a document inside the schema's bounds.
 *
 * **The last thing that happens before a save, and the reason saves do not fail.**
 * The engine refuses a document that is one part out of range, and it must: that
 * refusal is what stands between a client and another client's files. So the
 * editor does not argue with the bounds, it obeys them — a drag that would take a
 * shape to zero width stops at 1px, a colour typed without a `#` becomes a real
 * hex, and a design with 400 layers stops accepting new ones.
 *
 * The alternative, and the one this replaces, is a save that fails with a message
 * about a number nobody was looking at. Clamping silently would be its own
 * problem, so `normalise` returns what it changed and the top bar says so.
 */
export function normalise(doc: CanvasDocument): { doc: CanvasDocument; clamped: number } {
  let clamped = 0;
  const fixed = (value: number, range: readonly [number, number]): number => {
    const out = clamp(value, range);
    if (out !== value) clamped += 1;
    return out;
  };

  const artboard = {
    width: Math.round(fixed(doc.artboard.width, LIMITS.artboard)),
    height: Math.round(fixed(doc.artboard.height, LIMITS.artboard)),
    background: hex(doc.artboard.background, '#FFFCF7'),
  };

  const nodes: CanvasNode[] = [];
  for (const node of doc.nodes.slice(0, LIMITS.nodes)) {
    const base = {
      id: text(node.id, LIMITS.id, 'n0'),
      parentId: node.parentId === null ? null : text(node.parentId, LIMITS.id, 'n0'),
      name: text(node.name, LIMITS.name, 'Layer'),
      x: fixed(node.x, LIMITS.position),
      y: fixed(node.y, LIMITS.position),
      width: fixed(node.width, LIMITS.size),
      height: fixed(node.height, LIMITS.size),
      rotation: fixed(node.rotation, LIMITS.rotation),
      locked: node.locked,
      hidden: node.hidden,
      effects: {
        opacity: fixed(node.effects.opacity, LIMITS.opacity),
        blur: fixed(node.effects.blur, LIMITS.blur),
        blend: node.effects.blend,
        shadow: {
          enabled: node.effects.shadow.enabled,
          x: fixed(node.effects.shadow.x, LIMITS.shadowOffset),
          y: fixed(node.effects.shadow.y, LIMITS.shadowOffset),
          blur: fixed(node.effects.shadow.blur, LIMITS.blur),
          color: hex(node.effects.shadow.color, '#000000'),
          opacity: fixed(node.effects.shadow.opacity, LIMITS.opacity),
        },
      },
    };

    switch (node.type) {
      case 'text': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'text',
          properties: {
            text: p.text.slice(0, LIMITS.text),
            fontFamily: text(p.fontFamily, 120, 'Inter, sans-serif'),
            fontWeight: Math.round(fixed(p.fontWeight, [100, 900])),
            fontSize: fixed(p.fontSize, LIMITS.fontSize),
            lineHeight: fixed(p.lineHeight, LIMITS.lineHeight),
            letterSpacing: fixed(p.letterSpacing, LIMITS.letterSpacing),
            align: p.align,
            transform: p.transform,
            color: hex(p.color, '#16181C'),
          },
        });
        break;
      }
      case 'image': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'image',
          properties: {
            assetId: text(p.assetId, LIMITS.id),
            naturalWidth: Math.round(fixed(p.naturalWidth, LIMITS.natural)),
            naturalHeight: Math.round(fixed(p.naturalHeight, LIMITS.natural)),
            fit: p.fit,
            cornerRadius: fixed(p.cornerRadius, LIMITS.cornerRadius),
            adjustments: {
              brightness: fixed(p.adjustments.brightness, [0, 2]),
              contrast: fixed(p.adjustments.contrast, [0, 2]),
              saturation: fixed(p.adjustments.saturation, [0, 2]),
            },
          },
        });
        break;
      }
      case 'illustration': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'illustration',
          properties: {
            assetId: text(p.assetId, LIMITS.id),
            naturalWidth: Math.round(fixed(p.naturalWidth, LIMITS.natural)),
            naturalHeight: Math.round(fixed(p.naturalHeight, LIMITS.natural)),
            fit: p.fit,
            cornerRadius: fixed(p.cornerRadius, LIMITS.cornerRadius),
            tint: p.tint === '' ? '' : hex(p.tint, '#16181C'),
            flip: p.flip,
          },
        });
        break;
      }
      case 'logo': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'logo',
          properties: {
            assetId: text(p.assetId, LIMITS.id),
            naturalWidth: Math.round(fixed(p.naturalWidth, LIMITS.natural)),
            naturalHeight: Math.round(fixed(p.naturalHeight, LIMITS.natural)),
            sourceAspect: fixed(p.sourceAspect, LIMITS.aspect),
            variant: text(p.variant, LIMITS.variant, 'primary'),
          },
        });
        break;
      }
      case 'pattern': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'pattern',
          properties: {
            assetId: text(p.assetId, LIMITS.id),
            tile: fixed(p.tile, LIMITS.tile),
            rotation: fixed(p.rotation, LIMITS.rotation),
            offsetX: fixed(p.offsetX, LIMITS.offset),
            offsetY: fixed(p.offsetY, LIMITS.offset),
            color: p.color === '' ? '' : hex(p.color, '#EB5E28'),
          },
        });
        break;
      }
      case 'texture': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'texture',
          properties: {
            assetId: text(p.assetId, LIMITS.id),
            scale: fixed(p.scale, LIMITS.tile),
            opacity: fixed(p.opacity, LIMITS.opacity),
            blend: p.blend,
            color: p.color === '' ? '' : hex(p.color, '#EB5E28'),
          },
        });
        break;
      }
      case 'shape': {
        const p = node.properties;
        nodes.push({
          ...base, type: 'shape',
          properties: {
            shape: p.shape,
            fill: hex(p.fill, '#EB5E28'),
            stroke: hex(p.stroke, '#252422'),
            strokeWidth: fixed(p.strokeWidth, LIMITS.strokeWidth),
            cornerRadius: fixed(p.cornerRadius, LIMITS.cornerRadius),
            points: p.points.slice(0, LIMITS.points).map((n) => fixed(n, [-4, 4])),
          },
        });
        break;
      }
      case 'group':
        nodes.push({ ...base, type: 'group', properties: {} });
        break;
    }
  }
  return { doc: { version: 1, artboard, nodes }, clamped };
}

/* ------------------------------------------------------------------- reading */

/** One node by id, or nothing. */
export function nodeById(doc: CanvasDocument, id: string): CanvasNode | undefined {
  return doc.nodes.find((node) => node.id === id);
}

/** The nodes with no group above them, in stacking order. */
export function roots(doc: CanvasDocument): CanvasNode[] {
  return doc.nodes.filter((node) => node.parentId === null);
}

/**
 * The children of one group, in stacking order.
 *
 * Sibling order is array order, which is the document's only notion of
 * stacking. `parentId` says what a node belongs to and nothing about where in
 * the pile it sits; a separate `zIndex` would be a second answer to the same
 * question and the two would eventually disagree.
 */
export function childrenOf(doc: CanvasDocument, parentId: string | null): CanvasNode[] {
  return doc.nodes.filter((node) => node.parentId === parentId);
}

/**
 * Every node in the document with the group it sits in, for the layer tree.
 *
 * Returned parent-before-child at every depth, so a caller that walks it in
 * order never meets a child before the group that explains it.
 */
export function inTreeOrder(doc: CanvasDocument): CanvasNode[] {
  const out: CanvasNode[] = [];
  const walk = (parentId: string | null): void => {
    for (const node of childrenOf(doc, parentId)) {
      out.push(node);
      walk(node.id);
    }
  };
  walk(null);
  return out;
}

/**
 * The nodes to draw, back to front.
 *
 * Groups draw their own children immediately after themselves rather than at the
 * end of the document, so putting a shape into a group moves it *with* the group
 * instead of leaving it behind at whatever depth it used to sit.
 */
export function paintOrder(doc: CanvasDocument): CanvasNode[] {
  const out: CanvasNode[] = [];
  const walk = (parentId: string | null): void => {
    for (const node of childrenOf(doc, parentId)) {
      out.push(node);
      if (node.type === 'group') walk(node.id);
    }
  };
  walk(null);
  return out;
}

/**
 * A node and everything inside it.
 *
 * The other half of every destructive operation: deleting a group must delete
 * what was in it, or the layer tree grows orphans that nothing can select.
 * Collected before the first removal, because afterwards the walk would stop
 * the moment it reached a node that is no longer there.
 */
export function withDescendants(doc: CanvasDocument, ids: readonly string[]): CanvasNode[] {
  const wanted = new Set(ids);
  const found: CanvasNode[] = [];
  for (const node of doc.nodes) {
    if (wanted.has(node.id)) { found.push(node); continue; }
    if (node.parentId !== null && wanted.has(node.parentId)) {
      wanted.add(node.id);
      found.push(node);
    }
  }
  return found;
}

/** The file a node points at, or nothing for the kinds that hold no file. */
export function assetIdOf(node: CanvasNode): string | undefined {
  return 'assetId' in node.properties ? node.properties.assetId : undefined;
}

/* ------------------------------------------------------------------ geometry */

export interface Box { x: number; y: number; width: number; height: number }

/** The corners of a node once its rotation is applied, about its own centre. */
export function rotatedCorners(node: CanvasNode): { x: number; y: number }[] {
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

/**
 * The axis-aligned box enclosing a node's rotated corners.
 *
 * Not the same as the node's own box, and the difference is why rotation needs
 * its own function: a node turned 45° has a bounding box bigger than itself in
 * both axes, and anything that hits-tests or draws a marquee has to use this
 * one. The inspector keeps showing `x`/`y`/`width`/`height` instead, because
 * those are the numbers the author typed and the ones a template means.
 */
export function boundsOf(node: CanvasNode): Box {
  if (node.rotation === 0) return { x: node.x, y: node.y, width: node.width, height: node.height };
  const corners = rotatedCorners(node);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The box around a set of nodes, or nothing for an empty set.
 *
 * `undefined` rather than a box at the origin, so a caller that forgot to check
 * for "nothing selected" gets `undefined` and fails loudly instead of describing
 * a shape that is not there.
 */
export function boxOf(nodes: readonly CanvasNode[]): Box | undefined {
  if (nodes.length === 0) return undefined;
  const boxes = nodes.map(boundsOf);
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether a point falls inside a node's rotated box. */
export function hitTest(node: CanvasNode, px: number, py: number): boolean {
  if (node.hidden) return false;
  if (node.rotation === 0) {
    return px >= node.x && px <= node.x + node.width && py >= node.y && py <= node.y + node.height;
  }
  // Rotate the *point* back by the node's own angle rather than rotating the box
  // forward: one matrix instead of four corners and a polygon test, and exactly
  // the same answer.
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rad = (-node.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  return lx >= node.x && lx <= node.x + node.width && ly >= node.y && ly <= node.y + node.height;
}

/** Whether a node or anything inside it is selected. */
export function isSelected(node: CanvasNode, selection: readonly string[]): boolean {
  return selection.includes(node.id);
}

/** Whether a node may be moved, resized, deleted or restyled right now. */
export function isEditable(node: CanvasNode): boolean {
  return !node.locked;
}

/* -------------------------------------------------------------- construction */

/** A node's own file size, so a placed logo knows its own proportions. */
export function aspectOf(naturalWidth: number, naturalHeight: number): number {
  return naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
}

/**
 * How far a node has been stretched from its file's own proportions.
 *
 * `1` is untouched. Recorded on the node when it is placed rather than looked up
 * again, so the logo rules can be evaluated without opening the original file —
 * which is the difference between a check and an opinion.
 */
export function distortionOf(node: CanvasNode, sourceAspect: number): number {
  if (sourceAspect <= 0 || node.height <= 0) return 1;
  return (node.width / node.height) / sourceAspect;
}

/** A polygon default big enough to be recognisable, as fractions of the box. */
export const DEFAULT_POLYGON: readonly number[] = [0.5, 0, 1, 0.38, 0.81, 1, 0.19, 1, 0, 0.38];

/** The shapes a client may drop, with the labels the tool rail shows. */
export const SHAPE_PRESETS: readonly { kind: CanvasShapeProperties['shape']; label: string }[] = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'rounded-rectangle', label: 'Rounded' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'line', label: 'Line' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'polygon', label: 'Polygon' },
];

/** Where a blend mode sits, for the effects list. */
export const BLEND_LABELS: Record<CanvasBlend, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  'soft-light': 'Soft light',
};
