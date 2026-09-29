import { z } from 'zod';

/**
 * Reading a Figma link, and addressing a frame inside one.
 *
 * **What this is for.** EDSAI frames Figma documents in place, and a
 * presentation has to be read a page at a time rather than scrolled. Both need
 * the same two facts out of a URL: is this a Figma link at all, and which frame
 * in it is page four. That is a URL, not a page of HTML, and Figma's
 * deep-linking is a public, documented part of the product rather than
 * something scraped out of its viewer — so this parses the address bar and
 * nothing else.
 *
 * **What this is not.** It is not a Figma API client. There is none in this
 * codebase and adding one would mean a token the browser must never hold, for
 * the privilege of learning a page list a designer can read off the canvas
 * faster. See `DocumentPage` for why the manifest is recorded rather than
 * discovered.
 */

/** The kinds of Figma link a document can arrive as. */
export const FigmaSourceKinds = [
  'file', 'design', 'proto', 'board', 'slideshow', 'embed', 'community', 'other',
] as const;
export const FigmaSourceKind = z.enum(FigmaSourceKinds);
export type FigmaSourceKind = z.infer<typeof FigmaSourceKind>;

/**
 * The kinds that name a file, and can therefore be deep-linked to a frame.
 *
 * `embed` is deliberately absent: an embed URL carries another URL inside it,
 * and the frame belongs to that inner one. `figmaInnerUrl` unwraps it.
 */
const FILE_KINDS = new Set<FigmaSourceKind>(['file', 'design', 'proto', 'board', 'slideshow']);

/** The path segment that identifies each kind, longest match first. */
const KIND_BY_SEGMENT: Record<string, FigmaSourceKind> = {
  file: 'file',
  design: 'design',
  proto: 'proto',
  board: 'board',
  slideshow: 'slideshow',
  embed: 'embed',
  community: 'community',
};

export interface FigmaSource {
  kind: FigmaSourceKind;
  /** The file key, where the link names a file. */
  fileKey?: string;
  /** The frame the link already points at, if it points at one. */
  nodeId?: string;
  /** The link exactly as it was given, so it can be stored unchanged. */
  href: string;
  /**
   * The underlying file link, with any embed wrapper taken off.
   *
   * This is the URL that gets deep-linked and framed. Handing `figma.com/embed`
   * to the embedder instead is how a document ends up embedded inside an embed,
   * which is the failure mode worth naming: the first viewer is Figma's whole
   * file browser, and the second is EDSAI's frame inside it.
   */
  innerHref: string;
}

/**
 * A Figma node id: `12-345`. Deliberately strict — no path, no query, no `#`.
 *
 * Exported rather than repeated in `figma-frames.ts` and `documents.ts` because
 * a node id is validated in four places now — parsed out of a URL, read back
 * from a frame listing, matched against a manifest, and written into one — and
 * four regexes that are meant to agree is three chances for them not to.
 */
export const NODE_ID = /^\d+-\d+$/;

/**
 * Figma's API writes the same id with a colon: `12:345`.
 *
 * One node, two spellings, and the gap between them is silent. A URL carries
 * `node-id=12-345`; the `/v1/files` body carries `"id": "12:345"`. So a file read
 * from the API hands back ids that `NODE_ID` — correctly, for a URL — refuses,
 * and every frame in a real file gets dropped as malformed while the tests, which
 * use URL-shaped ids, pass. This is that boundary, named once.
 */
const API_NODE_ID = /^(\d+):(\d+)$/;

/**
 * The URL form of a node id, from either spelling.
 *
 * The dash form is the canonical one everywhere in EDSAI — in links, in stored
 * manifests, in `pageUrl` — so the API's colon form is converted at the edge
 * rather than carried around. Returns `undefined` for anything that is not a
 * node id, so a caller gets the same answer it would get from a failed `NODE_ID`
 * test rather than a malformed id to store.
 */
export function toNodeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Dash form is already canonical, so it passes straight through — this has to
  // be idempotent, or a stored manifest's ids would stop being recognized the
  // second time they are read.
  if (NODE_ID.test(value)) return value;
  const match = API_NODE_ID.exec(value);
  return match ? `${match[1]}-${match[2]}` : undefined;
}

/** Whether a string is a Figma node id, which is a question worth asking directly. */
export function isNodeId(value: unknown): value is string {
  return typeof value === 'string' && NODE_ID.test(value);
}

