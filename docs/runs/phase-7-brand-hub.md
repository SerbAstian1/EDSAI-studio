# Run — Phase 7 Brand Hub

**Scope:** scoped run, 8 producing departments plus the closing loop.
**Executed:** Claude Code directly, in the manner of harness mode. The engine is
not in this repository, so this run has **no engine record and no run id**.
**Determination: V1** — three Majors open. FINAL is unreachable.

> **Every target below is `stated-target`, never `instrument`.** The Phase 1
> instruments are not in this repository, so no value here was computed. The
> corpus's own rule applies — state the target and the design decision made to
> hit it — and the verifier would strip any asserted actual. When Phase 1 is
> rebuilt, this run should be re-executed so the numbers become real.

---

## Frontend System Classification

**Frontend System Level: 0 — Static Interface.** The brand hub is a generated,
content-dominant page, read by unauthenticated visitors, with isolated
interactivity: copy-to-clipboard, section tabs, and a file download.

**This is not the Studio's classification, and the difference is the point.** The
Studio is Level 1 — an authenticated workspace with live run state, streamed
output and server-state caching. The hub is a build artifact with none of those.
Treating them as one system would drag the Studio's CSR shell and its 170 KB
budget onto a page that is fundamentally a document.

**Activates:** 35 (browser fundamentals), 36, 39 (rendering decision), 43
(build/bundle), plus baseline slices of 40 (XSS/CSP), 41 (HTTP/CDN caching) and
47 (request path). 37, 38, 42, 44, 45, 46 do not activate.

**Interaction Physics: not active** — the hub has no gesture-driven surface.
Copy buttons and tabs are watched motion on Department 6's duration table.

---

## Department 1 — Brand Strategy Intelligence

**Positioning.** The brand hub is the only EDSAI artifact a client's whole
organisation touches. Everything else in the pipeline is read once by one or two
people; the hub is opened weekly by whoever is making a deck. Its position is
therefore not "the deliverable" but **the brand's working surface** — and, for
the studio, the standing proof that the work was rigorous rather than merely
attractive.

**Audience — three readers, different needs, same page.**

| Reader | Comes for | Leaves if |
|---|---|---|
| The client's marketing team | a hex code, a logo file, fast | they have to read to find it |
| An external agency or freelancer | the rules, and permission to proceed | the rules are ambiguous enough to need a call |
| The client's executive | evidence the money bought something | it reads as a swatch page |

The third reader is the one every brand hub forgets, and the one the measurement
layer serves without any extra work.

**Differentiation.** "Accessible palette" is a claim every competitor makes. A
measured ratio, stated against what it was measured on, is a claim only a system
that computes it can make. The moat is not the hub; it is the fourteen
instruments behind it.

*Assumption (unvalidated):* the three-reader model is inferred from the
DesignerHQ transcript and ordinary studio practice, not from research with any
actual client.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 7 | Every decision traces to the corpus, but EDSAI's own identity has never been run (§13 Q6), so "native to this brand" has no brand to be native to yet. |
| User Clarity | 8 | Three readers named with distinct entry needs and distinct failure conditions. |
| Distinctiveness | 8 | Measurement-as-product is genuinely unoccupied in this category. |
| Technical Feasibility | 8 | A build-time renderer over an existing run record; the novelty is in what it renders, not how. |
| Positioning Sharpness | 8 | "The brand guidelines that prove their own compliance" is one sentence and survives a competitor swap. |
| Audience Insight Depth | 7 | Three readers is more than most hubs consider, but the model is inferred rather than researched. |
| Differentiation Strength | 9 | A competitor cannot assert their way to this; they would have to build the instruments. |

---

## Department 2 — Creative Direction & World Design

**The central tension.** The hub displays *someone else's identity*. Any strong
creative voice in the chrome competes with the brand it hosts — and the client's
brand must win that competition every time. So the hub's own world is
deliberately quiet.

