import type { Artboard, CanvasDocument, CanvasNode } from '../api.js';
import { boundsOf, childrenOf, newNodeId, withDescendants } from './document.js';

/**
 * Every edit the canvas makes, as a value that knows how to undo itself.
 *
 * **A command, not a snapshot.** A drag from x=100 to x=500 has to be one thing
 * to undo (§45), and a document copy taken per pointer-move would be both the
 * wrong unit and, for a hundred-layer design, the wrong cost. So an edit is a
 * small record naming what changed, and `invert` is the same record read
 * backwards — no history of whole documents anywhere, and undo is exact rather
 * than approximate.
 *
 * Five kinds, and the list is short on purpose: every one of them maps to
 * something a person did. `PATCH` is the workhorse, and it carries the nodes it
 * touched *before and after* rather than a diff, because a diff would need a
 * differ and a differ is a fourth thing to get wrong.
 */

export type Command =
  /** Something was added. Undo removes exactly these nodes. */
  | { kind: 'add'; label: string; nodes: CanvasNode[] }
  /** Something was removed. Undo puts these nodes back where they were. */
  | { kind: 'remove'; label: string; nodes: CanvasNode[] }
  /** Nodes changed. `before` and `after` are the same nodes, in the same order. */
  | { kind: 'patch'; label: string; before: CanvasNode[]; after: CanvasNode[] }
  /** The artboard changed size or ground. */
  | { kind: 'artboard'; label: string; before: Artboard; after: Artboard }
  /** Nodes changed stacking order. `after` is the whole sibling order. */
  | { kind: 'reorder'; label: string; parentId: string | null; before: string[]; after: string[] };

/**
 * The edit that undoes a command.
 *
 * Every kind has a partner, and `patch` is the only one that needs its parts
 * swapped rather than reversed — which is the entire reason a patch carries both
 * halves.
 */
export function invert(command: Command): Command {
  switch (command.kind) {
    case 'add':
      return { kind: 'remove', label: command.label, nodes: command.nodes };
    case 'remove':
      return { kind: 'add', label: command.label, nodes: command.nodes };
    case 'patch':
      return { kind: 'patch', label: command.label, before: command.after, after: command.before };
    case 'artboard':
      return { kind: 'artboard', label: command.label, before: command.after, after: command.before };
    case 'reorder':
      return { kind: 'reorder', label: command.label, parentId: command.parentId, before: command.after, after: command.before };
  }
}

/**
 * Run a command against a document.
 *
 * The one place a document changes. Everything else in the editor builds a
 * command and hands it here, so there is exactly one implementation of "what
 * does adding a node actually do" and undo cannot drift from it.
 */
export function apply(doc: CanvasDocument, command: Command): CanvasDocument {
  switch (command.kind) {
    case 'add':
      return { ...doc, nodes: [...doc.nodes, ...command.nodes] };

    case 'remove': {
      const gone = new Set(command.nodes.map((node) => node.id));
      return { ...doc, nodes: doc.nodes.filter((node) => !gone.has(node.id)) };
    }

    case 'patch': {
      const byId = new Map(command.after.map((node) => [node.id, node]));
      return {
        ...doc,
        nodes: doc.nodes.map((node) => byId.get(node.id) ?? node),
      };
    }

    case 'artboard':
      return { ...doc, artboard: command.after };

    case 'reorder':
      return applyReorder(doc, command.parentId, command.after);
  }
}

/**
 * Put a parent's children into a given order.
 *
 * `order` lists ids, and any id not in it keeps its place at the end — which
 * matters because a reorder that silently dropped a node would lose it, and
 * losing a layer is the one failure the layers panel makes obvious and the
 * document does not.
 */
function applyReorder(doc: CanvasDocument, parentId: string | null, order: readonly string[]): CanvasDocument {
  const wanted = new Map(order.map((id, index) => [id, index]));
  const siblings = doc.nodes.filter((node) => node.parentId === parentId);
  const rank = (node: CanvasNode): number => wanted.get(node.id) ?? Number.MAX_SAFE_INTEGER;
  const moving = siblings.filter((node) => wanted.has(node.id));
  const staying = siblings.filter((node) => !wanted.has(node.id));
  const sorted = [...moving, ...staying].sort((a, b) => rank(a) - rank(b));
  const queue = [...sorted];
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (node.parentId === parentId ? queue.shift() ?? node : node)),
  };
}

/* ------------------------------------------------------------------ builders */

/**
 * Whether a new edit should be folded into the previous one.
 *
 * **A drag is one history entry.** Every `patch` from the same nodes with the
 * same label replaces the previous entry instead of stacking behind it, so a
 * designer who drags a headline across the page and releases has one thing to
 * undo — the drag — rather than four hundred pointer moves. Anything that is not
 * the same nodes is not the same gesture, and stacks as usual: nudging twice
 * with the arrow keys is two nudges, because those are two decisions.
 */
