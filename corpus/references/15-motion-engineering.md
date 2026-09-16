# Department 15: Motion Engineering

## Role

Motion engineer. Department 6 decides *what moves, why, and at what timing*. This department decides *how that becomes code that survives production* — which engine drives each motion event, which plugins get installed, how animations are scoped and torn down, what the whole motion layer costs in kilobytes, and how it degrades for a user who asked the operating system for less motion.

This is the bridge department. Without it, Department 6's timing table is a nice document that an engineer reinterprets from scratch, and Department 7 inherits animation decisions it never made.

## Scope boundary with Departments 6 and 7

- **Department 6 owns intent** — motion philosophy, narrative purpose, the actual durations and easings, the mute test. It stays deliberately library-agnostic. Implementation convenience never gets to decide the design.
- **This department owns execution** — engine selection, plugin set, lifecycle, reduced-motion implementation, motion payload cost.
- **Department 7 owns the architecture that hosts it** — the motion layer lives inside `src/` (typically `src/animations/` for timelines and `src/hooks/` for the React bindings), following Department 7's folder discipline like any other module.

If an implementation constraint would change a Department 6 timing value, that is a **renegotiation with a stated reason** — name the constraint, propose the revised value, get it reflected back in the 6.2 table. Silently shipping 300ms where the motion system specified 500ms is how a design system quietly stops being true.

## The core failure this department exists to prevent

**Animation code that works in the demo and leaks in the app.** The demo is one page, mounted once, at one viewport, with fonts already cached. Production is none of those things. The recurring failures are always the same four: timelines that are never killed on unmount, ScrollTriggers measured against a layout that shifted the moment webfonts swapped in, split text that reads to a screen reader as a pile of disconnected letters, and 60KB of animation library shipped to render three fades.

Every rule below exists because of one of those four.

---

## Output System — with real, stated values

### 15.1 The Selection Rule — GSAP or Framer Motion

Both are in the default stack. They are **not interchangeable**, and "which one do we prefer" is not the decision procedure. Choose per motion event, and state the choice:

| Motion need | Engine | Why |
|---|---|---|
| Component enter/exit tied to React state (modal, drawer, toast, route transition) | **Framer Motion** | `AnimatePresence` holds the component mounted through its exit animation — GSAP can't, because React has already unmounted the node |
| Shared-element / layout transitions between React states | **Framer Motion** (`layout`, `layoutId`) | Measures and interpolates layout changes React just caused; reimplementing this in GSAP means hand-rolling FLIP against React's render cycle |
| Anything driven by scroll — reveal, scrub, pin, parallax | **GSAP + ScrollTrigger** | Precise start/end resolution, pinning, and refresh handling that scroll-linked React hooks don't match |
| Multi-step choreography with precise relative offsets | **GSAP timeline** | Position parameters (`"<"`, `"-=0.2"`, labels) express sequencing directly; the same thing in Framer Motion becomes nested delay arithmetic that breaks when one duration changes |
| SVG path drawing, shape morphing, motion along a path | **GSAP** (DrawSVG / MorphSVG / MotionPath) | No Framer Motion equivalent |
| Text animated by character, word, or line | **GSAP SplitText** | Handles the splitting, the re-splitting on reflow, and the ARIA restoration (see 15.7) |
| High-frequency pointer following (custom cursor, tilt, magnetic button) | **GSAP `quickTo()`** | Pre-compiled setter, no per-frame tween allocation at pointer-event rate |
| Reordering elements outside React's reconciliation | **GSAP Flip** | Records state before, animates the delta after |
| Simple hover/press feedback on a single component | **CSS transition** | If a 120ms hover state needs a JS animation library, that's the wrong tool — reserve both engines for motion that earns them |

| Drag / swipe / throw with 1:1 tracking and momentum release | **Framer Motion** (`drag`, `dragConstraints`, `onDragEnd` velocity), **GSAP Draggable + InertiaPlugin**, or a purpose-built primitive | Pointer capture, release velocity, and spring handoff need to be one unit; see `references/interaction-physics.md` B.1 for the full selection addendum |
| Bottom sheet / drawer with snap points | **Purpose-built primitive** (Vaul or equivalent) over hand-rolling | Snap projection, scroll-inside-sheet conflict, and focus trapping are each individually easy to get wrong |

