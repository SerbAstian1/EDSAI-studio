# Department 8: Performance + SEO + Accessibility

## Role

This department doesn't generate creative output — it audits and constrains everything upstream against real, external, non-negotiable targets. This is the department most prone to being skipped or rubber-stamped, which is exactly why it gets a hard checklist instead of open-ended reasoning.

## The core failure this department exists to prevent

**Treating performance/SEO/accessibility as a final polish pass instead of a constraint that should have shaped decisions in Departments 5–7.** If this department's audit reveals a fundamental conflict (e.g. the hero requires a 4MB video background that can't hit LCP targets), that's not a Department 8 problem to quietly patch — it's a signal that Department 6 or 7 made a decision without this department's constraints in view, and it needs to go back.

## This department does not use the 1–10 scorecard

Per `00-scorecard.md` Section 4, this department reports against **real external targets**: pass/fail and measured-value-vs-target, not subjective scoring.

## 8.1 Performance Targets

**Set the budget per project before measuring against it.** The defaults below assume a typical route on a mid-tier mobile device. A project whose real audience differs gets different numbers, justified against that audience's devices and networks (`00-scorecard.md` §4). State the budget explicitly, then measure against *that*.

| Metric | Target | What it actually measures |
|---|---|---|
| Lighthouse Performance score | ≥90 | Composite of the metrics below |
| LCP (Largest Contentful Paint) | <2.5s | How fast the main content becomes visible |
| INP (Interaction to Next Paint) | <200ms | Responsiveness to user input |
| CLS (Cumulative Layout Shift) | <0.1 | Visual stability (nothing jumping as it loads) |
| Initial route JS payload | <170KB (compressed) | What the user downloads before anything is interactive |

**Supporting metrics** — not targets in themselves, but what you reach for when a headline metric misses:

| Metric | Diagnoses |
|---|---|
| **TTFB** (<800ms) | Server/CDN/network before anything can start — if this is bad, LCP cannot be good |
| **FCP** | Render-blocking resources delaying first pixel |
| **TBT** / long tasks | Main-thread blocking — the lab proxy for INP (Department 35.3) |
| **JS execution time** | Parse + compile + execute cost, distinct from download cost |

**Diagnosing each headline metric**, since "improve LCP" is not actionable:

- **LCP** — identify the LCP *element* first. Usually a hero image or a heading. Then the cause is one of: slow TTFB, a render-blocking resource, late discovery (fix with `preload`), an oversized asset, or client-side rendering delaying the element's existence entirely.
- **INP** — a long task blocked the response (Department 35.3), or hydration hadn't finished (Department 39.2), or the handler itself does too much synchronous work. Attribute to a specific interaction; a single aggregate number won't lead anywhere.
- **CLS** — images and embeds without reserved dimensions, webfont swap reflow, content injected above existing content (banners, ads, consent bars), or animating layout properties instead of `transform` (Department 35.1).

**Field data outranks lab data.** Lighthouse tells you whether the page *can* be fast on a fast machine; RUM at p75 tells you whether it *is* fast for real users (Department 45.2). Where both exist, report both and treat the field number as the truth.

### 8.1a Critical rendering path

```text
HTML → CSS → JS → Layout → Paint
```

Everything on this path delays first paint. The levers, in order of typical impact:

- **Eliminate render-blocking resources.** CSS blocks rendering by design; inline the critical subset and defer the rest where it matters. Scripts block parsing unless `defer` or `async` (Department 35.1).
- **Fix late discovery** — a resource referenced from inside a CSS file is found only after that CSS parses. `preload` breaks the dependency (Department 47.1).
- **Fonts:** woff2, subset, `font-display: swap` or `optional`, and preload only the faces rendering above the fold. Fonts are a leading CLS *and* LCP cause simultaneously.
- **Reserve space** for anything loading asynchronously — `width`/`height` or `aspect-ratio` on every image, fixed dimensions for embeds and ad slots.

### 8.1b Resource priority

Use each hint for the specific problem it solves; overuse inverts the benefit (the table in Department 47.1 gives the full comparison). In short: `preconnect` for the two or three third-party origins you'll certainly hit, `preload` for the LCP image and above-fold font, `fetchpriority="high"` on the LCP image and `low` on below-fold media, `prefetch` for likely next navigations.

### 8.1c Bundle engineering

Owned in depth by **Department 43**; the targets that matter here:

- **Route-level code splitting** as the baseline, with prefetch on intent so the split doesn't become a visible delay
- **Tree-shaking verified**, not assumed — check the actual output
- **Bundle composition analyzed** and the top three contributors named
- **A CI size gate** against the stated budget, because a budget enforced by intention is not enforced

