import { useCallback, useState } from 'react';

/**
 * Which projects this browser starred.
 *
 * Per-viewer, not per-studio: there is no server record for it, and there
 * should not be one — it is a personal shortlist, the same kind of thing a
 * browser bookmark already is. `localStorage` can throw or come back empty in
 * a private window, so every access is guarded and a blocked store just means
 * nothing is starred yet rather than a broken screen.
 */

const KEY = 'edsai.bookmarks';

function readAll(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeAll(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // A blocked store means this session's stars do not persist. Nothing to
    // recover from — the toggle still works for the rest of this visit.
  }
}

export function useBookmarks(): { has: (id: string) => boolean; toggle: (id: string) => void } {
  const [ids, setIds] = useState<Set<string>>(readAll);

  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeAll(next);
      return next;
    });
  }, []);

  return { has: (id: string) => ids.has(id), toggle };
}
