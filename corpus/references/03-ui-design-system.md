# Department 5: Interface Design System

## Role

Senior UI systems designer. Translates UX architecture into a visual system precise enough that another designer could extend it without guessing.

## The core failure this department exists to prevent

**Decoration without function.** Every visual choice — type size, color, spacing — has to be doing structural work (establishing hierarchy, grouping related content, signaling interactivity) or it's noise, regardless of how good it looks in isolation.

## Output Systems — each with real, stated numbers

### 5.1 Typography System

Don't describe a typography system in adjectives ("clean, modern hierarchy") — state the actual scale:

- **Type scale ratio**: name the actual ratio used (e.g. 1.25 Major Third for a tighter, more corporate feel; 1.333 Perfect Fourth for more dramatic contrast; 1.5 Perfect Fifth for maximal/editorial). State why this ratio fits the energy level from Department 2.
- **Full scale, stated in actual values**: base size (typically 16–18px for body) and each step up/down (e.g. 16 / 20 / 25 / 31 / 39 / 49px at a 1.25 ratio).
- **Font pairing logic**: the structural role each typeface plays (display/headline, body, accent) and *why* this pairing — contrast in x-height, contrast in era/character, or deliberate tension, not just "they look nice together."
- **Line-height values**: stated per size tier (tighter for display sizes, ~1.5–1.6 for body text). Leading tracks size *inversely* — the relationship is not decorative, it's what keeps a 49px headline from reading as loose and a 16px paragraph from reading as cramped. Loosen it for scripts with tall ascenders/descenders; tighten it for dense information UI.
- **Tracking (letter-spacing), stated per size tier — never one value for the whole system.** This is the most commonly skipped item in this section and the one that most separates a real type system from a scale with a font applied. Optical spacing is size-dependent: large display text reads too loose as it grows and wants *negative* tracking (around `-0.02em` at display sizes, more at very large sizes); small text wants slightly *positive* tracking for legibility; body copy sits near `0`. A single fixed `letter-spacing` across the scale is wrong somewhere by definition. State the actual value per tier alongside the size and line-height.
- **Optical sizing and Dynamic Type**: enable `font-optical-sizing: auto` on variable faces that carry it. Respect the user's OS text-size setting — express spacing in `rem`/`em` rather than fixed px so a larger base size scales the layout with it instead of breaking it. If a system font is a viable choice, it arrives with optical sizing, tracking tables, and legibility tuning already done; overriding that is a decision that owes a reason, not a default.
- **Line length target**: 45–75 characters per line for body copy — state the actual measure chosen and why.
- **Readability rule**: minimum body text size (never below 16px for primary reading content on web).

### 5.2 Grid & Spacing System

- **Spacing scale**: state the actual scale (commonly a base-8 system: 4/8/12/16/24/32/48/64/96px, or a base-4 for tighter density). Name which was chosen and why it fits the density implied by Department 2's visual rhythm.
- **Grid structure**: column count at each major breakpoint, gutter width, margin width — actual numbers, not "responsive grid."
- **Alignment rules**: what aligns to what (e.g. "all section content aligns to a 12-column grid with 24px gutters; hero copy may break the grid intentionally for emphasis, nothing else does").
- **Named compositional structure** (hero sections, landing layouts, any single-view composition): name the structure from `references/composition-frameworks.md` actually in play — a plain column grid, a Rule-of-Thirds-anchored hero, a Golden Section-informed split, an Asymmetric/L-Arrangement balance — rather than only stating column counts. Column counts describe the grid; naming the structure describes what the grid is doing to the eye.

### 5.3 Color System

- **Primary/secondary/accent roles**: not just hex values — state the *job* each color does (primary = brand recognition and key actions, secondary = supporting UI, accent = the one color reserved for the highest-priority interactive moment).
- **Contrast rules, stated as actual ratios**: every text/background pairing that will actually be used should have its contrast ratio calculated and stated against the WCAG AA minimum (4.5:1 for normal text, 3:1 for large text/UI components). If a pairing doesn't hit the minimum, say so and either fix it or flag it as an accepted exception with reasoning (rare, and should be rare).
- **Emotional usage**: how color reinforces (or deliberately withholds, for restraint) the emotional tone from Department 2.

### 5.4 Component System

For each core component (buttons, cards, navigation, forms, inputs):
- States required: default, hover, active, focus, disabled, error (don't skip focus and error — these are the states most generic systems forget, and they're the ones accessibility and trust depend on)
- Sizing and spacing values, not just "padded appropriately"
- The one rule that makes this component *this brand's* version of the component, not a default UI-kit instance