### 8.1d Hydration and runtime performance

Applies wherever server rendering is in play (Department 39.2):

- **JavaScript shipped per route**, and what proportion of the page actually hydrates
- **Time to interactive** versus time to first paint — the gap is the uncanny valley, and it is felt as INP
- **Hydration warnings: 0.** A mismatch discards the server HTML and re-renders, forfeiting what SSR was bought for
- **Client component cost** — every `'use client'` boundary and what it pulls into the bundle

### 8.1e Memory performance

Long-lived applications degrade as they run (Department 35.4). Verify:

- Event listeners, timers, observers, and subscriptions removed on teardown
- No detached DOM retained across navigation cycles
- Animation instances killed on unmount (Department 15)
- Retained heap flat, not monotonic, across five repetitions of the primary navigation cycle

For each: state the target, and state the **specific design/engineering decision** that's meant to hit it (per `00-scorecard.md` Section 4 — a target without a mechanism is a wish). Common levers: image format/sizing, font-display strategy, code-splitting by route, deferred/lazy-loaded non-critical JS, avoiding render-blocking resources, reserving space for async content to prevent layout shift.

## 8.2 Accessibility — WCAG 2.1 AA Checklist

Go through explicitly, stating pass/fail/N/A for each:

- [ ] **Contrast**: all text/background pairings meet 4.5:1 (normal text) or 3:1 (large text ≥24px / 19px bold, and UI component boundaries) — pull actual ratios from Department 5
- [ ] **Focus order**: logical, matches visual order, every interactive element reachable and visible when focused (no `outline: none` without a replacement focus style)
- [ ] **Alt text**: every meaningful image has descriptive alt text; decorative images have empty `alt=""` (not missing alt, which is worse than empty)
- [ ] **Semantic landmarks**: proper use of `<nav>`, `<main>`, `<header>`, `<footer>`, heading hierarchy with no skipped levels (one `<h1>`, then `<h2>`s before any `<h3>`)
- [ ] **Form labels**: every input has an associated, visible label (placeholder text is not a label)
- [ ] **Reduced motion**: `prefers-reduced-motion` implemented per Department 6's stated fallback — and, on gesture-driven surfaces, direct manipulation preserved rather than disabled (per `references/interaction-physics.md` B.9)
- [ ] **Reduced transparency / increased contrast**: `prefers-reduced-transparency` and `prefers-contrast` handled for every translucent surface specified in Department 5.5, with a stated solid fallback. N/A only where the project has no material layer
- [ ] **Motion safety**: no full-viewport moving backgrounds, no slow looping oscillation near 0.2 Hz, no abrupt brightness jumps (theme changes eased, not cut)
- [ ] **Keyboard navigation**: full experience operable without a mouse, including any custom interactive components (custom dropdowns, modals, carousels)
- [ ] **Touch targets**: minimum 44×44px for interactive elements on touch interfaces, gesture surfaces included
- [ ] **Pointer gestures and dragging alternatives** *(only where Interaction Physics is active)*: every path-based or multipoint gesture has a single-pointer alternative (WCAG 2.5.1, A), and every function achieved by dragging has a non-dragging, keyboard-operable equivalent (WCAG 2.5.7, AA in WCAG 2.2) — a drag-to-reorder list needs move-up/move-down affordances, a drag-to-dismiss sheet needs a close button. State the alternative per gesture, or state the exemption and why it qualifies. DEVPOINT's `interaction-delivery.md` D.6 audits whether these alternatives are actually tested rather than merely specified

A checklist with unchecked items isn't ready for FINAL — feed failures back to Department 5/7 rather than shipping with a known gap.

### 8.2a Per-component behavior definition

**Accessibility is architecture, not a remediation pass** (Law 10). For every interactive component, define and verify all six behaviors:

1. **Mouse** — hover, click, drag where applicable
2. **Keyboard** — which keys, what they do, how focus enters and leaves
3. **Touch** — target size, gesture, and its non-gesture alternative
4. **Screen reader** — the accessible name, role, state, and what is announced on change
5. **Reduced motion** — the fallback per Department 6
6. **Disabled / loading / error** — how each is conveyed both visually and programmatically

A component specified without these six is specified for sighted mouse users only. Department 42.4 owns verifying them.

### 8.2b Focus management

The most commonly missed accessibility work, because it is invisible to sighted mouse testing:

- **Dialogs and drawers**: focus moves in on open, is trapped while open, returns to the trigger on close
- **Route changes**: focus moves deliberately (to the heading or a skip target) — an SPA navigation that leaves focus on the clicked link strands screen-reader and keyboard users at the old position
- **Dynamic content**: newly revealed content is reachable, and errors are announced when they appear (a live region), not merely rendered
- **Skip link** to main content as the first focusable element
- **Focus visible always** — `outline: none` requires a replacement style that meets 3:1 contrast, never a removal

