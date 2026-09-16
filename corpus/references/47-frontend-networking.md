# Department 47: Frontend Networking

## Role

Owns the **frontend consequences** of how bytes reach the browser — connection setup, protocol behavior, compression, edge delivery, and what happens to the interface when the network is slow, lossy, or absent.

**Activation: Level 1+ in full.** At Level 0 the request-path basics still apply — every static site pays DNS, TLS, and connection setup costs on first load, and those costs are a large share of a first-visit LCP.

**Boundary with DEVPOINT Department 28.** DEVPOINT reasons about transport, TLS termination, proxies, gateways, load balancing, and service-to-service protocol. **This department does not duplicate that.** It reasons about what the frontend can observe, influence, and must survive. Same topic, different altitude.

## The core failure this department exists to prevent

**Developing on a fast, stable connection and shipping to a slow, unstable one** — Law 4. On localhost, latency is zero, bandwidth is infinite, and requests never fail. Every architectural decision made under those conditions is untested against the conditions real users have. The result is an interface that is correct and unusable on a train.

The second failure is **counting bytes and ignoring round trips.** On a high-latency connection, a 20KB response fetched after three sequential round trips arrives later than a 200KB response fetched immediately. Latency, not bandwidth, dominates perceived load time on mobile networks.

---

## 47.1 The request path

Every first request pays this sequence before a single byte of content arrives:

```text
User
 ↓  DNS lookup          (0 or 1 round trip, cached after)
 ↓  TCP handshake       (1 round trip)
 ↓  TLS handshake       (1 round trip with TLS 1.3, 2 with 1.2)
 ↓  HTTP request        (1 round trip to first byte)
 ↓  CDN / origin
 ↓  HTML
 ↓  CSS / JS discovered and requested  ← more round trips
 ↓  Parse → Execute → Render → Hydrate → Interactive
```

**The frontend-relevant consequences:**

- **DNS latency delays connection establishment**, and it is paid per unique hostname. Every additional third-party domain is a fresh DNS + TCP + TLS sequence before that resource can even begin downloading. This is the concrete cost of "just adding one more script."
- **TLS 1.3 halves handshake cost** versus 1.2, and supports session resumption. A server configuration detail, but the frontend feels it directly on first visit.
- **Subresources are discovered by the parser**, so a stylesheet referenced late, or a font referenced from inside a CSS file, is discovered late — a round trip that could have started earlier. `preload` exists precisely to break that dependency.

**Resource hints, matched to the problem each solves:**

| Hint | Solves | Cost of overuse |
|---|---|---|
| `dns-prefetch` | DNS latency for a known third-party host | Negligible |
| `preconnect` | DNS + TCP + TLS for a host you'll certainly use | Holds open connections; limit to ~2–4 critical origins |
| `preload` | Late discovery of a critical resource (font, hero image, key chunk) | Competes with genuinely critical resources; wasted bandwidth if unused |
| `prefetch` | Likely *next* navigation | Speculative bandwidth on metered connections |
| `fetchpriority` | Reprioritizing within a resource type (LCP image high, below-fold low) | Priority inversion if misapplied |

**Overuse inverts the benefit.** Preloading ten resources tells the browser everything is critical, which tells it nothing. Preload the LCP image and the font that renders above the fold; that is usually the entire correct list.

---

## 47.2 Protocol behavior

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Concurrency | ~6 connections per origin | Multiplexed on one connection | Multiplexed over QUIC/UDP |
| Head-of-line blocking | At request level | At **TCP** level | **None** — independent streams |
| Header cost | Full headers per request | Compressed (HPACK) | Compressed (QPACK) |
| Connection migration | No | No | **Yes** — survives network change |

**What follows for frontend decisions:**

- **HTTP/2 multiplexing removes the per-request penalty that justified two generations of frontend folklore.** Domain sharding, sprite sheets, and aggressive file concatenation were workarounds for the six-connection limit. Under HTTP/2 they are actively harmful — sharding fragments the connection, and one enormous bundle defeats granular caching, since one changed byte invalidates the whole file.
- **HTTP/2 still suffers TCP head-of-line blocking.** A lost packet stalls *every* multiplexed stream on that connection, which is why H2 can underperform on lossy mobile networks despite better theory.
- **HTTP/3 removes that**, and its connection migration means a user moving from Wi-Fi to cellular keeps the connection rather than renegotiating. Real benefit on mobile, minimal on stable broadband.
- **Connection reuse matters more than it appears.** Keeping requests on one origin reuses the warm connection; scattering them across five domains means five cold starts.

