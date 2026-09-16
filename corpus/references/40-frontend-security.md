# Department 40: Frontend Security Engineering

## Role

Owns the browser's security model as it applies to the code EDSAI ships: injection, origin isolation, credential handling, and the third-party code running inside the application's own trust boundary.

**Activation: Level 1+ in full.** At Level 0, the XSS/CSP/dependency baseline still applies — a static marketing site with an injected analytics tag and a comment widget has a real attack surface.

**Boundary with DEVPOINT:** this department reasons about **what the browser enforces and what the frontend can get wrong**. Authentication *implementation*, server-side authorization, secrets management, and server-side OWASP work belong to DEVPOINT Department 19. Both sides are required — a perfectly secured backend is reachable through a compromised frontend, and every credential the frontend stores is a decision with server-side consequences.

## The core failure this department exists to prevent

**Treating security as the backend's job.** The frontend holds the credentials, renders the untrusted content, loads the third-party scripts, and makes the requests. It is where the session is stolen, where the injected script runs, and where the user is tricked into acting.

The second failure is **security as a checklist of nouns.** Knowing what CSRF stands for prevents nothing. Every item below is stated as *attack → vulnerable pattern → mitigation → verification*, because that chain is what makes the knowledge operational.

---

## 40.1 The origin model

An **origin** is scheme + host + port. The **Same-Origin Policy** is the browser's foundational isolation guarantee: a document from one origin cannot read another origin's DOM, cookies, or responses. Nearly everything below is either an extension of this rule or an exception to it.

**Note what SOP does *not* prevent.** It blocks *reading* cross-origin responses; it does not block *sending* cross-origin requests. A form on an attacker's page can POST to your API, and the browser will attach your cookies. The attacker cannot read the response — but for a state-changing request, they didn't need to. That gap is exactly what CSRF exploits.

### CORS

CORS is a mechanism for a server to **relax** SOP, not a security control the frontend implements. The frontend's job is to understand it well enough to consume it correctly and to recognize when a proposed configuration is dangerous.

- **Simple requests** (GET/POST with limited content types) are sent, and the *response* is withheld if the origin isn't allowed.
- **Preflighted requests** (custom headers, PUT/DELETE, JSON content type) send an `OPTIONS` first; the actual request never leaves if the preflight fails.
- **Credentialed requests** (`credentials: 'include'`) require `Access-Control-Allow-Credentials: true` **and** a specific origin — the wildcard is forbidden with credentials, by design.

**The dangerous configuration to flag:** reflecting the request's `Origin` header back as `Access-Control-Allow-Origin` with credentials enabled. That is a wildcard wearing a disguise, and it makes every origin trusted. If a CORS error is "fixed" this way during development, it is a Blocker.

---

## 40.2 XSS

**The attack:** attacker-controlled content executes as script in your origin, with full access to the DOM, cookies accessible to JS, and the user's session.

| Variant | Mechanism |
|---|---|
| **Reflected** | Input echoed back in the response — typically via a crafted link |
| **Stored** | Malicious content persisted server-side and served to every viewer |
| **DOM-based** | Never touches the server; client-side code writes untrusted data into a sink |

**Vulnerable patterns**, in the order they actually occur:

- Rendering unsanitized HTML through a framework's raw-HTML escape hatch (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`)
- Writing URL fragments, query parameters, or `postMessage` data into the DOM
- `href={userInput}` — a `javascript:` URL executes on click
- Passing untrusted strings to `eval`, `new Function`, or `setTimeout` with a string body
- Rendering user-supplied SVG or Markdown that permits raw HTML

**Mitigations:**

- **Default to framework escaping.** React, Vue, and Svelte escape interpolated text by design. The overwhelming majority of XSS in modern applications enters through a deliberate escape hatch, not through the framework failing.
- **When raw HTML is genuinely required** (a CMS rich-text field), sanitize with a maintained library (DOMPurify) with an allowlist, and do it at **render time**, not only on save — sanitizing on save leaves the database as the trust boundary and any pre-existing row unprotected.
- **Validate URL schemes** before rendering links; allow `http`, `https`, `mailto` explicitly rather than blocking `javascript:` by pattern.
- **Content Security Policy** as defence in depth — the assumption is that something eventually slips through.
- **Trusted Types** (Chromium) makes DOM sinks refuse plain strings, turning "we think we sanitized everywhere" into a browser-enforced guarantee. Worth adopting where support allows and the app manipulates the DOM directly.

