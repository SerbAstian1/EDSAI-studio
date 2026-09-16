# Interaction Physics — Direct Manipulation & Spring Motion

**Conditional module. Shared by Department 6 (intent) and Department 15 (execution).**

This file is not a department. It is a second timing model that Departments 6 and 15 switch into when the interface contains motion the user can physically grab. Read it alongside `04-motion-system.md` and `15-motion-engineering.md`, never instead of them.

---

## When this module activates

Activate when the project contains **any** of the following:

- Drag, swipe, or throw gestures (cards, carousels, reorderable lists, dismissible items)
- Bottom sheets, drawers, or side panels the user can pull
- Sliders, scrubbers, knobs, or any continuously-dragged control
- Pull-to-refresh, swipe-to-delete, swipe-to-navigate
- Pinch, pan, or zoom on any surface
- Any element whose position the user controls with a pointer or finger

If a project has none of these — a marketing site with scroll reveals and hover states — **this module stays closed**, and Department 6's duration/easing model in 6.2 is the correct and complete one. Opening it anyway produces spring specs for animations nobody can touch, which is padding, not rigor.

Gate decision gets stated: *"Interaction Physics: active — bottom sheet + swipeable case-study carousel"* or *"Interaction Physics: not active — no gesture-driven surfaces in this build."*

---

## Why this exists — the two timing models

Department 6.2 specifies motion as **duration + easing**. That model is correct for motion the system initiates and the user watches: scroll reveals, page transitions, hover feedback, ambient loops. The system knows where the motion starts, where it ends, and how long it should take.

It is the wrong model for motion the user drives. A duration-based animation has a fixed start value, a fixed end value, and a fixed length — none of which survive contact with a finger that can change direction halfway through. The moment a user grabs a closing sheet, a duration animation has to either finish first (which reads as the interface ignoring them) or hard-cut to a new animation (which reads as a glitch).

The alternative model is **damping + response**, driven by springs. A spring has no duration; its settle time emerges from its parameters. New input simply changes the target, and the motion stays continuous through the change. That property — interruptibility — is the entire reason this module exists.

**The assignment rule:** *if the user can put a finger on it and move it, it is spring-timed. If they can only watch it, it is duration-timed.* State which model governs each motion event in the 6.2 table.

---

## Part A — Department 6 owns: what the physics should feel like

Department 6 stays library-agnostic here exactly as it does everywhere else. It specifies parameters and behavior; it does not name a library.

### A.1 The response floor

Latency is not a performance concern that Department 8 audits after the fact — it is a *design* value this department specifies, because directness collapses the moment lag appears.

- **Feedback fires on pointer-down, never on release.** A button that highlights on click-up feels dead even when the total time is identical.
- **Feedback is continuous during the gesture, not only at its end.** A drawer that stays still while the finger moves and then animates to a snap point is not a draggable drawer; it is a button with extra steps.
- **Audit the input path for anything that isn't essential** — debounce timers, artificial "processing" delays, transition waits before a state change is reflected.

State the actual budget: **visible response to pointer-down within one frame (≤16ms)**, and name anything in the project that can't meet it plus why.

### A.2 Spring parameters — actual values, not "bouncy"

Two parameters, both stated per motion event:

- **Damping ratio** — controls overshoot. `1.0` is critically damped: reaches the target and stops, no bounce. Below `1.0` overshoots and oscillates; lower is bouncier.
- **Response** — how quickly the value reaches the target, in seconds. Lower is snappier. **This is not duration** — the spring's actual settle time is longer than its response and emerges from the parameters.

**Defaults for this system:**

| Interaction | Damping | Response |
|---|---|---|
| Move / reposition (element repositioning, picture-in-picture) | `1.0` | `0.4` |
| Rotation | `0.8` | `0.4` |
| Drawer / sheet / drag-release | `0.8` | `0.3` |

