/**
 * Light or dark, as a person's choice rather than only the OS's.
 *
 * The stylesheet already had a full dark palette behind
 * `prefers-color-scheme`; what it lacked was any way to disagree with the
 * operating system. Setting `data-theme` on the root is the whole
 * mechanism — the CSS answers to it ahead of the media query — and the
 * choice is kept in `localStorage`, which is exactly the per-viewer
 * convenience that storage is for. With no choice recorded, the OS decides,
 * as before; "system" here means "remove the attribute and stand back".
 *
 * Applied before React renders (see `main.tsx`) so the first paint is
 * already the chosen theme rather than a flash of the other one.
 */

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

const KEY = 'edsai.theme';
const listeners = new Set<() => void>();

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** What is actually showing right now, whichever of the three ways decided it. */
export function currentTheme(): Theme {
  const choice = stored();
  if (choice !== 'system') return choice;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function themeChoice(): ThemeChoice {
  return stored();
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage unavailable (private window, blocked): the attribute still
    // applies for this visit, it just will not be remembered.
  }
  apply(choice);
  for (const listener of listeners) listener();
}

/** Run once at startup, before the first render. */
export function applyStoredTheme(): void {
  apply(stored());
  // A person on "system" should see the OS change take effect live.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (stored() === 'system') for (const listener of listeners) listener();
  });
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
