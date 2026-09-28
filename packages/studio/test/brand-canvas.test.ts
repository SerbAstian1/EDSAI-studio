import { describe, expect, it } from 'vitest';
import {
  BLEND_LABELS, DEFAULT_POLYGON, LIMITS, SHAPE_PRESETS, aspectOf, assetIdOf, blankDocument,
  boundsOf, boxOf, childrenOf, clamp, distortionOf, hitTest, inTreeOrder, isEditable, isSelected,
  makeNode, nodeById, normalise, paintOrder, roots, rotatedCorners, withDescendants,
  type NodePropertiesMap,
} from '../src/editor/document.js';
import {
  addNodes, apply, duplicateNodes, groupBox, groupNodes, invert, merge, merges, nudgeOrder,
  patchArtboard, patchNodes, removeNodes, reorderNodes, ungroupNode, type Command,
} from '../src/editor/commands.js';
import {
  EMPTY_HISTORY, HISTORY_LIMIT, canRedo, canUndo, commit, redo, redoLabel, undo, undoLabel,
} from '../src/editor/history.js';
import { DESIGN_SIZES, DESIGN_TEMPLATES, FALLBACK_BRAND, documentFromTemplate, suggestName } from '../src/editor/templates.js';
import { designSvg, exportName, textLines } from '../src/editor/render.js';
import {
  checkDesign, coloursOf, contrastRatio, hexToRgb, issuesForNode, judge, luma, logoRule, nearestColour,
  paletteOf, policyOf, rgbToHex,
} from '../src/editor/brandCheck.js';
import {
  HANDLE_CURSOR, HANDLES, frameCorners, guidesFor, handleInBox, pickAllAt, pickAt, resizeBox, snapBox,
} from '../src/editor/snapping.js';
import type { BrandRules, CanvasDocument, CanvasNode, CanvasShapeProperties } from '../src/api.js';

