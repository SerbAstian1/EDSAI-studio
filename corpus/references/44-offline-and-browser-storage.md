# Department 44: Browser Storage & Offline Systems

## Role

Owns durable client-side state: which storage mechanism holds what, and — at Level 4 — the offline architecture built on top of it, including queueing, synchronization, and conflict resolution.

**Activation: Level 4+ in full.** The storage-mechanism decision (§44.1) applies from Level 1, because any app that persists anything has made one, knowingly or not.

**Boundary:** Department 35 covers storage APIs as browser runtime facts; Department 40 covers their security tradeoffs; this department covers **architecture** — what to store, where, and how it reconciles with the server.

## The core failure this department exists to prevent

**Building offline capability nobody needed.** A service worker plus IndexedDB plus a sync queue is a distributed system running in a browser, with all the attendant problems: divergent state, conflict resolution, cache lifecycle, and update semantics. It is the single largest complexity increase available to a frontend, and it is frequently adopted because it sounds modern rather than because users lose connectivity.

> **Never add offline architecture unless the product actually benefits from it.**

The honest test: *do real users of this product lose connectivity while needing to keep working?* Field technicians, warehouse scanners, transit and travel apps, clinical tools in basements — yes. A dashboard checked from an office — no. "Better on flaky Wi-Fi" is usually solved by retry, cache, and honest offline messaging (Departments 38, 41, 47), which cost a fraction of this.

The second failure is the mirror image: **shipping a product that breaks confusingly when the network drops**, when a small amount of the above would have made it degrade gracefully.

---

## 44.1 Choosing a storage mechanism

| Mechanism | Capacity | API | Good for | Never for |
|---|---|---|---|---|
| **Cookies** | ~4KB | Sync | Session tokens the server must see | Application data |
| **localStorage** | ~5–10MB | **Sync, blocking** | Small preferences: theme, locale, dismissed banners | Datasets, anything large, credentials |
| **sessionStorage** | ~5–10MB | **Sync, blocking** | Per-tab ephemeral state: a wizard's progress | Anything that should survive a tab close |
| **IndexedDB** | Quota-based, large | Async, transactional, indexed | Structured datasets, offline records, queues | Small flags (overkill) |
| **Cache Storage** | Quota-based | Async | HTTP request/response pairs, app shell | Structured queryable data |

**Three decision rules that resolve most cases:**

1. **If it's more than a few KB, or read on the critical path, it is not localStorage.** Synchronous reads block the main thread (Department 35.3), so a large parse at startup is a measurable delay before first paint.
2. **If it's queryable structured data, it's IndexedDB.** The raw API is famously unpleasant; use a wrapper (idb, Dexie) rather than hand-rolling transactions.
3. **If it's HTTP responses, it's Cache Storage**, which is designed for exactly that pairing and is what a service worker manipulates.

**All storage can fail** and every access assumes it will: disabled by policy, quota exceeded, private browsing restrictions, Safari ITP eviction after seven days of inactivity, or a user clearing site data. Wrap every read and write; define what the UI does when storage is unavailable — Law 13.

**Storage is not durable.** Browsers evict under pressure. `navigator.storage.persist()` requests durability and may be refused. **Never treat browser storage as the only copy of anything the user would be upset to lose**, and say so in the UI if unsynced work exists.

**Schema versioning is required.** Data written by version 3 of your app will be read by version 7. IndexedDB has explicit `onupgradeneeded` migrations — use them. For localStorage, store a version alongside the payload and validate on read (Department 36.5: storage reads are untrusted input, because a previous version of your own code wrote them).

---

## 44.2 Service workers

A programmable proxy sitting between the app and the network, with a lifecycle independent of any page.

```text
install → (waiting) → activate → controlling fetches
```

**The properties that make it powerful are the ones that make it dangerous:**

- It **persists** across reloads and outlives the page that registered it.
- It **controls its own update**. A new worker installs but waits until all controlled pages close, so a user with a pinned tab may run last month's code indefinitely. `skipWaiting` forces activation, at the risk of swapping assets under a running page — a deliberate choice with real consequences either way.
- A broken worker **serves the page that would have fixed it.**

**Non-negotiable requirements before shipping one:**

1. A **kill switch** — a deployable worker that unregisters itself and clears caches. Without it you cannot recover from your own bug remotely.
2. A **defined update path**, with an "update available, reload" affordance if using the waiting model.
3. **Strategy per resource class** (Department 41.4), never one global strategy.
4. **Never cache-first on authenticated API responses.** That is how one user's data reaches another on a shared device.
5. **Test the update path**, not just the install path. Nearly all service worker incidents are update incidents.

**Web Workers** are a different thing entirely and worth not confusing: background threads for CPU-bound computation, no DOM access, no network interception. Department 35.3 covers when they're worth the serialization cost. **BroadcastChannel** is the mechanism for cross-tab messaging — the answer to the multi-tab problem raised in Department 37.6.

---

## 44.3 Offline architecture *(Level 4)*

