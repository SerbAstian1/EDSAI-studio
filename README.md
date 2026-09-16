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
| 1 · Instruments | not in this repo |
| 2 · Engine and CLI | not in this repo |
| 2b · Harness mode | not in this repo |
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
docs/
  strategy/      product direction
  notes/         known gaps, open questions, weaknesses
```

## Getting started

```bash
pnpm install
pnpm test          # 69 tests
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
