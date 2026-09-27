/**
 * Reading a Figma link, and addressing a frame inside one.
 *
 * **Why this is duplicated here.** `packages/engine/src/figma-source.ts` is the
 * record of truth the server enforces, and a copy lives in the studio because
 * a form has to say "that is not a Figma link" *before* a round trip. The two
 * agree by construction on the parts that matter — https only, figma.com and
 * its subdomains, and `node-id` as the frame parameter — and the studio's copy
 * is the one that decides what a person is told while they are typing.
 *
 * It is a URL parser and nothing more. There is no Figma API client in this
 * codebase and there will not be one: a page list is something a designer can
 * read off the canvas, and a token in the browser is not a price worth paying
 * for it.
 */

/** The kinds of Figma link a document can arrive as. */
export type FigmaSourceKind =
  | 'file' | 'design' | 'proto' | 'board' | 'slideshow' | 'embed' | 'community' | 'other';

/** The kinds that name a file, and can therefore be deep-linked to a frame. */
const FILE_KINDS = new Set<FigmaSourceKind>(['file', 'design', 'proto', 'board', 'slideshow']);

/** The path segment that identifies each kind. */
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
   * This is what gets deep-linked and framed. Handing `figma.com/embed` to the
   * embedder instead is how a document ends up embedded inside an embed.
   */
  innerHref: string;
}

/** A Figma node id: `12-345`. Deliberately strict — no path, no query, no `#`. */
const NODE_ID = /^\d+-\d+$/;

function parseNodeId(value: string | null): string | undefined {
  if (!value) return undefined;
  const decoded = value.replace(/%3D/gi, '=');
  return NODE_ID.test(decoded) ? decoded : undefined;
}

/**
 * True only for an https link on figma.com or one of its subdomains.
 *
 * The whole gate between "a URL someone typed" and "an origin we frame", so it
 * is deliberately strict: no http, no look-alike hosts, no bare strings.
 */
export function isFigmaUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'figma.com' || host.endsWith('.figma.com');
}

/** What a Figma link is, or nothing at all if it is not one. */
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
  return { kind, fileKey, ...(nodeId ? { nodeId } : {}), href: value, innerHref: withNodeId(value, nodeId) };
}

/**
 * The same Figma link, pointing at one frame.
 *
 * An existing `node-id` is replaced rather than appended, so moving from page 3
 * to page 4 of the same document cannot leave two of them on the URL and land
 * on neither.
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
 * pages existed, and one saved as an embed, both work.
 */
export function pageUrl(sourceUrl: string, page: { nodeId?: string } | undefined): string {
  if (!page?.nodeId) return withNodeId(sourceUrl, undefined);
  const source = figmaSource(sourceUrl);
  return withNodeId(source?.innerHref ?? sourceUrl, page.nodeId);
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
 * The cases are named separately because they need different things from the
 * reader: a typo is fixed, a private file needs a share, and a deleted one
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