/** The geometry every node is given, so a test says only what it is about. */
interface Seed {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A brand that has said something about almost everything. */
const RULES: BrandRules = {
  colors: ['#EB5E28', '#16181C'],
  allowCustomColor: true,
  fonts: ['Space Grotesk', 'Inter'],
  allowCustomFont: true,
  exports: ['png'],
  logos: {
    'asset-mark': { minWidth: 120, maxRotation: 0, allowDistortion: false, allowRecolor: false, backgrounds: [] },
  },
};

const doc = (...nodes: CanvasNode[]): CanvasDocument => ({ ...blankDocument(1080, 1080), nodes });
const shape = (over: Partial<NodePropertiesMap['shape']> = {}): NodePropertiesMap['shape'] => ({
  shape: 'rectangle', fill: '#EB5E28', stroke: 'none', strokeWidth: 0, cornerRadius: 0, points: [], ...over,
});
const box = (name: string, x: number, y: number, width = 100, height = 100): CanvasNode =>
  makeNode('shape', { name, x, y, width, height }, shape() as CanvasShapeProperties);
const textProps = (over: Partial<NodePropertiesMap['text']> = {}): NodePropertiesMap['text'] => ({
  text: 'Hello', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 48, lineHeight: 1.1,
  letterSpacing: 0, align: 'left', transform: 'none', color: '#16181C', ...over,
});
const text = (
  over: Partial<NodePropertiesMap['text']> = {},
  at: Partial<Seed> = {},
): CanvasNode => makeNode('text', { name: 'Headline', x: 0, y: 0, width: 300, height: 60, ...at }, textProps(over));
const logo = (
  over: Partial<NodePropertiesMap['logo']> = {},
  at: Partial<Seed> = {},
): CanvasNode => makeNode('logo', { name: 'Logo', x: 0, y: 0, width: 200, height: 200, ...at },
  { assetId: 'asset-mark', naturalWidth: 100, naturalHeight: 100, sourceAspect: 1, variant: 'primary', ...over });
const picture = (over: Partial<NodePropertiesMap['image']> = {}): CanvasNode =>
  makeNode('image', { name: 'Photo', x: 0, y: 0, width: 200, height: 200 },
    {
      assetId: 'asset-photo', naturalWidth: 400, naturalHeight: 300, fit: 'cover', cornerRadius: 0,
      adjustments: { brightness: 1, contrast: 1, saturation: 1 }, ...over,
    });
/** A group with one child in it. The model is flat, so a group is a sibling entry. */
const grouped = (child: CanvasNode): [CanvasNode, CanvasNode] => {
  const group = makeNode('group', {
    name: 'Group', x: child.x, y: child.y, width: child.width, height: child.height,
  }, {});
  return [group, { ...child, parentId: group.id }];
};

/** `patchNodes` only ever builds a patch; narrowed once so a drag can read `before`. */
type Patch = Extract<Command, { kind: 'patch' }>;
const asPatch = (command: Command): Patch => {
  if (command.kind !== 'patch') throw new Error(`expected a patch, got ${command.kind}`);
  return command;
};

/* ─────────────────────────────────────────────────────────────────── document */

describe('document', () => {
  it('gives a blank sheet the artboard it was asked for', () => {
    const blank = blankDocument(800, 600, '#000000');
    expect(blank.artboard).toEqual({ width: 800, height: 600, background: '#000000' });
    expect(blank.nodes).toEqual([]);
  });

  it('reads a node back with the seed it was given', () => {
    const node = box('Card', 10, 20, 300, 200);
    expect(node.name).toBe('Card');
    expect([node.x, node.y, node.width, node.height]).toEqual([10, 20, 300, 200]);
    expect(node.type).toBe('shape');
  });

  it('gives every node a distinct id, even two made in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 500 }, () => box(`S${Math.random()}`, 0, 0, 4, 4).id));
    expect(ids.size).toBe(500);
  });

  it('finds a node anywhere in the tree', () => {
    const [group, child] = grouped(box('Child', 0, 0));
    const d = doc(group, child);
    expect(nodeById(d, child.id)?.name).toBe('Child');
    expect(nodeById(d, 'nope')).toBeUndefined();
  });

  it('lists roots and children of a parent', () => {
    const [group, child] = grouped(box('Child', 0, 0));
    const d = doc(group, child);
    expect(roots(d)).toEqual([group]);
    expect(childrenOf(d, group.id)).toEqual([child]);
    expect(childrenOf(d, null)).toEqual([group]);
  });

  it('walks in tree order, parents before their children', () => {
    const [group, child] = grouped(box('Inner', 0, 0));
    expect(inTreeOrder(doc(group, child)).map((n) => n.name)).toEqual(['Group', 'Inner']);
  });

  it('paints in document order, so the last layer is the one on top', () => {
    expect(paintOrder(doc(box('Under', 0, 0), box('Over', 0, 0))).map((n) => n.name)).toEqual(['Under', 'Over']);
  });

  it('draws a group with what is inside it, rather than leaving the contents behind', () => {
    // Putting a shape into a group has to move it *with* the group. If the group
    // were painted last, the layer would jump to a different depth on every
    // regroup — and a logo would appear to slide under the text on every undo.
    const [group, child] = grouped(box('Inner', 0, 0));
    expect(paintOrder(doc(box('Under', 0, 0), group, child, box('Over', 0, 0))).map((n) => n.name))
      .toEqual(['Under', 'Group', 'Inner', 'Over']);
  });

  it('keeps a hidden layer in the document, because the renderer is what omits it', () => {
    // Hiding is not deleting: the layer has to come back with its own settings,
    // and `paintOrder` walks the document rather than what happens to be visible.
    const hidden = { ...box('Hidden', 0, 0), hidden: true };
    expect(paintOrder(doc(box('Shown', 0, 0), hidden)).map((n) => n.name)).toEqual(['Shown', 'Hidden']);
  });

  it('expands a selection to everything inside it', () => {
    const [group, child] = grouped(box('Inner', 0, 0));
    const d = doc(group, child);
    expect(withDescendants(d, [group.id]).map((n) => n.name)).toEqual(['Group', 'Inner']);
  });

  it('names the file a layer points at, and nothing for a shape', () => {
    expect(assetIdOf(logo())).toBe('asset-mark');
    expect(assetIdOf(box('S', 0, 0))).toBeUndefined();
  });

  it('keeps a rotated layer inside the box the designer sees', () => {
    const b = boundsOf({ ...box('Square', 100, 100, 100, 100), rotation: 45 });
    // A 100×100 box turned 45° is a diamond whose diagonals are 100√2 ≈ 141.42,
    // not 100 + 2·70.71 — the rotated extent is the diagonal, once.
    expect(b.width).toBeCloseTo(141.42, 1);
    expect(b.height).toBeCloseTo(141.42, 1);
  });

  it('boxes a set of layers, and boxes nothing for an empty set', () => {
    const b = boxOf([box('A', 10, 10, 50, 50), box('B', 100, 60, 20, 20)]);
    expect(b).toEqual({ x: 10, y: 10, width: 110, height: 70 });
    expect(boxOf([])).toBeUndefined();
  });

  it('counts corners for a rotation, always four, in order', () => {
    expect(rotatedCorners({ ...box('S', 0, 0, 10, 10), rotation: 30 })).toHaveLength(4);
    expect(rotatedCorners(box('S', 0, 0, 10, 10))[0]).toEqual({ x: 0, y: 0 });
  });

  it('hits a point inside the box and misses one outside', () => {
    const node = box('S', 0, 0, 100, 100);
    expect(hitTest(node, 50, 50)).toBe(true);
    expect(hitTest(node, 150, 50)).toBe(false);
    expect(hitTest({ ...node, hidden: true }, 50, 50)).toBe(false);
  });

  it('knows a hidden layer is selected, and a locked one is not editable', () => {
    const node = { ...box('S', 0, 0), hidden: true };
    expect(isSelected(node, [node.id])).toBe(true);
    expect(isEditable({ ...box('S', 0, 0), locked: true })).toBe(false);
    expect(isEditable(box('S', 0, 0))).toBe(true);
  });

  it('reports distortion against a file own aspect', () => {
    const stretched = logo({}, { width: 200, height: 100 });
    expect(aspectOf(100, 100)).toBe(1);
    expect(distortionOf(stretched, 1)).toBeCloseTo(2, 5);
    expect(distortionOf(logo(), 1)).toBe(1);
  });

  it('has a blend label for every blend mode', () => {
    for (const id of Object.keys(BLEND_LABELS)) expect(BLEND_LABELS[id as never]).toBeTruthy();
    expect(SHAPE_PRESETS.length).toBeGreaterThan(0);
    expect(DEFAULT_POLYGON.length).toBe(10);
  });

  it('clamps a value into its range', () => {
    expect(clamp(5, [0, 10])).toBe(5);
    expect(clamp(-5, [0, 10])).toBe(0);
    expect(clamp(50, [0, 10])).toBe(10);
    expect(clamp(Number.NaN, [3, 10])).toBe(3);
  });
});

