import {
  exchangeCode, expiryFrom, figmaOAuthConfigured, figmaStatus, framesOnCanvas, needsRefresh,
  noFrames, pagesFromFrames, readFigmaFile, refreshToken, authorizationState, authorizationUrl, digest,
  FigmaUnreachable,
  type FigmaAppConfig, type FigmaCredentials, type FigmaFailureKind, type FigmaFile, type FigmaStatus,
} from '@edsai/engine';
import type { RunStore } from '@edsai/engine';
import { figmaSource, toNodeId, type ClientDocumentEntry } from '@edsai/engine';

/**
 * Figma, as the API needs it.
 *
 * **Everything credential-shaped stops in this file.** The Studio may know
 * whether a connection exists and nothing else; the token, the refresh token and
 * the app secret exist between a route and a `fetch`, are never written into a
 * response body, and are never read from the environment here. A route asks this
 * for a list of frames and gets a list of frames.
 *
 * It is a class rather than a bag of functions because two things have to be
 * shared and neither is worth passing around: the pending OAuth states, which are
 * per-server and short-lived, and the store, which is the only thing that can
 * read a grant back.
 */
export interface FigmaOptions {
  /** The OAuth app an operator configured. Absent means PAT-only. */
  app?: FigmaAppConfig | undefined;
  /**
   * The server's own Figma token, for a single-tenant studio that has not wired
   * an OAuth app up. Never a per-user token's substitute: a per-user grant wins,
   * because it is the only one that can see that user's private files.
   */
  serverToken?: string | undefined;
  /**
   * Where Figma's API is, for a test that stands in for it.
   *
   * Present here and nowhere in the engine: a deployment setting this would aim
   * every designer token at a host of its choosing, so it exists to be set by a
   * test and `serve.ts` has no way to reach it.
   */
  origin?: string | undefined;
}

/** A pending authorization attempt, kept as a digest and nothing more. */
interface Pending {
  userId: string;
  expiresAt: number;
}

