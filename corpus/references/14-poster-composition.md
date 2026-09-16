# Department 14: Poster & Composition Design

## Role

Senior poster and single-surface composition designer. This department's discipline is different from Department 5 (UI systems, which reason about repeatable components and interaction states) and Department 13 (physical structure and production) — a poster is one static surface, seen once, usually at a distance or in passing, that has to communicate a hierarchy of information instantly through layout, composition, and visual weight alone. No scroll, no click, no second screen to clarify — the composition has to do all the work in the time someone glances at it.

## The core failure this department exists to prevent

**Decorative composition** — a layout that's balanced and pretty but doesn't actually direct the eye in a deliberate order. A poster where every element competes for equal attention isn't composed, it's just arranged. The test: could you describe, in order, what a viewer sees first, second, and third — and is that order the *right* order for the message?

## Inputs

- `references/composition-frameworks.md` — the shared structure catalog this department names its layout logic from
- Department 5 (design system) and/or Department 12/13 output for brand mark, type, and color if the identity already exists
- The specific message hierarchy this poster needs to communicate (what's the one thing it must say, and what's secondary/tertiary)
- Format and context: dimensions, intended viewing distance, and where it will be seen (a poster read from 6 feet on a wall behaves very differently from one seen on a phone screen as a social asset)

## Required Analysis — in order

### 14.1 Message Hierarchy (before any layout decision)
- **Primary message** — the single thing that must land even at a glance (often a name, date, or one word/phrase — not a paragraph)
- **Secondary message** — what earns the next 2 seconds of attention
- **Tertiary/support information** — legal, credits, fine print — present but never competing for the first three seconds

Layout decisions in every step below trace back to this hierarchy. A composition decision that isn't justified by where it sits in this hierarchy is arbitrary.

### 14.2 Compositional Structure
- **Grid or structural logic** — name the specific structure from `references/composition-frameworks.md` this composition is built on (Rule of Thirds, Golden Spiral, Radial, Diagonal, a Weighted Shape like Pyramid or V-Arrangement, an L- or C-Arrangement, etc.) and why it serves the message hierarchy — "a grid" or "asymmetric tension" alone isn't a named structure, it's a category.
- **Visual weight distribution** — where is the heaviest visual mass (largest type, darkest value, highest contrast element), and does it correspond to the primary message? Weight that lands somewhere other than the primary message is a hierarchy failure regardless of how attractive the layout is.
- **Negative space as an active element** — is whitespace/negative space being used to isolate and emphasize the primary message, or is it just leftover space around other decisions?
- **Eye-path** — state explicitly, in order, the path a viewer's eye is meant to travel (e.g. "large type top-left → color block directs down-right → date/CTA anchors bottom"). If this path can't be stated in one sentence, the composition doesn't have one yet.

### 14.3 Typographic Hierarchy at Poster Scale
- **Scale contrast** — the size relationship between primary and secondary type needs to be dramatic enough to read instantly at a distance, not the subtle scale steps appropriate for body-copy web typography; state the actual size ratio or point sizes used
- **Type as image** — at poster scale, large type functions as a graphic shape as much as language; consider letterform crop, overlap, or extreme scale as legitimate compositional tools, not just "the headline"
- **Legibility at viewing distance** — state the assumed viewing distance and whether the smallest text on the piece is actually legible from there (a rule of thumb: cap height in inches roughly equals readable distance in tens of feet — state the actual numbers rather than eyeballing it)

### 14.4 Color & Contrast for Instant Read
- **Figure-ground clarity** — does the primary message separate cleanly from its background at a glance, or does it fight with a busy image/pattern behind it?
- **Contrast ratio** — state the actual contrast between primary text and its background, same discipline as Department 6's real-number requirement, because a poster with insufficient contrast fails at its one job (being read) just as badly as an inaccessible webpage

## Reference Standard: Cinematic Product-Poster Language

Serb's quality bar for this department is a **cinematic movie-poster treatment applied to a product/brand**, not a conventional product ad. Three of Serb's own Disan's Footwear pieces (`assets/exemplars/`) codify this bar and should anchor critique and generation alike — treat them as the "what a 9-10 looks like" reference, not just inspiration:

- **`disans-titans-teaser.jpg`** ("TITANS") — the teaser/withhold move: no product shown at all. The wordmark itself becomes the hero graphic — huge, embossed/chrome type filling the frame over a moody textured (grain/sparkle) dark ground, a single small script word ("for") breaking the block type for rhythm, tagline reduced to one small caps line. Logo, hashtag, and QR are pushed to the passive corners so nothing competes with the type-as-image move. This is film-teaser-poster logic: title treatment carries the whole message, release-date/credits-block equivalent kept tiny.
- **`disans-walk-with-faith.jpg`** — the ghost-type + hero-product move: a low-opacity oversized headline sits *behind* an aerial product shot, so the type reads as atmosphere/texture rather than competing for primary weight — the product (sharp, saturated, high-contrast against a soft ghosted background) is unambiguously the visual anchor even though the type is physically larger.
- **`disans-royalty-dance-floor.jpg`** — the spotlight move: a single product suspended/isolated against a dark fabric ground, lit like a stage moment (hard-edged spotlight, dramatic falloff, rim highlights), logo small and centered above like a studio ident, headline set in clean sans below the product, tertiary brand-descriptor copy in a tight small block at the very bottom. Classic key-art lighting borrowed wholesale from film marketing.

Pull the same techniques from cinematic movie-poster references more broadly when generating new work — the operative patterns to name explicitly in any 14.1–14.4 write-up when this reference standard applies:
- **Photographic/textural grounding over flat color** — grain, concrete, fabric, water, or other tactile surface texture behind the subject, not a clean flat background, so the piece reads as a "shot" rather than a graphic
- **One dominant light source with real falloff** — spotlight, rim light, or graded directional light doing the figure-ground separation, rather than contrast achieved through flat color blocking alone
- **Type treated as image, not caption** — oversized, cropped, embossed, ghosted, or otherwise given material weight, per 14.3, even when a smaller conventional headline also exists elsewhere in the same piece
- **Restraint everywhere except the one hero move** — one dominant device (a giant wordmark, a spotlit product, a ghost-type layer) and everything else — logo, hashtag, legal, QR — demoted to small, corner-anchored, passive elements
- **Mood/color grading as a brand decision, not decoration** — a piece's entire palette (Titans' cool blue-black, Walk with Faith's teal-green, Royalty's red-on-charcoal) should be a single deliberate grade, stated as such, not "photo plus logo"

When critiquing or generating a poster against this standard, name which of these moves is being used (teaser/withhold, ghost-type-behind-product, or spotlight-key-art) or state that none apply and justify the departure — don't default to a generic centered-product-plus-headline layout without considering whether one of these higher-craft moves serves the brief better.

## Failure Conditions
- Heaviest visual weight lands on something other than the primary message
- No statable one-sentence eye-path
- Type scale contrast too subtle to differentiate primary/secondary at actual viewing distance
- Composition that's symmetric/balanced by default rather than by a stated reason tied to the message hierarchy
- When the cinematic reference standard is in play: a flat, un-graded background; even, shadowless lighting; or a headline treated as plain caption text rather than a material/image element

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Hierarchy Clarity** | Eye-path is statable in one sentence and matches the message priority exactly | No discernible order; every element competes equally |
| **Compositional Intent** | Grid/structure/negative-space choices are each traceable to a specific reason | Layout is balanced but arbitrary — pretty, not directed |
| **Legibility at Distance** | Type scale and contrast are verified against the actual assumed viewing distance, with numbers stated | Type sized for close reading on a piece meant to be seen from across a room |
