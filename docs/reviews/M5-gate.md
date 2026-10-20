# M5 Gate — Granted spells and reactions

Reviewer: reviewer · Date: 2026-10-19 · Branch: m5-phase (uncommitted work on top of b292ffb, tag `M4`)
Inputs: plan.md §9 M5, docs/design/sprints/M5.md (D1–D7, CD answers, follow-ups), task reviews
docs/reviews/M5-T0 … M5-T13, GDD mvp.md §3/§16 request 12 (CD retune, Combust 3).

## Verdict: PASS WITH NOTES

Every plan.md §9 M5 item and every sprint item D1–D7 is met, with evidence below. All 14 task
reviews are final (PASS, or PASS WITH NOTES for T0 and T2 with nits and deferred style-guide items
only). No blocker, major or minor is open against code. In game under WebGL:
- spells landed within 0.001 px at the centre and all 4 corners;
- losing either class removes its spell once and for good;
- the Combust-3 no-input fight clears in 2.6–2.7 s at 1.8–2.3 Combusts/s with grunts landing swings
  first, and no wizard is lost;
- Fireball, Lightning and Combust each light kegs, and the south-keg chain fires in 3 beats 300 ms
  apart with the ring up for the whole fuse;
- the ≥ 16 px flash cap held (3 granted, 1 refused) through a 4-flash chain;
- 3 restarts, including one mid-flight and one mid-fuse, leaked nothing;
- the console is clean at every size.

The notes are feel questions for the human and small carry-overs, listed at the end. No blockers,
so nothing was routed.

## Quality gate (real output, run by me on the final tree)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | `Test Files 32 passed (32)` / `Tests 673 passed (673)` (M4: 25 / 531) |
| `pnpm build` | `✓ built in 373ms` |
| `pnpm exec prettier --check .` | `All matched files use Prettier code style!` |
| `.skip` / `.only` / `.todo` in tests/ | 0 |

## Done-when walk

| Item | Status | Evidence |
|---|---|---|
| A. **plan §9:** spells land precisely at every camera position | PASS | P2: 20/20 casts within 0.001 px at the centre and 4 clamped corners, both spells, in and beyond range; 0.16 px at a non-integer canvas scale. Core: impact ≤ 2 px over 6 directions × 4 reaches × 3 fps (caster.test.ts) |
| B. **plan §9:** losing the last Pyromancer disables Fireball | PASS | P3: Fireball lost exactly once on the last Pyromancer's death; Q and left click denied with no cast, FX or cooldown; never returns; Lightning still works. Same for the last Stormcaller and Lightning |
| C. **plan §9:** Combust and Kaboom trigger reliably | PASS | Combust: 5–6 per no-input fight in game (P1), ≥ 1 in every sim run, and a lethal Lightning on a burning goblin always Combusts (core pre-hit rule, spellSim). Kaboom: Fireball, Lightning and Combust each lit a keg in game; the chain went off in 3 beats each `fuseMs` apart (P4) |
| D1 gate green; cooldowns, area damage (body rule), slot derivation for all 8 compositions, Combust and Kaboom resolution tested in pure-TS core | PASS | Quality gate above. availability.test (8 compositions, loss orders, property test), area.test (GDD reaches, gib cap, rounding), caster.test, reactions.test (GDD §7 and §8 verifies), keg.test, knockback.test (M5-T3 … T8). Core purity by grep |
| D2 precision ≤ 2 px after the 280 px clamp at the centre and 4 corners, from `DebugSnapshot` | PASS | P2 |
| D3 slots derived; `spell:lost` once; slot greys out; press does nothing but a short shake; never comes back; slot 1 stays slot 1 | PASS | P3; HUD crops in gate-hud-d3-states.png; derivation memoised per run (M5-T10) |
| D4 Combust reliable: GDD §7 verify as a unit test; ≥ 1 Combust in every sim run (3 seeds × 30/60/144) and in game; Lightning on a burning goblin always Combusts. Plus the CD retune targets (GDD §3 / §16 request 12) | PASS | reactions.test §7 verify; encounter.test M5 block asserts ≥ 1 Combust, 2.3–5.0 s clear, 1.0–3.0 Combusts/s and a landed swing before the clear on all 9 runs. In game (P1, 3 runs): clear 2.60–2.73 s, 1.83–2.31 Combusts/s, first landed swing 2.15–2.60 s, 0 wizards lost. Note: run 3's swing landed on the clearing frame (zero margin), see the open items |
| D5 Kaboom reliable: GDD §8 verify as a unit test (chain of 3 at 64 px, 300 ms apart; wizard at 70 takes 30, at 90 nothing); Fireball, Lightning and Combust each trigger a keg in game; arrows, melee and autos never do; the 72 px ring shows for the full 300 ms | PASS | reactions.test §8 verify (30/60/144 fps); spellSim south-keg 3-beat shot. P4: all three sources in game, each chain gap 300 ms ± one frame, wizard at 74.6 px took 30 and was pushed 36 px; non-sources lit 0 kegs; the ring shows the whole fuse |
| D6 pooling and clean restart: orbs, reticles, bolts, bursts, pops, embers and blasts pooled; no listener, key, sprite, pool or HUD-scene leak over 3 restarts | PASS | P6: every counter flat over 3 restarts, including mid-flight and mid-fuse; one HUD per run; pools reset to 0/0. Diff review: all M5 FX pooled |
| D7 HUD slots show ready, cooldown (time visible) and lost per readability §5b | PASS | P3 crops: cream ready, ash cooldown with sweep and whole seconds, slate lost with grey icon and slash, denied shake. M5-T12 (grey lost icons fixed) |

