---
name: direction-lock
description: EDSAI sub-skill. Locks a website's frontend design direction as an 11-axis coordinate set, then derives a reference sourcing brief from it — a per-slot gather list with explicit accept/reject criteria, plus token defaults. Use whenever the user is about to gather design references, is vibe coding a site from mixed sources, asks what to source or where to start, says they want a hero from one place and a footer from another, asks how to make mismatched references cohere, or needs to decide a frontend approach before building. Also use to re-run a lock when a brand guideline, client brief, or new constraint arrives mid-project — it emits a diff rather than a fresh answer. Trigger on "what references do I need", "how do I pick a direction", "direction lock", "sourcing brief", "gather list", or any request to determine a site's visual approach before code exists.
---

# DIRECTION LOCK
**EDSAI Department 2 sub-skill — the pre-sourcing gate.**

## What this is

Reference gathering fails predictably. A hero from Site A, a footer from Site B, and scroll behaviour from Site C each carried an invisible parameter set — a type scale, a spacing base, a density rhythm, a radius language, a motion timing family, a compositional structure. Three sources means three conflicting parameter sets, and the result reads as assembled rather than designed.

The fix is not better references. It is **deciding the direction first, then sourcing as evidence for decisions already made.**

This skill exists because that decision is not free-form. It is a **coordinate set with a fixed number of axes and a constrained set of legal positions on each.** Once the coordinates are fixed, the gather list, the reject criteria, and the token defaults are largely *derivable* rather than invented. That derivation is what makes this a tool rather than a checklist.

**The output that matters most is the rejects.** Every reference platform helps you collect. None of them tells you what to throw away. The reject rule is the product.

---

## The Lock — 11 axes

Three are gated free text. Eight are enumerated. Nothing is optional.

### Gated text axes

| Axis | Requirement | Gate |
|---|---|---|
| **T1 · Positioning** | "For [audience], [brand] is the [category] that [differentiator], because [reason]." | Swap a competitor's name in. If it still reads as true, it is category description, not positioning. Reject and redo |
| **T2 · Emotional tone** | The specific feeling in the first three seconds | Must be buildable by a set designer. "Modern and clean" fails. "The calm of an arrivals hall where someone is already holding a sign with your name on it" passes |
| **T3 · Motion law** | One sentence governing every animation | One rule only. If it contains "and" joining two rules, it is two laws and neither will hold under pressure |

### Enumerated axes

| Axis | Legal positions |
|---|---|
| **E1 · Trust mechanism** | `RESTRAINT` or `DIRECTNESS` |
| **E2 · Narrative energy** | 1–5 |
| **E3 · Visual energy** | 1–5 |
| **E4 · Minimal ↔ Expressive** | ratio, e.g. `30/70` |
| **E5 · Modern ↔ Timeless** | ratio |
| **E6 · Corporate ↔ Artistic** | ratio |
| **E7 · Structured ↔ Organic** | ratio |
| **E8 · Composition** | default family + avoided family, from: Grid & Proportion · Radial & Focal · Line-Driven · Weighted Shapes · Balance Logic · Depth & Frame |

**On E2/E3.** Narrative energy and visual energy are separate axes on purpose. A brand can run high narrative energy — emotional hooks, tension, story arc — on top of low visual energy, and that combination is frequently stronger than either pole alone. Collapsing them into one "energy level" is the most common error this skill exists to prevent. When a brief says "dynamic," ask which one it means.

---

## The Gate

Do not emit a sourcing brief if any of the following is true. Say which gate failed and what is needed.

1. Any axis is unset
2. Any ratio axis is `50/50` — that is an unmade decision wearing the language of nuance
3. T1 fails the name-swap test
4. T2 fails the set-designer test
5. T3 contains more than one rule
6. **Resolution Score below 8/11** — count axes decided from actual client input, not inferred. Below 8, the brief would be a guess with a table around it

State the Resolution Score every time, as `decided/11`, and name which axes are assumed rather than sourced. An assumed axis is not a failure, it is a labelled risk.

---

## The Derivation Engine

