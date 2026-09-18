import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { allCommands, search, type Command } from './commands.js';

/**
 * The command palette.
 *
 * Kept in the initial route deliberately: it is the fastest path to everything
 * else, and lazy-loading the thing a power user reaches for first would trade
 * a few kilobytes for the feature's whole point.
 *
 * Keyboard behaviour is the feature. Arrow keys move, Enter runs, Escape closes,
 * and focus returns to whatever opened it — a palette you have to reach for the
 * mouse to dismiss is not a keyboard tool.
 */

export function useCommandPalette(): { open: boolean; setOpen: (open: boolean) => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}

export function CommandPalette({ onClose }: { onClose: () => void }): ReactElement {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  const commands = useMemo(() => allCommands(), []);
  const results = useMemo(() => search(commands, query), [commands, query]);
  const selected = results[Math.min(index, results.length - 1)];

  useEffect(() => {
    opener.current = document.activeElement;
    inputRef.current?.focus();
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => { setIndex(0); }, [query]);

  const runCommand = (command: Command | undefined): void => {
    if (!command?.available || !command.run) return;
    command.run();
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    }
    if (event.key === 'Enter') { event.preventDefault(); runCommand(selected); }
  };

  return (
    <div
      className="palette-scrim"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search commands…"
          aria-label="Search commands"
          aria-activedescendant={selected ? `cmd-${selected.id}` : undefined}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          autoComplete="off"
        />

        {results.length === 0 ? (
          <p className="none">Nothing matches “{query}”.</p>
        ) : (
          <ul id="palette-results" role="listbox" aria-label="Commands">
            {results.map((command, position) => (
              <li
                key={command.id}
                id={`cmd-${command.id}`}
                role="option"
                aria-selected={position === Math.min(index, results.length - 1)}
                aria-disabled={command.available ? undefined : true}
              >
                <button
                  type="button"
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => runCommand(command)}
                  disabled={!command.available}
                  title={command.unavailable}
                >
                  <span className="glyph" aria-hidden="true">{command.glyph}</span>
                  {command.title}
                  <span className="group">{command.available ? command.group : 'not built yet'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