**Start every spring at damping `1.0`.** Add bounce (damping ~`0.8`) *only when the gesture that preceded it carried momentum* — a flick, a throw, a drag release. Overshoot on a menu that merely faded in reads as decoration; overshoot on a card the user physically threw reads as physics. This is the same restraint discipline as the rest of Department 6, applied to a different parameter.

Bounce applied without a preceding momentum gesture is a **Restraint** scorecard failure, scored as such.

### A.3 Spatial consistency

- **Enter and exit along the same path.** A panel that slides in from the right dismisses to the right. In-from-right, out-the-bottom reads as two unrelated elements.
- **Anchor to the source.** A menu, popover, or sheet originates from the element that triggered it — `transform-origin` set to the trigger, not the element's own center. State the anchor per overlay.
- **Mirror the easing on reversible transitions** so the return path matches the outbound one (inverse control points for the two directions).
- **Hint in the direction of the gesture.** Intermediate frames should telegraph the outcome, not blindly interpolate toward it — an expanding module grows *toward* the finger.

This overlaps Department 6.4's continuity requirement and `composition-frameworks.md` origin-awareness; name the structure as usual.

### A.4 Multimodal feedback — motion, sound, haptics

Where a project ships haptics or audio feedback (native-feeling web apps, PWAs, anything using the Vibration API), three rules govern the combination:

1. **Causality** — it must be obvious what caused the feedback. Fire it on the actual causal event (the toggle flipping, the item snapping home), and match its character to the action's physicality.
2. **Harmony** — visual, audio, and haptic fire on the **same frame**. Latency between the three destroys the illusion more thoroughly than dropping two of them would.
3. **Utility** — reserve it for meaningful moments: commit, snap, success, error. Feedback on everything trains users to ignore all of it.

Absent a stated reason, most web projects answer this section with "none — no haptic or audio layer," and that is a complete answer. Don't invent one.

### A.5 What Department 6 states per gesture-driven motion event

- Which timing model governs it (duration or spring)
- Damping and response values, with the momentum justification for any bounce
- The response floor it must meet
- Enter/exit path and transform origin
- Reduced-motion fallback (Department 15 implements it; this department decides what it should be)

---

## Part B — Department 15 owns: how it becomes code

### B.1 Engine selection addendum

Extends the 15.1 table. The one-line rule still holds — React state drives it → Framer Motion, timeline or scroll drives it → GSAP, neither → CSS — with one addition: **the pointer driving it → a spring engine with velocity carry.**

| Motion need | Engine | Why |
|---|---|---|
| Drag/swipe/throw with 1:1 tracking and momentum release | **Framer Motion** (`drag`, `dragConstraints`, `onDragEnd` velocity) or a dedicated gesture library | Gives pointer capture, velocity, and spring handoff as one unit |
| Bottom sheet / drawer with snap points | **Purpose-built primitive** (Vaul or equivalent) over a hand-rolled implementation | Snap projection, scroll-within-sheet conflict, and focus trapping are each individually easy to get wrong |
| Draggable with inertia inside a GSAP-driven page | **GSAP Draggable + InertiaPlugin** (13.2 + 3.2 KB gzip) | Keeps one engine owning the element; InertiaPlugin does the projection natively |
| Continuous pointer-follow at event rate (custom cursor, magnetic button, tilt) | **GSAP `quickTo()`** | Already the 15.1 rule; restated because it is a gesture case |

**Never use CSS transitions or `@keyframes` for anything gesture-driven.** They cannot be grabbed and reversed mid-flight, which forfeits the one property this module exists to protect. CSS remains correct for discrete hover/press feedback.

One engine per element still applies, and applies harder here — two libraries writing `transform` while a finger is also writing it produces jitter that gets misdiagnosed as a performance problem.

### B.2 Direct manipulation — 1:1 tracking