**Verification:** every raw-HTML escape hatch in the codebase is inventoried and each has a stated sanitization path. Zero unaccounted uses. This is a Major QA issue when it fails.

### Content Security Policy

**Mechanism:** an allowlist telling the browser which sources may load and execute.

- `script-src 'self'` plus explicit hosts. **`'unsafe-inline'` in `script-src` defeats the primary purpose of CSP** — it is the single most common way a deployed CSP provides no XSS protection at all.
- For inline scripts that are genuinely needed, use a **per-response nonce** or a hash. A nonce must be unpredictable and regenerated per response; a static nonce is decoration.
- `frame-ancestors` controls who may frame you — this is the modern clickjacking defence, superseding `X-Frame-Options`.
- `object-src 'none'` and `base-uri 'self'` close two commonly forgotten holes.
- **Deploy in `Report-Only` first**, collect violations, then enforce. Enforcing a guessed policy breaks production; reporting first tells you what the policy actually needs.

CSP headers are set server-side, so implementation is a DEVPOINT handoff — but **the policy content is this department's specification**, because the frontend knows what it loads.

---

## 40.3 CSRF

**The attack:** an attacker's page causes the user's browser to send a state-changing request to your application, and the browser helpfully attaches the user's cookies.

**Prerequisite:** the credential is sent **automatically** by the browser. Cookie sessions are vulnerable by default; an `Authorization` header attached explicitly by JavaScript is not, because the attacker's page can't add it.

**Mitigations, layered:**

1. **`SameSite` cookies.** `Lax` (the modern default) blocks cookies on cross-site POSTs while preserving top-level GET navigation. `Strict` is stronger and breaks inbound links from other sites. Treat this as a strong baseline, **not** as a complete solution — same-site attacker subdomains and browsers with different defaults remain.
2. **CSRF tokens** — an unpredictable per-session or per-request token, submitted in a header or body and validated server-side. Still the robust answer for cookie-authenticated state changes.
3. **Origin/Referer validation** server-side.
4. **Never make GET state-changing.** A GET that deletes something is exploitable with an `<img>` tag.

**Verification:** every state-changing endpoint using cookie auth has a token or an equivalently strong control, stated explicitly.

---

## 40.4 Credential storage — the decision that matters most

| Mechanism | XSS-readable | Auto-sent | Survives reload | Notes |
|---|---|---|---|---|
| **`HttpOnly` cookie** | **No** | Yes | Yes | CSRF-exposed; needs `SameSite` + token |
| **`localStorage`** | **Yes** | No | Yes | Any XSS is total session compromise |
| **`sessionStorage`** | **Yes** | No | Per-tab | Same exposure, shorter window |
| **In-memory (JS variable)** | Only during the XSS | No | **No** | Smallest window; needs a refresh path |

**The recommended shape for most applications:** a **refresh token in an `HttpOnly`, `Secure`, `SameSite` cookie**, and a short-lived **access token held in memory**, silently renewed. XSS then cannot exfiltrate a durable credential, and CSRF is contained by the cookie attributes plus a token on state changes.

> **Never blindly recommend `localStorage` for sensitive long-lived credentials.** It is convenient precisely because JavaScript can read it — which is the same reason injected JavaScript can too. If a project stores tokens there, that is a recorded, justified risk acceptance with a stated compensating control, not a default.

**Cookie attributes**, each stated per cookie: `HttpOnly` (no JS access), `Secure` (HTTPS only), `SameSite` (cross-site behavior), `Domain` (subdomain sharing — narrow it; a compromised subdomain otherwise inherits your cookies), `Path`, and expiry.

**Token lifecycle:** short-lived access tokens, refresh rotation with reuse detection, revocation on logout that actually reaches the server, and a defined behavior when a refresh fails mid-session. **JWTs are signed, not encrypted** — anything in the payload is readable by anyone holding the token, and a JWT's claims must never be trusted for authorization decisions on the client beyond deciding what UI to show. Authorization is enforced server-side, always; client-side gating is a UX affordance, never a control.

