# The EDSAI Scorecard
**The fixed rubric used in every department, every project, every time.**

This is what makes EDSAI quantitative instead of just verbose. Every department ends its output with scores on the dimensions below — same dimensions every time, so a score from Project A means the same thing as a score from Project B six months later. Comparability is the entire point: a fixed rubric that changes per-project isn't a rubric, it's a vibe with numbers attached.

---

## 1. How to score

Every dimension is scored **1–10**, integers only. No half-points — if you're caught between two numbers, that's a signal the work itself is unresolved, not that the rubric needs more granularity.

| Range | Meaning |
|---|---|
| 9–10 | Agency-flagship quality. Would survive scrutiny from a skeptical creative director at a top-tier shop. No notes, or only taste-level notes. |
| 7–8 | Strong, professional, ships as-is. Has a clear point of view and executes it well. Minor refinements possible but not required. |
| 5–6 | Competent but generic. Technically correct, nothing wrong, also nothing distinctive. This is the "AI slop" danger zone — functional and forgettable. |
| 3–4 | Has real problems: unclear reasoning, internal contradiction, or a decision that actively works against the brand/user. |
| 1–2 | Broken. Either absent, incoherent, or actively harmful to the goal (e.g., copy that erodes trust, UX that increases friction, motion that obscures content). |

**Every score requires a one-sentence justification.** A bare number is not a score, it's a guess wearing a number's clothes. The justification is what makes the score auditable — if you can't write the sentence, you don't actually know why you gave that number, and the score should drop until you can.

**Never default to 7.** The middle of the range is where lazy scoring hides. If a department's output is genuinely strong, say so with an 8 or 9 and defend it. If it's genuinely generic, call it a 5 or 6 — that's not an insult, it's information the Critic and Arbitration departments need to do their jobs.

---

## 2. The Universal Dimensions (scored in every department)

These four appear in **every single department's** scorecard, because they're the four ways any creative decision can fail regardless of discipline:

| Dimension | Question it answers |
|---|---|
| **Brand Fidelity** | Does this feel native to *this* brand's identity, or could it be swapped into a competitor's project with no edits? |
| **User Clarity** | Does this reduce the user's cognitive load and move them toward the goal, or does it ask them to work to understand it? |
| **Distinctiveness** | Would this look at home on a generic "AI-generated site" feed, or only in this brand's specific world? |
| **Technical Feasibility** | Can this actually be built/shipped within normal constraints, or does it require unstated heroics? |

## 3. Department-Specific Dimensions

Each department adds 2–4 dimensions specific to its discipline, defined in that department's reference file. These are listed in full in each `references/0X-*.md` file under a `## Scorecard` heading, but the canonical list is reproduced here so Arbitration can pull from one place without re-deriving it:

| Department | Specific Dimensions |
|---|---|
| 1. Brand Strategy | Positioning Sharpness, Audience Insight Depth, Differentiation Strength |
| 2. Creative Direction | Emotional Coherence, World Specificity, Cinematic Discipline |
| 3. Copywriting | Persuasion Structure, Voice Consistency, Friction-per-Word (inverse — lower is better, see below) |
| 4. UX Architecture | Flow Linearity, Decision-Point Clarity, Information Scent |
| 5. UI Design System | Hierarchy Legibility, System Consistency, Token Discipline |
| 6. Motion System | Narrative Purpose, Timing Discipline, Restraint |
| 7. Engineering | Architecture Scalability, Performance Headroom, Code Coupling (inverse) |
| 8. Perf/SEO/A11y | *Measured, not scored* — see Section 4 |
| 9. QA | *Issue-counted, not scored* — see Section 5 |
| 10. Critic | Benchmark Gap (the delta between current state and $50K-agency bar) |
| 11. Arbitration | Cross-System Coherence (the only dimension that grades how well departments agree with each other) |
| 12. Brand Ideation & Mind-Mapping | Conceptual Breadth, Strategic Traceability, Construction Clarity |
| 13. Print, Packaging & Physical Collateral | Structural Feasibility, Production Readiness, Material & Context Fit |
| 14. Poster & Composition Design | Hierarchy Clarity, Compositional Intent, Legibility at Distance |
| 15. Motion Engineering | Engine Fit, Lifecycle Safety, Motion Payload Discipline (inverse — lower payload is better) |

