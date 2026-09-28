import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Asset, BrandRules, CanvasDocument, CanvasNode } from '../api.js';
import { api } from '../api.js';
import {
  addNodes, apply, duplicateNodes, groupNodes, nudgeOrder, patchArtboard, patchNodes, removeNodes,
  ungroupNode, type Command,
} from './commands.js';
import {
  boxOf, makeNode, newNodeId, normalise, roots, withDescendants,
} from './document.js';
import {
  canRedo, canUndo, commit, EMPTY_HISTORY, redo, redoLabel, undo, undoLabel, type History,
} from './history.js';
import { judge, type Verdict } from './brandCheck.js';
import { resizeBox, snapBox, type Guide, type Handle } from './snapping.js';
import { FALLBACK_BRAND } from './templates.js';

/**
 * The editor's state, as one reducer.
 *
 * **One state object, one reducer, one place the design changes.** Not a store,
 * not a context, and not two `useState` calls that have to be kept in step:
 * a document and the undo stack that describes it are one fact, and splitting
 * them across two hooks means every edit has to remember to update both — which
 * is exactly the bug that makes ⌘Z undo the wrong thing.
 *
 * **The reducer is pure.** It takes a state and an action and returns the next
 * one, with no I/O, no clock and no DOM — so every behaviour here is a function
 * that can be tested by calling it twice. The side effects (autosave, export,
 * measuring a file) live in the hook, outside the reducer, and are the only
 * things that touch anything.
 */

export interface EditorState {
  doc: CanvasDocument;
  history: History;
  selection: string[];
  status: string;
  zoom: number;
  snapping: boolean;
  guides: Guide[];
}

export type EditorAction =
  | { type: 'run'; commands: Command[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; doc: CanvasDocument; note?: string }
  | { type: 'select'; ids: string[] }
  | { type: 'toggle'; id: string }
  | { type: 'drag'; from: { x: number; y: number }; to: { x: number; y: number }; ratio: boolean; handle?: Handle }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'rotate'; degrees: number }
  | { type: 'artboard'; patch: Partial<CanvasDocument['artboard']> }
  | { type: 'zoom'; zoom: number }
  | { type: 'snapping'; on: boolean }
  | { type: 'guides'; guides: Guide[] }
  | { type: 'status'; status: string };

/** A drag on the stage, already measured into canvas units by the stage itself. */
export interface DragInput {
  from: { x: number; y: number };
  to: { x: number; y: number };
  ratio: boolean;
  handle?: Handle;
}

/** The layers a selection is allowed to move: its own contents, minus the locked. */
export function draggable(state: EditorState): CanvasNode[] {
  return withDescendants(state.doc, state.selection).filter((node) => !node.locked);
}

/**
 * The reducer.
 *
 * **Every branch ends in a whole new state**, never a mutation of the old one.
 * A drag re-issues the same action on every pointer move and the *history* is
 * what folds those into one entry (`merges`, in `history.ts`) — the document
 * changes on every move, the stack does not grow.
 */
