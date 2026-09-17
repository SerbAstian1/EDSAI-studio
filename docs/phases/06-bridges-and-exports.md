# Phase 6 — Bridges and exports

**Status:** built, all four parts. Tauri was blocked on Phase 3 and is not any
more — see *Tauri* below for what it took and what it found.

## What shipped

### Figma plugin — `@edsai/figma`

A Department 5 critique of a selected frame, computed by the same instruments
the pipeline uses. A ratio reported inside Figma and a ratio reported in a run
are the same number produced by the same code.

The architecture is the point. The Figma plugin API only exists inside Figma,
which would make every interesting behaviour untestable, so the boundary sits
one step earlier:

```
Figma nodes → [adapter] → FrameSnapshot → [analyze] → Annotation[]
              thin, dumb                   pure, tested anywhere
```

`analyzeFrame` takes plain data and returns findings. The adapter reads Figma
and normalises — style names to numeric weights, letter-spacing to em,
line-height to a multiplier, and the ancestor chain to a composited backdrop.
Everything with judgement in it runs under test here; only the reading does not.

**Checks:** contrast per text layer against its *resolved* backdrop at the right
WCAG threshold for its size and weight; boundary contrast under 1.4.11; type
scale ratio consistency; tracking stated per tier and varying across it; one
tier carrying two tracking values; spacing values off the scale; line length.

**Two deliberate refusals.** Text over a gradient is skipped rather than measured
against a guess — the naive plugin takes the nearest ancestor fill and reports a
confident wrong ratio. And a boundary whose role had to be inferred from the
layer name is reported one severity softer, with the inference stated, because
a decorative hairline is exempt from 1.4.11 and a control edge is not.

The plugin says nothing about whether a design is good. One that offered taste
would be worth ignoring.

### Exports — `@edsai/export`

**Internal document.** Everything the run produced in pipeline order: scores with
justifications, targets with their provenance marked instrument or stated, the
five-part frame for each technology decision, issues, conflicts with what was
lost, and the instrument violations that were stripped. It names the lowest
score explicitly rather than burying it, because the corpus requires the weak
point named.

**Client summary.** Four constraints, all enforced rather than trusted: under 600
words, no scores, no internal vocabulary, and **only from a run whose
determination is FINAL**. A summary is the one artifact a client reads without
us in the room, so a scorecard leaking into it — or a summary of a run that was
never final — is a mistake that only surfaces after it has been sent. The
checker returns every reason it refuses, not the first.

**DEVPOINT handoff pack.** What the interface *requires*, and nothing about how
the backend should work. Every failure case the corpus names (401, 403, 404,
409, 429, 500, timeout, offline) with both halves stated; the out-of-order
response race and who owns which part of it; performance budgets carrying their
provenance. Where the run named no endpoints it says so rather than inventing
them, and labels everything downstream as stated against an assumed contract.

## Tauri — unblocked, and built

The original entry read: *"There is no Studio app for a desktop shell to wrap.
Scaffolding a Tauri project around nothing would produce a window that launches
in under two seconds and contains an empty page — which would satisfy the
phase's stated acceptance criterion while delivering nothing."*

Phase 3 exists now, so `@edsai/desktop` wraps it. The shell is deliberately
almost empty: a window, an icon, a frontend served from disk, and one command
(`api_origin`) that is the single place the engine's address is stated. A shell
that started reimplementing the Studio in Rust would create a second place for
the same rule to live, which is the thing this codebase refuses everywhere else.

**What it does not add is the engine.** The API is a Node process the user runs
alongside it. Bundling a Node sidecar is a real option and a real cost; until
someone wants it, `EDSAI_API_ORIGIN` names the address and the default is the
Studio's own dev-proxy target.

### The acceptance criterion, taken literally

The warning above is the criterion: not "a window opened" but "a window opened
with the application in it". So the shell checks rather than asserts — it polls
`#root` after load and reports how long until the Studio actually mounted,
exiting non-zero if it never does. `pnpm --filter @edsai/desktop launch-check`
runs it five times under Xvfb and fails over budget.

**740 ms worst of five**, against a 2000 ms budget. Under Xvfb with software
rendering, so a real desktop with GPU compositing is faster, not slower.

### Three things the check found, by being made to fail

Each of these would have shipped as a green result.

**A check that could not fail.** The first version counted `#root`'s children.
The Studio's `#root` ships a pre-paint fallback so a failed chunk is not a blank
page — so the count is never zero. Stripping the entry script out of a build and
running it produced a pass. `:not(noscript)` is what makes the check real.

**A failure that exited zero.** `AppHandle::exit(1)` routes the code through the
event loop and the process still ended 0, so a script driving the check would
have printed a failure and reported success. It uses `std::process::exit` now.

**`PageLoadEvent::Finished` is not "the app is running".** On WebKitGTK it fires
*before* deferred module scripts execute, so sampling the DOM there reports an
empty root on a perfectly healthy build. That one cost the most time and was the
most worth finding: it briefly looked like the CSP was blocking the bundle, and
the CSP was innocent. The fix is to poll for the mount, which also makes the
number honest — it is time-to-usable rather than time-to-load-event.

### Building it

Linux needs the WebKitGTK toolchain, which is not in this repository and not in
CI:

```
libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev librsvg2-dev patchelf
```

Then `pnpm --filter @edsai/studio build` (the shell embeds `dist` at compile
time — changing it does not invalidate the Rust build on its own) and
`pnpm --filter @edsai/desktop tauri:build`.

CI does not build the shell. Adding it would mean installing that toolchain on
every run for a target nothing else depends on, and the check needs a display.

## Acceptance

| Criterion | Result |
|---|---|
| A frame with a 3.9:1 body pairing is flagged at the exact ratio | **met** — `#818181` on white, reported as `3.9:1 — needs 4.5:1`, severity blocker |
| The desktop build launches in under 2 s | **met** — 740 ms worst of five to a mounted app, measured under Xvfb, and the check exits non-zero on a window that opens empty |

## What is still worth doing here

- **PDF rendering.** The exports emit Markdown. Chromium is available in this
  environment, so a Playwright step could render them, but that is a heavy
  runtime dependency to put in a library — it belongs in the CLI or the Studio,
  not in `@edsai/export`.
- **DOCX for the client summary.** The plan names it. Markdown covers the
  content; the format conversion is unbuilt.
- **The plugin has never run inside Figma.** The analysis is tested exhaustively
  and the bundle builds, but nothing here can load it into the editor. First
  real use will find adapter bugs, and those bugs will be in the adapter rather
  than the analysis, which is exactly why the boundary sits where it does.