### 8.2c Semantic structure

- Native elements before ARIA — a `<button>` carries role, keyboard behavior, and focus for free; a `<div role="button">` requires you to reimplement all three, correctly
- Landmarks (`<nav>`, `<main>`, `<header>`, `<footer>`, `<aside>`) present and unduplicated without labels
- Heading hierarchy valid: one `<h1>`, no skipped levels
- Lists marked up as lists, tables as tables with proper headers
- **The first rule of ARIA is not to use ARIA** where a native element exists. Incorrect ARIA is worse than none — it overrides what the browser already conveys correctly

## 8.3 SEO Structure

- **Title tag**: 50–60 characters, primary keyword/brand near the front, unique per page
- **Meta description**: 150–160 characters, written as actual marketing copy (not keyword-stuffed), unique per page
- **Heading hierarchy**: single `<h1>` matching page intent, logical nesting beneath it
- **Structured data**: appropriate schema.org markup for the content type (Organization, Product, Article, etc. — state which applies)
- **Semantic HTML**: content meaning conveyed by tag choice, not just div-soup with classes
- **Canonical URLs and meta robots**: stated explicitly for any page with duplicate-content risk

### 8.3a Crawlability and indexability

- **`robots.txt`** — what is disallowed, and confirmation that nothing needed for rendering (CSS, JS) is blocked
- **XML sitemap** — generated, current, submitted, and containing only canonical indexable URLs
- **Canonical tags** — self-referencing by default; pointing to the canonical version where parameters, pagination, or syndication create duplicates
- **`noindex`** applied deliberately to thin, duplicate, or utility pages — and verified *not* applied to anything that should rank (a stray staging `noindex` reaching production is a recurring, expensive incident)
- **Status codes and redirects** — 301 for permanent moves, no redirect chains, no soft-404s returning 200 for missing content

### 8.3b Structured data and social metadata

- **JSON-LD** is the preferred format. State which schema.org types apply (Organization, Product, Article, BreadcrumbList, FAQPage, LocalBusiness) and validate against a testing tool
- Structured data must **match visible page content** — marking up content the user cannot see is a manual-action risk, not a shortcut
- **Open Graph** (`og:title`, `og:description`, `og:image`, `og:type`, `og:url`) and Twitter card tags, with a correctly sized share image. This is Department 2 and 3 work as much as technical work — the share card is often the first brand impression, and a default-cropped screenshot undoes it

### 8.3c International

- **`hreflang`** for multi-language or multi-region sites, reciprocal and including `x-default`
- URL strategy stated (subdirectory, subdomain, or ccTLD) with its reasoning
- Language declared in the `lang` attribute — an accessibility requirement as much as an SEO one, since it determines screen-reader pronunciation

### 8.3d Rendering strategy and SEO

> **SSR does not equal SEO.**

Discoverability depends on crawlability, indexability, semantic content, metadata, structured data, performance, *and* rendering behavior — together. A server-rendered page that is blocked in `robots.txt`, canonicalized elsewhere, or slow enough to exhaust crawl budget will not rank.

Modern crawlers execute JavaScript, but do so on a **deferred second pass** with a rendering budget. The practical consequences: content behind client-side fetching may be indexed late or inconsistently; metadata set client-side is unreliable; and for pages where indexing matters and content is dynamic, pre-rendered HTML (SSG/ISR/SSR) remains the dependable choice. **State the rendering strategy per route group alongside its SEO requirement** (Department 39.5) — the two decisions are made together or not at all.

## Rules
- Speed and accessibility are constraints on Departments 5–7, not a cleanup pass after them
- Every unmet target gets a stated remediation, not a silent pass
- A "looks accessible" judgment call is not a substitute for the checklist — go through every item

## Failure Conditions
- Any Lighthouse-category metric without a stated decision for hitting it
- Any unchecked accessibility checklist item with no remediation plan
- SEO metadata missing entirely or generic/duplicated across pages

## Scorecard / Reporting Format

Report as: **target / actual-or-design-decision / pass-fail-or-pending**. Example:

> LCP target <2.5s — hero uses a single compressed AVIF at exact display dimensions, font-display: swap, no render-blocking webfont — **design supports target, pending live measurement**

State the aggregate pass rate explicitly (e.g. "6 of 8 accessibility checklist items pass by design; 2 require implementation-time verification") for Final Arbitration to pull into its aggregate measured-target pass rate.
