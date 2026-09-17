# Phase 4 — Visual critique (the computable half)

**Status:** the two instruments are built; the overlay UI is not, and one of
them still has no acceptance run. `@edsai/instruments` is now 209 tests.

Phase 4 was recorded as "built previously, mind-map run never made". What is
rebuilt here is the half that computes. The half that draws — the composition
overlay with pan/zoom pointer physics — is deferred, for a stated reason below.

## `composition_check`

`composition-frameworks.md` exists to stop a layout being described only in
adjectives. Its second failure condition names the check directly:

> A named structure that doesn't match the stated eye-path — e.g. calling
> something "Radial" when the actual visual weight sits in a corner, not at a
> center point.

That is a geometric claim, and a geometric claim can be **refuted**. So the
instrument does not identify a structure. Naming one is the designer's
judgement and there is usually more than one defensible answer; the instrument
takes the name that was claimed and asks whether the geometry can support it.
That is the same relationship the rest of this system has with the model — it
may state a target, it may not assert a measurement.

Three verdicts, and the third matters as much as the other two:

| Verdict | Meaning |
|---|---|
| `supported` | the geometry is consistent with the claim |
| `refuted` | the geometry contradicts it, with the numbers that do so |
| `not-computable` | this instrument cannot speak to the claim, and says why |

Ten of the catalog's twenty-nine structures are in the third category by
design. A spiral, a tunnel and a set of leading lines are claims about
curvature, perspective and line direction; axis-aligned bounding boxes carry
none of those. Guessing from boxes would produce a number that looks like a
measurement and is not one.

### What it computes regardless of the claim

These are Department 14's own failure conditions, and they do not depend on
which structure was named:

- **Weight against hierarchy.** "Weight that lands somewhere other than the
  primary message is a hierarchy failure regardless of how attractive the
  layout is." Computed as a share, and named.
- **The eye-path.** A path that starts somewhere other than the heaviest mass
  is wishful; a missing path is a failure condition, not a missing field.
- **Type scale contrast** between primary and secondary type.
- **Safe-by-default as a habit** — Rule of Thirds or plain Symmetry claimed
  three deliverables running, which the catalog names as its own failure mode.

### The weight model, stated

Visual weight is `area × contrast`, where contrast is the element's separation
from its ground on 0–1 and defaults to 1. Department 14 defines the heaviest
mass as "largest type, darkest value, highest contrast element", and
`area × contrast` is the computable part of that. It does not model colour
temperature, faces, or the pull of a readable word over an abstract shape. A
caption that says something urgent outweighs its area and nothing here sees it.

Weight in a region is apportioned by **how much of each element overlaps it**,
not by where its centre lands. A column spanning the full height belongs to both
left quadrants; binning it by its centre would report an imbalance the layout
does not have. Coverage is measured by rasterising at 100×100, so overlapping
elements are not double-counted.

### Thresholds

Where the corpus states a rule qualitatively, this file picks a number to make
it testable. All of them are in the exported `COMPOSITION_THRESHOLDS` and every
finding that uses one names it, so a disagreement is with a stated constant
rather than a hidden one.

## `checkMindMap`

Department 12 exists to prevent "generating one idea and calling it
exploration, or generating ten superficially-different ideas that are all
restatements of the same concept." Its first failure condition is the
computable form: **fewer than three genuinely distinct conceptual territories**.
The branch a surviving direction came from is data, not opinion, so that one is
a **Blocker** when it fails.

Also computed: the 3–5 bound from 12.3, whether every direction cites a
Department 1 or 2 input (12.3's first filter — "if it can't be traced, cut it"),
whether each carries construction logic rather than a mood description, whether
an abstract direction names its composition structure, and 12.2's convergence
signal — two branches arriving at the same idea from different angles.

One check goes further than counting. Two directions whose stated concepts share
more than half their content words are flagged as restatements: *ten renders of
one idea leave a trace in the words used to describe them.* It is a heuristic and
is reported as one.

What it cannot do: the competitor-swap test, longevity, or telling a genuine
metaphor from a tired one. Those are judgement and are not simulated.

Department 12 never produces final logo art, and nothing here moves toward it.
It counts and compares text.

## Run against a real surface

Both instruments are fixture-tested, and Phase 5 established that fixtures
written by the author of the logic test the author's model of the world rather
than the world. So `composition_check` was run against the Studio's own
workspace screen, rendered in headless Chromium, with the real bounding boxes
read out over the DevTools protocol.

It worked, and it immediately said something true and something misleading:

```
heaviest: SECTION (the runs panel) — 61.5% of the visual weight
primary:  H1 "EDSAI Studio"        —  0.9%
halves:   50.5% / 49.5%   torque: -0.005   coverage: 24.4%
symmetry: supported     rule-of-thirds: refuted
```

The numbers are right and internally consistent. The *hierarchy finding* is not
a fault in the Studio — it is the test harness marking the `<h1>` wordmark as
the primary message. In an application shell the content panel **should**
dominate and the wordmark should not; Department 14's hierarchy rule is a poster
rule, about one surface seen once at a distance.

That is worth recording rather than hiding, because it names the instrument's
real precondition: `role: 'primary'` means *the primary message of this
composition*, and whoever labels the elements has to mean it. Fed a bad label,
the instrument computes a correct number about the wrong thing — which is a
sharper failure mode than being vague, and the reason the label belongs to the
department rather than to a DOM heuristic.

## What is not built

- **The composition overlay UI** — the panel that draws thirds, golden
  divisions and a weight map over an uploaded image, with pan/zoom pointer
  physics. It needs images to be useful, and the exemplar library is
  deliberately not in this repository (third-party client work; the data model
  says "local library, never redistributed"). The geometry it would draw is now
  all computed, so the panel is presentation over a solved problem rather than
  new reasoning.
- **The mind-map acceptance run.** `checkMindMap` is tested against sixteen
  cases; **no brand questionnaire has ever been through Department 12.** That
  needs a model call, and the account has no credit. This remains an open gap,
  carried over from the original Phase 4 unchanged.
- **JARVIS mode** — the conversational ideation surface Department 12's role
  section describes. Specified nowhere in this repository yet.