function parseNodeId(value: string | null): string | undefined {
  if (!value) return undefined;
  const decoded = value.replace(/%3D/gi, '=');
  return NODE_ID.test(decoded) ? decoded : undefined;
}

/**
 * True only for an https link on figma.com or one of its subdomains.
 *
 * This is the whole gate between "a URL someone typed" and "an origin we
 * frame", so it is deliberately strict: no http, no look-alike hosts, no bare
 * strings. The studio keeps a copy of this rule for its own form validation;
 * this one is the record of truth the server enforces.
 */
export function isFigmaUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'figma.com' || host.endsWith('.figma.com');
}

/**
 * What a Figma link is, or nothing at all if it is not one.
 *
 * `undefined` is the only failure signal, and it is a total one: a host that is
 * not Figma's, a scheme that is not https, and a string that is not a URL are
 * all the same answer, because the caller's only correct response to any of
 * them is the same.
 */
export function figmaSource(value: string): FigmaSource | undefined {
  if (!isFigmaUrl(value)) return undefined;

  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  const kind = (segments[0] ? KIND_BY_SEGMENT[segments[0].toLowerCase()] : undefined) ?? 'other';

  // An embed link is a wrapper around another link, and the file — not the
  // wrapper — is what has a key and a frame.
  if (kind === 'embed') {
    const inner = url.searchParams.get('url');
    if (inner) {
      const unwrapped = figmaSource(inner);
      if (unwrapped) return { ...unwrapped, href: value };
    }
    return { kind: 'embed', href: value, innerHref: value };
  }

  const fileKey = FILE_KINDS.has(kind) ? segments[1] : undefined;
  if (!fileKey) return { kind, href: value, innerHref: value };

  const nodeId = parseNodeId(url.searchParams.get('node-id'));
  return {
    kind,
    fileKey,
    ...(nodeId ? { nodeId } : {}),
    href: value,
    innerHref: withNodeId(value, nodeId),
  };
}

/**
 * The same Figma link, pointing at one frame.
 *
 * An existing `node-id` is replaced rather than appended, so navigating from
 * page 3 to page 4 of the same document cannot leave two of them on the URL
 * and land on neither.
 */
export function withNodeId(value: string, nodeId: string | undefined): string {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (nodeId === undefined) {
    url.searchParams.delete('node-id');
  } else if (NODE_ID.test(nodeId)) {
    url.searchParams.set('node-id', nodeId);
  } else {
    return value;
  }
  return url.toString();
}

/**
 * The Figma link for one page of a document, or the file itself for a page
 * that names no frame.
 *
 * Takes the *stored* link rather than a parsed one, so a document saved before
 * this existed, and one saved as an embed, both work.
 */
export function pageUrl(sourceUrl: string, page: DocumentPageLike | undefined): string {
  if (!page?.nodeId) return withNodeId(sourceUrl, undefined);
  const source = figmaSource(sourceUrl);
  return withNodeId(source?.innerHref ?? sourceUrl, page.nodeId);
}

/** The page shape `pageUrl` needs, kept structural so this file imports nothing. */
export interface DocumentPageLike {
  nodeId?: string;
}

/**
 * Whether this link can be read a page at a time.
 *
 * True for anything naming a file, because a designer may still record a
 * manifest against it; false for a link with no file behind it, where there is
 * nothing to address. It says the document is *capable* of pagination, not
 * that it has pages — which is `pageCount`, and a different question.
 */
export function canPresent(value: string): boolean {
  const source = figmaSource(value);
  return source !== undefined && source.fileKey !== undefined;
}

/**
 * A message a person can act on, for a link that is not one.
 *
 * The four cases are named separately because they need different things from
 * the reader: a typo is fixed, a private file needs a share, and a deleted one
 * needs the studio. Telling all three "that is not a Figma link" is how a real
 * problem gets filed as a bug.
 */
export function figmaUrlProblem(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return 'Paste a Figma link.';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'That is not a link. Paste the whole address, starting with https://.';
  }
  if (url.protocol !== 'https:') return 'A Figma link has to be https.';
  const host = url.hostname.toLowerCase();
  if (host !== 'figma.com' && !host.endsWith('.figma.com')) {
    return 'That is not a figma.com address.';
  }
  const source = figmaSource(trimmed);
  if (!source) return 'That is not a Figma link.';
  if (!source.fileKey) {
    return source.kind === 'community'
      ? 'That is a Figma Community file. Open your own copy of it first, then paste that link.'
      : 'That link does not point at a file. Open the file in Figma and copy its address.';
  }
  return undefined;
}
