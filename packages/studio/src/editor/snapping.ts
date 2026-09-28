import type { CanvasDocument, CanvasNode } from '../api.js';
import { boxOf, childrenOf, hitTest, nodeById, rotatedCorners, type Box } from './document.js';

/**
 * Snapping, guides, and finding out what was clicked.
 *
 * **Pure geometry over the document, not over the DOM.** Everything here takes a
 * document and numbers and returns numbers, which is what lets snapping be tested
 * without a browser and lets a drag be reasoned about before it starts. The stage
 * only ever hands over the current document and the pointer position.
 *
 * **Snapping is a measurement, not a jump.** The nudge is toward the guide, never
 * past it, and it is a fixed number of pixels in canvas space so it feels the
 * same at 12% and at 400% zoom. A snap that "helpfully" completed a drag to a
 * margin is a snap that moves a headline a designer did not ask to move.
 */

export const SNAP = 6;

export interface Guide {
  /** A vertical line at this x, or a horizontal one at this y. */
  axis: 'x' | 'y';
  at: number;
  /** Where it came from, for the readout. */
  label: string;
}

/** What a drag would be, once snapping has had its say. */
export interface SnapResult {
  /** The box to use, in canvas space. */
  box: Box;
  /** The guide lines to draw, empty when nothing was caught. */
  guides: Guide[];
  /** The move each snapped edge made, in canvas units, for the readout. */
  dx: number;
  dy: number;
}

/** How near an edge must be to be caught. */
const near = (a: number, b: number, tolerance = SNAP): boolean => Math.abs(a - b) <= tolerance;

/**
 * The lines a box should try to land on.
 *
 * **Every edge, and the middle — plus the artboard's thirds.** The sheet's own
 * centre and its thirds are the lines a designer actually wants, and a client who
 * has never heard of a layout grid still expects a centred logo to be centreable
 * by hand. The nodes' edges matter more than any of it; the sheet is the
 * fallback that makes an empty canvas usable.
 */
export function guidesFor(
  doc: CanvasDocument, exclude: readonly string[], extra: readonly { x: number; y: number; width: number; height: number }[] = [],
): { xs: { at: number; label: string }[]; ys: { at: number; label: string }[] } {
  const { width, height } = doc.artboard;
  const xs: { at: number; label: string }[] = [
    { at: 0, label: 'Left edge' },
    { at: width / 2, label: 'Centre' },
    { at: width, label: 'Right edge' },
    { at: width / 3, label: 'Third' },
    { at: (width * 2) / 3, label: 'Third' },
  ];
  const ys: { at: number; label: string }[] = [
    { at: 0, label: 'Top edge' },
    { at: height / 2, label: 'Centre' },
    { at: height, label: 'Bottom edge' },
    { at: height / 3, label: 'Third' },
    { at: (height * 2) / 3, label: 'Third' },
  ];

  for (const node of doc.nodes) {
    if (exclude.includes(node.id) || node.hidden) continue;
    const box = boxOf([node]);
    if (!box) continue;
    for (const [at, label] of [[box.x, node.name], [box.x + box.width / 2, node.name], [box.x + box.width, node.name]] as const) {
      if (!xs.some((g) => near(g.at, at))) xs.push({ at, label });
    }
    for (const [at, label] of [[box.y, node.name], [box.y + box.height / 2, node.name], [box.y + box.height, node.name]] as const) {
      if (!ys.some((g) => near(g.at, at))) ys.push({ at, label });
    }
  }
  for (const box of extra) {
    for (const at of [box.x, box.x + box.width / 2, box.x + box.width]) {
      if (!xs.some((g) => near(g.at, at))) xs.push({ at, label: 'Selection' });
    }
    for (const at of [box.y, box.y + box.height / 2, box.y + box.height]) {
      if (!ys.some((g) => near(g.at, at))) ys.push({ at, label: 'Selection' });
    }
  }
  return { xs, ys };
}

/**
 * Pull a moving box toward the guides, and say which ones it caught.
 *
 * **One snap per axis, and the best one wins.** Offering two lines at once — a
 * box centred and a box left-aligned at the same time — is the behaviour that
 * makes snapping feel like a fight. So each axis takes the single closest
 * candidate, and the guide it chose is what gets drawn.
 */
