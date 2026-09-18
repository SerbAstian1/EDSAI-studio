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

## Phase 1b — authentication (built, and deliberately before Phase 2)

The studio had no authentication of any kind: the API was open to anything that
could reach the port. That was defensible for one user on one machine and not
for the product the brief describes. The decision taken was to close it **before**
Phase 2 rather than after, because retrofitting authorization onto entities that
were designed without it is how the isolation bug gets written — the row that
predates the scope column is the row nobody remembers to filter.

`@edsai/auth` is a leaf package with no dependency that could compromise a
credential: `node:crypto` only.

- **Passwords** are scrypt with a per-password salt, compared with
  `timingSafeEqual`. String comparison returns on the first differing byte,
  which leaks how much of a guess was right.
- **Session tokens** are 256-bit and opaque, and the database stores only their
  SHA-256. A leaked database yields no usable sessions — the same argument as
  not storing passwords, applied one layer along, which almost nothing does.
- **The cookie** is `HttpOnly; Secure; SameSite=Lax`, straight from Department
  40.4's own table. `localStorage` was never a candidate: §40.4 says not to, and
  the reason it is convenient is the reason injected script finds it convenient.
- **Roles** are the brief's five, ordered, with the thresholds in one table.

### Where the rule is enforced

The policy is a pure function in `@edsai/auth`; enforcement is `ScopedStore` in
the engine, at the data boundary. A policy that route handlers are trusted to
call is a policy that stops being applied the first time someone adds a route —
and the brief is explicit that hiding something in the interface is not
authorization.

Two properties fell out of building it that are worth keeping:

- **Reads filter, writes throw.** A read that threw on another client's id would
  confirm that something exists there, which is the same disclosure the refusal
  messages are careful not to make.
- **Run scope is checked in the request pipeline, not per route.** Every
  `/api/runs/:id/...` endpoint resolves its run through the scope before the
  handler runs, so a route added later inherits the check rather than having to
  remember it. Five existing routes were reading by id with no check at all.

### The CSRF rule, and the mistake in the first version

§40.3 says SameSite is "a strong baseline, **not** a complete solution", so the
Origin is checked server-side too. The first version refused any state-changing
request with no `Origin` header — which locked the studio out of its own sign-in
endpoint, because no non-browser client sends one.

