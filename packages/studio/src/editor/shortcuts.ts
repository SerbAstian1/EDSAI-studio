import { useEffect } from 'react';
import { layerRows, type Editor } from './useEditor.js';

/**
 * The keys a designer expects, because not having them is what makes an editor
 * feel like a form.
 *
 * **While a sheet is open the sheet has the keyboard.** `blocked` is how the
 * shell says so: a dialog over the artboard is the entire interface at that
 * moment, and a canvas still listening for `Delete` underneath it would delete a
 * layer while the designer was trying to close a dialog.
 *
 * **Never while a field has focus.** Every one of these bindings collides with
 * typing — `Delete` in a text layer's own copy, the arrow keys in a number box,
 * `⌘G` in a field — and a shortcut that fires while somebody is typing is the
 * single most reliable way to destroy work in a design tool. The test is "would
 * this key press insert a character?", which is what `isTyping` asks.
 */

export interface ShortcutOptions {
  /** A sheet or dialog owns the keyboard. */
  blocked: boolean;
}

export function useShortcuts(editor: Editor, options: ShortcutOptions): void {
  const { blocked } = options;
  useEffect(() => {
    if (blocked) return;
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      const step = event.shiftKey ? 10 : 1;
      const command = event.metaKey || event.ctrlKey;

      if (command) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) editor.redo(); else editor.undo();
            return;
          case 'y':
            event.preventDefault();
            editor.redo();
            return;
          case 'd':
            event.preventDefault();
            editor.duplicateSelected();
            return;
          case 'g':
            event.preventDefault();
            if (event.shiftKey) editor.ungroupSelected(); else editor.groupSelected();
            return;
          case ']':
            event.preventDefault();
            editor.order(event.shiftKey ? 'front' : 'forward');
            return;
          case '[':
            event.preventDefault();
            editor.order(event.shiftKey ? 'back' : 'backward');
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          if (editor.selection.length === 0) return;
          event.preventDefault();
          editor.deleteSelected();
          return;
        case 'Escape':
          event.preventDefault();
          editor.select([]);
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (editor.selection.length === 0) return;
          event.preventDefault();
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          editor.dispatch({ type: 'nudge', dx, dy });
          return;
        }
        case '[':
          event.preventDefault();
          editor.order('backward');
          return;
        case ']':
          event.preventDefault();
          editor.order('forward');
          return;
        case 'Tab': {
          // Tab walks the layer tree top to bottom — the same order the panel
          // shows, so the layer `Tab` lands on is the next row a designer can see
          // rather than the next one in the array.
          const rows = layerRows(editor.doc).map((row) => row.node);
          if (rows.length === 0) return;
          event.preventDefault();
          const at = rows.findIndex((node) => editor.selection.includes(node.id));
          const next = rows[Math.min(rows.length - 1, at + (event.shiftKey ? -1 : 1))];
          if (next) { editor.select([next.id]); editor.dispatch({ type: 'status', status: next.name }); }
          return;
        }
        default:
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [blocked, editor]);
}

/**
 * Whether a key press would go into a field rather than into the design.
 *
 * A `contenteditable` is included because the studio's rich text areas are
 * editable divs, and `isContentEditable` is the only way to ask about one.
 */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true;
}
