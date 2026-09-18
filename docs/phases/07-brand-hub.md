# Phase 7 — Brand Hub

**Status:** built. `@edsai/hub`, 28 tests. Generated from a real FINAL run,
rendered in a browser, and audited with this system's own instruments.
**Position:** after Phase 1 (instruments) — see *Dependencies*. Not after Phase 6.

## Why it exists

The pipeline currently ends in a document. A designer runs 24 departments, the
instruments compute real numbers, Arbitration gates FINAL — and the output is a
PDF that the client reads once.

Meanwhile every person who actually uses a brand day to day — the client's
marketing team, an external agency, a freelancer building a deck — needs four
things repeatedly: a hex code, a logo file, a type rule, and permission to
believe they are using the brand correctly. A document serves none of those well.

Phase 7 makes a FINAL run emit a **hosted brand hub**: a shareable URL that is
the client's working reference.

The differentiator is not the hub. Hosted brand guidelines already exist and some
are good. The differentiator is that **every value in ours carries its
measurement and its provenance**. A colour pair does not say "accessible"; it
says `7.04:1 — AA large text, AAA body, measured against #FFFFFF`. The type scale
does not say "harmonious"; it states its ratio and its measured spread. That is
the one claim no competitor can make without building the instruments first, and
the instruments already exist.

## What it builds

- **Generator** — `@edsai/hub`, a build-time renderer over a FINAL run record.
  Input is the run; output is a static site. No new authoring surface: if a value
  is not in the run, it cannot appear in the hub.
- **Sections**, each a renderer over a typed slice of the run: strategy, logo
  rules and asset pack, colour with click-to-copy and measured ratios, type
  rules, layout rules naming their composition structure, and a gallery.
- **Provenance rendering** — a shared component that displays any `Target`
  according to its `source`. `instrument` renders the measured value and what it
  was measured against; `stated-target` renders the target and its stated
  mechanism, visibly distinct. The distinction is the product.
- **Asset pack** — logo files zipped from the run's assets, content-addressed.
- **Embedded tools** — sandboxed iframes for the vibe-coded generators a studio
  may want alongside the guidelines.
- **Publish path** — static output deployable to any host, with a stated
  regeneration trigger (see the staleness conflict in the run record).

## Done when

1. A FINAL run emits a hub with no hand-authored content.
2. Every colour pairing in the hub renders a ratio produced by the contrast
   instrument in that run — no hub value is typed by a human or asserted by a
   model.
3. A pairing that fails its target renders as a failure with its remediation,
   rather than being omitted. *(See QA-2 in the run record: this is a product
   decision with a business consequence, not only a rendering rule.)*
4. The hub meets its own budgets — stated in the run record's Department 8
   section, and tighter than the Studio's, because the hub is content.
5. Regenerating after a Studio change produces a hub whose values match the
   current run, and the staleness policy is stated rather than implied.

## Dependencies

**Phase 1 is a hard prerequisite.** The hub's entire claim is instrument-sourced
values; without the instruments there is nothing to render that a competitor
could not assert. Building the hub first produces a prettier version of what
already exists.

Phase 3's run record and Phase 5's measurement bridges are soft prerequisites: a
hub can render a partial run, but the performance and accessibility sections stay
empty until the bridges fill them.

## Exit if wrong

The generator and the host are separable. If hosting, custom domains or the asset
pack prove heavy, emit the hub as a single self-contained HTML file the studio
delivers however it already delivers files. Every claim above survives that
reduction; only distribution changes.

## What it is not

Not a client portal. Proposals, contracts, e-signature, invoicing and multi-tenant
client accounts are deliberately out of scope — they move the system from Level 1
to Level 3 in one step and compete on features EDSAI has no edge in. The
reasoning is in `../strategy/designerhq-analysis.md`.


---

# As built

## The schema change the claim required

The hub's whole claim is that every value carries its measurement. That was not
possible while a hex code existed only inside a department's paragraph: parsing
it back out would be the fabrication this system exists to prevent, one layer
down. So the run record gained two things:

- `BrandToken` — a named value with a kind (`color`, `font`, `size`, `space`,
  `radius`, `asset`, `text`), a role and optional notes. Departments write them;
  nothing else does.
- `Target.tokens` — which token names a measurement is about.

Both default to `[]`, so every run recorded before they existed still parses,
and `RunStore` migrates an existing database by adding the column rather than
failing on the first write.

`Target.tokens` is the part that matters. Without it, a hub rendering a swatch
beside its ratio has to match the two by reading the metric string — a guess
wearing a join's clothes. With it the join is exact, and a colour the run never
measured cannot be silently paired with a ratio that belongs to something else.

## It refuses rather than degrades

A hub is what a client works from every day, so a partial one is worse than
none. `buildModel` throws `HubRefused` with a stated reason in two cases:

