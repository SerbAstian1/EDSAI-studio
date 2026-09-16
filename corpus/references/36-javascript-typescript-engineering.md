# Department 36: JavaScript & TypeScript Engineering

## Role

Language and runtime specialist for the layer *beneath* the framework. React is a library that runs on JavaScript; when React behaves surprisingly, the explanation is usually a closure, a reference identity, or a microtask — not React.

**Activation: always.** Every level. The language semantics that cause stale closures and unhandled rejections do not switch off for small projects.

## The core failure this department exists to prevent

**Reasoning about React without reasoning about JavaScript.** A stale closure is not a React bug; it is a closure capturing a binding from a previous render. An effect that "runs twice" is not a framework defect; it is a dependency array containing a value with a new identity each render. A `useMemo` that never hits is structural equality misunderstood as referential equality.

The second failure is **trusting types at runtime.** TypeScript is erased at compile time. A response typed `User[]` that arrives as `null` will not throw at the boundary — it will throw four components deeper, in code that looks correct, at a stack frame that tells you nothing about the API that lied.

---

## 36.1 Scope, closures, and the execution model

**Lexical scope** — an inner function has access to the bindings of the scope it was *defined* in, not the one it's called from. A closure is a function plus that captured environment; it keeps those bindings alive as long as the function is reachable, which is simultaneously the mechanism behind hooks and behind the memory leaks in Department 35.4.

**Stale closures**, the practical consequence: a callback created during render 1 captures render 1's variables. If that callback is stored (in a timer, a listener, a subscription, a ref) and invoked during render 5, it still sees render 1's values. The value isn't "old" by accident — the function is doing exactly what lexical scope specifies.

*Mitigations:* include the value in the dependency array so the closure is recreated; use a functional updater so the current value comes from the state setter rather than the closure; or store the latest value in a ref when the callback genuinely must be stable and current.

**`this`** is determined by *call site*, not definition site — except in arrow functions, which have no `this` binding and inherit lexically. This is the entire reason arrow functions in class components solved the "lost `this`" problem, and why it is a non-issue in function components.

**Hoisting.** `var` declarations and function declarations are hoisted and initialized; `let`/`const` are hoisted but sit in the temporal dead zone until evaluated, throwing on early access. Prefer `const` by default, `let` when reassignment is genuine — not as style, but because block scoping eliminates a category of loop-capture bug that `var` creates.

**Prototypes.** Objects delegate property lookup up a prototype chain. Relevant here for two reasons: it explains why `Object.create(null)` is the safe shape for a dictionary of untrusted keys, and it is the mechanism that makes **prototype pollution** possible (Department 40).

---

## 36.2 Async: promises, the microtask queue, and cancellation

Promises resolve into the **microtask queue** — see Department 35.3 for the loop mechanics. What matters at the language level:

**`async`/`await` is promise chaining with different syntax.** An `await` suspends the function and schedules its continuation as a microtask. It does not block the thread.

**Sequential vs parallel is a choice you make by syntax:**

```text
Sequential — each await waits for the previous
  const a = await fetchA();
  const b = await fetchB();      total: A + B

Parallel — both start, then both are awaited
  const [a, b] = await Promise.all([fetchA(), fetchB()]);   total: max(A, B)
```

This is the language-level source of the request waterfall that Department 38 diagnoses at the architecture level. If B does not depend on A, awaiting them sequentially is latency you chose.

**Combinator selection matters:**

| Combinator | Behavior | Use when |
|---|---|---|
| `Promise.all` | Rejects immediately if any rejects | All results required; partial failure is failure |
| `Promise.allSettled` | Always resolves with per-promise status | Partial failure is acceptable and should render |
| `Promise.race` | Settles with the first to settle, success or failure | Timeouts, first-response-wins |
| `Promise.any` | First *fulfilment*; rejects only if all reject | Redundant sources |

`Promise.all` for a dashboard of independent widgets is a common mistake: one slow endpoint failing blanks six working panels. `allSettled` renders five panels and one error state — Law 13.

**Error propagation.** A rejected promise with no handler produces an **unhandled rejection**. In a browser this fires `unhandledrejection` on `window` — which Department 45 must listen for, because these do not surface through `window.onerror` and are otherwise invisible in production. `try`/`catch` around `await` catches rejections; `try`/`catch` around a non-awaited promise call does not.

### AbortController — the cancellation primitive

Every async operation tied to a component lifecycle or a user intent needs a way to stop.

**Mechanism:** an `AbortController` exposes a `signal`; passing it to `fetch` causes the request to reject with an `AbortError` when `controller.abort()` is called. The same signal can be passed to `addEventListener`, removing every listener registered with it in a single call.

**Failure mode it prevents:** the out-of-order response race in the SKILL.md resilience rules, and the "state update on unmounted component" class of bug. Cancel on unmount, and cancel the in-flight request when a new one supersedes it.

**Verification:** an `AbortError` must be distinguished from a real failure and *not* rendered as an error state — an aborted request is an expected outcome, not a problem the user needs to see.

**Iterators and generators** matter mainly where streaming or incremental consumption is genuine (async iteration over a `ReadableStream`, paginated cursors). They are not a default tool; reaching for a generator where an array suffices adds indirection without benefit.

---

## 36.3 Modules

