# Review M7 gate: Destroy & Extract

Reviewer: reviewer · Date: 2026-10-22 · Scope: `git diff M6..29ee435` (M7 squash on main, 116 files,
+12 334 / −282), plan §9 M7 "Done when", the plan §8 MVP definition-of-done items M7 touches, and
the CD's surge decision. Evidence from docs/reviews/M7-T18.md is reused where noted. I re-ran
every gate command myself and played the build again.

## Verdict: FAIL (design blocker only)

The code meets every M7 "Done when" criterion. The gate is green, the full mission plays from
start to result, extraction splits saved and left-behind wizards correctly, and the 11-run restart
leak check is stable. **It fails on one design blocker the creative director has set:** the final
surge must be able to reach the wizards, and with the current numbers it can't (squad 110 px/s vs
grunt 85 / archer 70 px/s). This isn't a code defect. Once game-designer and level-designer fix it
and a playtest confirms the surge catches the squad, this becomes PASS WITH NOTES. No code changes
are needed for the gate.

## Blockers

| # | Blocker | Owner |
|---|---|---|
| B1 | The surge wave can't reach the wizards (CD decision) | **game-designer**, **level-designer** |

**B1. The final surge never catches the squad.** CD decision (2026-10-22): the surge wave MUST be
able to reach the wizards.
- Evidence: M7-T18 o4 found that surge goblins never caught the squad on the Gallery because the
  squad outran them. In this gate's victory run, 16 surge goblins spawned (peak 8 alive at once).
  The squad killed the ones near Hut B, and in the final 10 s of the retreat 0 enemies came within
  320 px of the leader (`near: 0`, `onScreen: 0` at t = 64.5 s and 69.5 s). The retreat was a walk.
- Root cause (data): `src/data/classes.ts:14` / GDD Q9 squad speed 110 px/s; `src/data/enemies.ts:12`
  grunt `moveSpeed: 85`, `src/data/enemies.ts:34` archer `moveSpeed: 70`. GDD §13 (mvp.md:871–873)
  and §12 (mvp.md:635 "slower than the squad, so you can kite") write the outrun in as the design.
  Level doc m01 §Section 3 (line 181) says "outrunning is not a plan", but surge placement alone
  doesn't make that true.
- Suggested levers. This is a design call, so these are options, not fixes:
  1. **game-designer:** give surge-spawned enemies (`aggro: 'always'`) a speed of their own that
     matches or beats the squad, for example a surge `moveSpeedMul` in `SURGE` (`src/data/mission.ts`). This needs a
     `SurgeTuning` field, so propose it to the producer as a contract change in `src/core/types.ts`.
     Or raise grunt `moveSpeed` and accept the kiting change everywhere, and update GDD §12/§13.
  2. **level-designer:** move more `surge-01` points onto the Gallery and the Old Bridge line, ahead
     of the squad at the 160 px minimum, so the squad runs *into* the surge. That works even
     without a speed change. Update docs/design/levels/m01-goblin-woods.md §Section 3 and the
     tilemap objects.
  3. Probably both together: speed alone turns the retreat into a chase from behind, and placement
     alone turns it into a fight at a wall.
- Done when: a playtest run (autopilot or human) shows surge goblins making contact with the
  squad on the portal leg, and the GDD §12 peak of ≤ 12 on screen still holds. Retest owner:
  reviewer.

## 1. "Done when" (plan §9 M7)

