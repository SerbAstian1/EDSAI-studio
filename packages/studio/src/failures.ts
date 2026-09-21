/**
 * The last write that failed, and the one place that reports it.
 *
 * Most mutations in this app rendered their own `.error` and a good number
 * did not, which made failure a property of *which screen you happened to
 * be on* rather than of the product. A revoked portal link that 403s, an
 * approval that never reached the server, a status that snapped back — each
 * looked exactly like success. This is the floor under all of them: every
 * mutation error lands here, and the banner says so even when the screen
 * that fired it says nothing.
 *
 * A module-level store rather than context, because the `QueryClient` is
 * built outside React and its `MutationCache` callbacks run outside the
 * tree — `useSyncExternalStore` is the supported way to read it back in.
 */

export interface Failure {
  message: string;
  /** Distinguishes two identical messages in a row, so the banner re-shows. */
  at: number;
}

let current: Failure | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function reportFailure(message: string): void {
  current = { message, at: Date.now() };
  emit();
}

export function clearFailure(): void {
  current = undefined;
  emit();
}

export function subscribeToFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function currentFailure(): Failure | undefined {
  return current;
}
