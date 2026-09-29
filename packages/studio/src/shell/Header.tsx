import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Eye, EyeOff, Moon, Search, Sun } from 'lucide-react';
import { api } from '../api.js';
import { currentTheme, setTheme, subscribeToTheme } from '../theme.js';
import { useViewMode } from '../viewMode.js';

/**
 * The studio's top bar.
 *
 * Four real things, not four decorations: the search opens the same command
 * palette the sidebar and ⌘K already open — one search, found in three places,
 * rather than a second index to keep in sync with the first. The bell is a link
 * to Updates, because there is no notification feed to invent one for. The eye
 * is "view as client", and it is the only control here that changes what the
 * rest of the shell offers rather than where it goes. The name and role come
 * from the session the Gate already resolved; nothing here fetches a second time
 * to learn who is signed in.
 */

const ROLE_LABEL: Record<string, string> = {
  owner: 'Studio Owner',
  brand_manager: 'Brand Manager',
  editor: 'Editor',
  viewer: 'Viewer',
  limited: 'Limited access',
};

/**
 * The signed-in person's initials.
 *
 * Not `initialsOf` from `ClientIdentity`, despite looking like it: this is a
 * *person*, so the round `.avatar` is right and a client mark would be wrong.
 * The one thing borrowed is the "no second word means the second letter" rule —
 * "Aurelia" is `AU` here too, so the same person does not read as `AA` in the
 * header and `AU` in the sidebar.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + last).toUpperCase();
}

/**
 * A two-state switch rather than a three-way menu. "System" still exists —
 * it is what you get before you ever touch this — but a person who reaches
 * for the toggle wants the other one of light and dark, not a submenu.
 */
function ThemeToggle(): ReactElement {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="header-icon-button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'dark'
        ? <Sun size={16} strokeWidth={1.75} aria-hidden="true" />
        : <Moon size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

/**
 * "View as client", as a pressed state rather than a menu of audiences.
 *
 * `aria-pressed` is the whole contract: a toggle that says what it will do is a
 * worse toggle than one that says whether it is doing it. The label names the
 * state it is leaving, which is the question a thumb is asking.
 */
function ViewAsClientToggle(): ReactElement {
  const { clientView, toggle } = useViewMode();
  const label = clientView ? 'Back to studio view' : 'View as client';

  return (
    <button
      type="button"
      className={`header-icon-button${clientView ? ' on' : ''}`}
      onClick={toggle}
      aria-pressed={clientView}
      aria-label={label}
      title={label}
    >
      {clientView
        ? <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
        : <Eye size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

export function Header({ onOpenPalette, railControl }: {
  onOpenPalette: () => void;
  /**
   * A control for the rails, rendered beside the other header buttons.
   *
   * Passed in rather than imported so the header does not have to know what a
   * rail is, and so the studio rail, the client rail and focus mode can each
   * offer their own control here without the bar growing a list of sidebar
   * specifics.
   */
  railControl?: ReactNode;
}): ReactElement {
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.session });
  const principal = session?.principal;
  const name = session?.user?.name ?? (principal?.kind === 'portal' ? 'Client' : 'Studio');
  const role = principal ? ROLE_LABEL[principal.role] ?? principal.role : '';

  return (
    <div className="app-header">
      <button type="button" className="header-search" onClick={onOpenPalette}
              aria-label="Search clients, projects, stages, and tasks">
        <Search className="header-search-glyph" size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="header-search-text">Client, project, stage, or task</span>
        <span className="kbd" aria-hidden="true">⌘K</span>
      </button>

      {railControl}

      <ThemeToggle />

      <ViewAsClientToggle />

      <a className="header-icon-button" href="#/updates" aria-label="Updates" title="Updates">
        <Bell size={16} strokeWidth={1.75} aria-hidden="true" />
      </a>

      <div className="header-identity">
        <span className="avatar" aria-hidden="true">{initials(name)}</span>
        <span className="header-identity-text">
          <span className="header-name">{name}</span>
          <span className="header-role muted">{role}</span>
        </span>
      </div>
    </div>
  );
}
