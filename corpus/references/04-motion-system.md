# Department 6: Motion & Cinematic System

## Role

Digital cinematographer. Motion is storytelling, not decoration — every animation either reveals meaning, provides feedback, or guides attention. If it does none of those three things, it shouldn't exist regardless of how smooth it looks in isolation.

## The core failure this department exists to prevent

**Gimmick animation that exists because it's possible, not because it's needed.** The Awwwards/FWA reference point is double-edged: it's the right quality bar for craft, but the wrong reference if it leads to "this would be cool" as the design rationale. Cool is not a reason. Purpose is a reason.

## Handoff to Department 15 (Motion Engineering)

This department stays **library-agnostic on purpose**. Decide what moves, why, and at exactly what timing — then hand that to `references/15-motion-engineering.md`, which assigns an engine (GSAP or Framer Motion), the plugin set and its measured bundle cost, the scoping/cleanup pattern, and the concrete `prefers-reduced-motion` implementation.

The reason for the split: once an engine is in the room, motion decisions start drifting toward whatever that engine makes easy. Specify the motion first, then engineer it. If Department 15 comes back and says a stated value isn't achievable within budget, that's a renegotiation with a reason — revise the value here rather than letting the code quietly disagree with this table.

## Output System — with real, stated values

### 6.1 Motion Philosophy
One governing sentence (this should usually already exist from Department 2's "motion language" output — restate and operationalize it here). E.g. "motion reveals hierarchy as the user earns it through scroll, it never announces itself before content does."

### 6.2 Timing System — actual values, not "smooth" or "snappy"
State specific durations and easing curves by interaction category:

| Interaction type | Typical duration | Typical easing |
|---|---|---|
| Micro-feedback (hover, button press) | 100–150ms | ease-out |
| UI transitions (modal open, menu reveal) | 200–300ms | cubic-bezier(0.16, 1, 0.3, 1) or similar "ease-out-expo" feel |
| Content reveal (scroll-triggered fade/slide-in) | 400–600ms | ease-out, slight delay/stagger if multiple elements |
| Page/section transitions | 500–800ms | ease-in-out |
| Ambient/looping motion (background elements) | 3000ms+ | linear or ease-in-out, very low amplitude |

These are starting ranges, not rules — state the actual values chosen for this project and why they fit the energy level from Department 2 (a restrained luxury brand should sit at the slower end of every range; a high-energy youth brand can sit faster, but "faster" still means stated milliseconds, not a vibe).

### 6.2b Which timing model applies — duration or spring

The table above is the **duration model**, and it is correct for motion the system initiates and the user watches: scroll reveals, page and section transitions, hover and press feedback, ambient loops.

It is the wrong model for motion the user physically drives. A duration animation has a fixed start, a fixed end, and a fixed length, none of which survive a finger that changes direction halfway through. Anything draggable, swipeable, or pullable is specified instead as **damping + response** — a spring, which has no duration and can be grabbed and redirected at any frame.

**The rule:** *if the user can put a finger on it and move it, it is spring-timed. If they can only watch it, it is duration-timed.* State the model per motion event in the 6.2 table, not just the values.

If any motion event in this project is spring-timed, **open `references/interaction-physics.md`** — it holds the damping/response defaults, the response floor, spatial-consistency rules, and the multimodal feedback rules, and it carries the matching implementation half over to Department 15. If nothing here is gesture-driven, state that the module is not active and stay entirely in the duration model above; specifying springs for animations nobody can touch is padding, not depth.

### 6.3 Scroll Behavior
- Is scroll hijacked/smoothed (e.g. Lenis) or native? State which and why — smoothing adds cinematic control but costs some native-feel responsiveness and accessibility (always provide a reduced-motion fallback, see below).
- What triggers on scroll: reveal animations, parallax, scroll-scrubbed video/3D — name each trigger and the specific element it acts on.
- Scroll-triggered elements should reveal *once* by default, not re-trigger on every scroll-up/down unless that repetition is itself the intended effect (state explicitly if so).

### 6.4 Transitions
Between states/pages/sections: what persists (continuity elements that carry across the cut) vs. what's a hard cut. Continuity is what makes transitions feel directed rather than just "the next thing loaded."

### 6.5 Interaction Feedback
Every interactive element needs a stated motion response to hover/press/focus — absence of feedback reads as broken, not minimal.

**Feedback fires on pointer-down, not on release.** An element that only responds once the press completes feels dead even when total elapsed time is identical — the perceived latency is what's being designed here, not the actual duration. Where an interaction is continuous (a drag, a slider, a pull), feedback runs 1:1 *through* the gesture rather than arriving at its end.

If the project ships haptic or audio feedback alongside motion, the causality/harmony/utility rules in `references/interaction-physics.md` A.4 govern the combination. Most web projects correctly answer this with "no haptic or audio layer" — state that rather than inventing one.

## Rules
- Motion must reduce friction (e.g. a smooth state transition that helps the user track what changed) or increase emotional clarity (e.g. a reveal that paces information so it lands, rather than dumping everything at once) — pick which one each motion choice is doing
- No unnecessary animation — if removing a specific animation loses zero clarity and zero emotional effect, cut it
- Cinematic pacing required — variation in timing across a sequence (not everything at the same duration/easing) is what reads as directed rather than automated
- **Always implement `prefers-reduced-motion`**: state explicitly what the reduced-motion fallback is (typically: instant state changes, no parallax/scroll-scrub, essential feedback only). This is not optional — it's both an accessibility requirement and frequently a legal one depending on jurisdiction.

## Failure Conditions
- Gimmick animations (motion whose only justification is "it's possible" or "it's cool")
- Excessive motion (more than one major motion event competing for attention at once)
- Inconsistent timing (durations/easings that don't follow a stated system, invented per-instance)
- No reduced-motion fallback stated
- A gesture-driven surface specified with a duration and an easing curve instead of damping and response (see 6.2b)
- Feedback specified on release rather than on pointer-down

## Working Method: the mute test
Describe what the experience communicates with all animation removed, reduced to instant state changes. If the answer is "nothing changes, it's all still clear" — motion was decoration and the budget should be spent elsewhere. If the answer is "the page becomes confusing or flat" — motion was carrying real weight, which is the goal.

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Narrative Purpose** | Every motion event reveals, guides, or gives feedback — passes the mute test | Motion exists with no clear loss if removed |
| **Timing Discipline** | Durations/easings follow a stated system with intentional variation | Arbitrary per-instance values, inconsistent feel |
| **Restraint** | One motion event at a time competes for attention; overshoot appears only after a momentum gesture | Multiple simultaneous animations fighting for focus; bounce applied decoratively |

## Real Measurable Targets to report
- Actual duration (ms) and easing function for each major interaction category
- Stated timing model (duration or spring) per motion event, plus the Interaction Physics gate decision — active with the gesture surfaces named, or not active with a stated reason
- For any spring-timed event: damping and response values, per `references/interaction-physics.md` A.2
- Confirmation that `prefers-reduced-motion` is implemented, and what the fallback behavior is
- If scroll-smoothing library used, note any known accessibility tradeoffs and the mitigation
