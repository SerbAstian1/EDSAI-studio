# Gaps, weaknesses and open questions

Kept deliberately blunt. The corpus's own rule is that a scorecard which only
gets shown when it flatters the work is not a scorecard, and the same applies to
a status document.

## 1. What this repository does not contain

Phases 1 through 5 were built in earlier sessions on a local machine that had no
git remote attached. That machine is with an engineer and the code is not
reachable. What is lost, specifically:

| Phase | Was | Status |
|---|---|---|
| 1 | 10 instruments, 66 tests | **to rebuild** |
| 2 | `@edsai/prompts`, `@edsai/engine`, `edsai` CLI, 28 tests | **to rebuild** |
| 2b | harness mode — `harness start/next/tool/submit/retract/finalize` | **to rebuild** |
| 3 | `@edsai/api`, `@edsai/studio`, 9 screens, 264 tests | **to rebuild** |
| 4 | `composition_check`, overlay with pointer physics, mind map | **to rebuild** |
| 5 | 4 instruments + 3 probes, 400 tests | **to rebuild** |

Also lost, and **not rebuildable**: run records `f44f6852` (the 24-department
self-run) and `d7de33c6` (the Titans critique). Those are data, not code. Their
findings survive in the build plan's §15 and are treated as known state below,
but the raw records are gone and would have to be re-run.

If the laptop comes back intact, `pnpm corpus:diff` is the tool for reconciling
the corpus halves; the code halves need a manual merge.

## 2. Corpus drift found by the parser

Two findings, both real, both in the corpus rather than in the code.

**Department 5 scores a dimension the canonical list does not carry.**
`03-ui-design-system.md` scores **Optical Precision**; `00-scorecard.md §3` lists
only three dimensions for Department 5. The parser treats it as scored — the
department file is the more specific statement — and reports the drift. This is
the same finding the original Phase 0 made independently, which is a good sign
for both implementations. *Fix: add Optical Precision to §3, or remove it from
the department file. Do not leave it split.*

**Department 8 states its targets in a shape no other department uses.**
Seventeen departments declare measurables under `## Real Measurable Targets to
report`. Department 8 — the one department that is *entirely* measurables — uses
`## 8.1 Performance Targets`, `## 8.2 Accessibility`, `## 8.3 SEO Structure`
instead, so a parser keyed to the shared heading finds nothing for it. Its
measurables therefore have to come from the scorecard's §4 table.

This is why the count is 118 and not higher, and why it matches the original
implementation exactly. It is pinned by a test so that changing it is deliberate.
*Fix: give Department 8 the shared heading, or state in §4 that it is the
exception.*

## 3. Known-open findings from run `f44f6852`

The self-run closed at **V1 with six Majors open**, and the gate was correct to
refuse FINAL. Carried forward as real work:

- **Four of the six Majors are the same shape** — a later department quietly
  redefining what an earlier one fixed. Arbitration surfaced this; QA had not
  framed all of them as defects.
- **Three table surfaces have no specified behaviour below 768px**, on a device
  the brief names as a requirement. Every department was individually right and
  the product still had a hole. This is the argument for the closing loop.
- **Cross-System Coherence scored 6** — the lowest aggregate in the run.

## 4. The weakness the system found in itself

The Critic failed Department 5 outright, and the reason is the most important
sentence in the whole exercise:

> Department 5 answered Department 2's explicit brief to earn distinctiveness
> with three free Google faces and the default scale. *Measurement rigor is not
> the same thing as design.*

This is the structural weakness of the product, not a bug in one run. The
measurable half works and is demonstrable. The taste half is weak, and a machine
that can compute a contrast ratio cannot want a typeface. **The Studio's honest
job is to hand that gap to the designer, named** — not to paper over it with more
instruments.

Any Phase 7 brand hub inherits this directly: a hub that proves its own
compliance is still forgettable if the palette inside it is safe.

## 4b. Open findings from the Phase 7 run

`runs/phase-7-brand-hub.md` closed at **V1 with three Majors open**. All three
are the same shape, and the shape is worth naming: *the hub crosses from an
internal artifact into a client-facing publication, and no department owns that
transition.*

- **QA-1 — staleness has no owner.** The hub is generated from a run; the Studio
  changes afterwards. No source of truth, no regeneration trigger, no stated
  behaviour when the hub is behind. The failure is silent: a client copying a hex
  the studio revised last week.
