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
| 1 | 10 instruments, 66 tests | **rebuilt** — 14 instruments, 209 tests |
| 2 | `@edsai/prompts`, `@edsai/engine`, `edsai` CLI, 28 tests | **to rebuild** |
| 2b | harness mode — `harness start/next/tool/submit/retract/finalize` | **to rebuild** |
| 3 | `@edsai/api`, `@edsai/studio`, 9 screens, 264 tests | **rebuilt** — 46 tests, 83.0 KB gz |
| 4 | `composition_check`, overlay with pointer physics, mind map | **half rebuilt** — both instruments; overlay deferred, mind-map run still never made |
| 5 | 4 instruments + 3 probes, 400 tests | **rebuilt** — 4 instruments, 2 probes, 2 importers, 108 tests |

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

## 4c. What Phase 1 does and does not cover

Rebuilt with twelve instruments and 158 tests. Three things are better than the
original, and four are worse or still missing. Both halves matter.

**Better:**

- **Contrast is cross-checked against two pinned reference implementations**
  rather than a live fetch. WebAIM's API is unreachable from this environment
  (the proxy refuses the CONNECT), so `wcag-contrast` and `apca-w3` serve as the
  references — 25 pairs each, matched to two and four decimals respectively.
  A lockfile pin is more reproducible than a live fetch, and it removed the
  original's precision compromise, where WebAIM's own reporting truncated to one
  decimal above 10:1.
- **APCA is verified against the library**, not against eight values copied from
  a README.
- **`palette_audit` is new** — every pairing in a token set at once, with a pass
  rate and the worst pairing named. It is what a brand hub renders, so Phase 7
  now has its input.

**Worse or missing:**

- **`line_length` does not read font metrics.** The plan says "characters per
  line from font metrics × measure"; this takes an `averageCharWidth` parameter
  defaulting to 0.5em. That reproduces the Studio's own recorded numbers exactly,
  but a condensed or wide face needs the real advance width, and nothing here
  reads a font file. *Fix: parse the metrics from the actual face.*
- **Pantone-nearest is not implemented.** The plan's instrument table lists it
  under print gamut. The matching needs a licensed colour dataset that is not in
  this repository, so it is absent rather than approximated — a wrong Pantone
  reference is worse than none.
- **`print_gamut_risk` is still a heuristic**, as the original was and as the
  plan intended. Hue and saturation only: no ICC profile, no paper stock, no ink
  limit. It says so in its own findings and in its tool description, and it must
  never be reported as a conversion.
- **`legibility_at_distance` inherits the corpus's rule of thumb** — cap height
  in inches ≈ readable distance in tens of feet. That is an approximation about
  typical acuity, not a measurement, and it says nothing about weight, contrast
  or ambient light. It reproduces run `d7de33c6` exactly, which confirms the
  implementation but not the rule.

**Still true of the whole set:** an instrument measures, it does not judge. None
of them can tell you a palette is *good* — only that a pairing reaches 4.5:1.
That boundary is the point, and it is the same boundary named in section 4.

## 4d. Stated competence boundary: motion authoring

**Motion design is not offered as a deliverable.** Stated by the studio owner as
an area without solid expertise, and encoded in the rubric rather than left as
something to remember.

This is the corpus's own discipline turned on its author. `00-scorecard.md §3`
requires a skipped department to produce no row — "not a zero, not an N/A" — and
`01-strategy-and-direction.md` treats a department with nothing brand-specific to
say as a signal that more input is needed, never as permission to fill the gap. A
discipline outside the studio's competence should leave the pipeline, not produce
a confident paragraph nobody can stand behind in front of a client.

It is also the same judgement `strategy/designerhq-analysis.md` reaches about
invoicing: do not compete where there is no edge. Applied to oneself rather than
to a competitor.

### What the scope actually does

`DeliveryScope` in `@edsai/rubric` gates departments the way the activation
matrix gates Departments 35–47. The `no-motion-authoring` scope:

