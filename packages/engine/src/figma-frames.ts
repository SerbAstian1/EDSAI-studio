import { z } from 'zod';
import { DocumentPage } from './documents.js';
import { NODE_ID, toNodeId } from './figma-source.js';

/**
 * A Figma file's frames, normalized into the pages of a document.
 *
 * **Why this exists.** `figma-source.ts` reads a *link*: it answers "which file,
 * which frame". This answers the question behind it: "which frames are in this
 * file, and in what order do they get read". That needs the file's structure
 * rather than its address bar, so it needs the REST API — which is server-side,
 * credentialed, and in `figma-client.ts`. What is here is everything *after*
 * that: the part that decides what counts as a page, what order the pages go
 * in, and what happens when the designer goes back to Figma and adds one.
 *
 * **The rule this file exists to enforce.** A Figma file is
 * `FILE → CANVAS → children`, and only some children are pages. A brand
 * presentation on a canvas named "Brand Presentation" is eight top-level
 * frames; it is *not* eight hundred frames, because every one of those eight
 * contains component instances, and each of those contains a text node. Turning
 * the whole tree into a manifest is how a deck becomes an infinite canvas with a
 * page counter on top. So only top-level containers are pages, and the two
 * things that would inflate the list — nested nodes and invisible nodes — are
 * refused here rather than filtered by whoever calls this.
 *
 * **The other rule: order is decided, never inherited.** Figma returns a
 * file's children in an order that is stable but is not *reading* order, and a
 * designer's "01 — Cover" is a name rather than a guarantee. So order comes from
 * where the frame sits on the canvas, which is the thing the designer actually
 * arranged: top to bottom, then left to right within a band. A number in the
 * name is a tiebreaker inside a band and nothing more, so an unnumbered deck
 * ("Cover", "Introduction", "Strategy") still comes out in the order it was
 * built.
 */

/**
 * One top-level frame, as EDSAI understands it.
 *
 * Deliberately the same shape a page is stored as, plus what only discovery can
 * know: the canvas it came from, its pixel size, and a thumbnail. The width and
 * height are what lets "fit this page" be arithmetic instead of a guess — the
 * viewer is told the frame is 1920×1080 and sizes its stage accordingly, rather
 * than waiting for an iframe to report its own content size.
 */
export const FigmaFrame = z.object({
  /** Figma's node id, `12-345`. The one field a page cannot be built without. */
  nodeId: z.string().regex(NODE_ID),
  /** Figma's own name for the frame, verbatim. */
  name: z.string().min(1),
  /** The canvas (Figma page) the frame sits on. `0-1` is Figma's first page. */
  canvasId: z.string().regex(NODE_ID).default('0-1'),
  /** The canvas's name, so a designer can see which page it came from. */
  canvasName: z.string().default(''),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  /** Position on the canvas, which is what the reading order is derived from. */
  x: z.number().default(0),
  y: z.number().default(0),
  /**
   * A rendered preview, where one was fetched.
   *
   * Figma hands these back as short-lived signed URLs, so this is a cache
   * reference rather than an asset: it is good for the session it was fetched
   * in, and a refresh fetches a new one. That is why nothing about a document
   * breaks when it expires — the viewer falls back to the frame's name.
   */
  thumbnailUrl: z.string().min(1).optional(),
});
export type FigmaFrame = z.infer<typeof FigmaFrame>;

/**
 * Node types that are a page of a document.
 *
 * `FRAME` is the ordinary case and `COMPONENT`/`COMPONENT_SET` are included
 * because a designer who has set a slide up as a component is still showing a
 * slide. `SECTION` is Figma's own container for grouping frames on one canvas
 * and reading as a chapter rather than a page. Everything else — `GROUP`,
 * `TEXT`, `VECTOR`, `INSTANCE`, `BOOLEAN_OPERATION` — is either not a page or
 * is an instance of one, and an instance of page three is emphatically not page
 * three again.
 */
const PAGE_NODES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION']);

/** A raw Figma node, only as much of one as this file reads. */
interface RawNode {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  visible?: unknown;
  absoluteBoundingBox?: { width?: unknown; height?: unknown; x?: unknown; y?: unknown } | null;
  children?: RawNode[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value)
  ? value : undefined);

/** A frame's true size, falling back to nothing rather than to a guess. */
function boundsOf(node: RawNode): { width: number; height: number; x: number; y: number } | undefined {
  const box = node.absoluteBoundingBox;
  if (!box) return undefined;
  const width = num(box.width);
  const height = num(box.height);
  if (width === undefined || height === undefined) return undefined;
  return { width, height, x: num(box.x) ?? 0, y: num(box.y) ?? 0 };
}