**Composition structure** (named from the catalog, per the shared requirement):
the page is **Patterns & Repetition** — a repeated section band, consistent in
rhythm and spacing — with the hosted brand's own hero as **the deliberate break
in the pattern**, which is what makes it the focal point. The chrome establishes
rhythm precisely so the brand can interrupt it.

Within a section, **Horizontal Lines**: stacked bands, read as calm and stable,
the correct line direction for a reference document that must feel
authoritative rather than kinetic.

**Where this is weak, and it is.** "Neutral host" is a constraint, not a world.
Department 2's job is a universe specific enough to art-direct from, and a
deliberately recessive chrome cannot deliver one. This is the same failure the
original self-run recorded against Department 5, reappearing one department
earlier. It is scored accordingly rather than argued away.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 6 | The hub must host any brand, so its fidelity is to a method rather than an identity. |
| User Clarity | 8 | Recessive chrome is the correct call for a document whose content is someone else's brand. |
| Distinctiveness | 6 | Chrome designed to recede is by definition not distinctive; the distinctiveness sits in the data. |
| Technical Feasibility | 9 | A quiet system of bands is the cheapest thing to build well. |
| Emotional Coherence | 7 | Calm, authoritative, evidence-forward — coherent, if narrow. |
| World Specificity | 5 | There is no world here. "Neutral" is an absence, and this department exists to prevent exactly that. |
| Cinematic Discipline | 7 | Restraint is deliberate and consistent, but restraint alone is not direction. |

---

## Department 4 — UX Architecture

**Journey.** No sequence is imposed: a reference document that forces a path is
broken. All three readers land on a section index, and the colour section is
reachable in one action from anywhere because it is the most-used surface by a
wide margin.

**Decision points.** Three affordances, deliberately distinct in weight so they
are never confused: *copy* (a value, instant, no confirmation), *download* (a
file, an explicit act), *read* (a rule, prose). Making copy the lightest and
download the heaviest matches their frequency and their consequence.

**Information scent.** Section labels are nouns the reader already uses — Colour,
Logo, Type, Layout — not EDSAI's department numbers. The pipeline's vocabulary is
internal and does not leak into the client's surface.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 7 | Structure serves the hosted brand rather than expressing EDSAI's. |
| User Clarity | 9 | Three readers, three affordances, no imposed sequence, most-used section always one action away. |
| Distinctiveness | 6 | The information architecture is conventional, correctly — a reference document is not where to be surprising. |
| Technical Feasibility | 9 | Static sections with anchor navigation. |
| Flow Linearity | 8 | Deliberately non-linear, which is right for reference; scored on fitness, not straightness. |
| Decision-Point Clarity | 9 | Copy, download and read are separated by weight as well as by label. |
| Information Scent | 8 | Client vocabulary throughout; the department numbers stay internal. |

---

## Department 5 — Interface Design System

**The hosting problem drives the token architecture.** The hub renders the
client's colours and type *as content* while needing its own colours and type as
chrome. Any collision reads as a bug in the client's brand, which is the worst
possible failure for this artifact.

**Resolution:** all hub tokens are namespaced custom properties (`--edsai-hub-*`)
and brand values are injected as data, never as global styles. Shadow DOM would
give true isolation and was rejected on cost — see Conflict 3.

**Provenance rendering is the system's most important component**, and it is
underspecified. A measured value and a stated target must be visibly distinct at
a glance, without a legend, in a page where both appear side by side. The spec
currently says "visibly distinct" and stops. That is a gap, not a decision.

