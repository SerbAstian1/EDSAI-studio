# Department 46: Advanced Frontend Architecture

## Role

Owns frontend structure at the scale where the binding constraint stops being technical and becomes **organizational** — multiple teams, multiple applications, shared component libraries, independent deployment cadences.

**Activation: Level 5 only.** This is the most conditional department in EDSAI. A direct scoped question about any topic here still gets a full answer regardless of project level; what the gate prevents is these patterns appearing *unprompted* in a project that doesn't have the problem they solve.

## The core failure this department exists to prevent

**Adopting an organizational solution for a technical-sounding reason.** Every pattern in this file was invented to let teams that must coordinate stop coordinating. Applied by a single team, they impose the coordination cost of a structure that solves a problem that team doesn't have — a runtime integration layer, version skew across independently deployed bundles, duplicated dependencies, and a debugging story that spans repositories.

> **Complexity must earn its place.** Law 12.

The honest question before anything below: *is the current pain a team-coordination pain?* If the answer is "our build is slow" or "our components are inconsistent," those have much cheaper fixes than anything in this file.

Before activating any pattern here, answer the six justification questions in `00-frontend-classification.md` §3 and record the answers.

---

## 46.1 Monorepos

Multiple packages in one repository with shared tooling and atomic cross-package commits.

**What it genuinely solves:** a change spanning a design system and three consumers lands as one reviewable commit; one lint/test/TS configuration instead of six drifting copies; refactors that cross package boundaries are mechanical instead of choreographed across repos.

**Cost:** CI must be smart about what changed or every push builds everything; tooling (Turborepo, Nx, workspaces) is a dependency with its own learning curve; and version boundaries become blurry — it is easy to import across packages in ways that erase the boundaries you created the packages for.

**Appropriate when:** several packages change together regularly, shared code exists, one team or several closely-coordinated teams.
**Not appropriate when:** genuinely independent products with separate release cycles and no shared code.
**Complexity introduced:** build orchestration, remote caching, task graphs, boundary enforcement.
**Failure modes:** CI time growth without affected-detection; boundary erosion through deep imports; one team's broken main blocking everyone.
**Simpler alternative:** separate repos with a published shared package — correct when sharing is genuinely small and stable.

**Package boundaries are the actual deliverable.** A monorepo without enforced boundaries is a large folder. Define the dependency direction (shared → feature → app, never upward), enforce it with tooling rather than convention, and give each package a real public surface rather than allowing deep imports into internals.

---

## 46.2 Design system architecture

The engineering half of what Department 5 designs. Department 5 owns tokens, type scale, color, and component semantics; **this department owns how they ship, version, and get governed.**

**Layering, which should be visible in the package structure:**

```text
Tokens         →  primitives: color, space, type, radius, motion
Primitives     →  Button, Input, Text — no product knowledge
Patterns       →  composed: DataTable, Form, Modal
Product        →  app-specific, lives with the app
```

**Tokens ship as data, not as code.** A platform-neutral source (JSON or similar) generating CSS variables, TypeScript constants, and native equivalents keeps one source of truth. Tokens defined directly in a stylesheet cannot serve a second platform, and tokens duplicated per platform drift within a quarter.

**Versioning is where design systems actually fail.** The two viable models:

- **Fixed/locked** — everything versions together. Simple, forces consumers to upgrade in lockstep.
- **Independent** — packages version separately. Flexible, and consumers end up on five different versions of the same primitive.

Either is workable; **not choosing** is what produces a system where nobody knows which version anyone is on. Semver on a component library needs an explicit definition of "breaking": a changed visual default is a breaking change to a consumer even though the prop signature is identical. Say so in the policy.

**Governance is the unglamorous part that determines success.** Define: who may add a component, what the bar is (documented, tested, accessible, tokenized), how a consumer requests a change, and how deprecation is communicated and enforced. **A design system with no governance becomes a component graveyard** — three buttons, two of them deprecated, none of them removable.

**Documentation is part of the product.** Storybook or an equivalent, showing every variant, state, and accessibility note. An undocumented component gets reimplemented locally, which is how a design system loses to copy-paste.

---

## 46.3 Microfrontends

Independently developed and deployed frontend applications composed into one user-facing experience.

> **Microfrontends are an organizational and architectural solution, not a default frontend architecture.**

**The one problem they solve:** multiple teams needing to deploy to the same user-facing surface without coordinating releases. That is a real problem at real organizations, and when you have it, nothing else solves it as well.

**The costs, which are consistently understated:**

- **Duplicated dependencies.** Each app ships its own framework unless sharing is configured — and shared singletons then introduce version-skew risk in exchange.
- **Version skew.** Independently deployed apps must interoperate across versions, including combinations nobody tested.
- **Cross-app state and routing.** Both become integration problems requiring explicit contracts. Shared auth state is the usual first casualty.
- **Consistency erosion.** A shared design system becomes the only thing preventing visual drift, which makes §46.2 a prerequisite, not a companion.
- **Debugging across boundaries**, in production, at runtime.
- **Aggregate performance.** Each app's bundle is reasonable; the page's total is not, and no single team owns it.

**Integration approaches:** build-time (packages — simplest, but loses independent deploy, which was the point), **runtime via Module Federation** (the common answer; shared dependency config is where the difficulty lives), iframes (strongest isolation, worst UX and communication), and edge/server composition.

