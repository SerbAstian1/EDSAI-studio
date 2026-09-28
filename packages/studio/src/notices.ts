/**
 * The last write that worked, and the one place that says so.
 *
 * A sibling of `failures.ts`, deliberately not an extension of it. That module
 * is about writes that *did not happen*, and its contract is that it never
 * disappears on its own — a message that removes itself is a message the person
 * who stepped away never sees. Both of those are right for a failure and wrong
 * for a confirmation: "Onboarding deleted — you can now start a fresh one" is
 * only useful while it is on screen, and a stale confirmation sitting under a
 * header for a minute is worse than none. Folding success into the failure store
 * would mean one store with two contradictory lifecycles, so this is a second
 * store with the one lifecycle that fits.
 *
 * A module-level store for the same reason `failures.ts` is one: the `QueryClient`
 * is built outside React and its callbacks run outside the tree, so
 * `useSyncExternalStore` is the supported way to read this back in.
 */

export interface Notice {
  message: string;
  /**
   * Distinguishes two identical messages in a row, so the banner re-shows.
   *
   * A counter rather than a timestamp. `Date.now()` has millisecond resolution
   * and two identical notices can genuinely arrive inside one millisecond — a
   * double-clicked delete, or the same failure reported by two mutations at
   * once — in which case a timestamp marker is unchanged and the banner renders
   * identically to the one already on screen, which reads as though the second
   * one never happened. A counter cannot collide.
   */
  at: number;
}

/** How long a confirmation stays before it clears itself. */
export const NOTICE_MS = 4_000;

let current: Notice | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function reportNotice(message: string): void {
  sequence += 1;
  current = { message, at: sequence };
  emit();
  // Cleared and re-armed rather than accumulating, so a second confirmation
  // arriving while the first is still up restarts the clock instead of being
  // cut short by the first one's timer.
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    current = undefined;
    emit();
  }, NOTICE_MS);
}

export function clearNotice(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  current = undefined;
  emit();
}

export function subscribeToNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function currentNotice(): Notice | undefined {
  return current;
}
