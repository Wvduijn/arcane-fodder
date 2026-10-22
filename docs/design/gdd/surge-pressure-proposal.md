# Proposal: surge pressure on the retreat (M7, Goblin Woods)

Status: **proposal, waiting for the CD.** No `src/data` changes until an option is approved.
Inputs: plan §4.4 step 4, GDD §12 (grunt 85 px/s, "you can kite") and §13 (surge rules), Q9
(squad 110 px/s, followers catch up at ×1.3 = 143 px/s), Q19 (outrunning grunts is part of the
feel), level doc m01 §4 beats 3.1–3.4 and §5, review M7-T18 o2 and o4.

## Problem

The surge can't threaten a squad that keeps walking. There are two reasons:

1. **Chasers can't catch up.** Every goblin that ends up behind the squad loses 25 px/s
   (grunts, 110 vs 85) or 40 px/s (archers, 70). On the 450 px Rune Path (4 s) a grunt falls
   another 100 px behind. `surge-rear-01` (4 grunts, delay 0) starts behind the squad and never
   reaches the tail.
2. **Intercepts arrive one at a time and die in the open.** The mid-pocket and bridge points
   (delays 2000–8000 ms) meet the squad head-on in groups of 2–4. Squad auto DPS is about 38/s
   (2 × 8/0.9 s + 2 × 4/0.4 s), so a 24 HP grunt dies in about 0.65 s and a group of 3 in about
   2 s, before it can make contact. Once the squad has passed a group, that group is a chaser
   (reason 1).

So the "keep the trail together" dilemma in beat 3.2 never comes up (o2). The only way anyone is
left behind is a deliberate Volunteer!.

Rejected right away: **a longer `PORTAL.openingMs`.** The walk from Hut B to the pad takes about
15–20 s, so any opening delay shorter than that changes nothing, and a longer one is just waiting.

## Option A: Frenzied surge (speed modifier on surge enemies)

Surge enemies (and only they) get a speed multiplier from the moment they spawn.

| Key | Value | Result |
|---|---|---|
| `SURGE.moveSpeedMultiplier` (new) | **1.35** | grunt 85 → **114.75 px/s**, archer 70 → 94.5 px/s |

- Grunts are now 4.75 px/s faster than the leader (110), but slower than a catching-up follower
  (143). A grunt 50 px behind the tail reaches it in about 10 s of steady walking, and much sooner
  whenever the squad slows down: at the bridge choke (crowd separation), on the turn south onto
  the Rune Path, or when the player stops to aim.
- Archers stay slower than the squad (94.5 < 110). You can still outrun the arrows. You can't
  outrun the swarm.
- Every pre-surge goblin keeps its normal speed, so the Q19 feel ("kite and outrun grunts") holds
  for the whole mission until the portal opens. Then the rules visibly change.
- **What it teaches** (plan §3.2): "Once the portal opens, you can't walk away. Turn and fight,
  spend the meter, or give up the tail." The meter is ≥ 50 at the opening (Q20), and kegs 13–16 sit
  in the pockets on the route, so every counter is in reach.
- **Readability requirement** (art-director, readability.md): frenzied goblins need a tell that
  reads at 48 px with 12 on screen. For example a red eye glint plus a short speed-line trail. A
  palette tint alone isn't enough.

Files and owners:
- `src/data/mission.ts` (`SURGE.moveSpeedMultiplier`): **game-designer**.
- Applying the multiplier to surge spawns and exposing a `frenzied`/`surge` flag on enemy state
  for the view: **core-dev** (rule + tests), **game-dev** (SpawnerSystem passes it in, view draws
  the tell).
- Frenzied tell: **art-director** (spec), **tech-artist** (frames or FX).
- No map change is needed. level-designer may want to re-check the surge delays once chasers
  matter (see Verify).

Contract: `SurgeTuning.moveSpeedMultiplier: number` in `src/core/types.ts`, plus a readable surge
flag on the enemy entity state if none exists. There is no enemy-spawn event in
`src/game/events.ts`, so the view has to read the flag from state. **Producer approval needed.**

## Option B: Trigger-gated "door" ambush near the portal (map change)

Some of the surge spawns only when the leader reaches the east bank, between the squad and the
pad, so the fight happens where the 112 px ring decides who gets saved.

| Change | Value |
|---|---|
| New trigger `trig-runepath` | rect at the bridge's east end, about (1616,280,64,96) |
| New `surge-door-w-01` | (1600,900), grunt ×3, fires on `trig-runepath` |
| New `surge-door-e-01` | (1860,900), grunt ×3, fires on `trig-runepath` |
| Remove to keep the total at 16 | `surge-rear-01` (4 grunts, never matters) and 2 of the `surge-mid-*` grunts |

