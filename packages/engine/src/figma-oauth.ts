import { createHash, randomBytes } from 'node:crypto';
import { figmaConnected, tokenOf, type FigmaCredentials } from './figma-client.js';

/**
 * Connecting EDSAI to a designer's Figma.
 *
 * **A token has to live somewhere, and this is that place.** Reading a file's
 * frames needs an authenticated call, and there is no anonymous version of that
 * call. So EDSAI holds one — the studio's own, per signed-in user — and this
 * file is the only thing in the codebase that knows where it is kept.
 *
 * **Where it is kept: the server, in the database, under the user's id.** Not in
 * the browser (a token in `localStorage` is readable by any script on the page,
 * and by anything that later gets a script onto it), not in a public
 * environment variable (those ship to the client in a Vite build), and not in
 * `document_entries`, where a document row is something a portal session can
 * read. The table below is never returned by a route: the closest thing to it
 * is `isConnected`, which is a boolean.
 *
 * **Why OAuth rather than a pasted personal access token.** A PAT is a
 * studio-wide credential that lives in one engineer's account and dies with it,
 * and it has to be pasted into a deployment's environment by hand. An OAuth
 * grant is per user, revocable from Figma's own settings, and refreshable, so a
 * designer who leaves keeps their access and a designer who unshares a file
 * loses only that file. The server-side token from the environment remains
 * supported for a single-tenant studio that would rather not wire an OAuth app
 * up — see `FigmaCredentials.serverToken` — and it is the fallback, never the
 * default, so a shared deployment ends up per-user.
 */

/**
 * Figma's OAuth endpoints.
 *
 * Constants rather than configuration because they are not deployment-specific:
 * every Figma OAuth app talks to these two, and a host a deployment can set
 * would only ever be a host to redirect credentials somewhere Figma's are not.
 */
const AUTHORIZE = 'https://www.figma.com/oauth';
const TOKEN = 'https://api.figma.com/v1/oauth/token';
const REFRESH = 'https://api.figma.com/v1/oauth/refresh';

/** How long a connection is treated as good without being exercised. */
const EXPIRY_SLACK_MS = 60_000;

/** Where one studio user's Figma connection lives. */
export interface FigmaConnection {
  userId: string;
  /** Figma's user id, so a studio can tell two designers apart in its logs. */
  figmaUserId: string;
  expiresAt: string;
  updatedAt: string;
}

/**
 * A connection, with the credential that makes it one.
 *
 * **Separate from `FigmaConnection` on purpose.** The interface above is the
 * shape a route is allowed to reason about — it says a grant exists, who it
 * belongs to and when it lapses, and every one of those fields is safe to log.
 * This one adds the two fields that must not be logged, printed, or returned by
 * anything that has not already decided it is running server-side. A single
 * interface with an optional token on it is a token that reaches a JSON response
 * the day somebody spreads it into a DTO; two interfaces mean spreading it does
 * not compile.
 */
export interface FigmaGrant extends FigmaConnection {
  accessToken: string;
  /** Absent on a grant Figma will not refresh, which is a real Figma answer. */
  refreshToken?: string | undefined;
}

/** The OAuth app's own configuration, as an operator supplies it. */
export interface FigmaAppConfig {
  clientId?: string | undefined;
  /** Never leaves the server, and never reaches the browser. */
  clientSecret?: string | undefined;
  /**
   * Where Figma sends the person back to.
   *
   * Registered with Figma rather than inferred: the callback has to land on an
   * origin the deployment actually serves, and guessing it from a request host
   * is how an open redirect becomes a credential leak.
   */
  redirectUri?: string | undefined;
}