**ESM** is static: imports and exports are analyzable without executing the module. That property is what makes **tree shaking** possible — the bundler can prove an export is unused. **CommonJS** is dynamic (`require` is a function call, resolvable at runtime), so it cannot be reliably shaken.

The practical consequences, which Department 43 depends on:

- **Named imports from ESM packages shake; namespace imports often don't.** `import { debounce } from 'lodash-es'` can drop the rest; `import _ from 'lodash'` pulls the library.
- **Side-effectful modules cannot be shaken** regardless of syntax. A module that mutates global state on import must be kept, which is why `sideEffects: false` in `package.json` is a claim the bundler trusts — and a wrong claim silently breaks CSS imports and polyfills.
- **Dynamic `import()`** returns a promise and creates a split point. This is the language-level mechanism behind route-level code splitting and lazy components.

**Module boundaries as design.** What a module exports is its contract. Deep imports into another feature's internals (`../checkout/internal/utils`) create the coupling Department 7 scores as Code Coupling. Prefer an explicit public surface per feature.

---

## 36.4 TypeScript

**Structural typing:** compatibility is determined by shape, not by declared name. Two independently declared types with identical members are interchangeable. This is why "it type-checks" does not mean "it's the type I meant" — an `Order` with the same fields as a `Draft` will pass where a `Draft` is expected.

**Inference first.** Annotate boundaries — function parameters, exported signatures, public contracts — and let inference handle the interior. Over-annotation is noise that drifts out of sync with the implementation.

**Narrowing and guards.** A union is only useful if it can be narrowed. `typeof`, `instanceof`, `in`, and literal comparison narrow automatically; a custom type guard (`x is Foo`) narrows where the check is non-trivial. **Discriminated unions** are the highest-value pattern in application code:

```text
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }
```

This makes the impossible state unrepresentable — no `isLoading: true` alongside `data: null` alongside `error: someError`, no rendering path that has to guess. It is the type-level expression of Law 2 and Law 13, and it is the recommended shape for every async surface Department 38 designs.

**Generics** parameterize over types; constrain them (`<T extends { id: string }>`) so the body can actually use them. An unconstrained generic that gets cast internally is `any` with ceremony.

**`any` vs `unknown`.** `any` disables checking and propagates silently — one `any` at an API boundary can erase type safety across a whole feature. `unknown` is the honest type for data whose shape isn't yet proven: it forces narrowing before use. External data enters as `unknown`, never `any`.

**Useful utility types**, applied where they express intent rather than to demonstrate cleverness: `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, `Record`, `ReturnType`, `Parameters`, `Awaited`, and template literal types for constrained string unions.

---

## 36.5 The runtime/compile-time boundary — Law 9

> **TypeScript types do not validate runtime data.**

```text
Compile-time type safety   ≠   Runtime data validation
```

Types are erased during compilation. `const user = await res.json() as User` is an *assertion*, not a check — it tells the compiler to stop asking, and it is the single most common way a typed codebase gets a runtime `undefined`.

**Validate at every boundary where untrusted data enters:**

- API responses (including your own backend — contracts drift, deploys skew, gateways return HTML error pages with 200s)
- URL parameters and query strings
- `localStorage`/`sessionStorage` reads — written by a previous version of your own app
- Form input, `postMessage` payloads, third-party SDK callbacks, environment variables

**Mechanism:** a schema validator (Zod, Valibot, ArkType) defines the shape once and derives the TypeScript type from it, so the runtime check and the static type cannot drift apart. Validate at the edge, then trust the value inward.

**Tradeoff, stated:** validation costs bundle size and CPU per response. For a large list payload, parse cost is measurable. Mitigations: validate the envelope and sample or lazily validate items; use a lighter validator; or validate in development and assert in production *only* where the contract is genuinely owned and tested by the same team — a decision to record, not to make silently.

**When not to:** an internal function receiving data already validated at the boundary should not re-validate. Validate at the perimeter, once.

**Verification:** every `as` cast in the codebase has a stated justification. A response type declared without a corresponding runtime check is a Major QA issue under Department 9 for any Level 1+ project.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Type Soundness** | Discriminated unions model async and variant state; `unknown` at boundaries; every `as` justified; generics constrained | `any` at API boundaries; boolean soup instead of unions; casts used to silence errors |
| **Runtime Boundary Discipline** | Every external input validated by schema at the edge, type derived from schema; parse cost considered | Types asserted onto `res.json()`; storage reads trusted; env vars assumed present |
| **Async Correctness** | Independent work parallelized; combinator chosen deliberately; every async op cancellable; rejections handled and reported | Sequential awaits with no dependency; `Promise.all` where partial failure should render; no cancellation; silent rejections |

## Real Measurable Targets to report

- **`any` count** in application source, each with a stated reason (target: 0 unjustified)
- **Type assertion (`as`) count** at data boundaries (target: 0 without an accompanying runtime check)
- **TypeScript `strict` mode enabled**, with any disabled flag named and justified
- **Validated boundary inventory** — every external input source listed with its validator, or explicitly marked as an accepted risk
- **Unhandled rejection handler registered** and wired to Department 45's error reporting
- **Cancellation coverage** — every request tied to component lifecycle or supersedable user intent uses an `AbortController` signal
