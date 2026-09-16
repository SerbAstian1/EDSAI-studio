# Department 39: Rendering Architecture

## Role

Owns **where and when HTML is produced** — and therefore what the user sees before JavaScript arrives, what crawlers index, what the CDN can cache, and how much work the client has to redo on arrival.

**Activation: always.** Even a purely client-rendered app has made a rendering decision; the requirement is that it be a *stated* decision with reasons, not a default inherited from a starter template.

## The core failure this department exists to prevent

**Choosing a rendering strategy by fashion rather than by requirement.** SSR because it sounds serious. Server Components because they're new. Full CSR because the tutorial used it. Each of these can be right; none of them is right *by default*, and the cost of a wrong choice compounds — an unnecessary SSR layer buys a server to run, a hydration bill to pay, and a class of mismatch bugs, in exchange for nothing a CDN wasn't already doing better.

The second failure is the belief that **SSR equals SEO** (see Department 8 and §22 of the upgrade spec). Rendering is *one* input to discoverability, alongside crawlability, semantic structure, metadata, structured data, and performance.

---

## 39.1 The strategies

| Strategy | HTML produced | Cacheable at CDN | Data freshness | Server needed |
|---|---|---|---|---|
| **CSR** | In the browser, after JS loads | Shell only | Live per request | No |
| **SSG** | At build time | **Fully** | As of last build | No |
| **ISR** | At build, regenerated on a schedule/trigger | Yes, with revalidation | Stale up to the window | Yes (or platform) |
| **SSR** | Per request, on the server | Rarely (personalized) | Live | Yes |
| **Streaming SSR** | Per request, flushed in chunks | Rarely | Live | Yes |
| **Islands / partial hydration** | Mostly static, interactive parts hydrated | Yes | Depends on source | Depends |

**CSR.** The server sends a near-empty shell; the client fetches JS, executes, then fetches data. Simple to deploy, no server runtime, and genuinely correct for authenticated tools behind a login where SEO is irrelevant and the shell is cached forever. *Cost:* the worst possible LCP path on slow devices — network, then parse, then execute, then a second network round trip for data.

**SSG.** HTML built ahead of time and served as a static file from the edge. **The fastest thing that exists** and the right default for marketing sites, docs, blogs, and portfolios. *Cost:* content changes require a rebuild, and build time scales with page count — a hundred thousand product pages is a forty-minute deploy.

**ISR.** SSG with a revalidation window: serve the cached page, regenerate in the background after N seconds or on an explicit trigger. Resolves SSG's staleness without paying SSR's per-request cost. *Cost:* users can see stale content within the window, and the invalidation story must be designed — this is Law 11, and Department 41 owns the freshness policy.

**SSR.** HTML generated per request. Correct when the page is genuinely personalized, when data must be live at first paint, or when the content must be complete for a crawler that won't execute JS. *Cost:* a server under load, TTFB now includes your data fetching, and every rendered page still ships JS to hydrate.

**Streaming SSR.** The server flushes HTML in chunks as it becomes available, so the shell paints while slow data resolves behind Suspense boundaries. Improves perceived latency substantially when some data is slow and some isn't. *Cost:* error handling gets harder — the status code is already sent when a later chunk fails, so failures must degrade into the stream rather than into an error page.

**Islands / partial hydration.** Ship static HTML and hydrate only the interactive regions. Best JS-cost profile for content-dominant pages with isolated interactivity. *Cost:* cross-island communication is awkward by design; a page where everything is interactive gains nothing.

---

## 39.2 Hydration

```text
Server HTML → browser paints (visible, not interactive)
       ↓
JS bundle downloads and parses
       ↓
Framework reconciles its tree against existing DOM
       ↓
Listeners attach → interactive
```

The gap between "visible" and "interactive" is the **uncanny valley of SSR**: the page looks ready and ignores clicks. It is felt as poor INP and is a real product problem, not a metric artifact — users click, nothing happens, they click again.

**Hydration is not free and it is not fast.** The client re-executes component logic to rebuild the tree. A fully SSR'd page ships *more* total work than a CSR page: HTML plus the same JS plus reconciliation. SSR trades total work for earlier first paint.

**Mitigations:** reduce the hydrating surface (islands, Server Components), split by route, prioritize above-the-fold interactivity, and never gate interactivity on non-critical JS.

### Hydration mismatch

The server-rendered HTML disagrees with what the client renders first. Causes, in descending order of frequency:

- **Non-deterministic values** — `Date.now()`, `Math.random()`, locale/timezone formatting differing between server and client
- **Browser-only APIs** read during render — `window`, `localStorage`, `matchMedia`
- **Reading client state during initial render** — theme from storage, viewport size, user agent
- **Invalid HTML nesting** — a `<div>` inside a `<p>` gets restructured by the parser, so the DOM no longer matches what was serialized
- **Extensions mutating the DOM** before hydration

**Consequence:** the framework discards the server HTML for that subtree and re-renders on the client — losing exactly the benefit SSR was purchased for — or, worse, produces silently wrong output.