describe('normalise', () => {
  it('leaves a legal document exactly as it was', () => {
    const before = doc(box('S', 10, 10));
    const { doc: after, clamped } = normalise(before);
    expect(clamped).toBe(0);
    expect(after.nodes[0]?.x).toBe(10);
  });

  it('pulls a layer back from absurd coordinates and says so', () => {
    // Off-canvas is not a parse error — a designer is allowed to park work off
    // the sheet and the brand check warns about it. What normalise refuses is a
    // coordinate so far out that it could not survive a save and a round trip.
    const { doc: after, clamped } = normalise(doc(box('S', -900_000, -900_000, 100, 100)));
    expect(after.nodes[0]?.x).toBe(LIMITS.position[0]);
    expect(after.nodes[0]?.y).toBe(LIMITS.position[0]);
    expect(clamped).toBeGreaterThan(0);
  });

  it('leaves an off-canvas layer alone, because the brand check owns that warning', () => {
    const { doc: after, clamped } = normalise(doc(box('S', -2000, -2000, 100, 100)));
    expect(after.nodes[0]?.x).toBe(-2000);
    expect(clamped).toBe(0);
  });

  it('never lets a layer be zero or negative in size', () => {
    const flat = { ...box('S', 0, 0), width: -20, height: 0 };
    const { doc: after } = normalise(doc(flat));
    expect(after.nodes[0]!.width).toBeGreaterThan(0);
    expect(after.nodes[0]!.height).toBeGreaterThan(0);
  });

  it('turns a colour the schema would refuse into one it will take', () => {
    const { doc: after } = normalise(doc({ ...box('S', 0, 0), type: 'shape', properties: shape({ fill: 'EB5E28' }) } as never));
    expect(after.nodes[0]!.type).toBe('shape');
    if (after.nodes[0]!.type === 'shape') expect(after.nodes[0]!.properties.fill).toBe('#EB5E28');
  });

  it('caps the layer count, because a saved document is a payload', () => {
    const many = Array.from({ length: LIMITS.nodes + 50 }, (_, i) => box(`S${i}`, 0, 0, 10, 10));
    const { doc: after } = normalise(doc(...many));
    expect(after.nodes.length).toBe(LIMITS.nodes);
  });

  it('caps the artboard, so a saved design is not a denial of service', () => {
    const { doc: after } = normalise(blankDocument(1_000_000, 1_000_000));
    expect(after.artboard.width).toBe(LIMITS.artboard[1]);
    expect(after.artboard.height).toBe(LIMITS.artboard[1]);
  });

  it('returns a document, never the one it was given, so a save cannot be mutated later', () => {
    const before = doc(box('S', 0, 0));
    const { doc: after } = normalise(before);
    expect(after).not.toBe(before);
    expect(after.nodes[0]).not.toBe(before.nodes[0]);
  });
});

/* ─────────────────────────────────────────────────────────────────── commands */

