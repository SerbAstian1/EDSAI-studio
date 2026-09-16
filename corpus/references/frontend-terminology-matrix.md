# Frontend Terminology Matrix
**The vocabulary EDSAI must recognize and reason about correctly.**

This file is **reference material, not output.** Never reproduce it into a response, and never let a term list stand in for reasoning — a glossary is exactly what this system is built not to be. Its purpose is coverage: any term below that appears in a brief, a codebase, a critique, or a client conversation should be something EDSAI can place, explain the mechanism of, and reason about the tradeoffs of.

**How to use it.** When a term here appears in a request, go to the owning department and apply that department's full reasoning model:

> **Concept → Mechanism → Tradeoff → Failure Mode → Implementation → Verification → When to Use → When Not to Use**

The **Owner** column is the routing table. Where two departments appear, the first owns the concept and the second owns a specific facet of it.

---

## Browser *(owner: Dept 35)*

| Term | Owner |
|---|---|
| DOM, CSSOM, Render Tree | 35.1 |
| Critical Rendering Path | 35.1, 8.1a |
| Layout, Reflow, Paint, Compositing | 35.1 |
| Layout Thrashing, forced synchronous layout | 35.2 |
| Main Thread | 35.3 |
| Event Loop, Call Stack, Microtasks, Macrotasks | 35.3, 36.2 |
| Rendering opportunity, Long Tasks | 35.3 |
| Web APIs | 35 |
| Garbage Collection, Memory Leaks, Detached DOM | 35.4 |
| Event propagation, capture/bubble, delegation, passive listeners | 35.6 |

## JavaScript / TypeScript *(owner: Dept 36)*

| Term | Owner |
|---|---|
| Scope, Closures, Lexical Environment, Hoisting, TDZ | 36.1 |
| Prototypes, `this`, execution context | 36.1 |
| Promises, async/await, combinators, error propagation | 36.2 |
| AbortController, cancellation | 36.2 |
| Iterators, Generators | 36.2 |
| ESM, CommonJS, Dynamic Imports, Tree Shaking, module boundaries | 36.3, 43.3 |
| Type inference, unions, intersections, generics | 36.4 |
| Type narrowing, type guards, discriminated unions | 36.4 |
| Structural typing, utility types, `any` vs `unknown` | 36.4 |
| Runtime validation, schema validation, the compile/runtime boundary | 36.5 |

## React *(owner: Dept 7)*

| Term | Owner |
|---|---|
| Components, Props, State, Hooks, Context | 7.5, 37.5 |
| Composition, Controlled/Uncontrolled Components, component contracts | 7.5 |
| Rendering, Re-rendering, Reconciliation, keys | 7.6 |
| Referential equality, Memoization (`memo`/`useMemo`/`useCallback`) | 7.6, 7.7 |
| Effects, effect dependencies, cleanup, Stale Closures | 7.6, 36.1 |
| Render profiling, virtualization | 7.7 |
| Suspense, Error Boundaries | 7.8, 45.1 |
| Server Components, Client Components, Server Actions | 7.8, 39.3 |
| Hydration, Hydration Mismatch, Streaming | 39.2 |

## State *(owner: Dept 37)*

| Term | Owner |
|---|---|
| Local, Component, Global Client, UI State | 37.1 |
| Server State | 37.1, 41.3 |
| URL State, Form State | 37.1 |
| Derived State | 37.2 |
| State Normalization | 37.3 |
| State Machines, transitions, invalid transitions | 37.4 |
| Cache State | 41.3 |
| Optimistic Updates | 38.6 |
| State Synchronization, source of truth, multi-writer | 37.6, 44.4 |

## Data *(owner: Dept 38)*

| Term | Owner |
|---|---|
| REST, GraphQL, gRPC-Web | 38.2 |
| WebSockets, SSE, Polling, Long Polling | 38.2, 38.7 |
| Webhooks | 38.2 *(implementation: DEVPOINT 29)* |
| Request Cancellation, Deduplication, Batching | 38.5 |
| Retries, exponential backoff, idempotency | 38.5 |
| Pagination, Cursor Pagination, Infinite Scroll | 38.5 |
| Prefetching | 38.5, 47.1 |
| Request Waterfalls, parallelization | 38.4, 36.2 |
| Optimistic rollback, reconciliation | 38.6 |
| Connection lifecycle, heartbeat, backfill, event ordering | 38.7 |

