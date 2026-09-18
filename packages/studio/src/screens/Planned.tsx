import type { ReactElement } from 'react';
import { findSection } from '../shell/navigation.js';

/**
 * What a section that does not exist yet looks like.
 *
 * It states what the section will be and what has to exist first, because the
 * honest answer to "why is this empty" is usually a dependency rather than a
 * decision. An empty state that says "coming soon" tells the user nothing they
 * could not already see.
 */
export default function Planned({ id }: { id: string }): ReactElement {
  const section = findSection(id);

  if (!section) {
    return (
      <div className="empty">
        <p className="editorial">No such section.</p>
        <p>Nothing in the studio is called “{id}”.</p>
        <a href="#/"><button>Back to overview</button></a>
      </div>
    );
  }

  return (
    <section className="stack">
      <div>
        <p className="label">{section.phase} · not built yet</p>
        <h2>{section.label}</h2>
      </div>
      <div className="card">
        <p>{section.intent}</p>
        <p className="muted">
          It is listed in the sidebar rather than hidden so the shape of the product stays
          readable. It is not clickable because nothing behind it exists yet, and a link that
          goes nowhere is worse than one that says why.
        </p>
      </div>
    </section>
  );
}
