# GDD — MVP rules (Goblin Woods)

Owner: game-designer. Source of truth for scope: plan.md (§2–§4, §8). This file turns those
sections into rules, formulas, starting numbers and edge cases. MVP content only.

Status: **pre-production draft.** Every number below is a *proposed starting value*. Each one
gets a matching entry in `src/data/*.ts` (`as const satisfies`) in the milestone that first
needs it (M4–M7). Until then this file is the only place the number lives. If data and this file
disagree, data wins and this file gets fixed.

## 0. Conventions

| Unit | Meaning |
|---|---|
| px | world pixels. Tile = 16 px. Character frame = **48×48** (direction change 2026-10-13). View = 640×360 (40×22.5 tiles). |
| px/s | speed |
| ms | durations and cooldowns (Phaser clock only) |
| HP | hit points, integers |

- **Damage element** of every damage source: `fire`, `storm`, `arcane` or `physical`. Reactions
  key off this. (Proposed type `DamageElement`; see §15.)
- **Teams:** `squad` (wizards), `enemy` (goblins, huts). Powder kegs are `neutral`.
- **Deterministic order:** when several things resolve on the same frame, they resolve in
  ascending EntityId order. Ties in "nearest" targeting also break by lowest EntityId.
- "Squad" means the wizards currently in the trail. A volunteer leaves the squad when Volunteer!
  is activated (§11).
- **Kill credit:** every enemy death caused by a squad-side source (auto-attack, spell, Burning,
  Combust, Kaboom, Convergence, Arcane Detonation) counts as a squad kill for the score and the
  meter. A Kaboom started by anything counts as squad-side.

### Scale rules (48×48 characters)
- **View-bound distances don't change:** attack and cast ranges, aggro, hut activation, surge spawn
  distance and speeds. The view is still 640×360 and the tile is still 16 px, so how far ahead the
  player can see and react is the same. (If the view resolution changes, these get re-checked.)
- **Body-bound distances scale:** trail spacing, separation, melee reach, knockback, footprints
  and extraction.
- **Body radius.** Every unit has a collision circle at its feet, used for separation, contact and
  area hits:

  | Unit | `bodyRadiusPx` |
  |---|---|
  | Wizard (all classes) | 10 |
  | Goblin Grunt | 12 |
  | Goblin Archer | 10 |
  | Powder Keg | 8 (`KEG.bodyRadiusPx`) |
  | Goblin Hut | footprint rectangle (closest point) |

- **Area hit rule:** an area effect hits a target when `distance(centre, target) ≤ radiusPx +
  target.bodyRadiusPx`. In other words, the ring only has to touch the body, not the centre. At
  48 px sprites, a goblin half inside the ring and *not* getting hit would look like a bug. The FX
  and the telegraph ring are drawn at `radiusPx`.
- **Projectile hit radius:** fire bolt, spark and arrow 4 px; Fireball 6 px. A projectile hits when
  its circle overlaps a body.

### Feel targets for the whole mission
- A full run of Goblin Woods takes **6 min (fast) to 9 min (cautious)**. Three sections: start →
  Hut A, Hut A → Hut B, Hut B → portal (final surge). Length comes from encounter count
  (about 13 encounters, about 55 placed enemies plus hut spawns), not from a slower squad (Q19).
  Reviewer measures it.
- Convergence is ready **about once per section**, and the surge always starts with at least half a
  meter (Q20). That's 3–4 casts per mission.
- An average player loses **1–2 wizards** per run. A careless player loses the mission in
  the final surge.

---

## 1. Squad follow

**Intent.** You steer one wizard and the others trail behind like ducklings. They never fight the
player for control, and they never bunch up or jitter.

**Rules**
- The squad is an ordered list. Index 0 is the leader; index 1..n are followers in trail order.
- The leader moves at `squad.moveSpeed` (see Q9). Diagonals are normalised.
- The leader drops breadcrumbs every `trail.breadcrumbSpacingPx`. Follower *k* steers toward the
  breadcrumb `k × trail.followerSpacingPx` behind the leader, measured along the trail.
- Separation steering pushes wizards apart inside `trail.separationRadiusPx`.
- If a follower is more than `trail.catchUpDistancePx` from its slot, it moves at
  `squad.moveSpeed × trail.catchUpMultiplier` until it's back in place.
- When the leader stops, followers stop at their slots. They don't creep into the leader.
- All wizards (leader included) auto-attack while moving (§3).
- No teleporting, ever (MVP DoD).

| Key | Value |
|---|---|
| `trail.breadcrumbSpacingPx` | 4 |
| `trail.followerSpacingPx` | 26 |
| `trail.separationRadiusPx` | 20 (= 2 × wizard body radius) |
| `trail.catchUpDistancePx` | 48 |
| `trail.catchUpMultiplier` | 1.3 |
| `trail.arriveRadiusPx` | 16. Inside this distance a follower slows linearly to its slot, so it settles instead of overshooting. |
| `trail.stopRadiusPx` | 3. Within this of a slot at rest, a follower stops dead: no creep, no jitter when the leader stands still. |
| `trail.separationMaxSpeedFactor` | 0.5 (× `squad.moveSpeed`). Caps the separation push so wizards ease apart rather than pinball. |

The last three keys were approved by the CD on 2026-10-15 (M3 Q5) as starting values, tuned at the
M3 playtest. Data: `src/data/trail.ts` (`TRAIL`, type `TrailTuning`).

Full-squad trail length = 3 × 26 = **78 px** (about 5 tiles). The portal radius (§13) depends on this.
Spacing 26 is greater than the 20 px body diameter and the about 20 px wizard sprite width (style guide
v2.0), so wizards in a line never overlap. Only the hats and staffs cross, which reads as a tight squad.

**Edge cases**
- A follower stuck behind an obstacle keeps following the breadcrumbs. Breadcrumbs only go where
  the leader walked, so the path is always walkable. Out of scope: path-finding around new blockers.
- A wizard dies: everyone behind it moves up one slot. Their slot targets change and they walk
  there (no snapping).

**Verify.** Walk circles, zig-zags and stop-starts for 60 s. No two body circles overlap by more
than 6 px, no follower oscillates when the leader is still, and none gets more than 96 px from its
slot in open ground.

## 2. Leader succession

**Intent.** Losing the leader is a jolt, not a game over: "Next!"

**Rules**
- When the leader dies, index 1 becomes leader immediately (`squad:leader-changed`). The trail
  compacts.
- Input carries over unchanged (held movement keeps moving the new leader).
- The camera eases to the new leader over `succession.cameraEaseMs`.
- No invulnerability window.
- The leader can't volunteer, so succession only happens through combat death.

| Key | Value |
|---|---|
| `succession.cameraEaseMs` | 300 |

In code the key is `successionEaseMs` in `CameraTuning` (`src/data/camera.ts`, `CAMERA.successionEaseMs`).

**Edge cases**
- The leader and index 1 die on the same frame: promote the lowest surviving index.
- The leader dies during the Convergence channel: see §10.
- The leader dies in the same frame the portal triggers: extraction is checked after deaths. The new
  leader has to reach the portal itself.

**Verify.** Debug-kill the leader 3 times in a row while moving: control never drops, the camera
never jumps, and defeat triggers only when the 4th wizard dies.

---

## 3. Auto-attacks

**Intent.** Pyromancers are slow, heavy and set things on fire. Stormcallers are a fast, light
stream of hits. Together they set up Combust without the player doing anything. That teaches
the reaction before the player learns to aim it.

**Targeting (all wizards, leader included)**
- Pick the nearest living enemy **unit** within `rangePx`. Re-evaluate every
  `targeting.retargetMs`, or immediately when the target dies.
- If there's no unit in range, target the nearest **Goblin Hut** in range.
- Never auto-target Powder Kegs (Q12).

**Projectiles**
- Auto-attack projectiles fly straight toward the target's position at fire time (no homing).
- They hit the first enemy unit or hut they overlap. They pass through kegs and wizards.
- They stop on collision tiles and expire at `rangePx × 1.2` travel.

