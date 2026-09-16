# Department 7: Frontend Engineering System

## Role

Senior frontend architect, React/Vite/TypeScript ecosystem specialist. Converts the design system into production-grade code structure. This department doesn't write every line of the final app — it produces the architecture, the folder structure, the component contracts, and the technical decisions that make everything upstream actually shippable.

## Scope boundary with DEVPOINT

**The boundary is the API/data contract, not a folder.** This department owns the interface and its runtime: components, hooks, frontend state, design tokens as code, the content-as-data pattern, and — through Departments 35–47 — the browser runtime, rendering strategy, data consumption, frontend security, build, and client observability. DEVPOINT (Departments 16–34) owns everything past the contract: server, schema, auth infrastructure, persistence, backend services, and infrastructure operation.

*(An earlier version of this file drew the line at `src/`. That proxy stopped working once the frontend took ownership of build configuration, service workers, CDN cache behavior, and client observability — all of which live outside `src/`. See the boundary table in SKILL.md, which is authoritative.)*

Don't design the backend here; specify what the frontend needs from it — the response shapes each screen renders, including loading, empty, and error states — and let DEVPOINT Department 17 turn that into contracts. **Department 38 owns the contract inventory**; this department consumes it. Where no backend layer is in play, this department's output stands alone unchanged, with required contracts stated as labeled assumptions.

## Relationship to the Frontend Engineering Block

This department is the **architectural spine**; Departments 35–47 are its specialist depth. Department 7 decides the shape of the application — structure, component contracts, where things live. It hands off:

| Question | Owner |
|---|---|
| Where does this state live? | **37** |
| How is this data fetched, retried, cancelled? | **38** |
| Server-rendered, static, or client-rendered? | **39** |
| What does the browser do with this at runtime? | **35** |
| What ships in the bundle? | **43** |

Don't re-derive those decisions here — reference them. What stays in this department is composition, boundaries, contracts, and the React-level rendering discipline in §7.5–7.7.

## The core failure this department exists to prevent

**Architecture that looks fine in a 200-line demo and collapses at 5,000 lines.** Frontend code that's "tightly coupled" or "unstructured" doesn't fail immediately — it fails three months in, when a design-system change requires touching forty files instead of one.

## Stack (default; state explicitly if project requires different)
- React (function components, hooks — no class components unless a specific legacy constraint requires it)
- Vite (build tooling)
- TypeScript (strict mode — `any` requires a stated reason, not silent use)
- TailwindCSS (utility-first; design tokens from Department 5 should map directly into the Tailwind config, not be re-invented as inline styles)
- Motion: **GSAP and Framer Motion are both in the default stack**, selected per motion event by the rule in `references/15-motion-engineering.md` (§15.1) — roughly, React state drives it → Framer Motion, the timeline or scroll position drives it → GSAP, neither → CSS. Don't pick one here by habit; Department 15 owns that decision and reports its bundle cost. What this department owns is where the motion layer *lives* in the tree (`src/animations/` for timelines, `src/hooks/` for the React bindings) and the rule that durations/easings from Department 6.2 are defined once as shared tokens/variants, never hardcoded per-component.

## Required Outputs

### 7.1 Architecture Decisions
State explicitly, with reasoning:
- **State management approach**: local component state vs. context vs. a library (Zustand, etc.) — and the actual rule for which is used when (e.g. "local state for anything used by one component tree; Zustand for anything needed across unrelated routes").
- **Data fetching pattern**: where API calls live, how loading/error states are handled consistently (a pattern stated once and reused, not improvised per-component).
- **Routing structure**: if multi-page, the actual route tree.

### 7.2 Folder Structure
Provide the actual tree, not a description of one. Default pattern (adjust and state deviations):

```
src/
├── components/
│   ├── ui/          # design-system primitives (Button, Card, Input) — match Dept. 5 components 1:1
│   ├── sections/     # page-level composed sections (Hero, Pricing, Footer)
│   └── layout/       # Shell, Nav, structural wrappers
├── hooks/            # shared custom hooks
├── lib/              # utilities, constants, design tokens as code
├── content/          # copy/content as data (see 7.4)
├── styles/           # global styles, Tailwind config extensions
└── types/            # shared TypeScript types
```

The `components/ui/` layer should map **directly** to Department 5's component system — same names, same states. If Department 5 defined a Button with hover/active/focus/disabled/error states, the code Button should implement all five, not just default and hover.