**Mitigation pattern:** render the server-safe version first, then apply client-only state in an effect after mount. For genuinely client-only content, defer to post-mount rendering deliberately rather than suppressing the warning. Suppression hides the symptom and keeps the cost.

**Verification:** zero hydration warnings in the console on every route, checked in CI rather than by memory.

---

## 39.3 Server Components

A component model where components execute **only on the server**, send their rendered output to the client, and ship **no JavaScript for themselves**.

**What this buys:** direct data access without an API round trip for that layer, dependencies (markdown parsers, date libraries, ORMs) that never reach the client bundle, and a smaller hydration surface.

**The boundary rules that actually bite:**

- Props crossing server→client must be **serializable**. Functions, class instances, `Date` in some configurations, and symbols cannot cross. This constrains component design more than people expect.
- A Client Component **cannot import** a Server Component, but it *can* receive one as `children` — composition through slots is the escape hatch, and designing for it up front avoids a painful refactor.
- Anything with state, effects, event handlers, or browser APIs must be a Client Component. Marking a component client-side marks its **entire import subtree** client-side.

**Appropriate when:** content-heavy applications with clear static/interactive separation, and heavy data-layer dependencies you want off the client.
**Not appropriate when:** the interface is overwhelmingly interactive (a design tool, an editor), or the team's mental model of the boundary is shaky — misplaced `'use client'` directives silently pull the tree client-side and produce a *worse* bundle than a straightforward CSR app.
**Complexity introduced:** two execution environments, a serialization boundary, framework-coupled data patterns, and a harder debugging story.
**Failure modes:** accidental client-boundary creep; secrets leaking through props into serialized output; waterfalls from sequential server-side awaits.
**Simpler alternative:** SSG/ISR with a small hydrated island, which achieves much of the JS reduction with none of the boundary model.

---

## 39.4 Edge rendering

Executing render logic at CDN points of presence, physically close to the user.

**Buys:** low TTFB globally, and cheap request-time personalization (geolocation, A/B assignment, auth redirects) without a round trip to origin.
**Constraints that decide it:** restricted runtime (no full Node API surface, limited native modules), execution time and memory caps, cold starts, and — the one most often missed — **your database is still in one region.** Edge rendering that queries a distant origin database has moved compute closer while leaving the latency exactly where it was. Edge helps when the data is at the edge too, or when no data is needed.

**Appropriate when:** geographically distributed audience, light or cached data, personalization at the routing layer.
**Not appropriate when:** heavy queries against a single-region database, or a Node-specific dependency set.
**Complexity introduced:** a second runtime with different capabilities from your server code, a split mental model of where code executes, harder local reproduction, and observability that must span both edge and origin.
**Failure modes:** cold starts on low-traffic routes; hitting execution or memory caps under real payloads; a dependency that works in Node and fails at the edge, discovered at deploy; and the quiet one — edge compute querying a distant database, which moves the compute and leaves the latency exactly where it was.
**Simpler alternative:** regional SSR plus CDN caching of everything cacheable.

---

## 39.5 The decision framework

**Every rendering recommendation answers all eight of these explicitly.** An answer that skips them is a preference, not a decision:

1. **SEO requirement?** Which pages must be indexed, and by which crawlers?
2. **Personalization?** Is content per-user, per-segment, or identical for everyone?
3. **Data freshness?** How stale may this be — seconds, minutes, until next deploy?
4. **Interactivity?** How much of the page is genuinely interactive versus presentational?
5. **Caching opportunity?** Can this be cached at the edge, and what invalidates it?
6. **Deployment environment?** Is there a server runtime, and who operates it?
7. **JavaScript budget?** What can the audience's real devices afford (Department 8's budget)?
8. **Latency requirements?** Where are users relative to origin?

**Mixed strategies are normal and usually correct.** A real application is often SSG marketing pages, ISR for a catalogue, SSR for authenticated dashboards, and CSR inside an editor. State the strategy **per route group**, with the reasoning per group — a single global answer is almost always the wrong shape.

> **Never choose SSR merely because it is fashionable.** The test: name the specific requirement from the list above that SSG or CSR fails to satisfy. If none, the simpler strategy wins.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Strategy Justification** | Per route group, with all eight questions answered and the rejected alternatives named | One global strategy, chosen by convention, unjustified |
| **Hydration Efficiency** | Hydrating surface minimized deliberately; mismatch sources eliminated; interactivity prioritized above the fold | Whole page hydrated by default; mismatch warnings suppressed; hydration cost unmeasured |
| **Boundary Clarity** | Server/client split explicit and serializable; slot composition used to keep the boundary shallow | `'use client'` scattered; boundary creep unnoticed; non-serializable props |

## Real Measurable Targets to report

- **Rendering strategy per route group**, stated with the requirement that drove it
- **TTFB** per strategy (target <800ms; edge/SSG expected well under)
- **LCP** per route group against the Department 8 budget
- **Hydration payload** — JS shipped per route, and the proportion of the page that hydrates
- **Hydration warnings: 0**, verified in CI, not by inspection
- **Cache hit ratio** for SSG/ISR routes, and the stated revalidation window per ISR route