## Diff review since tag `M4`

Scope: `git diff M4` (22 tracked files, +1504/−117) plus the untracked M5 files (src/core/{combat/area,
combat/reactions,spells,structures}, src/data/{spells,reactions,structures}.ts, src/game/{fx,hud,palette},
HudScene, SpellSystem, KegSystem, SpellFxView, ReactionFxView, and the new tests). Every file was
reviewed in its task review (M5-T0 … T13).

| Rule (CLAUDE.md) | Status | Evidence |
|---|---|---|
| Ownership | OK | contracts (types.ts, events.ts) and the plan.md §7.4 refresh by the producer with CD approval (M5-T0); data and GDD by game-designer (T1, T2); core and tests by core-dev; src/game by game-dev; reviews by reviewer. Every cross-role finding went to its owner by message |
| Core purity | OK | every `from` in src/core is `@core/*`; no Phaser, DOM, `window`, timers or `Math.random` (grep) |
| Data is type-only, `as const satisfies` | OK | no value import in src/data (grep); SPELLS, REACTIONS, KEG, DEV_KEGS, DEV_KEG_PACK all `as const satisfies` |
| No tuning literals in systems | OK | gameplay numbers come from src/data (spells, reactions, structures, combat). Literals in src/game are presentation constants citing readability §5/§5b (CD 2026-10-16), plus `FLASH_SAFETY` citing §1.9 |
| No rules in src/game | OK | casting, clamp, availability, area hits, Combust, Kaboom, keg fuses and wizard knockback are core calls; CombatSystem is the one area-damage entry point (M5-T9) |
| One authoritative state; derived spells | OK | keg state in core `KegState`; slots derived on every read and memoised per run; HUD reads a read-only model; the Burning overlay re-reads world statuses (T6 M2 fixed) |
| Event bus | OK | new events used as contracted; 24 `bus.on` / 24 `bus.off` in src/game; HudScene holds no listeners (HudModel does) |
| Phaser clock only | OK | no `setTimeout`/`setInterval`/`requestAnimationFrame`/`Date.now`/`performance.now` in src/game, src/app, src/main.ts, src/core (grep); fuses, telegraphs, cooldowns and FX run on scene dt |
| update/destroy, SHUTDOWN | OK | every new system and view has `destroy()`; MissionScene stops HudScene on SHUTDOWN; restart check flat (P6) |
| Pooling | OK | Fireball orbs, trail, bursts, reticles, bolts, ground flashes, keg sprites, rings, sparks, Kaboom blasts, embers, smoke and debris all use `ObjectPool` (`ImagePool`/`GraphicsPool`) |
| Pointer → world before gameplay | OK | SpellSystem reads only `GameInput.aimWorld`; precision P2 |
| No weakened config, skipped or deleted tests | OK | no change to tsconfig, eslint config, package.json, lockfile or vite config since M4; no deleted test files; the M4 encounter assertions are intact (M5-T8) |

## Playtest (WebGL, private Vite, HMR off)

### P1. No-input fight, Combust 3 (GDD §3 / §16 request 12)

Harness: chrome-headless-shell with ANGLE/SwiftShader (console: `Phaser v4.2.1 (WebGL | Web Audio)`),
private Vite on its own port with HMR and watching off. I confirmed the served code was current:
`damage: 3` in reactions.ts and `minFlashRadiusPx` in FlashBudget.ts. A per-frame in-page sampler
summed the snapshot's `delta` from scene frame 3. The 6 north grunts are ids 5–10. No input at all.

