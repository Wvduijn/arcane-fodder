# M6 Gate — Convergence and Volunteer!

Reviewer: reviewer · Date: 2026-10-21 · Branch: m6-phase (uncommitted work on top of a74d933, tag `M5`)
Inputs:
- plan.md §9 M6
- docs/design/sprints/M6.md (D1–D6, CD answers 2026-10-20, Follow-ups incl. the 2026-10-21 CD
  decisions)
- task reviews docs/reviews/M6-T0 … M6-T9-T13
- GDD mvp.md §9–§11, readability §5c

## Verdict: PASS WITH NOTES

Every plan.md §9 M6 item and every sprint item D1–D6 is met, with evidence below. All task reviews
are final PASS. No blocker, major or minor is open against code, so nothing was routed.

What I saw in game under WebGL:
- All 8 squad compositions produced the right combo, power and strike count, and the strike never
  hurt a wizard.
- 30 HP of grunt damage during a channel did not cancel it.
- The volunteer is never the leader for sizes 4/3/2, and is denied at size 1. The spell is lost
  on activation when the volunteer was the last of their class.
- A volunteer into the keg chain fired all 3 kegs, killed the pack and hurt no other wizard.
- The Hat Hill entry survived a page reload.
- Three restarts (idle, mid-channel, mid-sprint) leaked nothing.
- The console is clean at every size.

The notes are feel and readability observations for the human, listed at the end.

## Quality gate (real output, run by me on the final tree)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | `Test Files 42 passed (42)` / `Tests 878 passed (878)` (M5: 32 / 673) |
| `pnpm build` | `✓ built in 375ms` |
| `pnpm exec prettier --check .` | `All matched files use Prettier code style!` |
| `.skip` / `.only` / `.todo` in tests/ | 0 |

## Done-when walk

| Item | Status | Evidence |
|---|---|---|
| A. **plan §9:** each MVP combo resolves correctly for every living-squad composition (unit-tested) | PASS | combo.test.ts: 8 compositions on fixtures **and** on shipped `CONVERGENCES`, every data permutation, ties, 0 alive (M6-T3-T4). channel.test.ts: combo × power at strike for all 8, damage × power per blast (M6-T5). convergenceSim.test.ts: the same on real data at 30/60/144 fps, no wizard hit (M6-T8). In game: P1 below, 8/8 |
| B. **plan §9:** the channel is interruptible by damage only if that is the design decision | PASS | ADR 0005 Q1 / CD Q1: damage never interrupts. channel.test.ts "only a wipe cancels"; sim wipe test. In game: P2, 30 HP lost mid-channel, released, `cancelled` 0 |
| C. **plan §9:** Volunteer never picks the leader | PASS | volunteer.test.ts sizes 0–4 plus a 200-roster fuzz (M6-T6). In game: P3, picked id = last trail id ≠ leader at sizes 4/3/2; size 1 denied |
| D1 gate green; core tests: combo + power for {P, S, PP, SS, PS, PPS, PSS, PPSS} at strike incl. P,S,S with P killed → Thunderstorm ×1.5; meter rules; channel timeline at 30/60/144 fps; volunteer pick on sizes 1–4; spell loss on activation; death mid-sprint detonates; Hat Hill entry shape | PASS | Quality gate above. combo/channel/meter/volunteer/hold/hatHill/save tests (M6-T3 … T8). Mid-sprint death: one `volunteer` death and a same-frame blast (volunteer.test.ts, sim at 30/60/144, M6-T6 M1 closed). Core purity by grep |
| D2 Convergence in game: meter fills from squad damage/kills (not Convergence); R/Space full → 1.2 s channel; squad stops; autos/spells/Volunteer blocked; element beams to the leader; ring tracks the clamped aim and locks; strike matches the table; damage never cancels; leader death retargets | PASS | P1, P2, and M6-T9-T13's run: leader moved 0 px under input; Q/E 0 casts; F denied; release `at` = tracked aim; K mid-channel → leader 1→2, beams 3→2, Firestorm ×2. Meter: strike kills give 0 charge (Combusts charge, CD Q3) |
| D3 Volunteer in game: F picks the last trail wizard, never the leader; bark; sprints to the clamped aim; detonates at the first of arrival / contact / fuse / death; blast hits enemies and kegs, never wizards; spell lost on activation if last of class; cooldown and denied shake; unavailable with 1 wizard and in a channel | PASS | P3, P4. Arrival (T9-T13 run), contact (P4) and death (sim + J debug) reasons all seen; cooldown 12 → denied; HUD F slot sweep and number |
| D4 Hat Hill entry (name, class, mission, cause `volunteer`) via `platform/storage` in a versioned save | PASS | P5: entry present before and after `Page.reload`. LocalStorageSaveRepository key `arcane-fodder.save.v1`, core `readSave`/`canOverwrite` (newer saves never overwritten, tested) |
| D5 HUD meter (fill, ready glow, spent) and Volunteer indicator (ready / cooldown / unavailable, denied shake) per §5c; debug C fills; overlay shows meter, phase, pending, volunteer state | PASS | Screenshots P7: bar bottom-centre with R badge, full purple + glint when ready, grey/spent during the channel, spell slots dimmed while channelling, F slot with cooldown number. Debug overlay `conv` and `vol` lines (gate-debug-*) |
| D6 pooling and clean restart: beams, ring, shadow/impact, meteorlets, bolts, burning ground, blast, bark bubbles pooled; no listener, key, sprite, pool or HUD leak over 3 restarts incl. mid-channel and mid-sprint | PASS | P6. Pool `created` constant across 3 Firestorm + volunteer rounds (M6-T9-T13). All named FX are pools in ConvergenceFxView/VolunteerFxView |