**Optical Precision.** The provenance annotations are the smallest text on the
page and carry the most important information. Tracking and leading must be
stated for that tier specifically and must move inversely with size — which
cannot be finalised until the type-scale instrument runs.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 6 | The system's job is to disappear behind a brand it does not know in advance. |
| User Clarity | 8 | Content and chrome are separated structurally, so a reader never mistakes one for the other. |
| Distinctiveness | 5 | A deliberately recessive system, inheriting Department 2's weakness directly. |
| Technical Feasibility | 8 | Namespaced properties are cheap; the provenance component is the only real design work. |
| Hierarchy Legibility | 7 | The brand's content dominates by construction, but the provenance tier's weight is unresolved. |
| System Consistency | 8 | One section band, one card, one provenance component, used everywhere. |
| Token Discipline | 9 | The hosting problem makes orphan values structurally impossible — a constraint doing real work. |
| Optical Precision | 6 | The tier that matters most is the one whose tracking and leading are still unstated. |

---

## Department 39 — Rendering Architecture

**Decision: islands / partial hydration.** Stated, with the alternatives priced.

The corpus's own cost table settles this. The hub is content-dominant with
isolated interactivity — exactly the profile it names for islands, and exactly
where it warns that "a page where everything is interactive gains nothing" does
not apply.

- **SSG alone** — nearly right, and the fallback. Fails only because copy buttons
  and tabs need *some* JS; islands are SSG that admits this.
- **CSR** — wrong. "The worst possible LCP path on slow devices," for a page
  whose content is fixed at build time and read on a phone in a meeting.
- **SSR / streaming SSR** — buys a server and a hydration bill for content that
  never varies by request.
- **ISR** — solves a staleness problem the hub does have (QA-1), but at the wrong
  layer. Regeneration is a publish action, not a revalidation window.

**Boundary:** every section renders static; only the copy button, the tab
control and the download trigger hydrate. Nothing above the fold hydrates at all.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 6 | A rendering strategy is brand-neutral; scored on fitness to the artifact. |
| User Clarity | 8 | Content paints without waiting on JS, which is the whole reader experience. |
| Distinctiveness | 7 | Islands for a brand hub is a better-reasoned default than the category's habitual CSR. |
| Technical Feasibility | 9 | Well-trodden; several generators do this out of the box. |
| Strategy Justification | 9 | Chosen against the corpus's own cost table with four alternatives priced and rejected on stated grounds. |
| Hydration Efficiency | 9 | Three interactive controls hydrate; nothing else does. |
| Boundary Clarity | 8 | The static/interactive line is drawn per component and is easy to hold. |

---

## Department 40 — Frontend Security Engineering

Baseline slice at Level 0, plus one surface that is not baseline at all.

**The embedded-tools iframe is the real hole.** Phase 7 inherits DesignerHQ's
pattern of embedding vibe-coded tools by URL. On a client-branded domain, an
unsandboxed iframe is arbitrary third-party code running next to the client's
identity. Required: `sandbox` with an explicit allowlist, no
`allow-same-origin` with `allow-scripts` together, `frame-src` restricted to
hosts the studio has entered deliberately.

**"Unlisted URL" is not access control.** A pre-launch brand hub is confidential;
an unguessable URL leaks through browser history, referrers and shared links.
Stated as a finding rather than solved here (QA-5).

**CSP:** `script-src 'self'` with hashes for the copy handler; no
`unsafe-inline`. No authentication, therefore no token storage — the one place
where this artifact is genuinely simpler than the Studio.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 5 | Security posture is brand-neutral; a low score here is accuracy, not a defect. |
| User Clarity | 7 | Sandboxing is invisible to readers until an embedded tool fails to load, which has no stated fallback. |
| Distinctiveness | 4 | Standard static-site hardening — distinctiveness by justified absence. |
| Technical Feasibility | 8 | Headers and sandbox attributes; the allowlist is operational work, not engineering risk. |
| Browser Security | 6 | The iframe surface is identified but its vetting process is undecided (QA-3). |
| Authentication Safety | 8 | No auth and no tokens by design — but the confidentiality gap is real and open. |
| Input Safety | 7 | All content originates in the run record; the untrusted input is the embed URL. |
| Dependency Safety | 7 | A static generator has a small runtime surface; the build-time tree is not yet audited. |

---

## Department 43 — Build Systems & Dependency Engineering