**OAuth / OIDC:** for browser clients, use the **Authorization Code flow with PKCE**. The implicit flow is deprecated — it returned tokens in the URL fragment, where they leaked into history, logs, and referrers. Validate `state` to prevent CSRF on the callback, and validate `nonce` on the ID token.

---

## 40.5 Other attack surfaces

| Attack | Mechanism | Mitigation |
|---|---|---|
| **Clickjacking** | Your page framed invisibly over attacker UI; user's click hits your button | `frame-ancestors 'none'` (or an allowlist) |
| **Open redirect** | `?next=` parameter used as a redirect target, sending users to an attacker's site with your domain's credibility | Allowlist paths; never redirect to a raw user-supplied absolute URL |
| **Prototype pollution** | Attacker sets `__proto__` via a deep-merge or query parser, altering every object's behavior | Reject `__proto__`/`constructor` keys; `Object.create(null)` for untrusted maps; maintained merge utilities |
| **DOM clobbering** | Named HTML elements shadow global variables an unguarded script relies on | Don't rely on implicit globals; verify types before use |
| **URL injection** | User input concatenated into a URL, altering the target or leaking data through it | Use `URL`/`URLSearchParams`; never string-concatenate untrusted input into a URL |
| **Third-party script compromise** | An analytics, chat, or tag-manager script is compromised and runs in your origin with full DOM access | SRI for pinned assets, CSP allowlist, sandboxed iframes, minimize the count |

**Third-party scripts deserve emphasis.** A tag manager grants whoever administers it the ability to inject arbitrary JavaScript into your production application, bypassing code review and deployment entirely. That is a genuine risk to name explicitly during design rather than discover during an incident. Every third-party script is inventoried with what it does, who owns it, and what it can access.

**Dependency and supply-chain risk** is shared with Department 43, which owns the build-side mechanics — lockfiles, audit gates, install scripts. This department owns the consequence: a compromised package executes with your application's full privileges, including access to whatever credential store §40.4 chose.

---

## 40.6 Security in the design layer

Two of this department's most valuable contributions are not code:

- **Don't render what you don't need.** Data that never reaches the client cannot leak from it. Response shapes are a security decision, not just a payload-size one — a user object trimmed server-side to what the UI renders removes a whole class of accidental exposure. Raise this with DEVPOINT during contract design.
- **Authentication UX is security.** Session-expiry that discards a half-filled form trains users toward "keep me logged in forever." Preserve input across reauthentication, make logout reliable and obvious, and make security states legible rather than mysterious — Departments 3 and 4 collaborate here.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Browser Security** | CSP specified without `unsafe-inline`, nonce/hash-based, `frame-ancestors` set; CORS understood and safely configured | No CSP, or one with `unsafe-inline`; origin-reflecting CORS with credentials |
| **Authentication Safety** | Token storage decided with the tradeoff stated; refresh rotation and expiry-mid-session behavior defined; PKCE for OAuth | Long-lived tokens in `localStorage` by default; no refresh path; client-side auth treated as enforcement |
| **Input Safety** | Every raw-HTML sink inventoried and sanitized at render; URL schemes validated; CSRF control on every cookie-auth state change | Escape hatches used freely; user input written into the DOM; state-changing GETs |
| **Dependency Safety** | Third-party scripts inventoried with owner and access; SRI/CSP applied; audit gate in CI | Scripts added ad hoc; tag manager unrestricted; advisories unreviewed |

## Real Measurable Targets to report

- **CSP** present, `script-src` free of `unsafe-inline`, `frame-ancestors` and `base-uri` set — pass/fail per directive, with a Report-Only rollout stated
- **Cookie attributes** stated per cookie: `HttpOnly`, `Secure`, `SameSite`, `Domain`, expiry
- **Token storage mechanism named** with its tradeoff and any compensating control
- **Raw-HTML sink inventory** — count, each with its sanitization path (target: 0 unaccounted)
- **CSRF control** on every cookie-authenticated state-changing endpoint — pass/fail
- **Third-party script inventory** — count, owner, and capability per script
- **Dependency audit** — count of unremediated high/critical advisories (target: 0)
- **OAuth flow named** — Authorization Code + PKCE expected for browser clients; `state` and `nonce` validation confirmed
