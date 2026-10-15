# M2 Review Gate — Movement and camera

Reviewer: reviewer · Date: 2026-10-14
Scope: the M2 working tree on branch m2-phase: the tracked changes to src/core/types.ts,
src/game/placeholders.ts and src/game/scenes/MissionScene.ts, plus every untracked file under src/,
tests/ and docs/design/sprints/M2.md. `git diff m1` also contains the two pre-production commits
(fe054fc, 3e1cc08: GDD, level docs, ADRs 0004-0007, style-lock art, the plan.md tone/scale edits and
art-director.md). Those belong to the pre-production phase and were approved there, so I only
skimmed them here (owner paths, no code).
Task reviews: M2-T0, T1, T2, T2b, T3, T4, T5, T6 (this directory).

## Verdict: PASS WITH NOTES

Every M2 "Done when" item and every sprint item D1-D5 passes with evidence. There are **no
blockers and no open major findings**. The automated playtest passes everything at 1280×720 and
2560×1440. At 390×844 all movement, camera, aim, restart and console checks pass. The one red line
there is my pixel check for the *drawn* debug crosshair: at that size the game renders at 0.61×,
and 1 px debug lines are lost in the downscale. That's a rendering limit below 1×, not an aim
defect (`aimWorld` is exact at every size). Details under "390×844" below. The open notes are
deferrals and observations for the human playtest.

## Quality gate (my own run on the final tree)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | `Test Files 5 passed (5)` / `Tests 112 passed (112)` |
| `pnpm build` | `dist/assets/index-DGUaPFh7.js 1,385.78 kB │ gzip: 361.78 kB` · `✓ built in 351ms`, exit 0 |
| `pnpm exec prettier --check .` | `All matched files use Prettier code style!` |
| `git diff m1 -- package.json pnpm-lock.yaml tsconfig.json eslint.config.js vite.config.ts` | empty: no dependency, tsconfig or lint-rule changes |
| Tests deleted/skipped | none: tracked tests (vec2, boundaries) unchanged; 3 new files (movement, smoothing, actionBuffer) |

## Done-when walk

### plan.md §9 M2

| Item | Verdict | Evidence |
|---|---|---|
| Placeholder leader | PASS | LeaderController.ts with the 16 px placeholder wizard at ×3, anchored at the feet (24, 46) (M2-T4) |
| `GameInput` with `KeyboardMouseInput` | PASS | GameInput.ts matches plan §6 exactly; every §6 desktop binding is present (M2-T3) |
| Normalised diagonal movement | PASS | `moveVectorFromAxes` + tests; playtest diagonal 109.7-110.8 px/s vs cardinal 109.8-110.5 px/s, `|moveVector|` 1.0000 |
| World bounds | PASS | `clampToRect(…, wizardBodyRadiusPx)`; the leader stops at exactly (10, 10), (2038, 10), (2038, 1526), (10, 1526) at all 3 sizes |
| Smooth camera follow with deadzone | PASS | CameraController with `dampFactor` easing and a goal-anchored deadzone; playtest: a 27 px nudge doesn't scroll, leaving the deadzone does (704 → 814-817) |
| Debug overlay | PASS | DebugOverlay.ts with `?debug` / Backtick (M2-T6) |
| **Done when:** movement feels responsive | PASS (objective part) | velocity = input × 110 px/s with no acceleration; `moveVector` is (0, 0) on the first snapshot after release. "Feels" is the human's call (see playtest script) |
| **Done when:** the camera never shows space outside the map | PASS | 0 of 2,140 samples had `worldView` outside the world while holding diagonals into all 4 corners at 3 sizes; `worldView` flush with each corner |

### docs/design/sprints/M2.md