**Practical stance:** enable H2/H3 at the server or CDN (a DEVPOINT/platform action), and on the frontend side, stop applying H1-era workarounds. Split bundles for **caching granularity** (Department 43), not to dodge a connection limit that no longer exists.

---

## 47.3 Compression

- **Brotli** beats gzip meaningfully on text (HTML, CSS, JS, JSON) and is broadly supported. Static assets should be compressed at build time at maximum level; dynamic responses at a moderate level to balance CPU.
- **Already-compressed formats** (images, video, woff2, zip) gain nothing from a second pass. Compressing them wastes CPU on both ends.
- **Images are the larger win in most projects.** Modern formats (AVIF, WebP) with correct sizing and `srcset` typically save more bytes than any JS optimization available. Serve at the actual display dimension; a 3000px hero scaled to 800px in CSS is roughly a 90% waste.
- **Fonts:** woff2, subset to the characters actually used, `font-display: swap` (or `optional`) to avoid blocking text render, `preload` only the one or two faces that render above the fold.

---

## 47.4 CDN and edge delivery

**Mechanism:** cache copies of assets at points of presence near users, so a request travels tens of milliseconds instead of hundreds and never reaches origin.

**Frontend-owned consequences:**

- **Static assets are content-hashed and served immutable** with a long `max-age`, so returning users re-download nothing that hasn't changed. This is the reason Department 43's hashing matters.
- **HTML is the exception** — usually a short TTL or a revalidation model, because it references the hashed assets and must be able to point at new ones.
- **Cache-key awareness.** Varying on cookies or user-agent can fragment the cache into near-uselessness; a query parameter appended by a marketing tool can bypass it entirely. Worth checking rather than assuming a hit rate.

Cache *policy* — freshness windows, invalidation, `stale-while-revalidate`, layering — belongs to **Department 41**, which owns the whole cache stack. This section covers only the delivery consequence.

---

## 47.5 Designing for real network conditions

**The interface must be designed against the network your users actually have.** State the assumed profile explicitly — device class, connection type, geography — and design against it rather than against the office Wi-Fi.

**Required behaviors:**

- **Slow.** Skeletons or progressive rendering rather than a blocking spinner; render what has arrived (this is where streaming SSR and `Promise.allSettled` pay off); make perceived progress honest.
- **Failed.** A distinguishable message and a retry affordance, with the user's input preserved. Department 38 owns the mechanics.
- **Offline.** Detect it and say so specifically — "You're offline" is actionable in a way "Request failed" is not. Note that `navigator.onLine` reports only whether an interface is up, not whether the internet is reachable; treat it as a hint and confirm with an actual request. Queueing writes while offline is Department 44 territory and gated at Level 4.
- **Reconnected.** Refetch what went stale, retry what's safe to retry, and tell the user the view has updated.
- **Lossy or intermittent** — the hardest case, and the one localhost never reproduces. Timeouts must exist (a request with no timeout can hang indefinitely), and duplicate submissions must be impossible on flaky connections where users tap twice.

**Verification is non-negotiable here:** test on throttled network profiles and on a real mid-tier device, not only in a desktop emulator. Slow 3G with 400ms RTT is a legitimate development condition, and most network bugs are invisible above it. Add a failure-injection pass — drop requests, delay them, return errors — because the failure paths are the ones no manual testing exercises.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Network Efficiency** | Compression and image formats correct; hints targeted at the actual critical path; connection reuse considered; H1-era workarounds absent | Uncompressed or oversized assets; preload sprayed; domain sharding retained; hero image served at full resolution |
| **Latency Awareness** | Round trips counted, not just bytes; third-party origin cost stated; protocol behavior reflected in decisions | Optimized for bandwidth only; every new script domain treated as free |
| **Connection Resilience** | Timeouts everywhere; offline distinguished from error; reconnection refetch defined; tested under throttling and failure injection | No timeouts; generic failure message; never tested off a fast connection |

## Real Measurable Targets to report

- **TTFB** (target <800ms) and the **DNS + TCP + TLS** portion of first load
- **Number of distinct origins** contacted on the critical path, each justified
- **Compression** enabled and algorithm named per asset type — pass/fail
- **Image delivery**: format, served vs displayed dimensions, total image weight on the primary route
- **Font delivery**: format, subset, `font-display` value, preload count
- **Resource hints inventory** — each hint with the specific resource and the problem it solves
- **Protocol in use** (H2/H3) confirmed at the CDN/server
- **Immutable caching** on content-hashed assets, with the HTML TTL stated separately
- **Throttled-profile test result** — LCP and INP on the stated target device and connection profile, not just on desktop broadband
