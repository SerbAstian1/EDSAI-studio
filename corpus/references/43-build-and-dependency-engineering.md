# Department 43: Build Systems & Dependency Engineering

## Role

Owns the transformation from source to shipped artifact — bundling, transpilation, splitting, minification, source maps — and the dependency graph that artifact is assembled from, including its supply-chain risk.

**Activation: always.** Every project ships a bundle and installs dependencies. A Level 0 site with 900KB of unexamined JavaScript has a build problem regardless of how simple its interface is.

## The core failure this department exists to prevent

**Shipping a bundle nobody has looked at.** Bundle size is the one performance metric that degrades silently and continuously: every convenient dependency, every `import` written without thought, every "we'll optimize later." Nothing fails. The site just gets slower by a few kilobytes a week until it is a slow site, and no single commit is responsible.

The second failure is **treating dependencies as free.** Every package is code you did not write, executing with your application's privileges, maintained by someone you have not met, pulling in packages you have never heard of. Department 40 owns the attack surface; this department owns knowing what is actually in the graph.

---

## 43.1 What a build does

| Stage | Purpose | Tool examples |
|---|---|---|
| **Transpilation** | Modern/typed syntax → syntax the target browsers support | SWC, Babel, esbuild, tsc |
| **Bundling** | Resolve the module graph into loadable chunks | Vite/Rollup, Webpack, Turbopack |
| **Tree shaking** | Eliminate provably unused exports | Rollup, Webpack |
| **Minification** | Shorten names, drop whitespace and dead branches | esbuild, Terser, SWC |
| **Splitting** | Divide output so routes load only what they need | Bundler, driven by `import()` |
| **Source maps** | Map minified output back to source for debugging | All of the above |

**Tool selection is mostly settled and rarely worth deliberating.** Vite (Rollup for production, esbuild for dev transforms) is the default for new React/TS applications and is what Department 7's stack assumes. Webpack remains correct where a mature configuration or Module Federation is in play (Department 46). esbuild and SWC are the speed layer inside other tools more often than direct choices. Turbopack is framework-coupled. **Do not migrate a working build without a stated problem it solves** — build-tool migration is high-risk, low-visibility work that produces no user-facing benefit when it goes well.

**Transpilation target is a real decision with a real cost.** Targeting older browsers injects polyfills and downlevels syntax — `async/await` compiled for ES5 becomes a generator state machine several times its source size. Set the browserslist target from the project's *actual* analytics, and state it. Defaulting to maximum compatibility ships transformation cost to the 98% of users who did not need it.

---

## 43.2 Code splitting

The default output is one bundle containing everything, so the first route pays for the last.

**Split points, in order of value:**

1. **Route-level** — the highest-value split, nearly always correct. Each route is a `import()` boundary.
2. **Heavy components below the fold or behind interaction** — charting libraries, rich text editors, map SDKs, video players, modal contents.
3. **Vendor separation** — long-lived dependencies in a chunk with its own cache lifetime, so an application deploy doesn't invalidate React for every returning user.
4. **Conditional features** — admin-only panels, locale bundles, experiment variants.

**Tradeoffs, stated honestly:**

- **Over-splitting costs more than it saves.** Many small chunks mean many requests and a waterfall of dependent loads. Under HTTP/2 the per-request cost is lower but not zero (Department 47). Chunks below ~20KB usually aren't worth their own request.
- **A split point is a latency point.** Lazily loading a component the user reaches immediately just moves the delay to a worse moment. Split what is genuinely deferrable, then **prefetch on intent** — hover, viewport proximity, idle time — so the chunk is warm before it's needed.
- **Splitting needs a loading state and a failure state.** A chunk can fail to load (deploy mid-session, flaky network). Law 13: an error boundary with a retry, not a permanently blank region.

---

## 43.3 Tree shaking in practice

Elimination requires the bundler to *prove* an export is unused. Three things break that proof:

- **CommonJS dependencies** — dynamic by nature, not statically analyzable (Department 36.3).
- **Side effects** — a module that mutates global state on import must be kept. `"sideEffects": false` in `package.json` is a claim; when wrong, it silently strips CSS imports and polyfills. Use the array form to exempt `*.css` rather than the blanket boolean.
- **Namespace imports and re-export barrels** — a barrel file (`index.ts` re-exporting a whole feature) commonly defeats shaking, pulling in modules a consumer never touched. Barrels are an ergonomics choice with a bundle cost; measure before adopting them widely.

**Verification, not assumption:** tree shaking is claimed far more often than it happens. Check the actual output.

---

## 43.4 Dependency engineering

**Before adding any dependency, answer four questions:**