**The one-line rule:** *React state drives it → Framer Motion. The timeline or the scroll position drives it → GSAP. The pointer drives it → a spring engine that carries velocity. Neither drives it → CSS.*

**CSS transitions and `@keyframes` are disqualified for anything gesture-driven** — they cannot be grabbed and reversed mid-flight. They remain correct for discrete hover and press feedback. Where Department 6 marked a motion event spring-timed under 6.2b, read `references/interaction-physics.md` Part B before assigning an engine; that file owns pointer capture, interruption, velocity handoff, momentum projection, and rubber-banding, and this department's rules apply on top of it rather than instead of it.

Both engines on one **page** is expected and fine — that's what the rule is for. Both engines on one **element** is a defect: two libraries writing the same `transform` will fight, last-write-wins per frame, and produce jitter that reads as a browser bug and gets debugged for hours. **Name the owning engine per animated element.**

If a project only needs one engine, say so and drop the other. This rule is a decision procedure, not a mandate to install both.

### 15.2 Motion Payload Budget — actual measured numbers

GSAP 3.15 ships free under GreenSock's standard no-charge license, **including every plugin** that used to be Club-only. Availability is no longer the constraint; bundle size is. Install with `npm i gsap` (plus `@gsap/react` for the hook), or CDN via jsDelivr for non-bundled builds.

Measured gzipped cost of the minified UMD builds:

| Module | gzip |
|---|---|
| `gsap` core (includes CSSPlugin) | 27.6 KB |
| ScrollTrigger | 17.6 KB |
| Draggable | 13.2 KB |
| Flip | 9.5 KB |
| MotionPathPlugin | 9.5 KB |
| MorphSVGPlugin | 9.3 KB |
| ScrollSmoother | 5.4 KB |
| Observer | 4.2 KB |
| SplitText | 3.6 KB |
| CustomEase | 3.6 KB |
| TextPlugin | 3.5 KB |
| InertiaPlugin | 3.2 KB |
| DrawSVGPlugin | 2.2 KB |
| ScrollToPlugin | 1.9 KB |

State the **actual chosen plugin set and its summed gzip total**, and report it against the 170KB JS budget in `00-scorecard.md` — motion is usually the single largest discretionary line item in that budget, so it gets named rather than absorbed.

Framer Motion's cost depends entirely on import strategy: importing `motion` directly pulls the full feature set, while `LazyMotion` with the `m` component and a deferred feature bundle cuts it substantially. Don't quote a number from memory — measure the project's actual bundle and report that.

Import individual plugins, never the `all` barrel file. `import { gsap } from "gsap"` and `import { ScrollTrigger } from "gsap/ScrollTrigger"` tree-shake; `gsap/all` does not.

### 15.3 Registration and Scoping

Plugins must be registered before use, once, in a single entry module — scattered `registerPlugin` calls across components are how a plugin ends up missing in a lazily-loaded route:

```js
gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
```

In React, animations go through `useGSAP()` from `@gsap/react`. It wraps `gsap.context()`, so every animation, ScrollTrigger, and callback created inside is recorded and **reverted automatically on unmount**:

```js
const container = useRef(null);

useGSAP(() => {
  gsap.from(".card", { y: 40, opacity: 0, duration: 0.6, stagger: 0.08, ease: "power3.out" });
}, { scope: container, dependencies: [items] });
```

Two things the `scope` does that matter: selector strings resolve **inside the container only**, so `.card` can't reach into a sibling component's DOM, and cleanup is bounded to this subtree. Outside React, the equivalent is an explicit `gsap.context()` with `ctx.revert()` in the teardown path.

State in the output which pattern the project uses and where the registration module lives.

### 15.4 ScrollTrigger Discipline

