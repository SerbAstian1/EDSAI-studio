# Client-Ready Summary Mode & Score-Drift Self-Audit

Two closing steps that run downstream of Department 11 (Final Arbitration). Neither is a new department, neither changes the 11-department pipeline or the scorecard rubric — both operate on output that has already reached FINAL.

---

## A. Client-Ready Summary Mode

### The problem it solves
A full-pipeline internal document commonly runs 10,000+ words because every department shows its reasoning and scorecard in full — correct for the audit trail, but no real client reads an 11-department scorecard document. Without a defined translation step, that translation happens ad hoc and inconsistently every time.

### When to run this
After Department 11 reaches **FINAL** on a full-pipeline (or substantial scoped) project, and the user's stated audience is the client rather than internal use — produce a **second, separate artifact**: the Client Summary.

**Never replace the full internal document with this.** Produce both. Present the Client Summary first, and keep the full pipeline document available if the user asks for it or wants to hand it to internal collaborators.

**Gate condition:** if a Blocker or Major issue from Department 9 is still open, the Client Summary does not get written yet. Needing to write one anyway is a signal the internal FINAL gate wasn't actually met — go back and close the gap first.

### Client Summary structure (target: under 600 words)

1. **What we built and why** — 2–3 sentences, positioning and the single strategic bet, no department jargon
2. **The work, shown not scored** — the actual deliverable (copy, screens, logo direction, poster, packaging concept, description of the system) with zero visible numbers
3. **What we deliberately chose not to do** — 1–2 sentences on the strongest rejected alternative, framed as a decision made on the client's behalf, not a hedge
4. **What to expect technically** — plain-language versions of only the measurable targets that affect the client's actual experience of the deliverable (load speed, mobile behavior, accessibility for digital; print-readiness, material/finish behavior for physical) — translate jargon into outcomes: "loads in under 2.5 seconds on mobile," not "LCP <2.5s"; "prints cleanly at full bleed with no color shift," not "CMYK gamut-mapped, 3mm bleed verified"
5. **One open question, if any** — anything Department 11 flagged as an assumption that should be confirmed before shipping or sending to print

### Hard rule
No 1–10 scores, no department names, no "Blocker/Major/Minor" language anywhere in the Client Summary. This document is for a person who never asked to see the machinery — it's the deliverable and the reasoning behind it in plain language, not the audit trail.

---

## B. Score-Drift Self-Audit (anti-clustering check)

### The problem it solves
"Never default to 7" is stated as a rule in `00-scorecard.md`, but nothing mechanically checks whether it was followed. Under time or token pressure across 11+ departments, scores can drift toward safe, similar-looking numbers (7s and 8s everywhere) without any single department consciously "defaulting" — the failure happens distributed across departments rather than as one lazy score.

### When to run this
Before Department 11 finalizes, on every full-pipeline run and on any scoped run touching three or more departments.

### The mechanical pass
1. **List every Universal Dimension score across all departments in one place.** This should already exist as the raw material for the Section 6 mean in `00-scorecard.md` — this step just looks at the full list before collapsing it to a mean.
2. **Flag clustering**: if more than 70% of all scores fall within a 2-point band (e.g. everything is 7 or 8), that's a clustering flag. Not an automatic failure — but it requires an explicit one-line explanation of why the work is genuinely that evenly strong (or weak). Evenly-good-across-every-discipline is rare in real agency work; more often it indicates under-differentiated scoring than under-differentiated work.
3. **Flag suspiciously matched justifications**: if two different departments' one-sentence justifications share near-identical structure ("X does a good job of Y for the brand"), that's a signal the justification was generated to satisfy the rule rather than to actually explain the number. Reopen and rewrite both.
4. **State the audit result in Final Arbitration**, alongside the existing aggregate scoring, as one line:
   - `"Score-drift check: no clustering detected, scores range 4-9 across departments."`
   - `"Score-drift check: clustering flagged in Depts 3, 5, 6 (all scored 7-8) — reviewed and confirmed genuine, see notes."`
   - `"Score-drift check: clustering flagged in Depts 4, 7 — justifications rewritten, Dept 7 UI Design System revised from 8 to 6 on Token Discipline."`

### Rule
This is a five-minute mechanical check, not a new department and not new rubric dimensions — it exists to make the already-stated "never default to 7" rule actually enforceable instead of aspirational. Skipping it on a full-pipeline run means Department 11's aggregate mean can't be trusted at face value.