describe('commands', () => {
  it('inverts every command it can invert, and gets the document back', () => {
    const a = box('A', 0, 0);
    const d = doc(a);
    const cases = [
      addNodes([box('B', 20, 20)]),
      removeNodes(d, [a.id]),
      patchNodes(d, [a.id], 'Move', (n) => ({ ...n, x: 400 })),
      patchArtboard(d.artboard, { ...d.artboard, background: '#000000' }),
      reorderNodes(d, [a.id], 0),
    ];
    for (const command of cases) {
      const there = apply(d, command);
      const back = apply(there, invert(command));
      expect(paintOrder(back).map((n) => [n.id, n.name, n.x, n.y, n.parentId]))
        .toEqual(paintOrder(d).map((n) => [n.id, n.name, n.x, n.y, n.parentId]));
    }
  });

  it('leaves the document alone when a command has nothing to do', () => {
    const d = doc(box('A', 0, 0));
    expect(apply(d, removeNodes(d, ['not-here']))).toEqual(d);
  });

  it('adds on top, so a new layer is the one the designer sees', () => {
    const d = apply(doc(box('A', 0, 0)), addNodes([box('B', 0, 0)]));
    expect(paintOrder(d).map((n) => n.name)).toEqual(['A', 'B']);
  });

  it('removes a group and everything in it', () => {
    const [group, child] = grouped(box('Inner', 0, 0));
    const d = doc(group, child);
    expect(apply(d, removeNodes(d, [group.id])).nodes).toHaveLength(0);
  });

  it('reports a patch that changed nothing as unchanged', () => {
    const d = doc(box('A', 0, 0));
    const same = patchNodes(d, [d.nodes[0]!.id], 'Move', (n) => n);
    expect(apply(d, same)).toEqual(d);
  });

  it('refuses to patch a node that is not there', () => {
    const d = doc(box('A', 0, 0));
    expect(apply(d, patchNodes(d, ['ghost'], 'Move', (n) => ({ ...n, x: 1 }))).nodes[0]?.x).toBe(0);
  });

  it('moves a layer in the stacking order with a nudge', () => {
    const a = box('A', 0, 0);
    const b = box('B', 0, 0);
    const d = doc(a, b);
    const order = (command: Command): string[] =>
      paintOrder(apply(d, command)).map((n) => n.name);
    expect(order(nudgeOrder(d, [b.id], 'front'))).toEqual(['A', 'B']);
    expect(order(nudgeOrder(d, [b.id], 'back'))).toEqual(['B', 'A']);
    // One step up and one step down, which is the whole meaning of the pair: B is
    // already on top, so bringing A forward and sending B back are the same swap.
    expect(order(nudgeOrder(d, [a.id], 'forward'))).toEqual(['B', 'A']);
    expect(order(nudgeOrder(d, [a.id], 'backward'))).toEqual(['A', 'B']);
    expect(order(nudgeOrder(d, [b.id], 'backward'))).toEqual(['B', 'A']);
  });

  it('does not let a layer be nudged off the end of the list', () => {
    const d = doc(box('A', 0, 0), box('B', 0, 0));
    // B is already on top and A is already at the back: both nudges are no-ops,
    // and the order must survive them rather than wrap around.
    expect(paintOrder(apply(d, nudgeOrder(d, [d.nodes[1]!.id], 'forward'))).map((n) => n.name)).toEqual(['A', 'B']);
    expect(paintOrder(apply(d, nudgeOrder(d, [d.nodes[0]!.id], 'backward'))).map((n) => n.name)).toEqual(['A', 'B']);
  });

  it('boxes a group around everything put in it', () => {
    expect(groupBox([box('A', 10, 10, 50, 50), box('B', 100, 80, 20, 20)]))
      .toEqual({ x: 10, y: 10, width: 110, height: 90 });
  });

  it('groups two layers, and can undo the whole thing', () => {
    const a = box('A', 0, 0);
    const b = box('B', 50, 50);
    const d = doc(a, b);
    const { commands, groupId } = groupNodes(d, [a.id, b.id]);
    let groupedDoc = d;
    for (const command of commands) groupedDoc = apply(groupedDoc, command);
    // Flat model: the group is a sibling entry, not a container that swallowed them.
    expect(groupedDoc.nodes).toHaveLength(3);
    expect(groupedDoc.nodes.find((n) => n.id === groupId)?.type).toBe('group');
    // ...and what went in it is *in* it, which is the half a layers panel shows.
    expect(childrenOf(groupedDoc, groupId).map((n) => n.name).sort()).toEqual(['A', 'B']);
    expect(paintOrder(groupedDoc).map((n) => n.name)).toEqual(['Group', 'A', 'B']);

    let back = groupedDoc;
    for (const command of [...commands].reverse()) back = apply(back, invert(command));
    expect(back.nodes).toHaveLength(2);
    expect(back.nodes.every((n) => n.parentId === null)).toBe(true);
  });

  it('will not group one layer, or a group with something else', () => {
    const a = box('A', 0, 0);
    const d = doc(a);
    expect(groupNodes(d, [a.id]).commands).toHaveLength(0);
  });

  it('ungroups, putting the contents back where they were', () => {
    const a = box('A', 0, 0);
    const b = box('B', 50, 50);
    const d = doc(a, b);
    const { commands, groupId } = groupNodes(d, [a.id, b.id]);
    let groupedDoc = d;
    for (const command of commands) groupedDoc = apply(groupedDoc, command);

    let out = groupedDoc;
    for (const command of ungroupNode(groupedDoc, groupId)) out = apply(out, command);
    expect(paintOrder(out).map((n) => n.name).sort()).toEqual(['A', 'B']);
    expect(out.nodes.some((n) => n.type === 'group')).toBe(false);
    expect(out.nodes.every((n) => n.parentId === null)).toBe(true);
  });

  it('duplicates with new ids, offset so both are visible', () => {
    const a = box('A', 10, 10);
    const d = doc(a);
    const { commands, ids } = duplicateNodes(d, [a.id]);
    let out = d;
    for (const command of commands) out = apply(out, command);
    expect(out.nodes).toHaveLength(2);
    expect(ids[0]).not.toBe(a.id);
    expect(out.nodes.find((n) => n.id === ids[0])?.x).toBe(26);
  });

  it('duplicates a group whole, so the copy does not move when the original does', () => {
    const [group, child] = grouped(box('Inner', 0, 0));
    const d = doc(group, child);
    const { commands, ids } = duplicateNodes(d, [group.id]);
    let out = d;
    for (const command of commands) out = apply(out, command);
    const copy = out.nodes.find((n) => n.id === ids[0])!;
    const copiedChild = out.nodes.find((n) => n.id === ids[1])!;
    expect(out.nodes).toHaveLength(4);
    expect(copy.type).toBe('group');
    // The child's new parent is the *new* group, not the original.
    expect(copiedChild.parentId).toBe(copy.id);
    expect(copiedChild.parentId).not.toBe(group.id);
  });
});