- Use **Pointer Events with `setPointerCapture`**, so tracking survives the pointer leaving the element's bounds mid-drag.
- **Respect the grab offset.** Snapping the element's center to the pointer on grab breaks the illusion in the first frame. Store `pointerPosition − elementEdge` at `pointerdown` and subtract it throughout.
- **Keep a short position + timestamp history** (the last few `pointermove` events), not just the current point — release velocity is computed from the history, and a single-frame delta is noisy.

```js
el.addEventListener('pointerdown', (e) => {
  el.setPointerCapture(e.pointerId);
  const grabOffset = e.clientY - el.getBoundingClientRect().top;
  // track {y, t} history for velocity at release
});
```

### B.3 Interruption — animate from the presentation value

The single most important rule in this module.

- **Never lock out input during a transition.** A closing modal the user grabs again follows the finger; it does not finish closing and then reopen.
- **Always start a new animation from the element's live on-screen (presentation) value**, read from the current transform — never from the logical target value. Starting from the target is what produces the visible jump on interrupt.
- **On reversal, blend velocity rather than hard-cutting it.** Replacing one animation with another at a direction change creates a velocity discontinuity that reads as a brick wall. Use a spring implementation that re-targets while carrying current velocity.
- **Decompose 2D motion into independent X and Y springs.** One spring on a 2D distance desyncs the axes when their velocities differ.

### B.4 Velocity handoff

When the gesture ends, the animation continues **at the finger's exact release velocity**. This seam — between dragging and animating — is the single detail that most separates fluid from merely fine.

Pass release velocity as the spring's initial velocity. Framer Motion and Motion take absolute px/s directly via the `velocity` option. APIs wanting a normalized value need it divided by the remaining distance:

```
relativeVelocity = gestureVelocity / (targetValue − currentValue)
```

### B.5 Momentum projection — animate to where the gesture is going

Do not snap to the boundary nearest the *release point*. Project the resting position from velocity — the same decay model as native scroll — then snap to the target nearest the *projection*. This is what makes a flick throw an element rather than nudge it.

```js
// decelerationRate ≈ 0.998 for normal scroll feel; 0.99 for snappier
function project(initialVelocity /* px/s */, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

const projectedEndpoint = currentPosition + project(releaseVelocity);
const target = nearestSnapPoint(projectedEndpoint);
animateSpringTo(target, { velocity: releaseVelocity }); // then hand off velocity — B.4
```

Use the exponential-decay form above, not the textbook `v²/(2·decel)`. Also decide **reverse vs. commit by the velocity sign, not by position** — a sheet dragged only 20% down but flicked hard downward should dismiss.

### B.6 Rubber-banding — soft boundaries

At an edge, resist progressively rather than stopping hard. A hard stop reads as frozen; continuous resistance reads as responsive with nothing further to reach.

```js
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
```

### B.7 Gesture recognition details

- **Tap:** highlight on pointer-*down*, commit on pointer-*up*. Allow ~10px of hit padding, and allow cancel-by-dragging-away-and-back.
- **Drag/swipe:** require a small movement threshold (~10px hysteresis) before committing to a direction, then track 1:1.
- **Detect all plausible gestures in parallel from the first move**, then cancel the losers once intent is clear. Avoid recognizers that only report a final state (`swipeleft`-type events) — they discard the continuous tracking that A.1's feedback requirement depends on.
- **Minimize disambiguation delays.** Double-tap detection unavoidably delays every single tap; only pay that cost where double-tap actually exists.
- **Touch targets stay ≥44×44px** per Department 8's checklist — a gesture surface is still a touch target.

### B.8 Frame-level smoothness

Smoothness is about what is *in* the frames, not only the frame rate.

- Keep per-frame positional change below the perception threshold to avoid strobing.
- For very fast motion, subtle motion blur or stretch encodes speed better than a hard sharp streak.
- `requestAnimationFrame` is the display-synced clock. Animate `transform` and `opacity` only — 15.8's rule, and it binds harder here because a dropped frame during a drag is felt directly in the finger.
- `will-change` on the dragged element for the duration of the gesture, removed on release. It is a budget, not a hint.

