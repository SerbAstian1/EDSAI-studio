import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

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

export function Header({ onOpenPalette }: { onOpenPalette: () => void }): ReactElement {
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: api.session });
  const principal = session?.principal;
  const name = session?.user?.name ?? (principal?.kind === 'portal' ? 'Client' : 'Studio');
  const role = principal ? ROLE_LABEL[principal.role] ?? principal.role : '';

  return (
    <div className="app-header">
      <button type="button" className="header-search" onClick={onOpenPalette}>
        <span className="header-search-glyph" aria-hidden="true">⌕</span>
        <span className="header-search-text">Client, project, stage, or task</span>
        <span className="kbd" aria-hidden="true">⌘K</span>
      </button>

      <a className="header-bell" href="#/activity" aria-label="Activity and notifications" title="Activity">
        ◔
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