- Both door points are about 190 px from the portal (1728,768) and about 600 px from the
  trigger, so `minSpawnDistancePx` 160 never skips them. They reach the Rune Path in about 3–4 s,
  just as the squad does.
- The dilemma: the leader can dash for the pad while the door grunts hit the tail, or stop and
  clear them. That's the left-behind choice in its purest form.
- Weaknesses: they target the **nearest** wizard, which is usually the leader, so they block the
  front rather than pin the tail. Their speed is still 85, so once the squad gets past them they
  stop mattering. The pressure is one spike rather than a retreat, and the Gallery (3.2) stays a
  walk.

Files and owners:
- Map, trigger and surge objects: `public/assets/tilemaps/m01-goblin-woods.json`,
  `docs/design/levels/m01-goblin-woods.md`: **level-designer**.
- `surge-spawn` has no `trigger` property today (tiled-conventions §4). Supporting one (loader +
  SpawnerSystem, fires only after `portal:opened`): **game-dev**, with a convention update from
  level-designer. A plain `enemy-spawn` + trigger would work without code, but the player could set
  it off early by crossing the bridge before Hut B.

Contract: none in `types.ts` or `events.ts` (it's a map convention plus loader logic). A tiled
convention change only.

## Option C: Extraction channel on the pad (rule change)

The leader has to stay on the pad for a short channel before extraction fires.

| Key | Value |
|---|---|
| `PORTAL.extractChannelMs` (new) | **2000** |
| Reset rule | the leader's centre leaves `triggerRadiusPx` (24) → the channel resets to 0 |

- Even 85 px/s chasers close 170 px during the channel. Anything within about 250 px of the
  leader (170 + the 78 px trail) reaches the squad on the pad. So the finale guarantees a short
  last stand.
- Weakness: it **lowers** the left-behind risk. During the 2 s the trail settles into the ring,
  so a straggler gets time to walk in. The tension shifts from "keep together" to "hold the pad".
  It also takes away the dash-in option, which is the source of the dilemma.
- **ASK (if chosen):** does damage to the leader interrupt the channel? This is the same fork as
  the Convergence interrupt. Options: (1) no interrupt, only leaving resets it (my preference,
  readable); (2) a hit pauses it; (3) a hit resets it (harsh at 12 goblins).

Files and owners: `src/data/mission.ts` (**game-designer**); the PortalSystem rule + tests
(**core-dev**); the pad progress ring and audio (**game-dev**).

Contract: `PortalTuning.extractChannelMs: number`, and events `portal:channel-started` /
`portal:channel-cancelled` for audio and the HUD (or a derived progress the view reads from
state). **Producer approval needed.**

## Recommendation: Option A, Frenzied surge, multiplier 1.35

A is the only option that brings back the Cannon Fodder dilemma at every step of the retreat, not
just at one spot. It works because of the speed ordering:

**archer 94.5 < leader 110 < frenzied grunt 114.75 < catching-up follower 143.**

- *Keeps the tension:* the leader can't simply walk away, so grunts reach the tail on the
  Gallery, at the bridge and on the Rune Path. The player keeps choosing: turn and fight, spend
  Convergence or Kaboom, Volunteer! a rookie to buy time, or dash in and give up the tail
  ("Left behind.").
- *Stays fair:* a follower that falls behind still out-runs a frenzied grunt (143 vs 114.75), so
  a split only becomes permanent if the player keeps running. Grunts are still fodder: a contact
  group of 3 dies in about 2 s to autos alone. `maxAlive` 12 still caps the crowd. Archers can
  still be outrun. The change only applies after the portal opens and comes with a visible tell, so
  it's a stated rule change, not a hidden one.
- *Cheap and tunable:* one number in data plus one small core rule. If 1.35 is too mean, then
  1.30 (110.5, equal to the squad: they close the gap only when you slow down) is the gentle fallback.

If the CD wants the left-behind risk focused at the portal too, Option B layers cleanly on top of
A later. I don't recommend C: it lowers the very risk we're trying to bring back.

### Verify (playtest request for reviewer, after implementation)

Two autopilot types × 5 seeds, at 30/60/144 fps:
- **Walk-only** (heads straight to the portal, autos only, no spells or R): first surge melee hit
  on the squad within **8 s** of `portal:opened` in ≥ 4/5 runs. **≥ 3** surge melee hits per run.
  Saved ≤ 3 (combat or left-behind) in ≥ 3/5 runs.
- **Fights back** (stops to clear contacts, uses Q/E/R): saved 4 in ≥ 4/5 runs. No wizard dies
  with the meter ≥ 50 unspent in a way the player couldn't have seen coming (log each death's
  position and attacker).
- §12 peak on screen ≤ 12 still holds during the surge.
- Human check: does the frenzied tell read before the grunts arrive? Does "they're faster now" feel
  like a rule change rather than a bug?