| Criterion | Result | Evidence |
|---|---|---|
| A full mission can be played from start to result | **PASS** | Gate run, victory 1: intro → Hut A → Hut B → opening → surge (16 spawned) → extraction at `t 70.1 s`, kills 40, lost 0, outcome victory, Results shown. Victory 2: `t 70.7 s`, kills 39. Defeat: `t 39.7 s`, kills 10, Huts 0/2, Lost 4 "Fell in battle" (`gate-d-results.png`). T18 has two more victories and a defeat. |
| Extraction correctly splits saved and left-behind | **PASS** | Live: I fired Volunteer! near the pad, and the leader stepped on mid-sprint → **Saved 3, Lost 1 "Desmond the Lately Alive, Stormcaller. Left behind."** (`gate-v2-results.png`). The save got exactly one Hat Hill entry with `cause: "left-behind"`, and VolunteerSystem recorded none (`hatHillRecorded 0`, no double write). Straight entries saved 4/4 (leak run, attempts 2 and 7). Core: `tests/core/mission/portal.test.ts:121` (0/79/111/113 px at radius 112), `:130` (on the radius = saved), `:137` (runner never saved), `:147` (dead runner isn't left behind), `:155` (single-file squad all saved). A *follower* outside the ring was never seen live (T18 o2). The core tests cover it. |
| Restart leak check passes | **PASS** | 11 attempts (0–10) over Backspace, Pause → R, Results → Enter, mid-opening (1149 ms left), mid-surge (8 alive), Results → click. **Attempts 1–10 are identical on every logged field**: bus 47, keys 28, input 2, display objects 81, tweens 0, textures 67, systems 32, units 24 / enemies 18 / solids 19, all 29 pools at rest, HUD 6 children. Attempt 0 has `gameListeners.blur` 5 against 4 afterwards, the known Phaser KeyboardPlugin first-boot quirk, and it doesn't grow. 1 canvas after 10 restarts. 0 console errors or warnings. |

## 2. Plan §8 MVP definition of done (items M7 touches)

| Item | Result | Note |
|---|---|---|
| Launches with zero console errors | PASS | 0 errors and 0 warnings in 5 browser sessions (victory ×2, defeat, leak, screenshots). |
| Camera stays within map bounds | PASS | 2048×1536 Tiled map. The camera is clamped in every shot. |
| Goblins chase and attack; archers keep range; huts spawn until destroyed | PASS | Hut tell → door spawns (`gate-v-hut-tell.png`). Archers `keep-range` (defeat run). Spawning stops after destruction (T18 D3, re-seen). |
| Defeat only when the whole squad has died | PASS | Defeat came at squad 0 only. Core `mission.test.ts:93` covers the volunteer-mid-sprint case. |
| Each destroyed target lights a rune; portal opens; final surge spawns after the last one | PASS (mechanics) | Runes 2/2 → `opening` 1500 ms → surge 16, surge cap 12 (`gate-v-opening.png`, `gate-v-surge.png`). **But see B1:** the surge spawns and still can't threaten the squad. |
| Extraction saves only wizards inside the radius; the rest are "Left behind" | PASS | See §1. |
| Restart without reload and without leaks (10 restarts) | PASS | See §1. |
| Touch / device builds | n/a | M8 / M9. |

## 3. Gate commands (re-run by me on `29ee435`, working tree clean)

| Command | Exit | Output |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc --noEmit`, no diagnostics |
| `pnpm lint` | 0 | `eslint .`, no findings |
| `pnpm test` | 0 | `Test Files 54 passed (54)` · `Tests 1059 passed (1059)` |
| `pnpm build` | 0 | `✓ 127 modules transformed`, `dist/assets/index-*.js 1,603.83 kB │ gzip: 430.86 kB`. The chunk-size warning (> 1600 kB) is the Phaser bundle (see n4) |
| `pnpm exec prettier --check .` | 0 | `All matched files use Prettier code style!` |

No tests were deleted or skipped (`it.skip`, `.only` and `todo` don't appear). There are no new
`eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `as any` in the diff, and no tsconfig or
ESLint config changes. The one `package.json` change adds the `maps:build` script.

## 4. Code review (diff M6..29ee435 against CLAUDE.md)

| Rule | Result | Evidence |
|---|---|---|
| src/core is pure (no Phaser/DOM/platform) | OK | `grep "from 'phaser'\|window.\|document.\|localStorage" src/core` → none. Mission rules (objectives, portal phases, extraction split, surge queue/cap, hut timeline, win/lose, best time) are in `src/core/mission/*` and `src/core/structures/hut.ts`, and `PortalSystem` / `MissionSystem` only call them. |
| Data `as const satisfies`; no tuning in systems | OK, with one exception (n1) | `PORTAL`, `SURGE`, `NAVIGATION`, `M01_GOBLIN_WOODS` are typed data. Literals in views and scenes are presentation layout (`PortalView` `LOOK`, `ResultsScene`/`PauseScene` layout). |
| Events via `src/game/events.ts` | OK | New systems use `bus.on`/`bus.off` with typed `GameEventListener<…>`. |
| Every system has update/destroy; cleanup on SHUTDOWN | OK | `MissionSystem:136`, `PortalSystem:216`, `SpawnerSystem:191`, `NavigationSystem:59`, `CollisionSystem:42`, `PortalView:151`, `MissionDebugKeys:59` each remove what they added. MissionScene's SHUTDOWN handler destroys every system even if one throws (`MissionScene.ts:523`). Pause and Results keys die with their scene's SHUTDOWN. Confirmed live by the leak table. |
| Phaser clock only | OK | No `setTimeout`/`setInterval`/`requestAnimationFrame` in src. The results delay, intro pan, opening and surge delays all step on `dt`. |
| Pooling | OK | All 29 pools are back at rest after every restart. Surge and hut spawns go through the existing enemy roster. |
| Storage only through platform/storage | OK | No `localStorage` outside `src/platform`. Hat Hill and best time go through `saves.update`. |
| Pointer → world coords | Unchanged | No new pointer gameplay in M7. |
| File ownership | Not verifiable per file | M7 landed as one squash commit, so I can't tell from git who edited what. The paths are consistent with the ownership table: contracts (`types.ts` +125, `events.ts` +20), `CLAUDE.md` and `plan.md` changed, so the producer should confirm the CD approved them (M7 sprint doc lists the decisions). |

## Minor notes

**n1. `RESULTS_DELAY_MS = 1000` is a timing value in a system** (`src/game/systems/MissionSystem.ts:38`).
It's tuning (the length of the frozen beat before Results), not layout. Fix: game-designer adds
`resultsDelayMs` to `PORTAL` (or a `MISSION` block) in `src/data/mission.ts` via a contract field,
and game-dev reads it. Owners: **game-designer** (value), **game-dev** (wiring).

**n2. Debug-assisted victories write the best time.** `MissionSystem.end()` saves `withBestTime` on
every victory (`src/game/systems/MissionSystem.ts:155-158`), including runs finished with the
debug keys O (open portal) + I (warp). After my leak run the save held a best of **00:02**, and
every later results screen showed "Best 00:02" (`gate-v2-results.png`, `gate-d-results.png`). Players
can't reach this (debug is `?debug` only), but it ruins best-time readings in every playtest
session. Fix: skip `withBestTime` once any debug mission key was used this attempt, or skip it
under `?debug`. Owner: **game-dev**.

**n3. Portrait phones letterbox to a 390×219 strip** (T18 m1, unchanged). Carry to M8/M9.
Owner: **game-dev** (M8 touch/safe areas).

**n4. Build chunk is 1.6 MB minified (431 kB gzip), with a Vite warning.** This is the Phaser
bundle, unchanged in kind since M1. Code splitting is an M9 performance task. Owner: **game-dev**
(M9).

**n5. Mission length is about 1:10 against the 6:00/9:00 target** (T18 o1, re-measured: 70.1 s
and 70.7 s autopilot victories, with the meter full by about 9 s). This one is for the CD, not a
blocker. Changing B1 will affect it, so tune both together. Owners: **level-designer**,
**game-designer**.

**n6. T18 m2 (Lost column width) looks fixed:** the epitaph now sits on its own line under the name
(`gate-v2-results.png`, `gate-d-results.png`). No action.

## Playtest harness and screenshots

Private Vite on :5394 (`hmr: false`, `watch: null`, repo `vite.config.ts` spread). I confirmed it
served M7 code (`curl …/MissionScene.ts | grep "Before the spawner"` → 1) and stopped it afterwards.
Headless Chromium 1208 ran with `--use-gl=angle --use-angle=swiftshader` (WebGL) and was driven
over CDP with `?debug`, using the T18 route autopilot (not a human). FPS was about 17–20 under
software GL in headless mode, which says nothing about real hardware.

Screenshots in `docs/reviews/M7-screenshots/` with a `gate-` prefix: `gate-1280x720-{intro,hut,surge,results}.png`,
`gate-v-hut-tell.png`, `gate-v-opening.png`, `gate-v-surge.png`, `gate-v-ring.png`,
`gate-v-results.png`, `gate-v2-results.png` (left-behind), `gate-d-results.png` (defeat) and
`gate-leak-results.png`. Some show the debug overlay, because the browser profile persisted its
visible state between sessions. T18's screenshots in the same folder are still valid.

Console output, all sessions: only `[vite] connecting/connected`, the Phaser banner and the
`[leak]` info line per attempt. **0 errors, 0 warnings, 0 exceptions.**

## Routing

- B1 → **game-designer**, **level-designer** (CD decision; producer approves any `SurgeTuning`
  contract change)
- n1 → **game-designer**, **game-dev** · n2 → **game-dev** · n3, n4 → **game-dev** (M8/M9) ·
  n5 → **level-designer**, **game-designer** (CD call)

## Addendum 1: n2 recheck (2026-10-22, uncommitted working tree)

game-dev's fix touches `MissionSystem.ts`, `MissionScene.ts`, `MissionDebugKeys.ts` and
`DebugOverlay.ts`. I read the diff and re-ran the checks on the working tree: typecheck 0, lint 0,
`Tests 1059 passed (1059)`, and prettier `src` clean. I did not re-run the live playtest.
**n2 is mostly fixed.** H/O/I/U and G now mark the run (`MissionSystem.markDebugAssisted`,
`MissionSystem.ts:121`). A marked victory writes no best time and shows the stored best with
`newBest: false` (`MissionSystem.ts:165-168`). Two follow-ups:

- **n2a (minor): other shortcuts that help a run still count toward the best time.** T (teleport
  squad, `DebugOverlay.ts:370/552`) and C (fill meter, `:372/555`) save time just as much as I or U,
  but they don't call `markDebugAssisted`. K/L/J (kill your own wizards) and B (burn nearest) are
  borderline. Fix: mark the run from every DebugOverlay gameplay key, i.e. everything except the
  toggle and restart. One option is to pass an `onUse` callback to the overlay, the same way
  `MissionDebugKeys` gets one. Owner: **game-dev**.
- **n2b (minor): the rule sits in src/game and has no test.** "A debug-assisted run never writes or
  claims a best time" is a mission rule. Fix: move it to `src/core/mission/mission.ts`, for example
  a `debugAssisted` flag on `MissionState` that `buildResult`/`withBestTime` respect, and add a case
  next to `tests/core/mission/mission.test.ts:149`. Owners: **core-dev** (rule and test),
  **game-dev** (call site).

T18 m2 (epitaph on its own line) was already in `29ee435`, see n6. No change is needed.
Gate verdict is unchanged: **FAIL on B1 only**.

## Addendum 2: n2a recheck (2026-10-22, uncommitted working tree)

**n2a fixed.** `DebugOptions.onGameplayKey` (`DebugOverlay.ts:359`) is called in all seven overlay
gameplay handlers: K, L, G, B, T, C and J (`DebugOverlay.ts:1150-1220`). It is not called in the
toggle or restart handlers. `MissionScene.ts:330` wires it to `run.markDebugAssisted()`, and the
mission keys still mark the run (`MissionScene.ts:365`). My checks: typecheck 0, lint 0,
`Tests 1061 passed (1061)` (core-dev's work is in progress).
**n2b is still open.** It waits on core-dev's `ResultInput.debugAssisted` / `savesBestTime` in
core, and then on game-dev replacing the override in `MissionSystem.end()`.
Gate verdict is unchanged: **FAIL on B1 only**.

## Addendum 3: n2b core recheck (2026-10-22, uncommitted working tree)

**Core part is fixed.** `src/core/mission/mission.ts` adds `MissionState.debugAssisted` (default
false), `markDebugAssisted` (sticky, keeps the same reference once set), and
`saveBestTime(save, state)`, which writes only for an ended, unassisted victory. With
`debugAssisted` set, `buildResult` returns `previousBestMs` and `newBest: false`, for both victory
and defeat. Tests at `tests/core/mission/mission.test.ts:163, :209, :224` cover a mark before the
end, a mark after the end, a null previous best, defeat, and the unassisted control. No contract
file was touched: `MissionState` lives in mission.ts.
**Still open (game-dev, call site):** `MissionSystem.ts:73/125/168-173` still keeps its own
`debugAssisted` flag and calls `withBestTime` directly. Fix: replace the flag with
`this.state = markDebugAssisted(this.state)` and the override plus `withBestTime` with `buildResult`
plus `saves.update((s) => saveBestTime(s, this.state))`, so there is one authoritative flag.
Gate verdict is unchanged: **FAIL on B1 only**.

## Addendum 4: n2 closed (2026-10-22, uncommitted working tree)

**n2 / n2a / n2b fixed.** `MissionSystem` keeps no flag of its own anymore. `markDebugAssisted()`
updates core state (`MissionSystem.ts:123-124`), the debug snapshot reads `this.state.debugAssisted`
(`:115`), and `end()` calls `buildResult` and then `saveBestTime`. It writes only when core returns
a new save reference (`:167-170`). That reference check is sound because `withBestTime` and
`saveBestTime` return the same `save` when nothing changes (`mission.ts:144`, and the `toBe(save)`
tests). My checks: typecheck 0, lint 0, `Tests 1063 passed (1063)`. I did not re-run the live
playtest; the live check comes from game-dev's report. **n1 is still open** (waiting on the
`resultsDelayMs` contract field).
Gate verdict is unchanged: **FAIL on B1 only**.

## Addendum 5: n2b live recheck (2026-10-22, uncommitted working tree)

Requested by the producer: re-check n2b only, with one live unassisted victory.

**Code.** `src/game/systems/MissionSystem.ts` no longer has a local flag, an override or a
`withBestTime` reference (`grep -c withBestTime` → 0). `:124` calls core
`markDebugAssisted(this.state)`, and `end()` calls core `buildResult` with no override, then
`saveBestTime` and `if (next !== current) this.saves.save(next)` (`:168-170`). Addendum 3's
"still open" line numbers were from before the switch. Comparing references instead of
`saves.update(...)` is fine: the rule still lives entirely in core, and it saves a no-op storage
write on every defeat and every assisted run.

**Live** (fresh browser profile, empty save, private Vite :5394 serving the working tree, headless
WebGL, autopilot):

| Run | Debug keys | Save before | Result screen | Save after |
|---|---|---|---|---|
| 1 Unassisted victory, 01:13, kills 40, saved 4 | none (overlay toggle only) | no best | **"New best time!"**, `debugAssisted: false` | `bestTimes.m01-goblin-woods = 73473.6` ms |
| 2 Assisted victory, 00:01 | O, I | 73473.6 | "Best 01:13", no "New best", `debugAssisted: true` | **73473.6 (unchanged)** |

Screenshots: `M7-screenshots/gate-n2b-unassisted-results.png`, `gate-n2b-assisted-results.png`.
Console: 0 errors, 0 warnings in both sessions.

**Gate (me, working tree):** typecheck 0 · lint 0 · `Test Files 54 passed (54)` /
`Tests 1063 passed (1063)` · build 0 · prettier `All matched files use Prettier code style!`

**n2 / n2a / n2b: closed.** Still open: **B1** (CD), **n1** (`resultsDelayMs` contract field), and
n3–n5 as listed. Gate verdict is unchanged: **FAIL on B1 only**.
