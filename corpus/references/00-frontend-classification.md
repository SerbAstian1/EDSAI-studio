# Frontend System Classification
**The gate that stops a portfolio site from receiving a microfrontend architecture.**

Read this before activating any of Departments 35–47 during a full pipeline run. Its job is to make advanced frontend infrastructure *earn its place* rather than appear because EDSAI happens to know about it.

The classification governs **unprompted activation**. A direct, scoped question — "how does Module Federation handle version skew?", "should this use IndexedDB or Cache API?" — still receives that department's full reasoning regardless of the project's level. The gate stops padding, not knowledge.

---

## 1. How to classify

Classify by **what the interface must actually do**, not by how impressive the client is or how large the company is. A Fortune 500 brochure site is Level 0. A two-person startup's collaborative editor is Level 3.

State the level explicitly and defend it in one sentence:

> *"Frontend System Level: 2 — admin platform with server-state caching, cursor pagination, and optimistic updates across ~40 endpoints; no real-time or offline requirement."*

If a project sits between two levels, **classify down and name the pressure**: "Level 1, trending toward 2 — currently six endpoints, but the roadmap's saved-search feature will introduce genuine server-state caching needs within two quarters." Classifying up "to be safe" is how a form ends up with a normalized Redux store.

---

## 2. The levels

### Level 0 — Static Interface

Portfolio, landing page, brochure site, static marketing site.

**Focus:** semantic HTML, CSS architecture, accessibility, responsive design, asset optimization, SEO, performance.

**Activates:** Departments 35 (browser fundamentals), 36, 39 (rendering decision — usually SSG), 43 (build/bundle), plus baseline slices of 40 (XSS/CSP), 41 (HTTP/CDN caching), and 47 (request path).

**Explicitly does not activate:** state libraries, server-state caching, data-fetching architecture, offline systems, observability infrastructure, advanced architecture.

The most common failure at this level is *over-engineering*: reaching for a framework's full application apparatus to render text and images. The second most common is *under-engineering the fundamentals* — shipping 400KB of JavaScript to animate a hero, or skipping semantic structure because a `<div>` was faster to type.

### Level 1 — Interactive Application

Dashboards, forms, booking interfaces, authenticated interfaces.

**Activates additionally:** 37 (state management), 38 (data fetching), 40 (full security incl. auth/token storage), 42 (testing), 45 (observability, if production-facing), 47 (full networking).

**The defining shift:** the interface now has *state that can be wrong*. Loading, error, empty, and stale become real product surfaces rather than theoretical ones. Authentication introduces a token-storage decision with genuine security consequences.

### Level 2 — Data-Heavy Application

Admin platforms, marketplaces, complex dashboards, search interfaces.

**Activates additionally:** 41 (caching & client data architecture) in full, plus the deeper halves of 37 (normalization, state machines) and 38 (deduplication, pagination, optimistic updates, prefetching).

**The defining shift:** server state becomes the dominant state category, and *cache freshness becomes a product decision* rather than a technical afterthought. Request waterfalls start costing real perceived latency. This is the level at which a dedicated server-state library (TanStack Query, SWR) usually stops being optional overhead and starts being the simpler choice.

### Level 3 — Real-Time Application

Chat, collaboration, live dashboards, multiplayer interfaces.

**Activates additionally:** the real-time sub-module of Department 38 — WebSockets/SSE, connection lifecycle, reconnection with backoff, event ordering, duplicate events, synchronization, conflict handling.

**The defining shift:** state changes without the user acting, and events can arrive late, twice, or out of order. Optimistic UI stops being a nicety and becomes structural. The hardest problems here are not connection setup — they are reconnection, ordering, and reconciling the server's truth with what the user is currently looking at.

### Level 4 — Offline / Distributed Client

Offline-first applications, field applications, installable PWAs, synchronization-heavy clients.

**Activates additionally:** 44 (browser storage & offline systems) in full — Service Workers, IndexedDB, Cache API, offline queues, background sync, conflict resolution, stale-data policy.