| Department | Treatment | Why |
|---|---|---|
| 6 · Motion & Cinematic System | **excluded** | Creative direction for motion — narrative purpose, timing as expression, choreography. Scored on taste. Out of scope. |
| 15 · Motion Engineering | **reduced** | Cannot leave with it. See below. |

A Level 1 run drops from 24 departments to 23.

### Why Department 15 stays

Its own reference file calls itself *"the concrete implementation of Department
6's non-negotiable `prefers-reduced-motion` requirement"*, and Department 8's
accessibility checklist audits reduced-motion, reduced-transparency and
reduced-contrast whether or not anyone designed an animation.

The practical point: **a site inherits motion it did not author** — from a
component library, a CSS framework, a browser default. That inherited motion
still needs a reduced-motion fallback and compositor-safe properties, and the
animation library still costs bundle against the JS budget. Declining to design
motion does not decline responsibility for the motion that ships.

So Department 15 is reduced to accessibility and payload: reduced-motion,
reduced-transparency and reduced-contrast handling, animation-library bundle
cost, lifecycle cleanup. No engine selection for expressive motion, no
choreography. The reduction carries its reason in the scope object, because a
reduced department with no stated basis is just an excluded one someone flinched
on.

The `motion_timing` instrument stays for the same reason, with its job changed:
it is a **guard on motion that exists** rather than a tool for designing motion.

### If this changes

Reversible in one line — swap the scope back to `full`, or build a per-project
one with `scopeWithout`. Worth revisiting if a motion specialist is ever
partnered with or hired, since the corpus half is already written and tested.

## 4e. Phase 6: what is built, and the one part that is not

Three of four parts shipped. The fourth is worth being precise about.

**Tauri was blocked; it no longer is.** Phase 3 is now rebuilt, so there is a
Studio app for a desktop shell to wrap. The work was never large — the plan's
own exit clause notes a PWA gives "installed" for free if the native build does
not earn its keep. *Originally recorded as:* there is no Studio app for a
desktop shell to wrap. Rust is installed and the toolchain works; the
thing to put in the window does not exist. Scaffolding a Tauri project around
nothing would satisfy the phase's stated acceptance criterion ("launches in
under 2 s") while delivering an empty window, which is the kind of green tick
this project exists to refuse. **Phase 3 is the prerequisite.**

**The Figma plugin has never run inside Figma.** The analysis is tested
exhaustively — 29 tests, including the phase's 3.9:1 acceptance case — and the
bundle builds to a self-contained 326 KB. But nothing in this environment can
load a plugin into the editor, so first real use will find bugs. They will be
in the adapter rather than the analysis, which is precisely why the boundary
sits between them: `analyzeFrame` takes plain data and is testable anywhere;
only the Figma reading is not.

**Exports emit Markdown, not PDF or DOCX.** The plan names both. Chromium is
available here and could render PDF via Playwright, but that is a heavy runtime
dependency for a library — it belongs in the CLI or the Studio. DOCX is unbuilt.

## 4f. Phase 3 rebuilt, and what it still lacks