export function merges(previous: Command, next: Command): boolean {
  if (previous.kind !== 'patch' || next.kind !== 'patch') return false;
  if (previous.label !== next.label) return false;
  if (previous.after.length !== next.before.length) return false;
  return previous.after.every((node, index) => node.id === next.before[index]?.id);
}

/** Fold a continued drag into the entry that started it. */
export function merge(previous: Command, next: Command): Command {
  if (previous.kind !== 'patch' || next.kind !== 'patch') return next;
  return { ...next, before: previous.before };
}

/* ----------------------------------------------------------- command makers */

/** Add nodes on top of everything. */
export function addNodes(nodes: CanvasNode[], label = 'Add'): Command {
  return { kind: 'add', label, nodes };
}

/**
 * Remove nodes, remembering everything inside them.
 *
 * The subtrees are collected before anything is removed, so undoing puts a
 * group back with its contents rather than as an empty box. Ids that are not in
 * the document produce nothing, which is what a double-click on an already
 * deleted layer does.
 */
export function removeNodes(doc: CanvasDocument, ids: readonly string[], label = 'Delete'): Command {
  const present = ids.filter((id) => doc.nodes.some((node) => node.id === id));
  const nodes = withDescendants(doc, present);
  if (nodes.length === 0) return { kind: 'patch', label, before: [], after: [] };
  return { kind: 'remove', label, nodes };
}

/**
 * Change some nodes, from what they are now to what they should become.
 *
 * Built from a mutator rather than from two arrays so a caller cannot forget to
 * keep the ids, the count and the order in step — the three ways a patch goes
 * wrong and the reason this takes a function.
 */
export function patchNodes(
  doc: CanvasDocument,
  ids: readonly string[],
  label: string,
  change: (node: CanvasNode) => CanvasNode,
): Command {
  const before = doc.nodes.filter((node) => ids.includes(node.id));
  if (before.length === 0) return { kind: 'patch', label, before: [], after: [] };
  const after = before.map((node) => change(node));
  const unchanged = after.every((node, index) => node === before[index]);
  if (unchanged) return { kind: 'patch', label, before, after: before };
  return { kind: 'patch', label, before, after };
}

/** Change the sheet itself. */
export function patchArtboard(before: Artboard, after: Artboard, label = 'Canvas'): Command {
  return { kind: 'artboard', label, before, after };
}

/**
 * Move nodes within their parent's order.
 *
 * `toIndex` counts siblings, not array positions, so a reorder means the same
 * thing in the layers panel whether or not the design has groups in it.
 */
export function reorderNodes(
  doc: CanvasDocument,
  ids: readonly string[],
  toIndex: number,
  label = 'Reorder',
): Command {
  const first = doc.nodes.find((node) => ids.includes(node.id));
  if (!first) return { kind: 'reorder', label, parentId: null, before: [], after: [] };
  const parentId = first.parentId;
  const siblings = childrenOf(doc, parentId);
  const moving = siblings.filter((node) => ids.includes(node.id));
  const staying = siblings.filter((node) => !ids.includes(node.id));
  const index = Math.max(0, Math.min(staying.length, toIndex));
  const next = [...staying.slice(0, index), ...moving, ...staying.slice(index)];
  const before = siblings.map((node) => node.id);
  const after = next.map((node) => node.id);
  const same = before.every((id, i) => id === after[i]);
  if (same) return { kind: 'reorder', label, parentId, before, after: before };
  return { kind: 'reorder', label, parentId, before, after };
}

/** Bring a selection forward or send it back by one place. */
export function nudgeOrder(
  doc: CanvasDocument,
  ids: readonly string[],
  direction: 'front' | 'back' | 'forward' | 'backward',
): Command {
  const first = doc.nodes.find((node) => ids.includes(node.id));
  if (!first) return { kind: 'reorder', label: 'Reorder', parentId: null, before: [], after: [] };
  const siblings = childrenOf(doc, first.parentId);
  const count = siblings.length;
  const positions = siblings
    .map((node, index) => (ids.includes(node.id) ? index : -1))
    .filter((index) => index >= 0);
  if (positions.length === 0) return reorderNodes(doc, ids, count, 'Reorder');

  const order = siblings.map((node) => node.id);
  const step = (from: number, to: number): void => {
    const [taken] = order.splice(from, 1);
    if (taken !== undefined) order.splice(to, 0, taken);
  };
  if (direction === 'front') {
    for (let i = positions.length - 1; i >= 0; i -= 1) step(positions[i] ?? 0, count - 1);
  } else if (direction === 'back') {
    for (const at of [...positions].reverse()) step(at, 0);
  } else if (direction === 'forward') {
    for (let i = positions.length - 1; i >= 0; i -= 1) {
      const from = positions[i] ?? 0;
      if (from < count - 1) step(from, from + 1);
    }
  } else {
    for (const at of positions) {
      if (at > 0) step(at, at - 1);
    }
  }
  const label = direction === 'front' ? 'Bring to front' : direction === 'back'
    ? 'Send to back' : direction === 'forward' ? 'Bring forward' : 'Send backward';
  return { kind: 'reorder', label, parentId: first.parentId, before: siblings.map((n) => n.id), after: order };
}

