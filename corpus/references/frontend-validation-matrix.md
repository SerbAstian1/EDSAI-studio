# Frontend Validation Matrix
**The audit instrument for verifying EDSAI's frontend coverage is real.**

This file answers one question: *is every concept EDSAI claims to cover actually taught somewhere, or is it just a word in a list?*

Every concept must resolve to exactly one of four verdicts:

| Verdict | Meaning |
|---|---|
| **Taught** | A department teaches it with the full reasoning model — mechanism, tradeoff, failure mode, verification |
| **Inherited** | Covered by an existing department that already owned the concept; not duplicated |
| **Conditional** | Taught, but activated only at a stated system level (`00-frontend-classification.md`) |
| **Excluded** | Deliberately out of scope, with the reason stated — usually DEVPOINT's territory |

**A concept with no verdict is a gap.** A concept that appears in the terminology matrix but resolves to nothing here is the exact failure mode this file exists to catch: vocabulary without capability.

**When to run this.** After any structural change to EDSAI — a new department, a merged file, a renumbering. Not per-project. This audits the *skill*, not a deliverable.

---

## Coverage audit

### Browser

| Concept | Verdict | Location |
|---|---|---|
| DOM, CSSOM, Rendering Pipeline | Taught | 35.1 |
| Layout, Paint, Compositing, Reflow | Taught | 35.1 |
| Layout thrashing / forced synchronous layout | Taught | 35.2 |
| Main Thread, Event Loop, Microtasks, Macrotasks | Taught | 35.3 |
| Long tasks and INP causation | Taught | 35.3, 8.1 |
| Garbage Collection, Memory Leaks, Detached DOM | Taught | 35.4 |
| Browser Storage mechanisms | Taught | 35.5 *(architecture: 44.1; security: 40.4)* |
| Event propagation, delegation, passive listeners | Taught | 35.6 |

### JavaScript / TypeScript

| Concept | Verdict | Location |
|---|---|---|
| Closures, scope, `this`, prototypes, hoisting | Taught | 36.1 |
| Promises, async/await, combinator selection | Taught | 36.2 |
| AbortController and cancellation | Taught | 36.2 |
| Unhandled rejections | Taught | 36.2 *(capture: 45.1)* |
| Modules, ESM vs CJS, dynamic imports | Taught | 36.3 |
| Tree shaking | Taught | 36.3 *(build mechanics: 43.3)* |
| Generics, narrowing, type guards, discriminated unions | Taught | 36.4 |
| `any` vs `unknown`, structural typing, utility types | Taught | 36.4 |
| Runtime validation vs compile-time types (Law 9) | Taught | 36.5 |

### React

| Concept | Verdict | Location |
|---|---|---|
| Hooks, State, Context, Composition | Taught | 7.5, 37.5 |
| Component boundaries, prop design, controlled/uncontrolled | Taught | 7.5 |
| Reconciliation, re-rendering, referential equality, keys | Taught | 7.6 |
| Effects, dependencies, cleanup | Taught | 7.6 |
| Stale Closures | Taught | 7.6, 36.1 |
| Memoization and when it doesn't help | Taught | 7.7 |
| Suspense | Taught | 7.8, 39.1 |
| Error Boundaries | Taught | 45.1 *(placement as product decision)* |
| Server / Client Components | Taught | 7.8, 39.3 |
| Hydration, Streaming | Taught | 39.2, 39.1 |

### State

| Concept | Verdict | Location |
|---|---|---|
| Local / Global / Server / UI / URL / Form state | Taught | 37.1 |
| Derived State (Law 6) | Taught | 37.2 |
| State Normalization | Conditional (L2+) | 37.3 |
| State Machines | Taught | 37.4 |
| Optimistic Updates | Taught | 38.6 |
| Cache State | Taught | 41.3 |
| Source of truth, multi-writer resolution | Taught | 37.6 |

### Data

| Concept | Verdict | Location |
|---|---|---|
| REST, GraphQL, gRPC-Web | Taught | 38.2 |
| WebSockets, SSE, Polling | Conditional (L3+ for RT) | 38.2, 38.7 |
| Request Cancellation, Deduplication, Batching | Taught | 38.5 |
| Retries, backoff, idempotency | Taught | 38.5 |
| Pagination, cursor pagination, infinite scroll | Taught | 38.5 |
| Prefetching | Taught | 38.5, 47.1 |
| Request Waterfalls | Taught | 38.4, 36.2 |
| The seven request states | Taught | 38.3 |
| API contract inventory (DEVPOINT seam) | Taught | 38.1 |
| Webhooks | Excluded | Backend-to-backend; DEVPOINT 29 |

### Rendering

| Concept | Verdict | Location |
|---|---|---|
| CSR, SSR, SSG, ISR, Streaming SSR | Taught | 39.1 |
| Hydration, Partial Hydration, Islands | Taught | 39.1, 39.2 |
| Hydration mismatch causes and debugging | Taught | 39.2 |
| Edge Rendering | Taught | 39.4 |
| The eight-question decision framework | Taught | 39.5 |

### Performance

| Concept | Verdict | Location |
|---|---|---|
| LCP, INP, CLS + per-metric diagnosis | Taught | 8.1 |
| FCP, TTFB, TBT, long tasks | Taught | 8.1 |
| Critical Rendering Path | Taught | 8.1a, 35.1 |
| Code Splitting, Lazy Loading | Taught | 43.2 |
| Preload, Prefetch, Preconnect, priority hints | Taught | 8.1b, 47.1 |
| Bundle Size and analysis | Taught | 43.7 |
| Hydration Cost | Taught | 8.1d |
| Memory performance | Taught | 8.1e, 35.4 |
| Per-project performance budgets | Taught | 8.1, `00-scorecard.md` §4 |

