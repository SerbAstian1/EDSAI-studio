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
| 0 · Rubric extraction | **built here** — `@edsai/rubric`, 84 tests |
| 1 · Instruments | **built here** — `@edsai/instruments`, 14 instruments, 209 tests |
| 2 · Engine and CLI | **built here** — `@edsai/engine` + `@edsai/prompts`, 84 tests |
| 2b · Harness mode | **built here** — same `accept` path as the API |
| 3 · Studio shell | **built here** — `@edsai/api` + `@edsai/studio`, 46 tests, 83.0 KB gz |
| 4 · Visual critique | **computable half built** — `composition_check` + `checkMindMap`; overlay UI deferred |
| 5 · Measurement bridges | **built here** — `@edsai/measure`, 108 tests; PSI success path unproven |
| 6 · Bridges and exports | **built here** — `@edsai/figma` + `@edsai/export`, 55 tests |
| 7 · Brand Hub | **built here** — `@edsai/hub`, 28 tests, 2.8 KB gz against a 40 KB budget |

Every phase now has code here, but this repository is a reconstruction rather
than the original: Phases 1–5 were built in earlier sessions on a local machine
and were never pushed. Several acceptance criteria are met in a narrower form
than the original claimed, and a few are still open — the PageSpeed success
path, the mind-map run, the composition overlay, the hub's asset pack. See
`docs/notes/gaps.md`, which is kept blunt on purpose.

## Layout

```
corpus/          the EDSAI corpus, vendored — canonical for all reasoning
packages/
  auth/          principals, roles, the policy, passwords and session tokens
  rubric/        parses the corpus into typed, validated data
  instruments/   pure functions that compute what the corpus asks to be measured
  prompts/       prompt assembly with a frozen, cacheable prefix
  engine/        the run loop, provenance verifier, FINAL gate, store and CLI
                 plus clients, contacts, projects and the scoped store
  figma/         Department 5 critique of a frame, plus the Figma plugin
  export/        internal document, gated client summary, DEVPOINT handoff
  measure/       probes and instruments for Departments 8, 40 and 43
  api/           node:http contract over the engine, with SSE run progress
  studio/        the AW studio shell — sidebar, command palette, CSR, route-split
  executor/      calls the model and runs a run, department by department
  hub/           the client-facing brand hub, generated from a FINAL run
docs/
  product/       the AW product direction, the audit behind it, and its phases
  discovery/     the client discovery flow that produces a Direction Lock
  phases/        phase specifications
  runs/          pipeline run records
  strategy/      product direction
  notes/         known gaps, open questions, weaknesses
```

## Getting started

```bash
pnpm install
pnpm test          # 829 tests
pnpm typecheck
pnpm corpus:diff   # compare vendored corpus against the installed skill
```

Measuring a live site, for Departments 8, 40 and 43:

```bash
pnpm -r build
node packages/measure/dist/bin/measure.js collect https://example.com/ \
  --out measurements.json --dist packages/studio/dist
node packages/measure/dist/bin/measure.js report measurements.json
```

`collect` reaches the network and writes a records file; `report` reads it and
judges, touching nothing. Re-judging a stored measurement against a changed
budget is free, and a measurement taken once is never silently re-taken.
PageSpeed's keyless quota is routinely exhausted — set `PSI_API_KEY` for the
Core Web Vitals half.

Emitting a client's brand hub from a FINAL run:

```bash
node packages/hub/dist/bin/hub.js build <runId> --db data/runs/edsai.db --out hub
node packages/hub/dist/bin/hub.js check <runId> --digest <digest>
```

It refuses rather than degrades: a run the gate has not cleared, a colour with
no contrast measurement behind it, or a target crediting an instrument that was
never called all stop the build with the reason stated.

## Running it live

For live runs, put the server-side key in `.env` and restart:

```dotenv
OPENAI_API_KEY=your-project-key
# Optional; defaults to gpt-6-astra
EDSAI_MODEL=gpt-6-astra
```

The key is read only by the Node API process and is never sent to the Studio
bundle or browser.

`npm run dev` starts the API and the Studio for one person on one machine;
`npm run dev:rehearse` does the same with runs executing on placeholders,
for walking the pipeline without a key. Hosting — as one container, on Fly,
or with the Studio on Vercel in front of the API — is in
[docs/hosting.md](docs/hosting.md).

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

Each is also emitted as a **strict model tool** (`strict: true`, schema closed
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
