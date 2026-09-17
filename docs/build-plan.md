# Build plan

The canonical plan is the V1 document dated 11 September 2026:
<https://claude.ai/code/artifact/c2f4789c-ab03-4a2e-9621-df666b50b22d>

It holds the full reasoning — the thesis, the fifteen instruments, the data
model, the technology decisions with their five-part frames, the cost model, the
Studio's own performance budgets, the risk table, and §15's account of the
pipeline run on itself. This file records only what the plan says about phases,
so the repository is legible without opening the artifact.

## Phases

| # | Phase | Weeks | State |
|---|---|---|---|
| 0 | Rubric extraction | 1–2 | rebuilt in this repository |
| 1 | Instruments | 3–5 | **rebuilt in this repository** — 14 instruments, 209 tests |
| 2 | Engine and CLI | 6–9 | **rebuilt in this repository** — 55 tests; harness path only, no API credit |
| 2b | Harness mode | — | **rebuilt in this repository** — shares `accept` with the API path |
| 3 | Studio shell | 10–15 | **rebuilt in this repository** — `phases/03-studio-shell.md`; 83.0 KB gz against 170 KB |
| 4 | Visual critique and JARVIS mode | 16–19 | **computable half rebuilt** — `phases/04-visual-critique.md`; overlay UI and the mind-map run still open |
| 5 | Measurement bridges | 20–22 | **rebuilt in this repository** — `phases/05-measurement-bridges.md`; 108 tests; PSI still never run live |
| 6 | Bridges and exports | 23–26 | **3 of 4 built** — `phases/06-bridges-and-exports.md`; Tauri blocked on Phase 3 |
| 7 | Brand Hub | — | **specified** — `phases/07-brand-hub.md`; run at `runs/phase-7-brand-hub.md` closed V1 |

See `notes/gaps.md` for what "built previously" means for this repository, and
for the findings each phase left open.

Phase 7 is specified but gated: its own run names Phase 1 as a hard prerequisite,
because a brand hub whose values are `stated-target` rather than `instrument` is
a prettier version of what competitors already ship.

## What the plan fixes that this repository must not drift from

- **Instruments override the model.** Any numeric target is
  `{ value, source: 'instrument' | 'stated-target', mechanism? }`, and the engine
  rejects `source: 'instrument'` unless a tool call in that turn produced it. The
  model may state a target and the mechanism for hitting it; it may not assert a
  measurement.
- **The closing loop is a different party.** QA, Critic and Arbitration are
  separate calls receiving department *outputs* and never the reasoning that
  produced them.
- **The gate is code, not judgment.** FINAL is unreachable while any Blocker or
  Major is open or any conflict lacks a resolution.
- **Skipped departments produce no row.** Not a zero, not an N/A — the
  activation matrix decides what exists at all.
- **Department 12 never produces final logo art.** There is no rendering pipeline
  for marks and no affordance to add one.

## Frontend System Level

**Level 1, trending toward 2** — an authenticated single-user workspace whose
server state is pipeline runs, department outputs and assets, with streamed model
output server-to-client only. No real-time collaboration, no offline requirement.

Interaction Physics is active narrowly: the composition overlay's pan/zoom and
the before/after compare slider are the only grabbable surfaces.

A proposed Phase 7 brand hub does not change this. A multi-tenant client portal
with contracts and invoicing would move it to Level 3 in one step, which is the
decision `strategy/designerhq-analysis.md` argues against.
