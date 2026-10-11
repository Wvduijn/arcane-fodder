---
name: preproduction
description: Run Arcane Fodder pre-production with an agent team — game design doc, style lock, level conventions and MVP asset list. Use when starting the project or a new content batch, or when the user says /preproduction.
---
# Pre-production

You are the producer (team lead). The human is creative director and approves the exit gate.

## 1. Prepare
Read CLAUDE.md and plan.md §1–§4, §8 and §11. Create the shared task list below with dependencies.

## 2. Spawn the team
Create an agent team with exactly these teammates, named exactly as written:
- `game-designer` (agent type game-designer)
- `art-director` (agent type art-director)
- `level-designer` (agent type level-designer)

Give each the spawn context: "MVP scope only (plan.md §8). Deliverables are files, listed in your tasks. Message teammates by name when your work affects theirs."

## 3. Tasks
| # | Owner | Deliverable | Depends on |
|---|---|---|---|
| 1 | game-designer | docs/design/gdd/mvp.md — rules, formulas, open questions for every MVP mechanic | – |
| 2 | game-designer | docs/design/gdd/readability.md — silhouette and colour needs per class/enemy | 1 |
| 3 | art-director | assets-src/style-guide.md + Higgsfield prompt block | 2 |
| 4 | art-director | Style-lock set in assets-src/concept/: Pyromancer, Goblin Grunt, forest tiles (3 variations each) | 3 |
| 5 | level-designer | docs/design/levels/tiled-conventions.md — layer/object names and properties | – |
| 6 | level-designer | docs/design/levels/m01-goblin-woods.md — beat chart and layout sketch | 1, 5 |
| 7 | level-designer + art-director | docs/design/asset-list.md — every MVP sprite, tile, prop and FX (plan.md §11) | 4, 6 |

Encourage debate: the art director challenges readability claims; the level designer challenges pacing against the GDD.

## 4. Exit gate (stop and ask the human)
Present: open design questions with recommended answers, the 3 style-lock variations per asset, and the beat chart.
Do NOT start production. When approved, record decisions in docs/decisions/ as ADRs and shut the team down.