- **QA-2 — a failing contrast pair has no decided behaviour, and it is a business
  decision.** The hub measures the *client's* palette, and real palettes fail AA.
  Omit it and the hub lies by silence; show it and the hub publishes the client's
  non-compliance to their own staff; block publishing and the studio cannot ship.
  Arbitration resolved it as report-plus-pre-publish-gate, at the cost of
  one-click publish — but the decision needs a human owner, not a default.
- **QA-3 — embedded third-party tools on a client-branded domain have no vetting
  process.** Sandboxing is specified; who approves a tool, what happens when it
  breaks in front of the client, and who is liable are unassigned. Inheriting
  DesignerHQ's embed pattern inherits this problem.

The Critic also failed two departments, and both failures are the familiar one:
Department 2 at 5 (*"neutral host" is not a creative direction*) and Department 5
at 6 (*the provenance component is the entire product thesis and is specified as
"visibly distinct" with no design*). Strong where the answer is computable, weak
where it is taste — the same verdict as the original self-run, now reproduced in
the planning of its own next phase.

**Cross-System Coherence scored 6**, for the same shape-repetition reason the
original run scored 6.

## 5. Unproven claims

Things asserted somewhere that nothing has actually verified:

- **API cost and wall-clock (§10).** Every figure is an estimate. Run `5bac36cb`
  failed at Department 1 with $0.000 spent; the account has no credit. The
  estimate is ≈ $3.4 per Level 1 run before thinking tokens.
- **PageSpeed against a live URL.** The parser is fixture-proven, including
  CrUX's CLS×100 and page-versus-origin precedence, but the shared anonymous
  quota was exhausted during testing and no live response has been through it.
- **The mind-map acceptance run.** `checkMindMap` was written and tested; no
  brand questionnaire has ever been through Department 12.
- **Local Lighthouse.** Not built. §5's exit clause says PSI is enough for hosted
  sites, which has not itself been tested.
- **axe** cannot be probed from a server at all — it ships as an importer with a
  Playwright snippet rather than a probe.
- **Every target in the Phase 7 run.** All eleven rows in its Department 8 table
  are `stated-target`; no instrument ran, because Phase 1 is not in this
  repository. The run says so in its own header and should be re-executed once
  the instruments are rebuilt.

## 6. Honest accounting on this rebuild

- **69 tests here, against 101 in the original Phase 0.** The acceptance numbers
  all reproduce (28 / 79 / 13 / 29 / 7 / 118 / 4 tracks / 19-24-25), but the test
  count does not. The original likely parameterised per-department assertions.
  Not padded to match.
- **The three Disan's exemplars are excluded.** They are third-party client work,
  and the data model marks the exemplar library *"local library, never
  redistributed."* This repository is public. Department 14's critique is
  anchored by those images, so Phase 4 cannot be fully rebuilt here until either
  the repository goes private or the exemplars are supplied another way.
- **The corpus itself is published.** ~470 KB of methodology is now in a public
  repository, at the owner's explicit instruction. Worth revisiting before the
  repository is shared more widely.

## 7. Open questions

Carried from the build plan's §13, still unanswered, and each changes the plan:

1. Internal tool, or a product others pay for? A sellable product moves
   classification to Level 2 at launch and changes DEVPOINT's scope entirely.
2. Does EDSAI Studio get its own identity? The plan assumes yes, later — and §14
   docks Brand Fidelity a point precisely because the Studio's own brand has
   never been through Departments 1, 2, 5 and 12.
3. Monthly API budget — bounds how many projects get a full pipeline run versus
   scoped department asks.
4. Web first or desktop first? If JARVIS-beside-Photoshop is the primary use,
   Tauri moves forward and the Figma plugin slips.

And one new question this rebuild raises:

5. **Does Phase 7 (Brand Hub) come before Phase 6 (Figma plugin)?** The plan
   calls the Figma plugin its highest-variance item. The brand hub is lower risk,
   is the client-facing payoff, and is the thing that makes the instruments
   visible to someone who is not the designer. *Partly answered:* the Phase 7 run
   establishes that Phase 1 gates Phase 7 regardless, so the ordering question is
   really Phase 1 → 7 → 6 versus Phase 1 → 6 → 7.
6. **Who decides QA-2?** Whether a client's failing palette is published,
   corrected or blocked is a studio policy question, not an engineering one, and
   it should be answered before the generator is built rather than after.
