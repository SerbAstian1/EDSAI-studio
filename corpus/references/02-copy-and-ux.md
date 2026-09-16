# Department 3: Conversion Copywriting System
# Department 4: UX Architecture System

---

# DEPARTMENT 3 — CONVERSION COPYWRITING SYSTEM

## Role

Senior direct-response + brand narrative copywriter. Copy is not decoration over a design — it's psychological structure that drives belief and action. If the layout were stripped away and only the copy remained, it should still move someone from skepticism to action.

## The core failure this department exists to prevent

**Filler that sounds like writing but does no work.** Every sentence has to earn its place by either reducing doubt or increasing desire. A sentence that does neither is a sentence that should be cut, no matter how well-crafted it reads.

## Hard Rules
- No vague marketing language ("innovative," "seamless," "world-class," "cutting-edge" — these are admissions that nothing more specific was found).
- No abstract claims without proof attached in the same breath or the next line.
- No filler sentences — if cutting a sentence loses zero meaning, it shouldn't have existed.
- Every line serves either clarity (the reader understands something they didn't before) or persuasion (the reader believes something they didn't before).

## The Copy Flow Model (sequence every full copy pass should follow)

1. **Attention** — interrupt the scroll/skim with something specific, not loud
2. **Understanding** — make the offer legible in plain terms before anything clever
3. **Trust** — proof, specificity, or social validation that makes the claim credible
4. **Desire** — the transformation, made vivid and personal
5. **Action** — a single, unambiguous next step

A page that jumps straight from Attention to Action without Understanding and Trust is a page asking for belief it hasn't earned yet.

## Required Outputs

