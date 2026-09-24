import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactElement } from 'react';
import { ChevronDown, LogOut, Menu, Search } from 'lucide-react';
import { api } from '../api.js';
import { findSection, GROUPS, sectionsIn, type Section } from './navigation.js';

/**
 * The global sidebar.
 *
 * A planned section renders as text rather than a link — `aria-disabled` and no
 * `href`, so it is reachable by screen reader and announced as unavailable
 * instead of silently doing nothing when clicked.
 */

function Item({ section, current, onNavigate }: {
  section: Section;
  current: string;
  onNavigate: () => void;
}): ReactElement {
  const Icon = section.icon;
  if (section.status === 'planned') {
    return (
      <span className="nav-item pending" aria-disabled="true" title={section.intent}>
        <Icon className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
        {section.label}
        <span className="phase">{section.phase}</span>
      </span>
    );
  }
  return (
    <a
      className="nav-item"
      href={section.href}
      aria-current={current === section.id ? 'page' : undefined}
      onClick={onNavigate}
    >
      <Icon className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
      {section.label}
    </a>
  );
}

export function Sidebar({ current, onOpenPalette }: {
  current: string;
  onOpenPalette: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const currentLabel = findSection(current)?.label ?? 'Menu';

  useEffect(() => setOpen(false), [current]);

  // A hard reload rather than a route change: every query the session gate
  // holds is keyed to who was signed in, and the simplest way to guarantee
  // none of it survives a sign-out is to not keep the page that cached it.
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => { location.href = '#/'; location.reload(); },
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <a className="wordmark" href="#/" onClick={() => setOpen(false)}>EDS AI</a>
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <Menu size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{currentLabel}</span>
          <ChevronDown className={open ? 'open' : undefined} size={15} aria-hidden="true" />
        </button>
      </div>

      <div id={menuId} className={`sidebar-menu${open ? ' open' : ''}`}>
        {/* Under the wordmark rather than pinned to the bottom. Pushed down by
            `margin-top: auto` it left a column of dead space on every screen,
            and it is the fastest way to reach anything here — not a footer. */}
        <button className="search" onClick={() => { setOpen(false); onOpenPalette(); }}>
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          Search
          <span className="kbd" aria-hidden="true">⌘K</span>
        </button>

        {GROUPS.map((group) => (
          <nav className="nav-group" key={group} aria-label={group}>
            <span className="label">{group}</span>
            {sectionsIn(group).map((section) => (
              <Item key={section.id} section={section} current={current}
                    onNavigate={() => setOpen(false)} />
            ))}
          </nav>
        ))}

        <button
          type="button"
          className="nav-item nav-item-button"
          style={{ marginTop: 'auto' }}
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          <LogOut className="glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
          {signOut.isPending ? 'Signing out…' : 'Logout'}
        </button>
      </div>
    </aside>
  );
}