export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'run': {
      if (action.commands.length === 0) return state;
      const doc = action.commands.reduce(apply, state.doc);
      if (doc === state.doc) return state;
      const last = action.commands[action.commands.length - 1]!;
      return {
        ...state,
        doc,
        // The array is one entry: several commands, one gesture, one ⌘Z.
        history: commit(state.history, action.commands.length === 1
          ? action.commands[0]!
          : { kind: 'patch', label: last.label, before: state.doc.nodes, after: doc.nodes }),
        status: last.label,
        guides: [],
      };
    }

    case 'undo': {
      const moved = undo(state.doc, state.history);
      if (moved.doc === state.doc) return state;
      return { ...state, doc: moved.doc, history: moved.history, status: 'Undo', guides: [] };
    }

    case 'redo': {
      const moved = redo(state.doc, state.history);
      if (moved.doc === state.doc) return state;
      return { ...state, doc: moved.doc, history: moved.history, status: 'Redo', guides: [] };
    }

    case 'load':
      return {
        ...state, doc: action.doc, history: EMPTY_HISTORY, selection: [],
        status: action.note ?? 'Opened', guides: [],
      };

    case 'select':
      return { ...state, selection: action.ids };

    case 'toggle':
      return {
        ...state,
        selection: state.selection.includes(action.id)
          ? state.selection.filter((id) => id !== action.id)
          : [...state.selection, action.id],
      };

    case 'drag': {
      const moving = draggable(state);
      if (moving.length === 0) return state;
      const ids = moving.map((node) => node.id);
      const before = boxOf(moving);
      if (!before) return state;
      const dx = action.to.x - action.from.x;
      const dy = action.to.y - action.from.y;

      if (action.handle) {
        // A side drag changes one dimension and a corner drag keeps the
        // proportions, because that is what a designer means by each of them.
        const next = resizeBox(before, action.handle, dx, dy, action.ratio);
        return reduce(state, {
          type: 'run',
          commands: [patchNodes(state.doc, ids, 'Resize', (node) => ({
            ...node,
            x: next.x + (node.x - before.x) * (before.width > 0 ? next.width / before.width : 1),
            y: next.y + (node.y - before.y) * (before.height > 0 ? next.height / before.height : 1),
            width: Math.max(1, node.width * (before.width > 0 ? next.width / before.width : 1)),
            height: Math.max(1, node.height * (before.height > 0 ? next.height / before.height : 1)),
          }))],
        });
      }

      if (!state.snapping) {
        return reduce(state, {
          type: 'run',
          commands: [patchNodes(state.doc, ids, 'Move', (node) => ({ ...node, x: node.x + dx, y: node.y + dy }))],
        });
      }
      const snapped = snapBox(state.doc, { ...before, x: before.x + dx, y: before.y + dy }, ids);
      return {
        ...reduce(state, {
          type: 'run',
          commands: [patchNodes(state.doc, ids, 'Move', (node) => ({
            ...node, x: node.x + (snapped.box.x - before.x), y: node.y + (snapped.box.y - before.y),
          }))],
        }),
        guides: snapped.guides,
      };
    }

    case 'nudge': {
      const ids = draggable(state).map((node) => node.id);
      return reduce(state, { type: 'run', commands: [patchNodes(state.doc, ids, 'Nudge', (node) => ({
        ...node, x: node.x + action.dx, y: node.y + action.dy,
      }))] });
    }

    case 'rotate':
      return reduce(state, { type: 'run', commands: [patchNodes(
        state.doc, draggable(state).map((n) => n.id), 'Rotate', (node) => ({ ...node, rotation: node.rotation + action.degrees }),
      )] });

    case 'artboard':
      return reduce(state, {
        type: 'run',
        commands: [patchArtboard(state.doc.artboard, { ...state.doc.artboard, ...action.patch }, 'Canvas')],
      });

    case 'zoom': return { ...state, zoom: action.zoom };
    case 'snapping': return { ...state, snapping: action.on };
    case 'guides': return { ...state, guides: action.guides };
    case 'status': return { ...state, status: action.status };
  }
}

/** The state a new editor opens in. */
export function initialState(doc: CanvasDocument): EditorState {
  return { doc, history: EMPTY_HISTORY, selection: [], status: 'Ready', zoom: 1, snapping: true, guides: [] };
}

/* ------------------------------------------------------------------- assets */

/** The file a node names, as a path the browser can fetch. */
export function assetHref(assetId: string, kind: Asset['kind']): string {
  // A logo goes through the inline route so an SVG mark renders rather than
  // downloading; everything else is a plain file. The engine refuses an asset id
  // the client does not own long before either of these is reached.
  return kind === 'logo' ? api.logoPath(assetId) : api.downloadPath(assetId);
}

/**
 * The href function the renderer is given.
 *
 * Built from the approved list, so a layer pointing at a file that has since been
 * unapproved resolves to nothing and the renderer draws its "file missing" box —
 * visible, and honest about what happened.
 */
export function hrefFor(assets: readonly Asset[]): (assetId: string) => string {
  const kinds = new Map(assets.map((a) => [a.id, a.kind]));
  return (assetId: string) => (kinds.has(assetId) ? assetHref(assetId, kinds.get(assetId)!) : '');
}

/**
 * A file's own size, read from the browser.
 *
 * **`Asset` carries no dimensions, and that is not an oversight** — the engine
 * stores the file and its metadata rather than a decode of it. So the size is
 * measured once, when the client places the file, and recorded on the node.
 * That number is what makes distortion and aspect ratio *measurable* rather than
 * a matter of opinion, and reading it later would mean a request per layer per
 * open for a number the node already holds.
 */
export async function measure(asset: Asset): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = assetHref(asset.id, asset.kind);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`“${asset.filename}” could not be read.`));
  });
  return { width: image.naturalWidth || 1, height: image.naturalHeight || 1 };
}

/* ------------------------------------------------------------------ the hook */

export interface Editor {
  state: EditorState;
  doc: CanvasDocument;
  status: string;
  selection: string[];
  selected: CanvasNode[];
  selectedOne: CanvasNode | undefined;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  dirty: boolean;
  verdict: Verdict;
  run: (command: Command | Command[]) => void;
  dispatch: (action: EditorAction) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  toggle: (id: string) => void;
  place: (kind: CanvasNode['type'], asset: Asset) => Promise<void>;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  order: (direction: 'front' | 'back' | 'forward' | 'backward') => void;
  setArtboard: (patch: Partial<CanvasDocument['artboard']>) => void;
  /** The document has been written out; nothing is owed until the next edit. */
  markClean: () => void;
  /** The document as the engine will accept it, for a save or an export. */
  saveable: () => CanvasDocument;
}