## Diff review since tag `M5`

Scope:
- `git diff M5`: 35 tracked files, +1536/−324.
- The untracked M6 files: src/core/{convergence,save,hatHill.ts,squad/volunteer.ts},
  src/data/{convergences,volunteer,barks}.ts, src/game/{fx,hud,save,services.ts,systems,views}
  new files, src/platform/storage, and the new tests.

Every file was reviewed in its task review.

| Rule (CLAUDE.md) | Status | Evidence |
|---|---|---|
| Ownership | OK | contracts and plan.md §7.4 by the producer with CD approval (M6-T0, Follow-ups); data, GDD and readability by game-designer; src/core and tests by core-dev (including tests/platform and tests/data); src/game, src/app, src/platform and main.ts by game-dev; reviews by reviewer. ADR 0006 and asset-list.md flash-cap alignment by the producer (CD 2026-10-21). plan.md is read-only again |
| Core purity | OK | grep: no Phaser, `@game`, `@platform`, `window`, `document`, timers or `Math.random` in src/core (the one hit is a comment in rng.ts) |
| Data type-only, `as const satisfies` | OK | no value import in src/data; CONVERGENCES (keyed `satisfies` by `ConvergenceId`), CONVERGENCE, VOLUNTEER, VOLUNTEER_BARKS |
| No tuning literals in systems | OK | gameplay numbers from src/data; src/game literals are §5c presentation constants (CD 2026-10-16 data-home rule) |
| No rules in src/game | OK | meter, combo, channel timeline, strike picks, hold, volunteer pick/sprint/detonation, death cause, save migration are core calls |
| One authoritative state; derived spells | OK | runner position owned by core `VolunteerState` (SquadSystem mirrors it for sprites); spell loss falls out of `spellSlots`; HUD reads a read-only model |
| Event bus | OK | new events used as contracted (incl. `convergence:impact.element`); 36 `bus.on` / 36 `bus.off` in src/game |
| Phaser clock only | OK | no `setTimeout`/`setInterval`/`requestAnimationFrame`/`Date.now`/`performance.now` in src/game, src/app, src/platform, main.ts |
| update/destroy, SHUTDOWN | OK | new systems and views have `destroy()`; P6 flat |
| Pooling | OK | see D6 |
| Pointer → world | OK | Convergence and Volunteer read `GameInput.aimWorld` only; core clamps |
| Storage only through platform | OK | no `localStorage` outside src/platform; the `SaveRepository` interface lives in src/game/save and platform implements it (no `@platform` import in game/core/data) |
| No weakened config, skipped or deleted tests | OK | no change to tsconfig, eslint config, package.json, lockfile, vite or prettier config since M5; no deleted test files |

## Playtest (WebGL, private Vite, HMR and watch off, port 5391)

