# Phase 3 — Studio shell

**Status:** built. Two packages, the engine gap closed, and both acceptance
criteria met — one measured, one demonstrated in a browser.

## What shipped

### `@edsai/api`

The contract the build plan hands DEVPOINT, shipped as the thinnest thing that
satisfies it: `node:http`, no framework, no middleware stack. If DEVPOINT takes
it over, this package is the specification rather than the implementation to
keep.

Two properties matter more than the route list.

**Runs outlive their listener.** Progress is broadcast over Server-Sent Events,
and the emitter keeps a bounded per-run history so a reconnecting client is sent
what it missed via `Last-Event-ID`. Without that replay, a backgrounded tab
comes back to a run that looks stalled. SSE rather than WebSockets because the
traffic is one-directional — the client never sends anything back over the same
channel, and reconnection comes free.

**No rule is enforced twice.** The gate, the provenance verifier and the
client-summary constraints all live in the packages below. A rule enforced in
two places is a rule enforced in neither, so the API's job is to surface the
refusal, not to re-decide it. The refusals carry meaning in the status: a
summary refused because the run is not FINAL is a `409` with every reason
listed, not a `500`.

### `@edsai/studio`

A client-rendered React shell. CSR is stated rather than defaulted: this is an
authenticated single-user tool with no SEO surface, so SSR would buy a hydration
bill for a page nobody reaches unauthenticated.

**Source of truth, per the plan's §9.** The server owns runs, outputs, issues
and conflicts. The URL owns which run and screen are open. Component state owns
nothing but unsaved form input. No global store — deferred until a cross-feature
need is observed rather than anticipated.

Screens: workspace, three-layer intake with the classification picker, run view
with progress and resume, department reader, scorecard board, issue tracker,
conflict panel, and the gated finalise screen with the client summary.

Four of them are lazy, which is what keeps the initial route inside budget.

### The engine gap, closed

Run `f44f6852` recorded it exactly: *"the score-drift check flagged clustering
in Department 1 and Arbitration rescored it in prose, but nothing writes that
back into the persisted scores. Arbitration can direct a rescore; the engine
cannot apply one."*

`applyRescore` now writes the corrected score back **and keeps the original**,
because a rubric whose history can be quietly rewritten is not an audit — it is
a draft. It refuses three cases rather than guessing: a department with no
output, a dimension that department never scored (naming the ones it did), and
a rescore to the value already held, since an audit trail full of no-ops is one
nobody reads. A rescore also requires a stated reason; without one it is a nudge.

## Acceptance

| Criterion | Result |
|---|---|
| The brief runs end-to-end in the UI with state persisted | **met** — booted in headless Chromium against the real API, rendering a seeded run |
| FINAL provably unreachable while a Major is open | **met** — rendered "FINAL is withheld · determination V1 · 1 open Major", `Mark FINAL` disabled |
| Meets its own budget | **met** — 83.0 KB gz initial route against 170 KB, measured with gzip at level 9 |

The bundle breakdown, from `pnpm --filter @edsai/studio budget`:

| | Size |
|---|---|
| Initial route | **83.0 KB gz** |
| — app shell + screens | 67.3 KB |
| — TanStack Query | 13.1 KB |
| — React | 1.4 KB |
| — CSS | 1.2 KB |
| Deferred, 5 chunks | 6.2 KB |
| Headroom | 87.0 KB |

"Initial route" means what a first paint costs — the entry chunk and what it
statically imports — not the whole `dist`, which includes screens a visitor has
not opened. Measuring the dist total would make the figure look worse than the
experience and push toward the wrong optimisations.

For comparison, the original Phase 3 recorded 90 KB against the same budget.

**Revised in Phase 5, from 83.7 KB.** The script originally decided which chunks
were initial with a regex over filenames, which counted `assets/scorecard-*.js`
as initial because it matched the `Scorecard` screen — when it is a shared module
reached only from lazy screens. The gate now reads the Vite manifest through
`@edsai/measure`, the same function that produces Department 43's target row.

## Two things the browser check found

**The run screens hold an open EventSource**, so a headless `--dump-dom` waits
forever for a network idle that never arrives. The check blocks the stream
endpoint, which turned out to be worth doing anyway: it proves the app renders
correctly when the stream is unavailable, which is the degraded case a proxy or
a dropped connection produces.

**React 19 removed the global `JSX` namespace.** Components annotate
`ReactElement` instead. Worth noting because the old annotation typechecks
silently against older `@types/react` and fails here.

## What is not built

- **The Direction Lock panel.** The sub-skill is vendored now, so the reason
  Phase 3 originally cut it no longer holds — but the panel belongs with the
  discovery flow (`docs/discovery/flow.md`), which is specified and prototyped
  rather than built. Building it here would split it across two places.
- **Visual regression snapshots and the axe-in-CI gate.** Department 42 asks for
  both. The bundle budget is gated by a script; accessibility is not yet.
- **Tauri**, which was blocked on this phase, is now unblocked.