- **State `start` and `end` explicitly** for every trigger. Defaults are a guess about where a reveal should fire; a stated `"top 80%"` is a decision.
- **`once: true` by default**, matching Department 6.3's reveal-once rule. Re-triggering on every scroll direction change is an explicit choice that gets justified, not the default.
- **`scrub` takes a number, not `true`** — the number is seconds of catch-up (0.5–1.5 is the usual usable range). Boolean `scrub` binds the playhead rigidly to scroll and reads mechanical.
- **Refresh after anything that changes layout** — webfont swap, images without reserved dimensions, accordion open. A trigger measured before the font loads is measured against the wrong page. Add `invalidateOnRefresh: true` for any value computed at creation time.
- **Pinning is expensive and layout-invasive.** State whether `pinSpacing` is on, and use `anticipatePin` for elements pinned right after a fast scroll.
- **`markers: true` is a development tool.** Gate it behind an env check so it can never reach production.
- **Use `ScrollTrigger.batch()` for many similar elements** (a card grid, a list) instead of creating one trigger per element — N triggers means N scroll calculations per frame.
- Don't nest an independent ScrollTrigger inside a timeline that is itself being scrubbed; nested playheads fight and the result is undebuggable.

### 15.5 Reduced Motion — `gsap.matchMedia()`

This is the concrete implementation of Department 6's non-negotiable `prefers-reduced-motion` requirement. `gsap.matchMedia()` is the right mechanism rather than a CSS override, because it **reverts everything created in a context when the query stops matching** — including ScrollTriggers, which a CSS rule cannot touch:

```js
let mm = gsap.matchMedia();

mm.add("(prefers-reduced-motion: no-preference)", () => {
  gsap.to(".hero", { y: -120, scrollTrigger: { trigger: ".hero", scrub: 1 } });
});

mm.add("(prefers-reduced-motion: reduce)", () => {
  gsap.set(".hero", { opacity: 1, y: 0 });
});
```

Reduced motion means **less motion, not no feedback**. Keep opacity changes and state transitions — a user who can't tell whether a button registered their click is worse off, not accommodated. Drop travel distance, parallax, scrub, pin, autoplaying loops, and anything that moves without user input. State the specific fallback per motion event, which is what Department 6.4 asks for anyway.

**For gesture-driven surfaces this is stricter, not looser.** Never disable direct manipulation under reduced motion — a drag that stops tracking the finger is broken, not accommodated. Force damping to `1.0`, drop momentum projection (snap from the release position instead of the projected endpoint), and drop rubber-band overscroll — but keep 1:1 tracking, pointer-down feedback, and the snap itself. Full rule in `references/interaction-physics.md` B.9.

**Two further media queries this system treats as non-optional**, both routinely missed:

```css
@media (prefers-reduced-transparency: reduce) {
  .toolbar { background: var(--surface-solid); backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  .toolbar { background: var(--surface-solid); border: 1px solid var(--border-strong); }
}
```

`prefers-reduced-transparency: reduce` makes every translucent surface from Department 5.5 frostier or solid — raise background opacity, drop the blur. `prefers-contrast: more` moves to near-solid backgrounds with a defined contrasting border. Any project that ships a material layer owes both, and Department 8's checklist now audits them.

Also avoid: full-viewport moving backgrounds, slow looping oscillations near 0.2 Hz (one cycle per five seconds), and abrupt brightness jumps — ease dark↔light theme changes rather than cutting.

### 15.6 Responsive Motion

Use the same `matchMedia()` for breakpoints, so viewport-specific animations are created and reverted rather than conditionally skipped:

```js
mm.add("(min-width: 900px)", () => { /* desktop-only pin sequence */ });
```

Mobile defaults unless there's a stated reason otherwise: no pinning, no ScrollSmoother, no scrub-heavy sequences. Scroll on touch devices is a direct-manipulation gesture, and hijacking it costs more trust than the effect returns.

### 15.7 Text and SVG Specifics

**SplitText and accessibility.** SplitText's `aria` config defaults to `"auto"`, which sets `aria-label` on the parent with the original text and `aria-hidden="true"` on the generated character/word elements — so assistive tech reads the sentence, not the letters. Setting `aria: "none"` on real content copy is an accessibility defect; only use it on decorative text that is already labelled elsewhere. Use `autoSplit: true` with an `onSplit` callback to rebuild the split (and the animation) when fonts load or the container reflows, and `mask: "lines"` for clipped line reveals instead of hand-built overflow wrappers. Revert the split on cleanup.

