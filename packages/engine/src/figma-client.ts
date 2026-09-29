/**
 * Talking to Figma's REST API. Server-side only.
 *
 * **This file must never be reachable from a browser.** Every request here
 * carries a credential, and a credential in a bundle is a credential on
 * everyone's screen. So: nothing in `packages/studio` imports this, nothing
 * here returns a token, and the `fetch` is written against a base URL that is
 * fixed here rather than taken from a request — a caller that could choose the
 * host could choose one that receives our header.
 *
 * **What it is for.** One question — *what frames are in this file, and how big
 * are they* — plus the rendered previews that make a page overview legible.
 * That is it. EDSAI does not edit in Figma, does not copy files out of it, and
 * does not mirror a design; the Figma file stays the source of truth and this
 * only reads the shape of it.
 *
 * **Why a token at all.** A Figma URL is a URL. To learn what is *inside* the
 * file behind it, the API has to be asked, and the API is authenticated. There
 * is no anonymous version of "list the frames in this file", so the choice is
 * between holding a credential and guessing. The credential lives in
 * `figma-oauth.ts` (per studio user) or in one server environment variable, and
 * goes no further.
 */

import { discoverFrames, pagesFromFrames, type FigmaFrame } from './figma-frames.js';
import { NODE_ID, toNodeId } from './figma-source.js';

/**
 * Where Figma's API is. A constant, never a parameter.
 *
 * Writing it out rather than interpolating a base URL is the point: the only
 * way this can send a credential somewhere unintended is if somebody edits this
 * line, which is a diff, rather than by a route accepting one.
 */
const FIGMA_API = 'https://api.figma.com';

/** How long to wait on Figma before giving up and saying so. */
const TIMEOUT_MS = 15_000;

/** Cap on nodes requested per call, so a huge file cannot be read by accident. */
const DEPTH = 2;

/**
 * How long to say to wait when Figma throttles us without saying itself.
 *
 * Long enough to be a real pause rather than an immediate retry — which is what
 * extends a throttle — and short enough that a designer waiting on a panel is
 * not left staring at a countdown.
 */
const DEFAULT_RETRY_AFTER_S = 30;

/**
 * Why a Figma read failed, as a small closed set.
 *
 * A string is not enough here because the four cases need four *different*
 * things from the reader, and telling all of them "could not read this file" is
 * how a revoked Figma connection gets filed as a bug with EDSAI in the title.
 * Every one of these carries a message written for the person reading it.
 */
export const FIGMA_FAILURES = [
  /** No token at all: nothing has connected Figma, or the server has none. */
  'not_connected',
  /** A 403. The token is valid and cannot see this file. */
  'forbidden',
  /** A 404. The file is gone, or was never shared with whoever is asking. */
  'not_found',
  /** A 429. Figma is throttling; the call is worth retrying shortly. */
  'rate_limited',
  /** Anything else from Figma, including a 5xx. */
  'figma_error',
  /** The socket failed, timed out, or the response was not JSON. */
  'network',
  /** The file was read and holds no frame that could be a page. */
  'no_frames',
] as const;
export type FigmaFailureKind = typeof FIGMA_FAILURES[number];

export class FigmaUnreachable extends Error {
  readonly kind: FigmaFailureKind;
  /**
   * How long Figma asked us to wait, when it said. Forwarded so a client can
   * say "try again in 30 seconds" instead of "try again".
   */
  readonly retryAfterMs?: number;