### 7.3 Component Contracts
For each non-trivial component, state:
- Props interface (the actual TypeScript shape)
- What it owns vs. what it receives (a component that fetches its own data AND manages complex local UI state AND handles its own animation logic is doing too many jobs — name the split)

### 7.4 Content-as-Data Pattern
Copy from Department 3 should live in a typed content file (`src/content.ts` or similar), not hardcoded inline across components. This is a structural decision, not a style preference: it means a copy revision never requires touching component logic, and a future i18n pass has a single source to work from.

### 7.5 Component Architecture

**Composition over configuration.** A component accumulating boolean props (`isCompact`, `hasIcon`, `showFooter`, `variant`) to cover every case becomes a component nobody can change safely. Prefer composition — slots and children — so callers assemble what they need rather than requesting it through a growing flag surface. The tell: a props interface where several combinations are meaningless or mutually exclusive.

**Component boundaries.** Split when a component has more than one reason to change, not at an arbitrary line count. A section that fetches data, manages complex local UI state, *and* owns its animation logic has three reasons to change — name the split explicitly (§7.3 already requires this; this is the criterion for it).

**Prop design:**
- Prefer a small number of well-named props to a large flat surface.
- **Pass ids, not objects, for anything that can go stale** — a component holding a copied object renders yesterday's version after an update (Department 37.2).
- Model mutually exclusive props as a discriminated union, so illegal combinations are unrepresentable (Department 36.4).
- Don't accept a prop the component only forwards to one child unless the indirection genuinely serves the caller.

**Controlled vs uncontrolled** is a deliberate contract decision, not an accident:
- **Controlled** — the parent owns the value. Use when the value must be validated, synced, or read externally.
- **Uncontrolled** — the component owns it, exposing an `onChange`. Use for simple inputs where nothing outside needs the intermediate value; it avoids a render per keystroke.
- **Support one or the other clearly.** A component that half-supports both — accepting `value` but also keeping internal state — will desynchronize. If both are needed, implement the controlled path and layer an uncontrolled wrapper on top.

**Dependency direction.** Dependencies flow one way: `ui primitives → patterns → sections → pages`. A primitive importing from a section is an inversion that will eventually become a cycle. Feature code may import shared code; shared code may never import feature code.

**Reusable vs feature-specific.** Not everything belongs in `components/ui/`. A component earns promotion to shared when it has **at least two real consumers** and no product-specific knowledge. Abstracting on the first use is how a shared layer fills with things used once and parameterized for a second case that never arrived.

### 7.6 Rendering and re-rendering

**Mechanism:** a component re-renders when its state changes, when its parent re-renders, or when a context it consumes changes. Reconciliation then diffs the produced tree against the previous one and applies the minimum DOM mutation.

**Re-rendering is not inherently a problem.** React re-renders constantly and cheaply; the DOM work is what's expensive. Optimizing renders that were already cheap adds complexity for nothing. Profile before treating a render count as a bug.

**Referential equality is the source of most surprises.** Object and array literals, and inline functions, get a **new identity every render**. That identity is what dependency arrays, `React.memo`, and context values compare against — which is why a memoized child re-renders anyway when passed an inline object, and why an effect with an object dependency runs every render.

**Keys.** Use a stable identity from the data. **Array index as key is a correctness bug, not a performance one**, in any list that can reorder, insert, or filter — state gets attached to the wrong item, and inputs visibly swap values.

**Stale closures** (Department 36.1) surface here as effects and callbacks reading values from a previous render. The fix is a correct dependency array, a functional updater, or a ref — not an eslint-disable comment, which converts a visible warning into an invisible bug.

**Effects — the discipline that prevents most of it:**
- An effect is for **synchronizing with something outside React**: a subscription, a timer, an imperative DOM API, an animation instance, a network side effect not owned by a fetching layer.
- **An effect that only sets state from other state is a derivation written wrong** (Department 37.2).
- **Every effect that creates something returns a teardown that destroys it** — listeners, timers, observers, subscriptions, animation instances. This is Department 35.4's memory model expressed as a coding rule, and it's the single highest-value rule in this file.
- Effects must tolerate running twice (StrictMode in development does this deliberately, to surface missing cleanup).

### 7.7 React performance

**Profile first.** React DevTools Profiler shows what rendered, why, and how long it took. Memoization applied without a profile is complexity purchased on speculation.

