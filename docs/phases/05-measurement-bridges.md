# Phase 5 — Measurement bridges

**Status:** built. `@edsai/measure`, 108 tests. The measurement half is proven
against live hosts; the PageSpeed path is proven up to Google's quota.

## What this phase is for

Departments 8, 40 and 43 each end with a list headed *"Real Measurable Targets
to report"*. Before this package, a department could only ever **assert** those
numbers — and the engine correctly refuses an `actual` whose `source` is not
`instrument`, so the rows either carried `stated-target` or did not exist.

`measurementTargets()` closes that: every row it returns carries
`source: 'instrument'` and the name of the instrument that produced it, because
a tool call in that turn genuinely did.

## The architectural line

> Every instrument in this system is a pure function, and these stay pure. The
> network lives in `probes.ts` and nowhere else — a probe fetches and
> normalises, the record is stored, the instrument evaluates it, and re-checking
> against a different budget never touches the network again.

That split is why `edsai-measure` has two commands rather than one. `collect`
reaches the network and writes a records file; `report` reads it and judges,
touching nothing. A measurement taken once can be re-read months later without
pretending to re-take it, and a changed budget is re-judged for free.

```
packages/measure/src
  guard.ts     refuse a URL before any fetch, with the reason
  probes.ts    the only network code: PageSpeed Insights, response headers
  records.ts   what a probe brings back, before anything judges it
  vite.ts      read a Vite build's manifest into a bundle record
  import.ts    axe-core results, which a browser produces and no probe can
  web-vitals.ts / headers.ts / bundle.ts / axe.ts   pure instruments
  targets.ts   the join: records in, Target rows out
```

## The four instruments

**`web_vitals_audit`** implements the rule the corpus states and almost nothing
implements: **field data outranks lab**. Where CrUX has the page, the verdict is
the field number and the Lighthouse number is still reported beside it, because
that is what a developer iterates against between deploys. Origin-level fallback
is flagged, since a slow page hides inside a fast origin. Every miss carries a
diagnosis rather than a restatement — TTFB as a share of the LCP budget, the
FCP→LCP gap for a hero asset, TBT behind a bad INP.

**`header_audit`** judges CSP per directive and names **what each failure
allows**, not a letter grade. Two judgements it encodes that scanners get wrong:
Report-Only is a rollout stage and never a pass, and `'unsafe-inline'` in
`script-src` without a nonce fails the directive outright rather than deducting
from it, because §40.2 says it defeats the control entirely.

**`bundle_audit`** measures the **initial route**, gzipped, against the budget
Department 8 sets. Render-blocking resources are counted separately, since they
are paid before anything appears whatever the total weight.

**`axe_audit`** counts **elements, not rules** — "3 violations" on a page where
one of them is 47 unlabelled inputs understates the work by an order of
magnitude — and refuses a zero with no passes behind it, because an axe run that
never executed is indistinguishable from a clean page.

## The guard

A measurement endpoint takes a URL from a request and fetches it. Left open that
is an SSRF primitive, and "it only runs on localhost" is exactly the assumption
that stops being true quietly. `checkUrl` refuses before any fetch and states
the reason: loopback, private ranges, carrier-grade NAT, link-local,
unique-local, the cloud metadata address, and anything that is not http or
https. Probes additionally refuse to **follow redirects**, because a redirect is
a second URL the guard never saw.

It is tested against eighteen refusal forms. Two of them matter more than the
rest:

- `169.254.169.254` and `metadata.google.internal`, which serve instance
  credentials on every major cloud.
- `[::ffff:127.0.0.1]`, which the URL parser normalises to `[::ffff:7f00:1]`.
  The first implementation matched the dotted text and let the hex form through
  — the whole guard failing open on one notation. It now expands IPv6 to its
  eight groups and classifies the address rather than the string.

The limit is stated rather than papered over: this checks the hostname as
written, and does not defeat a DNS name that resolves to a private address.

## Two bugs found by running it against live hosts

Neither would have been caught by the test suite as written, which is the
argument for running a probe against something real before believing it.

**`Referrer-Policy` precedence was inverted.** The header is a list in
*ascending* order of preference and the browser uses the **last** token it
recognises; the earlier ones are fallbacks for older agents. Reading the first
token failed `github.com`'s
`origin-when-cross-origin, strict-origin-when-cross-origin` — a correctly
configured site marked down for the fallback it deliberately put first.

**An error page was being audited as though it were the page.** A probe that
returns 403 still has headers, and they parsed cleanly. A non-2xx status is now
a Major: an error page is usually served by a different handler with a different
header set, so a pass there proves nothing about the real one.

## The Studio's budget gate, rebuilt on the instrument

`packages/studio/scripts/budget.mjs` decided which chunks were on the initial
route with a regex over filenames. It now reads the Vite manifest through
`bundleFromViteDist` and judges with `bundleAudit` — the same function that
produces Department 43's target row. One rule in one place: a build that passes
the gate and a run that reports the number cannot disagree.

That change also corrected the number. The regex counted
`assets/scorecard-*.js` as initial because it matched the `Scorecard` screen's
name, when it is a shared module reached only from lazy screens. The initial
route is **83.0 KB gz**, not the 83.7 KB recorded in Phase 3.

## Acceptance

| Criterion | Result |
|---|---|
| Departments 8, 40 and 43 can report instrument-sourced actuals | **met** — every row `measurementTargets()` emits passes the engine's own `Target` schema, asserted in `targets.test.ts` |
| The guard refuses private targets before fetching | **met** — 18 refusal forms, 9+ of them private, `fetchImpl` proven uncalled |
| The network lives in one file | **met** — `probes.ts` is the only module importing `fetch`; every instrument is tested without a server |
| Proven against something real | **partly met** — see below |

### What "partly" means

The header probe was run live against `github.com` and returned a correct audit:
8 of 10 header targets met, `object-src` absent, `_octo` missing `HttpOnly`.
Both live bugs above came out of that run.

The PageSpeed probe reaches Google and the error path is proven — but the
success path is not. The keyless endpoint returns:

```
429 Quota exceeded for quota metric 'Queries' and limit 'Queries per day'
```

which is the shared anonymous quota, exhausted. The probe surfaced it as a
`ProbeFailed` naming the status rather than returning an empty record, which is
the behaviour that matters most, but **`probeWebVitals` has not yet parsed a
real PSI response.** It is tested against captured response shapes. Running it
live needs a `PSI_API_KEY`, and until that happens this is an open gap rather
than a passed criterion.

## What is not built

- **An API route.** `@edsai/api` can depend on this package, and a
  `POST /api/measure` that collects and attaches rows to a run is the obvious
  seam. It is not built because it needs an injected probe to stay testable
  without the network, and that shape is worth deciding with the Studio screen
  that calls it rather than ahead of it.
- **Dependency audit and source-map checks.** Department 43 also asks for
  unremediated advisory counts, lockfile/frozen-install pass-fail, and source
  maps generated but not publicly served. Those read a repository rather than a
  URL, which is a different probe shape.
- **The axe-in-CI gate** Department 42 asks for. The importer exists; nothing
  runs axe yet.
