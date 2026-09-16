# Department 37: State Management

## Role

Owns **where every piece of state lives, who owns it, and how it changes.** Not library selection — classification first, mechanism second. The library is a consequence of the classification, never the starting point.

**Activation: Level 1+.** A Level 0 static interface has no meaningful state architecture; a form does. Full activation with normalization and state machines at Level 2+.

## The core failure this department exists to prevent

**State with no owner.** The same fact stored in three places — a `user` in Context, a copy in a component, a stale echo in `localStorage` — drifting apart until the UI shows two different answers to the same question. Nobody decides this happens. It accumulates, one convenient `useState` at a time, and by the time it's visible the fix touches thirty files.

The second failure is **treating server data as client state.** Fetching into `useState` and holding it forever produces an application that is confidently wrong: it shows what the server said once, has no concept of staleness, no revalidation, no cache, and no answer to "what if this changed?" Law 5 and Law 11 both live here.

---

## 37.1 The classification — do this before anything else

Every piece of state in the application belongs to exactly one of these categories. **Categorize first; the mechanism follows.**

| Category | What it is | Lives in | Examples |
|---|---|---|---|
| **Local UI state** | Ephemeral, presentational, belongs to one component | `useState`/`useReducer` | Modal open, hover, active tab, focus ring |
| **Component/feature state** | Shared within one feature subtree | Local state lifted, or feature-scoped context | Wizard step, selected rows |
| **Form state** | Values, validation, dirty/touched, submission | Form library or local reducer | Any input the user edits |
| **URL state** | Anything that should survive a refresh or be shareable | The URL | `?page=2&search=turkey&sort=price` |
| **Server state** | A cached copy of data that belongs to the server | Server-state library | Users, products, orders, bookings |
| **Global client state** | Cross-feature, client-owned, not from a server | Context or a store | Theme, locale, sidebar collapsed, feature flags |
| **Derived state** | Computable from other state | **Nowhere — compute it** | Filtered list, totals, validity, counts |

Two of these rows do most of the work in practice:

**URL state is underused.** If a user should be able to refresh, bookmark, share, or press back and get the same view, that state belongs in the URL. Filters, pagination, search terms, selected tab, open detail panel. Putting them in component state silently breaks refresh and sharing — a UX failure that shows up as a bug report about "the link didn't work." The URL is also free persistence with no serialization code.

**Server state is not client state.** It has properties client state doesn't: it can be stale, it's shared with other users, it needs revalidation, it can fail to load, and it exists whether your app is running or not. Managing it with the same tools as `isModalOpen` is the category error that produces most data bugs. Department 41 owns its caching policy; this department owns recognizing it as a separate category.

---

## 37.2 Derived state — Law 6

> **Do not store state that can safely be calculated from existing state.**

Every stored duplicate is a synchronization obligation. Store the source; compute the rest during render.

Common violations worth naming: a `filteredItems` state synced by an effect whenever `items` or `query` changes; an `isValid` boolean maintained alongside the errors object; a `total` recalculated in three handlers; a `selectedItem` object copied out of a list that then updates underneath it (store the **id**, derive the object).

**The effect-to-sync-state pattern is the tell.** An effect whose only job is to set state from other state is nearly always a derivation written as a synchronization. It costs an extra render, and it can be observed mid-flight in the inconsistent state.

**When memoizing a derivation is justified:** the computation is genuinely expensive (large sort/filter, heavy transform) *and* profiling shows it matters, or the result is a dependency of another memo or an effect where referential identity controls re-execution. Otherwise `useMemo` adds indirection, a dependency array to maintain, and its own comparison cost — Department 7 owns that policy in detail.

---

## 37.3 State normalization

**When it applies:** the same entity appears in multiple places, and an update to one must be reflected in all of them. A user appearing in a list, a detail panel, and three comment threads.

**Mechanism:** store entities keyed by id in a flat map; store collections as arrays of ids; look up on render.

```text
Nested (duplicated)              Normalized (single source)
posts: [                         posts:  { p1: {…, authorId: u1} }
  { id: p1, author: {…u1} },     users:  { u1: {…} }
  { id: p2, author: {…u1} }      postIds: [p1, p2]
]
```

**Tradeoff:** normalization adds indirection and lookup code, and makes the shape less obvious at a glance. **It is not a default.** For a list rendered once, nesting is simpler and correct.

**Note the modern qualifier:** a server-state library with a proper query cache already solves much of what normalization was invented for — invalidating a query refetches every consumer. Normalize when you have genuinely relational *client-side* data being mutated locally, not reflexively because the data has relationships.

---

## 37.4 State machines

**The problem they solve:** boolean soup. Four booleans (`isLoading`, `isError`, `isSuccess`, `isEmpty`) describe sixteen combinations, of which perhaps four are legal. The illegal twelve are reachable, and each one is a bug waiting for the right sequence of clicks.

**Mechanism:** enumerate states, define the events that cause transitions, and make undefined transitions impossible rather than merely unlikely. Its type-level expression is the discriminated union from Department 36.4:

```text
idle ──submit──→ submitting ──success──→ succeeded
                      │
                      └──failure──→ failed ──retry──→ submitting
```

