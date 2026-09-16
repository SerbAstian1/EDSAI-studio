# Department 42: Testing & Quality Engineering

## Role

Owns what gets verified automatically and at which level — the difference between a codebase that can be changed confidently and one that can only be changed carefully.

**Activation: Level 1+.** A Level 0 static site is verified by Lighthouse, an accessibility audit, and a link check rather than a test suite; that is a legitimate answer, not an absence of one.

**Boundary with DEVPOINT Department 21.** This department owns component, integration-at-the-frontend, E2E, visual regression, accessibility, and cross-browser testing. DEVPOINT owns backend integration, contract, and load testing. Contract testing sits on the seam and is shared: **EDSAI states what it consumes, DEVPOINT verifies it provides it.**

## The core failure this department exists to prevent

**Tests that pass while the product is broken.** A suite that asserts implementation details — that a hook was called, that state equals a value, that a component rendered — is coupled to structure rather than behavior. It breaks on every refactor and catches nothing a user would notice. Teams then learn to distrust it, which is worse than not having it.

The second failure is **the inverted pyramid**: a hundred slow, flaky E2E tests standing in for the fast tests nobody wrote. Every failure takes twenty minutes to investigate, half are environmental, and the suite gets retried until green — at which point it is a ritual, not a signal.

---

## 42.1 The test levels

| Level | Verifies | Speed | Reach for it when |
|---|---|---|---|
| **Unit** | Isolated logic — pure functions, reducers, validators, formatters, derivations | Milliseconds | Logic has branches worth enumerating |
| **Component** | One component's behavior through its public interface | Fast | Anything with interaction, conditional rendering, or accessible structure |
| **Integration** | Several frontend pieces together, usually with a mocked network | Moderate | A feature's real flow — form → validation → submit → result |
| **E2E** | A real user journey in a real browser | Slow | The handful of paths whose failure is unacceptable |
| **Visual regression** | Rendered appearance against a baseline | Moderate | Design-system components, layout-critical pages |
| **Accessibility** | Automated rule violations plus manual verification | Fast + manual | Everywhere; automation is necessary and insufficient |
| **Contract** | That assumed API shapes match reality | Fast | Any Level 1+ project with a backend |

**The pyramid, stated as a preference rather than a ratio:** push each test to the *lowest level that can actually catch the bug*. Validation logic belongs in a unit test, not an E2E flow. A checkout journey belongs in E2E, not simulated across forty mocked component tests. Prescribing "70/20/10" is false precision — the principle is level-fit, and the observable symptom of getting it wrong is a slow suite that fails for reasons unrelated to the change.

---

## 42.2 Testing behavior, not implementation

**The governing rule:** test what a user (or a screen reader) can perceive and do. Query by accessible role, label, and text — not by test id, class name, or component internals.

This has a benefit beyond decoupling that's worth stating explicitly: **if a test cannot find an element by its accessible name or role, the element is probably not accessible.** Behavior-driven queries make accessibility failures surface as test-writing friction, before an audit finds them.

**Assert on outcomes** — what's rendered, what the user sees, what request was sent — not on the mechanism that produced them. A test that survives an internal refactor while still catching real breakage is doing its job; one that breaks when a `useState` becomes a `useReducer` is measuring the wrong thing.

**Test ids are a fallback, not a default.** Legitimate where no accessible query exists (a decorative container, a virtualized row wrapper). Reaching for them first is how a suite becomes structure-coupled.

**Mock at the network boundary**, not at the module boundary. Intercepting HTTP (MSW or equivalent) lets the real data-fetching code, cache behavior, error paths, and loading states run — which is where the bugs are. Mocking the fetching hook itself tests that your mock returns what you told it to.

---

## 42.3 What to test — and what not to

**High value:**

- The seven request states from Department 38 — especially **error, empty, and stale**, which are the least manually exercised and the most commonly broken
- Form validation, including the invalid paths
- Conditional rendering by permission or role
- Anything with a past bug (a regression test is the highest-value test in existence — it has already proven it can fail)
- Money, dates, timezones, pluralization, i18n formatting
- Accessible structure of interactive components

**Low value, and worth actively resisting:**

- Snapshot tests of large trees — they fail on every intentional change and get regenerated without reading, which converts them into noise
- Testing library or framework behavior
- Trivial presentational components with no logic
- Coverage-driven tests written to raise a percentage

