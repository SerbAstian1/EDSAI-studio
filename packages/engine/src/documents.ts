import { z } from 'zod';

/**
 * The documents every engagement has.
 *
 * A deliverable is one named thing among many; these are the eight a
 * client always gets, in the same places, on the same shelf: the proposal,
 * the contract and the invoice on the commercial side; the strategy, the two
 * speed-run presentations, the final presentation and the guidelines on the
 * brand side. Fixed slots rather than a list, because a client should find
 * "the contract" where it always is, not search a list for it.
 *
 * Each slot holds a Figma file and is previewed in place — here and in the
 * client's portal — instead of sending anyone off to Figma to look.
 */

export const DOCUMENT_SLOTS = [
  { id: 'proposal', label: 'Proposal', group: 'commercial' },
  { id: 'contract', label: 'Contract', group: 'commercial' },
  { id: 'invoice', label: 'Invoice', group: 'commercial' },
  { id: 'brand-strategy', label: 'Brand strategy', group: 'brand' },
  { id: 'speed-run-1', label: 'Speed run presentation 1', group: 'brand' },
  { id: 'speed-run-2', label: 'Speed run presentation 2', group: 'brand' },
  { id: 'final-presentation', label: 'Final brand presentation', group: 'brand' },
  { id: 'brand-guidelines', label: 'Figma brand guidelines', group: 'brand' },
] as const;

export type DocumentSlot = typeof DOCUMENT_SLOTS[number]['id'];
export const DocumentSlotId = z.enum(
  DOCUMENT_SLOTS.map((s) => s.id) as [DocumentSlot, ...DocumentSlot[]],
);

export function isDocumentSlot(value: string): value is DocumentSlot {
  return DOCUMENT_SLOTS.some((s) => s.id === value);
}

export const ClientDocument = z.object({
  clientId: z.string().min(1),
  slot: DocumentSlotId,
  /** Checked to be figma.com before it is stored, and again before it is framed. */
  figmaUrl: z.string().min(1),
  /** A note the studio leaves beside it: "v2, after the March review". */
  note: z.string().optional(),
  updatedAt: z.string(),
});
export type ClientDocument = z.infer<typeof ClientDocument>;

/* ------------------------------------------------------- the documents list */

/**
 * Where a document comes from.
 *
 * A code-defined list, like the tool registry and for the same reason: a new
 * source is a release, because every source has to bring a way to render or
 * refuse itself. What is stored is the plain string, so adding one is a
 * migration-light change rather than a rewrite of every row.
 */
export const DOCUMENT_SOURCES = ['upload', 'figma'] as const;
export const DocumentSource = z.enum(DOCUMENT_SOURCES);
export type DocumentSource = z.infer<typeof DocumentSource>;

/**
 * How a document is read.
 *
 * The distinction that matters is the first two. A proposal and a brand
 * presentation are both "a deck", and treating them the same is what produces
 * an infinite scroll through eighteen pages with a Figma zoom bar on top. A
 * client who opens a deck expects a deck.
 */
export const DOCUMENT_VIEW_MODES = ['document', 'presentation', 'external'] as const;
export const DocumentViewMode = z.enum(DOCUMENT_VIEW_MODES);
export type DocumentViewMode = z.infer<typeof DocumentViewMode>;

export const DOCUMENT_STATUSES = ['draft', 'ready', 'archived'] as const;
export const DocumentStatus = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

/**
 * A document somebody added to a client's library.
 *
 * **A sibling of the eight, not a replacement for them.** The slots are a
 * fixed shelf every engagement has and nothing anywhere creates a ninth; this
 * is how a tenth, a proposal that changed, or a spec that was never a slot gets
 * in. Both appear in the same section, in the same card system, under the same
 * permissions, and both open in the same viewer.
 *
 * **An uploaded document is a pointer, not a copy.** The bytes are an `Asset`,
 * stored and served by the machinery that already serves every other file a
 * client downloads, with the same approval, the same size limit and the same
 * isolation. What this row adds is the things an asset does not know: what the
 * document is called, how it should be read, and where it came from.
 */
export const ClientDocumentEntry = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(600).optional(),
  /** Coarse: proposal, guideline, presentation, reference. Drives the icon. */
  documentType: z.string().min(1).max(40).default('document'),
  source: DocumentSource,
  /** The uploaded file, for `upload`. Never for a Figma document. */
  assetId: z.string().min(1).optional(),
  /** The Figma link exactly as it was pasted, for `figma`. */
  sourceUrl: z.string().min(1).optional(),
  /**
   * The file key out of `sourceUrl`, kept rather than re-parsed on every read.
   *
   * Reading it on demand was fine while the only consumer was the embedder,
   * which is handed a URL. Frame discovery is an API call and an API call needs
   * a key, so the one fact every read needs is now stored with the row that
   * already holds the link it came from. Derived, never accepted from a caller:
   * a stored key that disagreed with the stored URL would send Figma's API a
   * file this document does not actually point at.
   */
  figmaFileKey: z.string().min(1).optional(),
  /**
   * The canvas (`figmaPageId`) the link named, when it named one.
   *
   * A deep link to a Figma page carries that page's own node id, which is what
   * keeps a deck on `Brand Presentation` from being read as the working pages on
   * `Page 1` as well.
   */
  figmaPageId: z.string().regex(/^\d+-\d+$/).optional(),
  /** A cover image, when one has been chosen. */
  thumbnailAssetId: z.string().min(1).optional(),
  viewMode: DocumentViewMode.default('document'),
  status: DocumentStatus.default('ready'),
  /** Known only for Figma manifests; absent where the source cannot say. */
  pageCount: z.number().int().nonnegative().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientDocumentEntry = z.infer<typeof ClientDocumentEntry>;