## Rendering *(owner: Dept 39)*

| Term | Owner |
|---|---|
| CSR, SSR, SSG, ISR, Streaming SSR | 39.1 |
| Hydration, Partial Hydration, Islands | 39.1, 39.2 |
| Hydration Mismatch | 39.2 |
| Server Components, Client Components, serialization boundary | 39.3, 7.8 |
| Edge Rendering | 39.4 |

## Performance *(owner: Dept 8, mechanism: 35)*

| Term | Owner |
|---|---|
| LCP, INP, CLS | 8.1 |
| FCP, TTFB, TBT | 8.1 |
| Long Tasks, JavaScript Execution Cost | 8.1, 35.3 |
| Critical Rendering Path | 8.1a, 35.1 |
| Code Splitting, Lazy Loading | 43.2 |
| Preload, Prefetch, Preconnect, DNS-prefetch, fetchpriority | 8.1b, 47.1 |
| Bundle Size, Bundle Analysis | 43.7 |
| Hydration Cost | 8.1d, 39.2 |
| Performance budgets | 8.1, `00-scorecard.md` §4 |

## Caching *(owner: Dept 41)*

| Term | Owner |
|---|---|
| Browser Cache, HTTP Cache | 41.2 |
| CDN Cache, Edge Cache | 41.2, 47.4 |
| Cache-Control, ETag, Last-Modified, max-age | 41.2 |
| Stale-While-Revalidate | 41.2 |
| Query Cache, stale time, GC time, cache keys | 41.3 |
| Service Worker Cache, cache strategies | 41.4, 44.2 |
| Cache Invalidation, freshness policy | 41.5 |
| Cache Busting, content hashing, immutable assets | 41.6, 43 |

## CSS *(owner: Dept 5; runtime behavior: 35)*

| Term | Owner |
|---|---|
| Cascade, Specificity, Inheritance, Cascade Layers | 5 |
| Box Model, Containing Blocks, Stacking Context | 5, 35.1 |
| Flexbox, Grid | 5 |
| Media Queries, Container Queries | 5 |
| CSS Variables, design tokens | 5, 7.2 |
| Logical Properties | 5 |
| CSS Containment | 5, 35.1 |
| GPU Compositing, layer promotion, `will-change` | 35.1, 15.9 |

## Accessibility *(owner: Dept 8; verification: 42)*

| Term | Owner |
|---|---|
| WCAG 2.1 AA | 8.2 |
| Semantic HTML, Landmarks, heading hierarchy | 8.2c |
| ARIA, Accessible Names | 8.2c |
| Keyboard Navigation | 8.2, 42.4 |
| Focus Management, Focus Trapping, focus restoration | 8.2b |
| Screen Readers, live regions | 8.2b, 42.4 |
| Color Contrast | 8.2, 5 |
| Reduced Motion | 8.2, 6, 15.5 |
| Touch Targets, dragging alternatives (2.5.1, 2.5.7) | 8.2 |

## Security *(owner: Dept 40)*

| Term | Owner |
|---|---|
| Same-Origin Policy, CORS, preflight | 40.1 |
| XSS (reflected, stored, DOM) | 40.2 |
| CSP, nonces, hashes, `unsafe-inline` | 40.2 |
| Trusted Types | 40.2 |
| CSRF, SameSite, CSRF tokens | 40.3 |
| Cookies: HttpOnly, Secure, SameSite, Domain | 40.3, 40.4 |
| Token storage, access/refresh tokens, rotation, JWT | 40.4 |
| OAuth, OpenID Connect, PKCE | 40.4 |
| Clickjacking, frame-ancestors | 40.5 |
| Open Redirects, URL Injection | 40.5 |
| Prototype Pollution, DOM Clobbering | 40.5, 36.1 |
| Supply-Chain Attacks, third-party scripts, SRI | 40.5, 43.5 |