**Appropriate when:** the workflow has genuine named states — multi-step checkout, upload with retry, connection lifecycle, approval flows, anything where "can you double-submit?" is a real question.
**Not appropriate when:** the state is a single boolean that is genuinely a boolean. A toggle is a toggle.
**Complexity introduced:** a formalism the team must read fluently; a library (XState) is a real dependency with a real learning curve.
**Failure modes:** over-modelling — a machine with fifteen states for a three-state problem; machines that drift out of sync with the actual UI because transitions were added ad hoc; treating the diagram as documentation after the code stopped matching it.
**Simpler alternative:** a discriminated union in a `useReducer` — most of the safety, none of the dependency. This is the right default; reach for a full state-machine library when you need visualization, statecharts, or hierarchical states.

---

## 37.5 Choosing a mechanism

**The escalation order.** Start at the top and move down only when a stated constraint forces it:

1. **Local state** — the default. Most state is local and should stay there.
2. **Lift to the nearest common ancestor** — when two siblings need it.
3. **URL** — when it should survive refresh or be shareable.
4. **Server-state library** — for anything owned by a server.
5. **Context** — for genuinely global, **low-frequency** client state.
6. **A store** — when Context's re-render behavior becomes the problem.

**The Context tradeoff, stated precisely:** Context is a dependency-injection mechanism, not a state manager with selectors. Every consumer re-renders when the value changes, regardless of which part it uses. That is fine for theme and locale (change rarely), and a performance problem for anything that changes often. Splitting into multiple contexts by update frequency is the first mitigation and is often sufficient; a store with selector-based subscriptions is the second.

**Library positioning:**

| Library | Solves | Reach for it when |
|---|---|---|
| **TanStack Query / SWR** | Server state — caching, revalidation, dedup, retries | Any Level 1+ app with an API. This is usually the highest-value single addition. |
| **Zustand** | Global client state, minimal API, selector subscriptions | Cross-feature client state exists and Context re-renders are measurable |
| **Redux Toolkit** | Global client state with strict structure, middleware, devtools time-travel | Large team, complex client-side mutation logic, debuggability is a stated requirement |
| **Context** | Injection of rarely-changing values | Theme, locale, auth identity, config |

**Do not prescribe one universally.** The right answer for most Level 1–2 React applications is a server-state library plus local state plus the URL, with **no global client store at all** — because once server state is correctly categorized out, the remaining genuinely-global client state is often just a theme and a sidebar flag. Reaching for Redux first and discovering later that 90% of the store was cached server data is the most common architecture mistake at this level.

### The five-part frame, applied

**Zustand.** *Appropriate when:* cross-feature client state that isn't server data, and Context re-renders are measured as a problem. *Not appropriate when:* the state is server data (use a query library) or feature-local (use local state). *Complexity:* another source of truth, and stores tend to accumulate things that should have stayed local. *Failure modes:* becoming a junk drawer; state living globally that only one screen reads. *Simpler alternative:* Context split by update frequency, or lifting state.

**Redux Toolkit.** *Appropriate when:* large team needing enforced conventions, complex client-side mutations, or time-travel debugging as a stated need. *Not appropriate when:* the app's "global state" is mostly cached API responses. *Complexity:* substantial boilerplate and concept load even in RTK form. *Failure modes:* every fetch routed through thunks, reimplementing a query cache badly. *Simpler alternative:* TanStack Query for server state plus Zustand for the small remainder.

---

## 37.6 Ownership and the source of truth

Every piece of state gets **one** owner, named explicitly. This is the SKILL.md Stale UI rule made concrete.

The output of this department includes a state inventory: for each significant piece of state, its **category**, its **owner**, its **source of truth**, and — where it's server-derived — its **freshness policy** (handed to Department 41).

The multi-writer cases that need an explicit decision, because they are where "it works locally" fails:

- **Two tabs open.** Both hold state; one writes. Does the other find out? (`BroadcastChannel`, storage events, or refetch-on-focus — or an accepted "no.")
- **Optimistic update that fails remotely.** The rollback path is designed *before* the optimistic path ships, not after the first bug report. Department 38 owns the mechanism.
- **Server data changed under an open form.** Last-write-wins, conflict detection via version/ETag, or a warning — pick one and say so.
- **URL and component state disagree** after a back-navigation. If the URL is the source of truth, the component derives from it; it does not hold a parallel copy.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **State Ownership Clarity** | Every significant piece of state has a stated category, owner, and source of truth; multi-writer cases decided explicitly | Same fact stored in several places; "wherever it ended up"; no owner named |
| **Derivation Discipline** | Derived values computed, not stored; memoization only where profiled or identity-critical | Effects syncing state from state; totals and filtered lists stored and manually kept in step |
| **State Architecture Fit** | Mechanism matches category; server state separated from client state; escalation justified at each step | Everything in one global store; server data in `useState`; library chosen before classification |

## Real Measurable Targets to report

- **State inventory** — category, owner, source of truth per significant piece of state
- **Server state managed by a server-state mechanism** — pass/fail, with any exception justified
- **URL-eligible state actually in the URL** — filters, pagination, search, tab, selected detail: pass/fail per item
- **Count of effects whose sole purpose is syncing state from state** (target: 0)
- **Count of stored values that are derivable** (target: 0, or each justified by a profile)
- **Multi-writer decisions recorded** — tabs, optimistic rollback, concurrent edit, back-navigation
