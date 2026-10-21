# ADR 0006 — Elemental enemy deaths, gore and gibs

Status: accepted (creative director, 2026-10-13)

## Context
At the exit gate, the creative director asked for enemy deaths with some gore (burning, electrified,
blood) and gibs. plan.md §2 previously said "never gory".

## Decision
- The killing blow decides the death: fire = charred, storm = electrified (one skeleton-flash frame,
  the only place a skull appears), physical/arcane/Kaboom = blood with a splat decal.
- Gibs: Kaboom, Volunteer! and Convergence kills of at least 1.5× max HP burst a goblin into a few
  cartoon pieces (weapon, ear, bones, meat). At most 4 gibbed goblins per blast and 32 pieces live.
- Corpses, decals and gibs are visual only, pooled, time-limited and engine-spawned (never Tiled
  decals). Blood is a reserved dark maroon, distinct from the fire hues. Wizard deaths stay non-gory.
- A "Gore: on/off" setting, on by default. Off = collapse plus a neutral puff.
- Flash safety: at most 3 skeleton flashes within any 1000 ms (readability §1.9; aligned in M6, CD 2026-10-21).
- plan.md §2 and .claude/agents/art-director.md were updated.

## Consequences
The store age rating likely rises (PEGI 12/16); decide it before M9. Details are in mvp.md §12a,
readability.md §4a, style-guide.md §7.1 and asset-list.md.
