# Phase 6 — Bridges and exports

**Status:** three of four parts built. The fourth is blocked, not deferred by
preference — see *Tauri* below.

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

## Tauri — blocked, and why

**There is no Studio app for a desktop shell to wrap.** Phase 3 built
`@edsai/studio` in the sessions that were lost, and this repository has not
rebuilt it. Rust and the toolchain are present; the thing to put in the window
is not.

Scaffolding a Tauri project around nothing would produce a window that launches
in under two seconds and contains an empty page — which would satisfy the
phase's stated acceptance criterion while delivering nothing. **Phase 3 is the
prerequisite.** When it exists, the desktop shell is a small piece of work, and
the plan's own exit clause already says a PWA gives "installed" for free if the
native build proves not worth it.

## Acceptance

| Criterion | Result |
|---|---|
| A frame with a 3.9:1 body pairing is flagged at the exact ratio | **met** — `#818181` on white, reported as `3.9:1 — needs 4.5:1`, severity blocker |
| The desktop build launches in under 2 s | **not attempted** — nothing to launch |

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