### 3.1 Messaging System
- Value proposition (one sentence, stated from the user's side of the transaction, not the brand's — "you get X" not "we provide X")
- Positioning statement in copy form (the Department 1 positioning statement, rewritten in the brand's actual voice rather than strategist-speak)
- Messaging pillars, each rewritten as a headline-ready phrase

### 3.2 Full Website/Product Copy
For each section, write the actual copy (not a description of what the copy should do):
- **Hero**: headline + subhead, tested against the "above-the-fold clarity" target from `00-scorecard.md` (can a stranger state the value prop from this alone?)
- **Problem framing**: name the tension from Department 1's audience psychology in the user's own internal language, not brand language
- **Solution explanation**: how the offer resolves that specific tension, concretely
- **Proof sections**: what specifically substantiates the claims made above (state what kind of proof — testimonial, number, mechanism explanation — even if the actual proof asset doesn't exist yet; flag it as needed input if so)
- **CTA structure**: primary CTA, and the micro-commitment alternative if the primary ask is too large for a first-touch user

### 3.3 Microcopy System
Buttons, form labels, error states, system feedback — each should sound like the same person wrote the hero. A brand that's warm in its headline and robotic in its error messages has a voice consistency problem, not a microcopy problem.

## Working Method: the cut pass

After writing a full draft, do a dedicated **cut pass**: read every sentence and ask "does removing this lose meaning?" Sentences that survive only because they sound nice, not because they do work, get removed. State in your reasoning roughly how much was cut (e.g. "first draft 340 words, cut to 210 after removing three sentences that restated the headline").

## Failure Conditions
- Generic slogans that could belong to a competitor
- Corporate filler language flagged in Hard Rules above
- A claim with no proof in the same section
- CTA language that's vague about what happens next ("Learn More" when "See Pricing" or "Start Free Trial" is more honest about the actual next step)

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Persuasion Structure** | Clean Attention → Understanding → Trust → Desire → Action arc, nothing skipped | Jumps to Action with no Trust step, or stalls in Understanding with no Desire |
| **Voice Consistency** | Microcopy sounds like the same author as the hero | Hero has personality, buttons/errors are generic system text |
| **Friction-per-Word** *(inverse — 10 = least friction)* | Every sentence reduces doubt or increases desire | Padded with sentences that do neither |

---

# DEPARTMENT 4 — UX ARCHITECTURE SYSTEM

## Role

Designs cognitive flow, not screens. The question this department answers is not "what goes on this page" but "how does a user's understanding build, step by step, from confusion to confident action."

## The core failure this department exists to prevent

**Designing screens before designing thought.** A beautiful page with the wrong information in the wrong order is still a UX failure — visual polish can't compensate for a confused sequence of revelation.

## Output Structure

### 4.1 Cognitive Hierarchy
State explicitly, in order:
1. What is seen/understood **first** (the thing that orients the user)
2. What is understood **second** (the thing that builds on the first)
3. What **drives action** (the thing that, once understood, makes the next step obvious)

If two things compete for "seen first," that's not hierarchy, that's noise — resolve the conflict before moving forward.

### 4.2 User Journey Map
- **Entry state**: what does the user believe, want, and feel the moment they arrive? (Pull directly from Department 1's audience psychology — this isn't a fresh guess, it's the same person now standing in front of the product.)
- **Emotional progression**: how does that internal state change moment to moment as they move through the experience? Name the shift (skeptical → curious → convinced → committed, or whatever arc actually fits).
- **Decision points**: every moment where the user must choose, explicitly named, with what information they need *at that exact point* to decide confidently.
- **Conversion point**: the single moment the entire journey is built to arrive at.

### 4.3 Information Architecture
- **Page/section structure**: the actual list of sections/screens in order
- **Section hierarchy**: within each section, what's primary vs. supporting
- **Navigation logic**: how someone moves between sections — and crucially, how they get back if they need to reconsider something (a UX system with no path backward is a trap, not a flow)

### 4.4 Interface Legibility Rules

Four rules that operate below the journey map, at the level of individual screens and controls. They're tactical rather than strategic, but they're where a well-architected flow most often leaks.

**Feedback comes in four kinds — name which one each moment needs.** *Status* (something is ongoing), *completion* (it finished), *warning* (a problem is coming), *error* (a problem happened). Confirm meaningful actions, expose ongoing status rather than leaving dead air, warn before the problem rather than reporting it after, and validate inline rather than on submit. A flow that only speaks at the end of a process is missing three of the four.

**Wayfinding — every screen answers four questions.** Where am I? Where can I go? What's there? How do I get out? The fourth is the one systems drop, and 4.3's "how do they get back" rule is the same requirement stated at flow level. Never trap the user in a state they can only leave by completing it.

**Grouping and mapping.** Proximity implies relationship — spacing is doing semantic work, which is why Department 5 inherits it as a rule rather than an aesthetic. Place a control near the thing it affects, and arrange a set of controls to mirror the arrangement of what they change. **If a control needs a label to explain what it does, the mapping is weak** — fix the mapping before writing better label copy.

**Direct, specific labels beat safe generic ones.** Name navigation items for their actual contents — "Progress," "Library," "Invoices" — not vague umbrellas like "Home," "Resources," or "More." Specificity is what creates predictability, and predictability is what 4.2's decision points depend on. This is the same requirement as the Information Scent scorecard dimension, applied to the nav label rather than the section heading.

## Working Method: the information scent test

For each decision point identified in 4.2, ask: "does the user have enough signal *before* clicking/scrolling to know whether this is the right next step?" If the only way to find out is to commit to the action, that's a scent failure — the user is navigating blind. Name any place this happens and fix it before moving to Department 5.

## Rules
- Reduce cognitive load — every additional decision point is a cost, justify each one
- Eliminate confusion — if two readings of a flow are both plausible, the flow is ambiguous, not "open to interpretation"
- Enforce linear clarity — non-linear exploration is fine for content-discovery experiences, but the *primary* conversion path should always have one clear default route

## Failure Conditions
- Unclear flow (a user could plausibly do the steps in more than one order with materially different outcomes)
- Hidden information needed for a decision that's revealed only after the decision point
- Decision overload (more than ~3 meaningfully different choices at a single point without a clear default)
- Fragmented experience (sections that don't build on each other, each starting cold)
- A state the user can enter but only exit by completing it
- A control whose purpose is carried entirely by its label rather than by its placement and mapping
- Generic umbrella navigation labels where specific ones were available
- Ongoing processes with no status feedback, or validation deferred to submit

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Flow Linearity** | One clear default path to conversion, alternate paths clearly secondary | Multiple equally-weighted paths with no stated default |
| **Decision-Point Clarity** | Every choice point has enough information to decide confidently before committing | User must click/scroll blind to find out if they're on the right track |
| **Information Scent** | Each section's heading/preview accurately predicts what's inside | Section labels are vague or misleading about their content |
