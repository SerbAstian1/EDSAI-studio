# EDSAI Studio

A design intelligence workstation built on the EDSAI corpus — 28 departments, one
fixed rubric, and a set of instruments that **compute** the numbers the corpus
otherwise asks a model to assert.

The thesis, unchanged from the build plan: EDSAI's value is its reasoning and its
rubric. This is not a canvas editor and not a website builder. It earns its
existence by computing the measurable targets, holding the pipeline as data
instead of prose, and sitting beside the designer's own tools without ever
drawing the final mark.

## Status

| Phase | State |
|---|---|
| 0 · Rubric extraction | **built here** — `@edsai/rubric`, 69 tests |
| 1 · Instruments | **built here** — `@edsai/instruments`, 12 instruments, 158 tests |
| 2 · Engine and CLI | **built here** — `@edsai/engine` + `@edsai/prompts`, 55 tests |
| 2b · Harness mode | **built here** — same `accept` path as the API |
| 3 · Studio shell | not in this repo |
| 4 · Visual critique | not in this repo |
| 5 · Measurement bridges | not in this repo |
| 6 · Bridges and exports | not started |
| 7 · Brand Hub | **specified** — `docs/phases/07-brand-hub.md`; run closed at V1, 3 Majors open |

Phases 1–5 were built in earlier sessions on a local machine and were never
pushed. This repository is a reconstruction that begins at Phase 0. See
`docs/notes/gaps.md` for exactly what is and is not carried over.

## Layout

```
corpus/          the EDSAI corpus, vendored — canonical for all reasoning
packages/
  rubric/        parses the corpus into typed, validated data
  instruments/   pure functions that compute what the corpus asks to be measured
  prompts/       prompt assembly with a frozen, cacheable prefix
  engine/        the run loop, provenance verifier, FINAL gate, store and CLI
docs/
  phases/        phase specifications
  runs/          pipeline run records
  strategy/      product direction
  notes/         known gaps, open questions, weaknesses
```

## Getting started

```bash
pnpm install
pnpm test          # 297 tests
pnpm typecheck
pnpm corpus:diff   # compare vendored corpus against the installed skill
```

## The drift contract

The markdown in `corpus/` stays canonical: it is what a model reads, and it is
the only place a department is defined. `@edsai/rubric` derives typed data from
it and validates the result, so adding a department is a markdown file plus a
schema — the application does not change.

Tests assert this both ways. The counts below are properties of the corpus as
written, and the suite edits a throwaway copy to prove the build notices:

| Parsed | Count |
|---|---|
| Departments | 28 |
| Department-specific dimensions | 79 |
| Universal dimensions | 4 |
| Activation matrix rows | 13 |
| Composition structures (6 families) | 29 |
| Cross-cutting roll-ups | 7 |
| Measurable-target bullets | 118 |
| Pipeline tracks | 4 |
| Departments activated at L0 / L1 / L5 | 19 / 24 / 25 |

The parser reports one genuine drift in the corpus: Department 5's reference file
scores **Optical Precision**, which the canonical list in `00-scorecard.md §3`
does not include. It is treated as scored, because the department file is the
more specific statement.

## Delivery scope

Not every studio delivers every discipline. `DeliveryScope` gates departments the
way the activation matrix gates the frontend block — an out-of-scope department
produces no output record and no row, rather than a weak one.

The scope this studio runs is **`no-motion-authoring`**: Department 6 (Motion &
Cinematic System) is excluded, and Department 15 (Motion Engineering) is reduced
to accessibility and payload — `prefers-reduced-motion`, reduced-transparency and
reduced-contrast handling, animation-library bundle cost, lifecycle cleanup.

Department 15 stays because a site inherits motion it did not author, from a
component library or a browser default, and that motion still needs a fallback
and still costs bundle. Declining to design motion is not declining
responsibility for the motion that ships. A Level 1 run is 23 departments rather
than 24. See `docs/notes/gaps.md` §4d.

## Instruments

`@edsai/instruments` turns each "state the actual number" instruction in the
corpus into a deterministic function. Every one is pure: no model call, no
network, no interpretation. They compute; departments interpret.

Each is also emitted as a **strict Claude tool** (`strict: true`, schema closed
to additional properties), because the engine only accepts a measured `actual`
when an instrument produced it in that turn.

| Instrument | Computes | Verified against |
|---|---|---|
| `contrast` | WCAG 2.1 ratio, APCA Lc alongside | `wcag-contrast` and `apca-w3`, 25 pairs each |
| `contrast_worst_case` | Worst ratio across possible backdrops | derived from `contrast` |
| `palette_audit` | Every pairing in a token set at once | derived from `contrast` |
| `type_scale` | Scale from base and ratio, tracking and leading per tier | the corpus's own 16/20/25/31/39/49 example |
| `type_scale_audit` | Ratio consistency, tracking stated and varying | — |
| `spacing_audit` | Orphan values tracing to no scale step | — |
| `line_length` | Characters per line against the 45–75 target | the Studio's own 680px/17px = 80 finding |
| `legibility_at_distance` | Readable distance from cap height | run `d7de33c6`'s 4.68 mm → 1.8 ft, 69.3% under |
| `motion_timing` | Duration against category bands, compositor safety | Department 6's table — kept as a guard on *inherited* motion |
| `seo_lengths` | Title, meta, H1 count, heading skips | `00-scorecard.md §4` |
| `score_drift` | Clustering in any 2-point band, templated wording | flags all-8s, passes a 4–9 spread |
| `print_gamut_risk` | Colours likely to shift in CMYK — **heuristic** | — |