/** What to read out of a file, and what to leave alone. */
export interface DiscoverOptions {
  /**
   * Restrict to one canvas, when the link named one.
   *
   * A deep link to a Figma *page* is `?node-id=12-345` where that id is the
   * canvas itself, not a frame inside it. A brand file routinely has working
   * pages on `Page 1` and the deck on `Brand Presentation`, and a document
   * pointed at the second must not open as the first one's frames plus the
   * second's. Absent means every canvas, which is the right answer for a link
   * that names no canvas — the frames panel is then how a designer says which
   * of them belong in the document.
   *
   * Accepted in either spelling: a link arrives dash-form from a URL, but a
   * caller that has just read the file may hold the API's colon-form.
   */
  canvasId?: string;
}

/**
 * Every top-level frame in a Figma file, in reading order.
 *
 * Takes the parsed `/v1/files/:key` body — the `document` node and nothing else
 * — because that is the one call that returns structure for every canvas at
 * once, and the one whose shape is stable. Returns `[]` for a body it cannot
 * read rather than throwing: a file with no frames in it is a real answer, and
 * a caller that has to distinguish "no frames" from "the response was not what I
 * expected" can look at the call that produced it.
 */
export function discoverFrames(file: unknown, options: DiscoverOptions = {}): FigmaFrame[] {
  const root = isRecord(file) ? file : undefined;
  const document = root && isRecord(root['document']) ? root['document'] : undefined;
  const canvases = document && Array.isArray(document['children']) ? document['children'] : undefined;
  if (!canvases) return [];
  const wanted = toNodeId(options.canvasId);

  const frames: FigmaFrame[] = [];
  for (const canvas of canvases as RawNode[]) {
    if (!isRecord(canvas)) continue;
    // `0-1` is Figma's first page in every file, so it is the only fallback that
    // can be right often enough to be useful.
    const canvasId = toNodeId(canvas.id) ?? '0-1';
    if (wanted !== undefined && canvasId !== wanted) continue;
    const canvasName = typeof canvas.name === 'string' ? canvas.name : '';
    const children = Array.isArray(canvas.children) ? (canvas.children as RawNode[]) : [];
    for (const node of children) {
      if (!isRecord(node)) continue;
      // Only the top level of a canvas. This is the line that keeps a component
      // inside a slide from becoming a page of the deck, and it is the whole
      // reason this walks one level and no deeper.
      if (typeof node.type !== 'string' || !PAGE_NODES.has(node.type)) continue;
      // A hidden frame is one the designer has taken off the canvas. It is still
      // in the file and still returned by the API, so it is not discoverable by
      // its absence — it has to be excluded here, or a template frame reappears
      // in every document built from it.
      if (node.visible === false) continue;
      const nodeId = toNodeId(node.id);
      if (nodeId === undefined) continue;
      const name = typeof node.name === 'string' && node.name.trim() !== '' ? node.name : nodeId;
      const box = boundsOf(node);
      if (!box) continue;
      frames.push(FigmaFrame.parse({
        nodeId, name, canvasId, canvasName, ...box,
      }));
    }
  }
  return inReadingOrder(frames);
}

/**
 * Just the frames on one canvas, in the order they were already discovered.
 *
 * **A filter, not a re-read.** Distinguishing "this link points at a Figma
 * *page*" from "this link points at a *frame* on a page" is a question about
 * the file, so it is answered after the file has been read — a deep link into a
 * deck names a slide, and restricting the document to that one slide because the
 * link happened to point at it would turn a brand presentation into page one.
 * Already ordered, so this returns a list a caller can page through directly.
 */
export function framesOnCanvas(frames: readonly FigmaFrame[], canvasId: string): FigmaFrame[] {
  const wanted = toNodeId(canvasId);
  if (wanted === undefined) return [];
  return frames.filter((frame) => frame.canvasId === wanted);
}

/**
 * The number a designer put in a frame's name, if they put one there.
 *
 * `01 — Cover`, `1. Typography`, `03: Colors` and `Chapter 2 — Strategy` all
 * answer the same question. Only ever a tiebreaker: see `inReadingOrder`.
 */