Harness: chrome-headless-shell with ANGLE/SwiftShader. The console showed `Phaser v4.2.1 (WebGL | Web
Audio)`. I confirmed the served code was current (`meterStart: 65` in convergences.ts,
src/game/save/SaveRepository.ts present). Headless frame rate was 20–45 fps.

### P1. Combo walk, every composition (K/L, C, R)

Method:
1. Restart, then wait for the north grunt fight to end.
2. Kill down to the target with K (leader) and L (random follower); retry from a restart when L
   picks the wrong class.
3. C, aim toward the nearest living enemy (clamped to 150 px so the pointer stays on the canvas),
   R, and wait for `idle`.

| Target | Squad (trail order) | Ring | Release | Impacts | Expected | Wizard HP before → after |
|---|---|---|---|---|---|---|
| PPSS | PSPS | firestorm | firestorm ×2.5 | 14 | firestorm ×2.5, 14 | unchanged |
| PPS | PPS | firestorm | firestorm ×2 | 14 | firestorm ×2, 14 | unchanged |
| PSS | SPS | firestorm | firestorm ×2 | 14 | firestorm ×2, 14 | unchanged |
| PS | PS | firestorm | firestorm ×1.5 | 14 | firestorm ×1.5, 14 | unchanged |
| PP | PP | meteor | meteor ×1.5 | 1 | meteor ×1.5, 1 | 60 → 24 (see note) |
| SS | SS | thunderstorm | thunderstorm ×1.5 | 10 | thunderstorm ×1.5, 10 | unchanged |
| P | P | meteor | meteor ×1 | 1 | meteor ×1, 1 | 60 → 30 (see note) |
| S | S | thunderstorm | thunderstorm ×1 | 10 | thunderstorm ×1, 10 | unchanged |

**8/8 correct.** Note on the two Meteor rows: I traced both with per-frame samples. The HP loss is
grunt melee, 6 HP per swing, with grunts in `windup`/`recover` 22 px from the wizard. In those
attempts the reduced squad hadn't finished the north fight before my 400-frame cutoff. Wizard HP
moved only on grunt swing frames. No Kaboom and no keg lit; the Meteor landed 100+ px away. Damage
× power per blast isn't readable from the snapshot (overkill on 24 HP goblins); it's covered by
channel.test.ts and the sims on real data. Flash budget: each Meteor asked for and got 1 flash;
barrage strikes asked for none (§5c table). **PASS.**

### P2. Damage does not cancel the channel

Squad cut to P,S with K, K. I waited for grunts in melee, then C, R. Over the 1.2 s channel the
wizards went from `{3: 54, 4: 50}` to `{3: 24, 4: 50}` (30 HP lost to grunt hits). Phase samples:
12 × `channeling` then `striking`; release firestorm ×1.5; `cancelled` 0. **PASS.**

### P3. Volunteer on squad sizes 1–4, spell loss on activation

| Size | Squad | Leader id | Last id | Picked | Squad after | Slots after | `spell:lost` |
|---|---|---|---|---|---|---|---|
| 4 | PSPS | 1 | 4 | 4 ("Finally, a promotion!") | 3 | both on | none |
| 3 | SPS | 2 | 4 | 4 ("Third time's the charm!") | 2 | both on | none |
| 2 | PS | 3 | 4 | 4 ("I'm too old to be a rookie!") | 1, F slot unavailable | lightning **off** | `lightning` on the activation frame |
| 1 | S | 4 | 4 | none: `denied` +1 | 1 | unchanged | none new |

Never the leader. The size-2 Stormcaller leaving takes Lightning at activation, not at detonation
(GDD §5). **PASS.**

### P4. Volunteer into the keg chain

Setup: north fight cleared, squad walked west to x 799 (leader), F aimed at the middle keg (624, 768).

The keg pack aggro'd on the sprinting rookie and charged through the kegs, which is correct: the
runner is a squad-team unit, "my calls". The runner hit grunt #13 at (639, 756) and went off on
**contact** at (656, 768). Result:
- 3 Kabooms; kegs 17/18/19 `spent`, east keg 20 idle.
- All 4 pack grunts dead.
- The volunteer's only death record is cause `volunteer`.
- Other wizards' HP unchanged.
- Hat Hill +1 `{Rupert the Smouldering, stormcaller, dev-arena, volunteer}`.
- The meter rose (detonation and Kaboom charge, Q3).