export function snapBox(
  doc: CanvasDocument,
  moving: Box,
  exclude: readonly string[],
): SnapResult {
  // No `extra` box here. The moving box's own edges would sit at a gap of exactly
  // zero from the edges being measured, so they would always win and the snap
  // would be a no-op - a guide drawn, a green line, and a layer that never moves.
  const { xs, ys } = guidesFor(doc, exclude);
  const edgesX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const edgesY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  let dx = 0;
  let dy = 0;
  const guides: Guide[] = [];

  let bestX: { gap: number; delta: number; guide: { at: number; label: string } } | undefined;
  for (const edge of edgesX) {
    for (const guide of xs) {
      const gap = Math.abs(guide.at - edge);
      if (gap <= SNAP && (bestX === undefined || gap < bestX.gap)) {
        bestX = { gap, delta: guide.at - edge, guide };
      }
    }
  }
  if (bestX) { dx = bestX.delta; guides.push({ axis: 'x', at: bestX.guide.at, label: bestX.guide.label }); }

  let bestY: { gap: number; delta: number; guide: { at: number; label: string } } | undefined;
  for (const edge of edgesY) {
    for (const guide of ys) {
      const gap = Math.abs(guide.at - edge);
      if (gap <= SNAP && (bestY === undefined || gap < bestY.gap)) {
        bestY = { gap, delta: guide.at - edge, guide };
      }
    }
  }
  if (bestY) { dy = bestY.delta; guides.push({ axis: 'y', at: bestY.guide.at, label: bestY.guide.label }); }

  return {
    box: { x: moving.x + dx, y: moving.y + dy, width: moving.width, height: moving.height },
    guides,
    dx,
    dy,
  };
}

/** Turn a guide into a line in screen space, so the stage does no arithmetic. */
export function guideLine(guide: Guide, viewport: { width: number; height: number }, scale: number): {
  x1: number; y1: number; x2: number; y2: number;
} {
  return guide.axis === 'x'
    ? { x1: guide.at * scale, y1: 0, x2: guide.at * scale, y2: viewport.height }
    : { x1: 0, y1: guide.at * scale, x2: viewport.width, y2: guide.at * scale };
}

/* ------------------------------------------------------------- hit testing */

/** How deep into a layer a click landed, deepest first. */
interface Candidate { node: CanvasNode; depth: number; area: number; order: number }

/**
 * What a click at this point means.
 *
 * **Paint order decides, and the tree is walked in it.** A click takes the top
 * visible layer whose *shape* it lands inside, not the top layer whose rectangle
 * it lands inside — a rotated headline with a box around it must be clickable on
 * its own outline, and a group's rectangle must not swallow clicks aimed at the
 * picture inside it. Groups are transparent to the click except for their own
 * direct label, so a group never becomes an invisible sheet over its contents.
 *
 * When a click misses everything, the next layer up is offered, because a designer
 * clicking a dense composition wants the layer underneath rather than an empty
 * canvas.
 */
export function pickAt(doc: CanvasDocument, x: number, y: number, skipGroups = true): CanvasNode | undefined {
  const candidates = pickAllAt(doc, x, y, skipGroups);
  if (candidates[0]) return candidates[0];
  // Nothing landed on a shape. A rotated layer with a transparent middle is still
  // worth offering, so the walk falls back to bounding boxes — but only for a
  // direct child of the artboard, never for a large layer buried behind things.
  return childrenOf(doc, null).find((node) => !node.hidden && node.type !== 'group'
    && x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height);
}

/** Every layer under a point, topmost first. */
export function pickAllAt(doc: CanvasDocument, x: number, y: number, skipGroups = true): CanvasNode[] {
  const found: Candidate[] = [];
  let order = 0;
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of childrenOf(doc, parentId)) {
      // Document order is paint order: later is on top. The index is what decides
      // a click between two layers of the same size at the same level, where
      // "smallest first" and "deepest first" are both ties and the sort would
      // otherwise hand back whichever was painted first - the one hidden behind.
      order += 1;
      if (node.hidden) continue;
      if (node.type !== 'group' && hitTest(node, x, y)) {
        found.push({ node, depth, area: Math.abs(node.width * node.height), order });
      }
      if (node.type === 'group') walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  // Deepest first, then smallest first: the small thing inside the big thing
  // wins, which is the same as "the thing you can see is the thing you clicked".
  // Paint order breaks the remaining ties, so the topmost of two equal layers wins.
  return found
    .sort((a, b) => b.depth - a.depth || a.area - b.area || b.order - a.order)
    .map((c) => c.node);
}