/* -------------------------------------------------------- grouping, copying */

/** The box a new group should occupy: the box of what went into it. */
export function groupBox(nodes: readonly CanvasNode[]): { x: number; y: number; width: number; height: number } {
  const boxes = nodes.map(boundsOf);
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Put some nodes into a new group.
 *
 * Two commands in one, because grouping is not one edit: a group appears and its
 * contents move into it. Returning them together is what lets the caller put a
 * single undo entry on the stack for what a person experiences as one action,
 * and what stops a half-grouped selection existing if the second command fails.
 */
export function groupNodes(doc: CanvasDocument, ids: readonly string[]): { commands: Command[]; groupId: string } {
  const chosen = doc.nodes.filter((node) => ids.includes(node.id) && node.type !== 'group');
  if (chosen.length < 2) return { commands: [], groupId: '' };

  const parentId = chosen[0]?.parentId ?? null;
  // A group may only hold what shares a parent. Mixing levels would make the
  // layer tree describe something the tree cannot show, so the deeper nodes come
  // to the shallower level first.
  const depth = (id: string | null): number => {
    let level = 0;
    let current = id;
    while (current !== null) {
      const node = doc.nodes.find((n) => n.id === current);
      if (!node) break;
      level += 1;
      current = node.parentId;
    }
    return level;
  };
  const shallowest = Math.min(...chosen.map((node) => depth(node.parentId)));
  const lift = chosen
    .filter((node) => depth(node.parentId) > shallowest)
    .map((node) => node.id);
  const rest = chosen.filter((node) => !lift.includes(node.id));

  const box = groupBox(rest.length > 0 ? rest : chosen);
  const groupId = newNodeId();
  const group: CanvasNode = {
    id: groupId,
    type: 'group',
    parentId,
    name: 'Group',
    x: box.x, y: box.y, width: box.width, height: box.height,
    rotation: 0,
    locked: false,
    hidden: false,
    effects: {
      opacity: 1, blur: 0, blend: 'normal',
      shadow: { enabled: false, x: 0, y: 12, blur: 24, color: '#000000', opacity: 0.25 },
    },
    properties: {},
  };

  const siblings = childrenOf(doc, parentId).map((node) => node.id);
  const index = Math.min(...rest.map((node) => siblings.indexOf(node.id)).filter((i) => i >= 0));
  const commands: Command[] = [
    { kind: 'add', label: 'Group', nodes: [group] },
    reorderNodes(doc, [groupId, ...rest.map((node) => node.id)], Number.isFinite(index) ? index : siblings.length, 'Group'),
    ...(lift.length > 0 ? [patchNodes(doc, lift, 'Group', (node) => ({ ...node, parentId }))] : []),
    // The move into the group, last. Everything before it is about placing the
    // group among the siblings it was made from; this is the one command that
    // makes it a group rather than an empty box sitting beside what went into it,
    // and a layers panel that showed an empty box over selected layers would be
    // describing something the document does not contain.
    patchNodes(doc, chosen.map((node) => node.id), 'Group', (node) => ({ ...node, parentId: groupId })),
  ];
  return { commands, groupId };
}

/** Take everything out of a group and delete the group. */
export function ungroupNode(doc: CanvasDocument, groupId: string): Command[] {
  const group = doc.nodes.find((node) => node.id === groupId && node.type === 'group');
  if (!group) return [];
  const inside = childrenOf(doc, groupId).map((node) => node.id);
  return [
    patchNodes(doc, inside, 'Ungroup', (node) => ({ ...node, parentId: group.parentId })),
    { kind: 'remove', label: 'Ungroup', nodes: [group] },
  ];
}

/**
 * Copy nodes, whole subtrees included, offset so the copies are visible.
 *
 * **New ids throughout, descendants too.** Copying a group and leaving its
 * children pointing at the original would produce a second group whose contents
 * move when the first one does — and the two would look identical until then,
 * which is the worst kind of bug to hand a client.
 */
export function duplicateNodes(doc: CanvasDocument, ids: readonly string[], offset = 16): { commands: Command[]; ids: string[] } {
  const copies = withDescendants(doc, ids);
  if (copies.length === 0) return { commands: [], ids: [] };
  const remap = new Map<string, string>();
  for (const node of copies) remap.set(node.id, newNodeId());

  const made = copies.map((node) => ({
    ...node,
    id: remap.get(node.id) ?? node.id,
    parentId: node.parentId !== null && remap.has(node.parentId) ? remap.get(node.parentId) ?? null : node.parentId,
    x: node.x + offset,
    y: node.y + offset,
  }));
  return { commands: [addNodes(made, 'Duplicate')], ids: made.map((node) => node.id) };
}
