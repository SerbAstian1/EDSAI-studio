# Department 38: Data Fetching & API Integration

## Role

Owns everything between the interface and the API: transport choice, request lifecycle, failure behavior, and the shape of the contract EDSAI consumes. **This department is the explicit EDSAI ↔ DEVPOINT interface** — it is where the boundary in SKILL.md becomes a concrete list of endpoints, shapes, and error semantics.

**Activation: Level 1+.** Deeper mechanisms (deduplication, pagination, optimistic updates, prefetching) at Level 2+. The **real-time sub-module (§38.7) activates at Level 3+.**

## The core failure this department exists to prevent

**Designing only the successful response** — Law 3. The happy path is written, demoed, and shipped; the 401 shows a blank screen, the timeout spins forever, the double-click creates two orders, and the slow request overwrites the fast one that came after it. None of these are exotic. All of them are the default behavior of code that didn't consider them.

The second failure is **inventing the backend's contract.** Guessing at response shapes produces a frontend that works against a mock and breaks against the server.

---

## 38.1 The API contract

Before writing any fetching code, EDSAI must know — for each endpoint:

- **Endpoint** and method
- **Request shape** — params, body, headers
- **Response shape** — including the envelope, not just the payload
- **Error shape** — the structure of a failure, per status code
- **Authentication expectations** — what's sent, how it refreshes
- **Pagination model** — offset, cursor, or none
- **Rate limits** — and what a 429 returns, including whether `Retry-After` is present
- **Retry behavior** — which operations are idempotent and therefore safe to retry

**If DEVPOINT is in the project, reference its contract; do not invent one.** If there is no backend layer yet, state the contract EDSAI *requires* as an explicit, labeled assumption — a specification for a backend to satisfy, clearly marked as not-yet-agreed. Both are acceptable; silently guessing is not.

**Error contracts deserve specific attention** because they're the most commonly under-specified part. "Returns 400 on invalid input" is not a contract. Which field failed? Is it one error or a list? Is the message human-readable or a code the frontend maps? Without this, error handling degrades to a generic "Something went wrong," which is Department 3's problem and this department's fault.

---

## 38.2 Transport selection