### Frontend Engineering Block (Departments 35–47)

Only the departments activated by `00-frontend-classification.md` report scores. Skipped departments produce no row — not a zero, not an N/A.

| Department | Specific Dimensions |
|---|---|
| 35. Browser Engineering | Runtime Understanding, Rendering Efficiency, Memory Safety, Event Handling |
| 36. JavaScript & TypeScript | Type Soundness, Runtime Boundary Discipline, Async Correctness |
| 37. State Management | State Ownership Clarity, Derivation Discipline, State Architecture Fit |
| 38. Data Fetching | Request Lifecycle Rigor, Failure Coverage, Waterfall Discipline (inverse — fewer serial dependencies is better) |
| 39. Rendering Architecture | Strategy Justification, Hydration Efficiency, Boundary Clarity |
| 40. Frontend Security | Browser Security, Authentication Safety, Input Safety, Dependency Safety |
| 41. Caching & Client Data | Freshness Policy Clarity, Invalidation Rigor, Cache Layer Fit |
| 42. Testing & Quality | Test Level Fit, Accessibility Verification, Cross-Browser Reliability, Visual Stability |
| 43. Build & Dependencies | Bundle Efficiency, Build Reproducibility, Supply-Chain Safety |
| 44. Storage & Offline | Storage Mechanism Fit, Sync Correctness, Conflict Resolution Clarity |
| 45. Frontend Observability | Error Visibility, Performance Visibility, Traceability, Production Diagnostics |
| 46. Advanced Architecture | Boundary Clarity, Governance Discipline, Complexity Justification |
| 47. Frontend Networking | Network Efficiency, Latency Awareness, Connection Resilience |

**Inverse dimensions** (Friction-per-Word, Code Coupling, Motion Payload Discipline, Waterfall Discipline): a 10 means *minimal* friction/coupling/payload/serialization, a 1 means heavy. State this explicitly next to the score so it's never misread as a normal-direction score.

### Cross-cutting engineering roll-ups

Arbitration reports these five alongside the per-department scores. Each is a **mean of the contributing dimensions above**, not a separately invented judgment — they exist so a reader can see the shape of the engineering without reading thirteen scorecards:

| Roll-up | Composed from |
|---|---|
| **Frontend Architecture** | 37 State Architecture Fit, 38 Request Lifecycle Rigor, 39 Strategy Justification, 46 Boundary Clarity, Dept 7 Architecture Scalability |
| **Browser Engineering** | 35 all four dimensions |
| **Performance** | 35 Rendering Efficiency, 39 Hydration Efficiency, 43 Bundle Efficiency, 47 Network Efficiency, Dept 7 Performance Headroom |
| **Security** | 40 all four dimensions |
| **Reliability** | 38 Failure Coverage, 44 Sync Correctness, 36 Async Correctness, 47 Connection Resilience |
| **Quality** | 42 all four dimensions |
| **Observability** | 45 all four dimensions |

If a roll-up's contributing departments were all skipped by classification, the roll-up is skipped too.

---

## 4. Real Measurable Targets (where the discipline has them)

Some departments don't just get opinions scored — they get checked against actual numeric targets that exist independent of EDSAI's judgment. These are not 1–10 scores; they're pass/fail or measured-value-vs-target, and they belong in every full pipeline run and in any scoped request that touches that department:

