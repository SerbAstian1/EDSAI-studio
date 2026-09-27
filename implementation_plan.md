# EDSAI Studio — Major Overhaul Implementation Plan

## Summary of Changes

This plan covers 11 interconnected features. They are grouped into **4 phases** to minimize breakage — each phase builds on the last.

---

## Phase 1: Sidebar Restructure + Client View Mode

### 1A — New Global Sidebar
**Current:** 3 groups (Workspace with 12 items, AI with 1, Studio with 3) = 16 entries
**New:** Slim sidebar with these top-level items:

| Section | Icon | Notes |
|---|---|---|
| Home | `Home` | Was "Overview" |
| Updates | `Bell` | Activity/notifications hub |
| Tasks | `CheckSquare` | New — studio-wide task board |
| Calendar | `CalendarDays` | **New** — scheduling & meetings |
| *separator* | | |
| **Client list** | Dynamic | Each active client appears as a sidebar entry |
| *separator* | | |
| Client Acquisition | `UserPlus` | Discovery sessions, lead tracking |
| *separator* | | |
| User profile / Settings | `User` | At bottom, links to Settings & Support |

**Files to change:**
- [`navigation.ts`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/shell/navigation.ts) — Rewrite `SECTIONS` and `GROUPS`
- [`Sidebar.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/shell/Sidebar.tsx) — Render client list dynamically; show eye toggle
- [`App.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/App.tsx) — Add new routes (calendar, tasks), update `Screen` type + `parseRoute`

### 1B — Client Workspace Tabs (move items into client context)
Items that now move *inside* each client's workspace (accessed at `#/clients/:id/tab`):

| Tab | Contains | Currently global? |
|---|---|---|
| Dashboard | Overview stats | Yes (Home-like) |
| Updates | Client-specific activity | No (new) |
| Tasks | Client-scoped tasks | No (new) |
| Documents | Document shelf | Already in Delivery tab |
| Library | Files/assets | Already in Delivery tab |
| Discovery & Strategy | Onboarding + positioning + **AI transcript** | Already in Discovery tab |
| Brand Hub | Brand values + hub admin | Already in Hub tab |
| Timeline | **New** — project timeline with milestones | Partially (Milestones) |
| Contracts & Invoices | **Enhanced** — build inside EDSAI | Already in Client tab |
| Settings | Client settings, portal access | Already in Client tab |

**Files to change:**
- [`ClientDetail.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/screens/ClientDetail.tsx) — Redesign tabs to match new structure

### 1C — "View as Client" Eye Toggle
- Add an `Eye` / `EyeOff` icon toggle in the header or sidebar
- When active, hides studio-only UI (edit buttons, overflow menus, internal notes)
- Stored in React state (no persistence needed)

**Files to change:**
- [`Header.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/shell/Header.tsx) — Add eye icon
- All client workspace tabs — conditionally hide editing controls when preview mode is on
- New context: `ViewModeContext` providing `{ clientView: boolean; toggle: () => void }`

---

## Phase 2: Documents Inline Preview + Calendar

### 2A — Document Shelf: Inline Preview Under Each Tile
**Current:** One shared preview area at the bottom of all tiles
**New:** Each tile expands to show its Figma preview directly below it, similar to an accordion

**Also fix:** Document button UI — linked documents should look visually distinct (filled/highlighted vs. ghost/outlined)

**Files to change:**
- [`DocumentShelf.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/components/DocumentShelf.tsx) — Restructure tiles so preview renders inline

### 2B — Calendar Section
A full interactive calendar with:
- Month/week/day views
- Create meetings from the calendar
- Link meetings to clients
- Color-coded by client
- Date picker and event creation modal

**New files:**
- `screens/Calendar.tsx` — Main calendar screen
- `components/CalendarView.tsx` — The calendar grid component
- `components/EventModal.tsx` — Create/edit event modal
- API additions in `api.ts` for events CRUD
- Engine additions in `store.ts` for events

---

## Phase 3: Discovery Expansion + AI Brand Strategy

### 3A — Expand Discovery to 24 Questions
**Current:** 15 questions in `QUESTIONS` array
**New:** 24 questions — add 9 more covering:
- Budget range expectations
- Communication preferences
- Competitor landscape (expanded)
- Target audience demographics
- Brand story / origin
- Growth goals
- Content strategy needs
- Past branding experiences
- Decision-making process

**Files to change:**
- [`onboarding.ts`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/engine/src/onboarding.ts) — Add 9 new questions to `QUESTIONS`

### 3B — AI Brand Strategy from Transcript
- A new section in the Discovery & Strategy tab
- Paste a discovery call transcript
- AI processes it and generates a brand strategy document
- Uses existing AI pipeline patterns

**New files:**
- `components/TranscriptStrategy.tsx` — The transcript paste + AI generation UI
- API endpoint for transcript → strategy

---

## Phase 4: Contract/Invoice Builder + Project Timeline

### 4A — In-App Contract & Invoice Builder
Enhance the existing Invoices screen to support:
- Building invoices with line items, tax, terms
- Contract builder with templates, sections, e-signature placeholder
- PDF preview/export

**Files to change:**
- [`Invoices.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/screens/Invoices.tsx) — Expand with builder UI
- New: `components/ContractBuilder.tsx`
- New: `components/InvoiceBuilder.tsx`

### 4B — Project Timeline
Enhance existing Milestones into a visual timeline:
- Gantt-like horizontal bar view
- Status indicators (upcoming → in-progress → completed)
- Drag-to-reorder
- Visible to both studio owner and client

**Files to change:**
- [`Milestones.tsx`](file:///c:/Users/USER/OneDrive/Documents/EDSAI-studio/packages/studio/src/screens/Milestones.tsx) — Add timeline visualization
- New: `components/ProjectTimeline.tsx`

---

## Execution Order

> [!IMPORTANT]
> Each phase must be completed before the next starts, as later phases depend on the sidebar and routing changes from Phase 1.

1. **Phase 1** — Sidebar + client workspace restructure + view-as-client
2. **Phase 2** — Document shelf fixes + calendar
3. **Phase 3** — Discovery questions + AI transcript strategy
4. **Phase 4** — Contract/invoice builder + project timeline

Shall I proceed with Phase 1?