| Item | Verdict | Evidence |
|---|---|---|
| **D1** typecheck/lint/test/build pass; movement math in src/core with unit tests | PASS | quality gate above; src/core/math/movement.ts, smoothing.ts, src/core/input/actionBuffer.ts with 3 test files (M2-T2, T2b) |
| **D2** velocity = input × `squad.moveSpeed`, no acceleration; diagonals normalised; leader can't leave bounds | PASS | speeds above; instant stop; clamp at body radius at all 4 corners |
| **D3** smooth follow with deadzone, frame-rate independent, never outside the map; 4 corners × 3 viewports | PASS | 12 corner runs, all in range; frame-rate independence analysed in M2-T5 (exact for a stationary target, a 1.4 px spread between 30 and 144 fps while running) |
| **D4** `GameInput` matches §6, all actions mapped, `consume()` edge-triggered, `aimWorld` in world coordinates, listeners removed on SHUTDOWN | PASS | M2-T3 + re-review; `aimWorld` error 0.0000 world px against an independent calculation (client px → canvas → `worldView`) at 5 pointer positions × 4 corners × 3 sizes; 10 restarts with listener counts flat |
| **D5** debug overlay toggles with `?debug` or Backtick | PASS | starts visible with `?debug`, the hook is absent without it, and Backtick toggles even when held with repeats |

## Diff review against CLAUDE.md

