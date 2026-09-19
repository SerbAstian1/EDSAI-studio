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

> **Superseded in part.** Tauri is built — see §4j. The rest of this section
> stands.

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

**One rule was enforced twice, and is not any more.** The hub shipped with its
own copy of the engine's provenance check, argued for on the grounds that the
verifier protects the run record while the hub protects the artefact that leaves
the building. Flagged at the time as the one deliberate exception, and then
removed on review.

The argument did not survive reading the code. `accept()` is the only path that
writes a department output, it runs `verifyTargets` on every submission, and a
claim it cannot verify is downgraded to `stated-target` before anything is
stored — so the condition the hub checked for could not reach the hub. It was
not a safety net, it was a second hand-written implementation of a rule the hub
did not own, positioned to drift and to fail silently when it did.

The real gap deletion opened — a write path added later skipping `accept()` — is
closed at `RunStore.saveOutput`, the single point every write passes through,
with a *structural* invariant rather than a copy of the check: a stored record
may not say `source: 'instrument'` while naming an instrument the same record
says was not called. `verifyTargets` still owns the question of whether a
measurement is real, which needs the turn's tool outputs and cannot be asked at
persistence time. Two rules, one implementation each.

Worth keeping in view: the exception was argued carefully, written down, and
still wrong. Being able to state a good reason for a duplicate rule is not
evidence that the duplicate is load-bearing — here the reason was fluent and the
code underneath it made the check dead on arrival.

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

## 4j. The desktop shell, and three checks that were lying

`@edsai/desktop` exists. A Tauri window around the built Studio, 4.5 MB binary,
**740 ms worst of five** from process start to the application mounted, against
the phase's 2000 ms criterion. Measured under Xvfb with software rendering, so a
real desktop is faster rather than slower.

The interesting part is not the number. Phase 6 refused to scaffold this shell
on the grounds that *"a window that launches in under two seconds and contains
an empty page would satisfy the phase's stated acceptance criterion while
delivering nothing."* Taking that seriously meant the shell had to prove it had
the app in it, and three successive versions of that proof were wrong in ways
that all read as success:

1. **Counting `#root`'s children.** The Studio ships a pre-paint fallback inside
   `#root`, so the count is never zero. A build with its entry script deleted
   passed.
2. **`AppHandle::exit(1)`.** Routes through the event loop; the process still
   ended 0. A script driving the check would have printed the failure and
   reported success.
3. **Sampling at `PageLoadEvent::Finished`.** On WebKitGTK that fires before
   deferred module scripts run, so a healthy build reported an empty root. This
   one sent me looking at the CSP for twenty minutes; the CSP was innocent.

Each was found by deliberately breaking the thing being checked and confirming
the check noticed. None would have been found by running it on a working build,
which is the only way any of them would ever have been run.

That is the same lesson Phase 5 recorded from the live header probe, arriving
from the other direction: there, fixtures written by the author of the logic
tested the author's model of the world. Here, a check only ever exercised on the
passing case tested nothing at all. **This repository now has two instances of
the same failure mode and no systematic defence against it.** Nothing forces a
negative case for a new check.

**Not built:** a bundled Node sidecar, so the engine's API is still a separate
process the user starts; CI does not build the shell, because that means the
WebKitGTK toolchain on every run plus a display, for a target nothing else
depends on; and no installer has been produced or run — `cargo build --release`
is verified, `tauri build`'s deb and AppImage packaging is not.

## 4k. CI was red the whole time

Every push to this branch failed CI, from Phase 3 onward, and this session added
four more before checking. The cause was one line of ordering: the workflow ran
`pnpm typecheck` before `pnpm -r build`, and each package typechecks against its
dependencies' emitted `dist/*.d.ts`. On a fresh checkout there is nothing for
`@edsai/prompts` to resolve `@edsai/rubric` to, so it failed in nineteen
seconds, every time.

It passed locally because `dist/` was already on disk from the previous build.
That is the whole failure: **the local check and the CI check were not the same
check**, and only one of them ran against a clean tree.

Fixed by building first — pnpm orders the build topologically, so the
declarations exist before anything typechecks against them. Verified by adding a
git worktree at `HEAD`, installing into it, reproducing the failure in the old
order, and running the corrected sequence green on that same clean checkout
rather than on the working tree.

Two things worth saying about this rather than moving on:

- **Nothing in this repository was watching CI.** Every phase document records
  its own acceptance carefully, and the one signal that runs automatically on
  every push went unread for nine commits. Careful local verification made the
  omission easier, not harder, to miss.
