# ADR 0008 — Camera look-ahead and keeping the whole leader on the map

Status: accepted (creative director, 2026-10-15)

## Context
At the M2 playtest the creative director found movement good, but the wizard was cut off up to its
feet at the top map edge, and the camera should pan further ahead when moving. The M2 camera only
had a deadzone follow, so at full speed the camera trailed 61 px behind the leader.

## Decision
- **Look-ahead:** the camera aims at the leader plus a smoothed offset of moveVector ×
  `lookAheadPx`. The offset eases with `lookAheadHalfLifeMs`. The deadzone and the world clamp apply
  to that point. `CameraTuning` gains both fields (contract change). Values: 112 px and 250 ms. That
  gives about a 50 px lead sideways and 70 px vertically (lead ≈ lookAheadPx − half-deadzone − follow
  lag). 64 px was tried first, but it only cancelled the trail (+2.6 px lead).
- **Edge clamp:** the leader can't walk closer to the top map edge than its sprite extent above the
  feet (46 px). The sides and bottom stay at the body radius (10 px). The camera still never shows
  space outside the map.
- **Crosshair:** stays debug-only (`?debug` or backtick) until the HUD milestone adds a gameplay aim
  reticle.

## Consequences
- In M7, look-ahead should follow actual displacement, not input. Otherwise the camera leans into
  walls while the leader is blocked.
- In M7, every map gets a blocker perimeter at least 3 tiles deep (to propose to level-designer),
  which makes the edge clamp redundant on real maps.
- At the side edges the staff and robe can still clip by a few px. That's accepted for now.