| Class | maxHp | Attack | dmg | Element | cooldownMs | rangePx | projectile px/s | Applies | knockback px |
|---|---|---|---|---|---|---|---|---|---|
| Pyromancer | 60 | Fire bolt | 8 | fire | 900 | 180 | 240 | Burning | 6 |
| Stormcaller | 50 | Spark | 4 | storm | 400 | 160 | 360 | — | 0 |

| Key | Value |
|---|---|
| `targeting.retargetMs` | 250 |
| `combat.projectileRangeFactor` | 1.2 (autos expire at `rangePx × 1.2`) |
| `combat.knockbackMs` | 120. Knockback is eased over this long, never a teleport. CD-approved 2026-10-16, M4 Q3. |
| `combat.maxFrameDtMs` | 100. Gameplay dt is clamped to this (tab switch, hitch), so cooldowns, ticks and projectiles never jump. CD-approved 2026-10-16, M4 Q3. |

Per-class `moveSpeed` (Pyromancer 110, Stormcaller 120) is kept in data for post-MVP only; the squad
moves at one speed (Q9).

Data: `src/data/classes.ts` (`CLASSES`), `src/data/combat.ts` (`COMBAT`).

Sustained single-target DPS: Pyromancer 8.9 + Burning 6 = **~15**. Stormcaller **10**, plus about
one Combust per second per Pyromancer and Stormcaller pair (measured in the M5 sweep: mean 1.13,
max 1.38). Full squad on one target is about 50 DPS.

**Edge cases**
- The first attack fires as soon as a target is acquired, if the cooldown is ready. Cooldowns tick
  while moving.
- A dead wizard's projectiles already in flight still resolve.

**Verify.** Place 6 grunts in a group. With no player input, the squad kills them, Burning shows
on targets, and at least one Combust triggers (Combust from M5 on).

**No-input targets** (CD 2026-10-19, M5 T6 M1). Two targets, because reactions change the clear
time:

| Mode | Targets, every run (3 seeds × 30/60/144 fps), `DEV_ENCOUNTER` grunt pack |
|---|---|
| Reactions **off** (autos only, M4 cases) | Clear in 3–5 s (§16 request 1). Measured: 3.80–4.50 s |
| Reactions **on** (M5 default) | (1) ≥ 1 grunt melee swing lands, and the first landed swing comes **before** the clear. (2) Clear time **≥ 2.3 s and ≤ 5.0 s**. (3) Combust rate over the fight (Combusts from spawn to clear ÷ clear time) **≥ 1.0 and ≤ 3.0 per second for the squad**, i.e. 0.5–1.5 per pair. (4) ≥ 1 wizard alive, D4 invariants hold. Measured at Combust damage 3: clear 2.33–2.75 s, 1.82–2.75 Combusts/s squad, 1–2 swings in 9/9 runs, 0 wizards lost |

*Feel:* the swarm reaches the squad and gets a swing or two in. Combust is the pop-and-spread that
sets the pack burning, not what deletes it. The 2.3 s floor is tight (the fastest run is 2.33 s):
any data change that speeds up the fight should re-run the sim.

**M4 dev encounter (D2)** (`DEV_ENCOUNTER` in `src/data/devArena.ts`, M4 Q1). Squad P,S,P,S (Q18) at
the arena centre, followers trailing south. Offsets are from the leader's spawn:
- **6 grunts**, a 3×2 grid 32 px apart (x −32/0/32, y −210/−178), so the bodies (24 px) don't
  overlap. Every grunt is 178–213 px from the leader, inside grunt aggro (220): the whole pack charges
  at once. *Feel:* a swarm runs in, the Pyromancers set the front row burning, the sparks finish
  them. The squad should win with **no input**, ≥ 1 wizard alive, in under 30 s (targets in the
  no-input table above: 3–5 s autos only, 2.3–5.0 s with reactions).
- **2 archers**, 400 px east (y −24/+24), outside archer aggro (260) of every wizard at spawn. They
  stay idle until the playtester walks over, then keep range and outshoot the autos. *Feel:* "I
  have to push in." It's the manual archer check, not part of the no-input win.
- *How to verify:* headless core sim (60/30/144 fps, 3 seeds) and the reviewer's in-game run both
  end with every grunt dead and ≥ 1 wizard alive, zero input. Then walk east: archers wake inside
  260 px and retreat below 120 px.

---

## 4. Granted spells: Fireball and Lightning

**Intent.** Fireball is the crowd answer: lob it into a pack. Lightning is the scalpel: pick off
an archer behind cover. They have different cooldowns so you weave them.

**Slots.** Slot order is fixed by class order in data. Slot 1 = Fireball (Pyromancer), slot 2 =
Lightning (Stormcaller). An empty or lost slot is shown greyed out (plan §6).

**Common rules**
- Cast at the aim point, which is converted to world coordinates. The aim point is clamped to
  `spells.maxCastRangePx` from the leader.
- Spells originate from the **leader's** position, whoever the leader is (Q11).
- Casting doesn't stop movement.
- Player spells do no damage to wizards (friendly fire is a post-MVP Hardcore mode).
- Blocked while the Convergence channel is running. Cooldowns keep ticking.

| Key | Value |
|---|---|
| `spells.maxCastRangePx` | 280 |

| Spell (`SPELLS.<id>`) | `slot` | `element` | `damage` | `radiusPx` | `cooldownMs` | `delivery` | `applies` | `knockbackPx` | `canGib` |
|---|---|---|---|---|---|---|---|---|---|
| `fireball` | 1 | fire | 28 | 44 | 3500 | `projectile`, `speed` 260 px/s, `projectileRadiusPx` 6; explodes on first contact with an enemy unit, hut, keg or collision tile, or on reaching the aim point | burning | 24 | false |
| `lightning` | 2 | storm | 30 | 8 | 2000 | `strike`, `telegraphMs` 250 at the aim point, then strike; ignores obstacles | — | 0 | false |

Data: `src/data/spells.ts` (`SPELLS`, type `SpellDef`; `SPELL_TUNING.maxCastRangePx`, type
`SpellTuning`). The key `spells.maxCastRangePx` above is `SPELL_TUNING.maxCastRangePx` in code.
Collision tiles stop Fireball from M7 (M5 Q1). M5 edge rules (CD-approved 2026-10-16, M5 Q4): a
spell pressed on cooldown does nothing (no shake, the HUD sweep already says why); no cast until the
pointer has been over the game once; a Fireball in flight or a pending Lightning still lands if the
leader dies or the spell is lost after the cast.

Lightning (30) one-shots an Archer (18 HP) and a Grunt (24 HP). That's the "snipe with Lightning"
lesson. Its small radius and 2 s cooldown keep it from clearing packs. With the area hit rule, its
effective reach is 18–20 px: one goblin, rarely two touching ones. Fireball's effective reach on a
grunt is 56 px, about 5–6 grunts in a pack.

**Edge cases**
- Lightning hits whatever is inside the radius **at strike time**, not at cast time.
- Lightning on a Burning target triggers Combust. Fireball on a keg triggers Kaboom (§7).
- Casting a lost spell does nothing: no sound, no cooldown. The slot gives a short "denied" shake.

**Verify.** At 4 camera scroll positions (map corners), Fireball and Lightning land within 2 px of
the cursor's world position.

## 5. Spell availability (derived)

**Rule.** `availableSpells = unique(grantsSpell of each class among living squad members)`.
It's never stored. It's recomputed (or memoised on squad change) from the squad list.

- When the last wizard of a class leaves the squad (death or volunteer activation), emit
  `spell:lost` once for that spell.
- A volunteer leaves the squad **when activated**, not when they detonate (§11). The slot greys
  out the moment the player commits.
- A lost spell never comes back within a mission (no recruitment in the MVP).

**Verify.** Tests cover all compositions {P, S, PP, SS, PS, PPS, PSS, PPSS}: slot state matches
the classes present. With squad P,S,P,S, volunteering twice keeps both spells. Volunteering twice
with P,P,S,S loses Lightning.

---

## 6. Burning (status)

**Intent.** A lingering "this one's cooked" marker that sets up Combust.

| Key | Value |
|---|---|
| `burning.tickDamage` | 3 (fire) |
| `burning.tickMs` | 500 |
| `burning.durationMs` | 3000 |

