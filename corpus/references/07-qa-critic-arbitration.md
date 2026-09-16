# Department 9: Quality Assurance System
# Department 10: Agency Critic System
# Department 11: Final Arbitration System

These three close the loop: QA finds what's broken, the Critic judges what's mediocre, Arbitration decides what ships.

---

# DEPARTMENT 9 — QUALITY ASSURANCE SYSTEM

## Role

Full system validation across every upstream department. QA's job is not taste — it's correctness and consistency. A QA pass that says "looks great!" has failed at being QA.

## This department uses Issue Counting, not the 1–10 scorecard

Per `00-scorecard.md` Section 5: every issue found gets logged with a severity.

| Severity | Definition | Target for FINAL |
|---|---|---|
| **Blocker** | Breaks core function or core message | 0 |
| **Major** | Undermines brand, UX, or conversion meaningfully | 0 |
| **Minor** | Polish-level, a careful second pass would catch it | Document, doesn't block |
| **Nitpick** | Taste-level, debatable | Log only |

## Validation Checklist — go through each, looking for cross-department breaks

- **UX integrity**: does the actual copy/UI match the journey map from Department 4, or did later departments quietly drift from it?
- **UI consistency**: does every component instance match its Department 5 definition (states, spacing, tokens)?
- **Copy correctness**: typos, broken claims, CTAs that don't match what actually happens on click, tone drift from the Department 2 voice
- **Motion behavior**: does stated motion (Department 6) actually have the fallback behavior for reduced-motion users? Any animation that wasn't justified by a "reveals/guides/feedback" purpose?
- **Responsiveness**: does the design system's grid/type scale actually function at mobile/tablet/desktop breakpoints, or was it only reasoned about at one width?
- **Technical correctness**: do the component contracts from Department 7 actually match what Department 5 specified? Any orphaned design tokens (defined but never used) or undefined ones (used in code but never specified)?

## Frontend Engineering Audit *(conditional)*

**Audit only the departments the Frontend System Classification activated** (`00-frontend-classification.md`). This is a hard rule: a static marketing site does **not** FAIL for lacking WebSocket reconnection, an offline queue, or distributed tracing. Inapplicable checks are skipped **silently** — not listed as failures, not listed as N/A rows.

The converse also binds: a project that claimed Level 3 and skipped the real-time module's ordering and duplicate-event reasoning **does** fail. Having claimed a level, the work is held to it.

### Browser *(Dept 35 — always)*
- Rendering-pipeline cost understood for animated and interactive surfaces; no layout-triggering animation
- Main-thread bottlenecks identified; no long tasks on the critical interaction path
- Layout thrashing avoided — reads and writes batched in scroll/resize/animation code
- Memory: every listener, timer, observer, subscription, and animation instance has a teardown

### React *(Dept 7 — always)*
- Component boundaries follow reasons-to-change, not line count
- Every effect justified as synchronization with something outside React; none merely syncing state from state
- Cleanup implemented on every effect that creates something
- Stale closures addressed by dependencies or refs, not by disabling the lint rule
- Keys are stable data identities, never array indices in reorderable lists
- Memoization applied where profiled or identity-critical, not by default

### State *(Dept 37 — Level 1+)*
- State ownership and source of truth stated per significant piece of state
- Server state separated from client state and managed as such
- Derived values computed, not stored and synced
- URL-eligible state actually in the URL
- Multi-writer cases decided: tabs, optimistic rollback, concurrent edit, back-navigation

### Data *(Dept 38 — Level 1+)*
- All seven request states designed per async surface — loading, success, **empty**, error, **stale**, offline, partial failure
- Cancellation on unmount and supersession; retries limited to idempotent operations with backoff
- Race conditions handled — an older response cannot overwrite newer state
- Failure-mode checklist answered for each critical interaction
- API contract inventoried, each item marked *agreed with DEVPOINT* or *assumed*
- *(Level 3+)* reconnection backoff, heartbeat, backfill, duplicate and ordering strategy stated

### Rendering *(Dept 39 — always)*
- Strategy stated per route group with the requirement that drove it
- Hydration warnings: 0
- Server/client boundary shallow and serializable where Server Components are in use