The resolution is the content type: a cross-origin HTML form can only send
`x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, and cannot send
`application/json` without a preflight this server answers only for origins it
allows. So JSON with no Origin is a programmatic client and a form-encoded body
with no Origin is refused. The residual risk is stated in the module: it trusts
a specification guarantee, which is a guarantee and not a proof.

### Two holes found by reviewing my own auth code

Both were in code written in the same sitting, and both were found by attacking
it rather than by running it.

**Sign-in was an account enumerator.** The responses for a wrong password and an
unknown account were identical in status and message — there is a test asserting
exactly that — and the test proved less than it appeared to. scrypt is
deliberately slow, so a known email answered in **49.2 ms** and an unknown one
in **0.8 ms**: a 60x tell, trivially readable over a network. Sign-in now always
does the work, verifying against a record no password matches when the account
is absent. Re-measured at 1.0x.

The lesson is narrower than "test timing": a test that checks the *content* of
two responses says nothing about their *cost*, and it is easy to mistake one for
the other when you wrote both.

**The first-run setup had a race.** `countUsers() === 0` was checked, then
`hashPassword` awaited — tens of milliseconds — then the owner written. Four
concurrent requests all passed the first check and all wrote an owner. There is
now a second check after the only suspension point, and the test that covers it
was confirmed to fail without the fix rather than assumed to.

## Phase 2 — clients (built)

`Client`, `Contact` and `Project` exist in `@edsai/engine` beside `Run`, and
**`Run.clientId` is required rather than optional**. Making it optional for the
CLI's convenience would put an unscoped row in the same table as scoped ones,
and the unscoped row is the one no isolation rule can reason about. The CLI
resolves an explicit "Unattributed" client instead, which says what it is.

`Run.projectId` is now a foreign key. It used to be a free string, so the
migration turns every distinct string into a real `Project` under that client —
nothing is discarded, and the migration is idempotent.

The studio gained a sign-in gate with the first-run setup the brief's §48 asks
for, a Clients list with creation, and a client record with contacts, projects
and runs.

### Verified, not asserted

| Check | Result |
|---|---|
| Isolation at the boundary | a portal session for one client gets `[]` from every list, `undefined` from every get-by-id, and `Forbidden` on every write to another client |
| Isolation over HTTP | another client's run 404s at `/api/runs/:id`, `/document`, `/handoff` and `/next` — not only at the run itself |
| The full flow, in a browser | first-run setup → shell → create client → open client → sign out → gate returns, driven over CDP against the real API |
| The session cookie | `document.cookie` cannot see it, checked in the running page |
| Account enumeration | a wrong password and an unknown account return the same status and the same message |
| Budget | 88.3 KB gz against 170 KB |
| Suite | 743 tests at the time |

## Phase 3 — onboarding (built)

The brief's §11 describes a questionnaire builder with sections for company,
business, audience, positioning and personality. `docs/discovery/flow.md`
already specified something better and never built: a four-act flow built on one
rule —

> A good discovery question produces a **decision**, not a description.

So Phase 3 builds that rather than a second questionnaire, with the brief's
factual sections folded in as a short "facts" act. Three properties of the
catalog are asserted as tests rather than left as intentions:

- **No design vocabulary reaches a client.** A test greps every prompt and option
  for "minimal", "modern", "clean", "premium" and the rest. Clients are fluent in
  their own business, not ours; the translation is our job. The questions are
  about shop windows, workbenches and what happens when someone asks the price.
- **The midpoint is unreachable, not rejected.** The four ratio axes ask "pick a
  side", then "slightly / clearly / overwhelmingly" → 60/40, 70/30, 85/15. A
  slider with a centre would collect an unmade decision and fail the Direction
  Lock gate afterwards, which is a worse experience than never offering it.
- **Three axes are never asked.** Positioning, emotional tone and motion law are
  drafted by the studio and confirmed by the client, because asking someone to
  write a positioning statement produces category description. A completed client
  flow therefore resolves **8 of 11** axes by design — which is exactly the
  Direction Lock's own threshold, so finishing the form is where the studio's
  work starts rather than a shortfall.

### The invite is a capability, not a session

The client-facing endpoints are the only place in this system an unauthenticated
stranger writes to the database, so the grant is as narrow as it can be. The
token opens exactly one onboarding's questions and answers. It mints **no
principal**, so there is no role to escalate and no other client's data within
reach of it even in principle — a magic link that created a portal session would
hand a stranger every read that role allows, which is far more than filling in a
form needs.

Only the digest is stored, like a session token, so the link is shown once and a
lost one is reissued rather than recovered. Answers are validated against the
catalog rather than stored as sent, and the public read returns the client's
**name and nothing else** — the form needs to say who it is for; nothing else
about them belongs on a public endpoint. Accepting the answers revokes the link.

§14 is honoured: accepting a submitted onboarding derives the project — name,
kind, and a brief in the client's own words. It does not invent a positioning
statement, because that is one of the three the flow deliberately leaves open.

### Verified, not asserted

| Check | Result |
|---|---|
| The full loop, in a browser | studio issues a link → cookies cleared → client answers all 16 questions with no account → submits → studio turns it into a project |
| The ratio mechanic | all four axes confirmed to present two taps (side, then strength); no control anywhere in the flow offers a midpoint |
| Isolation | one client's invite opens only their onboarding; a portal session for another client 404s on accept |
| Junk answers | an answer that fails catalog validation is refused and does not count toward progress, so 100% cannot be reached by sending nonsense |
| Budget | 88.7 KB gz against 170 KB |
| Suite | 785 tests at the time |

A fourth came out of probing the public endpoints afterwards rather than
driving them: **a client could keep editing after submitting.** The status still
read "submitted" either way, so a studio reading the answers, deciding they were
good, and accepting them could be accepting something different from what they
read — with no way to tell. Submitting now closes the form, and reopening is the
studio's call. Prototype pollution through an answer value was probed at the
same time and does not occur.

Three bugs came out of driving it rather than reading it: a client who tapped
**Back** had no way forward again, because the forward control only appeared for
unanswered optional questions; the side and strength buttons shared a selector
with no grouping, which is five undifferentiated buttons to a screen reader; and
the thank-you line read "8 of the eight directions".

## Phase 4 — the brand workspace (built)

The design question was where a brand's values live. On the run record they stay
provenance-checked but editing one swatch means re-running a department; as their
own editable entity they are natural to edit, but the moment a human types a hex
code the hub's claim weakens from "every value carries its measurement" to "some
do".

The answer taken, with ease of use as the deciding constraint:

**Values are seeded from a run, then owned by the designer, and re-measured by
the same instrument on every save.** The run stays the immutable record of what
the pipeline computed; the brand is the living copy, and `sourceRunId` records
where each value started. So an edited colour still publishes as measured — what
changes is `origin`, not whether there is a number.

**A reason is required only when an edit breaks something.** Demanding
justification for every nudge produces a database full of "updated", which is
worse than an empty field because it looks like an answer. The reason exists so a
*failing* value is not mysterious to whoever meets it next. In practice: type a
hex, watch the ratio move, done — the interface interrupts once, when the change
takes a value below what it needs, and says by how much.

**The client never sees the working.** `forClient` drops `origin`, `reason` and
`sourceRunId`. Whether a value was computed or typed is the studio's business;
putting "changed by hand, because…" on every swatch would turn the client's
reference into our changelog. A failing colour still renders, with what it fails
by, because a client who is never told uses it anyway.

### Verified, not asserted

| Check | Result |
|---|---|
| A passing edit | saves on the spot, nothing asked for — 17.77:1 → 12.63:1, driven in the browser |
| A breaking edit | interrupts with "takes ink to 1.61:1, under the 4.5:1 it needs", and **leaves the stored value untouched** until a reason is given |
| After the reason | saves, shows the new ratio, records "Changed by hand: …", and flags "1 below target" |
| Seeding | never overwrites an edited value; refuses a run belonging to another client |
| Isolation | a portal session for another client 404s on the whole brand |
| Budget | 89 KB gz against 170 KB |
| Suite | 825 tests |

Three bugs came out of driving it, and the first two would have shipped:

- **A surface was measured against itself**, giving 1:1 and flagging the brand's
  own background as failing — a false alarm on the one colour that cannot be
  wrong. A ground has no contrast of its own; its contrast is a property of what
  sits on it.
- **The page went blank after saving a reasoned change.** `needsReason` is this
  component's state and `save.error` is the mutation's, and they do not update in
  the same tick — so the retry render still had the block open while the error
  had already been cleared, and reading `.message` off `null` took the whole page
  down. Found by capturing exceptions over CDP, not by looking at the screen.
- **"Edited" showed on values that were never edited**, because a hand-created
  value is studio-origin with nothing earlier to differ from.

A fourth was in the test rather than the product, and is the recurring one: a hub
assertion checked that the rendered page did not contain the word "origin", which
passed only because it was matching `original` — a variable name in the inlined
copy script. It asserted nothing about the claim it was named for.

## What Phases 5–10 still need

`Asset` and `Brand` do not exist as entities yet, and asset storage is the
larger of the two — the brief's library, versions and approval states all need a
storage layer the engine does not have. Onboarding (Phase 3) is the next slice
and now has somewhere to put its answers.