| Run | Clear (s) | First landed grunt swing (s) | First Combust (s) | Combusts by clear | Combusts/s (squad) | Squad HP lost | Wizards lost | Kegs lit | Archers + keg pack |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2.73 | 2.15 | 1.18 | 5 | 1.83 | 12 | 0 | 0 | 6 idle |
| 2 | 2.70 | 2.54 | 1.17 | 5 | 1.85 | 6 | 0 | 0 | 6 idle |
| 3 | 2.60 | 2.60 (same frame as the clear) | 1.19 | 6 | 2.31 | 6 | 0 | 0 | 6 idle |

Targets (GDD §3 / §16 request 12, CD retune): clear 2.3–5.0 s ✓; 1.0–3.0 Combusts/s for the squad ✓
(0.92–1.15 per pair); ≥ 1 landed grunt swing before the clear ✓, with a note: in run 3 the swing
landed on the clearing frame. In frame order (enemy actions resolve before the Combat-phase death
flush) it still counts as before the clear, but the margin is zero frames. The headless frame time
was ragged (dt up to 66 ms; the dt clamp held), so a real browser at 60 fps should look like the
sim (first swing 2.06–2.57 s, clear 2.33–2.75 s). **PASS**, with the swing margin as a feel item
for the human (below).

### P2. D2 precision

Method as in M5-T10.md. Debug **T** moves the squad to each stop, and the camera is clamped at the
corners. The cursor goes to a known screen point. The expected point is `camera.scroll + screen / 2`,
clamped to 280 px from `lastCast.from`, and it's compared with `DebugSnapshot.spells.lastImpact`.
Each stop gets two aims per spell: one in range and one beyond it (clamped). 1280×720, canvas ×2.

| Stop | Fireball in range | Fireball clamped | Lightning in range | Lightning clamped |
|---|---|---|---|---|
| Top-left | 225.1 px → 0.000 px | 317.0 → 280: 0.000 | 225.1 → 0.000 | 316.8 → 280: 0.000 |
| Top-right | 178.6 → 0.000 | 554.5 → 280: 0.000 | 178.5 → 0.000 | 554.5 → 280: 0.000 |
| Bottom-right | 134.1 → 0.000 | 522.9 → 280: 0.000 | 134.1 → 0.000 | 522.9 → 280: 0.000 |
| Bottom-left | 128.9 → 0.000 | 294.1 → 280: 0.000 | 128.9 → 0.000 | 294.1 → 280: 0.000 |
| Centre | 111.7 → 0.000 | 399.9 → 280: 0.000 | 111.7 → 0.000 | 399.9 → 280: 0.000 |

All 20 casts were within 0.001 px. At a non-integer canvas scale (1000×650 window, ×1.5625,
letterboxed), both spells were within 0.16 px; the residue is CDP's integer mouse coordinates.
**PASS** (≤ 2 px everywhere).

### P3. D3 loss of each class

Squad P,S,P,S. Debug K kills the leader and L a random follower.

| Scenario | Slots after | `spell:lost` | Pressing the lost slot (key ×3 + mouse button) | Other slot | 5 s later |
|---|---|---|---|---|---|
| K, K, K (P, S, P die; one S left) | 1 fireball **lost**, 2 lightning on | 1 (fireball), on the 3rd K only | `denied` 0 → 4; casts unchanged; no pending; FX pool `created` flat (no orb, burst or trail); no cooldown | E casts (cd 1663 ms) | still lost, still 1 event |
| K, K, L (P, S, then the last S; one P left) | 1 fireball on, 2 lightning **lost** | 1 (lightning), on L only | `denied` 0 → 4; same as above | Q casts (cd 3155 ms) | still lost, still 1 event |

Slot 1 stays Fireball and slot 2 stays Lightning in every state. HUD crops (1280×720, ×3):
M5-screenshots/gate-hud-d3-states.png shows ready, cooldown ("4"/"2" with the sweep), Fireball lost
(grey icon and slash), the denied shake, and Lightning lost. **PASS.**

### P4. D5 kegs

