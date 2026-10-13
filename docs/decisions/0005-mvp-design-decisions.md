# ADR 0005 — MVP design decisions from pre-production

Status: accepted (creative director, 2026-10-13)

## Context
docs/design/gdd/mvp.md §17 listed the open questions for every MVP mechanic. The questions marked
ASK, plus the scale changes from ADR 0004, needed creative-director approval.

## Decision
- Q1: damage never interrupts the Convergence channel. Deaths during it lower power and can change
  the combo at strike.
- Q2: Kaboom hurts the squad at half damage (30).
- Q6: the Volunteer! Arcane Detonation sets off powder kegs.
- Q8: extraction radius 112 px, with the leader triggering within 24 px (the 48 px trail is 78 px long).
- R8: veteran-looking wizards keep silly names and "rookie" Volunteer! barks, as a running gag.
- All other mvp.md §17 answers (Q3–Q5, Q7, Q9–Q21) stand as recommended, including
  chargeOnPortalOpen = 50 (Q20) and area hits tested against the body, not the centre (Q21).

## Consequences
mvp.md and readability.md are the binding rules. Numbers move into src/data in the milestone that
first uses them (M4–M7). Playtest requests for the reviewer are listed in mvp.md §16.