1. **What is its installed and gzipped cost**, including transitive dependencies?
2. **Could this be a function we write?** A date formatter, a debounce, a classname joiner, a deep clone (`structuredClone` is native) are usually twenty lines, not a package.
3. **Is it maintained?** Recent releases, open-issue trajectory, number of maintainers — a single-maintainer package at the center of your app is a risk to record.
4. **What is the exit cost** if it's abandoned or compromised?

**Package managers.** pnpm's content-addressed store and strict non-flat `node_modules` prevent phantom dependencies — importing a package you never declared because a transitive dep hoisted it into scope. That strictness is a genuine correctness benefit. npm and Yarn are both fine; consistency across the team matters more than the choice.

**Lockfiles are non-negotiable.** The lockfile is what makes a build reproducible: same input, same output, every machine and every CI run. It is committed, it is reviewed like code (a diff adding forty transitive packages is a review event), and CI installs with the frozen-lockfile flag so a mismatch fails the build instead of silently resolving something new.

**Semver is a convention, not a guarantee.** `^` ranges permit minor and patch updates that the publisher *believes* are compatible. Breaking changes ship in patch releases regularly. This is precisely why the lockfile exists and why frozen installs in CI matter.

**Peer dependencies** declare "I need this, but the host provides it," preventing two copies of React. Unmet peers are warnings that become runtime bugs — two React instances produce hook errors that look like framework failures.

---

## 43.5 Supply chain

The threat is direct: a dependency executes with your application's privileges, and install scripts execute on your developers' and CI machines. This section is the build-side half of Department 40's dependency-safety dimension.

| Vector | Mechanism | Mitigation |
|---|---|---|
| **Typosquatting** | Package named near a popular one | Verify names on add; lockfile review |
| **Maintainer compromise** | Credentials stolen, malicious version published | Pin via lockfile; delay adopting brand-new releases; audit diffs on major bumps |
| **Malicious install scripts** | `postinstall` runs arbitrary code at install time | `ignore-scripts` where feasible; scrutinize packages that need scripts |
| **Transitive injection** | Compromise deep in the graph, never directly chosen | Audit tooling; minimize graph depth |
| **Third-party runtime scripts** | Analytics/chat/tag-manager snippets can read the DOM and exfiltrate | SRI, CSP allowlisting, sandboxed iframes — see Department 40 |

**Practices to state in the output:** an automated audit in CI with a defined severity threshold that fails the build; a policy for how quickly high-severity advisories are patched; frozen lockfile installs; and a named owner for dependency updates. "We run `npm audit` sometimes" is not a practice.

---

## 43.6 Source maps

Source maps make production stack traces readable and are **required** for Department 45's error monitoring to be useful at all — without them, every reported error points at `chunk-a3f9.js:1:48210`.

**The security consideration:** publicly served source maps expose original source. The correct pattern is to **generate source maps and upload them to the error-monitoring service during CI, then not deploy them publicly** — full debuggability, no public source disclosure. Disabling source maps entirely is the wrong fix; it solves a disclosure concern by making production errors undiagnosable.

---

## 43.7 Bundle analysis as a standing practice

**Measure, don't assume.** Every project states its bundle composition and reports it against the Department 8 budget.

The procedure: generate a treemap of the production build; identify the largest contributors; for each, ask whether it is needed, needed *here*, or needed *now*. The three highest-yield findings, in practice, are a heavy library used for one function, a locale/icon set imported whole, and a dependency duplicated at two versions.

**Prevent regression mechanically.** A budget enforced only by good intentions is not enforced. Run a size check in CI that fails on exceeding the stated budget, and surface the per-PR delta in review. This is the only reliable defence against the slow accumulation described at the top of this file.

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Bundle Efficiency** | Composition analyzed and stated; split points justified with prefetch strategy; budget enforced in CI | Size never measured; single bundle; every dependency imported whole |
| **Build Reproducibility** | Frozen lockfile in CI; browserslist target from real analytics; deterministic output; source maps generated and uploaded, not deployed | Lockfile ignored or uncommitted; target defaulted; "works on my machine" builds |
| **Supply-Chain Safety** | Audit gate in CI with a threshold; dependency additions justified on cost and maintenance; install scripts controlled | Dependencies added freely; no audit; advisories unreviewed |

## Real Measurable Targets to report

- **Initial-route JS**, gzipped, against the project's stated budget (default 170KB — Department 8 sets the real one)
- **Largest single chunk** and its top three contributors by size
- **Total bundle** and chunk count, with the split rationale
- **Transpilation target** stated, with the analytics basis for it
- **Dependency count**: direct and transitive, plus the count of known high/critical advisories (target: 0 unremediated)
- **Lockfile committed**, CI installs frozen — pass/fail
- **Source maps** generated, uploaded to error monitoring, not publicly served — pass/fail
- **Bundle-size CI gate** present with a stated threshold — pass/fail