### Security

| Concept | Verdict | Location |
|---|---|---|
| Same-Origin Policy, CORS | Taught | 40.1 |
| XSS (all three variants) | Taught | 40.2 |
| CSP, nonces, Trusted Types | Taught | 40.2 |
| CSRF, SameSite | Taught | 40.3 |
| Cookie attributes | Taught | 40.3, 40.4 |
| Token storage tradeoffs | Taught | 40.4 |
| OAuth, OIDC, PKCE, JWT, refresh rotation | Taught | 40.4 |
| Clickjacking, open redirects, prototype pollution, DOM clobbering | Taught | 40.5 |
| Supply-chain and third-party scripts | Taught | 40.5, 43.5 |
| Server-side authz, secrets management, OWASP server-side | Excluded | DEVPOINT 19 |

### Testing

| Concept | Verdict | Location |
|---|---|---|
| Unit, Component, Integration, E2E | Taught | 42.1 |
| Behavior-not-implementation discipline | Taught | 42.2 |
| Visual Regression | Taught | 42.5 |
| Accessibility Testing (automated + manual limits) | Taught | 42.4 |
| Contract Testing | Taught | 42.6 |
| Browser Testing (three engines) | Taught | 42.5 |
| Performance Testing | Inherited | 8, 45.3 |
| Load testing | Excluded | DEVPOINT 21 |

### Build

| Concept | Verdict | Location |
|---|---|---|
| Vite, Webpack, Rollup, ESBuild, SWC, Babel, Turbopack | Taught | 43.1 |
| Transpilation, Minification, targets | Taught | 43.1 |
| Source Maps (generate, upload, don't deploy) | Taught | 43.6 |
| Tree Shaking failure modes | Taught | 43.3 |
| Code Splitting tradeoffs | Taught | 43.2 |
| Dependency Graphs, Lockfiles, Semver, Peer Dependencies | Taught | 43.4 |
| Supply-chain vectors and mitigations | Taught | 43.5 |

### Offline

| Concept | Verdict | Location |
|---|---|---|
| Service Workers, lifecycle, kill switch | Conditional (L4+) | 44.2 |
| IndexedDB, Cache API, mechanism selection | Taught (L1+ selection) | 44.1 |
| Background Sync, Offline Queues | Conditional (L4+) | 44.3 |
| Conflict Resolution strategies | Conditional (L4+) | 44.4 |
| PWA | Conditional (L4+) | 44.5 |

### Observability

| Concept | Verdict | Location |
|---|---|---|
| Error Tracking, all four sources | Conditional (L1+ prod) | 45.1 |
| RUM, field vs lab, p75, segmentation | Conditional (L1+ prod) | 45.2 |
| Synthetic Monitoring | Conditional (L1+ prod) | 45.3 |
| Session Replay + privacy obligations | Conditional | 45.4 |
| Distributed Tracing, Trace/Correlation IDs | Conditional | 45.5 |
| Source Maps in error reporting | Taught | 45.1, 43.6 |
| Backend metrics, logs, alerting infrastructure | Excluded | DEVPOINT 22 |

### Architecture

| Concept | Verdict | Location |
|---|---|---|
| Monorepos, package boundaries | Conditional (L5) | 46.1 |
| Design System architecture, versioning, governance | Conditional (L5) | 46.2 *(design: Dept 5)* |
| Microfrontends, Module Federation | Conditional (L5) | 46.3 |
| BFF | Conditional (L5) | 46.4 |
| Deployment strategies, feature flags | Conditional (L5) | 46.5 *(operation: DEVPOINT 22)* |

### Networking

| Concept | Verdict | Location |
|---|---|---|
| Request path: DNS, TLS, connection setup | Taught | 47.1 |
| HTTP/1.1 vs H2 vs H3, multiplexing, HOL blocking | Taught | 47.2 |
| Compression, image and font delivery | Taught | 47.3 |
| CDN and edge delivery | Taught | 47.4 |
| Designing for real network conditions | Taught | 47.5 |
| TCP internals, load balancing, proxies, gateways | Excluded | DEVPOINT 28 |

---

## Structural checks

Run these alongside the coverage tables. Each has a pass/fail answer:

1. **Numbering** — EDSAI holds 1–15 and 35–47; DEVPOINT holds 16–34. No number means two things.
2. **Reference integrity** — every `references/*.md` path cited in SKILL.md or any reference file resolves to a real file.
3. **Scorecard integration** — every activated department has a `## Scorecard` section, and its dimensions match the canonical list in `00-scorecard.md` exactly.
4. **Measurable targets** — every department has a `## Real Measurable Targets to report` section.
5. **Classification gating** — every department in 35–47 has a stated activation level, and the matrix in `00-frontend-classification.md` §4 agrees with the table in SKILL.md.
6. **QA audit alignment** — the Frontend Engineering Audit in `07-qa-critic-arbitration.md` checks only classification-activated departments, and skips inapplicable ones silently.
7. **Boundary consistency** — the EDSAI↔DEVPOINT boundary reads identically in both skills, and no file still asserts the retired `src/` rule.
8. **No capability regression** — every pre-upgrade EDSAI department, rule, and failure condition is still present.
9. **Conditionality** — no advanced technology (microfrontends, service workers, state libraries, SSR, WebSockets) is presented as a default; each carries its five-part frame.
10. **Not a glossary** — every concept marked *Taught* is taught with mechanism and tradeoff, not defined in a sentence. Spot-check three at random; a definition without a failure mode fails this check.

**A failed structural check is a Blocker for the skill itself**, in the same sense that Department 9 uses the term — it is not shipped as FINAL until resolved.
