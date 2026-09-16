# Department 35: Browser Engineering

## Role

Browser runtime specialist. Owns the model of *how the browser actually executes and renders a frontend* — the pipeline from bytes to pixels, the single thread that most of it competes for, and the memory that accumulates when nobody is watching.

**Activation: always.** Every level, every project. A Level 0 static site still has a critical rendering path, a main thread, and a way to leak listeners. This department is the substrate the rest of the Frontend Engineering Block reasons on top of.

## The core failure this department exists to prevent

**Treating the browser as a canvas that paints whatever it's given.** The symptom is code that is correct, readable, and slow — a scroll handler that reads `offsetHeight` every frame, an animation on `top` instead of `transform`, a modal that never removes its keydown listener. None of these are bugs in the logic. They are bugs in the runtime model, and they are invisible until you know what the browser is doing underneath.

The second failure is the inverse: cargo-culted "optimization" with no measurement — `will-change` sprayed across a stylesheet, `transform: translateZ(0)` on everything, memoization everywhere. Both failures come from the same place. This department replaces folklore with a mechanism.

---

## 35.1 The rendering pipeline

Every visual update travels this path:

```text
HTML
 ↓  parse
DOM  ────────┐
             ├──→ Render Tree ──→ Layout ──→ Paint ──→ Composite
CSS          │
 ↓  parse    │
CSSOM ───────┘
```

**DOM construction.** The parser builds the document tree incrementally as bytes arrive. It is *blocked* by synchronous scripts, because a script may call `document.write` or mutate the tree the parser is currently building. This is the mechanism behind `defer` and `async` — not style preferences but instructions about whether the parser must stop.

**CSSOM construction.** CSS is render-blocking by default: the browser cannot build the render tree without knowing computed styles, so it will not paint until CSS has parsed. This is why a large blocking stylesheet delays *first paint of the entire page*, not just the elements it styles.

**Render tree.** DOM + CSSOM, containing only what will be rendered. `display: none` elements are absent from the render tree entirely; `visibility: hidden` elements are present and occupy layout space. That distinction is the whole reason the two properties have different performance profiles.

**Layout (reflow).** Computes geometry — position and size of every box. Cost scales with the number of affected nodes, and layout is *tree-dependent*: changing an element's width can force recalculation of its descendants, its siblings, and sometimes its ancestors.

**Paint.** Fills in pixels — text, colors, shadows, borders — into layers.

**Composite.** Assembles painted layers into the final frame, on the GPU where possible.

### Why the pipeline order is the whole optimization story

A change high in the pipeline forces everything below it to rerun:

| Changing… | Triggers |
|---|---|
| `width`, `height`, `top`, `left`, `margin`, `padding`, `font-size` | Layout → Paint → Composite |
| `color`, `background-color`, `box-shadow`, `border-radius` | Paint → Composite |
| `transform`, `opacity`, `filter` | Composite only |

This is the mechanism behind the rule Department 15 enforces: **animate `transform` and `opacity`.** Not because they're fashionable, but because they skip layout and paint entirely and run on the compositor. Animating `left` runs the full pipeline sixty times a second on the main thread.

**Tradeoff, stated honestly:** compositor-only animation is not free. Each promoted layer consumes GPU memory, and a page with hundreds of promoted layers can perform *worse* than one with none — layer management and texture upload have their own cost. `will-change` is a hint that creates a layer eagerly; used indiscriminately it is a memory leak with good intentions. Promote deliberately, promote few, and remove the hint after the animation ends.

---

## 35.2 Layout thrashing

The single most common self-inflicted performance bug in interactive frontends.

The browser batches layout: it will happily accept many DOM writes and compute layout once, before the next paint. But a **read of a layout-dependent property forces the pending writes to be flushed immediately** so the read returns a correct value. This is *forced synchronous layout*.

Interleaving reads and writes therefore defeats the batching:

```text
READ   ← forces layout
WRITE  ← invalidates it
READ   ← forces layout again
WRITE  ← invalidates it again
```

Batched, the same work costs one layout:

```text
READ
READ
WRITE
WRITE
```

**Layout-forcing reads include:** `offsetTop/Left/Width/Height`, `clientTop/Left/Width/Height`, `scrollTop/Left/Width/Height`, `getBoundingClientRect()`, `getComputedStyle()`, `focus()`, and `scrollIntoView()`.

**The vulnerable pattern** is a loop over elements that measures each one and immediately styles it. Each iteration forces a full layout, turning an O(n) loop into O(n) layouts.

**Mitigation:** separate the phases. Measure every element into an array first, then write every element in a second pass. Where a framework is in play, `requestAnimationFrame` gives a natural write phase; libraries like GSAP batch internally, which is part of why Department 15 prefers them over hand-rolled scroll math.

**Verification:** Chrome DevTools Performance panel flags forced reflow explicitly, with the offending stack. A profile showing repeated purple "Layout" bars inside a single task is the signature.

---

## 35.3 The main thread and the event loop

JavaScript execution, style calculation, layout, paint coordination, and most event handling all compete for **one thread**. The browser can only render between tasks, never during one.

The loop, in the order that matters:

```text
┌─→ Run one task from the task queue (macrotask)
│      ↓
│   Drain the ENTIRE microtask queue
│      ↓
│   Rendering opportunity (style → layout → paint → composite)
│      ↓
└───────
```

**Macrotasks:** `setTimeout`, `setInterval`, I/O, most event callbacks, `MessageChannel`.
**Microtasks:** promise continuations (`.then`, `await` resumption), `queueMicrotask`, `MutationObserver`.

Two consequences follow directly and are worth stating because they explain most confusing async behavior:

1. **Microtasks run to completion before the next render.** An awaited chain that resolves synchronously-available values will run entirely before the browser gets a chance to paint. A recursive microtask can starve rendering indefinitely — the loop never reaches the rendering opportunity.
2. **`setTimeout(fn, 0)` is not "immediately."** It yields to the browser, allowing a render, and is the crude-but-real way to break work across frames. `requestIdleCallback` is the intentional version; `requestAnimationFrame` schedules for just before the next paint.

### Long tasks

Any task occupying the main thread for **more than 50ms** is a long task. During it, the browser cannot respond to input, cannot render, and cannot run animations. This is the direct mechanism behind poor **INP** — the input was received, but the handler couldn't run until the thread was free.

**Mitigation, in order of preference:**
1. **Do less** — the fastest work is work that doesn't happen. Ship less JS, parse less JSON, render fewer nodes.
2. **Chunk it** — break long loops with yields, so input can be serviced between chunks.
3. **Move it off-thread** — a Web Worker for genuinely CPU-bound pure computation (parsing, diffing, crypto, image processing). Workers cannot touch the DOM, so this only applies to computation, never rendering.
4. **Defer it** — `requestIdleCallback` for work that isn't user-visible.

**When not to reach for a Worker:** the postMessage boundary requires structured-clone serialization, which for large objects can cost more than the computation saved. Measure the transfer before assuming the worker wins.

---

## 35.4 Memory

Browser memory is garbage-collected, which is often misread as "not my problem." GC reclaims objects that are *unreachable*. It cannot reclaim objects you are still holding a reference to, and a long-lived SPA accumulates those references across navigations.

**The four leak patterns that account for most real cases:**

| Leak | Mechanism | Mitigation |
|---|---|---|
| **Detached DOM** | JS holds a reference to a node removed from the document; the node and its entire subtree stay alive | Null out references on teardown; avoid caching nodes in module scope |
| **Event listeners** | `addEventListener` on `window`/`document` from a component that unmounts without removing it | Every `addEventListener` has a matching `removeEventListener` in cleanup; use `AbortController` signals to remove many at once |
| **Subscriptions & timers** | `setInterval`, observers, store subscriptions, WebSocket handlers outliving their owner | Return a teardown from every effect that creates one |
| **Closures over large data** | A retained callback closes over a large array or response object, keeping it alive indefinitely | Keep closure scope narrow; don't capture whole responses in long-lived handlers |

