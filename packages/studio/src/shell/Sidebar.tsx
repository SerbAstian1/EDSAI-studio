import type { ReactElement } from 'react';
import { GROUPS, sectionsIn, type Section } from './navigation.js';

/**
 * The global sidebar.
 *
 * A planned section renders as text rather than a link — `aria-disabled` and no
 * `href`, so it is reachable by screen reader and announced as unavailable
 * instead of silently doing nothing when clicked.
 */

function Item({ section, current }: { section: Section; current: string }): ReactElement {
  if (section.status === 'planned') {
    return (
      <span className="nav-item pending" aria-disabled="true" title={section.intent}>
        <span className="glyph" aria-hidden="true">{section.glyph}</span>
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
    >
      <span className="glyph" aria-hidden="true">{section.glyph}</span>
      {section.label}
    </a>
  );
}

export function Sidebar({ current, onOpenPalette }: {
  current: string;
  onOpenPalette: () => void;
}): ReactElement {
  return (
    <aside className="sidebar">
      <a className="wordmark" href="#/">EDS AI</a>

      {GROUPS.map((group) => (
        <nav className="nav-group" key={group} aria-label={group}>
          <span className="label">{group}</span>
          {sectionsIn(group).map((section) => (
            <Item key={section.id} section={section} current={current} />
          ))}
        </nav>
      ))}

      <button
        onClick={onOpenPalette}
        style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        Search
        <span className="kbd" aria-hidden="true">⌘K</span>
      </button>
    </aside>
  );
}