/** Whether an OAuth app is configured at all. Absent means PAT-only. */
export function figmaOAuthConfigured(config: FigmaAppConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

/**
 * The state parameter for one authorization attempt.
 *
 * **A CSRF token, not a session id.** `state` is returned by Figma on the
 * callback and is the only thing tying a callback to the browser that started
 * it, so it is unguessable, it expires, and it is spent the moment it is used.
 * It is not the session cookie: this value is readable by the server and by
 * nobody else, and the caller stores only `digest` — looking a callback up by
 * digest means an unrecognised state is refused before a code is ever spent.
 */
export function authorizationState(): { value: string; digest: string; expiresAt: string } {
  const value = randomBytes(24).toString('base64url');
  return {
    value,
    // Only the digest is ever stored. A database dump of the pending states is
    // then not a set of live callbacks, in the same way a session table holds
    // digests rather than tokens.
    digest: digest(value),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

/**
 * The digest of a secret.
 *
 * **What a pending state is stored as.** The value itself is only ever held by
 * the browser that is about to be sent to Figma; the server keeps the digest and
 * looks the callback up by it, so a dump of the pending states is a set of hashes
 * rather than a set of live callbacks — the same arrangement a session table
 * uses for its tokens.
 */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Where to send a browser to start connecting Figma.
 *
 * **The scope is `file_content:read` and nothing else.** EDSAI reads frames; it does
 * not write files, manage members, or comment, and Figma's scopes are
 * independent, so asking for only this one means a connected designer could not
 * grant EDSAI the ability to change their files even by accident. A token that
 * cannot do more than the product does is a token whose worst case is bounded by
 * the product.
 */
export function authorizationUrl(input: {
  config: FigmaAppConfig;
  state: string;
}): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', input.config.clientId ?? '');
  url.searchParams.set('redirect_uri', input.config.redirectUri ?? '');
  url.searchParams.set('scope', 'file_content:read');
  url.searchParams.set('state', input.state);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

/** What Figma says once it has asked the designer whether to allow it. */
export interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user_id?: unknown;
  user_id_string?: unknown;
  scope?: unknown;
}

/**
 * Exchange an authorization code for a token, server-side.
 *
 * This is the one request in the product that must carry the app secret, and it
 * carries it to a constant host. Everything after this point — the token, the
 * refresh token — is returned to the caller and goes straight into the store.
 * Nothing here ever returns to a browser, and no route serialises its result.
 */
export async function exchangeCode(input: {
  config: FigmaAppConfig;
  code: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; figmaUserId: string }> {
  if (!figmaOAuthConfigured(input.config)) {
    throw new Error('Figma OAuth is not configured on this server.');
  }
  const body = new URLSearchParams({
    redirect_uri: input.config.redirectUri ?? '',
    code: input.code,
    grant_type: 'authorization_code',
  });

  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: oauthHeaders(input.config),
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error('Figma did not accept the connection request.');
  }
  const expires = Number(payload.expires_in);
  return {
    accessToken: payload.access_token,
    ...(typeof payload.refresh_token === 'string' ? { refreshToken: payload.refresh_token } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresIn: expires } : {}),
    figmaUserId: typeof payload.user_id_string === 'string'
      ? payload.user_id_string
      : typeof payload.user_id === 'string' ? payload.user_id : 'unknown',
  };
}

/**
 * A refreshed access token, when the grant included one.
 *
 * A grant without a refresh token — which is what a grant that would only ever
 * be used once looks like — is not an error here: the caller writes the token it
 * has, and the next refresh attempt is what fails, loudly, at a moment when
 * reconnecting is the correct answer anyway.
 */
export async function refreshToken(input: {
  config: FigmaAppConfig;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  if (!figmaOAuthConfigured(input.config)) {
    throw new Error('Figma OAuth is not configured on this server.');
  }
  const body = new URLSearchParams({ refresh_token: input.refreshToken });
  const response = await fetch(REFRESH, {
    method: 'POST',
    headers: oauthHeaders(input.config),
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error('The Figma connection could not be renewed. Reconnect Figma.');
  }
  const expires = Number(payload.expires_in);
  return {
    accessToken: payload.access_token,
    ...(typeof payload.refresh_token === 'string' ? { refreshToken: payload.refresh_token } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresIn: expires } : {}),
  };
}

/** Figma requires HTTP Basic authentication for token exchange and refresh. */
function oauthHeaders(config: FigmaAppConfig): Record<string, string> {
  const client = `${config.clientId ?? ''}:${config.clientSecret ?? ''}`;
  return {
    authorization: `Basic ${Buffer.from(client).toString('base64')}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
}

/** When a token minted with this expiry should be treated as already gone. */
export function expiryFrom(expiresIn: number | undefined): string {
  const seconds = expiresIn && expiresIn > 0 ? expiresIn : 60 * 60 * 24 * 30;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Whether a stored connection should be used, or renewed first.
 *
 * A minute of slack, because a token that expires *during* the frame-discovery
 * call is a call that fails for a reason the designer cannot act on.
 */
export function needsRefresh(connection: FigmaConnection | undefined): boolean {
  if (!connection) return true;
  const at = Date.parse(connection.expiresAt);
  if (!Number.isFinite(at)) return true;
  return at - EXPIRY_SLACK_MS <= Date.now();
}

/**
 * What the studio's UI is allowed to know about Figma.
 *
 * A boolean, and nothing else. It is the entire public shape of the connection:
 * no token, no expiry, no Figma user id, no scopes. A screen that could read the
 * expiry could also read the refresh token next to it, so the field that says
 * "connected" is chosen over the fields that would be convenient.
 */
export interface FigmaStatus {
  connected: boolean;
  /** Whether *this* user's own grant is what will be used, rather than the server's. */
  perUser: boolean;
}

export function figmaStatus(credentials: FigmaCredentials, own: boolean): FigmaStatus {
  return { connected: figmaConnected(credentials), perUser: own && tokenOf({ accessToken: credentials.accessToken }) !== undefined };
}