- **It is the third instance of one pattern**, after §4g's fixtures and §4j's
  desktop checks: a check that only ever ran against the passing case. Here the
  passing case was "a machine that had already built".

## 4l. Two auth holes, found by attacking my own code

Authentication was written and immediately reviewed adversarially, which found
two real vulnerabilities in it. Both are fixed; both are worth recording for the
shape rather than the specifics.

**A test that was true and proved nothing.** Sign-in returned the same status
and the same message for a wrong password and an unknown account, and there is a
test asserting precisely that. It is a correct test of the wrong property: scrypt
is slow, so a known email answered in 49.2 ms and an unknown one in 0.8 ms — a
60x tell that enumerates every account. Checking the *content* of two responses
says nothing about their *cost*, and having written both the code and the test
made the gap invisible.

**A race in the first-run setup.** The "is anyone set up yet" check and the write
were separated by an `await hashPassword`, which is deliberately slow. Four
concurrent requests all passed the check and all created an owner. The fix is a
second check after the only suspension point; the test was confirmed to fail
without it.

This is the same pattern as §4g, §4j and §4k, now for the fourth time: **a check
that was only ever exercised on the case it was written for.** The difference
here is that it was caught deliberately rather than by accident, by going back
over fresh security-sensitive code looking for the hole instead of running it
once and moving on. That is not a systematic defence — it is a habit, and it
only happened because the code was obviously worth attacking.

## 4m. One pipeline, one assumption, five broken routes

The request pipeline read every non-GET body as JSON before dispatching to the
route. That was correct for eleven months of routes because every route took
JSON, so nothing ever contradicted it. The upload route takes a PNG.

Two failures, and the second is the instructive one:

- The PNG was rejected as "body is not JSON" before the upload route ran at all.
  Loud, and easy to read from the test output.
- On an **empty** body, `readJson` resolved happily, the route ran, and its own
  `readBinary` waited on a stream that had already ended. The promise never
  settled; the test sat for 15 seconds and timed out. Nothing in the failure
  named the cause.

This is the fifth instance of the §4g/§4j/§4k/§4l pattern, with a new face: not a
check exercised only on its own case, but **a shared assumption that held because
every caller so far happened to satisfy it.** A pipeline that reads the body one
way for everyone is not wrong until something needs it read another way, and the
first thing that does is the thing that finds out.

The fix makes the assumption explicit rather than removing it: a route declares
`body: 'json'` or `body: 'raw'`, and the pipeline reads the stream exactly once,
accordingly. A route that wants bytes now says so where a reader can see it.

Two things came out of the same change and are worth keeping:

- **The body is now read after the session is resolved, not before.** It had to
  move anyway, and the ordering matters on its own: an unauthenticated caller
  could previously make this server buffer 25 MB before being told 401. There is
  a test for the ordering, not just for the status.
- **Over-limit is a typed error**, so it becomes a 413 rather than falling
  through the message-matching in `fail()` and arriving as a 500.

Still no systematic defence against the pattern itself — five for five found by
reading or by accident. The honest summary is that this codebase's checks are
good at the case they were written for and have no mechanism for the case they
were not.

## 4n. The same wrong inference, a second time

`listAssets` once returned nothing for a `limited` portal session because it
asked "may this session read assets?" of a resource with no collection on it.
That was fixed in §4m's commit. The convenience view added immediately after —
`listAllAssets`, every file across every visible client — reintroduced it by
resolving clients first, and `listClients` runs the same question against the
`client` record, which also has no collection.

The policy was the real site of the error both times. Rule 2 read:

    if (resource.collection === undefined || !granted.includes(...)) deny

which treats **the absence of a collection as a denial**. Only assets have
collections, so for every other resource kind that condition is not a rule, it
is an accident. A contractor given the logos folder therefore opened a portal
that could not name whose portal it was.

The rule now says what it means: read-only, the client record is readable
because a portal with no title is not a portal, assets are checked against the
grant, and every other kind is refused with a reason that names the kind. Each
of those four branches has a test; before, one did.

Sixth instance of the family in §4g/§4j/§4k/§4l/§4m, and the first **repeat** —
the same wrong inference, made twice, three hours apart, by the same reasoning.
That is the evidence that the pattern is structural rather than incidental. The
generalisable form: **a condition that is meaningful for one input shape and
merely true for all the others.** It is invisible in review precisely because
the line is correct where it was written.

## 4o. Three bugs a browser found that 900 tests did not

The portal was built with tests passing at every step, then opened in a real
browser. It was wrong in three ways, and the first was serious.

