# ADR 0004 — Art direction: Warcraft-style, 48×48 characters, 640×360 view

Status: accepted (creative director, 2026-10-13)

## Context
Pre-production style lock went through three rounds. v1 (lush, chibi, 32×32) was rejected as too
childish; v2 (dark, Diablo-like) as too dark. The creative director asked for grizzled, Gandalf-like
wizards and a Warcraft look with brighter colours.

## Decision
- Look: bold, colourful, stylised pixel art in a Warcraft-like style (chunky, exaggerated shapes,
  rich saturated colour). Never childish, grim or photoreal. The ground stays calmer than units,
  spells and FX. Humour lives in the writing (names, barks, Hat Hill), not the visuals.
- Wizards are grizzled veterans (beards, tall wide-brimmed hats, gnarled staffs). Goblins are mean,
  lime-skinned and big-eared; the ears are the goblin cue (orcs stay post-MVP).
- Characters are 48×48 on a 16 px tile grid. The game view stays 640×360 (clean ×2/×3/×4 scaling).
- Locked references in assets-src/concept/style-lock/: Pyromancer v2 "Stout" (shared wizard body),
  Goblin Grunt v3 "Axe" (shared goblin body), forest tiles v1–v3 as one set (tech-artist warms the
  v2 grass toward v1's olive at palette snap). Rejected rounds: style-lock/_rejected-v1/ and raw/*/v2/.
- plan.md §2, §3.1 and §11 and .claude/agents/art-director.md were updated to match.

## Consequences
style-guide.md v3.1, readability.md rev 3 and asset-list.md v3.1 are the binding art specs. Size-
dependent gameplay numbers were rescaled (see ADR 0005). The Stormcaller and Goblin Archer still need
concept passes from the locked references before sprite production.
