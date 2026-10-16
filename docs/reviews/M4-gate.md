# M4 Gate — Classes and auto-combat

Reviewer: reviewer · Date: 2026-10-16 · Branch: m4-phase (uncommitted work on top of c8dfd69, tag `m3`)
Inputs: plan.md §9 M4, docs/design/sprints/M4.md (D1–D7, D2 as reworded, CD answers), task reviews
docs/reviews/M4-T0 … M4-T13.

## Verdict: PASS WITH NOTES

Every plan.md Done-when item and every sprint item D1–D7 is met, with evidence below. Every task review
ended PASS or PASS WITH NOTES, and no blocker, major or minor is still open against code. On fresh code,
the zero-input squad clears the 6-grunt pack in about 3.75 s from the first hit, three times out of
three, with no wizard lost. Burning ticks and expires in game (debug B). No dead unit was ever hit,
damaged or given a status (every after-death counter 0, `refusedHits` 0). K×3 while moving promotes
cleanly and leaves both squad state and combat state in sync. Pushed archers back off without
shooting. Three restarts and three G presses leak nothing, and the console is clean at every size. The
notes are CD look and feel questions, listed at the end. Whether the fight feels good is the human's call.

## Quality gate (real output, run by me on the final tree)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | `Test Files 25 passed (25)` / `Tests 531 passed (531)` (M3: 14 / 319) |
| `pnpm build` | `✓ built in 374ms` |
| `pnpm exec prettier --check .` | `All matched files use Prettier code style!` |

## Done-when walk

| Item | Status | Evidence |
|---|---|---|
| **plan.md §9 M4:** the squad beats a goblin group with no player input | PASS | Playtest A: 3/3 runs, all 6 grunts dead, 4/4 wizards alive. Core sim: 9/9 (30/60/144 fps × 3 seeds), plus the forced-loss scenarios (M4-T8) |
| **§9 M4:** Burning ticks and expires | PASS | Playtest C (debug B): 24 → 21 → … → 6 every 500 ms (first tick 522 ms after the key), then `status:expired`, overlay removed, goblin alive. In fights: 4–7 applications per run, 6 ticks. GDD §6 verify is a unit test (status.test.ts) |
| **§9 M4:** dead units never act or take damage | PASS | Playtests A–E: `damagedAfterDeath` 0, `statusAfterDeath` 0, `refusedHits` 0, no dead enemy listed or stepped in any frame. Core: `CombatWorld` mutators are no-ops on dead ids, and the sim checks D4 every frame (M4-T3, T8) |
| **§9 M4:** unit tests cover damage, cooldowns, targeting, statuses and the state machine | PASS | damage.test.ts, cooldown.test.ts, selectTarget.test.ts, status.test.ts, stateMachine.test.ts, plus goblin, enemyMovement, projectile, knockback, autoAttack, encounter (M4-T2 … T8) |
| **D1** gate green; damage, cooldowns, targeting, Burning, state machine, goblin AI, projectiles, knockback, death resolution pure TS in src/core with tests | PASS | gate above. src/core imports only `@core/*`; no Phaser, DOM, `window`, timers or `Math.random` (grep, see diff review) |
| **D2** (reworded) no-input win against the 6-grunt pack: headless sim and in-game run end with every grunt dead and ≥ 1 wizard alive | PASS | sim 9/9 cleared at 3.8–4.5 s, 0 lost. In game 3/3, see playtest A. Archers stay idle (out of aggro, CD Q1) |
| **D3** Burning per GDD §6: first tick at 500 ms, refresh keeps phase, no stacking, removed on death, 8 ticks/24 verify; overlay appears on hit and disappears on expiry | PASS | status.test.ts incl. the scene-order timing test (M4-T4 re-review). In game: overlay on 4–6 goblins per fight, 0 left after deaths; expiry via B (playtest C) |
| **D4** dead units never move, target, fire, tick, or are hit/targeted/damaged; a dead shooter's projectile still resolves; same-frame deaths ascending id | PASS | counters above; per-projectile `isAlive` (M4-T10 re-review); one ascending-id death batch per frame (`flushDeaths`); projectile.test.ts "dead shooter's projectile" |
| **D5** Pyromancer slow bolt + Burning + 6 px knockback; Stormcaller fast spark; grunts chase and swing after a ≥ 100 ms wind-up; archers keep range and shoot after a visible 300 ms draw aimed at the draw-start position; a wizard killed by goblins goes through M3 succession | PASS | CLASSES/ENEMIES data (M4-T1). goblin.test.ts (wind-up 150, draw 300, aim lock, whiff). Playtest D: archer draws with the aim locked. Succession under combat: sim forced-loss cases (M4-T8 re-review) and playtest B |
| **D6** white 60 ms sprite-only hit flash; eased knockback (never a teleport); `unit:died` carries `deathVariant`/`gibbed` from core | PASS | M4-T12 (flash; §1.9 exemption by the CD). Max enemy step 1.57 px/frame in game. Variants: c/e kills in the sim, debug and wizard deaths `blood`/`false` (M4-T3, T13) |
| **D7** clean restart: no bus listener, key, sprite or pooled-object leak over 3 restarts; frame deltas clamped | PASS | playtest E (flat). `Math.min(delta, COMBAT.maxFrameDtMs)` in MissionScene.update |