### 5.5 Material & Depth System

Only required where the interface uses translucency, blur, or layered surfaces (floating navigation, sheets, overlay panels, glass chrome). If it doesn't, state "no material layer — all surfaces opaque" and move on; inventing one to fill this section is exactly the decoration-without-function failure this department exists to prevent.

Where a material layer does exist, translucency is doing **hierarchical** work, not aesthetic work — it lets a functional layer float above content without stealing focus from it.

- **Material weight encodes hierarchy.** Darker/heavier materials separate structural regions (sidebars, chrome); lighter materials draw attention to interactive elements. State which weight each surface uses and what structural job it's doing.
- **Never stack a light translucent surface on another light translucent surface** — legibility collapses and no amount of tuning recovers it.
- **Bigger surfaces read as thicker**: stronger blur radius and a deeper shadow than small chips. State the actual blur radius and background alpha per surface, not "frosted."
- **Dim to focus, separate to keep flow.** A modal, blocking task pairs its surface with a dimming scrim and pushes the background back. A parallel, non-blocking panel uses translucency and offset *without* a scrim, so the underlying flow isn't broken. For stacked sheets, progressively dim and push back each parent layer.
- **Vibrancy keeps text legible over changing backgrounds.** Flat mid-gray text over a translucent surface fails against a busy backdrop. Use higher contrast, slightly heavier weight, and a small positive tracking bump. Put saturated color on a solid layer, never on the translucent foreground.
- **Scroll edge effects instead of hard dividers.** Where content meets floating chrome, fade a small blur/gradient mask rather than drawing a 1px border — and only where floating UI actually overlaps content.
- **Materialize, don't fade.** On enter/exit, animate blur radius and scale together so the surface reads as a material arriving, not an opacity ramp. Hand the actual values to Department 6.

```css
.toolbar {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.4); /* bright edge = light catching the material */
}
```

**Contrast rules from 5.3 still apply, measured against the worst-case backdrop** — not against the material's own average. A ratio that passes over a white background and fails over a photograph is a failing ratio. Department 15.5 owns the `prefers-reduced-transparency` and `prefers-contrast` fallbacks for every surface specified here; name the solid fallback for each one.

## Working Method: the swap test

Take any single component or type choice and ask: "if I swapped this into a generic SaaS template, would it look out of place, or would it blend right in?" If it would blend in, it's not yet a *system* — it's a default with the brand's colors painted over it.

## Rules
- Hierarchy must be obvious without relying on color alone (size/weight/spacing should carry hierarchy; color reinforces, doesn't carry it solo — this is also an accessibility requirement, not just a design preference)
- Spacing must create grouping (related elements closer together than unrelated ones — proximity is doing semantic work, not just aesthetic work)
- Consistency is mandatory — a one-off exception needs a stated reason, not silent inconsistency
- No decorative clutter — if an element doesn't aid hierarchy, grouping, or brand expression, cut it

## Failure Conditions
- Inconsistent UI (same semantic element styled differently in different places with no stated reason)
- Weak hierarchy (more than one element competing for primary visual weight in the same view)
- Aesthetic without function (a visual flourish that doesn't reinforce structure or brand)
- A single `letter-spacing` value applied across the whole type scale, or tracking omitted from the scale entirely
- Translucent surfaces stacked on translucent surfaces, or a material layer with no stated solid fallback
- Any stated color pairing that fails WCAG AA contrast without an explicitly accepted, reasoned exception

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Hierarchy Legibility** | Squint test passes — primary action/content is obvious even blurred | Multiple elements compete for primary visual weight |
| **System Consistency** | Every instance of a component matches its defined states/spacing | Ad hoc variations with no documented reason |
| **Token Discipline** | All values trace to the stated type/spacing/color scales — no orphan magic numbers | Sizes and spacing invented per-instance, no underlying scale |
| **Optical Precision** | Tracking and leading stated per size tier and moving inversely with size; material weights and blur radii carry stated hierarchical jobs | One tracking value for the whole scale; translucency applied because it looks current |

## Real Measurable Targets to report (see `00-scorecard.md` Section 4 for full framework)

State actual numbers for:
- Every text/background contrast ratio used, vs. 4.5:1 (normal text) / 3:1 (large text, UI components) AA minimums
- Type scale ratio and full computed scale
- Spacing scale base unit
- Body line-length in characters (target 45–75)
- Tracking (em) and line-height per size tier, across the full scale
- Where a material layer exists: blur radius, background alpha, and shadow depth per surface, plus the worst-case-backdrop contrast ratio and the stated solid fallback for `prefers-reduced-transparency` / `prefers-contrast`