All measurements come from the per-frame sampler (game time from the snapshot's `delta`).

| Check | Result |
|---|---|
| **South-keg chain** (Fireball from the spawn side at the south keg, GDD §8 verify 2) | contact at (637.4, 827.9) lights #19 on the impact frame. #19 at 858.0 ms, #18 at 1158.4 (+300.4), #17 at 1458.4 (+300.0), last boom at 1766.5 (+308.1 = 300 + one 8.3 ms frame; the fuse had 0.2 ms left on the frame before). 3 beats, each within one frame of `fuseMs`. M5-screenshots/gate-keg-chain-south.png |
| **Ring for the full fuse** | `ringShown` true from the lit frame (fuse 300) through the last fuse frame on all 3 kegs, removed on the blast frame |
| **Archer keg** (Lightning on the keg behind the archers) | keg #20 lit on the strike frame. Kaboom 306 ms later. Both archers killed (blood); no wizard touched. Bolt drawn for 15 frames (~125 ms). M5-screenshots/gate-lightning-archer-keg.png |
| **Combust lights a keg** (no input, squad walked west and stopped) | stop x 720: 0 casts, the 6th Combust and the first keg light land on the same frame, then a 3-keg cascade. Stop x 700: the same on the 7th Combust. Stop x 740: 8 Combusts, no keg in reach, 0 lit. Autos never light kegs directly (GDD Q12; the sims assert `kegsLit = 0`); this indirect path is CD-confirmed (2026-10-19, mvp.md §7) |
| **Wizard in the ring** (Lightning on the middle keg, leader 74.6 px away) | leader 60 → 30 (×0.5) on the blast frame. Pushed 698.6 → 734.6 (36.0 px), eased over ~115 ms. Followers ≥ 87 px away were untouched. Camera scroll moved at most 1.90 px per frame, with no jump. M5-screenshots/gate-kaboom-wizard-in-ring.png |
| **Non-sources** | arrows, melee and autos light nothing: P1's three no-input fights lit 0 kegs, the sims assert it (M5-T8), and core tests cover each source (M5-T6) |

**PASS.**

### P5. Flash cap in a keg chain (≥ 16 px rule, CD-confirmed 2026-10-19)

| Scenario | Flash requests that count (core radius ≥ 16 px) | Granted / refused |
|---|---|---|
| South-keg chain: Fireball burst (core 17.6 px) at 858.0, Kabooms (28.8 px) at 1158.4, 1458.4, 1766.5 | 4 in 908.5 ms | **3 / 1**: the last Kaboom's core is dropped and the blast still draws in its edge colours. Shakes 3, each restarted |
| Archer keg: Lightning ground flash (5 px) + 1 Kaboom | 1 | 1 / 0: the ground flash played uncounted |
| No-input fights (P1): 5–6 Combust pops (12.8 px) each | 0 | 0 / 0: the pops played uncounted |

At most 3 counted flashes in any 1 s window. The keg blink (white/crimson, CD-exempt) and hit
flashes never ask. **PASS.**

### P6. D6 restarts

Four runs (3 restarts). Each run: wait 1 s, walk west, Fireball at the south keg, Lightning,
snapshot, Backspace. Run 1 restarts 300 ms after the casts, with the Fireball in flight and a keg
fusing. Run 2 restarts 1 s after, with Kaboom FX, smoke and debris live and a keg fusing.

| Run | Phase | bus listeners | keyboard keys | keydown listeners | pointer move/down | shutdown listeners | overlays live/created | HUD active / objects | display objects |
|---|---|---|---|---|---|---|---|---|---|
| 0 | start | 24 | 22 | 14 | 1/1 | 13 | 1/1 | true / 2 | 47 |
| 0 | after | 24 | 22 | 14 | 1/1 | 13 | 1/1 | true / 2 | 93 |
| 1 | start | 24 | 22 | 14 | 1/1 | 13 | 1/2 | true / 2 | 50 |
| 1 | restart mid-flight | 24 | 22 | 14 | 1/1 | 13 | 1/2 | true / 2 | 70 |
| 2 | start | 24 | 22 | 14 | 1/1 | 13 | 1/3 | true / 2 | 50 |
| 2 | restart mid-fuse | 24 | 22 | 14 | 1/1 | 13 | 1/3 | true / 2 | 83 |
| 3 | start | 24 | 22 | 14 | 1/1 | 13 | 1/4 | true / 2 | 50 |
| 3 | after | 24 | 22 | 14 | 1/1 | 13 | 1/4 | true / 2 | 84 |

- Every M5 FX pool starts each run at `0/0`, and the kegs at `4/4`.
- Exactly one HudScene runs per run, with 2 objects. One canvas at the end. No console errors,
  including the restarts mid-flight and mid-fuse.
- The 47 vs 50 at "start" is explained (the observation from M5-T13 is closed). Timed samples at
  200, 600, 1000 and 1500 ms after each start read 47 → 47 → 49 → 50 on every run, rising as the
  no-input fight lazily creates its first pooled projectiles and Burning overlays. It isn't
  carried over between runs.

**PASS.**

### P7. Screenshots at 390×844, 1280×720, 2560×1440 and console

Files in docs/reviews/M5-screenshots/:
- `gate-<size>.png`: overlay hidden, Fireball and Lightning just cast toward the pack, HUD in cooldown.
- `gate-debug-<size>.png`: overlay visible at 1.5 s.

| Size | Canvas | Casts | HUD active | Console (besides Vite) |
|---|---|---|---|---|
| 390×844 | 390×219 at y 312 (×0.609, letterboxed) | 2 | yes | `Arcane Fodder / Phaser v4.2.1 (WebGL \| Web Audio)` only |
| 1280×720 | 1280×720 (×2) | 2 | yes | same |
| 2560×1440 | 2560×1440 (×4) | 2 | yes | same |

No warning or error at any size. At 390×844 portrait the whole game is 219 px tall, and the HUD
slots are about 20 px across with unreadable Q/E badges. That's expected for a desktop layout on
a portrait phone; touch moves the slots in M8 (readability R11). With `?debug`, the overlay text
covers the HUD slots (debug only).

## Open items and notes for the human

### Carried over (not blocking M5)
- **Art-director (M8):** the style guide's `cream` row gains the HUD exception, and §10's flash
  reference changes §1.7 → §1.9 (M5-T2).
- **game-dev (M8):** the HUD's placeholder monospace font → the HUD pixel font (M5-T12 n1).
- **M8 touch layout (R11):** on a portrait phone the desktop HUD is about 20 px per slot (P7).
- **Debug only:** with `?debug` the overlay text covers the HUD slots.

### Watch items from the playtest (observations, not findings)
- **Swing margin.** In P1 run 3 the first grunt swing landed on the same frame the pack was
  cleared. It still counts as "before" in frame order, and the sim gives 2.06–2.57 s against a
  2.33–2.75 s clear, but the margin is thin. If the human wants the grunts to *visibly* reach the
  squad, the next lever is pack distance or Combust damage (data, game-designer).
- **Squad bunching after a Kaboom.** After the leader is pushed 36 px back along its own trail, the
  followers end up clumped around it (gate-kaboom-wizard-in-ring.png, last frames). It recovers
  through follow, but it looks like a pile-up for a moment.
- **An unprovoked Kaboom hurt the squad.** At stop x 700 (P4) the no-input squad lost 30 HP from a
  keg that a Combust lit while the pack charged through the chain, with no input from the player.
  That's the CD-confirmed path, but it's exactly §16 request 4's fairness question.

### Feel questions only the human can answer
1. **Is the 3-damage Combust pop too weak?** It now reads as a small orange pop plus ember arcs
   that spread Burning; the kill comes from the Burning and the sparks. Does it still feel like
   "the two classes are better together"?
2. **Does a Combust lighting a keg feel fair (§16 request 4)?** Walk west so the keg pack charges
   through the chain without casting anything. Does the explosion feel like your squad's doing,
   or random? (The fallback is a CD question: Combust stops lighting kegs.)
3. **Do the rings match what gets hit (§16 request 9)?** The rings are drawn at `radiusPx`, and the
   hit rule adds the target's body radius. A wizard whose feet stand just *outside* the 72 px ring
   (74.6 px) still takes 30 because the body touches it. Does that read as fair, or does the ring
   need to grow by the body radius visually?
4. **Lightning bolt readability at speed.** It's on screen for about 125 ms with a 2 px core; in
   stills it's clear. Is it at 60 fps?
5. **Keg blink.** White/crimson at 10 Hz for 300 ms: loud enough as the "get out" tell, and not
   uncomfortable?

### Suggested 5-minute playtest
1. Load `?debug`, hide the overlay (`` ` ``), touch nothing for 4 s: the pack charges and pops with
   Combusts. Do the grunts reach you?
2. Q into a pack, E onto a single goblin. Watch the reticle, the bolt and the HUD sweep and seconds.
3. Walk west and Fireball the south keg from the east: three blasts, a beat apart.
4. Walk east and Lightning the keg behind the archers.
5. Stand about 75 px from a keg and light it: take 30 and get pushed. Watch the camera and the
   squad.
6. Walk west without casting and let the keg pack charge through the chain (question 2).
7. Press K three times: Fireball greys out with the slash; Q and left click only shake the slot.