**Detection.** `navigator.onLine` reports whether a network interface exists, not whether the internet is reachable — it is a hint. Confirm with an actual lightweight request, and treat a failed request as the real signal.

**The offline UI is a designed state, not a toast.** Users need to know: that they're offline, that their work is saved locally, what will happen when they reconnect, and which actions are unavailable now. This is Department 3 and 4 work, and skipping it produces an app that appears to accept input and silently discards it.

**Queued writes.** Mutations made offline are recorded durably (IndexedDB, not memory) and replayed on reconnect.

Requirements that are easy to miss and expensive to retrofit:

- **Idempotency.** A replayed mutation must not create a duplicate. Each queued operation carries a client-generated id, and the server deduplicates on it — a contract item to negotiate with DEVPOINT, not to assume.
- **Ordering.** Replay in the order created; a create followed by an edit must not arrive reversed.
- **Failure handling.** A queued write can be rejected on replay — validation moved on, the record was deleted, permission changed. There must be a path for surfacing that to the user, potentially long after they performed the action. This is the hardest UX problem in offline work.
- **Bounded growth.** A queue that grows for weeks offline needs a size cap and a policy for what happens at it.

**Background Sync** (Chromium) lets the browser replay a queue after the app is closed. Genuinely useful, unevenly supported — treat as progressive enhancement over an on-reconnect replay, never as the only path.

---

## 44.4 Synchronization and conflict resolution

The moment local state can diverge from server state, this becomes a distributed-systems problem, and pretending otherwise is how the data corruption happens.

**Conflict strategies, from simplest to hardest:**

| Strategy | Mechanism | Cost |
|---|---|---|
| **Last-write-wins** | Latest timestamp overwrites | Silent data loss; needs clock-skew tolerance |
| **Server-wins** | Server state always overwrites local | Discards user's offline work |
| **Client-wins** | Local overwrites server | Discards others' work |
| **Version detection** | Version/ETag; reject stale writes and surface a conflict | Requires a user-facing resolution UI |
| **Field-level merge** | Merge non-overlapping field edits | Only sound for independent fields |
| **CRDT / OT** | Convergent data structures for concurrent editing | Major architectural commitment |

**Last-write-wins is a legitimate choice when chosen and stated** — for a per-user preference, it is exactly right. For shared records where two people's work matters, it is silent data loss with good ergonomics.

**Version detection with a resolution UI is the correct default for shared editable records.** It's the only option in the middle of the table that neither loses data nor requires a rewrite of your data model.

**CRDTs are for genuinely concurrent collaborative editing** (documents, whiteboards) and are a foundational commitment — the data model, storage, and network layer all change. Not a feature to add later.

**Stale data on reconnect.** After reconnecting, local reads may be badly out of date. Refetch what matters, indicate what's refreshing, and never silently show old data as if it were current — Law 11.

---

## 44.5 PWA

Installability is a small set of requirements — a web app manifest, HTTPS, icons, and (for some install criteria) a service worker.

**What it buys:** home-screen presence, standalone display, and better retention for genuinely app-like products. **What it does not buy:** the offline behavior, which is entirely the service worker's job. A PWA without offline design is a bookmark with an icon.

**Push notifications** require permission, and the permission prompt is a one-shot resource. Requesting it on load, before demonstrating value, burns it — a denial is effectively permanent. Ask contextually, after the user has done something that makes the value obvious.

**Appropriate when:** repeat-use, app-like product, mobile-heavy audience, real offline or re-engagement need.
**Not appropriate when:** content site with occasional visits — installability adds a prompt nobody wants and a service worker nobody needs.
**Complexity introduced:** the entire service worker lifecycle, cache versioning, update semantics, and platform-specific install quirks.
**Failure modes:** stale cached shells, iOS storage eviction, an update path that strands users.
**Simpler alternative:** a fast, well-cached responsive site — which for most content products is what users actually wanted.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Storage Mechanism Fit** | Mechanism per dataset justified on size/sync/durability; schema versioned; every access failure-tolerant | localStorage as a general database; large sync reads on the critical path; no versioning |
| **Sync Correctness** | Queue durable, idempotent, ordered, bounded; replay failures surfaced; reconnect refetch defined | Queue in memory; duplicates on replay; rejected writes vanish silently |
| **Conflict Resolution Clarity** | Strategy named per dataset with its data-loss implications stated; resolution UI where records are shared | Last-write-wins by default, unstated; conflicts discovered as user-reported data loss |

## Real Measurable Targets to report

- **Storage mechanism per persisted dataset**, with size and access-frequency justification
- **Schema version and migration path** stated per store
- **Storage-unavailable behavior** defined and tested — pass/fail
- *(SW)* **Kill switch implemented and tested**, update path defined, strategy stated per resource class — pass/fail
- *(SW)* **No cache-first on authenticated responses** — pass/fail
- *(offline)* **Queue durability, idempotency key, ordering guarantee, and size cap** — stated
- *(offline)* **Replay-failure surfacing path** defined
- **Conflict strategy per dataset**, with data-loss implications stated explicitly
- *(PWA)* **Manifest, install criteria**, and the contextual permission-request trigger