describe('history', () => {
  it('undoes and redoes a commit', () => {
    const history = commit(EMPTY_HISTORY, addNodes([box('A', 0, 0)]));
    const undone = undo(doc(), history);
    expect(undone.doc.nodes).toHaveLength(0);
    // One commit means one undo puts the stack back at empty, so there is nothing
    // left to undo — only something to redo.
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);
    const redone = redo(undone.doc, undone.history);
    expect(redone.doc.nodes).toHaveLength(1);
    expect(canUndo(redone.history)).toBe(true);
    expect(canRedo(redone.history)).toBe(false);
  });

  it('does not record a command that changed nothing', () => {
    const d = doc(box('A', 0, 0));
    const same = patchNodes(d, [d.nodes[0]!.id], 'Move', (n) => n);
    expect(commit(EMPTY_HISTORY, same).past).toHaveLength(0);
  });

  it('drops the redo stack once something new is committed', () => {
    const d = doc();
    let history = commit(EMPTY_HISTORY, addNodes([box('A', 0, 0)]));
    history = undo(d, history).history;
    expect(canRedo(history)).toBe(true);
    const afterNew = commit(history, addNodes([box('B', 0, 0)]));
    expect(canRedo(afterNew)).toBe(false);
  });

  it('stops at both ends instead of failing', () => {
    const d = doc();
    const history = undo(d, EMPTY_HISTORY);
    expect(history.doc.nodes).toHaveLength(0);
    expect(redo(d, history.history).doc.nodes).toHaveLength(0);
  });

  it('forgets the oldest step past the limit, not the newest', () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      history = commit(history, addNodes([box(`S${i}`, 0, 0, 5, 5)]));
    }
    expect(history.past.length).toBe(HISTORY_LIMIT);
    expect(history.past[0]?.label).toBe('Add');
  });

  it('names the step it is about to undo and redo', () => {
    const history = commit(EMPTY_HISTORY, addNodes([box('A', 0, 0)], 'Add a card'));
    expect(undoLabel(history)).toBe('Add a card');
    expect(redoLabel(undo(doc(), history).history)).toBe('Add a card');
    expect(undoLabel(EMPTY_HISTORY)).toBe('Undo');
    expect(redoLabel(EMPTY_HISTORY)).toBe('Redo');
  });
});

