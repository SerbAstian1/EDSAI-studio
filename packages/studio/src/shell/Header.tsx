import { useSyncExternalStore, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Moon, Search, Sun } from 'lucide-react';
import { api } from '../api.js';
import { currentTheme, setTheme, subscribeToTheme } from '../theme.js';

/**
 * The studio's top bar.
 *
 * Three real things, not three decorations: the search opens the same command
 * palette the sidebar and ⌘K already open — one search, found in three places,
 * rather than a second index to keep in sync with the first. The bell is a
 * link to Activity, because there is no notification feed to invent one for.
 * The name and role come from the session the Gate already resolved; nothing
 * here fetches a second time to learn who is signed in.
 */

const ROLE_LABEL: Record<string, string> = {
  owner: 'Studio Owner',
  brand_manager: 'Brand Manager',
  editor: 'Editor',
  viewer: 'Viewer',
  limited: 'Limited access',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
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

export function Header({ onOpenPalette }: { onOpenPalette: () => void }): ReactElement {
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

      <ThemeToggle />

      <a className="header-icon-button" href="#/activity" aria-label="Activity" title="Activity">
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