### Security *(Dept 40 — Level 1+, baseline at Level 0)*
- Token storage mechanism named with its tradeoff; no long-lived credentials in `localStorage` without recorded risk acceptance
- XSS: every raw-HTML sink inventoried and sanitized at render
- CSRF control on every cookie-authenticated state change
- CORS configuration reviewed; no origin-reflection with credentials
- CSP specified without `unsafe-inline` in `script-src`
- Third-party scripts inventoried with owner and capability

### Performance *(Dept 8 + 43 — always)*
- Core Web Vitals reported against the project's stated budget, with field data where available
- Bundle composition analyzed; initial-route JS within budget; CI size gate present
- Image and font delivery: format, sizing, subsetting, `font-display`
- Hydration cost measured where server rendering is in play

### Caching *(Dept 41 — Level 2+, HTTP baseline always)*
- Freshness tolerance, window, invalidation trigger, and authoritative layer stated per dataset
- Cache keys include all inputs including user identity; cache cleared on logout
- Hashed assets immutable; HTML revalidating
- *(SW)* strategy per resource class; kill switch exists and is tested

### Accessibility *(Dept 8 + 42 — always)*
- WCAG 2.1 AA checklist complete with no unremediated failures
- Keyboard traversal verified manually, end to end
- Focus management: dialogs trap and restore; route changes move focus
- Six behaviors defined per interactive component
- axe: 0 violations across routes and interactive states, in CI
- Reduced motion honored per motion event

### Observability *(Dept 45 — Level 1+, production-facing)*
- All four error sources captured, including unhandled rejections
- Source maps uploaded, not publicly served
- Field performance monitored at p75 and segmented
- Critical flows observable; alerts tied to user impact
- No sensitive data in error context, breadcrumbs, or replay

### Offline *(Dept 44 — Level 4+)*
- Queue durable, idempotent, ordered, bounded; replay failures surfaced
- Conflict strategy named per dataset with its data-loss implications
- Storage-unavailable behavior defined

### Architecture *(Dept 46 — Level 5)*
- Package boundaries enforced by tooling, not convention
- Design system versioning model, contribution bar, and deprecation policy stated
- Six justification questions answered per adopted pattern, simpler alternative rejected with reason

**Severity guidance for engineering issues.** A missing error state on a primary flow, an unhandled race that corrupts data, a credential in `localStorage`, an unsanitized HTML sink, or a keyboard-inoperable control are **Blockers or Majors** — they are product failures, not polish. An unmeasured bundle, an absent CI gate, or missing observability on a non-critical flow is typically **Major or Minor** depending on whether the project is shipping to production.

## Working Method
For each issue found, log: **what's broken → which department(s) it traces back to → severity → fix recommendation**. An issue with no traced origin department is a symptom without a diagnosis — keep digging until you know where it actually came from, because that's what determines whether Arbitration sends it back for revision or just patches it locally.

## Output
A severity-ranked issue list with fix recommendations, plus the aggregate counts (e.g. "0 Blockers, 1 Major, 4 Minor, 2 Nitpicks") that feed into Final Arbitration's FINAL/not-FINAL determination.

---

# DEPARTMENT 10 — AGENCY CRITIC SYSTEM

## Role

Ruthless evaluator. No bias, no diplomatic softening, only an honest read against the world-class bar. This department exists specifically to counteract the natural drift toward self-congratulation that happens when the same system that produced the work also reviews it.

## The core failure this department exists to prevent

**Grading on a curve against "pretty good for AI output" instead of against actual agency-flagship work.** The Critic's reference point is real $50K–$100K agency deliverables — Apple, Stripe, Linear, Vercel-tier craft — not "better than a template."

## Responsibility
- Benchmark the full system against world-class agency work, by name where useful (e.g. "the hero's information reveal is paced like a typical SaaS template, not like Linear's restraint")
- Identify weaknesses without softening — if something is generic, say "this is generic" rather than "this could be elevated further"
- Reject mediocre output outright rather than rating it as acceptable-with-notes
- Force redesign if the gap to world-class is structural, not cosmetic

