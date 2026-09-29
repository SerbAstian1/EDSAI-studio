import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode,
} from 'react';
import { Columns2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

/**
 * The two rails, and the state they share.
 *
 * **A rail that cannot be got out of the way is not a rail, it is a tax.** A
 * studio owner reading a document beside a client is using a third of the width
 * to look at navigation, and a presenter running a deck needs all of it. So both
 * rails collapse, independently, and the decision is remembered: someone who
 * works with the client rail closed has said so once and should not have to say
 * it on every screen.
 *
 * **The state lives here rather than in either rail** for two reasons that are
 * both load-bearing. First, the two rails are rendered by different components
 * in different parts of the tree — the studio rail by `App`, the client rail by
 * `ClientWorkspace` — and a "focus mode" that has to reach into both cannot be a
 * local `useState`. Second, the responsive rules need the same two bits: a rail
 * that is collapsed on a laptop is a drawer on a phone, and a component deciding
 * that from its own `matchMedia` would disagree with the layout that contains it
 * about which one it is.
 *
 * **Focus mode is a third state, not the absence of both.** It is one control
 * that puts the two rails away and says so, and it restores whatever each rail
 * was beforehand. Collapsing both by hand and calling that focus would mean
 * remembering which of them was already closed, and a presenter who then
 * pressed Escape would get back an interface they had not chosen.
 */

/** A remembered per-rail preference. `null` before anything is stored. */
export type RailState = 'open' | 'closed';

const KEY = 'edsai:rails:v1';

/**
 * What is remembered, read once per page.
 *
 * **Read defensively and rewritten in a known shape.** This is the only place
 * the studio reads `localStorage`, and it is a cache of a preference rather than
 * anything load-bearing, so a browser that refuses (private mode, storage
 * disabled, a quota error) gets working rails that simply forget. A parse
 * failure is treated exactly like an empty store rather than being allowed to
 * take the app down on boot.
 */
interface Stored {
  studio: RailState;
  client: RailState;
}

const DEFAULTS: Stored = { studio: 'open', client: 'open' };

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      studio: parsed.studio === 'closed' ? 'closed' : 'open',
      client: parsed.client === 'closed' ? 'closed' : 'open',
    };
  } catch {
    return DEFAULTS;
  }
}

function write(state: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A preference that cannot be stored is a preference that does not survive
    // the reload. Nothing else is affected, so this is not worth saying.
  }
}

export interface Rails {
  studio: RailState;
  client: RailState;
  /** Both rails away, whatever they were. */
  focus: boolean;
  setRail: (which: 'studio' | 'client', state: RailState) => void;
  toggleRail: (which: 'studio' | 'client') => void;
  setFocus: (on: boolean) => void;
  toggleFocus: () => void;
}

const RailsContext = createContext<Rails | null>(null);

export function RailsProvider({ children }: { children: ReactNode }): ReactElement {
  // `null` rather than the default shape, so a consumer outside the provider
  // fails loudly in development instead of silently getting rails that do
  // nothing.
  const [stored, setStored] = useState<Stored>(read);
  const [focus, setFocus] = useState(false);

  const setRail = useCallback((which: 'studio' | 'client', state: RailState) => {
    setStored((was) => {
      const next = { ...was, [which]: state };
      write(next);
      return next;
    });
  }, []);

  const toggleRail = useCallback((which: 'studio' | 'client') => {
    setStored((was) => {
      const next: Stored = { ...was, [which]: was[which] === 'open' ? 'closed' : 'open' };
      write(next);
      return next;
    });
  }, []);

  const value = useMemo<Rails>(() => ({
    studio: stored.studio,
    client: stored.client,
    focus,
    setRail,
    toggleRail,
    setFocus,
    toggleFocus: () => setFocus((f) => !f),
  }), [stored, focus, setRail, toggleRail]);

  useEffect(() => {
    // Escape is the universal way out of a mode that took over the screen, and
    // it costs nothing to honour. It is bound on the document rather than on a
    // control so it works wherever focus happens to be — except in a field,
    // where Escape belongs to the field.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== '`') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (event.key === '`') {
        event.preventDefault();
        setFocus((f) => !f);
        return;
      }
      setFocus(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return <RailsContext.Provider value={value}>{children}</RailsContext.Provider>;
}

export function useRails(): Rails {
  const rails = useContext(RailsContext);
  if (!rails) throw new Error('useRails must be used inside a RailsProvider');
  return rails;
}

/**
 * A control that puts a rail away and brings it back.
 *
 * **One component for both rails, so the two behave identically.** The studio
 * rail is full height and the client rail is a third of the way across, their
 * heads hold different things, and the way somebody gets a rail out of the way
 * must not be one that requires reading the screen to find. The button says which
 * rail and whether it is about to close, and the label is real text rather than
 * a title attribute, because a control with no visible name is a control nobody
 * finds.
 */
export function RailToggle({ which, title }: { which: 'studio' | 'client'; title: string }): ReactElement {
  const rails = useRails();
  const state = rails[which];
  const closed = state === 'closed';
  const Icon = closed ? PanelLeftOpen : PanelLeftClose;

  return (
    <button
      type="button"
      className="rail-toggle"
      aria-pressed={!closed}
      aria-label={closed ? `Show the ${title}` : `Hide the ${title}`}
      title={closed ? `Show the ${title}` : `Hide the ${title}`}
      onClick={() => rails.toggleRail(which)}
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">{closed ? `Show the ${title}` : `Hide the ${title}`}</span>
    </button>
  );
}

/** The one control that puts both rails away at once. */
export function FocusToggle(): ReactElement {
  const rails = useRails();
  return (
    <button
      type="button"
      className="rail-toggle rail-focus"
      aria-pressed={rails.focus}
      aria-label={rails.focus ? 'Show the sidebars' : 'Hide both sidebars'}
      title={rails.focus ? 'Show the sidebars (Esc)' : 'Hide both sidebars (`)'}
      onClick={() => rails.toggleFocus()}
    >
      <Columns2 size={15} strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">{rails.focus ? 'Show the sidebars' : 'Hide both sidebars'}</span>
    </button>
  );
}
