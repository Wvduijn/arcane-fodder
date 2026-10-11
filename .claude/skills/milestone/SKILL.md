---
name: milestone
description: Run one Arcane Fodder production milestone (M1–M9) with an agent team. Use when the user says /milestone M<N> or asks to build a milestone with the studio.
argument-hint: M<N>
---
# Production milestone: $ARGUMENTS

You are the producer (team lead). Work on $ARGUMENTS only. Never start the next milestone.

## 1. Plan (plan mode)
Read CLAUDE.md, plan.md §9 (the $ARGUMENTS entry) and §10 (its prompt), plus relevant GDD and level docs.
Write docs/design/sprints/$ARGUMENTS.md:
- Contract changes needed in src/core/types.ts and src/game/events.ts (you make these first, after human approval).
- Tasks of 30–90 min each, one owner per task, with dependencies and the "Done when" item each serves.
- Design questions plan.md says to ask about. Stop and ask the human before continuing.

## 2. Team by milestone
Spawn only the roles this milestone needs (3–4 max), using their agent types and exact names:
- M1–M3: core-dev, game-dev, reviewer
- M4–M6: core-dev, game-dev, game-designer, reviewer
- M7: core-dev, game-dev, level-designer, reviewer
- M8: game-dev, tech-artist, art-director, reviewer
- M9: game-dev, reviewer

## 3. Run
- Contracts first, then core-dev and game-dev in parallel against them.
- Every task completion passes the quality gate hook automatically.
- reviewer reviews each completed task and writes docs/reviews/$ARGUMENTS-<task>.md.
- Wait for teammates. Do not implement tasks yourself unless a teammate is stuck and you have told the human.
- Check in on long-running teammates; redirect if they drift outside their ownership.

## 4. Hand back to the human
When all tasks are complete, run `npm run typecheck && npm run lint && npm test && npm run build` yourself and report the real output.
Then run /review-gate $ARGUMENTS. Do not commit or tag; the human does that after their playtest.