/**
 * The editor hook.
 *
 * @param initial  the document to open; changing it does *not* reload, because
 *                 replacing a design under a designer mid-edit is not a thing
 *                 that should happen silently — the shell calls `load` for that
 * @param rules    the brand's rules, for the live check
 * @param assets   the client's approved files
 * @param onChange fired after every committed change, so the shell can autosave
 */
export function useEditor(
  initial: CanvasDocument,
  rules: BrandRules,
  assets: readonly Asset[],
  onChange: (doc: CanvasDocument) => void,
): Editor {
  const [state, dispatch] = useReducer(reduce, initial, initialState);
  const opened = useRef(initial);
  /**
   * The document as it was last written out.
   *
   * `opened` alone cannot answer "is there anything to save", because a design
   * that has been saved stays open afterwards and `dirty` would never go back to
   * false — the Save button would be permanently lit with nothing behind it.
   */
  const clean = useRef(initial);
  const change = useRef(onChange);
  change.current = onChange;
  const [measured, setMeasured] = useState(0);

  const markClean = useCallback(() => { clean.current = state.doc; }, [state.doc]);

  /**
   * Autosave, as an effect on the document.
   *
   * **Deliberately not a side effect inside the reducer.** The reducer is pure
   * and can be run twice for the same state without anything happening twice;
   * saving is neither. An effect runs after the commit, once, and skips the
   * reload that opened the design so opening a file is not also a save.
   */
  useEffect(() => {
    if (state.doc === opened.current) return;
    change.current(state.doc);
  }, [state.doc, measured]);

  const load = useCallback((doc: CanvasDocument, note = 'Opened') => {
    opened.current = doc;
    clean.current = doc;
    dispatch({ type: 'load', doc, note });
  }, []);

  const run = useCallback((command: Command | Command[]) => {
    dispatch({ type: 'run', commands: Array.isArray(command) ? command : [command] });
  }, []);

  const selected = useMemo(
    () => state.doc.nodes.filter((node) => state.selection.includes(node.id)),
    [state.doc.nodes, state.selection],
  );

  const deleteSelected = useCallback(() => {
    const ids = state.doc.nodes.filter((n) => state.selection.includes(n.id) && !n.locked).map((n) => n.id);
    if (ids.length === 0) return;
    run(removeNodes(state.doc, ids, ids.length > 1 ? 'Delete layers' : 'Delete layer'));
    dispatch({ type: 'select', ids: [] });
  }, [run, state.doc, state.selection]);

  const duplicateSelected = useCallback(() => {
    const { commands, ids } = duplicateNodes(state.doc, state.selection);
    if (commands.length === 0) return;
    run(commands);
    dispatch({ type: 'select', ids });
  }, [run, state.doc, state.selection]);

  const groupSelected = useCallback(() => {
    const { commands, groupId } = groupNodes(state.doc, state.selection);
    if (commands.length === 0) return;
    run(commands);
    dispatch({ type: 'select', ids: [groupId] });
  }, [run, state.doc, state.selection]);

  const ungroupSelected = useCallback(() => {
    const ids = state.doc.nodes.filter((n) => state.selection.includes(n.id) && n.type === 'group').map((n) => n.id);
    const commands = ids.flatMap((id) => ungroupNode(state.doc, id));
    if (commands.length === 0) return;
    run(commands);
    dispatch({ type: 'select', ids: [] });
  }, [run, state.doc, state.selection]);

  const order = useCallback((direction: 'front' | 'back' | 'forward' | 'backward') => {
    run(nudgeOrder(state.doc, state.selection, direction));
  }, [run, state.doc, state.selection]);

  /**
   * Put one of the client's own files on the sheet.
   *
   * **Measured first, then placed.** A logo whose own proportions were never
   * recorded cannot be checked for stretching later, so the file is read before
   * the node is made rather than after. Sized to its own aspect and no wider
   * than most of the artboard, because a client dropping a photograph on a blank
   * sheet means to fill it and dropping a logo means it to sit.
   */
  const place = useCallback(async (kind: CanvasNode['type'], asset: Asset) => {
    const art = state.doc.artboard;
    const size = await measure(asset);
    const aspect = size.width / Math.max(1, size.height);
    const cap = kind === 'logo' ? 0.4 : kind === 'pattern' || kind === 'texture' ? 1 : 0.8;
    const width = Math.round(kind === 'pattern' || kind === 'texture'
      ? art.width
      : Math.min(size.width, art.width * cap));
    const height = Math.round(kind === 'pattern' || kind === 'texture' ? art.height : width / aspect);
    const seed = {
      name: asset.filename.replace(/\.[^.]+$/, '').slice(0, 60) || 'Layer',
      x: Math.round((art.width - width) / 2),
      y: Math.round((art.height - height) / 2),
      width,
      height,
    };
    const filled = kind === 'pattern' || kind === 'texture';

    const node: CanvasNode =
      kind === 'text' ? makeNode('text', seed, {
        text: 'Your headline', fontFamily: FALLBACK_BRAND.displayFont, fontWeight: 700,
        fontSize: 64, lineHeight: 1.1, letterSpacing: -0.01, align: 'left',
        transform: 'none', color: FALLBACK_BRAND.ink,
      })
      : kind === 'image' ? makeNode('image', seed, {
        assetId: asset.id, naturalWidth: size.width, naturalHeight: size.height,
        fit: filled ? 'cover' : 'cover', cornerRadius: 0,
        adjustments: { brightness: 1, contrast: 1, saturation: 1 },
      })
      : kind === 'logo' ? makeNode('logo', seed, {
        assetId: asset.id, naturalWidth: size.width, naturalHeight: size.height,
        sourceAspect: aspect, variant: 'primary',
      })
      : kind === 'illustration' ? makeNode('illustration', seed, {
        assetId: asset.id, naturalWidth: size.width, naturalHeight: size.height,
        fit: 'contain', cornerRadius: 0, tint: '', flip: false,
      })
      : kind === 'pattern' ? makeNode('pattern', { ...seed, x: 0, y: 0, width: art.width, height: art.height }, {
        assetId: asset.id, tile: 200, rotation: 0, offsetX: 0, offsetY: 0, color: '',
      })
      : kind === 'texture' ? makeNode('texture', { ...seed, x: 0, y: 0, width: art.width, height: art.height }, {
        assetId: asset.id, scale: 240, opacity: 0.35, blend: 'multiply', color: '',
      })
      : makeNode('shape', seed, {
        shape: 'rectangle', fill: FALLBACK_BRAND.accent, stroke: '#252422', strokeWidth: 0,
        cornerRadius: 0, points: [],
      });

    run(addNodes([node], `Add ${node.name}`));
    dispatch({ type: 'select', ids: [node.id] });
    setMeasured((n) => n + 1);
  }, [run, state.doc.artboard]);

  /** The document as the engine will accept it. */
  const saveable = useCallback((): CanvasDocument => normalise(state.doc).doc, [state.doc]);

  return {
    state,
    doc: state.doc,
    status: state.status,
    selection: state.selection,
    selected,
    selectedOne: selected.length === 1 ? selected[0] : undefined,
    canUndo: canUndo(state.history),
    canRedo: canRedo(state.history),
    undoLabel: undoLabel(state.history),
    redoLabel: redoLabel(state.history),
    dirty: state.doc !== clean.current,
    verdict: useMemo(() => judge(state.doc, rules), [state.doc, rules]),
    run,
    dispatch,
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    select: (ids) => dispatch({ type: 'select', ids }),
    toggle: (id) => dispatch({ type: 'toggle', id }),
    place,
    deleteSelected,
    duplicateSelected,
    groupSelected,
    ungroupSelected,
    order,
    setArtboard: (patch) => dispatch({ type: 'artboard', patch }),
    markClean,
    saveable,
  };
}

/* -------------------------------------------------------------- panel reads */

/**
 * The layers the panel lists, deepest child first.
 *
 * **The panel reads top-down like the artboard does**, so the last sibling is
 * the first row — the layer sitting on top of everything is the one at the top of
 * the list, and getting that backwards is the single most disorienting thing a
 * layers panel can do.
 */
export function layerRows(doc: CanvasDocument): { node: CanvasNode; depth: number; index: number }[] {
  const rows: { node: CanvasNode; depth: number; index: number }[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    const kids = doc.nodes.filter((node) => node.parentId === parentId);
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      rows.push({ node: kids[i]!, depth, index: i });
      if (kids[i]!.type === 'group') walk(kids[i]!.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** What the top bar's summary says, in one call. */
export function summarise(doc: CanvasDocument): { layers: number; total: number; files: number } {
  const files = new Set<string>();
  for (const node of doc.nodes) {
    if ('assetId' in node.properties) files.add(node.properties.assetId);
  }
  return { layers: roots(doc).length, total: doc.nodes.length, files: files.size };
}

/** An id for a layer the panel invented, so a rename is not a schema change. */
export const newId = newNodeId;
