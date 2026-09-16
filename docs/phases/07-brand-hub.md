# Phase 7 — Brand Hub

**Status:** specified, not started.
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
