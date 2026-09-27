import type { ReactElement } from 'react';
import { findSection } from '../shell/navigation.js';

/**
 * What a section that does not exist yet looks like.
 *
 * It states what the section will be and what has to exist first, because the
 * honest answer to "why is this empty" is usually a dependency rather than a
 * decision. An empty state that says "coming soon" tells the user nothing they
 * could not already see.
 *
 * It is a real page with a real route, reached from a real link in the rail.
 * An entry that is drawn but dead is worse than one that is missing: it looks
 * like something is broken, and clicking it is the only way to find out what.
 * Here the click is what explains.
 */
export default function Planned({ id }: { id: string }): ReactElement {
  const section = findSection(id);

  if (!section) {
    return (
      <div className="empty">
        <p className="editorial">No such section.</p>
        <p>Nothing in the studio is called “{id}”.</p>
        <a href="#/"><button>Back to Home</button></a>
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
          This is where it lands, and the rail already points here — so the shape of the
          product stays readable and the gap is a route you can link to rather than a
          dead item. What is missing is not a screen: it is the record behind it. Nothing
          is stored for this yet, so there is nothing to show.
        </p>
      </div>
    </section>
  );
}
