# Department 45: Frontend Observability

## Role

Owns knowing what the application actually does **in production, on real users' devices** — errors, performance, and the traceable path of a request from a click to the backend.

**Activation: Level 1+ when production-facing.** A Level 0 marketing site needs analytics and Core Web Vitals field data; it does not need distributed tracing.

**Boundary with DEVPOINT Department 22.** This department owns the browser side: client errors, RUM, session replay, source maps, client spans. DEVPOINT owns server metrics, logs, backend traces, and alerting. **The correlation between them is jointly owned** and is the most valuable thing either side produces — see §45.5.

## The core failure this department exists to prevent

**Finding out from users.** Lab metrics are measured on a fast machine, on a fast connection, in one location, with no extensions, on the developer's own browser. Real users are on three-year-old mid-range Android phones, on congested mobile networks, with ad blockers, on Safari, in a country you have not tested from. **Lab data tells you whether it can be fast; field data tells you whether it is.** Optimizing against lab data alone is optimizing against a fiction.

The second failure is **error monitoring that reports nothing usable** — minified stack traces, no user context, no breadcrumbs, unhandled rejections invisible. The errors are captured and nobody can act on any of them.

---

## 45.1 Error monitoring

**Capture all four sources.** The first is the one everyone wires up; the others are the ones that silently swallow real failures:

| Source | Mechanism |
|---|---|
| Uncaught exceptions | `window.onerror` |
| **Unhandled promise rejections** | `window.onunhandledrejection` — **does not** surface through `onerror` (Department 36.2) |
| Framework render errors | React error boundaries, caught before the tree unmounts |
| Resource load failures | `error` events on scripts, images, stylesheets — a failed chunk is a broken app |

**Error boundaries are a product decision, not just a safety net.** Placement determines what the user sees when something breaks: a boundary at the root turns any error into a blank page; boundaries per route or per widget mean one broken panel while the rest of the page works — Law 13. Every boundary needs a recovery affordance (retry, reload, navigate away), because a dead end with an apology is still a dead end.

**Source maps are mandatory for this to be useful at all.** Generate in CI, upload to the monitoring service, do not deploy publicly (Department 43.6). Without them every report reads `chunk-a3f9.js:1:48210` and the whole system produces noise.

**Context is what makes an error actionable.** Attach: release version, route, user agent and device class, session id, and a breadcrumb trail of the last N actions and network calls. "TypeError: undefined is not an object" is useless; the same error with the route, the release, and the three clicks before it is a bug report.

**Errors need triage, not just capture.** Group by fingerprint, deduplicate, and set an alerting threshold. A dashboard with 4,000 ungrouped events is ignored within a week. Also filter aggressively: browser extension errors, third-party script noise, and cancelled requests (`AbortError` — an expected outcome, per Department 36.2) should not page anyone.

---

## 45.2 Real User Monitoring

**Report Core Web Vitals from the field**, not from Lighthouse. Use the `web-vitals` library, which implements the metrics as the browser defines them.

- **LCP, INP, CLS** as the primary set (Department 8 owns the targets).
- **Report at the 75th percentile**, not the mean. Averages hide the tail, and the tail is where users abandon.
- **Segment by dimensions that change the answer**: device class, connection type, country, route, and release. A "good" aggregate LCP routinely conceals a catastrophic one on mid-tier Android — and that segment is often the largest.
- **Attribute, don't just measure.** Which element was the LCP? Which script and interaction caused the worst INP? Which node shifted? Attribution turns a number into a task.

**Custom timings** for things the standard metrics don't capture: time-to-first-meaningful-data, search-results-rendered, checkout-step-completed. Use the browser's Performance API (`mark`/`measure`) rather than manual timestamps.

**Sample thoughtfully.** Full RUM on high-traffic sites is expensive; sample, but never sample errors and never sample so aggressively that a small segment disappears from the data entirely.

---

## 45.3 Synthetic monitoring

Scripted runs of known journeys from controlled environments, on a schedule.

**What it provides that RUM cannot:** detection before a user is affected, a stable baseline unaffected by traffic mix, and coverage of low-traffic-but-critical paths (checkout at 4am) that RUM samples too thinly to trend.

**What it cannot provide:** the truth about real device and network diversity. **The two are complements**, and using either alone leaves a real blind spot — synthetic says "checkout works," RUM says "checkout is slow for 30% of users on Android."