| Discipline | Real-world targets to report against |
|---|---|
| **Performance (Core Web Vitals)** | Lighthouse Performance ≥90, LCP <2.5s, INP <200ms, CLS <0.1 — plus supporting metrics where diagnosis requires them: FCP, TTFB, Total Blocking Time, longest task duration, main-thread JS execution time |
| **Bundle** | Initial-route JS (state actual KB gzipped against the project's stated budget, default 170KB), largest single chunk, count of render-blocking resources, hydration payload for SSR routes |
| **Runtime** | Number of long tasks (>50ms) on the critical interaction path, detached-DOM growth across a navigation cycle, listener/subscription cleanup verified per component with side effects |
| **Security** | CSP present and free of `unsafe-inline` in script-src (or nonce/hash-based), token storage mechanism named with its tradeoff, `HttpOnly`/`Secure`/`SameSite` stated per cookie, dependency audit result (count of known high/critical advisories) |
| **Caching** | Per dataset: freshness window, invalidation trigger, and staleness tolerance stated as an actual policy, not "cached appropriately" |
| **Accessibility** | WCAG 2.1 AA conformance (state per-criterion pass/fail for the ones that matter most: contrast, focus order, alt text, semantic landmarks), contrast ratio numbers (state the actual ratio, e.g. "4.6:1" against the 4.5:1 AA text minimum) |
| **SEO** | Title tag length (50–60 char target), meta description length (150–160 char target), heading hierarchy validity (single H1, no skipped levels), structured data presence |
| **Typography** | Actual type scale ratio used (e.g. 1.25 Major Third, 1.333 Perfect Fourth) stated explicitly, line-height values, line-length in characters (45–75 char target for body copy) |
| **Color** | Exact contrast ratios for every text/background pairing actually used, not just "looks fine" |
| **Motion** | Actual duration/easing values used (e.g. "240ms, cubic-bezier(0.16, 1, 0.3, 1)"), not just "feels smooth" |
| **Copy/Conversion** | Estimated reading level (Flesch-Kincaid grade), CTA-to-content ratio, above-the-fold message clarity (can the value prop be stated in one sentence from what's visible without scrolling?) |

**Budgets are per-project, not universal.** The numbers above are defaults for a typical marketing or application route on a mid-tier mobile device. A project with a different audience gets different budgets — a data-visualization tool for desktop analysts and a booking flow for 3G feature phones cannot share a JS budget. Set the budget explicitly at the start of Department 8 (initial JS, hero asset ceiling, LCP/INP/CLS targets, animation smoothness under expected device conditions), justify it against the real audience's devices and networks, then measure against *that* number. Never silently inherit a default that the project's actual constraints contradict.

If a number can't be measured directly (no live site to run Lighthouse against, for instance), state the **target** and the **design decision that was made to hit it** (e.g. "Target: LCP <2.5s. Decision: hero image is a compressed AVIF served at the exact display dimension, no client-side resize, font-display: swap to avoid render-blocking"). A target without a stated mechanism for hitting it is just a wish.

---

## 5. Issue Counting (QA Department)

QA doesn't use the 1–10 scorecard. It produces a severity-ranked issue count:

| Severity | Definition | Target for FINAL |
|---|---|---|
| **Blocker** | Breaks core function or core message | 0 |
| **Major** | Undermines brand, UX, or conversion meaningfully | 0 |
| **Minor** | Polish-level, would be caught by a careful second pass | Document, doesn't block FINAL |
| **Nitpick** | Taste-level, debatable | Log only, no action required |

A FINAL output with any open Blocker or Major issue is not actually final — it's V-next-minus-one wearing a FINAL label.

---

## 6. Aggregate Scoring (Final Arbitration)

When all departments have reported, Final Arbitration computes and states:

- **Mean score across all Universal Dimensions** (the 4 dimensions × however many departments scored them)
- **Lowest-scoring department and dimension** (named explicitly — this is the system's known weak point, and pretending otherwise defeats the purpose of scoring at all)
- **Aggregate measured-target pass rate** (e.g. "5 of 7 real-world targets met; LCP and contrast ratio both miss target, see department 8 for remediation")

State the aggregate even when it's mediocre. A scorecard that only gets reported when it flatters the output isn't a scorecard, it's marketing copy with footnotes.

---

## 7. Downstream of Arbitration: Score-Drift Audit & Client Summary

Two more steps run after this scorecard closes, detailed in `09-client-summary-and-score-audit.md`:

- **Score-Drift Self-Audit** — a mechanical clustering check run *before* Department 11 finalizes, verifying "never default to 7" was actually followed rather than just stated.
- **Client-Ready Summary Mode** — a separate, short, jargon-free artifact produced *after* FINAL, for presenting to the actual client rather than internal use.

Neither changes the rubric above; both consume its output.
