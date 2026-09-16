# What DesignerHQ proves, and what EDSAI should take from it

*Analysis of Nonstop Studio's DesignerHQ (Jack Watson), September 2026.*

## The product, decomposed

DesignerHQ is four layers under one name:

| Layer | What it does | EDSAI today |
|---|---|---|
| Business operations | Proposals, contracts with e-signature, invoices, payment | none |
| Client workspace | Per-client dashboard, project timeline, document comments, client-view toggle, asset library, Slack/CRM connectors | none |
| Process scaffolding | 27-question discovery, call transcript → AI strategy draft, visual-analysis boards, speed runs | Departments 1–4 do this with more rigour |
| Brand Hub | Hosted interactive guidelines site: click-to-copy hex, logo pack download, automatic WCAG contrast, layout previews, embedded tools | Departments 5 and 13 reason about it but cannot emit it |

Most of it is workflow and client experience. Very little of it computes anything.

## The asymmetry

The video names exactly one automated check in the entire product:

> "the color palettes here as well which passed WCAG contrast — and this is done
> completely automatically, so you don't have to manually check which colors are
> accessible."

That is one instrument, presented as a highlight feature. EDSAI's Phase 1 shipped
ten, and Phase 5 added four more: WCAG *and* APCA, worst-case backdrop for
translucent surfaces, type-scale ratio-spread auditing, spacing orphan detection,
line length from real font metrics, legibility at distance, composition geometry
that can refute a claimed structure, motion timing, SEO lengths, bundle, Core Web
Vitals with field-over-lab precedence, CSP with what-a-failure-actually-allows,
print gamut, dielines.

**He has the business surface EDSAI lacks. EDSAI has the engine he lacks.**

Copying the product means competing with Dubsado and HoneyBook on invoicing.
Absorbing the insight means building something neither product currently is.

## Where the two genuinely converge

### 1. The Brand Hub is the missing output of the pipeline

The strongest idea in the video, and it plugs into the existing architecture
without changing the thesis. EDSAI computes a design system and scores it, then
ends in a document. DesignerHQ ends in a live URL the client's whole team works
from daily.

An EDSAI brand hub would ship **verified** rather than merely presented: every
colour pair carrying its measured ratio and what it was measured against, the
type scale showing its actual ratio spread, logo clear-space computed rather than
eyeballed, layout rules naming their structure from the composition catalog.

His hub asserts a palette is accessible. Ours would show the number.

This is the proposed **Phase 7**.

### 2. Competitor palette analysis is an instrument waiting to be written

He does this by hand: screenshot the competitors, plot their hues on a wheel,
eyeball the unoccupied arc, note that the category is saturated with sans-serifs.
That is mechanical work, and Phase 5 already built the probe infrastructure it
needs — fetch, normalise, store, evaluate.

`competitor_palette_audit` would take a list of competitor URLs and report hue
occupancy with actual coverage percentages, the unoccupied arcs, and typeface
classification across the set. It feeds Department 2's aesthetic direction and
Department 5's palette.

Neither product automates this today. It is the most defensible single feature in
this analysis.

### 3. Direction Lock is his visual-analysis step

Worth noting: the panel Phase 3 cut for want of a corpus file does the same job —
pinning a direction as an explicit coordinate set before references are gathered.
The sub-skill is now vendored in `corpus/direction-lock/`, so the cut no longer
holds.

## What is a different company

Proposals, contracts, e-signature, invoices, payments, multi-tenant client
accounts. That is Stripe, e-signature legal compliance, per-tenant authorisation,
file storage and billing — and it moves the system from Level 1 to Level 3 in a
single step.

The build plan's own risk table names this failure mode: *"enthusiasm adds
real-time, offline, or a global store before a measured need."* Building it is
months of commodity SaaS competing on features EDSAI has no edge in, while the
engine — the part nobody else has — stands still.

**Recommendation: take the delivery layer, not the CRM.**

## The business argument is already EDSAI's

The video's actual thesis is about positioning, not software:

> lead with the business problem → state the desired market position → explain
> the process → *then* the deliverables have context.

This is the same claim the corpus makes. A proposal that leads with a deliverables
list invites comparison on price; a brand hub that proves its own compliance is a
different category of object from a PDF of swatches. EDSAI's contribution to that
argument is evidence — the numbers behind the claim.
