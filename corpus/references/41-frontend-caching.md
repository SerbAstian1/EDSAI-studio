# Department 41: Caching & Client Data Architecture

## Role

Owns the full cache stack as the frontend experiences it — HTTP, CDN, service worker, and query cache — and, more importantly, the **freshness policy** for every dataset the application displays.

**Activation: Level 2+ in full.** HTTP and CDN caching apply from Level 0, because every static asset is cached whether or not anyone decided how.

## The core failure this department exists to prevent

**Caching with no invalidation story** — Law 11. Caching is easy to add and hard to reason about, and the failure mode is not a crash: it is a user looking at data that is quietly wrong. Worse, it's wrong *intermittently* and *per-user*, so it reproduces for nobody and gets closed as unreproducible.

The second failure is **treating "cached" as a binary property.** There are four or five layers between the origin and the pixel, each with independent lifetimes. "It's cached" without naming the layer explains nothing and predicts nothing.

---

## 41.1 The layers

Data can be held at every one of these, simultaneously, with different lifetimes:

```text
Origin server
    ↓
CDN / edge cache          ← shared across all users
    ↓
HTTP browser cache        ← per user, per browser, disk/memory
    ↓
Service worker cache      ← per user, programmatic, survives offline
    ↓
Query cache (in memory)   ← per session, per tab
    ↓
Component state           ← per mount
```

**A stale value can live at any layer**, and a purge at one does nothing to the others. This is why "I cleared the CDN and it's still wrong" is such a common report: the browser's HTTP cache and the service worker each hold their own copy, on their own schedule.

**The practical consequence for design:** name the authoritative layer per dataset, and specify what invalidates each layer holding it. A cache with no named invalidation trigger is a bug with a delay.

---

## 41.2 HTTP caching

The mechanism the other layers are built on.

**`Cache-Control` directives that carry real weight:**

| Directive | Meaning |
|---|---|
| `max-age=N` | Fresh for N seconds; served without contacting the server |
| `s-maxage=N` | Same, for shared caches (CDN) — lets CDN and browser diverge deliberately |
| `no-cache` | **Store it, but revalidate before use.** Not "don't cache" — the most commonly misread directive |
| `no-store` | Never write it down. For genuinely sensitive responses |
| `immutable` | Never revalidate within `max-age`; the content cannot change |
| `stale-while-revalidate=N` | Serve stale instantly, refresh in the background |
| `private` / `public` | Whether shared caches may store it |

**Validators, for when freshness expires:**

- **`ETag`** — a content fingerprint. The client sends `If-None-Match`; the server answers `304 Not Modified` with no body. Saves bandwidth, still costs a round trip.
- **`Last-Modified`** — timestamp-based, one-second granularity, weaker but cheaper.

**`stale-while-revalidate` is the highest-leverage directive in this table** for perceived performance: the user gets an instant response from cache while the refresh happens invisibly. It trades a bounded window of staleness for the elimination of a wait, and for most content that is exactly the right trade. For an account balance or an inventory count, it is not — which is the entire point of §41.5.

**The canonical asset policy**, which pairs with Department 43's content hashing:

- **Hashed static assets** (`app.a3f9c2.js`): `max-age=31536000, immutable`. The filename changes when the content does, so it can never be stale.
- **HTML**: `no-cache` or a short `max-age` with revalidation. HTML points at the hashed assets and must be able to point at new ones.

Getting this backwards — long-cached HTML referencing hashed assets — produces the worst deploy bug in frontend: users pinned to an old HTML file requesting chunks that no longer exist, seeing a broken app until they hard-refresh. Department 43's chunk-load error boundary is the safety net; this policy is the actual fix.

---

## 41.3 Query cache (server state)

The in-memory cache a server-state library maintains, keyed by query. This is where most Level 2+ data behavior actually lives.

**What it provides**, and why hand-rolled fetching stops scaling without it: deduplication of concurrent identical requests, background revalidation, stale-while-revalidate semantics in the client, retry with backoff, and shared subscriptions so ten components reading the same query cause one request.

**The two settings that matter most, and are most often confused:**

- **Stale time** — how long data is considered fresh. While fresh, no refetch happens at all. This is the knob that controls request volume.
- **Cache time / GC time** — how long unused data is retained in memory after its last consumer unmounts. Controls whether a back-navigation shows instant cached content or an empty loading state.

**Cache keys are the contract.** A key must include every input that changes the result — filters, pagination, sort, locale, and **user identity**. A key that omits the user is a data-leak-shaped bug: user B sees user A's cached response after a login switch on a shared device. **Clear the cache on logout**, always.