## Diff review since `m3` (CLAUDE.md)

Scope: `git diff m3` (12 tracked files, +975/−72) plus the untracked M4 files (src/core/{ai,combat,
enemies,targeting}, src/data/{classes,combat,enemies,statuses}.ts, src/game/{fx,views},
the five new systems, tests/core/**). Each file was reviewed in its task review.

| Rule | Status | Evidence |
|---|---|---|
| Layer boundaries (core pure, data type-only imports) | OK | grep: no non-`@core` import in src/core; no `@data`/`@game`/`@platform` in src/core; every src/data import is `import type` |
| No tuning literals in systems | OK | every gameplay number comes from src/data. The only literals in systems are presentation (`PROJECTILE_DRAW_LIFT_PX`, `TELL.*`, bar/puff/overlay looks), each documented "presentation, not tuning" |
| No rules in src/game | OK | targeting, auto-attack, AI, damage, death, status, projectile and knockback rules are all core calls |
| One authoritative state per entity | OK | positions: `SquadState` / `EnemyState`; HP, alive, statuses: `CombatWorld`. Debug kills go through `CombatSystem.kill` (M4-T13 fix) |
| Phaser clock only | OK | no `setTimeout`/`setInterval`/`requestAnimationFrame`/`Date.now`/`performance.now` in src/game, src/app, src/main.ts (grep). Timers run on the scene `dt` |
| Cleanup on SHUTDOWN | OK | 12 `bus.on` / 12 `bus.off` in src/game; every system and view has `destroy()`; the scene tears down in reverse order; playtest E is flat |
| Pooling | OK | projectiles, death puffs and Burning overlays use `ImagePool`, created once per scene and destroyed on SHUTDOWN |
| Contracts | OK | types.ts/events.ts match the CD-approved M4 block (M4-T0) |
| No weakened config, skipped or deleted tests | OK | no change to tsconfig/eslint/package.json since m3; no `.skip`/`.only`/`todo`; no deleted test files |

## Automated playtest

Setup: my own Vite on :5421 with HMR and watch off (scratch config spreading vite.config.ts),
restarted right before these runs; headless Chrome on CDP :9621; real keyboard events through CDP. An
in-page `requestAnimationFrame` logger read `__ARCANE_DEBUG__.snapshot()` once per game frame. dt was
16.7 ms throughout (max 16.8).

**A. No-input fight × 3** (fresh page load per run; there's no in-game seed, so the runs differ only by
timing).

| Run | First hit → last grunt dead | Wizards lost | Wizard HP at end | Burning applied / expired / ticks | Shots / hits | Whiffs | After-death dmg / status | Refused hits | Max enemy step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 3750 ms | 0 | 42/60, 50, 60, 50 | 6 / 0 / 6 | 28 / 35 | 2 | 0 / 0 | 0 | 1.57 px |
| 2 | 3750 ms | 0 | 48/60, 50, 60, 50 | 6 / 0 / 6 | 28 / 34 | 3 | 0 / 0 | 0 | 1.56 px |
| 3 | 3750 ms | 0 | 42/60, 50, 60, 50 | 6 / 0 / 6 | 28 / 35 | 2 | 0 / 0 | 0 | 1.57 px |

**GDD §16 request 1 (pack of 6, target 3–5 s): 3.75 s** from the first hit to the last grunt death
(about 4.5 s from scene start, since the bolts need about 0.75 s to fly the first 180 px). The core sim
agrees: 3.8–4.5 s. That's inside the target, at the fast end.

**B. K×3 while moving** (after the grunt fight, D held, K every 900 ms): the leader went 1 → 2 → 3 → 4,
and the squad and `CombatWorld` squad units stayed identical ([4] at the end). The held input carried
over: the only 18 frames with a zero move vector are the 300 ms after D was released. Max camera scroll per frame was 3.57 px (no
jump) and the max leader step 1.83 px per frame (110 px/s). After-death counters 0. The fourth kill
isn't tested here because K needs a living leader to aim at; the wipe path is covered by M3 and the sim.
Screenshots `gate-k1.png`, `gate-k3.png` (the lone wizard walked into archer aggro and both archers are
drawing on it).

**C. Burning expiry (debug B)**: the squad walked about 700 px west, then G, then B on the nearest grunt
(705 px away, idle). Log in ms after B: 24 HP (0), 21 (522), 18 (1022), 15 (1522), 12 (2022), 9 (2522),
then at 3022 the overlay was gone, `statusExpired` went 0 → 1, and the grunt lived at 6/24. No damage on
apply.

**D. Archer push and GDD §16 request 2** (grunts dead first, then D held toward the archers until both
died):

| Measure | Result |
|---|---|
| Draws started | 2 (one per archer), both at 218 px, right after aggro |
| Draws started with the target < 120 px | **0** |
| Frames an archer spent with its target < 120 px | 145, retreating in all 145 |
| Closest approach | 85.6 px |
| Arrows taken | 2 (10 HP of squad damage, 5 each); both hit the walking squad |
| Outcome | both archers dead; after-death counters 0 |

What pushed archers do: each archer fires exactly one arrow while the squad closes from 220 px. Once the
squad is inside 120 px it backs away every frame and never starts another draw, and the squad (110 px/s
against 70) catches and kills it. Both arrows hit, because the squad was walking straight at the archers
and the draw-start aim lay on its path. A sidestep during the 300 ms draw would dodge them. Whether
pushing *feels* like the right answer is for the human. Screenshot `gate-archer-push.png`.

**E. Leak check** (overlay visible; 3 × G with a fight before each, then 3 × Backspace):

| Point | bus | keys / keyDown | shutdown listeners | overlaysLive | displayObjects | pools proj, puff, burn (live/created) |
|---|---|---|---|---|---|---|
| start | 12 | 21 / 13 | 13 | 1 | 35 | 1/1, 0/0, 0/0 |
| G1 | 12 | 21 / 13 | 13 | 1 | 40 | 1/3, 0/1, 0/2 |
| G2 | 12 | 21 / 13 | 13 | 1 | 40 | 1/3, 0/1, 0/2 |
| G3 | 12 | 21 / 13 | 13 | 1 | 43 | 1/4, 0/2, 0/3 |
| restart 1 | 12 | 21 / 13 | 13 | 1 (created 2) | 37 | 2/2, 0/0, 1/1 |
| restart 2 | 12 | 21 / 13 | 13 | 1 (created 3) | 37 | 2/2, 0/0, 1/1 |
| restart 3 | 12 | 21 / 13 | 13 | 1 (created 4) | 37 | 2/2, 0/0, 1/1 |

Listeners and keys are flat. displayObjects only moves with pool warm-up: G3's 43 is one more
projectile, puff and flame created for a busier fight. Pools grow to peak concurrency and never shrink
within a run, and restarts return to an identical 37.

**F. Screenshots and console.** `gate-390x844.png`, `gate-1280x720.png`, `gate-2560x1440.png` (overlay
hidden) and `gate-debug-*.png` (overlay visible), each about 1.7 s into the fight. 390×844 is letterboxed
at 0.61× as in M2/M3 (portrait isn't an M4 target). 2560×1440 is crisp, with the burning flame, a white
hit flash and a goblin bar visible. Console at every size and in every scenario: only Phaser's banner
and Vite's connect lines. No errors, no warnings.

## Task reviews

| Task | Final verdict |
|---|---|
| T0 contracts | PASS WITH NOTES (m1 plan.md §7.4 stale, see open items) |
| T1 data | PASS |
| T2 state machine | PASS |
| T3 cooldown / world / damage / death | PASS |
| T4 Burning | PASS |
| T5 targeting | PASS WITH NOTES (nit closed by `autoAttack`) |
| T6 projectiles / knockback | PASS WITH NOTES (information only) |
| T7 goblin brains / movement | PASS |
| T8 encounter sim | PASS |
| T9 EnemyAiSystem, class wizards, dt clamp | PASS |
| T10 Targeting / CombatSystem | PASS |
| T11 StatusSystem, overlay, debug B | PASS |
| T12 flash, bars, puffs | PASS (CD look question open) |
| T13 debug overlay, G, K/L | PASS |

## Open items for the CD (none blocks the gate)

1. **Wizard health bar while walking north.** Bars now draw on the ground layer (CD decision). In a
   north–south file the follower behind covers the leader's bar: I counted 3 × 1 game px of 24 × 3
   visible (M4-T12 re-review 2). The verify line holds literally, but it isn't readable at play speed.
   Options: accept it, offset bars sideways per slot, or add a HUD roster with HP later.
2. **Grunt wind-up visibility.** The placeholder tell is a 20 % vertical stretch over 150 ms, which is
   hard to spot at 640×360 (M4-T9 n2). It's the dodge cue for melee; judge it in the playtest. M8 art
   replaces it.
3. **Archer push feel** (GDD §16 request 2, data in D above). Pushed archers back off and never fire
   below 120 px. The two arrows of the approach both landed on a squad walking straight in. Does pushing
   feel like the answer, and is one arrow per archer per approach the right cost?
4. **plan.md §7.4 event map is stale** (M4-T0 m1): it lacks `team`/`element` on `unit:damaged`,
   `deathVariant`/`gibbed` on `unit:died`, and `status:expired`. Editing plan.md needs CD approval.
5. Observation: the debug help line overflows the panel at 1280×720 ("[B] burn nearest" runs past the
   panel edge, `gate-k3.png`). Debug only, cosmetic; game-dev can wrap it later.

## For the human playtest (feel questions only a human can answer)
- Does the no-input fight read as "my wizards are fighting", or as noise? Can you tell the fire bolts
  from the sparks, and who is burning?
- Does a grunt pack of 6 dying in under 4 s feel like fodder (good) or paper (too fast)? (§16 request 1)
- Can you see the grunt wind-up coming at normal zoom?
- Push the archers: does backing off read as panic, and does the push feel rewarded?
- Does a hit flash on every hit feel punchy or flickery?
