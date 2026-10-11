---
name: review-gate
description: Final review of an Arcane Fodder milestone or phase before the human playtests, commits and tags it. Use when the user says /review-gate or a milestone's tasks are all complete.
argument-hint: M<N> | preproduction
---
# Review gate: $ARGUMENTS

1. Ask the `reviewer` teammate (spawn it with agent type reviewer if it isn't running) to:
   - Walk every "Done when" criterion for $ARGUMENTS in plan.md and mark each PASS/FAIL with evidence.
   - Review the full diff since the previous tag against CLAUDE.md.
   - Run an automated playtest when browser tooling is available; attach screenshots and console output.
   - Write docs/reviews/$ARGUMENTS-gate.md.
2. Route every blocker to its owner by name and wait for fixes. Re-run step 1 for fixed items only.
3. Present to the human:
   - The gate verdict and remaining notes.
   - A 5-minute playtest script: what to try, what should happen, and the feel questions only a human can answer ("is the Firestorm satisfying?", "does losing a mage sting?").
   - The proposed commit message and tag `m<N>`.
4. Stop. The human playtests, commits and tags. Record their feel feedback in docs/decisions/ if it changes design.
5. Shut down the team.
