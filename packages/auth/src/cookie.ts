/**
 * The session cookie.
 *
 * Department 40.4 puts the options in a table and this picks from it rather
 * than inventing: `HttpOnly` so an XSS cannot read the session, `Secure` so it
 * never crosses plain http, `SameSite=Lax` so a cross-site POST does not carry
 * it. §40.3 is explicit that SameSite is "a strong baseline, **not** a complete
 * solution", which is why `originAllowed` exists below and is checked on every
 * state-changing request.
 *
 * `localStorage` was not considered. The same section: "never blindly recommend
 * localStorage for sensitive long-lived credentials" — it is readable by any
 * injected script, which is the entire point of HttpOnly.
 */

export const SESSION_COOKIE = 'edsai_session';

export interface CookieOptions {
  /** Off only for plain-http local development, and it has to be asked for. */
  secure?: boolean;
  maxAgeSeconds?: number;
}

export function serializeSession(token: string, options: CookieOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds ?? 60 * 60 * 12}`,
  ];
  if (options.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

/** The cookie that ends a session: same attributes, no value, expired. */
export function serializeLogout(options: CookieOptions = {}): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (options.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === SESSION_COOKIE) {
      const value = pair.slice(index + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}

/**
 * §40.3's third mitigation: validate the Origin server-side.
 *
 * SameSite=Lax already blocks the cookie on a cross-site POST, and §40.3 is
 * explicit that this is "a strong baseline, **not** a complete solution" —
 * a same-site attacker subdomain still satisfies it. So state-changing requests
 * are checked here too.
 *
 * The subtle case is a request with **no** `Origin` header, and getting it
 * wrong in either direction is easy:
 *
 * - Refusing outright breaks every non-browser client — the CLI, a test, a
 *   server-to-server call — none of which send one. The first draft of this did
 *   exactly that and locked the studio out of its own sign-in endpoint.
 * - Allowing outright would readmit the classic HTML-form CSRF.
 *
 * The resolution is the content type, stated as the browser states it. A simple
 * cross-origin request — the kind a `<form>` makes with no preflight — may only
 * carry `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain`. **Any other type forces a CORS preflight**, which this server
 * answers only for origins it allows.
 *
 * So the rule is to refuse those three, not to require one particular type. The
 * first version required `application/json`, which was over-narrow in a way that
 * did not show up until file uploads arrived: an `image/png` body is exactly as
 * unforgeable as a JSON one, and was being refused with a 403.
 *
 * The residual risk is stated rather than papered over: this trusts that the
 * browser will not one day permit a simple cross-origin request with a JSON
 * content type. That is a specification guarantee, not an implementation
 * detail, but it is a guarantee and not a proof.
 */
/** The only content types a cross-origin form can send without a preflight. */
const FORM_ENCODABLE = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

export interface CsrfCheck {
  origin: string | undefined;
  method: string;
  contentType: string | undefined;
  allowedOrigins: readonly string[];
}

export function isCsrfSafe({ origin, method, contentType, allowedOrigins }: CsrfCheck): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  // A browser told us where it came from: that answer is authoritative.
  if (origin !== undefined) return allowedOrigins.includes(origin);

  // No Origin. Refuse exactly the types a simple cross-origin request may
  // carry; everything else had to clear a preflight to get here.
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return type !== '' && !FORM_ENCODABLE.has(type);
}