### B.9 Reduced motion for gesture surfaces

Extends 15.5. Reduced motion does **not** mean removing direct manipulation — a drag that no longer tracks the finger is broken, not accommodated. Under `prefers-reduced-motion: reduce`:

- **Keep** 1:1 tracking, keep pointer-down feedback, keep the snap.
- **Drop** overshoot and bounce (force damping to `1.0`), drop momentum projection (snap to the nearest point from the release position instead), drop rubber-band overscroll, drop parallax and decorative travel.
- State the fallback per gesture, same discipline as 15.5.

---

## Rules

- The timing model (duration vs. spring) is stated per motion event, and gesture-driven events are never duration-timed
- Every spring has stated damping and response values; bounce below `1.0` carries a stated momentum justification
- Feedback fires on pointer-down and continues through the gesture, never only at release
- Every gesture animation is interruptible, starts from the presentation value, and carries velocity through a reversal
- Release velocity is handed off to the animation, and snap targets are chosen from the projected endpoint rather than the release point
- Reduced motion removes overshoot and momentum, never direct manipulation itself

## Failure Conditions

- A gesture-driven surface specified with a duration and an easing curve instead of damping and response
- Bounce applied to motion with no momentum gesture preceding it
- Feedback that appears only on release, or a drag that animates only after the finger lifts
- An animation that must finish before it can be grabbed again, or that jumps visibly on interrupt
- Snap chosen from the release position with the velocity discarded
- Hard stop at a boundary with no progressive resistance
- CSS transitions or `@keyframes` driving anything the user can drag
- Reduced-motion handled by disabling the gesture

## Working Method: the grab test

Start the animation, then grab it mid-flight and reverse it. Then grab it again in the same motion. Then flick it hard from 20% of the way across and check whether it commits. Then drag it past its boundary and hold.

Four questions: did the element jump when grabbed, did the reversal hit a brick wall, did the flick commit on velocity or refuse on position, and did the boundary resist or freeze? Any "yes" to the first two or "no" to the last two is a defect, not a tuning preference.

## Scorecard

These dimensions are added to Department 6's and Department 15's existing scorecards when this module is active — they do not replace them, and they are scored only for the gesture-driven events.

| Dimension | Dept | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|---|
| **Directness** | 6 | Feedback within one frame of pointer-down, 1:1 tracking with grab offset respected throughout | Feedback on release; element snaps to pointer center on grab |
| **Interruptibility** | 15 | Every gesture animation grabbable and reversible at any frame, starting from the presentation value, velocity carried through reversal | Animations must complete before re-input; visible jump on interrupt |
| **Momentum Fidelity** | 15 | Release velocity handed off; snap target chosen from projection; boundaries rubber-band | Velocity discarded at release; nearest-from-release snapping; hard stops |

## Real Measurable Targets to report

- Damping and response values per gesture-driven motion event, with the momentum justification for any value below `1.0`
- Measured or budgeted time from pointer-down to first visible feedback, against the ≤16ms floor
- Deceleration rate used for momentum projection (default `0.998`), and the resulting projected-endpoint behavior per snap surface
- Confirmation that every gesture animation reads the presentation value on interrupt
- Named owning engine per draggable element (one only)
- Reduced-motion fallback stated per gesture, confirming tracking is preserved
- Touch-target dimensions for every gesture surface, against the 44×44px minimum

---

## Source and attribution

Distilled from Apple's WWDC design talks — chiefly *Designing Fluid Interfaces* (2018), *The Details of UI Typography* (2020), and *Designing Audio-Haptic Experiences* — as translated to the web platform in the `apple-design` skill by Emil Kowalski (MIT licensed, `github.com/emilkowalski/skills`). The typography material from that source lives in Department 5's `03-ui-design-system.md`, the materials and depth material in 5.5, and the four tactical interface rules in Department 4.