| Tool | Actually helps when | Adds cost when |
|---|---|---|
| `React.memo` | An expensive subtree re-renders from parent renders with unchanged props | Props change every render anyway (inline objects/callbacks) — then it's a wasted comparison |
| `useMemo` | A genuinely expensive computation, **or** a value whose referential identity controls a downstream memo or effect | Wrapping cheap arithmetic — the memo costs more than the work |
| `useCallback` | The function is a dependency of a memoized child or an effect | The function goes to a plain DOM handler that doesn't care about identity |

**The identity-stability case is the one people miss:** `useMemo`/`useCallback` are frequently about *correctness of downstream comparisons*, not about the cost of the computation itself.

**For long lists, virtualization beats memoization** by orders of magnitude. Rendering 10,000 rows and memoizing each is solving the wrong problem — render the visible window (Department 38.5, which also flags the unbounded-DOM cost of infinite scroll).

**When memoization adds unnecessary complexity:** when it's applied everywhere by default. Every memo is a dependency array to maintain, and a stale one is a bug that's harder to find than the render it saved.

### 7.8 Server / client boundaries

Applies only where the framework supports Server Components. **Department 39 owns the rendering-strategy decision and hydration mechanics**; this department owns the component-level consequences.

- **Default to server; opt into client.** `'use client'` marks a boundary, and everything imported below it becomes client code. Push the directive as **deep** as possible — a `'use client'` at a layout's top pulls the entire page's tree into the bundle.
- **Props crossing the boundary must be serializable.** No functions, class instances, or symbols. Design for this up front; discovering it mid-build forces awkward refactors.
- **A Client Component cannot import a Server Component, but can receive one as `children`.** Slot composition is the escape hatch, and designing components to accept children rather than render everything internally keeps the boundary shallow.
- **Server Actions** (where available) move mutations server-side without a hand-written endpoint. They are still a public HTTP surface — authorization and input validation are mandatory, exactly as for any endpoint (Departments 40 and DEVPOINT 19). Treating them as internal function calls is a real security mistake.
- **Never pass secrets as props.** Serialized props are visible to the client.

### 7.9 The abstraction rule

> **Prefer the smallest stable abstraction that improves clarity, reuse, or correctness.**

Do not create an abstraction merely because code *can* be abstracted. Two similar blocks are not yet a pattern — the third occurrence tells you the shape, and the first two only guess at it. A premature abstraction is harder to remove than the duplication it replaced, because every consumer has since bent it further.

The test before extracting: *can I name this thing after what it means, rather than after what it does mechanically?* `useTableSortingAndFilteringAndPagination` is three concerns wearing one name.


## Rules
- Modular architecture — a component should be understandable without reading three other files first
- Performance-first — no unnecessary re-renders from poorly-scoped state, no unoptimized images/assets (state the actual image format/compression strategy, tying back to Department 8's LCP target)
- Scalable components — adding a new instance of an existing pattern (new card, new section) should require composition, not duplication-with-edits
- Clean structure — the folder tree above isn't decoration, every file should be locatable by someone who's never seen the codebase, purely from the structure

## Failure Conditions
- Poor performance (state-management choices or re-render patterns that would visibly degrade at scale)
- Unstructured code (no consistent pattern for where logic/state/content live)
- Tightly coupled components (a component that can't be moved or reused without dragging unrelated dependencies with it)
- Design tokens re-invented in code instead of mapped 1:1 from Department 5

## Working Method: the new-developer test
Could a competent engineer who's never seen this codebase find the Button component, understand its states, and add a new page section correctly within 10 minutes of reading the folder structure alone? If the answer requires "well, you'd need me to explain a few things first" — the structure isn't actually self-documenting yet.

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Architecture Scalability** | New features compose from existing primitives, no rewrite needed | Every new feature requires touching unrelated files |
| **Performance Headroom** | State/render patterns and asset strategy explicitly tied to Dept. 8 targets | No stated performance reasoning, "should be fine" |
| **Code Coupling** *(inverse — 10 = least coupled)* | Components are independently movable/testable | Components reach into siblings' state or DOM directly |

## Real Measurable Targets to report
- Estimated initial JS bundle size vs. the 170KB budget noted in `00-scorecard.md`
- Image format/compression strategy stated explicitly (e.g. AVIF with WebP fallback, served at display dimensions)
- Confirmation that design tokens (color, type scale, spacing) are defined once (Tailwind config or CSS variables) and consumed everywhere, not duplicated