**Verification:** DevTools Memory panel, heap snapshot comparison. The reliable procedure is to snapshot, perform the suspect interaction cycle (navigate away and back, open and close the modal) several times, force GC, snapshot again, and compare retained size. Filter for "Detached" nodes. A cycle that grows retained memory monotonically is leaking; noise around a flat line is not.

This connects directly to Department 7's effect-cleanup policy and Department 15's animation teardown — both exist because of this section's mechanism.

---

## 35.5 Browser storage — the mechanism layer

Storage *mechanisms* are described here because they are browser runtime facts. **Storage architecture, offline strategy, and sync belong to Department 44**; the security tradeoffs of each mechanism belong to Department 40. Do not restate those here.

| Mechanism | Capacity | Sync/async | Persistence | Sent to server |
|---|---|---|---|---|
| **Cookies** | ~4KB | Sync | Configurable expiry | **Yes, on every matching request** |
| **localStorage** | ~5–10MB | **Synchronous — blocks the main thread** | Until cleared | No |
| **sessionStorage** | ~5–10MB | Synchronous | Per tab, until close | No |
| **IndexedDB** | Large, quota-based | Asynchronous | Until cleared | No |
| **Cache Storage** | Quota-based | Asynchronous | Until cleared | No |

**These are not interchangeable.** Three consequences worth stating:

- **localStorage is synchronous**, so reading a large value on startup is a main-thread block on the critical path. It is fine for a theme preference and wrong for a dataset.
- **Cookies are sent on every request** to the matching domain, so a large cookie is a per-request bandwidth tax on every asset. That property is also what makes them the correct vehicle for a session token that must reach the server.
- **All of it can fail.** Storage may be disabled, full, or partitioned (Safari ITP, private browsing). Every read is wrapped, every write is failure-tolerant, and the UI has a defined behavior when storage is unavailable — Law 13.

---

## 35.6 Event propagation

Events travel **capture** (window → target), then **target**, then **bubble** (target → window). Delegation exploits the bubble phase: one listener on a container handles events for many children, which matters for lists that mutate frequently.

**`passive: true`** on scroll and touch listeners tells the browser the handler will not call `preventDefault()`, so it need not block scrolling while waiting to find out. Omitting it on a touch listener is a direct scroll-jank cause. Note the corollary: a passive listener *cannot* prevent default, so a gesture handler that must suppress native scrolling has to declare itself non-passive and pay that cost knowingly. Department 15 and `interaction-physics.md` own that arbitration.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Runtime Understanding** | Pipeline stage named for every performance claim; main-thread cost reasoned about explicitly | "Should be fast" with no mechanism; browser treated as a black box |
| **Rendering Efficiency** | Animated properties are compositor-only and justified; layer promotion deliberate and counted | Layout-triggering properties animated; `will-change` applied globally |
| **Memory Safety** | Every listener, timer, subscription, and animation has a stated teardown; leak-check procedure defined | Cleanup unaddressed; long-lived handlers capture large scopes |
| **Event Handling** | Delegation and passive flags chosen with reasons; propagation phase stated where it matters | Listeners attached per-item by default; passive omitted on touch/scroll |

## Real Measurable Targets to report

- **Long tasks** on the critical interaction path: count and duration of the longest (target: none >50ms during load or primary interaction)
- **Total Blocking Time** for the initial load
- **Forced reflow** occurrences flagged in a Performance profile (target: 0 on scroll/resize/animation paths)
- **Compositor layer count** for animated views, with a stated reason for each promotion
- **Retained heap delta** across five repetitions of the primary navigation or open/close cycle (target: flat, not monotonic growth)
- **Storage mechanism named per stored item**, with its sync/async and size profile stated