Both acceptance criteria are met and neither is asserted: the bundle was
measured with gzip at level 9 (**83.7 KB gz** against a 170 KB budget, against
the original's recorded 90 KB), and the FINAL gate was demonstrated in headless
Chromium rendering "FINAL is withheld · determination V1 · 1 open Major" with
the button disabled.

**46 tests against the original's 264.** The gap is honest and worth naming:
this rebuild tests the API over real HTTP (26) and the board's arithmetic and
routing (20), but it has **no component-level rendering tests** — no jsdom, no
testing-library. The browser check covers that the app boots and that the gate
renders correctly; it does not cover the other seven screens rendering, or any
interaction. That is the single largest testing gap in the repository.

**The Direction Lock panel is still not built**, but for a different reason than
before. The sub-skill is vendored now, so the original blocker is gone; the
panel belongs with the discovery flow, which is specified and prototyped rather
than built. Building it inside the Studio would split it across two places.

**Department 42 asks for visual regression snapshots and axe in CI at zero
violations.** Neither exists. The bundle budget *is* gated by a script that
exits non-zero when over; accessibility is not gated at all.

## 4g. Phase 5 rebuilt: what it closed, and what it opened

**Closed.** Departments 8, 40 and 43 can now report `source: 'instrument'`
actuals. Before this, their "Real Measurable Targets to report" lists could only
ever be asserted, and the engine — correctly — refused to accept an assertion as
a measurement. `targets.test.ts` checks every emitted row against the engine's
own `Target` schema rather than against a local expectation, so the two cannot
drift apart quietly.

**Closed, unexpectedly.** The Studio's bundle gate and Department 43's bundle row
were two implementations of one rule, and they disagreed. The gate inferred the
initial route from filenames and counted a shared module as initial because its
name resembled a lazy screen's. Both now read the Vite manifest through
`@edsai/measure`. The corrected figure is 83.0 KB gz, not 83.7 — a smaller
number, arrived at by fixing a measurement rather than the thing measured, which
is worth saying out loud.

**Opened.**

- **No API route.** `@edsai/measure` is a library and a CLI. Nothing in the
  Studio calls it, so a run's Department 8 table is still filled by hand from
  `edsai-measure report` output. `POST /api/measure` is the seam; it is deferred
  until the screen that calls it exists, because the probe needs injecting to
  stay testable and that shape should be decided with a caller in view.
- **Department 43 is half-covered.** Bundle weight and render-blocking counts are
  computed. Dependency advisory counts, lockfile/frozen-install pass-fail, and
  "source maps generated but not publicly served" are not — they read a
  repository rather than a URL, which is a different probe shape entirely.
- **The guard does not defeat DNS rebinding.** It checks the hostname as
  written. A name that resolves to a private address gets through, and closing
  that needs resolution at fetch time plus a pinned socket. The limit is stated
  in the module rather than papered over, but it is a real limit and this is a
  package whose whole job is to fetch URLs a client supplied.
- **One live-only bug class is now known to exist.** Both bugs the live run found
  were in judging, not fetching, and neither was reachable from the fixtures —
  because the fixtures were written from the same understanding as the code. The
  lesson generalises past this package: a fixture written by the author of the
  logic tests the author's model of the world, not the world.

## 4h. Phase 4's computable half, and the label problem it exposed

`composition_check` and `checkMindMap` are built. Both are refutation
instruments rather than identification ones: they take a claim the department
made and ask whether the data contradicts it. Ten of the catalog's twenty-nine
structures return `not-computable` with a stated reason, because a spiral, a
tunnel and a set of leading lines are claims about curvature, perspective and
line direction that axis-aligned boxes do not carry.

**The precondition worth naming.** Run against the Studio's own workspace screen
in headless Chromium, `composition_check` reported the `<h1>` wordmark at 0.9%
of the visual weight against the runs panel at 61.5%, and called it a hierarchy
failure. The arithmetic is right. The finding is not — in an application shell
the content panel *should* dominate and the wordmark should not, and Department
14's hierarchy rule is a poster rule about one surface seen once at a distance.

The fault was the harness labelling the `<h1>` as the primary message. That is
the instrument's real precondition: `role: 'primary'` means *the primary
message of this composition*, and whoever applies the label has to mean it. Fed
a bad label it computes a correct number about the wrong thing — a sharper
failure mode than vagueness, and the reason the labelling belongs to the
department rather than to a DOM heuristic. Nothing in this repository currently
stops a department from labelling badly.

**Still open from Phase 4:** the composition overlay UI (deferred — it needs
images, and the exemplar library is deliberately not in this public repository),
and the mind-map acceptance run, which needs a model call.

## 4i. Phase 7 built, and the one rule now enforced twice

The Brand Hub exists: `@edsai/hub`, one self-contained HTML file per FINAL run,
2.8 KB gz against a 40 KB budget, generated from a real seeded run and rendered
in a browser rather than asserted.

**It required a schema change**, and that is worth naming because it is the kind
of change that is easy to make quietly. The run record now carries `BrandToken`
and `Target.tokens`. Without them a hex code lived only inside a department's
paragraph, and a hub pairing a swatch with a ratio would have had to parse the
metric string to find the match — a guess wearing a join's clothes, and the
fabrication this system exists to prevent, one layer down. Both default to `[]`
and `RunStore` migrates an existing database, so no recorded run is invalidated.

**One rule is now enforced twice, on purpose.** The engine's verifier refuses a
target crediting an instrument the department never called; the hub refuses the
same thing again. Everywhere else in this repository a rule enforced in two
places is a rule enforced in neither, and the API document says so explicitly.
The exception is argued rather than assumed: the verifier protects the run
record, and the hub protects the artefact that leaves the building and is read
by people with no way to check it. If that argument is wrong, the hub's copy is
the one to delete.

**A finding the hub made about itself.** Audited with the contrast instrument it
renders, the copy button's border reused the decorative hairline token at
1.26:1 against the page, where WCAG 1.4.11 holds a control boundary to 3:1. Now
a separate `--control-line` token at 3.52:1. A product whose argument is "we
measure what others assert" does not get to ship a component boundary it never
measured — and the failure was in the one part of the page that was styled by
habit rather than derived from anything.

**Still open:** the asset pack and gallery (the run record has no asset slice,
and the exemplar library is deliberately not in this public repository), the
embedded tools, the publish path, and a client-shaped performance and
accessibility section over Phase 5's measurement targets.

## 5. Unproven claims

Things asserted somewhere that nothing has actually verified:

- **API cost and wall-clock (§10).** Every figure is an estimate. Run `5bac36cb`
  failed at Department 1 with $0.000 spent; the account has no credit. The
  estimate is ≈ $3.4 per Level 1 run before thinking tokens.
- **PageSpeed against a live URL.** Still true after the Phase 5 rebuild, and
  for the same reason. The parser is fixture-proven, including CrUX's CLS×100
  and page-versus-origin precedence; the request reaches Google and the failure
  path is proven live (`429 Quota exceeded for quota metric 'Queries'` on the
  shared anonymous quota, surfaced as a `ProbeFailed` naming the status rather
  than an empty record). **No real PSI response has ever been parsed.** Needs a
  `PSI_API_KEY`. This is the one acceptance criterion Phase 5 did not meet.
- **The header probe, by contrast, is proven live** — run against `github.com`,
  8 of 10 header targets met, and it found two bugs in its own judging that the
  fixtures did not: inverted `Referrer-Policy` precedence, and an error page
  being audited as though it were the page.
- **The mind-map acceptance run.** Still true after the Phase 4 rebuild.
  `checkMindMap` is tested against sixteen cases; **no brand questionnaire has
  ever been through Department 12**, because that needs a model call and the
  account has no credit.
- **Local Lighthouse.** Not built. §5's exit clause says PSI is enough for hosted
  sites, which has not itself been tested.
- **axe** cannot be probed from a server at all — it ships as an importer
  (`axeFromResults`) rather than a probe, and nothing in this repository runs
  axe yet, so no real results file has been through it.
- **Every target in the Phase 7 run.** All eleven rows in its Department 8 table
  are `stated-target`; no instrument ran, because Phase 1 did not exist when it
  was written. Phase 1 now exists, so **that run is due a re-execution** — its
  contrast, type-scale and SEO rows can become instrument-sourced, and its
  Department 5 and 8 sections should change as a result.

## 6. Honest accounting on this rebuild

- **227 tests across both packages** (69 rubric, 158 instruments), against the
  original's 101 and 66. Phase 1's count is higher because contrast is
  cross-checked pair-by-pair against two libraries; Phase 0's is lower because
  the original likely parameterised per-department assertions. Neither number
  was padded to match.
- **69 rubric tests here, against 101 in the original Phase 0.** The acceptance numbers
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