| Rule | Verdict | Evidence |
|---|---|---|
| File ownership | OK | types.ts (producer, CD-approved Q5 plus comment-only clarifications), src/data/{movement,camera,devArena}.ts (game-designer, Q1), src/core/** and tests/** (core-dev), src/game/** except events.ts (game-dev), docs/reviews/** (reviewer). events.ts was not created (deferred to M3 per Q5). No edits to plan.md, CLAUDE.md or .claude/** in the M2 working tree |
| Layer boundaries (§7.1/§7.3) | OK | lint passes the allow-list boundaries; src/core imports only `@core/*`; src/data uses `import type` only; no Phaser, DOM or `window` in core/data (grep) |
| No magic numbers / tuning in code | OK | speed, body radius, deadzone, half-life and world come from src/data. The remaining literals are presentation constants, all named (depth bands, debug colours and margins, placeholder palette, `TILE_SIZE_PX` with an M7 note, `CHARACTER_ANCHOR` citing the style guide) or structural (`/2`, origin 0, `MouseButton` DOM codes) |
| One authoritative state per entity | OK | the leader position is private in LeaderController and the sprite mirrors it (M2-T4) |
| Phaser 4 only | OK | every Phaser API used was checked against the 4.2.1 source in node_modules (M2-T3, T4, T5); no `startFollow` and no Phaser 3-only calls |
| update(dt)/destroy() and SHUTDOWN cleanup | OK | `System` interface with documented teardown tolerance; MissionScene runs every destroy step and re-throws the first error; playtest: 10 restarts, flat counts |
| Phaser clock only | OK | `delta` from the scene update; no `setTimeout`/`setInterval` in src (lint rule plus grep) |
| Pointer → world before gameplay use | OK | `aimWorld` via `camera.getWorldPoint` on the rendered matrix; exact in the playtest |
| Storage only through platform/storage | OK (n/a) | no storage use |
| No weakened tsconfig/lint, no deleted tests | OK | see the quality gate |

## Automated playtest

Method: headless Chrome over CDP (game-dev's `cdp.mjs` + my `reviewer/gate.mjs`, both in the session
scratchpad, not in the repo). I ran it against my own Vite on :5299 on CDP ports 9421-9423, then
stopped Vite by its PID (91884). Desktop emulation (`mobile: false`, DPR 1) at each size, because
the input under test is keyboard and mouse. Per size: start state, deadzone nudge, 4 corners (each
from a restart, diagonal held 15 s, `worldView` sampled every 80 ms), pointer at 4 inset canvas
corners plus the centre at each corner, speed (cardinal, arrow diagonal, WASD diagonal), 10×
restart lifecycle, held Backspace (1 + 20 repeats), held Backtick (1 + 9 repeats), Backspace while
hidden, and console capture.

| Check | 390×844 | 1280×720 | 2560×1440 |
|---|---|---|---|
| Canvas (css px per game px) | 390×219 at y 312 (0.609) | 1280×720 (2.0) | 2560×1440 (4.0) |
| `worldView` inside the world while moving (samples) | 715/715 | 716/716 | 714/714 |
| Leader clamped at body radius, 4 corners | PASS | PASS | PASS |
| `worldView` flush with each corner | PASS | PASS | PASS (BR 1407.9999999999995: eased from below, inside) |
| `aimWorld` = world point under the pointer | 0.0000 px | 0.0000 px | 0.0000 px |
| Drawn crosshair centred on the pointer | worst 1.16 game px; 2 of 5 positions had no red pixel left after downscale | 0.00 game px | 0.00 game px |
| Cardinal speed (px/s) | 110.5 | 109.9 | 109.8 |
| Diagonal speed, arrows / WASD (px/s) | 109.8 / 109.8 | 110.8 / 109.8 | 110.5 / 109.7 |
| Stop is instant | PASS | PASS | PASS |
| Deadzone: 27 px nudge doesn't scroll; leaving it scrolls | PASS | PASS | PASS |
| 10× restart: overlaysLive 1, pointer move/down 1/1, keys 17, key DOWN listeners 9, scene SHUTDOWN listeners 13 | flat | flat | flat |
| Speed after 10 restarts (no doubled update) | 109.8 | 110.5 | 109.7 |
| Held Backspace, 1 + 20 repeats | 1 restart | 1 restart | 1 restart |
| Held Backtick, 1 + 9 repeats | 1 toggle | 1 toggle | 1 toggle |
| Backspace while hidden | 0 restarts | 0 restarts | 0 restarts |
| Console errors / warnings / exceptions | none | none | none |

Screenshots (docs/reviews/M2-screenshots/): `gate-<size>-{top-left,top-right,bottom-right,bottom-left}.png`
(overlay visible, pointer at 60 %/40 % of the canvas) and `gate-<size>-hidden.png` for each of the 3
sizes, plus `T6-1280x720-bottomright-debug.png` from the T6 review. In each one the 1-tile brown
border is flush with the view edges at the corner, and no background colour shows.

### 390×844 (portrait phone)
`Scale.FIT` gives a 390×219 canvas, so the 640×360 game is drawn at 0.61× with nearest-neighbour
sampling. A 1 px debug line falls between sampled pixels and can disappear. My detector found the
crosshair within 1.16 game px (0.7 css px) where it survived, and found none at 2 of 5 positions.
The aim value itself is exact. So the "crosshair matches the pointer" criterion holds logically at
all sizes and visually at 1× and above. This is an observation for M8 (touch/mobile layout), not
an M2 defect. Portrait at this width shrinks everything, including the 48 px characters, to about
29 css px.

## Findings

### Blocker
None.

### Major
None open. (Closed during M2: T4 M1 anchor, T5 B1 restart crash.)

### Minor
None open. (Closed: T3 m1/m2, T5 m1/m2, T6 m1, T0 m1.)

## Deferred items (tracked, not M2 defects)

| Item | Owner | When |
|---|---|---|
| T0 m2: `wizardBodyRadiusPx` will be duplicated by per-unit `bodyRadiusPx`; GDD name `squad.moveSpeed` vs `MOVEMENT.squadMoveSpeed` | producer (contract), game-designer (GDD) | M4, when the unit contract lands |
| `delta` is not capped; with collision, a long frame can tunnel through blockers. Add a max-dt (data value) | game-dev (+ game-designer for the value) | M7 |
| Blocker-perimeter convention for map edges (the sprite clips at the top/left/right world edge; see observation 1) | level-designer, producer's M7 log | M7 |
| M5 aim test: compare against the world point under the cursor in the *displayed* frame, and include a moving-camera case (M2-T3 point 4) | core-dev / game-dev | M5 |
| plan.md §7.2 should list `src/core/input/` (M2-T2b n2) | producer, **needs human approval** (plan.md is read-only) | next plan edit |
| Optional nits: T2 n2/n3, T2b n1, T6 nits | various | any time |

## Observations for the human playtest (no verdict implied)

1. **Top edge: the leader nearly disappears.** Position is the feet, and the clamp keeps the
   body circle (radius 10) inside the world. At the top edge the feet stop at y = 10, so about 36 of
   the 48 sprite pixels are above the map and cut off by the camera bounds. With `?debug`, the
   top-left corner also puts the leader under the readout panel (gate-2560x1440-top-left.png). It's
   accepted for the dev arena because real maps get a blocker perimeter (M7), but expect to "lose"
   the wizard when hugging the top edge.
2. **Camera trail while running.** At full speed the camera settles about 13 px behind the
   deadzone edge, on top of the 48×27 px half-deadzone. Whether 96×54 / 90 ms feels right is the Q2
   tuning question for this playtest.
3. **Portrait phone at 390 wide** renders the game at 0.61×. It isn't an M2 target, but it'll come
   back in M8.
4. With `?debug`, the overlay starts visible and Backspace restarts the scene. A tester using
   `?debug` can restart by accident.

## Suggested 5-minute playtest script (for the producer to relay)

1. `pnpm dev`, open `/?debug` at a normal window size. Walk in circles and zig-zags with WASD, then
   arrows. Expected: same speed on diagonals, instant start/stop, no drift.
2. Hold each diagonal into each corner. Expected: never any background outside the brown border,
   and the camera stops flush.
3. Tap a direction briefly from rest. Expected: the leader moves inside the yellow box with no
   camera motion. Keep walking and the camera follows smoothly.
4. Move the mouse to the screen corners. Expected: the red crosshair sits under the cursor.
5. Press Backspace a few times, then walk. Expected: same speed, nothing doubled. Press Backtick to
   hide the overlay; Backspace then does nothing.
6. Feel questions only you can answer: does 110 px/s feel responsive or sluggish? Does the camera
   trail feel smooth or laggy (deadzone 96×54, half-life 90 ms)? Is losing the wizard at the top
   edge acceptable until M7?

## Re-gate (CD playtest), 2026-10-15

Scope: the changes from the creative-director playtest in docs/design/sprints/M2.md:
- P0: `CameraTuning.lookAheadPx` / `lookAheadHalfLifeMs` (CD-approved contract change).
- P1: camera.ts 64 / 250.
- P2: `insetRect` + `RectInsets` with 8 tests.
- P3: camera look-ahead.
- P4: leader clamps to the inset walkable rect.
- P5: crosshair 2 px thick, 11 px across, with a dark outline.

### Verdict: PASS WITH NOTES (unchanged)

All three CD complaints are fixed and verified at 3 viewports:
- The wizard is no longer cut off at the top edge.
- The camera now leads in the movement direction.
- The crosshair is visible at every size, including 390×844, where it used to disappear.

Nothing regressed: camera range, corners, speed, restart leak, key repeat and console are all
clean. No new blockers or majors. Two observations for the CD go below.

### Quality gate (my own run)

| Command | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | exit 0 / exit 0 |
| `pnpm test` | `Test Files 5 passed (5)` / `Tests 120 passed (120)` (+8 `insetRect`) |
| `pnpm build` | `✓ built in 537ms`, exit 0 |
| `pnpm exec prettier --check .` | clean |
| `git diff m1 -- package.json pnpm-lock.yaml tsconfig.json eslint.config.js vite.config.ts` | empty |

### Code check of P0-P5

| Item | Verdict | Evidence |
|---|---|---|
| P0 contract | OK | types.ts `CameraTuning` gains two readonly fields with doc comments; the CD approval is recorded in the sprint doc |
| P1 data | OK | camera.ts `lookAheadPx: 64, lookAheadHalfLifeMs: 250`, `as const satisfies CameraTuning`; type-only import |
| P2 `insetRect` | OK | movement.ts:33-56, pure. A collapsed axis becomes zero-size and centred, consistent with `clampToRect`. Tests cover uniform, zero, asymmetric, single-axis collapse, both-axes collapse and no mutation |
| P3 look-ahead | OK | CameraController.ts:66-91. The offset eases with `dampFactor(lookAheadHalfLifeMs, dt)` towards `moveVector × lookAheadPx`. A piecewise-constant target makes it exactly frame-rate independent. Deadzone and clamp act on `followPoint`; the goal is still clamped, so range is guaranteed as before; the start snap uses offset 0 |
| P4 walkable | OK | LeaderController.ts:43-50, `insetRect(world, { top: CHARACTER_EXTENT_ABOVE_FEET_PX (46, derived from CHARACTER_ANCHOR), others: wizardBodyRadiusPx })`, then `clampToRect(…, walkable, 0)`. Start is clamped too; `walkable` is readonly and exposed for debug |
| P5 crosshair | OK | DebugOverlay.ts:84-87, :228-237. Root cause confirmed by my original gate data (1 px lines lost at 0.61×) |
| No tuning in code | OK | 64/250 live in data; 46 is derived from the style-guide anchor (presentation) |

### Playtest (gate2.mjs, same method as above)

My own Vite on :5299 (PID 25638, stopped by PID afterwards), CDP ports 9431-9433.

| Check | 390×844 | 1280×720 | 2560×1440 |
|---|---|---|---|
| `worldView` inside the world while holding diagonals into 4 corners (samples) | 723/723 | 723/723 | 725/725 |
| Leader corners (10, 46), (2038, 46), (2038, 1526), (10, 1526) | PASS | PASS | PASS |
| `worldView` flush with each corner | PASS | PASS | PASS |
| Top edge: `feet.y − 46 ≥ view.y` (whole sprite on screen) | PASS (46 − 46 = 0) | PASS | PASS |
| Top edge: hat-tip pixels (#3d4fb5) in the top 3 game-px rows | 8 px | 72 px | 288 px |
| `aimWorld` error | 0.0000 | 0.0000 | 0.0000 |
| Drawn crosshair found at 5 pointer positions × 4 corners | 20/20, worst 1.64 game px = **1.0 screen px** | 20/20, 0.00 | 20/20, 0.00 |
| Look-ahead offset while running (expected 64) | 63.99 | 63.98 | 63.99 |
| Look-ahead offset 1.5 s after stop (expected 64 × 2⁻⁶ = 1.0) | 1.00 | 1.00 | 1.00 |
| Deadzone: 150 ms nudge doesn't scroll; leaving it scrolls | PASS | PASS | PASS |
| Cardinal / diagonal (arrows, WASD) speed, px/s | 109.8 / 109.9, 109.8 | 109.8 / 109.9, 109.9 | 109.9 / 109.8, 109.9 |
| 10× restart lifecycle (live 1, pointer 1/1, keys 17, DOWN 9, SHUTDOWN 13) | flat | flat | flat |
| Held Backspace (1 + 20 repeats) / held Backtick (1 + 9) / Backspace while hidden | 1 / 1 / 0 | 1 / 1 / 0 | 1 / 1 / 0 |
| Console errors / warnings / exceptions | none | none | none |

At 390×844 my script printed FAIL for the drawn crosshair, because the threshold I wrote for the
first gate is 1.5 game px. That threshold is too strict below 1×: at 0.609 css px per game px,
1.64 game px is exactly one screen pixel, the smallest offset that can occur after
nearest-neighbour downscaling. I count this as a PASS. The crosshair is present at all 20
positions (it was missing at 8 of 20 before P5), and it's within one device pixel.

Screenshots (docs/reviews/M2-screenshots/): `regate-<size>-{top-left,top-right,bottom-right,bottom-left,hidden}.png`
for 390x844, 1280x720 and 2560x1440. regate-1280x720-top-right.png shows the full wizard, hat
included, at (2038, 46) with the top border above it and the outlined crosshair.
regate-390x844-top-left.png shows the crosshair visible at 0.61×.

### Observations for the CD (feel, no verdict implied)

1. **Look-ahead mostly cancels the trail. It doesn't put the leader behind centre.** Running
   right at full speed, the camera centre now sits **+2.6 px** ahead of the leader (it was about
   −61 px before). The 64 px look-ahead is offset by the 48 px half-deadzone plus about 13 px of
   follow lag. In practice the leader stays roughly centred while running, rather than the view
   opening up ahead of them. After a stop the camera rests 16 px ahead. If the CD wants to see more
   of what's ahead, the levers are `lookAheadPx` above 64 or a smaller deadzone. This is a
   game-designer tuning call at the next playtest.
2. With `?debug`, the leader at the top-left corner sits under the readout panel (debug only).
   The side edges still clip up to about 8 px of staff and robe (body-radius inset), which is
   accepted until M7's blocker perimeter.

### New deferred note
- **Look-ahead uses input, not actual movement** (CameraController.ts:67-73). Holding into a world
  edge or, from M7, a blocker keeps the 64 px offset while the leader stands still. At world edges
  the camera clamp hides this. Against M7 blockers the camera would lean into a wall. Owner:
  game-dev, revisit in M7 (e.g. derive the offset from the leader's per-frame displacement).

Deferred items listed above are unchanged.

### Re-gate addendum (P4 named constants)

placeholders.ts and LeaderController.ts were last modified at 11:51:02. My code read and the whole
re-gate playtest (screenshots 11:52-11:57) ran on that version, so the results above already cover
it. `CHARACTER_FRAME_PX = 48`, `CHARACTER_ANCHOR = (24/48, 46/48)` and
`CHARACTER_EXTENT_ABOVE_FEET_PX = CHARACTER_ANCHOR.y × CHARACTER_FRAME_PX` all cite style-guide §6.
No runtime `displayHeight` read remains. The playtest asserted `walkable.y === 46` with strict
equality and it passed at all 3 sizes, so the derived value has no float drift. Nit (optional,
game-dev): 48 is now stated twice, as `CHARACTER_FRAME_PX` and implicitly as 16 × `PLACEHOLDER_WIZARD_SCALE`.
Deriving the scale (or asserting it) would keep the two from drifting apart. Verdict unchanged:
**PASS WITH NOTES**.

### Re-gate addendum (lookAheadPx 112, CD decision), 2026-10-15

Data-only change: src/data/camera.ts `lookAheadPx: 112` (half-life 250 unchanged; the comment
gives the lead formula). I re-ran only the camera checks (`reviewer/cam112.mjs`), on my own Vite
:5299 (PID 52976, stopped by PID afterwards) and CDP ports 9441-9443.

| Check | 390×844 | 1280×720 | 2560×1440 |
|---|---|---|---|
| `worldView` inside the world while holding diagonals into 4 corners (samples) | 725/725 | 723/723 | 725/725 |
| Leader at the walkable corners (10, 46) … (10, 1526); `worldView` flush | PASS | PASS | PASS |
| Look-ahead offset while running (expected 112) | 111.97 | 111.97 | 111.97 |
| Camera lead, running left / right (expected ≈ 112 − 48 − lag ≈ 50) | 50.6 / 50.6 | 50.6 / 50.6 | 50.6 / 50.6 |
| Camera lead, running up / down (expected ≈ 112 − 27 − lag ≈ 70) | 71.6 / 71.6 | 71.6 / 71.6 | 71.6 / 71.6 |
| Offset 1.5 s after stop (expected 112 × 2⁻⁶ = 1.75) | 1.75 | 1.75 | 1.75 |
| Whole sprite on screen while running in each cardinal direction | PASS | PASS | PASS |
| Console errors / warnings / exceptions | none | none | none |

The measured leads match the formula to 0.1 px (lag 13.4 px = 110 px/s in steady state at 60 fps,
as in M2-T5), and they're identical at all three sizes. During the corner runs the sprite is
partly off screen only while the leader is within 24 px of a side edge (body-radius inset, accepted
until M7). A diagnostic run confirmed this: the only other "top" hits were the eased `scrollY`
settling at a sub-pixel positive value above 0 (shows as 0.0, rendered at 0 with round pixels), a
missing epsilon in my check rather than visible clipping.
Screenshots: docs/reviews/M2-screenshots/cam112-<size>-{top-left,top-right,bottom-right,bottom-left,running-stop}.png.

Verdict unchanged: **PASS WITH NOTES**. My earlier observation that the look-ahead mostly
cancelled the trail is resolved by this CD decision: running sideways, the view now opens 50 px
ahead of the leader (70 px vertically).