**Invalidation triggers to define per query:** after a related mutation, on window focus, on reconnect, on an interval, or on a real-time event. "Invalidate everything after any mutation" is a legitimate starting policy for a small app and a performance problem in a large one — state which you're doing.

---

## 41.4 Service worker caching

A programmable proxy between the app and the network. Owned jointly with **Department 44**, which covers the offline architecture it enables; this section covers the caching strategies only.

| Strategy | Behavior | Fits |
|---|---|---|
| **Cache-first** | Cache, network only on miss | Hashed immutable assets, fonts |
| **Network-first** | Network, cache as fallback | HTML, frequently changing data |
| **Stale-while-revalidate** | Cache immediately, refresh behind it | Avatars, semi-static content, non-critical API responses |
| **Network-only** | Never cache | Mutations, authenticated sensitive reads |
| **Cache-only** | Never network | Precached app shell |

**Never apply a single strategy across the whole application.** Cache-first on an API response is how users see last week's data with no way to refresh. Match the strategy to the resource.

**The failure mode that defines this layer:** a service worker is *sticky*. A bad one persists across reloads because it is serving the page that would have updated it. Every service worker therefore needs a considered update and activation path, a skip-waiting decision, and — non-negotiable — a **kill switch**: a deployable version that unregisters and clears caches. Shipping a service worker without one is a decision to be unable to recover from your own bug.

---

## 41.5 Freshness policy — the actual deliverable

> **Cached data must have a defined freshness and invalidation strategy.** Law 11.

For each dataset, state four things:

1. **Staleness tolerance** — how out-of-date may this be before it is *wrong*, not just old?
2. **Freshness window** — the concrete number that implements that tolerance.
3. **Invalidation trigger** — what forces a refresh: a mutation, focus, reconnect, an event, an interval.
4. **Authoritative layer** — which cache is the source of truth for this dataset.

**Staleness tolerance is a product decision, not a technical one**, and it varies enormously across a single application:

| Data | Tolerance | Reasoning |
|---|---|---|
| Marketing copy, docs | Hours to a deploy | Nobody is harmed by yesterday's phrasing |
| Product catalogue | Minutes | Slight lag acceptable, wrong price is not |
| Inventory / availability | Seconds | Overselling is a business failure |
| Account balance, order status | **Zero** | Displaying a stale balance is a trust failure |
| Notifications, presence | Real-time | Stale is functionally broken |

**Escalate this to the client or product owner where the answer isn't obvious.** "How wrong may this number be?" is a question a stakeholder can answer and an engineer cannot. Department 8's client simulation applies — a luxury retailer and a logistics operator will answer differently for what looks like the same field.

**When data is showing stale, say so.** A subtle refresh indicator, a timestamp, or a manual refresh affordance turns a potential trust failure into an informed one. This is Law 13 and a Department 3/4 collaboration.

---

## 41.6 Cache busting

**Content hashing** (Department 43) is the mechanism: the filename derives from the content, so a change produces a new URL and the old cache entry becomes irrelevant rather than stale. This is what makes `immutable` safe.

**Query-string versioning** (`?v=2`) is weaker — some intermediary caches ignore query strings for cache-key purposes — and should not be used for assets where hashing is available.

**What hashing cannot solve:** an open session holding old HTML, an active service worker serving old content, and CDN entries not yet purged. Each needs its own handling, which is §41.2 and §41.4.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Freshness Policy Clarity** | Every dataset has a stated tolerance, window, trigger, and authoritative layer; tolerances escalated to product where non-obvious | "It's cached"; no window stated; tolerance never asked about |
| **Invalidation Rigor** | Every cached dataset names what invalidates it at each holding layer; logout clears; keys include all inputs incl. user | No invalidation path; keys omit filters or identity; cache survives logout |
| **Cache Layer Fit** | Strategy matched per resource; asset/HTML policies correct; SW strategies varied and a kill switch exists | One strategy applied globally; long-cached HTML; SW shipped with no recovery path |

## Real Measurable Targets to report

- **Freshness table** — per dataset: tolerance, window, invalidation trigger, authoritative layer
- **`Cache-Control` per response class** — hashed assets `immutable` with a year, HTML revalidating: pass/fail
- **CDN cache hit ratio** for static assets, and any cache-key fragmentation identified
- **Query cache configuration** — stale time and GC time stated per query class, with the reasoning
- **Cache keys include user identity** where responses are user-scoped, and **cache cleared on logout** — pass/fail
- *(where a service worker exists)* **Strategy named per route/resource class**, plus a documented and tested **kill switch** — pass/fail