  constructor(kind: FigmaFailureKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'FigmaUnreachable';
    this.kind = kind;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** A Figma file read: the frames in it, and what it cost to find them out. */
export interface FigmaFile {
  fileKey: string;
  fileName: string;
  /**
   * Every canvas (Figma page) in the file, in the order Figma lists them.
   *
   * Present because "is the `node-id` in this link a page or a frame?" cannot be
   * answered from the link and has to be answered from the file. The caller
   * needs it to decide whether to restrict the document to one canvas.
   */
  canvases: { id: string; name: string }[];
  /** Every discoverable frame, in reading order. */
  frames: FigmaFrame[];
  /** One document's worth of pages, ready to be stored. */
  pages: ReturnType<typeof pagesFromFrames>;
}

/**
 * Where a credential comes from, in the order they are tried.
 *
 * An OAuth token for this user wins over the server's own, because a per-user
 * token can see that user's files and a shared one generally cannot. Both are
 * resolved by the caller and passed in — this module never reads the
 * environment, so that "no token in the browser" is a property of the
 * signatures here rather than a discipline somebody has to remember.
 */
export interface FigmaCredentials {
  /** The signed-in studio user's own Figma access token, if they connected one. */
  accessToken?: string | undefined;
  /** The server's token, for a single-tenant studio that has not connected per-user. */
  serverToken?: string | undefined;
}

/** The token to use, or `undefined` when there is nothing to use. */
export function tokenOf(credentials: FigmaCredentials): string | undefined {
  const token = credentials.accessToken ?? credentials.serverToken;
  return token && token.trim() !== '' ? token.trim() : undefined;
}

/** Whether a read is even possible, which is what the studio's badge asks. */
export function figmaConnected(credentials: FigmaCredentials): boolean {
  return tokenOf(credentials) !== undefined;
}

/**
 * The authentication header for the credential that won.
 *
 * OAuth access tokens use the standard Bearer scheme. A deployment-level
 * token is a personal/plan token and uses Figma's `X-Figma-Token` header. The
 * distinction cannot be inferred from the token text, so it follows the field
 * the credential came from.
 */
export function figmaAuthHeaders(credentials: FigmaCredentials): Record<string, string> | undefined {
  const accessToken = credentials.accessToken?.trim();
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  const serverToken = credentials.serverToken?.trim();
  if (serverToken) return { 'X-Figma-Token': serverToken };
  return undefined;
}

/**
 * One call to Figma, with every failure turned into a `FigmaUnreachable`.
 *
 * The file key goes into the path and is validated first. It comes out of a URL
 * a person pasted, and while `NODE_ID` and `isFigmaUrl` already make that a
 * narrow thing to abuse, this is the last place it touches a URL that a
 * credential is sent to — so the key is matched against the same strict shape
 * here and a key that is anything else never reaches the wire.
 */
async function figma(
  path: string,
  headers: Record<string, string>,
  origin: string = FIGMA_API,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout, a refused connection, a DNS failure. All of them are the same
    // thing to a person waiting: Figma did not answer.
    const reason = error instanceof Error ? error.message : String(error);
    throw new FigmaUnreachable('network', `Figma could not be reached: ${reason}`);
  }

  if (response.ok) {
    try {
      return await response.json();
    } catch {
      throw new FigmaUnreachable('figma_error', 'Figma sent a response that was not a file.');
    }
  }

  switch (response.status) {
    case 401:
      // The token itself is bad — revoked, expired, or never valid. Distinct
      // from 403 because the fix is different: reconnect, rather than ask the
      // designer to share the file.
      throw new FigmaUnreachable('not_connected',
        'The Figma connection has expired. Reconnect Figma to keep reading files.');
    case 403:
      throw new FigmaUnreachable('forbidden',
        'This Figma file is private. Share it with the studio, or with the Figma account EDSAI is connected as.');
    case 404:
      throw new FigmaUnreachable('not_found',
        'That Figma file does not exist, or has not been shared.');
    case 429: {
      // Figma's own `Retry-After` is forwarded when it sends one. When it does
      // not, a stated default is better than nothing: "you were throttled" with
      // no number leaves a caller with a retry button and no idea whether it is
      // worth pressing, and retrying immediately is how a throttle is extended.
      const after = Number(response.headers.get('retry-after'));
      const retryAfterMs = (Number.isFinite(after) && after > 0 ? after : DEFAULT_RETRY_AFTER_S) * 1000;
      throw new FigmaUnreachable('rate_limited',
        `Figma is rate-limiting this studio. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
        retryAfterMs);
    }
    default:
      throw new FigmaUnreachable('figma_error',
        `Figma answered ${response.status}. Nothing was changed.`);
  }
}

/** A file key, or a refusal to put it in a URL. */
function checkedKey(fileKey: string): string {
  const key = fileKey.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new FigmaUnreachable('not_found', 'That does not look like a Figma file key.');
  }
  return key;
}

/**
 * Read a Figma file and return the frames in it.
 *
 * **`depth=2` is the whole request.** A file is `document → canvas → frame`, so
 * two levels is the shallowest depth at which the top-level frames are present
 * and their geometry is not — which is exactly the data frame discovery needs
 * and nothing else. Without it a design file returns every vector path in the
 * file, which for a brand file is tens of megabytes to learn eight frame names.
 *
 * **The whole file, always.** No `ids` parameter, even when a canvas is wanted:
 * a link's `node-id` may name a canvas or a frame inside one, and which of those
 * it is can only be told by looking at the file — so the whole file comes back
 * and `canvases` lets the caller decide. One shallow request is cheaper than two
 * requests whose order depends on the answer.
 *
 * A file that reads successfully but holds no frame is **not** refused here.
 * "Nothing to page through" depends on which canvas was asked for, which is the
 * caller's question, so the caller answers it and raises `no_frames` itself.
 */
export async function readFigmaFile(input: {
  fileKey: string;
  credentials: FigmaCredentials;
  /** Whether to spend a second call on rendered previews. Off for a bare check. */
  thumbnails?: boolean;
  /**
   * Figma's API origin, for a test standing in for it.
   *
   * The real origin is a constant and the default, so a caller that forgets this
   * still talks to Figma — and one that passes something else is a test, because
   * no route can reach it and a deployment has no way to set it.
   */
  origin?: string | undefined;
}): Promise<FigmaFile> {
  const headers = figmaAuthHeaders(input.credentials);
  if (!headers) {
    throw new FigmaUnreachable('not_connected',
      'EDSAI is not connected to Figma, so it cannot read what frames are in a file.');
  }
  const fileKey = checkedKey(input.fileKey);
  const file = await figma(`/v1/files/${fileKey}?depth=${DEPTH}`, headers, input.origin);

  const name = typeof (file as { name?: unknown })?.name === 'string'
    ? (file as { name: string }).name : '';

  const frames = discoverFrames(file);
  const withPreviews = input.thumbnails === false
    ? frames : await previews(fileKey, headers, frames, input.origin);
  return {
    fileKey, fileName: name, canvases: canvasesOf(file), frames: withPreviews,
    pages: pagesFromFrames('', withPreviews),
  };
}

/** The canvases a file body declares, which is the list `node-id` is matched against. */
function canvasesOf(file: unknown): { id: string; name: string }[] {
  const root = typeof file === 'object' && file !== null ? file as Record<string, unknown> : undefined;
  const document = root && typeof root['document'] === 'object' && root['document'] !== null
    ? root['document'] as Record<string, unknown> : undefined;
  const children = document && Array.isArray(document['children']) ? document['children'] : [];
  const canvases: { id: string; name: string }[] = [];
  for (const canvas of children as Record<string, unknown>[]) {
    // The API's colon spelling, normalized, so a link's `node-id=1-0` matches it.
    const id = toNodeId(canvas?.['id']);
    if (id === undefined) continue;
    canvases.push({
      id,
      name: typeof canvas['name'] === 'string' ? canvas['name'] : '',
    });
  }
  return canvases;
}

/**
 * The refusal for a file that read cleanly and holds nothing to page through.
 *
 * **Raised by the caller, not by `readFigmaFile`,** because whether a file is
 * empty depends on which canvas was asked for and only the caller knows that.
 * The wording lives here anyway: a designer who gets this needs to be told it is
 * the file's shape and not their link, and a second copy of that sentence in a
 * route is a second copy to fall out of date.
 */
export function noFrames(): FigmaUnreachable {
  return new FigmaUnreachable('no_frames',
    'That file has no top-level frames on it, so there is nothing to page through. A presentation needs one frame per slide.');
}

/**
 * Rendered previews for a set of frames, as a second pass over the same list.
 *
 * **Separated from `readFigmaFile` because it is a separate call and it can
 * fail alone.** A thumbnail is a nicety; the frame list is the document. If the
 * image call rate-limits or 500s, the frames still come back and the page
 * overview falls back to names — so this swallows its own failures rather than
 * taking the read down with it.
 *
 * Figma returns short-lived signed URLs, which is why `thumbnailUrl` is a cache
 * reference and not an asset: a URL that expires costs a preview, never a page.
 */
async function previews(
  fileKey: string,
  headers: Record<string, string>,
  frames: readonly FigmaFrame[],
  origin?: string | undefined,
): Promise<FigmaFrame[]> {
  if (frames.length === 0) return [...frames];
  try {
    const ids = frames.map((frame) => frame.nodeId).join(',');
    // `scale=0.2` is a deliberate under-request: an overview thumbnail is drawn
    // about 200px wide, and asking Figma for a full-resolution render of eighteen
    // slides to shrink it in the browser is eighteen times the bytes for nothing.
    const body = await figma(
      `/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=0.2`, headers, origin,
    );
    const raw = (body as { images?: Record<string, string | null> })?.images ?? {};
    // The response is keyed by node id, and Figma echoes back whichever spelling
    // it was sent — so the keys are normalized before they are matched rather
    // than assumed. Guessing wrong here costs every thumbnail in the file, with
    // nothing in the response to say why.
    const images = new Map<string, string>();
    for (const [key, url] of Object.entries(raw)) {
      const id = toNodeId(key);
      if (id !== undefined && typeof url === 'string' && url !== '') images.set(id, url);
    }
    return frames.map((frame) => {
      const url = images.get(frame.nodeId);
      return url ? { ...frame, thumbnailUrl: url } : frame;
    });
  } catch {
    return [...frames];
  }
}
