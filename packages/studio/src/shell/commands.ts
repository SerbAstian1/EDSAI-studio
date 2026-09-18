import { SECTIONS, type Section } from './navigation.js';

/**
 * The command registry.
 *
 * Commands are data so the palette, and later a menu bar or a keyboard map, all
 * read one list. Navigation commands are derived from `SECTIONS` rather than
 * restated — a section added there appears here without a second edit, which is
 * the same one-source rule the rest of the system holds itself to.
 *
 * A command whose feature does not exist yet is `available: false`. It still
 * appears, because the palette doubles as the product's table of contents, and
 * it says what it is waiting for instead of failing when run.
 */

export interface Command {
  id: string;
  title: string;
  group: string;
  glyph: string;
  available: boolean;
  /** Why it cannot run, when it cannot. */
  unavailable?: string;
  run?: () => void;
  /** Extra words that should match this command in search. */
  keywords?: string;
}

const go = (href: string) => (): void => { location.hash = href; };

function navigationCommands(): Command[] {
  return SECTIONS.map((section: Section) => ({
    id: `go:${section.id}`,
    title: `Go to ${section.label}`,
    group: 'Navigate',
    glyph: section.glyph,
    available: section.status === 'built',
    ...(section.status === 'planned'
      ? { unavailable: `${section.label} arrives in ${section.phase}. ${section.intent ?? ''}` }
      : { run: go(section.href ?? '#/') }),
  }));
}

/** Actions, in the product's own vocabulary rather than a generic CRUD one. */
function actionCommands(): Command[] {
  return [
    {
      id: 'run:new', title: 'New run', group: 'Create', glyph: '+',
      available: true, run: go('#/new'),
      keywords: 'start brief pipeline project',
    },
    {
      id: 'client:new', title: 'New client', group: 'Create', glyph: '+',
      available: false,
      unavailable: 'Clients arrive in P2. A run currently carries a project id with no record behind it.',
    },
    {
      id: 'asset:upload', title: 'Upload asset', group: 'Create', glyph: '↑',
      available: false,
      unavailable: 'The asset library arrives in P5; there is no storage layer yet.',
    },
    {
      id: 'portal:publish', title: 'Publish brand portal', group: 'Deliver', glyph: '◎',
      available: true, run: go('#/portals'),
      keywords: 'hub client guidelines share',
    },
    {
      id: 'settings:open', title: 'Open settings', group: 'Studio', glyph: '⚙',
      available: true, run: go('#/settings'),
    },
  ];
}

export function allCommands(): Command[] {
  return [...actionCommands(), ...navigationCommands()];
}

/**
 * Rank commands against a query.
 *
 * A prefix match on the title beats a word-start match, which beats a match
 * anywhere, which beats a keyword-only match. Unavailable commands sort last
 * whatever they score, so the palette stays useful under the fingers rather
 * than offering something that cannot run.
 */
export function search(commands: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (q === '') return commands.filter((c) => c.available);

  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const title = command.title.toLowerCase();
    const keywords = (command.keywords ?? '').toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score = 4;
    else if (new RegExp(`\\b${escapeRegExp(q)}`).test(title)) score = 3;
    else if (title.includes(q)) score = 2;
    else if (keywords.includes(q)) score = 1;
    if (score > 0) scored.push({ command, score });
  }

  return scored
    .sort((a, b) => {
      if (a.command.available !== b.command.available) return a.command.available ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.command.title.localeCompare(b.command.title);
    })
    .map((entry) => entry.command);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
