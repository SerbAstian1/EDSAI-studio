import {
  createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode,
} from 'react';

/**
 * "View as client" — the studio with its own hands tied.
 *
 * The portal is what a client sees, and it is built from the same records the
 * studio edits. So the question this answers is not "how does the portal look"
 * but "what would I be handing them": every edit control, every internal note,
 * every menu that changes a record, gone from the screen at once.
 *
 * It is deliberately **not** persisted and deliberately **not** a permission.
 * Nothing here is refused — the API still accepts every write this session is
 * entitled to, because a studio owner can always turn the toggle off. What
 * changes is what is *offered*, which is the part that is easy to get wrong by
 * eye: a preview that still shows a Delete button is not a preview.
 *
 * A component hides its studio-only controls by wrapping them in `<StudioOnly>`
 * rather than by reading the flag and branching, so a screen cannot end up
 * showing half its controls because one `if` was forgotten on one branch.
 */

export interface ViewMode {
  /** True while the shell is showing what a client would be shown. */
  clientView: boolean;
  toggle: () => void;
}

const DEFAULT: ViewMode = { clientView: false, toggle: () => undefined };

const ViewModeContext = createContext<ViewMode>(DEFAULT);

export function ViewModeProvider({ children }: { children: ReactNode }): ReactElement {
  const [clientView, setClientView] = useState(false);
  const toggle = useCallback(() => { setClientView((on) => !on); }, []);
  const value = useMemo(() => ({ clientView, toggle }), [clientView, toggle]);
  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewMode {
  return useContext(ViewModeContext);
}

/**
 * Studio-only furniture: shown while the studio is the audience, hidden while
 * the client's is. Renders nothing at all rather than `display: none`, so it
 * is gone from the accessibility tree and from the tab order too.
 */
export function StudioOnly({ children }: { children: ReactNode }): ReactNode {
  return useViewMode().clientView ? null : children;
}

/** The same test, for a control that is inline rather than a block of its own. */
export function useStudio(): boolean {
  return !useViewMode().clientView;
}
