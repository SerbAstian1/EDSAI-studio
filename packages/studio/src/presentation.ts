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

/* ───────────────────────────────────────────────────────── frame geometry */

/**
 * Reading a Figma file is the *other* half of not giving the designer Figma's
 * canvas.
 *
 * Figma decides what a file contains; EDSAI decides which of it is the
 * document. A frame is a frame in a file whether or not it is a slide, so
 * `included` is the decision, and it is kept on the page rather than applied by
 * deleting it: excluding a section from a deck is a thing a designer undoes,
 * and it is also the thing a presenter needs to be able to open in Figma
 * afterwards. Everything below reads the *readable* deck, not the manifest.
 */
export function readablePages(pages: readonly DocumentPage[]): DocumentPage[] {
  return orderedPages(pages).filter((page) => page.included !== false);
}

/**
 * The deck, with a deck's page count.
 *
 * `pageCount` on the entry is the count of *everything* in the file, so it is
 * the wrong number to put in a counter over a deck that has excluded half of
 * it — `04 / 18` for a six-slide presentation is a lie told to a client.
 */
export function deckCount(pages: readonly DocumentPage[]): number {
  return readablePages(pages).length;
}

/** A size in CSS pixels. */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * The aspect ratio of a frame.
 *
 * **A documented fallback rather than a division by zero.** Every frame read
 * from Figma has a size, but a manifest typed by hand or written by an older
 * version of this code may not, and `NaN` in a `width` is a stage that stays
 * blank. A 16:9 assumption is wrong for some decks and still draws every one of
 * them, which is strictly better than drawing none.
 *
 * Takes a partial because a `DocumentPage` has optional dimensions, and this is
 * the one function that is asked about pages as often as about boxes.
 */
export const FALLBACK_RATIO = 16 / 9;

export function frameRatio(frame: { width?: number | undefined; height?: number | undefined }): number {
  const { width, height } = frame;
  if (width === undefined || height === undefined) return FALLBACK_RATIO;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return FALLBACK_RATIO;
  return width > 0 && height > 0 ? width / height : FALLBACK_RATIO;
}

/** How a frame is fitted into the space available for it. */
export type FitMode =
  /** The whole frame, height and width, with whatever is left over around it. */
  | 'page'
  /** As wide as the space allows, scrolling down for the rest. */
  | 'width'
  /** One screen pixel per Figma pixel. */
  | 'actual';

/**
 * The size a frame is *drawn* at, for a fit mode.
 *
 * **An iframe, not a scale.** Figma's embed fits whatever node it is given to
 * whatever box it has been given, so the way to show a frame at 74% is to hand
 * it an iframe 74% of the frame's size — there is no transform in this, and
 * therefore no blurred text and no scaled hit targets. `fit-width` is
 * deliberately allowed to exceed the stage's height: scrolling *within* a page
 * is a thing a designer needs to read a dense frame, and scrolling *between*
 * pages is the thing this viewer refuses to do.
 */
export function fitSize(mode: FitMode, frame: FrameSize, stage: FrameSize): FrameSize {
  const ratio = frameRatio(frame);
  const known = frame.width > 0 && frame.height > 0;
  if (mode === 'actual' && known) return { width: frame.width, height: frame.height };
  if (mode === 'width') {
    return { width: Math.max(1, stage.width), height: Math.max(1, Math.round(stage.width / ratio)) };
  }
  const width = Math.max(1, Math.min(stage.width, Math.round(stage.height * ratio)));
  return { width, height: Math.max(1, Math.round(width / ratio)) };
}

/** The furthest a frame can be zoomed, in either direction. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** One notch of the zoom control: a quarter bigger or a quarter smaller. */
export const ZOOM_STEP = 1.25;

/**
 * A scale inside the permitted range, and not a float.
 *
 * Snapped to hundredths on purpose: the scale is *displayed* (`74%`), and
 * `0.7500000000000001` in a label is the kind of detail that makes a tool feel
 * like it is not quite finished. Clamped rather than wrapped, so pressing `+`
 * at 400% holds at 400% instead of snapping back to 10%.
 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
}

/** The scale one notch up or down from here. */
export function zoomedScale(scale: number, direction: 1 | -1): number {
  return clampScale(clampScale(scale) * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP));
}

/**
 * The zoom readout, which is the *frame's own* size being fractioned.
 *
 * So `100%` is one Figma pixel per screen pixel rather than an arbitrary
 * middle, and the number a designer sees is comparable to the number they see in
 * Figma's own zoom bar.
 */
export function scaleLabel(drawn: FrameSize, frame: FrameSize): string {
  if (frame.width <= 0 || frame.height <= 0) return 'Fit';
  return `${Math.round((drawn.width / frame.width) * 100)}%`;
}
