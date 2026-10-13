# ADR 0007 — Approved contract additions and level features

Status: accepted (creative director, 2026-10-13); each item is applied when its milestone opens

## Decision
Contract changes (src/core/types.ts, src/game/events.ts), producer-applied at the named milestone:
- `unit:died` carries `cause: 'combat' | 'volunteer' | 'left-behind'`, `deathVariant`
  (`'charred' | 'electrified' | 'blood'`) and `gibbed: boolean`, all resolved by core. Damage sources
  get `canGib` and an optional `deathVariant` override (M4).
- The data shapes listed in mvp.md §15 (DamageElement, ClassDef/SpellDef/ConvergenceDef/ReactionDef
  fields) are applied in M4–M6.
- Optional `MissionDef.start: { spawnId }` and wave entries with `aggro: 'radius' | 'always'` (M7).

Level features:
- A 3 s skippable intro camera pan from start to portal and back, and an off-screen arrow to the
  portal while it's sealed (dim) and open (bright).
- Tiled conventions as in docs/design/levels/tiled-conventions.md, including the new trigger.event
  values and the goblin-hut property overrides, which game-dev implements in M7.

## Consequences
docs/design/levels/m01-goblin-woods.md (beat chart, about 6–9 min, about 55 enemies, 16 kegs) is the
M7 build target. tech-artist must confirm the atlas names and publish the door, rune-socket and
staff-tip offsets from asset-list.md before M8.