Once locked, read constraints off the coordinates. These are defaults, overridable with a stated reason — never silently.

### From E1 · Trust mechanism

| `DIRECTNESS` | `RESTRAINT` |
|---|---|
| Whitespace 25–40% | Whitespace 50–70% |
| Proof above the fold: faces, names, numbers, addresses | One primary message per viewport |
| Pricing forward where permitted | Pricing gated or absent |
| **REJECT:** sparse-luxury refs · refs withholding information above the fold · refs with no human presence | **REJECT:** evidence-wall refs · badge-and-logo-soup refs · price-forward refs |

Withheld information reads as luxury in some categories and as fraud risk in others. E1 is the axis that decides which, and it governs more downstream decisions than any other. Set it first.

### From E3 · Visual energy

| Level | Reveal duration | Rules |
|---|---|---|
| 1–2 | 550–600ms | Max one motion event per viewport. No parallax. No stagger |
| 3 | 450–550ms | Stagger permitted at ≤80ms intervals |
| 4–5 | 400–450ms | Parallax and scroll-scrub permitted, reduced-motion fallback mandatory |

All levels inherit the standard bands: micro-feedback 100–150ms ease-out, UI transitions 200–300ms, section transitions 500–800ms.

### From E2 · Narrative energy

- **4–5:** copy leads with tension before the offer. **REJECT** feature-grid-first refs and announcement-format refs
- **1–2:** copy leads with the offer. **REJECT** long-scroll story refs that delay the value proposition past the second viewport

### From E4 · Minimal ↔ Expressive

- Minimal ≥60 → type scale ratio ≤1.25 (Major Third or tighter). Max two colour roles visible per view
- Expressive ≥60 → type scale ratio ≥1.333 (Perfect Fourth or wider). Display type may break the grid; nothing else may

### From E5 · Modern ↔ Timeless

- Timeless ≥60 → **REJECT** glassmorphism, bento grids, gradient mesh, neo-brutalism, variable-font morphing, blob gradients. These are symptoms of a prompt, not evidence of a brand
- Modern ≥60 → the above are permitted, but each must independently pass the swap test before it enters the build

### From E6 · Corporate ↔ Artistic

- Corporate ≥60 → **REJECT** cursor-follow effects, non-standard navigation patterns, horizontal-scroll sections, scroll hijacking beyond simple smoothing
- Artistic ≥60 → permitted, but primary navigation must remain reachable in one action

### From E7 · Structured ↔ Organic

- Structured ≥60 → the grid must be visible or inferable in every reference. **REJECT** collage, overlapping-freeform, hand-placed layouts
- Organic ≥60 → freeform permitted, but a spacing scale is still mandatory. Organic is a compositional choice, never an excuse for orphan values

### From E8 · Composition

- Default family sets the required structure for hero and primary sections
- **Any reference whose dominant structure is the avoided family is auto-rejected regardless of other merit.** This is the single highest-leverage filter in the engine; apply it before evaluating anything else

---

## Output: the Sourcing Brief

Emit in this order.

### 1. The Lock
All 11 axes with their positions, plus Resolution Score and the list of assumed axes.

### 2. Gather list, per slot, each with its derived reject criterion

| Slot | Qty | Extract | Reject if |
|---|---|---|---|
| Hero | 2–3 | Compositional structure, type-to-whitespace ratio, above-fold message clarity | *derived from E1, E8* |
| Nav / header | 2 | Scroll behaviour, mobile pattern, item count | *derived from E6* |
| Section rhythm | 2 full pages | Density alternation | *derived from E1* |
| Cards / blocks | 2 | Elevation, radius, internal padding ratio | *derived from E4* |
| Forms / inputs | 1–2 | Label position, error state, focus ring | *derived from E1* |
| Buttons | 1–2 | All five states: default, hover, active, focus, disabled | reject any ref showing default only |
| Footer | 2 | Column logic, secondary-link hierarchy, closing statement | *derived from E8* |
| Empty / loading / error | 1 | The states generic builds forget | — |
| Motion, per event | 1 each | Reveal · hover · nav transition · page transition · ambient | *derived from E2, E3* |
| Direction refs | 3–5 | Whole-site feel. Source from outside web design where possible | *derived from E5* |
| Anti-refs | 2 | Competitors, for what to deliberately not resemble | — |