**The portal showed the unapproved draft and hid both approved files.** The
cause was not the approval logic. An asset's *record id* was derived from the
SHA-256 of its bytes — `asset-<digest>-<clientId>` — so three uploads of the
same image became one row, each overwriting the last. The survivor was the
draft, wearing the approval granted to the file it had replaced. Content
addressing is right for the **bytes** and wrong for the **record**: dedupe on
disk, distinct identity in the database. Two files with the same content and
different names is not an edge case; it is a designer uploading `logo.png` and
`logo-final.png`.

Nothing in the suite caught it because every asset test uploaded distinct
bytes. The one test that uploaded the same bytes twice asserted the digests
matched — which they did, and always would.

**A colour the style allow-list rejected was painted `transparent`,** which on a
white page is a white square. The client would read that as the colour. The page
now renders no chip at all and says the value cannot be shown. The rule this
restores is the system's own: refuse rather than degrade, and never assert what
you cannot show.

**Two cosmetic-but-real defects**: the unfiled group was labelled "Files" inside
a section called "Files", and a white swatch was invisible against a white page
(fixed with an inset ring, which the hub needed too — `paper` is a token every
brand has).

The pattern is not the §4g family. These are **assumptions no unit test can
contradict, because the test asserts the same thing the code does.** The digest
id looked correct in isolation and had a test that agreed with it. What
disagreed was three files in a browser.

The working rule this argues for: a surface a client sees gets opened, with
realistic data, before it is called done. That is now how this one was built,
and it is the only reason these were found before a client found them.

## 4p. Portal access: a bearer link, and what it costs

A client needs a way in. Passwords were rejected: a client receives brand files
a handful of times a year, and an account to create, remember and reset is a
barrier in front of work they have already paid for. So the credential is a
link.

The cost is real and is stated on the screen that issues it rather than in a
comment: **anyone holding the link is that client.** Three things bound it, and
all three are visible to the designer — an expiry, one-click revocation, and a
count of every use with a timestamp. The count is the part that earns its place:
a link opened forty times two months after the job ended is something a designer
can act on.

Three properties the implementation holds to:

- **The token is shown once.** Only its SHA-256 is stored, exactly as sessions
  are. A lost link is reissued, not looked up — which is an action the client
  can see.
- **A link cannot mint a link.** `owner` is not an issuable role, and the policy
  refuses `manage-access` to any portal principal regardless. Two independent
  reasons, because a bearer credential that reproduces itself is the failure
  that has no recovery.
- **The link is not a second authorization path.** Redeeming it mints an
  ordinary portal session; everything `ScopedStore` enforces is enforced for a
  client who arrived this way. The token leaves the address bar immediately via
  a 303, so it is not left in history, bookmarks or any `Referer`.

Revocation ends what the link already opened, not only new entries. Writing
the paragraph above is what surfaced it: deleting the key alone would leave
every browser already inside working until its session lapsed, which is not
what "withdraw" means to the person clicking it. The sessions a key minted are
identifiable because their user id is derived from its digest, so they go with
it — and the test was confirmed to fail without that line.

What is **not** built: no email is sent, so the designer copies the link and
sends it themselves, and there is no per-file audit — the count is per link,
not per download.

## 4q. The phone, and a preview that is not allowed to lie

Two surfaces were measured at a 390px viewport rather than assumed to work.

**The portal already did.** No horizontal scroll, nothing overflowing, no text
under 13px. One finding: the copy-a-hex control was 31px tall, which is a
finger problem rather than a narrow-screen one, so it is sized under
`@media (pointer: coarse)` instead of a width breakpoint.

**The Studio laid out at 504px on a 390px screen.** Not a missing viewport meta
— that was there. A fixed sidebar column plus a content column that cannot
shrink below its widest table has a floor, and the browser zoomed the whole
page out to meet it. The fixes are all about letting things shrink: the shell
collapses to one column under 860px, the sidebar becomes a band, and grid and
flex children get `min-width: 0` so a long filename stops setting the width of
the page.

That left one real defect. A table whose last column is an action does not
survive being made scrollable: **Approve — the one control that changes what a
client can see — ended up off the right edge, inside a horizontal scroll nobody
thinks to try.** Those tables now become one card per row on a phone, each cell
labelled by the header it came from.

**The preview build.** The Studio is published as a page that can be opened on
a phone with no server. The rule it holds to: it **replays, it does not
simulate.** `scripts/capture-preview.mjs` signs in to a real server, performs
real reads, and writes down what came back; the preview serves those recordings
and nothing else. A hand-written mock would be a second opinion about how the
API behaves, and it would drift silently — staying plausible while the product
broke. A recording can only be stale, and staleness is visible.

