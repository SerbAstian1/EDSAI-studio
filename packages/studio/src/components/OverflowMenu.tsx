import {
  useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement,
} from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

/**
 * The "⋯" menu: every secondary action on a row, behind one button.
 *
 * A row used to end in Edit · Remove, and a client's header in Edit · Delete
 * — the destructive action given the same weight, the same width and the
 * same place as the everyday one, on every row, all the time. An overflow
 * menu keeps the row about the thing it lists; the actions are one click
 * away and the dangerous one is named as such.
 *
 * Behaviour follows the platform's menu button pattern so nothing has to be
 * learned: Enter, Space or ArrowDown opens and focuses the first item;
 * arrows move; Escape closes and returns focus to the button; clicking away
 * closes. Roles are `menu` and `menuitem`, so a screen reader announces it
 * as one. The list flips upward when there is no room below, because a
 * table's last row sits at the bottom of the page more often than not.
 */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  /** Destructive: shown in the error colour, last. */
  danger?: boolean;
  disabled?: boolean;
}

export default function OverflowMenu({ label, items, size = 'row' }: {
  /** What the button is for, for assistive tech: "Actions for Mr Stanley". */
  label: string;
  items: readonly MenuItem[];
  /** `row` is the compact square that sits in a table; `bar` matches a toolbar's buttons. */
  size?: 'row' | 'bar';
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled);

  const close = (refocus = true): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const openAt = (index: number): void => {
    setActive(index);
    setOpen(true);
  };

  // Measured once per opening, from the downward position, so the answer
  // cannot flip back and forth as items are focused.
  useLayoutEffect(() => {
    if (!open) { setUp(false); return; }
    const rect = list.current?.getBoundingClientRect();
    if (!rect) return;
    // The fixed status bar owns the foot of the viewport; a menu under it is
    // as unreadable as one off-screen.
    const bar = document.querySelector('.status-bar')?.getBoundingClientRect();
    const floor = bar && bar.top > 0 ? bar.top : window.innerHeight;
    setUp(rect.bottom > floor - 8 && rect.top > rect.height + 8);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !list.current) return;
    list.current.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);

  const onButtonKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(enabled[0]?.index ?? 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(enabled[enabled.length - 1]?.index ?? 0);
    }
  };

  const onMenuKey = (event: React.KeyboardEvent): void => {
    const position = enabled.findIndex(({ index }) => index === active);
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') { setOpen(false); }
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(enabled[(position + 1) % enabled.length]?.index ?? 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(enabled[(position - 1 + enabled.length) % enabled.length]?.index ?? 0);
    } else if (event.key === 'Home') { event.preventDefault(); setActive(enabled[0]?.index ?? 0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(enabled[enabled.length - 1]?.index ?? 0); }
  };

  const choose = (item: MenuItem): void => {
    if (item.disabled) return;
    close();
    item.onSelect();
  };

  const ordered = [...items].sort((a, b) => Number(Boolean(a.danger)) - Number(Boolean(b.danger)));

  return (
    <div className={`overflow${up ? ' up' : ''}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={`overflow-button ${size}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : openAt(enabled[0]?.index ?? 0))}
        onKeyDown={onButtonKey}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <ul id={id} className="overflow-menu" role="menu" aria-label={label} ref={list} onKeyDown={onMenuKey}>
          {ordered.map((item) => {
            const index = items.indexOf(item);
            const Icon = item.icon;
            return (
              <li key={item.label} role="none" className={item.danger ? 'danger' : ''}>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={index === active ? 0 : -1}
                  aria-disabled={item.disabled || undefined}
                  className={item.danger ? 'danger' : ''}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden="true" />}
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