export function ordinalHint(name: string): number | undefined {
  const match = /^\s*(\d{1,4})\s*[.)\-–—:·|]?\s+/.exec(name) ?? /^\s*(\d{1,4})\s*$/.exec(name);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * How far apart two frames have to be vertically before they are "different
 * rows" rather than the same one.
 *
 * Half the shorter frame's height is the only tolerance available without
 * knowing what a frame is for, and it is the right one for a deck: a slide with
 * a stray element hanging below it is still that slide, while the next slide
 * down is a full slide away. Expressed as a fraction rather than a constant
 * because frame sizes here are 1920×1080 and 390×844 and neither is special.
 */
const ROW_TOLERANCE = 0.5;

/**
 * Reading order for frames laid out on a canvas.
 *
 * **Top to bottom, then left to right within a band.** This is the convention a
 * document built on a Figma canvas actually uses — a vertical strip of slides,
 * a horizontal row of slides, or a grid of them — and it is the only ordering
 * available that is derived from something the designer arranged rather than
 * from something they typed. An ordinal in the name breaks ties *inside* a band
 * and never reorders across one, so `Cover` above `Strategy` stays above it
 * whatever they are called, and a deck with no numbers at all still sorts into
 * the order it was built.
 *
 * Total and deterministic: two runs over the same frames produce the same
 * order, and frames that agree on every key fall back to their node id, so an
 * input order that happens to differ cannot leak through. That is the
 * difference between a document and a shuffle.
 */
export function inReadingOrder(frames: readonly FigmaFrame[]): FigmaFrame[] {
  const banded = [...frames]
    .sort((a, b) => (a.y - b.y) || (a.x - b.x) || compareNodeId(a.nodeId, b.nodeId));

  const rows: { top: number; height: number; frames: FigmaFrame[] }[] = [];
  for (const frame of banded) {
    // The band this frame belongs to, which is the last one whose row still
    // overlaps it vertically. A deck laid out in one column has exactly one.
    const row = [...rows].reverse().find((candidate) =>
      overlap(frame.y, frame.height, candidate.top, candidate.height));
    if (!row) {
      rows.push({ top: frame.y, height: frame.height, frames: [frame] });
      continue;
    }
    row.frames.push(frame);
    // Grow the band rather than move it: a band is an envelope, and a frame
    // below the current one still belongs to it if their boxes touch.
    row.top = Math.min(row.top, frame.y);
    row.height = Math.max(row.height, frame.height + (frame.y - row.top));
  }

  return rows
    .flatMap((row) => row.frames.sort((a, b) => {
      const hintA = ordinalHint(a.name);
      const hintB = ordinalHint(b.name);
      // Two numbers in the name inside one row: that is a numbered strip, and
      // the numbers are the intent. One number and one blank, or two blanks:
      // positions, which is the only evidence left.
      if (hintA !== undefined && hintB !== undefined && hintA !== hintB) return hintA - hintB;
      return (a.x - b.x) || (a.y - b.y) || compareNodeId(a.nodeId, b.nodeId);
    }));
}

/** Whether two vertical spans overlap by more than half the shorter one. */
function overlap(aTop: number, aHeight: number, bTop: number, bHeight: number): boolean {
  const start = Math.max(aTop, bTop);
  const end = Math.min(aTop + aHeight, bTop + bHeight);
  const shorter = Math.min(aHeight, bHeight);
  if (!(end > start)) return false;
  return end - start > shorter * ROW_TOLERANCE;
}

/** Numeric node-id comparison, so `2-9` sorts before `12-0` rather than after. */
function compareNodeId(a: string, b: string): number {
  const [aPage = '0', aNode = '0'] = a.split('-');
  const [bPage = '0', bNode = '0'] = b.split('-');
  const page = Number(aPage) - Number(bPage);
  if (page !== 0) return page;
  const node = Number(aNode) - Number(bNode);
  return node !== 0 ? node : a.localeCompare(b);
}

/* --------------------------------------------------------------- refreshing */

/**
 * What changed when a document's frames were re-read from Figma.
 *
 * Returned alongside the new manifest so the studio can *say* what it did
 * rather than silently rearranging a document somebody was halfway through. A
 * refresh that removes three pages is worth knowing about; one that happens
 * silently reads as data loss.
 */
export interface FrameChanges {
  /** Frames in the file that the manifest did not have. */
  added: string[];
  /** Frames the manifest had that are no longer in the file. */
  removed: string[];
  /** Frames present in both, under a different name: node id to new name. */
  renamed: { nodeId: string; from: string; to: string }[];
  /** The reading order Figma implies, for a manifest that is being rebuilt. */
  discovered: FigmaFrame[];
}