**On coverage:** it's a *discovery* metric, not a target. It tells you what is untested; it says nothing about whether what is tested is verified meaningfully. A codebase can hit 90% with tests that assert nothing. Report coverage **on critical paths specifically** rather than as a global percentage, and treat a mandated global number as a way to generate worthless tests on schedule.

---

## 42.4 Accessibility testing

**Automated tooling (axe-core and its integrations) catches roughly 30–40% of WCAG issues** — contrast, missing names, invalid ARIA, landmark structure. Run it in component tests and in CI, on every route and every interactive state (modal open, menu expanded, error shown), because a page that passes closed can fail open.

**What automation cannot detect**, and therefore must be verified manually:

- **Keyboard operability end to end** — tab to every control, operate it, escape from it. Nothing reachable by mouse only.
- **Focus management** — focus moves into a dialog on open, is trapped while it's open, and returns to the trigger on close. Route changes move focus deliberately.
- **Screen reader output** — that announcements make *sense*, not merely that names exist. A button labeled "button" passes automation and fails a user.
- **Logical reading and focus order** versus visual order — CSS can reorder visually without reordering the DOM.
- **Whether an error is announced** when it appears, not just rendered.

**Per interactive component, define and verify all six** (this is the §21 requirement made testable): mouse behavior, keyboard behavior, touch behavior, screen-reader behavior, reduced-motion behavior, and disabled/loading/error behavior.

Department 8 owns the WCAG conformance targets; this department owns the verification that they hold.

---

## 42.5 Visual regression and cross-browser

**Visual regression** catches what assertions can't: a CSS change that shifts a layout three components away. Highest value on design-system components and layout-critical pages.

*The cost to plan for:* flakiness from fonts, animation timing, image loading, and rendering differences across environments. Without discipline — freezing animations, waiting on fonts, running in a consistent containerized environment, setting a sensible diff threshold — the suite produces false positives until it's ignored. Baseline management is ongoing work; budget for it or don't adopt it.

**Cross-browser** means the three engines, not the many brands: **Chromium, Gecko (Firefox), WebKit (Safari)**. Everything else is a skin on one of these. WebKit is where the real differences live — date inputs, scroll behavior, `100vh` on iOS, backdrop-filter performance, IndexedDB quirks, and ITP's storage partitioning.

**Test on a real iOS device, not only an emulator.** iOS Safari performance and gesture behavior differ materially from a desktop simulation, and this is where the interaction-physics work from Department 15 succeeds or fails.

---

## 42.6 Contract testing — the DEVPOINT seam

**The problem:** the frontend's tests mock the API, the backend's tests mock the client, both suites pass, and the integration is broken because the mock and the reality diverged.

**The mechanism:** the frontend declares the shapes it consumes; that declaration is verified against what the provider actually returns, in CI on both sides. A backend change that breaks a consumer fails the *backend's* build, where it can still be cheaply fixed.

**Practical middle ground when full contract testing (Pact and similar) is heavier than the project warrants:** derive mock fixtures from the same schema used for runtime validation (Department 36.5), and have DEVPOINT verify responses against that shared schema. One source of truth for the shape, checked at both ends. This captures most of the value for a fraction of the setup.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Test Level Fit** | Each behavior tested at the lowest level that catches it; suite is fast and trusted; regression tests for past bugs | E2E standing in for unit tests; implementation details asserted; suite retried until green |
| **Accessibility Verification** | Automated axe in CI across routes and interactive states, plus documented manual keyboard/focus/SR passes; six behaviors defined per component | Automation only, or nothing; keyboard never tested; focus management unverified |
| **Cross-Browser Reliability** | All three engines in CI; real iOS device verification; WebKit-specific behaviors checked | Chromium only; "works on my machine"; Safari found broken by users |
| **Visual Stability** | Visual regression on design-system components with flakiness controlled and baselines owned | None, or a flaky suite everyone ignores |

## Real Measurable Targets to report

- **Coverage on critical paths**, named path by path — not a global percentage
- **Suite runtime** for the fast tiers (target: fast enough to run pre-commit without avoidance)
- **Flake rate** over the last N CI runs (target: <1%; anything higher destroys the signal)
- **axe violations: 0** across every route and interactive state, run in CI
- **Manual accessibility pass** documented: keyboard traversal, focus management, screen-reader spot-check
- **Six defined behaviors** per interactive component — mouse, keyboard, touch, screen reader, reduced motion, disabled/loading/error
- **Browser matrix** stated with engines and versions covered, plus real-device verification
- **Contract verification** in place, or the shared-schema alternative named — pass/fail