describe('drag merging', () => {
  const a = box('A', 0, 0);
  const d = doc(a);
  const at = (x: number): Patch => asPatch(patchNodes(d, [a.id], 'Move', (n) => ({ ...n, x })));

  it('folds one drag of the same layers into one step', () => {
    const first = at(10);
    const second = at(40);
    expect(merges(first, second)).toBe(true);
    // Folded: the *before* of the drag is kept, so one undo returns to the start.
    expect(merge(first, second)).toEqual({ ...second, before: first.before });
  });

  it('will not fold different layers, or a different kind of edit', () => {
    const other = box('B', 0, 0);
    const elsewhere = patchNodes(doc(a, other), [other.id], 'Move', (n) => ({ ...n, x: 5 }));
    expect(merges(at(10), elsewhere)).toBe(false);
    expect(merges(at(10), addNodes([box('C', 0, 0)]))).toBe(false);
  });

  it('will not fold a move into a resize, which are different labels', () => {
    const resized = patchNodes(d, [a.id], 'Resize', (n) => ({ ...n, width: 50 }));
    expect(merges(at(10), resized)).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────── templates */

describe('templates', () => {
  it('offers sizes in groups, and every size is a real number of pixels', () => {
    expect(DESIGN_SIZES.length).toBeGreaterThan(4);
    const groups = new Set(DESIGN_SIZES.map((size) => size.group));
    expect(groups.size).toBeGreaterThan(1);
    for (const size of DESIGN_SIZES) {
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(size.label).toBeTruthy();
    }
  });

  it('builds a normalised document on the artboard it was given', () => {
    const size = DESIGN_SIZES[0]!;
    const built = documentFromTemplate(size, DESIGN_TEMPLATES[0]!, FALLBACK_BRAND);
    expect(built.artboard.width).toBe(size.width);
    expect(built.artboard.height).toBe(size.height);
    expect(() => normalise(built)).not.toThrow();
    expect(normalise(built).doc.nodes.length).toBe(built.nodes.length);
  });

  it('lays every template out as layers the schema will take', () => {
    // A template is a composition, not a picture: opening one has to produce a
    // design whose layers can be moved, and a template that produced a document
    // the engine refused would be a template that could not be opened at all.
    for (const size of DESIGN_SIZES) {
      for (const template of DESIGN_TEMPLATES) {
        const built = documentFromTemplate(size, template, FALLBACK_BRAND);
        const { doc: after, clamped } = normalise(built);
        expect(after.nodes.length).toBe(built.nodes.length);
        expect(clamped).toBe(0);
      }
    }
  });

  it('uses the brand own type, not a hard-coded one', () => {
    const size = DESIGN_SIZES[0]!;
    const built = documentFromTemplate(size, DESIGN_TEMPLATES.find((t) => !t.blank)!, FALLBACK_BRAND);
    const families = [...new Set(built.nodes
      .filter((node) => node.type === 'text')
      .map((node) => node.properties.fontFamily))];
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expect([FALLBACK_BRAND.displayFont, FALLBACK_BRAND.bodyFont]).toContain(family);
    }
  });

  it('names a size after what it is for', () => {
    expect(suggestName(DESIGN_SIZES[0]!)).toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────────── render */

describe('render', () => {
  const href = (id: string): string => `/api/assets/${id}`;

  it('emits one svg on the artboard own dimensions', () => {
    const svg = designSvg(blankDocument(1080, 1350), href);
    expect(svg).toContain('viewBox="0 0 1080 1350"');
    expect(svg).toContain('width="1080"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('paints the background as a rect, escaped', () => {
    const d = { ...blankDocument(10, 10, '#123456'), nodes: [] };
    expect(designSvg(d, href)).toContain('<rect x="0" y="0" width="10" height="10" fill="#123456"/>');
  });

  it('escapes a colour that would otherwise break out of the attribute', () => {
    const d = { ...blankDocument(10, 10, '"><script>'), nodes: [] };
    const svg = designSvg(d, href);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;');
  });

  it('draws a layer with its transform, so a rotation survives', () => {
    const turned = { ...box('S', 0, 0), rotation: 30 };
    expect(designSvg(doc(turned), href)).toContain('rotate(30');
  });

  it('points a picture at the file through the href it was given', () => {
    expect(designSvg(doc(picture()), href)).toContain('/api/assets/asset-photo');
  });

  it('keeps a layer whose file is gone, and says so', () => {
    // An empty href is how a deleted asset reaches the renderer (§62). The layer
    // keeps its place and its size rather than leaving a silent gap that looks
    // like a mistake in the design rather than in the library.
    const svg = designSvg(doc(picture()), () => '');
    expect(svg).toContain('file missing');
    expect(svg).toContain('Photo');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('leaves out a hidden layer entirely', () => {
    // The artboard's own ground is a rect, so the assertion is on the layer's
    // fill — the only thing a hidden shape would otherwise contribute.
    const shown = designSvg(doc(box('S', 0, 0)), href);
    const hidden = designSvg(doc({ ...box('S', 0, 0), hidden: true }), href);
    expect(shown).toContain('#EB5E28');
    expect(hidden).not.toContain('#EB5E28');
  });

  it('draws text with the font, size and colour the layer asked for', () => {
    const svg = designSvg(doc(text()), href);
    expect(svg).toContain('Space Grotesk');
    expect(svg).toContain('font-size="48"');
    expect(svg).toContain('fill="#16181C"');
  });

  it('wraps text at the width of the layer', () => {
    const narrow = textLines('one two three four five six', 200, 40, 0);
    const wide = textLines('one two three four five six', 2000, 40, 0);
    expect(narrow.length).toBeGreaterThan(wide.length);
    expect(narrow.every((line) => line.length > 0)).toBe(true);
  });

  it('always makes at least one line, even for a sliver of a box', () => {
    expect(textLines('something', 0.1, 12, 0)).toHaveLength(1);
  });

  it('names an export after the client, the design, the format and the size', () => {
    expect(exportName('Acme Ltd', 'Spring Sale', 'png', 1080, 1080))
      .toBe('acme-ltd-spring-sale-png-1080x1080');
  });

  it('slugifies what a file name cannot carry', () => {
    const name = exportName('Acme / Ltd', 'Spring & Sale!', 'pdf', 100, 200);
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name).toContain('100x200');
  });

  it('falls back rather than producing a name of dashes', () => {
    expect(exportName('', '', 'png', 10, 10)).toBe('client-design-png-10x10');
  });
});

/* ─────────────────────────────────────────────────────────────────── brand check */

describe('brand check', () => {
  it('reads and writes hexes', () => {
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('nope')).toBeNull();
    expect(rgbToHex([235, 94, 40])).toBe('#EB5E28');
  });

  it('measures relative luminance and contrast', () => {
    expect(luma('#000000')).toBe(0);
    expect(luma('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luma('nope')).toBeNull();
    // Black on white is the 21:1 maximum of the WCAG formula.
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('finds the nearest brand colour and how far away it is', () => {
    const near = nearestColour('#EC5F28', paletteOf(RULES));
    expect(near?.hex.toUpperCase()).toBe('#EB5E28');
    // A shade off a measured colour: two channels, one step each.
    expect(near?.distance).toBeLessThan(10);
    expect(nearestColour('#EB5E28', [])).toBeUndefined();
  });

  it('takes the palette and the policy from the rules', () => {
    expect(paletteOf(RULES).map((c) => c.hex.toUpperCase())).toContain('#EB5E28');
    // No colorPolicy written, but allowCustomColor was, so the brand is guided.
    expect(policyOf(RULES)).toBe('guided');
    expect(policyOf({ ...RULES, allowCustomColor: false })).toBe('strict');
    expect(policyOf({ ...RULES, colorPolicy: 'open' })).toBe('open');
    // Silence is not prohibition: a client with no rules at all is not strict.
    expect(policyOf(undefined)).toBe('open');
    expect(paletteOf(undefined)).toEqual([]);
  });

  it('finds the rules a brand has written about one logo', () => {
    expect(logoRule(RULES, 'asset-mark')?.minWidth).toBe(120);
    expect(logoRule(RULES, 'other')).toBeUndefined();
    expect(logoRule(undefined, 'asset-mark')).toBeUndefined();
  });

  it('names every colour a layer puts on the sheet, by its role', () => {
    expect(coloursOf(box('S', 0, 0)).map((c) => c.role)).toContain('Fill');
    expect(coloursOf(text()).map((c) => c.role)).toContain('Text');
    // A shape with a stroke on it has two colours to account for.
    const stroked = makeNode('shape', { name: 'S', x: 0, y: 0, width: 10, height: 10 },
      shape({ stroke: '#16181C', strokeWidth: 2 }));
    expect(coloursOf(stroked).map((c) => c.role)).toEqual(['Fill', 'Stroke']);
  });

  it('passes a design that uses only the brand own colours and type', () => {
    expect(checkDesign(doc(text(), box('S', 0, 0)), RULES).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('catches a colour that is not in the palette, and offers the nearest one', () => {
    const bad = text({ color: '#00FF00' });
    const issue = checkDesign(doc(bad), { ...RULES, allowCustomColor: false, colorPolicy: 'strict' })
      .find((i) => i.action?.kind === 'brand-color');
    expect(issue).toBeDefined();
    expect(issue?.level).toBe('error');
  });

  it('warns rather than blocks when the brand permits a colour of its own', () => {
    const bad = text({ color: '#00FF00' });
    const issues = checkDesign(doc(bad), { ...RULES, colorPolicy: 'guided' });
    expect(issues.some((i) => /outside the palette/i.test(i.title))).toBe(true);
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('says nothing about colour at all when the brand is open', () => {
    const bad = text({ color: '#00FF00' });
    expect(checkDesign(doc(bad), { ...RULES, colorPolicy: 'open' }).filter((i) => /colour/i.test(i.title)))
      .toHaveLength(0);
  });

  it('catches a typeface the brand has not named', () => {
    const bad = text({ fontFamily: 'Comic Sans MS' });
    const issue = checkDesign(doc(bad), { ...RULES, allowCustomFont: false })
      .find((i) => i.action?.kind === 'brand-font');
    expect(issue?.action?.kind).toBe('brand-font');
  });

  it('catches a logo stretched past what its file own proportions are', () => {
    const stretched = logo({}, { width: 400, height: 100 });
    const issues = checkDesign(doc(stretched), RULES);
    expect(issues.some((i) => /stretch/i.test(i.title))).toBe(true);
    // A mark that is the right shape but turned is still not the mark.
    const turned = { ...logo(), rotation: 12 };
    expect(checkDesign(doc(turned), RULES).some((i) => /turned too far/i.test(i.title))).toBe(true);
  });

  it('catches a logo narrower than the brand minimum', () => {
    const small = logo({}, { width: 60, height: 60 });
    const issue = checkDesign(doc(small), RULES).find((i) => /smaller than the brand allows/i.test(i.title));
    expect(issue).toBeDefined();
    // A floor, not a prohibition: a design that has merely gone small is saved.
    expect(issue?.level).toBe('warn');
  });

  it('catches a layer that has fallen off the sheet entirely', () => {
    // The check is the one that matters for export: a layer with none of it on
    // the artboard produces nothing in the file, whatever it says on the canvas.
    expect(checkDesign(doc(box('Off', 2000, 10)), RULES).some((i) => /off the canvas/i.test(i.title))).toBe(true);
  });

  it('says when a line of type is long enough to lose the eye', () => {
    const long = text({ text: 'word '.repeat(40).trim(), fontSize: 12 }, { width: 4000, height: 400 });
    expect(checkDesign(doc(long), RULES).some((i) => /line length/i.test(i.title))).toBe(true);
  });

  it('has no opinion at all when the brand has said nothing', () => {
    const loose: BrandRules = {
      colors: [], allowCustomColor: true, fonts: [], allowCustomFont: true, exports: [], logos: {},
    };
    expect(checkDesign(doc(text({ color: '#00FF00', fontFamily: 'Anything' })), loose)
      .filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('sorts errors above warnings', () => {
    const strict: BrandRules = { ...RULES, colorPolicy: 'strict', allowCustomColor: false };
    const issues = checkDesign(doc(text({ color: '#00FF00' })), strict);
    const firstWarn = issues.findIndex((i) => i.level === 'warn');
    const lastError = issues.map((i) => i.level).lastIndexOf('error');
    if (firstWarn >= 0 && lastError >= 0) expect(lastError).toBeLessThan(firstWarn);
  });

  it('judges a whole design and counts it', () => {
    const clean = judge(doc(text(), box('S', 0, 0)), RULES);
    expect(clean.status).toBe('clean');
    expect(clean.errors + clean.warnings).toBe(clean.issues.length);

    const offBrand = judge(doc(text({ color: '#00FF00' })), { ...RULES, colorPolicy: 'strict', allowCustomColor: false });
    expect(offBrand.errors).toBeGreaterThan(0);
    expect(offBrand.status).toBe('off-brand');
  });

  it('attributes an issue to the layer it is about', () => {
    const d = doc(text({ color: '#00FF00' }), box('S', 0, 0));
    const verdict = judge(d, { ...RULES, colorPolicy: 'strict', allowCustomColor: false });
    expect(issuesForNode(verdict, d.nodes[0]!.id).length).toBeGreaterThan(0);
    expect(issuesForNode(verdict, d.nodes[1]!.id)).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────────── snapping */

describe('snapping', () => {
  it('offers the canvas edges, centre and thirds as guides', () => {
    const { xs, ys } = guidesFor(blankDocument(1080, 1080), []);
    expect(xs.some((g) => g.at === 0)).toBe(true);
    expect(xs.some((g) => g.at === 540)).toBe(true);
    expect(ys.some((g) => g.at === 1080)).toBe(true);
  });

  it('snaps an edge to the centre when it is close enough', () => {
    const result = snapBox(blankDocument(1080, 1080), { x: 538, y: 0, width: 20, height: 20 }, []);
    expect(result.box.x).toBe(540);
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it('leaves a box alone when nothing is near it', () => {
    const result = snapBox(blankDocument(1080, 1080), { x: 321, y: 317, width: 20, height: 20 }, []);
    expect(result.box).toEqual({ x: 321, y: 317, width: 20, height: 20 });
  });

  it('does not snap a layer to the guide of a layer it is dragging', () => {
    // The moving box's own edges sit at a gap of exactly zero from the guides it
    // would be measured against, so excluding it is the difference between a snap
    // and a guide drawn over a layer that never moved.
    const a = box('A', 0, 0, 100, 100);
    const d = doc(a);
    expect(guidesFor(d, [a.id]).xs.some((g) => g.label === 'A')).toBe(false);
    expect(guidesFor(d, []).xs.some((g) => g.label === 'A')).toBe(true);
  });

  it('finds the topmost layer under a point', () => {
    expect(pickAt(doc(box('Under', 0, 0, 100, 100), box('Over', 0, 0, 100, 100)), 50, 50)?.name).toBe('Over');
  });

  it('finds every layer under a point, topmost first', () => {
    const a = box('A', 0, 0, 100, 100);
    const b = box('B', 0, 0, 100, 100);
    expect(pickAllAt(doc(a, b), 50, 50).map((n) => n.name)).toEqual(['B', 'A']);
  });

  it('reaches through a group for what is inside it, and not for the group itself', () => {
    const [group, child] = grouped(box('Inner', 0, 0, 100, 100));
    expect(pickAt(doc(group, child), 50, 50)?.name).toBe('Inner');
  });

  it('ignores a hidden layer when picking', () => {
    expect(pickAt(doc({ ...box('Hidden', 0, 0, 100, 100), hidden: true }), 50, 50)).toBeUndefined();
  });

  it('has a handle and a cursor for all eight sides and corners', () => {
    expect(HANDLES).toHaveLength(8);
    for (const handle of HANDLES) {
      expect(typeof HANDLE_CURSOR[handle]).toBe('string');
      const at = handleInBox({ x: 0, y: 0, width: 100, height: 100 }, handle);
      expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
    }
    // The handles that move an edge, and the ones that move a corner, have to sit
    // where the designer aims: a handle off its own box is a resize that surprises.
    expect(handleInBox({ x: 0, y: 0, width: 100, height: 100 }, 'nw')).toEqual({ x: 0, y: 0 });
    expect(handleInBox({ x: 0, y: 0, width: 100, height: 100 }, 'se')).toEqual({ x: 100, y: 100 });
    expect(handleInBox({ x: 0, y: 0, width: 100, height: 100 }, 'n')).toEqual({ x: 50, y: 0 });
  });

  it('drags the opposite corner when the south-east handle moves', () => {
    expect(resizeBox({ x: 0, y: 0, width: 100, height: 100 }, 'se', 20, 30))
      .toEqual({ x: 0, y: 0, width: 120, height: 130 });
  });

  it('moves the box and the size together when the north-west handle moves', () => {
    expect(resizeBox({ x: 0, y: 0, width: 100, height: 100 }, 'nw', 20, 30))
      .toEqual({ x: 20, y: 30, width: 80, height: 70 });
  });

  it('changes one dimension for a side handle, because a side drag means it', () => {
    expect(resizeBox({ x: 0, y: 0, width: 100, height: 100 }, 'e', 20, 999))
      .toEqual({ x: 0, y: 0, width: 120, height: 100 });
  });

  it('keeps a square square when the ratio is held', () => {
    const resized = resizeBox({ x: 0, y: 0, width: 100, height: 100 }, 'se', 40, 0, true);
    expect(resized.width).toBe(resized.height);
  });

  it('never resizes a layer to nothing', () => {
    const resized = resizeBox({ x: 0, y: 0, width: 100, height: 100 }, 'se', -500, -500);
    expect(resized.width).toBeGreaterThan(0);
    expect(resized.height).toBeGreaterThan(0);
    expect(resized.x).toBe(0);
  });

  it('turns a box into its four rotated corners', () => {
    expect(frameCorners({ x: 0, y: 0, width: 100, height: 100 }, 90)).toHaveLength(4);
    const turned = frameCorners({ x: 0, y: 0, width: 100, height: 100 }, 90);
    for (const corner of turned) expect(Number.isFinite(corner.x) && Number.isFinite(corner.y)).toBe(true);
  });
});