/**
 * Re-read a file's frames and merge them into what a document already has.
 *
 * **The designer's decisions are the base, and Figma owns the facts.** A manifest
 * records the two things the file cannot: which frames belong in *this* document
 * (a scratch frame and an archive are siblings on the same canvas) and what order
 * they are meant in. So a frame already in the manifest keeps its position and
 * its `included` flag whatever Figma says about where it sits; a frame that is
 * new is appended in the discovered reading order; a frame that has gone is
 * reported as removed and *dropped*, because keeping it would leave a Next button
 * pointing at a frame Figma can no longer serve.
 *
 * **A frame's name and size are Figma's to change.** Both are read off the
 * artwork rather than being anything a person typed — EDSAI does not let a frame
 * be renamed, so a manifest name is only ever a copy of Figma's, and keeping a
 * stale copy is how a deck ends up labelled `01 — Cover` beside a frame called
 * `07 — Thank you`. A page with no `node-id` is the exception: it is a whole-file
 * page that has no frame to be corrected by, so it passes through untouched.
 */
export function mergeFrames(
  existing: readonly DocumentPage[],
  discovered: readonly FigmaFrame[],
): { pages: DocumentPage[]; changes: FrameChanges } {
  const byNode = new Map(discovered.map((frame) => [frame.nodeId, frame]));
  const changes: FrameChanges = { added: [], removed: [], renamed: [], discovered: [...discovered] };

  const kept: DocumentPage[] = [];
  for (const page of existing) {
    const nodeId = page.nodeId;
    if (!nodeId) {
      // A page with no frame is a whole-file page — a document recorded before
      // there were frames, or a deliberate "show me the file". Nothing to merge
      // it against and no reason to drop it.
      kept.push(page);
      continue;
    }
    const frame = byNode.get(nodeId);
    if (!frame) {
      changes.removed.push(nodeId);
      continue;
    }
    byNode.delete(nodeId);
    if (frame.name !== page.name) changes.renamed.push({ nodeId, from: page.name, to: frame.name });
    kept.push(measure(page, frame));
  }

  const added: DocumentPage[] = [];
  for (const frame of byNode.values()) {
    changes.added.push(frame.nodeId);
    added.push({
      documentId: '', order: 0, name: frame.name, nodeId: frame.nodeId,
      included: true, width: frame.width, height: frame.height,
    });
  }

  const pages = [...kept, ...added].map((page, index) => ({ ...page, order: index + 1 }));
  return { pages, changes };
}

/**
 * Put a frame's name and measurements on a page.
 *
 * Both come from the file, so a renamed frame and a resized one are both
 * reflected the next time the document is opened rather than the next time
 * somebody remembers to fix the manifest by hand.
 */
function measure(page: DocumentPage, frame: FigmaFrame): DocumentPage {
  return {
    documentId: page.documentId,
    order: page.order,
    name: frame.name,
    nodeId: frame.nodeId,
    included: page.included,
    ...(frame.thumbnailUrl ? { thumbnailUrl: frame.thumbnailUrl } : {}),
    width: frame.width,
    height: frame.height,
  };
}

/**
 * A page that is not saved against a document yet.
 *
 * **The document id is the one field a discovered page cannot have.** Discovery
 * runs before there is a document — that is precisely what the Add Document form
 * is doing when it asks — so the id is stamped by whoever saves the manifest,
 * not by the reader. Everything else is held to `DocumentPage` in full, because a
 * frame with no name or no node id is a broken page whichever document it is
 * eventually filed under.
 */
const ProposedPage = DocumentPage.extend({ documentId: z.string() });

/**
 * The frames a document should show, from what the file has.
 *
 * A rebuild, unlike a refresh: there is nothing to preserve, so every discovered
 * frame arrives in reading order and included. This is what the Add Document
 * form calls when a link is pasted for the first time.
 *
 * **Pass an empty `documentId` for a reading that has no document behind it
 * yet** — the common case, since the link is pasted before the document exists.
 */
export function pagesFromFrames(documentId: string, frames: readonly FigmaFrame[]): DocumentPage[] {
  return inReadingOrder([...frames]).map((frame, index) => ProposedPage.parse({
    documentId, order: index + 1, name: frame.name, nodeId: frame.nodeId,
    included: true, width: frame.width, height: frame.height,
    ...(frame.thumbnailUrl ? { thumbnailUrl: frame.thumbnailUrl } : {}),
  }));
}