## The $50K Agency Benchmark Test
For each major department's output, ask explicitly: **"would this survive a skeptical creative director's review at a $50K+ agency, or would it get sent back with 'this is fine, but it's not why someone pays us $50K instead of using a template'?"**

State the answer directly — yes, survives; or no, here's specifically why not — for each major area (strategy, creative direction, copy, UX, UI, motion, engineering).

## Rule
**No approval without critique.** Every department gets a critique pass even if the work is strong — "this is strong, here's the one place it could still be sharper" is still a critique. A department that receives zero critique notes either is genuinely flawless (rare, name it explicitly as a real judgment, not a skip) or wasn't actually reviewed.

## Scorecard

Score one dimension, against the Universal Dimensions framework but applied as a gap measure:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Benchmark Gap** *(10 = no gap to world-class)* | Indistinguishable from real flagship agency work in craft and specificity | Reads as competent-AI-generated, not agency-authored |

State the Benchmark Gap score **per major department**, not just once globally — a project can be a 9 on Creative Direction and a 5 on Engineering, and burying that under one global number hides exactly the information Arbitration needs.

---

# DEPARTMENT 11 — FINAL ARBITRATION SYSTEM

## Role

Final authority. Resolves conflicts between departments, unifies the separate outputs into one coherent system, and makes the actual ship/no-ship call.

## The core failure this department exists to prevent

**Averaging instead of choosing.** If Department 2 wants maximal kinetic energy and Department 6 (constrained by Department 8's performance budget) can't deliver heavy motion without blowing the JS budget, the answer is not "let's do medium motion" — that satisfies neither vision. The answer is to pick the strongest strategic direction and have every other department serve it.

## Responsibility
1. **Surface conflicts explicitly** — name every place two departments' outputs are in tension (a strategy demanding maximalism vs. a performance budget demanding restraint; a UX flow demanding one CTA vs. copy proposing two competing ones).
2. **Resolve by strategic strength, not averaging** — for each conflict, state which direction better serves the Department 1 positioning and audience psychology, and commit to it fully. Document what's lost by not averaging (because something usually is) and why that loss is worth it.
3. **Unify into one coherent deliverable** — the FINAL output should read as if one disciplined mind made every decision, not as eleven independently-reasonable opinions stapled together.
4. **Make the FINAL determination** — using QA's issue counts (Department 9) as a hard gate: any open Blocker or Major issue means this is not yet FINAL, regardless of how good everything else scored.

## Aggregate Scoring (per `00-scorecard.md` Section 6)

State explicitly:
- **Mean score across all Universal Dimensions**, computed across every department that scored them
- **Lowest-scoring department and dimension**, named directly — this is the system's known weak point and should be stated plainly, not buried
- **Aggregate measured-target pass rate** from Department 8 (e.g. "6 of 8 targets met")
- **Cross-System Coherence** score (1–10): does the final system feel authored by one voice, or do the seams between departments show?

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Cross-System Coherence** | Reads as one disciplined authorial voice across strategy → code | Visibly stitched together; departments solved their own problems without regard to neighbors |

## Versioning Output

Label outputs explicitly:
- **V1 — Initial Draft**: the first full pass through all 11 departments
- **V2 — Internal Revision**: after the Department 9/10 critique pass surfaces issues, the corrected version
- **FINAL — Approved System**: only reached once Department 9 shows 0 Blockers/0 Majors and Department 11 has explicitly resolved every surfaced conflict

For substantial full-pipeline projects, show this versioning explicitly (V1 → revision notes → FINAL) so the reasoning is visible. For smaller scoped asks, this pass can happen silently — deliver the already-revised version — but it should still happen.

## Optimization Priority Order

When revising, fix in this order (earlier items have larger leverage on outcome than later ones, so fix them first even if a later-order issue is more visually obvious):

1. UX clarity
2. Conversion effectiveness
3. Brand alignment
4. Visual hierarchy
5. Motion refinement
6. Code efficiency

## Rule
If departments disagree, **do not average. Choose the strongest strategic direction and commit.**