**Budget: ≤ 40 KB gzipped for the initial route**, against the Studio's 170 KB.
Justified by kind: the hub is a document read once per visit, frequently on a
phone on conference wifi. The Studio is a workspace held open for twenty minutes.
They cannot share a budget, and the corpus explicitly forbids inheriting one.

Mechanism: islands means the framework runtime never ships whole; three
interactive controls are the entire client-side surface. No charting library, no
canvas, no animation engine.

**Reproducibility:** the same run record must produce a byte-identical hub. Asset
names are content-addressed; no build-time timestamps enter the output, which
also keeps the deploy diff meaningful.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 5 | Build configuration is brand-neutral. |
| User Clarity | 7 | Budget is set by reader context rather than inherited, which is what keeps the page fast on the device it is actually read on. |
| Distinctiveness | 6 | A tight budget for a content page is correct rather than novel. |
| Technical Feasibility | 9 | 40 KB is generous for three controls and no libraries. |
| Bundle Efficiency | 9 | Budget justified against the real audience and mechanism stated. |
| Build Reproducibility | 8 | Content-addressed assets and no timestamps; the lockfile discipline is stated but unproven. |
| Supply-Chain Safety | 7 | Small dependency surface, but no audit has been run. |

---

## Department 7 — Frontend Engineering

**Architecture: a generator, not an application.** `@edsai/hub` takes a FINAL run
record and emits a static site. There is no authoring surface and no editing
path — if a value is not in the run, it cannot appear in the hub. That single
constraint is what makes every published value traceable.

**Component contracts:** each section is a pure renderer over a typed slice of
the run record. A section given an absent slice renders nothing rather than an
empty state, which keeps a partial run from publishing a page full of hollow
headings — though what a *partial* run should publish is itself undecided (QA-6).

**The coupling to watch:** the hub reads the engine's run-record schema directly.
That is the correct dependency direction, but it means an engine schema change
breaks the hub at build time. Acceptable, and named.

| Dimension | Score | Justification |
|---|---|---|
| Brand Fidelity | 6 | Architecture serves traceability, which is EDSAI's method rather than a brand expression. |
| User Clarity | 8 | "If it is not in the run, it cannot be in the hub" is a rule a reader of the code can hold. |
| Distinctiveness | 6 | Static generation from a typed record is ordinary; the constraint on authoring is the interesting part. |
| Technical Feasibility | 8 | The unknown is the provenance component, not the pipeline. |
| Architecture Scalability | 8 | A new section is a renderer plus a slice; no orchestration changes. |
| Performance Headroom | 9 | A static page against a 40 KB budget with three controls has room to spare. |
| Code Coupling *(inverse — 10 = least coupled)* | 7 | The hub is bound to the engine's run-record schema; deliberate, but it is a real edge. |

---

## Department 8 — Performance, SEO, Accessibility

*Measured, not scored.* **Every row is `stated-target`** — no instrument ran.

| Target | Value | Mechanism | Source |
|---|---|---|---|
| Lighthouse Performance | ≥ 95 | Static HTML from the edge; three hydrating controls | stated-target |
| LCP | < 1.8 s | Text-first; brand hero is the only image above the fold, served at display size | stated-target |
| INP | < 200 ms | Copy and tab handlers are trivial; no main-thread work at rest | stated-target |
| CLS | < 0.1 | Fixed-ratio boxes for every brand asset; font metrics matched on fallback | stated-target |
| Initial-route JS | ≤ 40 KB gz | Islands; no chart, canvas or animation library | stated-target |
| Contrast — hub chrome | AA, ≥ 4.5:1 body | Awaiting the contrast instrument | stated-target |
| Contrast — hosted brand | reported, not enforced | The hub measures the client's palette; it does not correct it. See QA-2. | stated-target |
| WCAG 2.1 AA | axe 0 violations | Copy buttons announce their result; tabs use the tab pattern with roving focus | stated-target |
| Title length | 50–60 chars | Generated as `<Brand> — Brand Hub` with length asserted at build | stated-target |
| CSP | no `unsafe-inline` | Hashed copy handler; `frame-src` allowlist | stated-target |
| Reduced motion | honoured | Copy confirmation is a colour and label change, not a transition | stated-target |

