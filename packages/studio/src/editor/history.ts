import { apply, invert, merge, merges, type Command } from './commands.js';
import type { CanvasDocument } from '../api.js';

/**
 * Undo and redo, as a bounded stack of commands.
 *
 * **A drag is one entry** (§45), which is the whole reason this holds commands
 * rather than documents: `merges` decides whether a new edit is a continuation
 * of the last one, and the only edits that continue anything are a `patch` of
 * the same nodes under the same label. Everything else stacks.
 *
 * **Bounded, because an editor that grows history without limit is a memory
 * leak wearing a feature.** Two hundred entries is well past what anybody
 * reaches for with ⌘Z, and dropping the oldest is invisible in practice.
 */

export const HISTORY_LIMIT = 200;

export interface History {
  /** Committed edits, oldest first. */
  past: Command[];
  /** Undone edits, most recent first. */
  future: Command[];
}

/** A history with nothing in it. */
export const EMPTY_HISTORY: History = { past: [], future: [] };

/**
 * Put a command on the stack.
 *
 * The previous entry is replaced rather than pushed when the two are the same
 * gesture, which is what makes a drag one thing to undo. A new command also
 * clears `future`, because redo means "undo the undo", and it stops meaning that
 * the moment something new is done.
 */
export function commit(history: History, command: Command): History {
  if (isEmptyCommand(command)) return history;
  const previous = history.past[history.past.length - 1];
  const merged = previous !== undefined && merges(previous, command) ? merge(previous, command) : undefined;
  const past = merged === undefined ? [...history.past, command] : [...history.past.slice(0, -1), merged];
  return { past: past.slice(-HISTORY_LIMIT), future: [] };
}

/**
 * Whether a command would change nothing.
 *
 * A `patch` whose before and after are the same objects is the no-op a caller
 * produces when it tried to do something the selection made impossible — a nudge
 * on a locked layer, a drag that snapped straight back. Storing those fills the
 * stack with steps that do nothing, and a designer who presses ⌘Z five times and
 * watches nothing happen has learned not to use undo.
 */
function isEmptyCommand(command: Command): boolean {
  switch (command.kind) {
    case 'add':
    case 'remove':
      return command.nodes.length === 0;
    case 'patch':
      return command.after.length === 0 || command.after.every((node, index) => node === command.before[index]);
    case 'artboard':
      return sameArtboard(command.before, command.after);
    case 'reorder':
      return command.after.every((id, index) => id === command.before[index]);
  }
}

function sameArtboard(a: CanvasDocument['artboard'], b: CanvasDocument['artboard']): boolean {
  return a.width === b.width && a.height === b.height && a.background === b.background;
}

/** Step back one edit, returning the document and the history to go with it. */
export function undo(doc: CanvasDocument, history: History): { doc: CanvasDocument; history: History } {
  const command = history.past[history.past.length - 1];
  if (!command) return { doc, history };
  return {
    doc: apply(doc, invert(command)),
    history: {
      past: history.past.slice(0, -1),
      future: [command, ...history.future],
    },
  };
}

/** Step forward again. */
export function redo(doc: CanvasDocument, history: History): { doc: CanvasDocument; history: History } {
  const command = history.future[0];
  if (!command) return { doc, history };
  return {
    doc: apply(doc, command),
    history: {
      past: [...history.past, command],
      future: history.future.slice(1),
    },
  };
}

/** Whether undo and redo would do anything. */
export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** The name of what undo would reverse, for the toolbar's tooltip. */
export function undoLabel(history: History): string {
  return history.past[history.past.length - 1]?.label ?? 'Undo';
}

export function redoLabel(history: History): string {
  return history.future[0]?.label ?? 'Redo';
}
