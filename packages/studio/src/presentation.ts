import type { DocumentEntry, DocumentPage, DocumentViewMode } from './api.js';

/**
 * Reading a presentation one page at a time.
 *
 * **The rule this file exists to enforce.** A deck is not a long document. The
 * failure the spec names is an eighteen-page brand presentation opening as one
 * infinite Figma canvas with a zoom bar on top, and the fix is not styling —
 * it is that only one page is mounted, the controls know the boundaries, and
 * the index is clamped to a manifest that may have changed underneath.
 *
 * Everything here is pure and takes the page list as an argument rather than
 * reading it from state, so the decisions that can be wrong — an index past the
 * end, a control pointing at nothing, a counter that says 4 of 0 — are made in
 * one testable place instead of inside a component.
 */

/** How many pages there are, which is never negative and never undefined. */
export function pageCount(pages: readonly DocumentPage[]): number {
  return Math.max(0, pages.length);
}

/** The page list in the order the manifest means, always a copy. */
export function orderedPages(pages: readonly DocumentPage[]): DocumentPage[] {
  return [...pages].sort((a, b) => a.order - b.order);
}

/**
 * An index that is definitely on a page of this manifest.
 *
 * Clamping in both directions is what makes a shrinking manifest survivable: a
 * document that had six pages and now has three, opened from a stale link or a
 * browser refresh mid-deck, lands on the last page rather than on nothing.
 */
export function clampIndex(index: number, pages: readonly DocumentPage[]): number {
  const total = pageCount(pages);
  if (total === 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(total - 1, Math.max(0, Math.floor(index)));
}

/** Whether there is a page before this one, and so whether Previous is live. */
export function hasPrevious(pages: readonly DocumentPage[], index: number): boolean {
  return clampIndex(index, pages) > 0;
}

/** Whether there is a page after this one, and so whether Next is live. */
export function hasNext(pages: readonly DocumentPage[], index: number): boolean {
  return clampIndex(index, pages) < pageCount(pages) - 1;
}

/** The index one page forward, or the same index at the end of the deck. */
export function nextIndex(pages: readonly DocumentPage[], index: number): number {
  return hasNext(pages, index) ? clampIndex(index, pages) + 1 : clampIndex(index, pages);
}

/** The index one page back, or the same index at the start of the deck. */
export function previousIndex(pages: readonly DocumentPage[], index: number): number {
  return hasPrevious(pages, index) ? clampIndex(index, pages) - 1 : clampIndex(index, pages);
}

/** Whether a deck is a deck: more than one page, or a presentation with one. */
export function isMultiPage(pages: readonly DocumentPage[]): boolean {
  return pageCount(pages) > 0;
}

/**
 * The counter a reader sees: `04 / 18`.
 *
 * Zero-padded to two digits because these decks are numbered in Figma by the
 * designer and `4 / 18` reading as a different number from `04` is the kind of
 * small wrongness that makes people stop trusting a document. A deck with no
 * pages has no counter, and the viewer shows the file rather than `01 / 00`.
 */
export function pageLabel(pages: readonly DocumentPage[], index: number): string {
  const total = pageCount(pages);
  if (total === 0) return '';
  const current = clampIndex(index, pages) + 1;
  return `${String(current).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
}

/** The name of the page being shown, for the accessible label on the frame. */
export function pageName(pages: readonly DocumentPage[], index: number): string {
  return orderedPages(pages)[clampIndex(index, pages)]?.name ?? '';
}

/**
 * The three pages worth having in the DOM: the one before, this one, the one
 * after.
 *
 * **Why neighbours and not neighbours-and-a-bit.** Browsing back through a deck
 * should not wait for a frame that was never asked for, but pressing Previous
 * twice should not wait either. One either side covers every single-step
 * interaction, and the viewer still only ever *mounts* the current page — the
 * neighbours exist as prefetch hints, not as iframes kept alive.
 */
export function preloadWindow(pages: readonly DocumentPage[], index: number): DocumentPage[] {
  const ordered = orderedPages(pages);
  const at = clampIndex(index, ordered);
  return [ordered[at - 1], ordered[at], ordered[at + 1]].filter((p): p is DocumentPage => p !== undefined);
}

/**
 * How a document should be read.
 *
 * **The stored mode wins, with one exception.** A document marked
 * `presentation` is a presentation even before its manifest is written — a
 * designer records a deck's pages once and a deck with no pages recorded yet
 * should still open as a deck rather than as an infinite canvas. The exception
 * is a document that cannot be rendered here at all, which falls back to
 * `external` rather than pretending.
 */
export function resolveViewMode(
  entry: Pick<DocumentEntry, 'viewMode' | 'source' | 'pageCount'>,
  pages: readonly DocumentPage[],
): DocumentViewMode {
  if (entry.viewMode === 'external') return 'external';
  if (entry.viewMode === 'presentation') return 'presentation';
  // A Figma document with a manifest is a deck whichever way the row was
  // labelled, because the manifest is the evidence.
  if (entry.source === 'figma' && pageCount(pages) > 0) return 'presentation';
  return entry.viewMode;
}

/**
 * Whether a document can be shown by EDSAI at all.
 *
 * An upload is only viewable when it is something a browser draws. Claiming to
 * preview a format nothing here can render is how a document opens onto a blank
 * rectangle, so anything unrecognised goes to `external` and the viewer offers
 * the file instead.
 */
const VIEWABLE_UPLOAD = /^(image\/|application\/pdf$|text\/)/;

/** What an uploaded document's file can be shown as, or `external`. */
export function uploadViewMode(asset: { contentType: string } | undefined): DocumentViewMode {
  if (!asset) return 'external';
  return VIEWABLE_UPLOAD.test(asset.contentType) ? 'document' : 'external';
}