Total damage: 6 ticks × 3 = **18**. Data: `src/data/statuses.ts` (`STATUSES.burning`).

- First tick at `tickMs` after application (no tick on apply).
- **Reapply refreshes the duration and keeps the tick phase.** No stacking, so fast refreshing
  can't buy extra ticks.
- Applies to enemy units and huts. Huts burn (they're thatch).
- In the MVP Burning never lands on wizards: no enemy uses fire, and Kaboom only applies Burning
  to non-wizards (§8).
- Removed on death. Burning ticks don't trigger Combust because they're fire, not storm.
- **Credit:** tick damage is credited to the unit that applied (or last refreshed) the Burning, so a
  tick kill counts as a squad kill for the score and the meter (§0 kill credit, §9). CD-approved
  2026-10-16 (M4).

**Verify.** Unit test: apply at t=0, reapply at t=1200. Expect ticks at 500, 1000, 1500… with the
last at 4000. Total 8 ticks = 24 damage.

## 7. Combust (reaction: Burning + storm hit)

**Intent.** The squad's two classes are better together. Visible little pops spread fire through a
pack.

**Trigger.** A target with Burning takes a hit whose element is `storm` (spark, Lightning,
Thunderstorm/Firestorm bolt).

**Effect**
1. The storm hit resolves normally.
2. Burning is **consumed** on the origin (Q15).
3. Explosion at the origin: `combust.damage` (fire) to enemy units and huts within
   `combust.radiusPx`, the origin included.
4. Apply Burning to every enemy unit and hut in the radius **except the origin**.

| Key (`REACTIONS.combust.…`) | Value |
|---|---|
| `status` | burning |
| `triggerElement` | storm |
| `consumesStatus` | true (Q15) |
| `blast.element` | fire |
| `blast.damage` | 3 (was 10; CD 2026-10-19, M5 T6 M1 sweep) |
| `blast.radiusPx` | 32 |
| `blast.applies` | burning (every enemy unit and hut hit, except the origin) |
| `blast.knockbackPx` | 0 |
| `blast.canGib` | false |

Data: `src/data/reactions.ts` (`REACTIONS.combust`, type `CombustDef`). Older references to
`combust.damage` and `combust.radiusPx` mean `blast.damage` and `blast.radiusPx`.

- The explosion is fire, so it can't chain Combust by itself. Chains need more storm hits. That
  makes Combust rhythmic, not instant.
  **Damage 3 (CD 2026-10-19, M5 T6 M1).** At 10, the rhythm was fine (about 1 Combust/s per pair),
  but Combust's damage share cleared the dev pack in 1.5–2.2 s, before any grunt reached the squad.
  A sim sweep (damage 10/6/5/4/3, no spread, slower spark) showed 3 is the only damage-only value
  where a grunt swings in every run. The spread is kept: most of Combust's value is now the Burning
  it spreads (18 per target over 3 s), so it *sets up* a pack rather than deleting it. Targets: §3
  no-input table.
  **Watch item:** if a 3-damage pop reads weak at the M5 gate (§16 request 12), the spread-delay rule
  comes back as an **M6 question for the CD**: Burning that came from a Combust can't trigger
  Combust for a short delay (sim at about 1000 ms). That would let the damage go back up to 6–10
  with the spread kept. It needs a `CombustDef` field and core logic.
- A storm hit that kills a burning unit still Combusts at its position (Burning is checked before
  the hit). The origin dies electrified from the storm hit (§12a), then the blast goes off. Agreed by
  the producer and reviewer, M5 T6.
- `reaction:triggered.spreadTo` lists every unit the blast set Burning on, including units whose
  Burning was only refreshed. Each gets an ember arc (readability §5); `status:applied` still fires
  only for new Burning.
- No damage to wizards.
- Two storm hits on the same frame: the first one Combusts and consumes Burning; the second is a
  plain hit.
- A keg inside the radius is triggered (Kaboom), because the explosion is fire.
  - This is the one path where autos light a keg indirectly: a spark on a burning goblin within
    40 px of a keg (32 + keg body 8). Seen in the M5 T11 playtest: the squad stood near the chain,
    the pack charged through, and a Combust lit it. **Intended** (Q12 still holds, since autos never
    target or hit kegs; CD-confirmed 2026-10-19). It's the §8 lesson "keep your squad clear", it's telegraphed by the 300 ms
    fuse ring, and goblins running past your kegs is exactly when you *want* them to blow. §16
    request 4 checks whether it feels fair, at the gate and the CD playtest. If it feels unfair, the
    M6 fallback is "Combust never lights kegs" (a `CombustDef` rule change).

With the area hit rule, Combust's 32 px reaches grunt centres up to 44 px away. That's the
neighbours touching the origin plus the next ring.

**Verify.** Unit test: a burning grunt with 2 neighbours whose centres are 40 px away, hit by a spark. One Combust
event; the origin loses Burning; the neighbours gain Burning; all 3 take `blast.damage` (3).

## 8. Powder Keg and Kaboom

**Intent.** Environmental big bangs that reward aiming, and a reminder to keep your squad clear.

**Keg.** `neutral` structure. 16×16 (1-tile) collision footprint, 32×32 sprite frame (art about 20×24 inside it), blocks movement, isn't auto-targeted (Q12). It
takes no HP damage. It's triggered by any hit or area effect of element `fire` or `storm`, and also
`arcane` (Q6). Physical hits (arrows, melee) do nothing.

**Kaboom**
1. On trigger the keg runs a fuse of `kaboom.fuseMs` (flashing and fizzing; see readability.md).
   A second trigger during the fuse does nothing.
2. When the fuse ends: `kaboom.damage` (fire) to **everything** within `kaboom.radiusPx`: enemy
   units, huts, other kegs (which start their own fuse, giving a cascade) and **wizards at
   `kaboom.squadDamageMultiplier`** (Q2).
3. Apply Burning to enemy units and huts in the radius. Knockback `kaboom.knockbackPx`, including
   wizards.

| Key (`REACTIONS.kaboom.…`) | Value |
|---|---|
| `triggerElements` | fire, storm, arcane (Q6) |
| `fuseMs` | 300 |
| `blast.element` | fire (for reactions and keg chains) |
| `blast.damage` | 60 |
| `blast.radiusPx` | 72 |
| `blast.knockbackPx` | 36 (wizards included) |
| `blast.applies` | burning (enemy units and huts only) |
| `blast.deathVariant` | blood (§12a override) |
| `blast.canGib` | true |
| `squadDamageMultiplier` | 0.5 (a wizard takes 30, Q2) |

| Key (`KEG.…`) | Value |
|---|---|
| `id` | powder-keg |
| `bodyRadiusPx` | 8 (§0) |
| `footprintPx` | 16 (1 tile; solid from M7's collision layer, M5 Q1) |

Data: `src/data/reactions.ts` (`REACTIONS.kaboom`, type `KaboomDef`), `src/data/structures.ts`
(`KEG`, type `KegDef`). Older references to `kaboom.damage`, `kaboom.radiusPx` and
`kaboom.knockbackPx` mean the `blast.` keys.

- 60 damage kills any MVP enemy unit and takes 20% off a hut.
- 30 to a wizard hurts (half a Stormcaller) but doesn't one-shot a healthy one. Two overlapping
  kegs will kill.
- Effective reach: 82 px for a wizard centre and 80 px for another keg. Kegs must be **≥ 96 px**
  from the main route line (the loader minimum). Level-designer places them at ≥ 112 in Goblin Woods.

**Verify.** Unit test: a keg chain of 3 spaced 64 px apart triggers in order, 300 ms apart.
A wizard at 70 px takes 30; a wizard at 90 px takes nothing. Fireball, Lightning, Combust and Arcane Detonation each trigger a keg.
Arrows and grunt hits don't.

**M5 dev arena kegs** (`DEV_KEGS` and `DEV_KEG_PACK` in `src/data/devArena.ts`, M5 Q2). Offsets
are from the leader's spawn, like `DEV_ENCOUNTER` (§3). Every keg is ≥ 112 px from the spawn.
- **Keg chain:** 3 kegs at x −400, y −64/0/+64. Neighbours are 64 px apart (inside the 80 px keg
  reach); the ends are 128 px apart (outside it). So one shot at an end keg fires all three in
  order, 300 ms apart, never all at once.
- **Keg pack:** 4 grunts in a 2×2 grid (x −448/−480, y −16/+16), 32 px apart, just west of the
  chain. The nearest is 448 px from the leader, outside grunt aggro (220) of every wizard at spawn,
  so the no-input D2 fight (§3) is unchanged. All 4 are within reach of the middle keg (centres
  51–82 px, reach 84). It's a separate list from `DEV_ENCOUNTER` so the M4 sim's "every grunt
  dies" check still counts only the north pack.
- **Archer keg:** 1 keg at (+440, 0), 40 px behind the archer pair. Both archers are 47 px away,
  inside the 82 px archer reach. Edge case (M5 T1 review n1): with the leader at exactly the 280 px
  cast range from the keg, the archers hold 200 px from the leader, about 83.5 px from the keg, just
  outside reach. One step closer and they're in. If the playtest shows misses at long range, pack
  the archers to y ±16 (keep the keg where it is: the gap comes from cast range minus the archers'
  `advanceAbovePx`).
- *Feel:* walk west and the pack wakes and charges past the kegs: "Fireball the keg as they run by."
  Walk east and the archers outshoot you: "Lightning the keg behind them." The chain ticking off
  in three beats is the cascade read.
- *How to verify:* (1) the M4 no-input sim still passes and the keg pack stays idle; (2) a Fireball
  fired **from the spawn side (east)** at the south keg of the chain fires the three kegs at t,
  t+300, t+600 ms and kills the pack (blood, most gib). Fired along the chain axis (from due south
  or north), the contact point is within the middle keg's 52 px Fireball reach too, so two kegs
  fuse on the same frame and the chain plays in 2 beats. That's correct, not a bug; (3) one Lightning on the archer keg kills both archers; (4) standing next to
  a keg while it blows costs a wizard 30 HP and pushes them 36 px.

---

## 9. Convergence meter

**Intent.** A reward for fighting well that you spend at the big moment of each section.

| Key | Value |
|---|---|
| `convergence.meterMax` | 100 |
| `convergence.meterStart` | 40 |
| `convergence.chargePerDamage` | 0.1 (damage actually dealt to enemies/huts, overkill excluded) |
| `convergence.chargePerKill` | 4 |
| `convergence.chargePerHutDestroyed` | 10 |
| `convergence.chargeOnPortalOpen` | 50 |

- Charge comes from every squad-side source **except Convergence itself** (no snowballing).
- `chargeOnPortalOpen` is added at `portal:opened`. Someone who spent the meter on the Hut B
  fight still starts the surge at ≥ 50 and has an ultimate during the climax (Q20).
- It clamps at max. `convergence:charged` fires once when it reaches max.
- The meter isn't lost on wizard deaths. It resets on mission start.
- Starting at 40 means the first fight fills it, so the player sees the ultimate early.

Rough check: a section with 12 kills (48) plus about 290 unit damage (29) plus a 300 HP hut (30 + 10)
gives about 117 charge. That's one full meter per section.

## 10. Convergence channel and strike

**Intent.** A deliberate, risky power move. The squad stops and beams into the leader. You feel
exposed, then a huge payoff lands where you aimed.

**Activate.** The meter is full, no channel is running, and the squad has ≥ 1 wizard. The meter is
spent immediately.

**Channel** (`convergence.channelMs` = 1200)
- The whole squad stops. Movement input is ignored, wizards don't auto-attack, and spells and
  Volunteer! are blocked.
- Each living wizard beams to the leader in its element colour.
- **Vulnerable** means they don't move or fight. There's no extra damage multiplier.
- **Damage does not interrupt the channel** (Q1, approved).
- The aim point keeps tracking the aim input during the channel and **locks at strike** (Q3). It's
  clamped to `spells.maxCastRangePx`. A ground ring the size of the resolved combo's radius
  previews it.
- If the leader dies, beams retarget to the new leader and the channel continues (Q4).

**Strike (resolved at the moment the channel ends, Q5)**
- `elements = unique(element of each living squad class)`.
- Combo = the highest-priority entry in `CONVERGENCES` whose `requires` are all in `elements`.
- `power = CONVERGENCE_SCALING[livingMages - 1]` = ×1.0 / ×1.5 / ×2.0 / ×2.5. It multiplies
  **damage only**, never radius (the telegraph stays honest).
- Hits enemy units, huts and kegs. Never wizards.
- If everyone dies during the channel, it's a defeat and nothing resolves.

| Combo | requires | priority | Shape | Base numbers (×power) |
|---|---|---|---|---|
| **Firestorm** | fire + storm | 10 | Over 2000 ms in radius 140: 6 meteorlets (35 dmg fire, r40, apply Burning) at 0, 300 … 1500 ms; 8 bolts (15 dmg storm, r20) at 400, 600 … 1800 ms. Each strikes a random enemy in the area, or a random point if there are none. | 6×35 + 8×15 |
| **Meteor** | fire | 1 | After a 400 ms fall (shadow grows), one impact: 150 dmg fire, r90, apply Burning. Leaves burning ground r90 for 4000 ms that applies Burning to enemies inside every 500 ms. | 150 |
| **Thunderstorm** | storm | 1 | Over 2000 ms in radius 120: 10 bolts every 200 ms, 20 dmg storm, r24, each on a random enemy in the area (or a random point). | 10×20 |

The Convergence radii don't change for 48×48. They're already screen-scale: Firestorm's 280 px
diameter is most of the 360 px view height. The area hit rule adds 10–12 px of effective reach for
free.

Bolts hitting Burning targets trigger Combust. That's the Firestorm showcase: meteorlets burn, bolts
pop them. Bolt targets come from the seeded RNG.

**Benchmarks** (Goblin Hut = 300 HP; Goblin Woods squad = 2 P + 2 S)
- Meteor and Thunderstorm only happen after one class has died out, so at most 2 mages are alive:
  ×1.0–1.5. Meteor does 150–225 to a hut. That's a big chunk, but it won't destroy one alone.
- Firestorm with 4 mages (×2.5): one meteorlet does 87 and one bolt 37. A hut alone in the area
  catches all 14 strikes, for about 820. A hut with goblins around it catches a share.
- So a full squad's ultimate wipes a camp, and a broken squad's ultimate only dents it. Keeping
  wizards alive is rewarded, as plan §4.1 intends.

**Verify.** Exhaustive unit tests: every composition from §5 maps to the right combo and
multiplier. A death during the channel changes the result (P,S,S with the P killed mid-channel
gives Thunderstorm ×1.5).

## 11. Volunteer!

**Intent.** Cannon Fodder's grim joke as a panic button. A rookie charges in yelling, and you trade
a body and maybe a spell for a big blast.

**Activate (F).** Requires ≥ 2 squad members, cooldown ready, and no channel running.
- The **last wizard in the trail** volunteers. Never the leader.
- They leave the squad immediately: the spell may be lost now (§5). They shout a random bark from
  `barks.ts`.
- They sprint at `volunteer.sprintSpeed` toward the aim point (clamped to
  `spells.maxCastRangePx`). They ignore separation and their own auto-attacks.
- **Detonate at the first of:** reaching the aim point, body contact with an enemy unit or hut,
  `volunteer.fuseMs` elapsed, or dying (they blow up where they fall).
- Arcane Detonation: `volunteer.damage` (arcane) to enemy units and huts in `volunteer.radiusPx`.
  Triggers kegs (Q6). No damage to wizards (Q7).
- The volunteer dies. Hat Hill entry: cause `volunteer`, epitaph *"Volunteered."*

| Key | Value |
|---|---|
| `volunteer.sprintSpeed` | 180 px/s |
| `volunteer.fuseMs` | 1500 |
| `volunteer.damage` | 80 |
| `volunteer.radiusPx` | 64 |
| `volunteer.cooldownMs` | 12000 |
| `volunteer.knockbackPx` | 30 |

**Edge cases**
- Two volunteer presses within the cooldown: the second gives a "denied" shake.
- The volunteer is mid-sprint when the portal triggers. They're no longer in the squad, so they
  aren't saved and they still count as volunteered when they detonate. In practice the fuse runs
  out in 1.5 s anyway.
- Detonation charges the meter like any other squad damage.

**Verify.** Unit test: volunteer pick on squads of size 1–4, with the leader never picked. Spell
loss on activation. Death mid-sprint still detonates.

---

## 12. Enemies and structures

### Goblin Grunt: *"Swarms you. Answer with area damage."*
| Key | Value |
|---|---|
| maxHp | 24 |
| moveSpeed | 85 px/s (slower than the squad, so you can kite) |
| melee | 6 dmg physical, range 28 px centre to centre (body contact 22 + 6 reach), cooldown 900 ms |
| windupMs | 150. Visible tell before the swing (readability ≥ 100 ms). If the target is out of range at release, the swing whiffs and the cooldown is still spent (M4 Q2). CD-approved 2026-10-16, M4 Q3. |
| aggroRadiusPx | 220 |
| retargetMs | 500 |
| knockback taken | yes |

AI: idle → chase the nearest wizard (retarget every 500 ms) → attack in range. No leash.
Three grunts on one Stormcaller kill it in about 2.8 s, so swarms have to be answered.

### Goblin Archer: *"Outranges you. Push in, or snipe with Lightning."*
| Key | Value |
|---|---|
| maxHp | 18 |
| moveSpeed | 70 px/s |
| preferredRangePx | 150–200 |
| retreatBelowPx | 120 |
| arrow | 5 dmg physical, range 220, speed 200 px/s, cooldown 1800 ms, draw tell 300 ms |
| aggroRadiusPx | 260 |
| retargetMs | 500 (same as the grunt). CD-approved 2026-10-16, M4 Q3. |
| knockback taken | yes |

Data: `src/data/enemies.ts` (`ENEMIES`). Enemy attacks deal no knockback in the MVP.

AI: idle → keep range (step back if closer than 120, step in if farther than 200) → draw (300 ms,
visible pose) → shoot at the target's position **at draw start** (no lead). A moving squad dodges
most arrows; a standing one doesn't. Arrows stop on collision tiles and don't hit kegs. They
expire after `rangePx × combat.projectileRangeFactor` of travel (220 × 1.2 = 264 px), the same rule
as wizard autos (§3), so a dodged arrow doesn't fly on across the map. One rule for every projectile. CD-approved
2026-10-16 (M4).
Range 220 beats both auto-attack ranges (180/160), so the archer *forces* a push or a Lightning
cast. It retreats slower (70) than the squad moves, so pushing in works.

**Pushed archers don't shoot (M4 T7).** While its target is closer than `retreatBelowPx` (120), the
archer retreats and **does not start a draw**, even with its cooldown ready. A draw that has already
started always finishes and shoots at the locked aim, so the tell never lies. *Feel:* push in and the
archer panics and backs off instead of firing point-blank. Pushing is rewarded, not punished. A
cornered archer that can't back away still doesn't draw; it's easy prey, which is the lesson.
*Verify (core-dev):* (1) cooldown ready, target at 110 px → no draw, archer moves away. (2) Draw
starts at 130 px, the target closes to 100 px mid-draw → the arrow still fires at the draw-start
position. (3) Target at 120 px exactly → may draw (the band is "closer than 120"). (4) Archer pinned
at the arena edge, target at 100 px → no draw.

### Goblin Hut: *"Shut the tap. Spawns grunts until destroyed; lights a portal rune."*
| Key | Value |
|---|---|
| maxHp | 300 |
| footprint | 64×64 px (4×4 tiles), blocks movement. It has to be the largest goblin object next to 48 px wizards. |
| activation radius | 400 px from the leader (huts off screen don't build up armies) |
| spawn | 1 Grunt every 6000 ms while active; first spawn 1500 ms after activation |
| max alive per hut | 4 |
| spawn tell | door glow 500 ms before each spawn |

- Takes all damage and Burning. Auto-attacks hit it only when no unit is in range (§3).
- On destroy: stops spawning, already-spawned grunts stay, `mission:target-destroyed`, +10 meter,
  and it switches to the rubble state. The rubble still blocks movement with the same footprint, so
  the map doesn't change shape (Q16).
- Grunts spawn at the door tile. If it's blocked, they spawn at the nearest free tile.

### 12a. Enemy deaths: elemental death variants (CD request, plan §2)

**Intent.** Every kill tells you *what* killed it: a fried goblin says "Stormcaller", a charred
husk says "fire", a red splat says "boom". That's stylised Warcraft-level gore, punchy and
readable, never lingering long enough to clutter the fight. It's feedback, not decoration: it
teaches which tool did the work.

**Rule: death variant = the killing blow.** Core resolves it at the moment HP reaches 0 and puts it
on `unit:died` (§15).
1. If the killing damage source has a `deathVariant` override in data, use it.
2. Otherwise map the damage element:

   | Killing element | `deathVariant` | Look |
   |---|---|---|
   | `fire` (fire bolt, Fireball, Burning tick, Combust, Meteor, meteorlets, burning ground) | **charred** | flares up, then collapses into a charred husk with an ash/scorch decal |
   | `storm` (spark, Lightning, Thunderstorm/Firestorm bolts) | **electrified** | skeleton-flash frame, then a smoking corpse with a small scorch decal |
   | `physical`, `arcane` (Volunteer! detonation, melee) | **blood** | blood burst, then a corpse with a blood splat decal |

3. **Overrides:** **Kaboom → `blood`** (shrapnel), even though its element is `fire` for reactions
   and keg chains. The element drives the rules; the variant drives only the look.
4. **Fallback:** if a kill has no known source (for example a debug kill), use `blood`.
5. **Which hit is the killing blow:** the one that takes HP to 0, in resolution order.
   - A spark on a Burning goblin resolves first. If the spark kills, the death is **electrified**.
     If the goblin survives it and the Combust explosion kills it, the death is **charred**
     (Combust damage is fire).
   - Arcane Detonation → **blood**. Kaboom → **blood** (override).

| Key | Value |
|---|---|
| `deaths.charred.animMs` | ≤ 500 total (engulf, blacken and crumple, flames out). The flames are gone before the husk frame. |
| `deaths.electrified.animMs` | ≤ 400 total, with **one** skeleton flash held 120 ms, then the collapse. The skull is visible in the flash (APPROVED by the CD, max 2 frames; a narrow exception to "skulls are Necromancer-only"). |
| `deaths.blood.animMs` | ≤ 350 total (recoil, collapse) |
| `deaths.corpseLifetimeMs` | 6000, then fade over `deaths.corpseFadeMs` = 1000 |
| `deaths.decalLifetimeMs` | 12000, then fade over `deaths.decalFadeMs` = 2000 |
| `deaths.maxCorpses` | 16 (pooled) |
| `deaths.maxDecals` | 24 (pooled) |
| `deaths.recycleFadeMs` | 250 (fast fade when the oldest is recycled at the cap) |
| `deaths.multiKillStaggerMs` | 0–150, seeded per corpse |
| `deaths.multiKillSharedDecalAt` | 3 kills |
| `deaths.skeletonFlashMaxPer333Ms` | 3 |
| `deaths.gibs.overkillRatio` | 1.5 (the killing hit's raw damage ≥ 1.5 × target maxHp) |
| `deaths.gibs.piecesPerGoblin` | 4 (seeded 3–5) |
| `deaths.gibs.flightMs` | 300–450 (seeded per piece) |
| `deaths.gibs.maxScatterPx` | 48 |
| `deaths.gibs.lifetimeMs` | 8000, then fade over `deaths.gibs.fadeMs` = 1000 |
| `deaths.gibs.maxPieces` | 32 (pooled; oldest fades out over `recycleFadeMs`) |
| `deaths.gibs.maxGibbedPerEvent` | 4 (goblins per single area event; the rest die normally) |

Data (M4): `src/data/combat.ts` (`GIBS.overkillRatio`, `GIBS.maxGibbedPerEvent`). The other keys come
with art in M8.

**Corpses**
- Purely visual. No collision, never targetable, never take damage, never trigger kegs or
  reactions, and never count for anything. A dead unit doesn't act and can't be hit (M4 DoD).
- Pooled. When `maxCorpses` is reached, the oldest corpse fades out over `recycleFadeMs` and is
  reused.
- Corpses never block extraction, paths or spawn tiles.

**Decals** (ash/scorch, blood splat)
- Ground layer, below telegraph rings and units (readability.md §4a). Pooled with the cap and
  recycling above.
- Not on water or the portal pad. If the death position is there, skip the decal (the corpse
  still shows).

**Multi-kills (Kaboom, Volunteer!, Convergence, Combust chains)**
- Each victim gets its own corpse and variant (a Firestorm can leave charred *and* electrified
  bodies).
- Death animations start with a seeded 0–150 ms stagger, so a blast doesn't look like one stamped
  sprite.
- **≥ 3 kills from one area event** spawn **one shared decal** at the blast centre (sized to the
  radius, in the dominant variant) instead of one per victim. That keeps the decal cap for the rest
  of the fight and reads better: one crater, not a carpet of splats.
- **Photosensitivity cap:** at most 3 skeleton flashes start within any 333 ms. Any more electrified
  deaths in that window skip the flash and go straight to the smoking corpse (Thunderstorm and
  Firestorm can kill many at once).

**Gibs (APPROVED by the creative director)**

*Intent:* a big hit should feel big. When a blast massively overkills a goblin, it bursts into a
few cartoon pieces. It rewards Kaboom setups, Volunteer! and a full-squad Convergence (power
scaling makes more strikes gib).

- **Trigger:** both must be true.
  1. The killing source is flagged `canGib` in data: **Kaboom, Arcane Detonation (Volunteer!) and
     every Convergence strike** (Meteor impact, meteorlets, Thunderstorm/Firestorm bolts).
  2. The killing hit's raw damage (before clamping to remaining HP) is
     ≥ `overkillRatio` × the target's maxHp. For a Grunt that's ≥ 36; for an Archer, ≥ 27.
- **What that means in practice:**

  | Source | Grunt (24) | Archer (18) |
  |---|---|---|
  | Kaboom 60, Arcane Detonation 80, Meteor 150+ | gibs | gibs |
  | Meteorlet 35 × power | ×1.5+ | always |
  | Thunderstorm bolt 20 × power | ×2.0+ | ×1.5+ |
  | Firestorm bolt 15 × power | ×2.5 | ×2.0+ |
  | Fireball, Lightning, autos, Combust, Burning | never (not `canGib`) | never |

  A full squad's Convergence shreds goblins, and a broken squad's mostly doesn't. That's the
  living-mage scaling, made visible.
- **Look, by `deathVariant`:**
  - **blood:** the bloody gib art plus the blood burst.
  - **charred:** the charred gib art plus an ash puff.
  - **electrified:** the charred gib art plus the engine smoke wisp (no extra frames), and no
    skeleton flash.
- **Pieces:** `piecesPerGoblin` (seeded 3–5) per gibbed goblin, picked from the art sheet
  (asset-list A10, final: per enemy a weapon fragment, ear, 2 bones and 2 meat chunks, from 7 piece
  types; 4 tumble frames each; bloody, or a blackened remap for charred and electrified). The
  **weapon fragment is always one of them** (Grunt axe head, Archer bow half), so you can still
  tell what died. The rest are seeded from ear, bones and meat. The sheet offers up to 6 pieces;
  the design uses 3–5 so a 4-goblin blast stays readable (≤ 20 pieces).
- **Behaviour:** the burst is instant at death (no death animation, **no corpse**). Pieces tumble
  outward, away from the blast centre, in short high arcs. They **land within `flightMs` (≤ 450 ms,
  well under the art guide's 0.6 s) and within `deaths.gibs.maxScatterPx` = 48 px** of the death
  point, with one small bounce. Once landed they drop to corpse values (desaturated), stay
  `lifetimeMs`, then fade over `fadeMs`.
- **Not projectiles, not pickups** (creative-director constraint): gibs spin (arrows never do),
  arc (arrows fly straight), are matte with no glow or trail, have no pale shaft longer than 8 px,
  settle fast and low, and are desaturated once landed.
- **Purely visual,** like corpses: no collision, no damage, not pickups, and they never trigger
  anything.
- **Caps:** at most `maxGibbedPerEvent` goblins gib per area event; any more die with their normal
  variant animation. The pool holds `maxPieces`, and the oldest is recycled.
- The normal decal rules apply. A gibbed goblin counts toward the shared crater (≥ 3 kills),
  otherwise it gets its own splat or ash decal.
- **Gore setting (Q23, APPROVED):** "Gore: on/off", **on by default**. With gore off, every enemy
  death plays the plain collapse, then a neutral grey puff. **No corpses, no decals, no gibs, no
  skeleton flash.** Core still resolves `deathVariant` and `gibbed`; the view maps them all to the
  puff.

**Not covered by this rule**
- **Wizard deaths stay non-gory:** death puff, the hat falls and stays (readability.md §2), Hat
  Hill. No variants, regardless of what killed them.
- Huts use their rubble state (§12). Kegs simply vanish into the Kaboom.

**Verify (gibs).** Unit test: a Grunt killed by Kaboom gibs, and one killed by Fireball doesn't.
An Archer killed by a ×1.5 Thunderstorm bolt (30 ≥ 27) gibs; a Grunt killed by the same bolt
(30 < 36) doesn't. A Kaboom killing 6 gibs exactly 4. 20 gibbed goblins keep ≤ 32 pieces.

**Verify.** Unit test: the variant mapping for every damage source in data, including Kaboom →
blood and the debug kill → blood. Kills from a Burning tick give charred. A Volunteer! kill gives
blood. Pool test: 30 deaths keep ≤ 16 corpses and ≤ 24 decals. A Kaboom killing 4 makes 4 corpses
and 1 decal. A Thunderstorm killing 6 within 333 ms makes ≤ 3 skeleton flashes.

### Power-curve guidance for level-designer
- Section 1: grunts only, 1 Hut, kegs placed near a grunt choke. Teaches swarms, Fireball and Kaboom.
- Section 2: grunts plus 2–3 archers on high ground or behind cover. Teaches Lightning and pushing.
- Final surge: everything converges. Suggested `surge-01` = 12 grunts + 4 archers, staggered
  over **8000 ms** from all remaining spawn points. Peak on-screen enemies **≤ 12** (readability:
  a 48 px sprite covers 2.25× the area of a 32 px one).
- Chokes the squad must pass while fighting: **≥ 4 tiles (64 px)**. Two grunt bodies side by side
  are 48 px, so a 3-tile choke gets plugged. Level-designer uses **5 tiles (80 px)** as the minimum
  corridor and for the Ford and Old Bridge chokes, and 8–9 tiles for open corridors. That meets
  this rule.

---

## 13. Portal: runes, opening, final surge, extraction

**Intent.** The exit is always visible, so progress is legible in the world. The finale is a
fighting retreat where keeping the squad together matters.

**Sealed.** Visible from mission start with one dark rune per required target (2 in Goblin Woods).
Not enterable: walking onto it does nothing.
- **Intro camera pan (APPROVED at the gate):** at mission start the camera pans to the sealed
  portal and back to the squad before control begins. Timing and path are in level-designer's
  mission doc. It's the only camera hijack in the mission.
- **Sealed-portal arrow (APPROVED at the gate):** the off-screen edge arrow points to the portal
  **from mission start**, in a dim sealed style. It switches to the bright open style when the
  portal opens. "The player always knows where the exit is" (plan §4.4).

**Runes.** Each `mission:target-destroyed` lights the next rune (left to right). The HUD shows
"Huts 1/2" too.

**Opening.** When the last rune lights:
1. Opening sequence `portal.openingMs` = 1500 (burst, swirl). The portal is enterable when it ends.
2. At the start of the opening, the final surge spawns from all remaining spawn points (huts are
   gone, so map spawn points). `portal:opened`. The meter gets `chargeOnPortalOpen`.
   - **Surge enemies have aggro `always`:** they ignore `aggroRadiusPx` and converge on the
     nearest wizard from the moment they spawn. Enemies are slower than the squad, so surge spawn
     points must sit **ahead of and beside** the route to the portal, not behind it
     (level-designer).
   - No surge enemy spawns within 160 px of any wizard (`surge.minSpawnDistancePx`). The spawn
     point is skipped and its share goes to the next point.
   - Units are solid but **pushable** (separation, not hard collision), so a crowd at a 5-tile
     choke slows the squad but can't permanently body-block it.
3. No camera hijack (only the intro pan exists). The off-screen arrow switches to its open style.
4. The extraction ring (`radiusPx`) is drawn on the ground from now on.

**Extraction**
- Trigger: the **leader's centre** comes within `portal.triggerRadiusPx` of the portal centre.
- At that moment, squad wizards whose centre is within the mission's `extraction.radiusPx` are
  **saved**. Everyone else in the squad is **left behind** (Hat Hill cause `left-behind`, epitaph
  *"Left behind."*).
- An active volunteer is not in the squad, so it isn't saved (§11).
- The mission ends with victory. Enemies freeze and the results screen appears.

| Key | Value | Owner |
|---|---|---|
| `portal.openingMs` | 1500 | game-designer |
| `portal.triggerRadiusPx` | 24 | game-designer |
| `surge.minSpawnDistancePx` | 160 | game-designer |
| `extraction.radiusPx` (per mission) | **112** (7 tiles). **APPROVED** (Q8, gate). | level-designer |

**Why 112 (Q8).** The leader triggers at ≤ 24 px (on the portal pad, which is now larger). A full
trail stretches 78 px behind. The last follower ends up at ≤ 24 + 78 = 102 px when walking straight
in. At 80 (the approved 32 px value), a squad walking in single file always loses its last wizard,
the exact bug Q8 was meant to prevent. 112 keeps the same ~10 px slack as before. Walking in together
saves everyone; straggling or getting split by the surge still costs you. This uses the wizard's
**centre** (feet), not the area hit rule. Saved means standing in the ring.

**Verify.** Unit test: extraction split for wizards at 0, 79, 111, 113 px gives saved, saved, saved,
left behind. A play test: walk the full squad straight in, and all 4 are saved.

## 14. Defeat, results and restart

**Defeat.** Triggers when the squad has 0 members **and** no volunteer is mid-sprint. In practice:
when the last wizard dies. The leader can't volunteer, so the last wizard always dies in combat.
`mission:ended {defeat}`. Everyone is recorded as cause `combat` (or `volunteer` for earlier
volunteers).

**Results screen** (victory and defeat share it)
- Header: Victory / Defeat.
- Time: mission start to end, pause excluded, shown as mm:ss.
- Kills: enemy units only (huts are shown as "Huts 2/2").
- Wizards saved: name and class.
- Wizards lost: name, class and cause (`Fell in battle` / `Volunteered.` / `Left behind.`).
- Hat Hill entries are written to the save model for every lost wizard (the screen itself is
  post-MVP).

**Restart.** The "Again" action (Enter, R or tap) restarts the mission instantly without a page
reload, with **fresh recruits** (new seeded names: seed = base seed + attempt number). The same
restart is available from the pause menu. The restart leak check is in plan §8 DoD.

**Recruit names** (M3, CD Q3). Data: `src/data/names.ts` (`RECRUIT_NAMES`, 39 first names × 38
epithets), combined as "<first> the <epithet>", unique within a squad. Dev arena base seed:
`DEV_SQUAD.nameSeed` in `src/data/devArena.ts`.
- *Intent:* each wizard reads as a grizzled veteran with a faintly doomed nickname ("Lazarus the
  Late", "Grimbald the Damp"), so losing one stings and is funny. Several epithets echo the game's
  own verbs (Next, Volunteered, Hatless, Once Fireproof). Never childish, no real people, no slurs.
- *Budget:* first names ≤ 9 characters, epithets ≤ 14, so every full name is ≤ 28 and fits the results
  screen. Longest: "Archibald the Once Fireproof" (28).
- *Verify:* restart 3 times; every squad has 4 distinct names, none truncated on the results screen,
  and the same seed and attempt always give the same names.

---

## 15. Contract and data-shape notes (for producer, when each milestone starts)

**APPROVED at the gate:** each field below is applied by the producer when its milestone opens.
These aren't edits by game-designer. When the relevant milestone opens, these are the fields this
GDD assumes:
- `DamageElement = 'fire' | 'storm' | 'arcane' | 'physical'`. Separate from the class
  `Element` (fire, storm, …) because damage can be arcane or physical.
- `ClassDef.attack` needs `element`, `projectileSpeed` and `knockbackPx`.
- `SpellDef` needs `slot`, `element`, `damage`, `radiusPx`, `cooldownMs` and a delivery union
  (`projectile {speed}` | `strike {telegraphMs}`).
- `ConvergenceDef` needs more than `baseDamage`/`radius`: a `pattern` union
  (`impact {fallMs, groundBurnMs}` | `barrage {durationMs, strikes[]}`), so Firestorm and
  Thunderstorm stay data, not code.
- `ReactionDef` for Kaboom needs `triggerElements` (includes `arcane` if Q6 is accepted) and
  `squadDamageMultiplier`.
- Wave/spawn entries need an `aggro: 'radius' | 'always'` field (the surge uses `always`).
- Event `unit:died.cause` should become `'combat' | 'volunteer' | 'left-behind'` so results and
  Hat Hill share one cause list.
- **APPROVED by the CD, applied when M4 opens (enemy deaths, §12a):** `unit:died` needs the killing blow's
  `deathVariant: DeathVariantId` (`'charred' | 'electrified' | 'blood'`), resolved by core at the
  moment of death, so the view never has to guess. Damage sources need an optional
  `deathVariant` override in data (`DamageSourceDef`), used by Kaboom. Needed in M4
  (first enemy deaths). For gibs (**APPROVED** as part of the same contract): `DamageSourceDef.canGib: boolean`, and
  `unit:died` carries `gibbed: boolean` (core decides, using the overkill ratio and the per-event
  cap). I chose a
  **separate flag** over a "gibbed" variant because gibs keep their element look (bloody versus
  charred) and the gore toggle maps both fields to the puff.

## 16. Playtest requests (for reviewer, M4–M7)

1. Is the Grunt at 24 HP fodder (good) or paper (too fast)? Target: a pack of 6 takes 3–5 s to clear
   with auto-attacks only (reactions off). With reactions on (M5+), the targets are in §3's no-input
   table (clear 2.3–5.0 s, a grunt swing lands first) and request 12.
2. Do archers feel like "push or snipe", or just annoying? Target: < 25% of squad damage taken
   comes from arrows in section 2. M4 check (dev encounter archers): push in with the squad. Does the
   archer visibly back off without firing below 120 px, and does pushing feel like the right answer?
3. Meter: ready about once per section? Log the time to full for each section.
4. Kaboom at ×0.5 squad damage: do players avoid kegs, or ignore the risk? Also (M5): when an auto
   spark's Combust lights a keg near the squad (§7), does it feel fair ("I stood too close") or random
   ("my squad blew itself up")? Log each case and whether a wizard was hit.
5. Extraction radius 112 (approved): how often is someone left behind when the player *wasn't* careless?
   Target ≈ 0.
6. Mission length: measure the full-run time for a fast and a cautious run. Target 6 / 9 min (Q19).
7. Surge at the Old Bridge choke (5 tiles): does the squad get through without being
   body-blocked? Does the player have a Convergence available (Q20)?
8. Extraction at 112 px (approved Q8): on a straight entry along the Rune Path (about 450 px), does an
   average player save the whole squad? Level-designer expects the "left behind" risk to sit only at
   the Old Bridge, where the surge catches the squad. Log saved/left-behind counts per run and where
   each left-behind wizard was when the leader triggered. Target: 0 left behind on clean straight
   entries, and losses only after a split at the bridge.
9. At 48×48: does a full fight stay readable with 12 enemies on screen? Do Fireball (44) and
   Lightning (8) feel like they hit what the ring touches?
10. Death variants (§12a): after a big fight (≥ 15 kills in one area), is the ground still calm?
    Does anyone mistake a corpse for a live goblin, or a blood splat for burning ground? Can players
    say which tool killed a goblin from its death alone?
11. Recruit names (§14, M7 results screen): does "<name> the Volunteered" listed under *Fell in
    battle* or *Left behind.* read as a joke or as a bug? If any tester misreads it as the death cause,
    swap the epithet in `src/data/names.ts`. Target: no tester confuses an epithet with a cause.
12. Combust rhythm and weight (M5, Combust damage 3, §7): in the no-input dev fight with reactions
    on, over 3 seeds × 30/60/144 fps, check §3's reactions-on targets: ≥ 1 grunt swing lands before
    the clear in every run; clear 2.3–5.0 s; 1.0–3.0 Combusts/s for the squad (0.5–1.5 per pair).
    Then in game: do the pops read as a rhythm rather than constant crackle, and does a 3-damage pop
    still feel like a reaction worth setting up (the ember arcs and spread carry it)? If it reads
    weak, that's the §7 watch item: the spread-delay rule goes to the CD as an M6 question.

---

## 17. Open questions (with recommendations)

Questions marked **ASK** go to the human through the producer.

| # | Question | Options | Recommendation and rationale |
|---|---|---|---|
| Q1 **APPROVED (A)** | Does damage interrupt the Convergence channel? | **A.** Never interrupted. Deaths during the channel lower power and can change the combo at strike. **B.** Any damage to the leader cancels it and refunds 50% of the meter. **C.** Each damaged wizard drops out of the channel and doesn't count toward power. | **A.** The risk is already real: 1.2 s standing still with no attacks, and deaths during it cost power and maybe the combo. B is frustrating against arrow chip damage you can't avoid. It wastes the big moment and teaches players not to use it. C is interesting but makes "power = living mages" (plan §4.1) harder to read. |
| Q2 **APPROVED (half)** | Kaboom friendly fire on own squad? | Full (60, kills anyone) / **half (30)** / none | **Half.** The plan says friendly fire is included. Half keeps the lesson ("don't stand by kegs") without unfair one-shots from a chain the player didn't see coming. Two overlapping kegs still kill. *48×48 note:* the damage is unchanged; the radius went 64 → 72 because of body scale (§8). |
| Q3 | Convergence aim: locked at activation, or tracking until strike? | lock at press / **track until strike** | **Track.** Targets move during 1.2 s. Tracking keeps the aim skill meaningful and feels fair. The ground ring shows where it'll land. |
| Q4 | Leader dies during the channel? | cancel with refund / **continue on the new leader** | **Continue.** Beams snap to the promoted leader. It's dramatic, readable and needs no refund rules. |
| Q5 | Convergence combo and power: evaluated at activation or at strike? | activation / **strike** | **Strike.** That's what makes "vulnerable during the channel" matter (deaths cost power). It also follows the plan's "classes still alive". |
| Q6 **APPROVED (yes)** | Does Arcane Detonation (Volunteer!) trigger kegs? The plan lists only fire and storm. | yes / no | **Yes.** A rookie charging a keg is the most Cannon Fodder moment in the game. It's a small extension of the plan's reaction table, so it needs approval. |
| Q7 | Volunteer! friendly fire? | yes / **no** | **No.** The player already paid a wizard and maybe a spell. Taking more off would make the button feel like a trap. |
| Q8 **APPROVED (112 / trigger 24) at the gate** | Extraction radius: the plan example says 48. | 80 / **112** / 80 and add a 1 s "gather" warp | **112** (trigger radius 16 → 24). The approved principle is "walking in together saves everyone". At 48×48 the trail is 78 px (it was 54), so at 80 the last wizard sits at up to 102 px and is always left behind. 112 keeps the approved 10 px slack. Mission data, owned by level-designer. |
| Q9 | Classes have different `moveSpeed` (110/120). What speed does the squad move at? | leader's class speed / slowest living / one fixed squad speed | **One squad speed (110 px/s).** Keep `moveSpeed` per class for the post-MVP Frost Warden. A squad that speeds up when the Pyromancer leads is noise, not a lesson. Catch-up (×1.3) covers followers. |
| Q10 | Does the leader auto-attack? | **yes** / no | **Yes.** Otherwise promoting a wizard to leader costs DPS, and the player never "aims" auto-attacks anyway. |
| Q11 | Where do spells originate if the leader isn't of the granting class? | **leader** / nearest mage of that class | **Leader.** It's readable ("I cast from me") and there's no hidden source that might be off screen. |
| Q12 | Do auto-attacks hit or target Powder Kegs? | **no** / yes | **No.** Followers act on their own, so autos detonating kegs would be uncontrollable friendly fire. Kegs are a *player* tool: aimed spells, reactions, Convergence and Volunteer! trigger them. |
| Q13 | Huts spawn while the squad is far away? | **activation radius (400 px)** / always | **Activation radius.** That stops invisible armies from piling up while the player fights elsewhere, and keeps peak counts readable. |
| Q14 | Does the volunteer's spell get lost at activation or at detonation? | **activation** / detonation | **Activation.** The cause and effect sit on the button press. And "the squad" (the source of derived spells) no longer contains the volunteer. |
| Q15 | Does Combust keep Burning on the origin? | keep / **consume** | **Consume.** Otherwise every spark (2.5/s per Stormcaller) Combusts the same target, which is spammy and unreadable. Consuming makes a pop-and-spread rhythm. |
| Q16 | Do hut rubble and the destroyed state still block movement? | **block** / clear | **Block.** The map keeps its shape and the level-designer's routes stay valid. |
| Q17 | New names on restart? | **fresh recruits** / same names | **Fresh.** That's the tone of the game (expendable recruits, Hat Hill fills up). Seeded per attempt, so it's still deterministic. |
| Q18 | Mission squad order | P,P,S,S (plan example) / **P,S,P,S** | **P,S,P,S** (mission data, level-designer). The first two volunteers take one of each class, so the player doesn't lose a spell on the second press by accident. With P,P,S,S, two volunteers strip Lightning. **Agreed with level-designer.** |
| Q19 | Mission length: the squad's speed and damage give about 5–6 min with sparse encounters. Slow the squad or add enemies? | slow the squad / **add encounters** | **Add encounters (about 13 / 55 enemies), keep the squad fast.** Movement speed is the feel of the game (kiting, outrunning grunts). Target is 6 min fast / 9 min cautious, and the reviewer measures it. **Agreed with level-designer.** |
| Q20 | A player who spends the meter at Hut B reaches the surge empty. | hut charge 35 / **portal-open charge 50** | Level-designer proposed `chargePerHutDestroyed` 10 → 35. **I recommend `chargeOnPortalOpen` = 50 instead.** A bigger hut reward also boosts Hut A and inflates section 1 (start 40 + 35 = 75 before the first fight is over), and it's wasted when the meter is already full. Charging at portal open targets exactly the climax. **Agreed with level-designer: `chargeOnPortalOpen` = 50, hut stays 10.** |
| Q22 **DECIDED (CD): gibs are in** | How far does the gore go? | none / Kaboom only / **all big blasts** | The creative director overruled my "no gibs". **Rule (§12a):** trigger = a `canGib` source (Kaboom, Volunteer! blast, every Convergence strike) **and** a killing hit ≥ 1.5 × target maxHp. 3–5 pieces per goblin (weapon fragment always included), flight 300–450 ms within 48 px, lifetime 8 s plus a 1 s fade, at most 4 gibbed goblins per blast, a pool of 32 pieces with the oldest recycled first. **My concern stands as a constraint:** gibs must not read as projectiles or pickups, so they spin, arc, are matte and desaturated, settle fast and low, and have no pale shaft > 8 px. |
| Q23 **APPROVED** | Gore toggle | — | A "Gore: on/off" setting, on by default. Off = collapse plus a neutral grey puff; no corpses, decals, gibs or skeleton flash (§12a). The store rating is still assessed on gore-on content (PEGI 12/16 likely) at M9. |
| Q21 | Area hits at 48×48: test against the target's centre or its body? | centre / **body (radius + bodyRadius)** | **Body.** A goblin visibly half inside the ring but unhurt reads as a bug at this sprite size. Rings are drawn at `radiusPx`, and the hit test adds the body radius. Small spells were retuned for it: Lightning 16 → 8, so it stays a single-target scalpel. |