/** The corner of a node's own box, for the resize handles. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

/** Where a handle sits on a node's box, in canvas units. */
export function handleAt(node: CanvasNode, handle: Handle, inset = 0): { x: number; y: number } {
  const { x, y, width: w, height: h } = node;
  const left = x - inset;
  const right = x + w + inset;
  const top = y - inset;
  const bottom = y + h + inset;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (handle) {
    case 'nw': return { x: left, y: top };
    case 'n': return { x: cx, y: top };
    case 'ne': return { x: right, y: top };
    case 'e': return { x: right, y: cy };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: cx, y: bottom };
    case 'sw': return { x: left, y: bottom };
    case 'w': return { x: left, y: cy };
  }
}

/** The cursor a handle gets. Read off the handle, not off the drag state. */
export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

/** A handle in an unrotated box, ignoring the box's own rotation. */
export function handleInBox(box: Box, handle: Handle, inset = 0): { x: number; y: number } {
  const left = box.x - inset;
  const right = box.x + box.width + inset;
  const top = box.y - inset;
  const bottom = box.y + box.height + inset;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (handle) {
    case 'nw': return { x: left, y: top };
    case 'n': return { x: cx, y: top };
    case 'ne': return { x: right, y: top };
    case 'e': return { x: right, y: cy };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: cx, y: bottom };
    case 'sw': return { x: left, y: bottom };
    case 'w': return { x: left, y: cy };
  }
}

/**
 * Resize a box from one handle.
 *
 * **The opposite edge stays put.** That is the whole of resizing: the anchor does
 * not move, the dragged edge does, and a box never shifts as a side-effect of
 * being made wider. The handle decides which two edges move, so there is no
 * separate "top and left" case to forget.
 *
 * `ratio` keeps the proportions, which is what a corner drag does by default and
 * what every designer expects from a corner — while a side drag changes one
 * dimension only, because a side drag means it.
 */
export function resizeBox(
  box: Box, handle: Handle, dx: number, dy: number, ratio = false, min = 1,
): Box {
  let { x, y, width, height } = box;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes('w')) { x += dx; width -= dx; }
  if (handle.includes('e')) { width += dx; }
  if (handle.includes('n')) { y += dy; height -= dy; }
  if (handle.includes('s')) { height += dy; }

  if (ratio && width > 0 && height > 0) {
    const source = box.width / box.height;
    if (Math.abs(dx) >= Math.abs(dy)) height = width / source;
    else width = height * source;
    if (handle.includes('n')) y = bottom - height;
    if (handle.includes('w')) x = right - width;
  }

  if (width < min) { width = min; if (handle.includes('w')) x = right - min; }
  if (height < min) { height = min; if (handle.includes('n')) y = bottom - min; }
  return { x, y, width, height };
}

/** The pointer maths one drag needs, in one place. */
export interface Drag {
  /** Where the pointer went down, in canvas units. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  shift: boolean;
  alt: boolean;
}

/** The distance a drag has travelled, in canvas units. */
export const dragDistance = (drag: Drag): number =>
  Math.hypot(drag.to.x - drag.from.x, drag.to.y - drag.from.y);

/**
 * The corners of a rotated box, for drawing the selection.
 *
 * **The rotation is about the node's own centre**, which is what the renderer
 * does with `rotate(deg cx cy)` and what the inspector means by rotation. If the
 * selection frame were drawn as an unrotated rectangle it would lie about the
 * size of a rotated layer — and the frame is the only thing telling the designer
 * what they are about to move.
 */
export function frameCorners(box: Box, rotation: number): { x: number; y: number }[] {
  if (rotation === 0) {
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const angle = (rotation * Math.PI) / 180;
  const corner = (x: number, y: number): { x: number; y: number } => {
    const dx = x - cx;
    const dy = y - cy;
    return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
  };
  return [
    corner(box.x, box.y),
    corner(box.x + box.width, box.y),
    corner(box.x + box.width, box.y + box.height),
    corner(box.x, box.y + box.height),
  ];
}

/** The four corners of a node, rotation included. Re-exported for the stage. */
export { rotatedCorners, nodeById };