### 3. Token defaults derived from the lock
Type scale ratio, spacing base (base-8 unless density demands base-4), whitespace target, motion band, permitted colour-role count.

### 4. Capture template
Per reference, five fields. Field 5 is the one people skip and the one that prevents the Frankenstein result.

1. Source
2. The single thing being taken — one sentence. If it cannot be isolated to one thing, the whole site is being taken, which is copying
3. Which axis it serves, named. No named axis means reject
4. Extracted parameters: approximate type ratio, spacing base, contrast character, motion feel, compositional family
5. **What is being deliberately dropped**

### 5. Normalization checklist
Every sourced pattern is rewritten through one system before it enters code. One type scale, one spacing base, one radius/border/elevation language, one colour-role map, one motion timing table, one compositional family. Then two tests:

- **Swap test** — drop any component into a generic SaaS template. If it blends in, it is a default with brand colours painted on
- **Mute test** — remove all animation. If nothing is lost, the motion was decoration

### 6. Scorecard
Department 2 dimensions per `references/00-scorecard.md`: the four Universal Dimensions plus Emotional Coherence, World Specificity, Cinematic Discipline. Every score needs a one-sentence justification. Never default to 7.

---

## Re-entry mode

When a brand guideline, client brief, or new constraint arrives after a lock exists, do not produce a fresh answer. Re-run the lock and emit a **diff** in four buckets:

- **CONFIRMED** — the source corroborates an inferred axis. Raise Resolution Score
- **CORRECTED** — the source contradicts an axis. State plainly what was wrong, then correct it. Do not re-justify the original
- **NEW CONSTRAINT** — a hard limit the lock did not know about: contrast ratios, minimum logo sizes, mandated imagery, banned devices, string-length expansion in secondary languages
- **CONFLICT** — the source contradicts itself, or contradicts a stated client request. Surface it, propose a resolution, and hand the decision back. Do not resolve a client's internal contradiction silently

Then rescore, and name every score that moved and why.

**Always compute, never assume:** any colour pairing that will carry text gets its actual contrast ratio calculated against 4.5:1 normal and 3:1 large. A palette in a guideline document is not a validated palette. This check has a high hit rate and finding a failure late is expensive.

---

## Worked example (compressed)

*Education agency, West African families, fraud anxiety is the category's dominant emotion.*

- **E1** `DIRECTNESS` — in this category withheld information reads as fraud risk, not luxury. Drives whitespace to 30%, proof above the fold, faces mandatory
- **E2** 5 / **E3** 2 — high narrative energy on low visual energy. Drama lives in the copy sequence and the faces, never in animation
- **E4** 30/70 Expressive · **E5** 25/75 Timeless · **E6** 75/25 Corporate · **E7** 85/15 Structured
- **E8** default Grid & Proportion, secondary Depth & Frame, avoided Radial & Focal — radial manufactures hype, and hype is a liability where the audience is scanning for fraud signals
- **T3** "Motion moves the user one step further through the process. It never performs."

Derived rejects that follow automatically: no bento grids or glassmorphism (E5), no cursor-follow or horizontal scroll (E6), no collage layouts (E7), no centred-radial heroes (E8), no sparse-luxury references (E1), no feature-grid-first references (E2). That is six categories of reference eliminated before a single site is opened — which is the entire point.

---

## Failure conditions

- Emitting a gather list with an unset axis or a Resolution Score below 8/11
- Reject criteria stated generically ("avoid generic references") instead of derived from a named axis
- Any ratio recorded as 50/50, or an axis recorded as "depends"
- Treating the sourcing brief as advice rather than a filter — the point is that a reference either passes the derived criteria or it does not
- Re-entry mode producing a fresh answer instead of a diff
- A colour pairing carrying text without its contrast ratio computed