export class FigmaService {
  private readonly app: FigmaAppConfig;
  private readonly serverToken: string | undefined;
  /**
   * Overridable origin for Figma's REST API, for tests.
   *
   * **A seam, not a mock.** The alternative is stubbing `fetch`, which would let
   * a test pass while the real request is built wrongly — a file key unencoded, a
   * token in the wrong header, a `depth` dropped. Pointing this at a local server
   * means the request that gets asserted on is the one production sends, with
   * only the hostname changed. Absent, the origin is Figma's, which is a
   * constant rather than a parameter so no caller can redirect a credential.
   */
  private readonly origin: string;
  /**
   * Authorization attempts in flight, keyed by the digest of their `state`.
   *
   * **In memory, and on purpose.** A pending state is good for ten minutes, is
   * only ever read by the process that issued it, and holds no authority of its
   * own — it says "this callback belongs to that user" and the value it protects
   * is worthless without the session cookie that comes with it. Persisting it
   * would mean a table that expires rows, which is a problem to have and not a
   * problem to solve. The digest is the key, so a dump of this map is not a set
   * of live callbacks.
   */
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly store: RunStore, options: FigmaOptions = {}) {
    this.app = options.app ?? {};
    this.serverToken = options.serverToken;
    this.origin = options.origin ?? 'https://api.figma.com';
  }

  /** Whether this deployment has an OAuth app at all. */
  get oauthConfigured(): boolean {
    return figmaOAuthConfigured(this.app);
  }

  /**
   * What the studio is allowed to know: a boolean, and whose grant it is.
   *
   * The two are separate because they answer different questions. `connected`
   * says a Figma read can happen; `perUser` says the designer has connected
   * their own account rather than the studio sharing one — which decides
   * whether a private file they expect to be readable will be.
   */
  async statusFor(userId: string): Promise<FigmaStatus & { oauthConfigured: boolean }> {
    const grant = this.store.getFigmaGrant(userId);
    return {
      ...figmaStatus(this.credentialsFor(grant), grant !== undefined),
      oauthConfigured: this.oauthConfigured,
    };
  }

  /**
   * Where to send a browser to start connecting Figma.
   *
   * Refused without a configured app rather than returning a link to an
   * authorization page that would come straight back rejected: a Connect button
   * that cannot work is worse than a server that says it is not configured,
   * because the first looks like Figma refusing and the second is fixable.
   */
  beginConnect(userId: string): string {
    if (!this.oauthConfigured) {
      throw new FigmaUnreachable('not_connected',
        'This server has no Figma OAuth app configured, so designers cannot connect their own account.');
    }
    this.prune();
    const state = authorizationState();
    this.pending.set(state.digest, { userId, expiresAt: Date.parse(state.expiresAt) });
    return authorizationUrl({ config: this.app, state: state.value });
  }

  /**
   * Figma's answer, exchanged for a token and stored.
   *
   * **The state is checked before the code is spent.** A callback is a GET a
   * third party can cause a browser to make, so an unrecognised state is
   * refused outright rather than exchanged — otherwise an attacker who can
   * predict nothing at all could still walk a code of their own into this
   * session. The lookup is by digest, and the digest is compared in constant
   * time, so neither the stored value nor the comparison reveals anything about
   * the other. The entry is spent whatever happens next: a one-shot state is
   * what makes a replay of a successful callback a no-op.
   */
  async completeConnect(userId: string, query: URLSearchParams): Promise<void> {
    this.prune();
    const presented = query.get('state');
    const expected = presented === null ? undefined : this.pending.get(digest(presented));
    if (!presented || !expected || expected.expiresAt <= Date.now()) {
      throw new FigmaUnreachable('forbidden',
        'That Figma connection attempt is no longer valid. Start again from the studio.');
    }
    // Spent first, so a replay of a successful callback finds nothing.
    this.pending.delete(digest(presented));
    // A state that matches but names another session is a stolen callback, and
    // the two are told apart: one is a stale tab, the other is an attack.
    if (expected.userId !== userId) {
      throw new FigmaUnreachable('forbidden',
        'That Figma connection attempt belongs to a different session.');
    }

    const error = query.get('error');
    if (error) {
      // `access_denied` is somebody choosing not to, not something broken, and
      // the studio's own sentence says so.
      throw new FigmaUnreachable('forbidden',
        query.get('error_description')?.trim()
        || (error === 'access_denied'
          ? 'Figma access was declined. Nothing was changed.'
          : 'Figma did not grant access.'));
    }

    const code = (query.get('code') ?? '').trim();
    if (!code) {
      throw new FigmaUnreachable('forbidden', 'Figma sent no authorization code.');
    }
    const grant = await exchangeCode({ config: this.app, code });
    this.store.saveFigmaGrant({
      userId,
      figmaUserId: grant.figmaUserId,
      accessToken: grant.accessToken,
      ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : {}),
      expiresAt: expiryFrom(grant.expiresIn),
      updatedAt: new Date().toISOString(),
    });
  }

  /** Disconnect, which is a delete: a revoked grant leaves nothing behind. */
  disconnect(userId: string): void {
    this.store.deleteFigmaGrant(userId);
  }

  /**
   * Read the frames a pasted Figma link points at.
   *
   * **The link decides the scope, and only a real canvas can.** A deep link
   * carries a `node-id`, and that id may name a Figma *page* or a *frame* on
   * one. Naming a page means "this document is that page's deck"; naming a frame
   * means "here is a slide of the deck I am looking at", which is a link pasted
   * by somebody looking at slide four, not a decision about which slides exist.
   * Only the first reading restricts anything, and it is the one a file can
   * settle on its own — hence the whole file is read and the canvases come back
   * with it.
   */
  async readLink(
    userId: string,
    url: string,
    thumbnails = true,
  ): Promise<FigmaFile & { canvasId?: string }> {
    const source = figmaSource(url);
    if (!source?.fileKey) {
      throw new FigmaUnreachable('not_found', 'That is not a link to a Figma file.');
    }
    const file = await readFigmaFile({
      fileKey: source.fileKey,
      credentials: await this.credentials(userId),
      thumbnails,
      origin: this.origin,
    });
    // A link's `node-id` may name a canvas or a frame inside one, and only the
    // file can say which — so the id is normalized before it is matched against
    // the canvases the API reported, which spell ids the other way.
    const linked = toNodeId(source.nodeId);
    const canvasId = linked && file.canvases.some((canvas) => canvas.id === linked)
      ? linked : undefined;
    const frames = canvasId ? framesOnCanvas(file.frames, canvasId) : file.frames;
    if (frames.length === 0) throw noFrames();
    // `pages` is rebuilt from the *filtered* frames rather than sliced out of the
    // full file's pages, because filtering the frames is what was decided and
    // the pages have to agree with it by construction.
    return {
      ...file,
      frames,
      pages: pagesFromFrames('', frames),
      ...(canvasId ? { canvasId } : {}),
    };
  }

  /** Re-read the file behind a stored document, for a refresh. */
  async readDocument(userId: string, entry: ClientDocumentEntry): Promise<FigmaFile> {
    if (entry.source !== 'figma' || !entry.figmaFileKey) {
      throw new FigmaUnreachable('not_found', 'That document is not a Figma document.');
    }
    const file = await readFigmaFile({
      fileKey: entry.figmaFileKey,
      credentials: await this.credentials(userId),
      origin: this.origin,
    });
    // A document that was pointed at one canvas keeps that scope on every
    // refresh. The alternative is a deck that quietly grows the working pages
    // from `Page 1` the first time somebody hits refresh.
    const canvasId = toNodeId(entry.figmaPageId);
    const frames = canvasId && file.canvases.some((canvas) => canvas.id === canvasId)
      ? framesOnCanvas(file.frames, canvasId) : file.frames;
    if (frames.length === 0) throw noFrames();
    // Rebuild pages to match the filtered frame set, so a restricted canvas does
    // not leak every other frame into the manifest it returns.
    return { ...file, frames, pages: pagesFromFrames('', frames) };
  }

  /**
   * The token to use for this user, renewed if it is about to lapse.
   *
   * **A renewal that fails deletes the grant rather than keeping a dead one.**
   * A grant that can no longer be renewed is not a grant, and leaving it in the
   * table would make every later read fail with a 401 the designer cannot act on
   * — as opposed to a state where reconnecting is visibly the answer. The server
   * token, if there is one, is picked up on the next attempt, so a studio that
   * falls back to it does not lose the ability to read anything.
   */
  private async credentials(userId: string): Promise<FigmaCredentials> {
    let grant = this.store.getFigmaGrant(userId);
    if (grant && needsRefresh(grant)) {
      if (grant.refreshToken) {
        try {
          const renewed = await refreshToken({ config: this.app, refreshToken: grant.refreshToken });
          grant = {
            ...grant,
            accessToken: renewed.accessToken,
            ...(renewed.refreshToken ? { refreshToken: renewed.refreshToken } : {}),
            expiresAt: expiryFrom(renewed.expiresIn),
            updatedAt: new Date().toISOString(),
          };
          this.store.saveFigmaGrant(grant);
        } catch {
          this.store.deleteFigmaGrant(userId);
          grant = undefined;
        }
      } else {
        this.store.deleteFigmaGrant(userId);
        grant = undefined;
      }
    }
    return this.credentialsFor(grant);
  }

  private credentialsFor(grant: { accessToken: string } | undefined): FigmaCredentials {
    return {
      ...(grant ? { accessToken: grant.accessToken } : {}),
      ...(this.serverToken ? { serverToken: this.serverToken } : {}),
    };
  }

  /** Drop states that have expired, so the map cannot grow without bound. */
  private prune(): void {
    const now = Date.now();
    for (const [digest, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(digest);
    }
  }
}