Screenshots: gate-volunteer-sprint.png (bark bubble, blinking outline, dashed blast ring,
fuse ring), gate-volunteer-detonation.png (arcane blast, three 72 px keg rings, hat arcing),
gate-keg-chain-after.png (dropped hat, chain gone). **PASS.**

### P5. Save entry after a reload (D4)

Hat Hill length 3 before and 3 after `Page.reload`. The last entry is identical. **PASS.**

### P6. Leaks over 3 restarts (idle, mid-channel, mid-sprint)

| Moment | bus | keys | keydown | pointer move/down | shutdown | overlays live | display objects | HUD active / objects | FX pools live (non-keg created) |
|---|---|---|---|---|---|---|---|---|---|
| start | 36 | 24 | 16 | 1/1 | 13 | 1 | 47 | true / 4 | 4 (0) |
| after idle restart | 36 | 24 | 16 | 1/1 | 13 | 1 | 47 | true / 4 | 4 (0) |
| mid-channel, before restart | 36 | 24 | 16 | 1/1 | 13 | 1 | 53 | true / 4 | 10 (6) |
| after mid-channel restart | 36 | 24 | 16 | 1/1 | 13 | 1 | 47 | true / 4 | 4 (0); phase idle, meter 65 |
| mid-sprint, before restart | 36 | 24 | 16 | 1/1 | 13 | 1 | 56 | true / 4 | 13 (9) |
| after mid-sprint restart | 36 | 24 | 16 | 1/1 | 13 | 1 | 47 | true / 4 | 4 (0); 0 runners, 4 wizards |

Everything returns to the start values. "4 live" is the 4 keg sprites. **PASS.**

### P7. Screenshots and console

Files in docs/reviews/M6-screenshots/, overlay hidden unless named `debug`:
- `gate-meter-ready-<size>`
- `gate-channel-<size>`
- `gate-strike-<size>`
- `gate-volunteer-<size>`
- `gate-debug-<size>`

| Size | Canvas | Release | HUD | Console (besides Vite) |
|---|---|---|---|---|
| 390×844 | 390×219 at y 312 (letterboxed) | firestorm ×2.5 | yes | `Phaser v4.2.1 (WebGL \| Web Audio)` only |
| 1280×720 | 1280×720 | firestorm ×2.5 | yes | same |
| 2560×1440 | 2560×1440 | firestorm ×2.5 | yes | same |

No warning or error in any run of the gate, including restarts and reloads. At 390×844 portrait the
game is 219 px tall, and the meter, slots and badges are tiny. That's expected until M8's touch
layout (as in M5).

## Open items and notes for the human

### Feel and readability questions (only you can answer)
1. **Beams in single file.** At rest the followers stand straight behind the leader, so all
   channel beams run up the same vertical line, over the wizards' own staffs
   (gate-channel-1280x720.png). The orb and the ring read well; the "light pouring into the leader"
   doesn't. Does it need a fan-out (beams from staff tips offset sideways), or is it fine in motion?
   Owner if changed: game-designer (§5c), then game-dev.
2. **Is the Firestorm satisfying?** On MVP goblins it's a wipe with no visible Combusts (CD
   2026-10-21: kept; the showcase lives on huts in M7). The 14 strikes over 2 s with the cloud read
   as "the big one".
3. **Does the volunteer feel like a joke or a trap?** The pack charges the rookie, so many
   detonations happen on contact before the aim point. That's the design, but it changes where the
   blast lands versus where you aimed. Is that fun?
4. **Meter pacing.** meterStart 65 means the first dev fight fills the meter. Does R feel earned or
   free?

### Carried over (not blocking M6)
- Auto cooldowns freeze during the channel (producer OK).
- Squad wiped while a volunteer still runs: GDD §14 defeat rule in M7 (Follow-ups).
- `'dev-arena'` stays in `MissionId` for M7 (CD 2026-10-21).
- The barrage may pick a target that died earlier in the same frame (accepted, documented in
  channel.ts; no effect seen in P1).
- The debug overlay runs under the HUD meter at 1280×720 (debug only).
- Not run at this gate (not in plan §9 or D1–D6): a 100% grayscale pass and a frame-accurate flash
  log on 8+ goblins (readability §5c verify 2 and 7). The flash counters in P1 stayed within the
  §1.9 cap. Worth doing in the M8 art pass.