Writes are refused rather than faked, with the reason shown the way any other
refusal is shown. Accepting an upload and adding it to the list would teach the
reader that something works when it has never been tried, which is the one
thing a preview must not do.

Two properties worth keeping:

- The recording and the transport that serves it are reachable only from a
  separate entry (`vite build --mode preview`), so they cannot enter the
  shipping bundle by accident. Confirmed by grepping the shipping `dist` for
  the captured data, not by reasoning about tree-shaking.
- A banner states what the page is and when the data was captured. Someone
  looking at this on a phone has no other way to tell a recording from a live
  deployment.

What this is **not**: a way to use the product. It is read-only by
construction, and the initial-route budget is unaffected (89.5 KB gz against
170 KB) because the preview is a separate build.

## 4r. Web only, and a density pass

**The desktop app is gone.** `packages/desktop` — the Tauri shell, its launch
check and its Rust — is deleted rather than parked, on the owner's decision to
make EDSAI a website so it reaches any device. Deleting beats leaving it
unbuilt: an unmaintained shell in the tree is a thing every future change has
to consider and nothing exercises. §4j's findings about it stay in this file,
because what they taught (three checks that were lying) outlives the package.
The git history has the code if it is ever wanted back.

This raises the stakes on hosting, which still does not exist. Web-only with no
server is a product that runs on one laptop.

**Spacing is now five tokens, not sixty multipliers.** `--space-page`,
`--space-block`, `--space-card`, `--space-section` and `--row-y` carry the
rhythm of the interface, so its density is one edit rather than an archaeology
exercise. The rule behind the numbers: air *between* blocks is what makes a
page readable; air *inside* them is mostly scrolling. Gaps stay legible,
padding is tight.

The pass exposed a bug that had been shipping. **`.swatches` had no rule in the
Studio's stylesheet at all** — the hub has one, the Studio never got it — so
every brand value was a full-width block. Four colours became four stacked bars
taller than the rest of the client page combined, and no two colours in a
palette could be seen at once, which is the only way a palette is ever read.
It was invisible at the old density because everything was loose; tightening
the page made it the loudest thing on it.

**Density is a pointer-precision question, not a screen-width one.** The
tighter controls sit behind a `@media (pointer: coarse)` floor that keeps
buttons, inputs and nav items at 44px on touch. Re-measured at 390px after the
pass: no horizontal scroll, one sub-44px target left (the wordmark, now
floored).

## 4s. Page transitions, and the three things that make them work

Route changes now animate. The visible part is small — the outgoing page fades
in 110ms without moving, the incoming one rises 6px over 300ms on a curve that
decelerates hard and never overshoots. The asymmetry is the effect: equal
durations in both directions read as a cross-fade, which is a slideshow rather
than a navigation.

Everything that makes it work is outside the CSS:

1. **Only `.content` is named.** The sidebar, the topbar and the scroll
   position are outside the transition. Furniture that fades on every click
   reads as a page reload.
2. **The next screen's code and data load first.** `startViewTransition`
   snapshots the page, runs its callback, snapshots again — so whatever the
   callback renders is what gets animated to. Without preloading, that is a
   Suspense fallback; with the code preloaded but not the data, it is the
   screen's own "Loading…" line. An animation that draws the eye to a
   placeholder is worse than no animation.
3. **`flushSync` inside the callback.** React batches by default, which would
   let the transition snapshot the old tree twice and animate nothing.

`prefetch.ts` restates which queries each screen runs, which is duplication and
is written down as such. The alternative was converting every `useQuery` in the
product to a suspending one — changing how loading and errors work everywhere —
to fix a flicker. When the map drifts, the cost is the flicker it was added to
prevent: nothing renders wrong, and nothing is fetched twice. The warm has a
250ms deadline, because waiting on the network before moving would make a slow
connection feel like a broken button.

Two honest limits. **Firefox has no View Transitions** at the time of writing,
so it gets a plain navigation — a page that only works in Chrome and Safari is
broken for a third of the web, so the fallback is the default path rather than
an afterthought. And **`prefers-reduced-motion` removes the animation
entirely** rather than shortening it; that request is for no motion, not for
cheaper motion.

One methodological note. The first probe of this reported a loading flash
during the transition, and it was wrong — it matched the substring "Loading"
anywhere in `document.body`, including outside the animated region. A narrower
probe of `.content` at snapshot time showed a fully rendered page. The §4g
family is usually a check that passes for the wrong reason; this is the same
error inverted, and it nearly sent me rewriting a data layer that was working.

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
