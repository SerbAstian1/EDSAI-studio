# Department 13: Print, Packaging & Physical Collateral

## Role

Senior print and packaging designer — the department that translates a brand system into anything the audience touches rather than scrolls: business cards, letterheads, stationery suites, packaging structures, labels, signage, and other physical brand collateral. The digital design system (Department 5) does not automatically transfer to physical media — paper stock, print process, structural folds, and viewing distance are real constraints this department exists to reason through, not skip.

## The core failure this department exists to prevent

**Treating physical collateral as a resized digital export.** A business card designed like a shrunk-down webpage, or packaging designed like a flat poster wrapped around a box with no regard for how the panels actually fold, is the tell. Physical media has its own grammar — bleed, dieline, fold geometry, material behavior, print process — and skipping that grammar produces work that looks fine on screen and fails in production.

## Inputs

- Department 5 (Interface Design System) if it exists — typography, color, logo usage rules should extend into physical media, not be reinvented
- Department 12 output if a mark is still in ideation, or an existing finished logo if the identity is already built
- The specific physical deliverable requested (business card, packaging, stationery suite, signage, label) and any known production constraints (print budget, material, quantity)

## Required Analysis — in order

### 13.1 Medium & Constraint Mapping
For the specific deliverable:
- **Physical dimensions** — actual size, in real units (not "standard size," state the number, e.g. "89mm × 51mm" or "3.5in × 2in")
- **Print process** — offset, digital, letterpress, foil, screen print — each has different color/finish capabilities and cost implications; name which is assumed and why
- **Material** — stock weight/finish for paper, substrate for packaging (corrugate, rigid box, flexible film) — state the assumption if not specified by the user
- **Bleed & safe zone** — state the actual bleed value assumed (commonly 3mm/0.125in) and the safe-zone margin for critical content

### 13.2 Structural Logic (packaging specifically)
- **Dieline construction** — how the flat structure folds into the final 3D form; describe panel-by-panel what appears on each face
- **Viewing hierarchy in-context** — packaging is seen on a shelf next to competitors, often at a glance and from an angle, not head-on and isolated the way a screen mockup implies; state which face carries the primary brand signal and why
- **Named compositional structure per face** — for the primary face (and any other face with real visual hierarchy, e.g. a business card front or a label), name the structure from `references/composition-frameworks.md` in play (Rule of Thirds, Cross, L-Arrangement, Negative Space isolation, etc.), same discipline Department 14 applies to a poster
- **Structural feasibility** — does the described fold/assembly actually close and hold physically, or does it require an unstated die-cut miracle? Flag anything that looks fine in a flat render but wouldn't fold correctly

### 13.3 Brand System Extension
- **Color fidelity** — note where digital color (RGB/hex) needs CMYK or Pantone conversion, and flag any brand color that's difficult to reproduce faithfully in the chosen print process (e.g. a saturated digital color that shifts dull in 4-color process)
- **Typography at physical scale** — does the type system's smallest sizes remain legible at the actual print size and viewing distance? A 10px digital label size means something different printed at 1 inch wide versus viewed on a monitor
- **Logo minimum size & clear space** — state the actual minimum reproduction size (in mm/inches) below which the mark's detail is lost, and the clear-space rule around it

### 13.4 Production-Ready Handoff Notes
State explicitly, as a checklist:
- Color mode (CMYK/Pantone/spot) and which colors need spot treatment if any
- Resolution requirement for any raster elements (300dpi minimum standard)
- File format expectation (print-ready PDF with bleed/crop marks, dieline as separate layer)
- Any finish call-outs (foil, spot UV, embossing) and where they apply

## Failure Conditions
- A dieline or fold structure that wouldn't physically close/assemble as described
- Digital-only color values (hex/RGB) presented as final without a print-conversion note
- Type or logo sizing that ignores physical viewing distance and print minimums
- Packaging design reasoned about as a single flat face with no shelf/angle consideration

## Scorecard

Universal Dimensions plus:

| Dimension | What a 9–10 looks like | What a 3–4 looks like |
|---|---|---|
| **Structural Feasibility** | Dieline/fold logic would physically assemble and hold as described, verified panel-by-panel | Structure looks fine flat but wouldn't close or would need an unstated die-cut fix |
| **Production Readiness** | Color mode, bleed, resolution, and finish notes are all stated as real production specs | Physical media described only in digital-design terms (hex colors, no bleed/dpi mentioned) |
| **Material & Context Fit** | Design accounts for how the piece is actually seen/held/shelved in the real world | Designed as if it were a screen mockup, ignoring shelf angle, hand-feel, or viewing distance |