## Testing *(owner: Dept 42)*

| Term | Owner |
|---|---|
| Unit, Component, Integration, E2E Testing | 42.1 |
| Testing pyramid, level fit | 42.1 |
| Behavior vs implementation testing, network-boundary mocking | 42.2 |
| Coverage as a discovery metric | 42.3 |
| Accessibility Testing (automated + manual) | 42.4 |
| Visual Regression | 42.5 |
| Browser Testing (Chromium, Gecko, WebKit) | 42.5 |
| Contract Testing | 42.6 |
| Performance Testing | 8, 45.3 |

## Build *(owner: Dept 43)*

| Term | Owner |
|---|---|
| Vite, Webpack, Rollup, ESBuild, SWC, Babel, Turbopack | 43.1 |
| Transpilation, browserslist targets, Minification | 43.1 |
| Source Maps | 43.6 |
| Tree Shaking, `sideEffects`, barrel files | 43.3 |
| Code Splitting, dynamic imports, prefetch on intent | 43.2 |
| Build Caching, Dependency Graphs | 43.1 |
| npm, pnpm, Yarn, Lockfiles, Semver | 43.4 |
| Peer Dependencies, transitive dependencies, phantom dependencies | 43.4 |
| Supply chain, audit gates, install scripts | 43.5 |

## Infrastructure *(owner: Dept 46 / 47; operation: DEVPOINT 22)*

| Term | Owner |
|---|---|
| CDN, Edge Rendering | 47.4, 39.4 |
| HTTP/1.1, HTTP/2, HTTP/3, multiplexing, head-of-line blocking | 47.2 |
| DNS, TLS, connection reuse, compression | 47.1, 47.3 |
| Serverless, Environment Variables | 46.5 *(operation: DEVPOINT)* |
| Preview Deployments, Rollbacks | 46.5 |
| Canary, Blue-Green | 46.5 |
| Feature Flags | 46.5 |

## Observability *(owner: Dept 45)*

| Term | Owner |
|---|---|
| RUM, field vs lab data, p75 reporting | 45.2 |
| Synthetic Monitoring | 45.3 |
| Error Tracking, unhandled rejections, error boundaries | 45.1 |
| Source Maps (upload, not deploy) | 45.1, 43.6 |
| Session Replay, masking, consent | 45.4 |
| Frontend Metrics, Performance API, custom timings | 45.2 |
| Distributed Tracing, Trace IDs, Correlation IDs, `traceparent` | 45.5 |

## Offline *(owner: Dept 44)*

| Term | Owner |
|---|---|
| Service Workers, lifecycle, skipWaiting, kill switch | 44.2 |
| Web Workers, BroadcastChannel | 44.2, 35.3 |
| IndexedDB, Cache API, localStorage, sessionStorage | 44.1, 35.5 |
| Storage quota, eviction, persistence, schema versioning | 44.1 |
| Background Sync, Offline Queues | 44.3 |
| Conflict Resolution, LWW, version detection, CRDT/OT | 44.4 |
| PWA, manifest, installability, push permission | 44.5 |

## Architecture *(owner: Dept 46)*

| Term | Owner |
|---|---|
| Monorepos, workspaces, task graphs, remote caching | 46.1 |
| Package Boundaries, dependency direction | 46.1, 7.5 |
| Design System Packages, token pipelines, versioning, governance | 46.2, 5 |
| Microfrontends, Module Federation | 46.3 |
| BFF (Backend-for-Frontend) | 46.4 |
| Component Architecture, Feature Architecture | 7.5, 7.2 |

---

## Terms EDSAI recognizes but hands to DEVPOINT

Named here so the boundary is unambiguous rather than a gap. EDSAI can discuss the **frontend consequence** of each; the implementation belongs to DEVPOINT (Departments 16–34):

TCP/UDP internals · load balancing · reverse proxies and gateways · database schema, indexing, sharding, replication · server-side auth implementation · secrets management · message queues, DLQs, outbox · container orchestration, Kubernetes, Terraform · server concurrency and locking · SLOs and error budgets · backend incident response · distributed consensus and CAP positioning.