/**
 * How a Figma refusal becomes an HTTP answer.
 *
 * **The statuses are chosen per cause, not uniformly.** A private file is a 403
 * because the caller's request was refused and retrying it will be refused
 * again; a deleted file is a 404 because the thing asked for is not there; a
 * throttle is a 429 with Figma's own `Retry-After` forwarded, because the caller
 * can act on that number and nothing else; and "nothing to page through" is a
 * 422 because the request was well-formed and the file simply is not a document.
 * Collapsing them to one 502 is how a revoked connection gets filed as a Figma
 * outage.
 */
export function figmaStatusCode(kind: FigmaFailureKind): number {
  switch (kind) {
    case 'not_connected': return 409;
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'rate_limited': return 429;
    case 'no_frames': return 422;
    case 'figma_error': return 502;
    case 'network': return 502;
  }
}

/** The `error` string a client switches on, which is the failure kind verbatim. */
export function figmaErrorBody(error: FigmaUnreachable):
{ error: string; message: string; retryAfterMs?: number } {
  return {
    error: error.kind,
    message: error.message,
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
  };
}

/** Whether an unknown error is a Figma refusal, which decides the catch shape. */
export function isFigmaUnreachable(error: unknown): error is FigmaUnreachable {
  return error instanceof FigmaUnreachable;
}
