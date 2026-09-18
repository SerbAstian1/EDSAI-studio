# EDS AI Studio — the AW product direction

The master brief describes a desktop-first creative studio and brand operating
system: clients, onboarding, brand systems, asset libraries, guidelines,
portals, campaigns, templates, approvals. This file is the audit that preceded
touching anything, the map that came out of it, and the record of Phase 1.

## What was already here

| Area | State before |
|---|---|
| Packages | 11: rubric, instruments, prompts, engine, figma, export, measure, api, studio, hub, desktop |
| Domain model | `Run` → `DepartmentOutput` (scores, targets, tokens, compositions, decisions) + `Issue` + `Conflict`. **No Client, Project, Brand or Asset entity** — `projectId` is a bare string |
| Studio UI | 9 files, ~1150 lines. Hash routing, 6 screens, no sidebar, no command palette, no global store |
| Design system | One `styles.css`, tokens measured with the repo's own contrast instrument, system fonts only |
| API | `node:http`, SSE, **no authentication of any kind** |
| Portal | `@edsai/hub` already generates a client-facing brand portal from a FINAL run |
| Desktop | Tauri shell, 740 ms to a mounted app |
| Gates | 170 KB gz initial-route budget, CI on build → typecheck → test → budget |

## The map

**KEEP.** The rubric, the instruments, the engine's provenance verifier and
FINAL gate, the run store, the API, the Tauri shell, the bundle gate. These are
the product's actual differentiator and nothing in the brief supersedes them.

**MODIFY.** `styles.css` became the AW design system in place, rather than
gaining a second one — no component reads a token directly, so the whole
palette could be rewritten in one file without touching a screen. `App.tsx`'s
router was extended with the new sections rather than replaced. The old
`Workspace` screen was migrated into `Home` and deleted.

**REMOVE.** `Workspace` (superseded by `Home`). Nothing else yet — removing
more before the entities exist would be deleting working features to make room
for a diagram.

**ADD.** Sidebar, command palette, studio home, and the Brands / Portals /
Activity / Settings / Runs screens. Later: the Client, Project, Brand and Asset
entities, which everything in Phases 2–10 depends on.

## The join that makes this one product

The risk in the brief is that a brand-management CRM gets built beside a
measurement pipeline and the two never meet — which is exactly what §51 and §64
forbid. The join is that **a brand is what a run produces**, not a second
hand-authored record:

```
Run ──(gate holds FINAL)──> Brand ──> Portal (@edsai/hub)
 │                            │
 └── DepartmentOutput ────────┴──> tokens, targets, compositions
        (already typed, already provenance-checked)
```

`Brands` is therefore a view over runs filtered by determination, not a table of
its own. `BrandToken` and `Target.tokens` — added for the hub — are already the
structured colour and type data a guideline, a portal, an AI context and a
developer export all need. The Brand Brain has raw material before it is built.

## The palette, measured rather than chosen

The brief specifies AW orange `#EB5E28` on charcoal. Running it through this
repository's own `contrast` instrument produced three findings that changed the
design:

| Pair | Ratio | Verdict |
|---|---|---|
| `#EB5E28` on white, body text | 3.41:1 | **fails** 4.5:1 |
| `#EB5E28` on white, large text | 3.41:1 | passes 3:1 |
| `#EB5E28` as a non-text boundary | 3.41:1 | passes 3:1 |
| white **on** `#EB5E28` | 3.41:1 | **fails** — the obvious button label |
| charcoal `#1A1A1A` **on** `#EB5E28` | 5.11:1 | passes |
| `#EB5E28` on charcoal `#14161A` | 5.32:1 | passes |

So: on light surfaces AW orange is a display and fill colour, never body text;
`--accent-ink` (`#C4400C`) carries text at body size; **a filled orange control
takes a charcoal label, not a white one**; and in dark mode the brand orange is
itself the text colour.

A second pass caught two failures in the first draft of the tokens — muted text
at 4.45:1 and the accent at 4.41:1 — because they had been checked against
`--surface-elevated` (white) when the sidebar is `--surface` (darker). Every
token is now measured against the tightest surface it can land on. Checking the
easy background is the same mistake as running a check only on the passing case,
which `notes/gaps.md` has recorded three times.

`--border` is deliberately below 3:1: it is a decorative hairline, and
`--border-strong` is the control boundary that clears WCAG 1.4.11.

## Phase 1 — foundation (built)

- **AW design system.** Tokens for surfaces, text, lines, accent roles, status,
  type and geometry, in light and dark, every text pair measured.
- **Typography.** Space Grotesk for display, Inter for UI, Instrument Serif as
  an accent confined to `.editorial`. **The font files are not bundled yet** —
  the stacks fall back to system faces. Self-hosting is required rather than
  optional, because the Tauri shell's CSP is `default-src 'self'` and would
  block a Google Fonts stylesheet outright. That is a deliberate Phase 1b item,
  not an oversight.
- **Application shell.** Sticky sidebar, top bar, content column, responsive
  down to a single column at 900px.
- **Navigation as data.** One `SECTIONS` list drives the sidebar, the command
  palette and the route parser, so a section cannot exist in one and be missing
  from another. Sections whose entities do not exist are listed, marked with the
  phase that brings them, and not clickable — the shape of the product stays
  readable without a link that goes nowhere.
- **Command palette.** ⌘K / Ctrl+K, ranked search, arrow keys, Enter, Escape,
  focus restored to the opener. Navigation commands are derived from `SECTIONS`
  rather than restated.
- **Studio home.** Editorial greeting, four computed figures, recent runs. Every
  number is derived from runs the server holds; nothing is a placeholder.
- **Runs, Brands, Portals, Activity, Settings** screens.

### Verified, not asserted

| Check | Result |
|---|---|
| Bundle budget | **87.5 KB gz** initial route against 170 KB — the shell, palette and dashboard cost 4.5 KB |
| Every section renders | headless Chromium against the real API, five routes |
| Command palette | driven over CDP with real key events: Ctrl+K opens, focus lands on the input, 9 commands, typing filters, Enter navigates to `#/brands` and closes, Escape closes |
| Suite | 640 tests, build → typecheck → test → budget green |

A test caught a real navigation bug on the way: Overview and Runs both resolved
to the same screen, so the sidebar would have highlighted the wrong entry. They
are now genuinely different screens sharing one `RunTable`.

## The largest open risk

**There is no authentication anywhere in this codebase.** The API is open to
anything that can reach the port. That was defensible for a single-user local
workstation and it is not defensible for the product described in the brief:
§53 requires per-client isolation enforced at the data layer, and the moment a
portal is published or a client is invited, that gap becomes the product's
biggest liability rather than a known limitation.

Nothing in Phase 1 addresses it, and Phase 1 should not be deployed anywhere
reachable. It has to land before Phase 2 introduces a second client's data, not
after — retrofitting authorization onto entities that were designed without it
is how the isolation bug gets written.

## What Phases 2–10 need first

Almost everything in the brief is blocked on entities that do not exist yet:
`Client`, `Project`, `Brand`, `Asset`. They belong in `@edsai/engine` beside
`Run`, with the same schema discipline, and `Run.projectId` becomes a foreign
key instead of a string. That migration is the first task of Phase 2 and it is
deliberately not started here — Phase 1 had to be a vertical slice that builds
and runs, not a half-finished schema change underneath a new shell.