**The performance targets are tighter than the Studio's and should be.** LCP
< 1.8 s against the Studio's 2.5 s, because this page is text served from a CDN
with no data fetch on the critical path.

---

## Department 9 — Quality Assurance

**3 Major · 0 Blocker · 3 Minor · 1 Nitpick.** Severity-ranked, each traced.

### Majors

**QA-1 — The hub goes stale and no department owns it.** *(traced to 7, 39, 41)*
The hub is generated from a run. The Studio can change afterwards. Nothing states
the source of truth, the regeneration trigger, or what a reader sees when the hub
is behind. This is the corpus's Stale UI rule and Law 11, unanswered. A client
team confidently copying a hex that the studio revised last week is the failure
mode, and it is silent.

**QA-2 — A failing contrast pair has no decided behaviour, and it is a business
decision.** *(traced to 5, 8, 1)* The hub measures the *client's* palette. Real
palettes fail AA. Three options, all with consequences: omit the pair (the hub
lies by silence), show the failure (the hub publishes the client's
non-compliance to their own staff and every external agency), or block publishing
(the studio cannot ship until the client accepts a palette change). No department
chose. Department 8 assumes reporting; Department 1 assumes the hub is proof of
value. Those cannot both hold.

**QA-3 — Embedded tools are third-party code on a client-branded domain, with no
owner.** *(traced to 40, 7)* Sandboxing is specified. Who vets a tool before it
is embedded, what happens when it breaks in front of the client, and who is
liable when it misbehaves are all unassigned. DesignerHQ has the same surface;
inheriting the pattern inherits the problem.

### Minors

**QA-4 — Asset redistribution is unbounded.** Anyone with the URL downloads the
logo pack. For most clients that is fine and for some it is not; no policy exists.

**QA-5 — "Unlisted" is treated as private.** A pre-launch hub is confidential, and
an unguessable URL leaks through history, referrers and forwarded links.

**QA-6 — Partial-run behaviour undecided.** Department 7 says an absent slice
renders nothing. Whether a hub *should* publish from a non-FINAL or partial run
at all is a different question, and unanswered.

### Nitpick

**QA-7 — The gallery section has no stated source** in the run record. It may be
the only section with no upstream department feeding it.

---

## Department 10 — Agency Critic

Benchmark Gap against the $50K-agency bar. **Mean 7.25 · 2 fail.**

| Department | Gap | The finding |
|---|---|---|
| 1 Strategy | 8 | The three-reader model is sharper than the category; the executive reader is a genuine insight. |
| 2 Creative Direction | **5** | *Fails.* "Neutral host" is not a creative direction. A $50K agency would give the hub a point of view that still recedes — restraint with a signature, not restraint as absence. This is the same failure the original self-run recorded, one department earlier. |
| 4 UX Architecture | 8 | Three affordances separated by weight is real craft. |
| 5 UI Design System | **6** | *Fails.* The provenance component is the entire product thesis and it is specified as "visibly distinct" with no design. The one thing that must be excellent is the one thing not yet designed. |
| 39 Rendering | 9 | Four alternatives priced against the corpus's own cost table and rejected on stated grounds. |
| 40 Security | 7 | Correctly identifies the iframe surface; leaves its governance open. |
| 43 Build | 8 | A budget justified by reader context rather than inherited is exactly the discipline. |
| 7 Engineering | 7 | The no-authoring constraint is strong; the schema coupling is named but unmitigated. |

**The Critic's summary judgement:** this run is strong wherever the answer is
computable and weak wherever it is a matter of taste — which is precisely the
product's own known weakness, reproduced in its own planning. The measurement
layer is not in question. The design of the thing that displays the measurements
is.