**Appropriate when:** many teams, independent release cadences, clear vertical domain boundaries, and organizational commitment to the platform work.
**Not appropriate when:** one team; a project that "might scale later"; or a codebase whose real problem is poor internal modularity, which microfrontends will distribute rather than fix.
**Complexity introduced:** runtime integration, dependency sharing, version compatibility, cross-app contracts, a shared platform team.
**Failure modes:** skew breakage, bundle bloat, inconsistent UX, "distributed monolith" where independent deploys are impossible in practice.
**Simpler alternative:** a modular monolith with enforced package boundaries in a monorepo, which delivers most of the ownership benefits and none of the runtime integration cost. **Try this first, nearly always.**

---

## 46.4 Backend-for-Frontend

A thin service owned by the frontend team, aggregating and shaping backend services for one client.

```text
Browser
   ↓
  BFF        ← owned by the frontend team
   ↓
Multiple Backend Services
```

**Solves:** request waterfalls from composing several services client-side; over-fetching, by shaping responses to what the UI renders; keeping secrets and tokens off the client; and giving the frontend team a contract they control rather than negotiate.

**Cost:** it is a service — with deployment, monitoring, on-call, and latency of its own. It can become a second backend with business logic that belongs elsewhere. And ownership must be genuine: a BFF the frontend team cannot deploy is just another backend with an extra hop.

**Appropriate when:** multiple services must be composed per view, different clients need materially different shapes, or credentials must stay server-side.
**Not appropriate when:** there is one backend already returning appropriate shapes — then it is a proxy with a maintenance cost.
**Complexity introduced:** a deployed service, another failure domain, another observability surface.
**Failure modes:** becoming a monolith; becoming unowned; adding latency without removing round trips.
**Simpler alternative:** composite endpoints on the existing backend (a DEVPOINT Department 17 conversation), or GraphQL if the shaping problem is genuinely broad.

**Boundary note:** a BFF sits exactly on the EDSAI ↔ DEVPOINT line. EDSAI specifies what it returns and owns its contract; **DEVPOINT owns operating it** — deployment, scaling, monitoring. Agree that split before building one.

---

## 46.5 Deployment strategies for frontends

Frontend deploys are cheap to ship and easy to get wrong in ways users feel.

- **Preview deployments** per PR — the highest-value practice here, and cheap. Design review, stakeholder sign-off, and visual regression all get a real URL.
- **Rollback** must be immediate and rehearsed. Frontend rollback is usually just re-pointing at a previous immutable build; verify it works before you need it.
- **Canary / blue-green** — progressive exposure. Note the frontend-specific wrinkle: users with an old HTML document requesting chunks that a new deploy removed. **Keep old chunks available across deploys**, and pair with the chunk-load error boundary from Department 43.
- **Feature flags** decouple deploy from release and are the best mechanism for de-risking large frontend changes. They also accumulate: an unremoved flag is permanent branching complexity. Every flag gets an owner and a removal date at creation.

Infrastructure operation is DEVPOINT's (Department 22); the frontend-visible requirements above are this department's specification.

---

## 46.6 Canonical architecture diagrams

Use plain-text diagrams **when complexity genuinely warrants them** — one that restates a two-line description is padding. These are the canonical forms referenced from SKILL.md:

**System shape:**

```text
                    Browser
                       │
          ┌────────────┼────────────┐
          │            │            │
         UI          State        Router
          │            │            │
          └────────────┼────────────┘
                       │
                  Data Layer
                       │
                ┌──────┴──────┐
                │             │
             REST API      WebSocket
                │             │
                └──────┬──────┘
                       │
                    DEVPOINT
```

**Load path** (for performance diagnosis):

```text
User → DNS → CDN → HTML → CSS/JS → Parse → Execute
     → Render → Hydrate → Interactive
```

**Trace correlation** (for cross-system debugging):

```text
User Interaction → Browser Trace → HTTP Request
                 → Backend Trace → Database
```

---

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Boundary Clarity** | Package boundaries and dependency direction enforced by tooling; cross-app contracts explicit; BFF ownership split agreed | Boundaries by convention only; deep imports; ownership undefined |
| **Governance Discipline** | Design system has a stated versioning model, contribution bar, deprecation path, and documentation | Components added freely; version model undecided; graveyard of deprecated variants |
| **Complexity Justification** | The six classification questions answered and recorded; simpler alternative named and specifically rejected | Pattern adopted on reputation; no measured problem; no exit plan |

## Real Measurable Targets to report

- **Classification: Level 5 confirmed**, with the organizational constraint that makes it so
- **Six justification questions** answered and recorded per adopted pattern
- **Simpler alternative named and rejected with a reason** per pattern
- **Package dependency graph** with the enforced direction, and the count of boundary violations (target: 0)
- **Design system**: versioning model stated, "breaking change" defined, documentation coverage per component, deprecation policy
- *(microfrontends)* **Shared dependency strategy**, version compatibility policy, and **aggregate page bundle size with a named owner**
- *(BFF)* **Ownership split with DEVPOINT** stated for contract vs operation
- **Preview deployments** per PR, **rollback rehearsed**, **old chunks retained across deploys** — pass/fail
- **Feature flag inventory** — each with an owner and a removal date
