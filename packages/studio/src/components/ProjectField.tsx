import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Client, Project } from '../api.js';

/**
 * Which project a run is for — typed, not hunted for.
 *
 * This was a `<select>` for one reason: a run is refused unless it names a
 * project **id**, and the free-text box that preceded it sent a name, so every
 * run started from this screen came back 404. The dropdown fixed the bug by
 * removing the typing, which fixed the wrong half.
 *
 * So: a text input that resolves what you type to a real project. You type,
 * matches appear, one of them becomes the id. Nothing is submitted on a name
 * alone — if the text matches nothing, the field says so and the run cannot
 * start, which is the same guarantee the dropdown gave and none of its
 * clumsiness.
 *
 * Matching runs over the client's name as well as the project's, because
 * "morrow" is how you think of it when two clients both have a rebrand.
 *
 * Keyboard behaviour follows the command palette exactly — arrows move, Enter
 * picks, Escape closes — because this is the same interaction and a second set
 * of conventions for it would be one to learn twice.
 */

export interface ProjectMatch {
  project: Project;
  client: Client | undefined;
}

/** Everything whose project or client name contains the query, best first. */
export function matchProjects(
  projects: readonly Project[],
  clients: readonly Client[],
  query: string,
): ProjectMatch[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const needle = query.trim().toLowerCase();

  const all = projects.map((project) => ({ project, client: byId.get(project.clientId) }));
  if (needle === '') return all;

  return all
    .filter(({ project, client }) =>
      `${project.name} ${client?.name ?? ''}`.toLowerCase().includes(needle))
    // A project whose own name starts with what you typed is what you meant;
    // one that matched on its client's name is a fallback.
    .sort((a, b) => {
      const rank = (m: ProjectMatch): number => {
        const name = m.project.name.toLowerCase();
        if (name.startsWith(needle)) return 0;
        if (name.includes(needle)) return 1;
        return 2;
      };
      return rank(a) - rank(b) || a.project.name.localeCompare(b.project.name);
    });
}

/** The one project a typed string can only mean, or nothing. */
export function resolveProject(matches: readonly ProjectMatch[], query: string): Project | undefined {
  const needle = query.trim().toLowerCase();
  if (needle === '') return undefined;
  const exact = matches.filter((m) => m.project.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0]?.project;
  // One candidate and no ambiguity is also an answer: typing "show" when there
  // is a single Showroom site should not require pressing a key to confirm.
  return matches.length === 1 ? matches[0]?.project : undefined;
}

export interface ProjectFieldProps {
  projects: readonly Project[];
  clients: readonly Client[];
  /** The chosen project's id, or '' while nothing is resolved. */
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ProjectField({
  projects, clients, value, onChange, disabled, placeholder,
}: ProjectFieldProps): ReactElement {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);

  const matches = useMemo(
    () => matchProjects(projects, clients, query), [projects, clients, query],
  );
  const highlighted = matches[Math.min(index, matches.length - 1)];

  // Typing is the only thing that changes the text; choosing is the only thing
  // that sets the id. Keeping them in step here means the field can never show
  // one project's name while carrying another's id.
  useEffect(() => {
    const resolved = resolveProject(matches, query);
    const next = resolved?.id ?? '';
    if (next !== value) onChange(next);
    // `value` is deliberately absent: this reacts to what was typed, not to
    // the id it just reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matches]);

  useEffect(() => { setIndex(0); }, [query]);

  useEffect(() => {
    const onClickAway = (event: MouseEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', onClickAway);
    return () => removeEventListener('mousedown', onClickAway);
  }, []);

  const choose = (match: ProjectMatch | undefined): void => {
    if (!match) return;
    setQuery(match.project.name);
    onChange(match.project.id);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length));
    }
    if (event.key === 'Enter' && open) { event.preventDefault(); choose(highlighted); }
  };

  const chosen = projects.find((p) => p.id === value);
  const unresolved = query.trim() !== '' && !chosen;

  return (
    <div className="combo" ref={wrapper}>
      <input
        id="project"
        type="text"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? 'Start typing a project or a client'}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls="project-matches"
        aria-activedescendant={open && highlighted ? `project-${highlighted.project.id}` : undefined}
        autoComplete="off"
      />

      {open && matches.length > 0 && (
        <ul id="project-matches" className="combo-list" role="listbox" aria-label="Projects">
          {matches.slice(0, 8).map((match, position) => (
            <li
              key={match.project.id}
              id={`project-${match.project.id}`}
              role="option"
              aria-selected={position === Math.min(index, matches.length - 1)}
            >
              <button
                type="button"
                onMouseEnter={() => setIndex(position)}
                onMouseDown={(event) => { event.preventDefault(); choose(match); }}
              >
                {match.project.name}
                <span className="group">{match.client?.name ?? 'No client'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* While the list is open it *is* the instruction, so saying "more than
          one matches" above it only pushes the options further from the
          cursor. The no-match line has no list to defer to, so it always
          shows. */}
      {unresolved && matches.length === 0 && (
        <span className="muted">
          No project matches “{query.trim()}”. A run belongs to one that exists.
        </span>
      )}
      {unresolved && matches.length > 0 && !open && (
        <span className="muted">More than one project matches — pick the one you meant.</span>
      )}
      {chosen && (
        <span className="muted">
          {clients.find((c) => c.id === chosen.clientId)?.name ?? 'No client'}
        </span>
      )}
    </div>
  );
}