---

## Department 11 — Final Arbitration

### Conflicts and resolutions

**Conflict 1 — Proof versus recession.** Department 1 positions the hub as the
studio's standing proof of rigour; Department 2 requires EDSAI's chrome to recede
behind the client's brand. Both cannot be maximised.
*Resolution:* the measurement **is** the expression. Provenance rendering is the
only EDSAI-voiced element, and it is typographic rather than chromatic, so it
never competes with the brand's colour.
*What was lost:* EDSAI gets no visual signature on the hub. Attribution is a line
of text, and the studio's proof is legible only to a reader who looks closely.

**Conflict 2 — Strict CSP versus embedded tools.** Department 40 requires no
`unsafe-inline`; the embedded-tools feature wants arbitrary URLs.
*Resolution:* strict CSP with a hashed copy handler; iframes sandboxed against an
explicit `frame-src` allowlist.
*What was lost:* a studio cannot paste an arbitrary tool URL and have it work —
friction DesignerHQ does not have, accepted deliberately.

**Conflict 3 — Style isolation versus bundle.** Department 5 wants the hub's
styles unable to collide with a hosted brand's; Department 43 wants 40 KB.
*Resolution:* namespaced custom properties, not shadow DOM.
*What was lost:* true isolation. A hosted brand's global CSS could still collide,
and the mitigation is a naming convention rather than a boundary.

**Conflict 4 — Reporting the truth versus shipping the proof.** QA-2. Department 8
assumes a failing pair is reported; Department 1 assumes the hub demonstrates the
studio's value.
*Resolution:* report the failure with its remediation, **and** surface it as a
pre-publish gate inside the Studio so the studio sees it before the client does.
*What was lost:* one-click publish from a FINAL run. If a pairing fails, a human
decides before anything reaches the client.

### Aggregate

| Measure | Value |
|---|---|
| Mean Universal Dimension score | **7.09** (32 scores) |
| Mean across all scores | **7.36** (58 scores) |
| Lowest score | **Department 40 Distinctiveness, 4** — distinctiveness by justified absence |
| Named weak point | **Department 2 World Specificity, 5** |
| Benchmark Gap mean | 7.25, 2 departments failing |
| Measurable targets met | **0 of 11 verified** — all 11 are `stated-target`; no instrument ran |
| Cross-System Coherence | **6** |

**Why coherence is 6.** Four conflicts, and three of them are the same shape:
the hub crosses from an internal artifact into a client-facing publication, and
no department owned that transition. Staleness (QA-1), the failing pair (QA-2)
and the embedded tools (QA-3) are each a consequence of the same unowned
boundary. That shape-repetition is the identical finding the original self-run
made — a later concern quietly redefining what an earlier department settled.

### Score-drift audit

Run as required for any run touching three or more departments.

| Band | Share of 58 scores |
|---|---|
| 7–8 | 53.4% |
| 8–9 | 51.7% |
| 6–7 | 39.7% |

**Passes.** The widest two-point band holds 53.4%, against the 70% clustering
threshold. The distribution runs 4 through 9 with genuine low scores where low
was true — Department 40's Distinctiveness at 4 and Department 2's World
Specificity at 5 are not softened.

### Determination

**V1.** Three Majors are open (QA-1, QA-2, QA-3). The gate refuses FINAL, and
that is correct: each of the three is an unowned decision about what happens when
an internal artifact becomes a client-facing publication, and none can be closed
by writing more of the spec.

**To reach V2:** decide the staleness policy and its regeneration trigger; decide
what the hub does with a failing pair and who approves it; assign ownership and a
vetting process for embedded tools. Then design the provenance component, which
the Critic correctly identifies as the one thing that must be excellent and the
one thing not yet designed.

**To reach anything real:** rebuild Phase 1. Every target in this run is a
stated intention. The hub's entire claim is that its values are measured, and
until the instruments exist this phase would ship a prettier version of what
already exists.