Monitor the critical journeys, not the homepage alone. A homepage check passes while checkout is broken.

---

## 45.4 Session replay

Reconstructs a user's session — DOM mutations, interactions, network events.

**Value:** the fastest route from "we can't reproduce it" to a fix, and unmatched for understanding *confusing* UX rather than broken UX.

**The privacy obligations are serious and non-optional:**

- **Mask by default**, allowlist what's recorded — not the reverse. A blocklist misses the field added last sprint.
- **Never record** passwords, payment fields, government identifiers, health information, or message content.
- **Consent and jurisdiction** — GDPR and similar regimes apply; recording a session is processing personal data.
- **Retention limits**, access controls, and a documented rationale.

> **Never expose sensitive information merely for debugging.** This applies to replay, to error context, to breadcrumbs, and to logs. A token, an email address, or a full API response in an error payload is a data leak sitting in a third-party service.

*Appropriate when:* hard-to-reproduce bugs or UX research on real behavior. *Not appropriate when:* the product handles sensitive data and masking cannot be verified. *Simpler alternative:* breadcrumbs plus good error context, which solve much of the same problem with far less exposure.

---

## 45.5 Tracing and correlation

The highest-value thing this department produces jointly with DEVPOINT: **one identifier connecting a user's click to the database query it caused.**

```text
User Action
    ↓
Browser Span      ← EDSAI
    ↓
API Request       ← trace context propagated in headers
    ↓
Backend Span      ← DEVPOINT
    ↓
Database Span     ← DEVPOINT
```

**Mechanism:** the frontend generates a trace id and propagates it on outbound requests (W3C `traceparent` is the standard; agree the header with DEVPOINT rather than inventing one). The backend continues the same trace. A slow interaction then resolves into "which part was slow" instead of an argument.

**Three ids, three jobs:**

- **Trace id** — one operation end to end across systems
- **Session id** — one user's continuous visit
- **Request/correlation id** — one specific call, useful in support ("what's the reference in the error message?")

**Surface the correlation id in user-facing error messages.** It converts a support conversation from "it was broken yesterday" into an exact lookup, and costs nothing.

**CORS caveat worth knowing before it wastes an afternoon:** custom trace headers on cross-origin requests trigger preflight and must be listed in `Access-Control-Allow-Headers`. Coordinate with DEVPOINT (Department 40.1).

---

## 45.6 What to actually watch

Observability without a defined signal is a dashboard nobody opens. State, for this project:

1. **What breaks the product** — the critical flows whose failure is unacceptable, and their alert thresholds
2. **Who is alerted**, and what they can do about it
3. **The error-rate baseline**, so a regression is visible as a change rather than a number
4. **Which performance regressions matter** — a p75 LCP crossing the budget on the primary route, not a 5ms fluctuation
5. **Release correlation** — every metric segmented by release, so a regression is attributable to a deploy immediately

**Alert on user impact, not on events.** "Error rate on checkout exceeded 2% for five minutes" is actionable. "An error occurred" is not.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Error Visibility** | All four sources captured; source maps uploaded; rich context and breadcrumbs; grouped, filtered, thresholded | Only `onerror`; minified traces; rejections invisible; nobody reads the dashboard |
| **Performance Visibility** | Field CWV at p75, segmented by device/connection/route/release, with attribution | Lighthouse only; lab data treated as truth; no segmentation |
| **Traceability** | Trace context propagated and continued by DEVPOINT; correlation id surfaced to users | No correlation; frontend and backend timelines cannot be joined |
| **Production Diagnostics** | Critical flows monitored synthetically and in RUM; alerts tied to user impact; release-segmented | No synthetic coverage; alerts on raw counts or nothing at all |

## Real Measurable Targets to report

- **Error sources captured** — all four, pass/fail each
- **Source maps uploaded, not publicly served** — pass/fail
- **Field CWV at p75** per primary route, segmented by device class and connection
- **Error-boundary map** — placement per route/widget, each with a recovery affordance
- **Error rate baseline** and the alert threshold per critical flow
- **Synthetic checks** — the journeys covered and their frequency
- **Trace propagation** — header agreed with DEVPOINT, CORS allowance confirmed, correlation id surfaced in user-facing errors
- *(replay, if used)* **Masking policy documented**, consent basis stated, retention limit set