**Reversible UI.** Use `easeReverse` (GSAP 3.15) to give an animation a different ease when its playhead runs backwards — a modal that eases out on open and snaps closed. It adapts even if direction changes mid-tween. `yoyoEase` is deprecated as of 3.15 and internally mapped to `easeReverse`; write new code with `easeReverse`.

**SVG.** DrawSVG animates stroke, so the target needs an actual stroke — it does nothing to a fill-only path, which is the most common "why isn't it working" case. MorphSVG interpolates best between paths of comparable structure; wildly different node counts produce a technically-correct morph that looks like a glitch. Where the morph is the brand moment, say so and design both paths for it.

### 15.8 Performance Rules

- **Animate transforms and opacity only** — `x`, `y`, `scale`, `rotation`, `opacity`. Animating `top`, `left`, `width`, `height`, or `margin` inside a scrubbed sequence forces layout on every frame and is the usual cause of scroll jank that gets blamed on "too many animations."
- **Use `quickTo()` for anything updating at pointer-event rate** — a custom cursor creating a fresh tween per `mousemove` allocates hundreds of objects a second.
- **`will-change` is a budget, not a hint.** Apply narrowly, remove after the animation settles; applying it broadly costs memory and can make things slower.
- **ScrollSmoother is a trade, not an upgrade.** It buys cinematic control and costs native scroll responsiveness, and it interacts badly with some assistive tech and browser find-in-page. Department 6.3 already requires naming the smoothing decision — this is where the mitigation gets stated (respect reduced-motion, disable on touch, keep keyboard scroll functional).

### 15.9 The browser-engineering connection

**Law 8: animation is computation.** Department 35 supplies the mechanism behind every rule in 15.8 — this section makes the link explicit so the rules are reasoned about rather than obeyed.

**Why transforms and opacity, precisely.** The rendering pipeline is `Layout → Paint → Composite` (Department 35.1). `transform` and `opacity` are the only common properties that skip straight to compositing; everything else re-runs layout or paint **on every frame**. At 60fps the frame budget is ~16.7ms *for everything* — script, style, layout, paint, composite. A layout-triggering animation spends most of that on work the compositor could have avoided entirely.

**Layer promotion is a memory trade, not a free speedup.** Promoting an element (`will-change`, `translateZ(0)`) creates a compositor layer consuming GPU memory. Dozens of promoted layers can perform *worse* than none through layer-management and texture-upload cost. Promote deliberately, count the promotions, and remove the hint once the animation settles — 15.8's "budget, not a hint" is this mechanism.

**Layout thrashing in motion code** (Department 35.2). Hand-rolled scroll or gesture math that measures (`getBoundingClientRect`, `offsetTop`) and writes in the same loop forces synchronous layout every iteration. This is a large part of why GSAP and ScrollTrigger outperform hand-rolled equivalents — they batch reads and writes across the frame. When writing raw `requestAnimationFrame` code, separate the read phase from the write phase explicitly.

**Main-thread pressure and INP.** JavaScript-driven animation competes with everything else on one thread (Department 35.3). A long task during an animation drops frames; an animation running during a user interaction delays the response and shows up as poor INP. Two consequences: keep per-frame work minimal (no allocation, no DOM queries, no JSON parsing inside the tick), and prefer CSS or Web Animations for simple state transitions, which the browser can run off the main thread.

**Cleanup is a memory rule, not just a tidiness rule.** Every animation instance, ScrollTrigger, and observer retains references to DOM nodes and closures. Without teardown they become the detached-DOM leak from Department 35.4 — invisible on first visit, compounding on every subsequent navigation. The unmount test below is the verification.

### 15.10 Interaction reliability

Where `interaction-physics.md` supplies the spring model, this section supplies the browser-level correctness the implementation depends on:

- **Pointer Events over separate mouse/touch handlers.** One code path across mouse, touch, and pen. Separate handlers double-fire and diverge.
- **`setPointerCapture`** so the gesture continues when the pointer leaves the element — without it, a fast drag "sticks" the moment the finger outruns the box.
- **`touch-action` declared** on every draggable surface. It tells the browser which native gestures to cede *before* the first move event, and omitting it produces the scroll-versus-drag conflict that reads as unresponsiveness. DEVPOINT's `interaction-delivery.md` owns the arbitration audit.
- **`pointercancel` is a real path, not an edge case.** The browser can revoke a gesture at any moment — a system gesture, an incoming call, a scroll takeover. Every gesture needs a defined recovery, or the surface is left mid-drag permanently.
- **Passive listeners** (Department 35.6): scroll and touch listeners are passive by default in most browsers. A handler that must call `preventDefault()` has to register non-passively and pay the scroll cost knowingly.
- **Cleanup on unmount** for every listener and captured pointer, including mid-gesture unmounts.
- **Accessibility is not optional on gesture surfaces** — every drag-achieved function needs a non-dragging, keyboard-operable equivalent (WCAG 2.5.7). Department 8.2's checklist audits this; stating the alternative is part of this department's output.

---

## Rules

- Every motion event named by Department 6 has a stated engine, and the reason traces to the 15.1 table — not to preference
- One engine per element, always named
- Every animation is created inside a scope that reverts it; "it's a small page" is not an exemption, since the leak only appears on the second visit
- Reduced-motion behavior is stated per motion event, not as a blanket "we support it"
- Motion payload is reported as a measured number against the budget, never as "lightweight"
- Every gesture-driven element has one named owning engine, is interruptible from its presentation value, and hands off release velocity — never a CSS transition

## Failure Conditions

- Engine chosen by habit rather than by the selection rule, or two engines animating the same element
- Animations created outside a scope/context, with no revert path on unmount
- ScrollTrigger positions that were never refreshed after font or image load
- `markers: true` reachable in a production build
- SplitText applied to content copy with ARIA suppressed
- Reduced-motion handled by disabling everything, leaving the interface without state feedback
- A motion payload described qualitatively ("adds very little") with no kilobyte number behind it
- CSS transitions or `@keyframes` driving a draggable element, or a gesture animation that must finish before it can be grabbed again
- `prefers-reduced-transparency` or `prefers-contrast` unhandled on a project that ships translucent surfaces

## Working Method: the unmount test

Mount the page, run the animations, navigate away, come back, and resize. Then ask: are the timelines killed, are the ScrollTriggers removed, is the split text reverted, did any trigger keep a stale measurement from the first mount? If revisiting a route makes motion progressively worse, animations are accumulating — the leak is real, it just hadn't been looked for.

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Engine Fit** | Every motion event's engine is named and traceable to the 15.1 rule; no element has two owners | Engine picked by habit; both libraries animating the same element |
| **Lifecycle Safety** | Every animation scoped and reverted; passes the unmount test cleanly | Animations created ad hoc with no teardown; triggers accumulate across navigations |
| **Motion Payload Discipline** *(inverse — 10 = leanest)* | Plugin set is minimal and justified; summed gzip stated against the 170KB budget | Whole library imported for two effects; no size reported |

## Real Measurable Targets to report

- Chosen plugin set and **summed gzip KB**, stated against the 170KB JS budget in `00-scorecard.md`
- Measured Framer Motion contribution from the project's own bundle output (with the import strategy used)
- Confirmation that `gsap.matchMedia()` handles `prefers-reduced-motion`, plus the specific fallback per motion event
- Confirmation that every animation is scoped (`useGSAP`/`gsap.context()`) and reverts on unmount
- Confirmation that ScrollTrigger refresh is wired to font/image load, and that `markers` is environment-gated
- Where Interaction Physics is active: the targets listed in `references/interaction-physics.md`, reported alongside these
- Confirmation that `prefers-reduced-transparency` and `prefers-contrast` are handled wherever a material layer exists
- GSAP version pinned (3.15.x at time of writing) — motion behavior changes across minor versions, so the version is part of the spec