| Transport | Direction | Reach for it when | Cost |
|---|---|---|---|
| **REST** | Request/response | Default. Resource-shaped data, HTTP caching wanted | Over/under-fetching; multiple round trips for composed views |
| **GraphQL** | Request/response | Many clients with divergent data needs; deep composition avoiding waterfalls | Client complexity, HTTP caching largely forfeited, server cost/complexity, N+1 risk on the backend |
| **gRPC-Web** | Request/response, streaming | Existing gRPC backend; strict schemas; internal tooling | Requires a proxy; poor browser-native ergonomics; limited tooling |
| **SSE** | Server → client | One-way live updates: notifications, feeds, progress, live dashboards | One direction only; connection limits on HTTP/1.1 |
| **WebSockets** | Bidirectional | Genuinely two-way, low-latency: chat, collaboration, multiplayer | Stateful connections, auth/reconnection/scaling complexity |
| **Polling** | Request/response, repeated | Simple periodic freshness, low update rate, no infra to add | Wasted requests; latency bounded by interval |
| **Webhooks** | Server → server | Backend event notification (**DEVPOINT's territory**) | Never reaches the browser directly |

**The five-part frame on the two most over-reached-for:**

**GraphQL.** *Appropriate when:* several clients need different shapes of the same graph, or view composition genuinely causes waterfalls. *Not appropriate when:* one client, resource-shaped data — REST plus a couple of composite endpoints is simpler and keeps HTTP caching. *Complexity:* a client cache to configure, a query language to learn, lost CDN caching on POSTed queries. *Failure modes:* over-fetching moved rather than solved; backend N+1; queries growing unbounded. *Simpler alternative:* REST with purpose-built endpoints for the two or three expensive views.

**Polling.** *Appropriate when:* update frequency is low, staleness tolerance is high, and adding real-time infrastructure isn't justified. Refetch-on-window-focus covers a surprising share of "we need live data" requirements at zero infrastructure cost. *Not appropriate when:* sub-second latency matters or the interval would need to go below ~10s at scale. *Complexity:* almost none — that's the point. *Failure modes:* request pile-up on slow responses; battery and quota cost on mobile. *Simpler alternative:* none; this **is** the simpler alternative.

---

## 38.3 The request lifecycle

**Every asynchronous surface accounts for all seven of these states.** Not four. Seven:

| State | The question it answers |
|---|---|
| **Loading** | First load, or a background refresh? These render differently. |
| **Success** | Data present. |
| **Empty** | Success with zero results — a distinct design problem, not a blank success. |
| **Error** | Failed. Which failure? Retryable? |
| **Stale** | Showing cached data while revalidating. Is that indicated? |
| **Offline** | No connectivity. Different message and different affordance from "server error." |
| **Partial failure** | Some data loaded, some didn't. Render what worked. |

**Empty and stale are the two most often skipped**, and both are Department 3 and 4 collaborations: an empty state is a copywriting and UX opportunity, not an absence.

Model these as a discriminated union (Department 36.4), not as independent booleans — the illegal combinations then can't be represented.

---

## 38.4 Waterfalls and parallelization

A waterfall is a chain of requests where each waits for the previous **without needing to**:

```text
Request A          Request A ─┐
   ↓               Request B ─┼→ UI
Request B          Request C ─┘
   ↓
Request C          total: max(A,B,C)
total: A+B+C
```

**Where they come from**, in descending frequency:

1. **Sequential `await`s** with no dependency — the language-level cause in Department 36.2.
2. **Component-level fetching in nested components.** Parent fetches, renders, child mounts, child fetches. Each nesting level adds a full round trip. This is the dominant cause in React applications.
3. **Fetch-on-render after a lazy chunk loads** — chunk downloads, *then* the component mounts, *then* it fetches. Two serial round trips before anything appears.
4. **Auth-then-data** — fetching the session, then the data it gates, on every navigation.

**Mitigations:** hoist fetching to a route-level loader so requests start before components render; `Promise.all` genuinely independent work; prefetch on intent (hover, viewport, idle) so the request starts before the navigation; and colocate the split point with a prefetch so chunk and data load in parallel.

**Verification:** the network waterfall in DevTools is the diagnostic. A staircase where bars could be stacked is the signature. Report the depth of the longest serial chain on the critical path.

---

## 38.5 Request mechanics

**Cancellation.** Every request tied to a component lifecycle or a supersedable intent carries an `AbortController` signal (Department 36.2). Cancel on unmount; cancel the previous request when a new one supersedes it. An `AbortError` is an expected outcome, not an error state to render.

**Deduplication.** Multiple components requesting the same resource simultaneously should produce one network request. Server-state libraries do this by cache key; hand-rolled fetching does not, which is a large part of why hand-rolled fetching stops scaling around Level 2.

**Retries.** Retry only what is **idempotent**. GETs are safe. A POST that creates an order is not — unless the backend supports an idempotency key, which is a contract item to request from DEVPOINT rather than assume. Use exponential backoff with jitter; retrying instantly and in lockstep is how a recovering server gets knocked over again by its own clients. Do not retry 4xx (except 429): the request was wrong and will stay wrong.

**Batching.** Combining many small requests into one reduces overhead but couples their failures and latencies — the batch is as slow as its slowest member. Under HTTP/2 the per-request overhead is much lower (Department 47), which weakens the classic argument for batching considerably.

**Pagination.**

- *Offset* (`?page=2&limit=20`) — simple, jump-to-page works. Breaks under inserts: items shift between pages and get duplicated or skipped.
- *Cursor* (`?after=abc123`) — stable under concurrent writes, and the correct default for feeds and infinite scroll. No jump-to-page.

**Infinite scroll** is a UX decision with real costs before it's a data decision: no footer access, broken back-navigation and deep-linking unless position is restored, and unbounded DOM growth that becomes the memory and layout problem in Department 35.4. Virtualize beyond a few hundred rows, and preserve scroll position on return.

**Prefetching** on hover, viewport proximity, or idle converts latency into a cheap speculative request. Bound it — prefetching every link on a dense page is a self-inflicted load spike.

---

## 38.6 Optimistic updates

Apply the change locally before the server confirms, for latency that feels instant.

**Requires four things, all designed together:**
1. The predicted post-change state
2. A snapshot of the pre-change state
3. A **rollback path** on failure
4. Reconciliation with the server's actual response, which may differ from the prediction

**Appropriate when:** the operation almost always succeeds, the change is simple to predict, and reversal is comprehensible to the user — likes, toggles, reordering, adding a todo.
**Not appropriate when:** failure is common, the server computes something the client can't predict (totals, IDs, derived pricing), or the action is consequential — never optimistically confirm a payment or an irreversible submission.
**Complexity introduced:** two code paths per mutation, snapshot management, race handling when several optimistic updates are in flight.
**Failure modes:** rollback that flickers jarringly; rollback that loses concurrent user edits made after the optimistic apply; UI and server silently diverging when reconciliation is skipped.
**Simpler alternative:** a pending state on the control. For most mutations a disabled button with a spinner for 200ms is honest, cheap, and has no rollback semantics to get wrong.

**The rollback must be visible.** Silently reverting leaves the user believing an action succeeded. State what failed and offer a retry — Law 13.

---

## 38.7 Real-time sub-module *(activates at Level 3+)*

**Gate it explicitly.** State either *"Real-time: active — collaborative document presence and live comment stream"* or *"Real-time: not active — refetch-on-focus is sufficient at this update frequency."* Adding a WebSocket to a dashboard that updates hourly is infrastructure with no product behind it.

### Connection lifecycle

The connection is not a fact; it is a state machine with a failure mode at every edge:

```text
connecting → open → (degraded) → closed → reconnecting → open
```

**What must be designed, not discovered in production:**

- **Reconnection with exponential backoff and jitter.** A server restart otherwise means every client reconnecting in unison, repeatedly.
- **Authentication and its expiry.** The token was valid at connect. Sessions outlive tokens; define reauthentication on a long-lived socket.
- **Heartbeat / liveness.** TCP connections die silently — through NAT timeouts, sleeping laptops, mobile handoff. Without ping/pong the client believes it's connected while receiving nothing. This is the single most common real-time bug.
- **Backfill after reconnect.** Events missed while disconnected must be recovered — a sequence number or timestamp cursor to resume from. Without it, reconnection restores the connection and leaves the data permanently wrong.
- **Connection state in the UI.** "Reconnecting…" is a required interface state, not a debug detail.

### Event correctness

- **Duplicates** — at-least-once delivery is common; consumers must be idempotent, keyed by event id.
- **Ordering** — events can arrive out of order; use sequence numbers rather than arrival order where order matters.
- **Stale events** — an event predating local state must not overwrite it.
- **Conflicts** — two users editing the same field. Last-write-wins is a legitimate choice *when chosen and stated*; for genuine collaborative text, CRDT/OT is the real answer and is a major architectural commitment, not a feature.

### SSE vs WebSockets

Choose SSE unless bidirectionality is genuine. SSE runs over plain HTTP, reconnects automatically with `Last-Event-ID` resumption built in, and needs no special infrastructure. WebSockets buy client→server push and cost a stateful connection, manual reconnection, and sticky-session or pub/sub concerns on the backend — DEVPOINT's Departments 28 and 29 own that side. Many "real-time" features are server→client only and are simpler and more robust as SSE.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Request Lifecycle Rigor** | All seven states designed per surface; cancellation, dedup, idempotent-only retries with backoff | Loading and success only; no cancellation; blanket retries including mutations |
| **Failure Coverage** | Every failure-mode question in SKILL.md answered with an intentional UI response; races handled | Generic "something went wrong"; infinite spinner; double-submit possible |
| **Waterfall Discipline** *(inverse — 10 = flattest)* | Independent requests parallel; fetching hoisted above components; serial depth measured and stated | Nested component fetching; sequential awaits with no dependency; chunk-then-fetch chains |

## Real Measurable Targets to report

- **API contract inventory** — endpoint, request/response/error shape, auth, pagination, rate limit, idempotency per endpoint; each marked as *agreed with DEVPOINT* or *assumed*
- **Longest serial request chain** on the critical path (target: 1 for initial render)
- **Seven-state coverage** per async surface — pass/fail
- **Failure-mode checklist** from SKILL.md answered per critical interaction — pass/fail
- **Cancellation coverage** — every lifecycle-bound or supersedable request uses a signal
- **Retry policy stated** with which methods are retryable and the backoff parameters
- *(Level 3+)* **Reconnection backoff, heartbeat interval, and backfill mechanism** stated; duplicate and ordering strategy named