**The defining shift:** the client becomes a node with its own durable state that can diverge from the server's. This is genuinely distributed-systems territory living in a browser, and it should never be entered casually. **Never add offline architecture unless the product materially benefits** — a service worker introduces cache lifecycle, update/activation semantics, and a class of "why is the user seeing last week's build" bugs that do not exist without it.

The honest test: *do real users of this product actually lose connectivity while needing to keep working?* Field technicians, warehouse scanners, and transit apps pass. A marketing dashboard checked from an office does not.

### Level 5 — Large-Scale Frontend Platform

Multi-team frontend, enterprise design system, multi-application platform, microfrontend environment.

**Activates additionally:** 46 (advanced frontend architecture) — monorepos, package boundaries, design-system governance and versioning, Module Federation, microfrontends, deployment strategies.

**The defining shift:** the constraint stops being technical and becomes **organizational**. Level 5 patterns solve coordination problems between teams that ship on independent cadences. A single team adopting microfrontends has bought the coordination cost of a structure that solves a coordination problem they don't have.

> **Microfrontends are an organizational and architectural solution, not a default frontend architecture.**

---

## 3. The justification questions

Before activating anything from Level 2 or above during a full pipeline run, answer these. Any "no" or "unknown" pushes back toward the simpler architecture:

1. **What measurable problem does this solve?** Name the metric — perceived latency, duplicate requests per session, time-to-interactive, deploy coordination overhead. "Scalability" without a number is not an answer.
2. **What is the current pain, in observed terms?** Not the anticipated pain two years out.
3. **What is the simpler alternative, and specifically why does it fail here?**
4. **What complexity does this introduce** — new failure modes, new debugging surface, new onboarding cost, new dependencies?
5. **Who maintains it?** A microfrontend estate or an offline sync layer assumes an ongoing owner.
6. **What's the exit?** If this turns out wrong in six months, how expensive is the reversal?

Record the answers briefly in the output. A Level 4 decision with no recorded justification is indistinguishable from a Level 4 decision made out of enthusiasm.

---

## 4. Level-to-department activation matrix

| Department | L0 | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| 35 Browser Engineering | ● | ● | ● | ● | ● | ● |
| 36 JavaScript & TypeScript | ● | ● | ● | ● | ● | ● |
| 37 State Management | — | ● | ●● | ●● | ●● | ●● |
| 38 Data Fetching | — | ● | ●● | ●●+RT | ●● | ●● |
| 39 Rendering Architecture | ● | ● | ● | ● | ● | ● |
| 40 Frontend Security | ◐ | ● | ● | ● | ● | ● |
| 41 Caching & Client Data | ◐ | ◐ | ● | ● | ● | ● |
| 42 Testing & Quality | — | ● | ● | ● | ● | ● |
| 43 Build & Dependencies | ● | ● | ● | ● | ● | ● |
| 44 Storage & Offline | — | ◐ | ◐ | ◐ | ● | ● |
| 45 Frontend Observability | — | ● | ● | ● | ● | ● |
| 46 Advanced Architecture | — | — | — | — | — | ● |
| 47 Frontend Networking | ◐ | ● | ● | ● | ● | ● |

● full activation ◐ baseline slice only — RT real-time sub-module — full activation at higher levels

**Cumulative, not exclusive.** Level 3 runs everything Level 1 and 2 run, plus the real-time module. A Level 4 project is not exempt from Level 1's error-state discipline because it has bigger problems.

---

## 5. Interaction with the QA audit

Department 9's Frontend Engineering Audit (`07-qa-critic-arbitration.md`) checks **only the departments this classification activated**. A static marketing site does not FAIL for lacking WebSocket reconnection logic, an offline queue, or distributed tracing — those checks are not applicable and are skipped silently, not marked as failures or as N/A rows.

Conversely, a Level 3 application that skipped the real-time module's ordering and duplicate-event reasoning **does** fail — the classification determines what gets audited, and having claimed a level, the work is held to it.
