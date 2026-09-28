import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasDocument } from '../api.js';
import { normalise } from './document.js';

/**
 * Writing a design out, quietly, while it is being made.
 *
 * **Why this is a hook and not a timer in the shell.** A canvas emits a change on
 * every pointer move of a drag. A request per pointer move would be a hundred
 * requests to record one drag, and the last of them would arrive after the
 * designer had moved on. So a change is *noted* immediately and *written* when
 * the work stops: the document goes into a ref on every move, and one request
 * goes out once the ref has been still for `wait` milliseconds.
 *
 * **It only writes designs that already exist.** A design the client has not
 * saved has no name and no owner yet, and inventing a `brand_projects` row for
 * every sheet someone glanced at would fill the studio's Projects list with
 * empty drafts. So the Save button creates, and autosave takes over for the rest
 * of the session — from that moment there is something to keep up to date.
 *
 * **Normalised at the last possible moment.** `normalise` walks every node and
 * allocates a copy of each, which is the right thing to do once per save and pure
 * waste on every pointer move. So the raw document is what sits in the ref, and
 * the bounds are applied to the copy that is about to be sent.
 */

/** What the status bar says about the last write. */
export type AutosaveState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'failed'; message: string };

export interface Autosave {
  /**
   * Note a changed document. Cheap, synchronous, and safe on every move.
   *
   * `force` is for a change that is not in the document. Renaming a design that is
   * otherwise clean is worth persisting, and the identity check at the top of
   * `note` would otherwise skip it because the document itself had not moved.
   */
  note: (doc: CanvasDocument, options?: { force?: boolean }) => void;
  /** After an explicit save, so the next idle tick is not a redundant write. */
  markSaved: () => void;
  state: AutosaveState;
  /** Whether a write is owed or on its way, for the status bar's dot. */
  pending: boolean;
}

/** Long enough to cover a drag and a pause; short enough to lose nothing. */
const WAIT = 1_200;

export function useAutosave(input: {
  /** False until the design has been saved once; see the note above. */
  enabled: boolean;
  /** Writes the document. Resolving means it landed. */
  write: (doc: CanvasDocument) => Promise<void>;
  wait?: number;
}): Autosave {
  const { enabled, write, wait = WAIT } = input;
  const owed = useRef<CanvasDocument | null>(null);
  const written = useRef<CanvasDocument | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  const alive = useRef(true);
  const [state, setState] = useState<AutosaveState>({ kind: 'idle' });

  /**
   * The writer is held in a ref, and this is the reason why.
   *
   * The caller's `write` is a closure over things that change while the designer
   * works — the name, mostly. If `flush` depended on it, every keystroke in the
   * name field would hand back a new `flush`, and the effect below would run its
   * cleanup, and the cleanup writes. A pending document would then go out on
   * every letter instead of after a pause, which is the request-per-pointer-move
   * problem this whole hook exists to solve, arriving by a different door.
   *
   * So the closure is refreshed in place and `flush` stays stable for the life of
   * the editor.
   */
  const writeRef = useRef(write);
  writeRef.current = write;

  const arm = useCallback((ms: number) => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, ms);
  }, []);

  const flush = useCallback(async () => {
    /**
     * The write runs even when `alive` is false: the unmount path below calls this
     * on purpose, and the whole point of that call is to send the document. What
     * must not happen after unmount is `setState`, so `alive` guards those calls
     * and nothing else.
     */
    const doc = owed.current;
    if (doc === null || doc === written.current) return;
    // A write is already on its way. The newest document stays owed and goes out
    // as soon as this one lands, rather than two requests racing for one row.
    if (busy.current) return;
    busy.current = true;
    if (alive.current) setState({ kind: 'saving' });
    try {
      await writeRef.current(normalise(doc).doc);
      written.current = doc;
      if (owed.current === doc) owed.current = null;
      if (alive.current) setState({ kind: 'saved', at: new Date().toLocaleTimeString() });
    } catch (error) {
      /**
       * The document stays owed, so the next change — or the close — tries again
       * rather than quietly dropping the edit that failed. The message is shown
       * rather than swallowed because a silently unsaved design is the one failure
       * in this whole editor a designer cannot see for themselves.
       */
      if (alive.current) setState({ kind: 'failed', message: (error as Error).message });
    } finally {
      busy.current = false;
      /**
       * Anything edited while that request was in flight has had its own timer
       * fired and turned away by `busy`. Without this it would sit owed until the
       * designer touched something else, and if they never did, it would be lost
       * when the tab closed. So a write that lands over a newer document starts
       * the clock again for that newer document.
       */
      if (alive.current && owed.current !== null && owed.current !== written.current) arm(wait);
    }
  }, [arm, wait]);

  const note = useCallback((doc: CanvasDocument, options?: { force?: boolean }) => {
    if (options?.force !== true && doc === written.current) return;
    owed.current = doc;
    if (!enabled) return;
    setState((current) => (current.kind === 'waiting' ? current : { kind: 'waiting' }));
    arm(wait);
  }, [arm, enabled, wait]);

  const markSaved = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    if (owed.current !== null) written.current = owed.current;
    owed.current = null;
    setState({ kind: 'idle' });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== undefined) clearTimeout(timer.current);
      /**
       * The last few seconds, on the way out.
       *
       * An autosave that drops the tail of a session is worse than no autosave,
       * because the designer was told it was being kept. So whatever is still owed
       * is written as the editor closes — not awaited, because closing does not
       * wait for the network, but sent. `written` is checked inside `flush`, so a
       * development remount does not send the same document twice.
       */
      if (enabled) void flush();
    };
  }, [enabled, flush]);

  return {
    note,
    markSaved,
    state,
    pending: enabled && (state.kind === 'waiting' || state.kind === 'saving'),
  };
}