/**
 * One page of a presentation, as a Figma frame.
 *
 * **A page is a frame somebody decided is a page.** Not every frame in a file is
 * one: a designer keeps scratch frames, an archive and the three abandoned
 * directions on the same canvas as the eight slides that shipped, and only the
 * designer knows which eight. So `included` is part of the record rather than a
 * filter applied on the way to the viewer — an excluded frame is still here,
 * still named, still ordered, and comes back if it is wanted again. That is
 * also why `included` defaults to `true`: a manifest written before this field
 * existed was a designer listing the pages they meant, all of them.
 *
 * The frames are *discovered*, from the file rather than typed in — see
 * `figma-frames.ts` — and the manifest is what discovery is merged into. A
 * page is addressed by `nodeId`, which is Figma's own deep-link parameter and
 * not a scrape of anything.
 */
export const DocumentPage = z.object({
  documentId: z.string().min(1),
  /** 1-based, and the only ordering that means anything. */
  order: z.number().int().positive(),
  name: z.string().min(1).max(120),
  /** A Figma node id, `12-345`. Absent means "the file as a whole". */
  nodeId: z.string().regex(/^\d+-\d+$/).optional(),
  /** Whether this frame is a page of this document. False is kept, not dropped. */
  included: z.boolean().default(true),
  /**
   * The frame's size in Figma pixels, as last discovered.
   *
   * Two reasons this is stored rather than measured in the browser: "fit this
   * page" needs the frame's aspect ratio before the frame has loaded, or the
   * stage is sized wrong and then snaps; and a page opened from a link, with no
   * refresh in sight, still fits correctly.
   */
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  /**
   * A rendered preview of the frame, where one has been fetched.
   *
   * A short-lived Figma URL rather than an asset of ours: it is a cache
   * reference, good until it expires, and losing it costs a thumbnail and
   * nothing else — the page overview falls back to the frame's name.
   */
  thumbnailUrl: z.string().min(1).optional(),
});
export type DocumentPage = z.infer<typeof DocumentPage>;


/**
 * A document's pages, in order.
 *
 * Always a list, never undefined: a presentation with one page and a
 * presentation with none are the same viewer with different controls, and
 * deciding that in one place is what keeps the controls honest.
 */
export function orderedPages(pages: readonly DocumentPage[]): DocumentPage[] {
  return [...pages].sort((a, b) => a.order - b.order);
}

/**
 * The pages a reader actually gets: ordered, and only the included ones.
 *
 * **The one list the viewer navigates.** Not `orderedPages`, because an excluded
 * frame is a real page of the record and must not be one of the deck — page 3 of
 * 6 with three excluded frames in between is a deck where Next skips slides and
 * the counter lies. Every boundary decision in the viewer is made against this,
 * so there is a single definition of "which page am I on".
 */
export function includedPages(pages: readonly DocumentPage[]): DocumentPage[] {
  return orderedPages(pages).filter((page) => page.included);
}

/**
 * Turn a list somebody arranged into a manifest.
 *
 * **The array is the order, and the numbers are regenerated.** A designer
 * reorders pages by dragging, so the sequence they sent is the intent and the
 * `order` on each row is a detail of how it was last stored. Writing `1..n`
 * back is what makes "page four" mean something, and it means a studio that
 * reversed two rows has said what it meant rather than sent a broken manifest.
 *
 * A manifest with two rows both claiming to be page four cannot be expressed
 * here, and that is deliberate: this is where the ambiguity is resolved, and a
 * request that arrives with duplicate orders elsewhere is refused rather than
 * quietly sorted into something the sender did not ask for.
 *
 * **Discovery is folded in here rather than after it.** A frame found by
 * `figma-frames.ts` arrives with its `included` flag, its size and its
 * thumbnail, and a caller that dropped them on the floor would get a page list
 * that navigates correctly and then shows no preview and refuses to fit — so the
 * same rule that regenerates the numbers preserves everything else it was given.
 */
export function manifestFrom(
  documentId: string,
  pages: readonly {
    name: string;
    nodeId?: string | undefined;
    included?: boolean | undefined;
    width?: number | undefined;
    height?: number | undefined;
    thumbnailUrl?: string | undefined;
  }[],
): DocumentPage[] {
  return pages.map((page, index) => DocumentPage.parse({
    documentId, order: index + 1, name: page.name,
    ...(page.nodeId ? { nodeId: page.nodeId } : {}),
    ...(page.included === undefined ? {} : { included: page.included }),
    ...(page.width === undefined ? {} : { width: page.width }),
    ...(page.height === undefined ? {} : { height: page.height }),
    ...(page.thumbnailUrl ? { thumbnailUrl: page.thumbnailUrl } : {}),
  }));
}