| Reason | When |
|---|---|
| `not-final` | the gate does not hold FINAL — an open Blocker or Major, or an unresolved conflict |
| `unmeasured-colour` | a colour token carries no contrast measurement from this run |

Both are the hub's own. The first calls `evaluateGate`, the engine's function,
rather than reimplementing the gate; the second is a rule nothing else in the
system has, because nothing else renders a swatch.

### The check that used to be here, and why it is not

An earlier version also refused a target that named no instrument, or credited
one its department never called. That was a second enforcement of the engine's
provenance rule, argued for on the grounds that the verifier protects the run
record while the hub protects the artefact that leaves the building.

The argument was wrong in the ordinary way. `accept()` is the only path that
writes a department output, it runs `verifyTargets` on every submission, and a
claim it cannot verify is downgraded to `stated-target` **before** anything is
stored — so the condition the hub was checking for could not reach it. What the
hub had was not a safety net but a second, hand-written implementation of a rule
it did not own, positioned to drift from the original the first time the rule
changed and to fail silently when it did.

Deleting it left one real gap: a write path added later could skip `accept()`.
That is closed where it belongs, at `RunStore.saveOutput` — the single point
every write passes through — with a structural invariant rather than a copy of
the check. `verifyTargets` decides whether a measurement is *real*, which needs
the turn's tool outputs. The store only refuses to persist a record that
contradicts itself: `source: 'instrument'` naming an instrument the same record
says was not called. Those are two different rules with one implementation each,
which is the thing the repository was already claiming and now does.

## One self-contained file

The exit clause said a single self-contained HTML file survives the reduction
with every claim intact. That is where this starts rather than ends: no
framework, no build step, no requests. Click-to-copy is the only behaviour and
it degrades to selectable text.

The hub renders at **2.8 KB gzipped** against a 40 KB budget — a quarter of the
Studio's 170 KB, which is the "tighter, because the hub is content" the
acceptance criteria asked for. The budget is judged by `bundleAudit` from
`@edsai/measure`: the same function that gates the Studio's build and produces
Department 43's target row. Three surfaces, one rule, one implementation.

## Staleness, stated

Every hub carries a digest of the run it was generated from, printed in its own
footer. `edsai-hub check <runId> --digest <digest>` recomputes it and says
`current` or `STALE`. The digest deliberately excludes the generation time, so
regenerating an unchanged run produces the same digest and a rebuild is not
mistaken for a change.

The policy is therefore stated rather than implied: **a hub is stale the moment
its digest stops matching its run, and the generator will say so on request.**
Nothing regenerates automatically, because a client's working reference changing
under them without anyone deciding is worse than one that is briefly behind.

## Acceptance

| Criterion | Result |
|---|---|
| A FINAL run emits a hub with no hand-authored content | **met** — every field is a projection of the run; there is no authoring surface |
| Every colour renders a ratio from the contrast instrument in that run | **met** — enforced by refusal, including a stated target offered in place of a measurement |
| A failing pairing renders as a failure, not omitted | **met** — `is-fail` styling, and the complete target list renders every row |
| Meets its own budget | **met** — 2.8 KB gz against 40 KB |
| Regeneration matches the current run, staleness stated | **met** — digest in the footer, `check` subcommand, time excluded from the digest |

Verified end to end, not asserted: a FINAL run was seeded whose colour targets
came back from real `contrast` calls (17.76:1, 7.88:1, 5.27:1 — none typed by
hand), the CLI built the hub from the database, and Chromium rendered it with
every measured value, the stated target with its mechanism, the accepted risk,
and the digest present in the output.

## What the hub found in itself

The hub was audited with the instrument it renders. Its own palette passes AA in
both colour schemes. One thing failed: the copy button's border reused the
decorative hairline token at **1.26:1** against the page, and WCAG 1.4.11 holds
the boundary of a UI component to 3:1.

Fixed with a separate `--control-line` token at 3.52:1 against the page and
3.25:1 against the button's own fill, both measured rather than picked. A
product whose argument is "we measure what others assert" does not get to ship
a component boundary it never measured.

## Still not built

- **The asset pack.** Logo files zipped from the run's assets,
  content-addressed. The run record has no asset slice yet, and inventing one
  before a department writes to it would be guessing at a shape.
- **Embedded tools.** The sandboxed iframes for vibe-coded generators. Nothing
  needs them yet, and an empty extension point is a liability.
- **A gallery.** Same reason as the asset pack: it needs images, and the
  exemplar library is deliberately not in this public repository.
- **The publish path.** The generator emits files; nothing deploys them. That is
  a hosting decision rather than a code one, and the single-file output means
  any host will do.
- **Performance and accessibility sections.** Phase 5's bridges exist now, so a
  run that carries measurement targets will render them in the complete target
  list — but there is no dedicated section shaping them for a client reader.
